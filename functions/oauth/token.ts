// POST /oauth/token (RFC 6749 §3.2): a code becomes a connection, and a
// refresh value becomes a new pair. A connection is one agent_tokens row of
// kind 'oauth' (agent-tokens.ts) whose access and refresh values rotate in
// place, so its id (the audit marker, the counter key) lives as long as the
// connection does. Values are generated here, returned once and stored as
// SHA-256 only.
//
// Order: content type and size, client authentication, then the grant (its
// `resource` first). Every refusal that is a limit (429) or an invalid_target
// is decided before the first write, so a refused exchange leaves the code
// redeemable and a refused refresh leaves the connection as it was. A wrong
// guess (code, verifier, refresh value, client secret) counts toward the
// day's failures only (agent-limits.ts), never an IP: hosted connectors
// share addresses, so an IP cut-off here would let an outsider lock out a
// whole platform, and these values are random 256-bit, so it guards nothing.
//
// Does not import agent-tokens.ts (only the files listed in
// tests/agent-tokens.test.ts may).

import { jsonResponse, type Env } from '../_lib/auth';
import { runGuardedWithAudit } from '../_lib/audit';
import {
  autoRevoke, chargeConnection, countFailedAuth, ipKey, readCapped, readSnapshot, type Snapshot,
} from '../_lib/agent-limits';
import { authenticateClient, resolveClient, type Client } from '../_lib/oauth-clients';
import { consumeCode, pkceMatches } from '../_lib/oauth-codes';
import {
  ACCESS_TTL, MAX_CONNECTIONS, PREFIX, REUSE_GRACE, isCanonicalResource, newRefreshValue, newValue, parseRefresh, sha256Hex,
} from '../_lib/oauth-config';
import { cors, preflight } from '../_lib/oauth-metadata';
import { safeEqual } from '../_lib/secret';

const POST_ONLY = 'POST, OPTIONS';
const BODY_CAP = 8 * 1024;
const MAX_LABEL = 60;
const FORM = 'application/x-www-form-urlencoded';

type ErrorCode = 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_target';

function oauthError(error: ErrorCode, description: string, status = 400): Response {
  return jsonResponse({ error, error_description: description }, status);
}

const invalidGrant = () => oauthError('invalid_grant', 'The grant is invalid, expired or already used.');

interface Ctx {
  db: D1Database;
  request: Request;
  now: number;
  ip: string;
  snapshot: Snapshot;
  form: URLSearchParams;
  client: Client;
}

/** A guess that failed: counted for the day (one row, none past the day's cap), then the answer. */
async function failed(c: Pick<Ctx, 'db' | 'ip' | 'snapshot' | 'now'>, res: Response): Promise<Response> {
  await countFailedAuth(c.db, c.ip, c.snapshot, c.now, false);
  return res;
}

/** The connection's scopes include social work, which may use the agents' reserve. */
const mayUseReserve = (scopes: string[]) => scopes.some((s) => s.startsWith('social:'));

function storedScopes(raw: string): string[] | null {
  try {
    // The code or row was written by this server from validated scopes; authenticateAgent checks them again on every use.
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 && parsed.every((s) => typeof s === 'string') ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

const ok = (access: string, refresh: string, expiresIn: number, scopes: string[]): Response =>
  jsonResponse({ access_token: access, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refresh, scope: scopes.join(' ') });

/** The target of `resource`: absent, or this server's MCP endpoint. Checked first, so a refusal spends nothing. */
const wrongResource = (form: URLSearchParams): Response | null => {
  const resource = form.get('resource');
  return resource !== null && !isCanonicalResource(resource)
    ? oauthError('invalid_target', 'The resource is not this server\'s MCP endpoint.')
    : null;
};

// --- client authentication ---------------------------------------------------

type Presented = { id: string; secret: string | null; via: 'basic' | 'post' | 'none' } | Response;

const formDecoded = (s: string) => decodeURIComponent(s.replace(/\+/g, ' '));

/** Basic header (RFC 6749 §2.3.1: both halves URL-decoded) or client_id/client_secret in the body, never both. */
function presentedClient(request: Request, form: URLSearchParams): Presented {
  const header = request.headers.get('Authorization');
  const bodyId = form.get('client_id');
  const bodySecret = form.get('client_secret');
  if (header !== null) {
    if (bodyId !== null || bodySecret !== null) return oauthError('invalid_request', 'Authenticate the client one way only.');
    const m = /^Basic ([A-Za-z0-9+/=_-]+)$/i.exec(header.trim());
    if (!m) return basicChallenge();
    try {
      const bytes = Uint8Array.from(atob(m[1]), (ch) => ch.charCodeAt(0));
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const colon = text.indexOf(':');
      if (colon < 0) return basicChallenge();
      return { id: formDecoded(text.slice(0, colon)), secret: formDecoded(text.slice(colon + 1)), via: 'basic' };
    } catch {
      return basicChallenge();
    }
  }
  if (bodyId === null || bodyId === '') return oauthError('invalid_request', 'client_id is required.');
  if (bodySecret !== null) return { id: bodyId, secret: bodySecret, via: 'post' };
  return { id: bodyId, secret: null, via: 'none' };
}

function invalidClient(basic: boolean): Response {
  const res = oauthError('invalid_client', 'Client authentication failed.', 401);
  if (basic) res.headers.set('WWW-Authenticate', 'Basic realm="rsg-turkiye"');
  return res;
}
const basicChallenge = () => invalidClient(true);

// --- grants ------------------------------------------------------------------

async function codeGrant(c: Ctx): Promise<Response> {
  const { db, form, now, client } = c;
  const code = form.get('code');
  const redirectUri = form.get('redirect_uri');
  const verifier = form.get('code_verifier');
  if (!code || !redirectUri || !verifier) return oauthError('invalid_request', 'code, redirect_uri and code_verifier are required.');
  const target = wrongResource(form);
  if (target) return target;

  // Read, do not consume: a refusal below must leave the code redeemable.
  const pending = await db.prepare('SELECT user_id, scopes FROM oauth_codes WHERE code_hash = ? AND expires_at > ?')
    .bind(await sha256Hex(code), now).first<{ user_id: string; scopes: string }>();
  if (!pending) return failed(c, invalidGrant());
  const id = crypto.randomUUID();
  const asked = storedScopes(pending.scopes);
  const limited = await chargeConnection(db, { tokenId: id, userId: pending.user_id, social: asked !== null && mayUseReserve(asked) }, c.ip, now);
  if (limited) return limited;

  // From here the code is spent, whoever presents it and whatever follows.
  const row = await consumeCode(db, code, now);
  if (!row) return failed(c, invalidGrant());
  if (row.client_id !== client.id || row.redirect_uri !== redirectUri || !(await pkceMatches(verifier, row.code_challenge))) {
    return failed(c, invalidGrant());
  }
  const scopes = storedScopes(row.scopes);
  if (!scopes) return invalidGrant();

  const access = newValue(PREFIX.access);
  const refresh = newRefreshValue(id);
  const expiresAt = now + row.days * 86400;
  const insert = db.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, hint, label, scopes, created_at, expires_at, kind,
       client_id, access_expires_at, refresh_hash, refreshed_at)
     SELECT ?, ?, ?, '', ?, ?, ?, ?, 'oauth', ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM agent_tokens WHERE user_id = ? AND kind = 'oauth' AND revoked_at IS NULL AND expires_at > ?) < ?`,
  ).bind(
    id, row.user_id, await sha256Hex(access), row.label.slice(0, MAX_LABEL), JSON.stringify(scopes), now, expiresAt,
    client.id, now + ACCESS_TTL, await sha256Hex(refresh), now,
    row.user_id, now, MAX_CONNECTIONS,
  );
  // The new row id is generated for this call alone, so its existence proves this insert happened.
  const created = await runGuardedWithAudit(db, insert, { condition: 'EXISTS (SELECT 1 FROM agent_tokens WHERE id = ?)', binds: [id] }, [], {
    userId: row.user_id, action: 'agent_token.create', targetType: 'agent_token', targetId: id,
    details: { kind: 'oauth', scopes, expires_at: expiresAt, client_id: client.id },
  }, now);
  if (!created) return invalidGrant();
  return ok(access, refresh, ACCESS_TTL, scopes);
}

interface ConnectionRow {
  id: string;
  user_id: string;
  scopes: string;
  expires_at: number;
  revoked_at: number | null;
  kind: string;
  client_id: string | null;
  refresh_hash: string | null;
  prev_refresh_hash: string | null;
  refreshed_at: number | null;
}

async function refreshGrant(c: Ctx): Promise<Response> {
  const { db, form, now, client } = c;
  const value = form.get('refresh_token');
  if (!value) return oauthError('invalid_request', 'refresh_token is required.');
  const target = wrongResource(form);
  if (target) return target;
  const parsed = parseRefresh(value);
  if (!parsed) return failed(c, invalidGrant());
  const row = await db.prepare(
    `SELECT id, user_id, scopes, expires_at, revoked_at, kind, client_id, refresh_hash, prev_refresh_hash, refreshed_at
     FROM agent_tokens WHERE id = ?`,
  ).bind(parsed.rowId).first<ConnectionRow>();
  if (!row || row.kind !== 'oauth' || row.client_id !== client.id) return failed(c, invalidGrant());
  // A disconnected or ended connection is a stale client, not a guess: no count.
  if (row.revoked_at !== null || row.expires_at <= now) return invalidGrant();

  const hash = await sha256Hex(value);
  if (safeEqual(row.prev_refresh_hash, hash) && !safeEqual(row.refresh_hash, hash)) {
    // The value before the current one. Inside the grace it is a retry after a lost answer;
    // later it is a copy somebody kept, so the whole connection goes.
    if (now - (row.refreshed_at ?? 0) > REUSE_GRACE) await autoRevoke(db, row.id, 'refresh_reuse', now);
    return invalidGrant();
  }
  if (!safeEqual(row.refresh_hash, hash)) return failed(c, invalidGrant());

  const scopes = storedScopes(row.scopes);
  if (!scopes) return invalidGrant();
  const limited = await chargeConnection(db, { tokenId: row.id, userId: row.user_id, social: mayUseReserve(scopes) }, c.ip, now);
  if (limited) return limited;

  const access = newValue(PREFIX.access);
  const refresh = newRefreshValue(row.id);
  const accessExpiresAt = Math.min(now + ACCESS_TTL, row.expires_at);
  // Only the request that still holds the current refresh value changes the row; a loser changes none.
  const res = await db.prepare(
    `UPDATE agent_tokens SET token_hash = ?, access_expires_at = ?, refresh_hash = ?, prev_refresh_hash = refresh_hash, refreshed_at = ?
     WHERE id = ? AND refresh_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
  ).bind(await sha256Hex(access), accessExpiresAt, await sha256Hex(refresh), now, row.id, hash, now).run();
  if (Number(res.meta?.changes ?? 0) !== 1) return invalidGrant();
  return ok(access, refresh, accessExpiresAt - now, scopes);
}

// --- the endpoint ------------------------------------------------------------

async function handle(request: Request, env: Env, now: number): Promise<Response> {
  const type = (request.headers.get('Content-Type') ?? '').trim().toLowerCase();
  if (!type.startsWith(FORM)) return oauthError('invalid_request', `The body must be ${FORM}.`);
  const text = await readCapped(request, BODY_CAP);
  if (text === null) return oauthError('invalid_request', 'The body is too large.');
  const form = new URLSearchParams(text);
  const keys = [...form.keys()];
  if (new Set(keys).size !== keys.length) return oauthError('invalid_request', 'A parameter was sent more than once.');

  const ip = await ipKey(request);
  // The day's failures only (the IP's row is read with them and not used); the grant reads the token rows if it charges.
  const snapshot = await readSnapshot(env.DB, ip, now, false);

  const grant = form.get('grant_type');
  if (!grant) return oauthError('invalid_request', 'grant_type is required.');
  if (grant !== 'authorization_code' && grant !== 'refresh_token') {
    return oauthError('unsupported_grant_type', 'Only authorization_code and refresh_token are supported.');
  }

  const presented = presentedClient(request, form);
  if (presented instanceof Response) return presented.status === 401 ? failed({ db: env.DB, ip, snapshot, now }, presented) : presented;
  const resolved = await resolveClient(env.DB, presented.id);
  const basic = presented.via === 'basic';
  if ('error' in resolved) return failed({ db: env.DB, ip, snapshot, now }, invalidClient(basic));
  if (!(await authenticateClient(resolved, presented))) return failed({ db: env.DB, ip, snapshot, now }, invalidClient(basic));

  const ctx: Ctx = { db: env.DB, request, now, ip, snapshot, form, client: resolved };
  return grant === 'authorization_code' ? codeGrant(ctx) : refreshGrant(ctx);
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const res = await handle(request, env, Math.floor(Date.now() / 1000));
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Pragma', 'no-cache');
  return cors(res, POST_ONLY);
};

export const onRequestOptions: PagesFunction = () => preflight(POST_ONLY);
