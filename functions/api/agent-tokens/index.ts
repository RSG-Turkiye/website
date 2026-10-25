/**
 * A member's own agent tokens, from the panel (section "Agent tokens").
 * Session only: this path is not in the agent route table, so the
 * middleware refuses a bearer token here, and getSessionUser knows only
 * cookies. The value is returned once, in the create answer; the row keeps
 * its SHA-256, lists show the last 4 characters, and the log carries the id.
 */
import { checkCsrf, getSessionUser, jsonResponse, type Env, type User } from '../../_lib/auth';
import { runGuardedWithAudit } from '../../_lib/audit';
import { activeGrants } from '../../_lib/role-grants';
import { fail, readJson } from '../../_lib/cms-api';
import { areasHeld, formatScope, hashToken, newTokenValue, parseScopes, type AgentArea } from '../../_lib/agent-tokens';

const MAX_LABEL = 60;
const MAX_LIVE = 5;
const DAYS = [7, 30, 90];
const DEFAULT_DAYS = 30;
const MAX_BODY = 4 * 1024;

export interface TokenRow {
  id: string;
  user_id: string;
  hint: string;
  label: string;
  scopes: string;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
  revoke_reason: string | null;
  display_name?: string | null;
}

/** Field by field, so the hash and revoked_by never leave the server. */
export function tokenJson(r: TokenRow, now: number, withOwner = false) {
  let scopes: string[] = [];
  try { const parsed = JSON.parse(r.scopes) as unknown; if (Array.isArray(parsed)) scopes = parsed.filter((s): s is string => typeof s === 'string'); } catch { /* listed with no scopes */ }
  return {
    id: r.id, label: r.label, hint: r.hint, scopes,
    created_at: r.created_at, expires_at: r.expires_at, last_used_at: r.last_used_at,
    revoked_at: r.revoked_at, revoke_reason: r.revoke_reason,
    status: r.revoked_at !== null ? 'revoked' as const : r.expires_at <= now ? 'expired' as const : 'live' as const,
    ...(withOwner ? { user_id: r.user_id, display_name: r.display_name ?? null } : {}),
  };
}

export const COLUMNS = 'id, user_id, hint, label, scopes, created_at, expires_at, last_used_at, revoked_at, revoke_reason';

/** The session user and their live roles; admin means a live admin grant, not the is_admin column. */
export async function tokenCaller(request: Request, env: Env): Promise<{ user: User; roles: string[]; admin: boolean; now: number } | null> {
  const user = await getSessionUser(request, env);
  if (!user) return null;
  const now = Math.floor(Date.now() / 1000);
  const roles = [...new Set((await activeGrants(env.DB, user.id, now)).map((g) => g.role))];
  return { user, roles, admin: roles.includes('admin'), now };
}

export const unauthenticated = () => fail(401, 'unauthenticated', 'Not signed in');

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const caller = await tokenCaller(request, env);
  if (!caller) return unauthenticated();
  const { user, roles, admin, now } = caller;
  const mine = await env.DB.prepare(`SELECT ${COLUMNS} FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC, id`)
    .bind(user.id).all<TokenRow>();
  const areas: AgentArea[] = areasHeld(roles);
  const body: Record<string, unknown> = { mine: mine.results.map((r) => tokenJson(r, now)), areas };
  if (admin) {
    // Rows go a year after they end (the nightly prune), so this stays short.
    const all = await env.DB.prepare(
      `SELECT ${COLUMNS.split(', ').map((c) => `t.${c}`).join(', ')}, p.display_name
       FROM agent_tokens t LEFT JOIN profiles p ON p.user_id = t.user_id ORDER BY t.created_at DESC, t.id`,
    ).all<TokenRow>();
    body.all = all.results.map((r) => tokenJson(r, now, true));
  }
  return jsonResponse(body);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request, env)) return fail(403, 'csrf', 'Forbidden');
  const caller = await tokenCaller(request, env);
  if (!caller) return unauthenticated();
  const { user, roles, now } = caller;

  const body = await readJson(request, MAX_BODY);
  if (!body) return fail(400, 'bad_request', 'Send a JSON object of at most 4 KB');
  const errors: Record<string, string> = {};
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label || label.length > MAX_LABEL) errors.label = `A name of 1 to ${MAX_LABEL} characters`;
  const days = body.days === undefined ? DEFAULT_DAYS : body.days;
  if (typeof days !== 'number' || !DAYS.includes(days)) errors.days = `One of ${DAYS.join(', ')}`;
  const scopes = parseScopes(body.scopes);
  if (!scopes) errors.scopes = 'At least one known area, each at read or draft, once';
  if (Object.keys(errors).length || !scopes) return fail(422, 'invalid', 'Some fields are not valid', { errors });

  const held = areasHeld(roles);
  if (scopes.some((s) => !held.includes(s.area))) return fail(403, 'scope_not_held', 'You do not hold every area you asked for');

  const id = crypto.randomUUID();
  const value = newTokenValue();
  const expiresAt = now + (days as number) * 86400;
  const scopeStrings = scopes.map(formatScope);
  // The count is checked inside the insert, so two creates at once cannot
  // both make the fifth; the new id is the proof that this write happened.
  const insert = env.DB.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, hint, label, scopes, created_at, expires_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?) < ?`,
  ).bind(id, user.id, await hashToken(value), value.slice(-4), label, JSON.stringify(scopeStrings), now, expiresAt, user.id, now, MAX_LIVE);
  const created = await runGuardedWithAudit(env.DB, insert, { condition: 'EXISTS (SELECT 1 FROM agent_tokens WHERE id = ?)', binds: [id] }, [], {
    userId: user.id, action: 'agent_token.create', targetType: 'agent_token', targetId: id,
    details: { scopes: scopeStrings, expires_at: expiresAt },
  }, now);
  if (!created) return fail(409, 'too_many_tokens', `At most ${MAX_LIVE} live tokens; revoke one first`);

  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM agent_tokens WHERE id = ?`).bind(id).first<TokenRow>();
  return jsonResponse({ token: tokenJson(row!, now), value }, 201);
};
