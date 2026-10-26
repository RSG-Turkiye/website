// OAuth clients of the site's own authorization server (plan 6): who may ask
// for a code, where the code may go, and how a client proves itself at the
// token endpoint. A client is one of two kinds, both standard, none special-
// cased:
//
// - CIMD (Client ID Metadata Document): the client_id is an https URL whose
//   JSON document we fetch on each use. Nothing is stored. claude.ai and
//   ChatGPT use this. The fetch is the one place this site fetches a URL an
//   anonymous caller names, so it is guarded (Call 10): https with a path,
//   at most 512 characters, no userinfo or fragment, no IP literal, not our
//   own host or localhost, no redirects, 5 s, 16 KB, JSON only, and the
//   document's client_id must equal the URL exactly.
//   A DNS name that resolves to a private address cannot be told apart in
//   Workers: there is no DNS API, and fetch resolves on its own. The guards
//   above are what stands instead; Cloudflare's fetch does not reach the
//   site's own network, and an answer is used only if it is a small JSON
//   document naming itself, so a probe learns nothing it can read back.
// - DCR (Dynamic Client Registration, RFC 7591): one oauth_clients row, made
//   by /oauth/register within the caps in agent-limits.ts. Its secret is
//   returned once and kept as a SHA-256 hash.

import { PREFIX, ISSUER, newValue, sha256Hex } from './oauth-config';
import { safeEqual } from './secret';

export type Client = {
  id: string;
  name: string;
  /** What the consent screen names: the CIMD URL's host; for DCR the first redirect URI's host, or its scheme for a private-use one. */
  host: string;
  redirectUris: string[];
  kind: 'cimd' | 'dcr';
  authMethod: 'none' | 'client_secret_basic' | 'client_secret_post';
  secretHash: string | null;
};

const MAX_URI = 512;
const MAX_REDIRECTS = 5;
const MAX_NAME = 100;
const CIMD_TIMEOUT_MS = 5000;
const CIMD_MAX_BYTES = 16 * 1024;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** Schemes that run code, read files or are not a callback; refused even as private-use schemes. */
const DENIED_SCHEMES = new Set([
  'http', 'https', 'javascript', 'data', 'file', 'vbscript', 'about', 'blob', 'ws', 'wss', 'ftp',
  'intent', 'view-source', 'chrome', 'filesystem', 'jar', 'mailto', 'tel', 'sms',
]);
const PRIVATE_SCHEME = /^([a-z][a-z0-9+.-]*):/;
/** Only printable ASCII: the URL parser silently drops tabs, newlines and edge spaces, which would make two different strings one URI. */
const PRINTABLE = /^[\x21-\x7e]+$/;
/** Printable, yet never part of a callback; they would reach an HTML page or a Location header as typed (a backslash is a slash to the parser). */
const UNSAFE_URI = /["<>\\^`{|}]/;
const OUR_HOST = new URL(ISSUER).hostname;

function parse(uri: string): URL | null {
  try { return new URL(uri); } catch { return null; }
}

const isLoopbackHost = (u: URL) => LOOPBACK.has(u.hostname);
const isLoopbackUrl = (u: URL) => u.protocol === 'http:' && isLoopbackHost(u);

/**
 * Why a redirect URI cannot be registered or used, or null (Call 9):
 * `https://` without a fragment, loopback `http` (localhost, 127.0.0.1,
 * [::1]), or a private-use scheme such as `cursor:`. Nothing else.
 */
export function redirectUriProblem(uri: string): string | null {
  if (typeof uri !== 'string' || uri === '') return 'empty';
  if (uri.length > MAX_URI) return `longer than ${MAX_URI} characters`;
  if (!PRINTABLE.test(uri)) return 'contains spaces or control characters';
  if (UNSAFE_URI.test(uri)) return 'contains a character that is not allowed in a redirect URI';
  if (uri.includes('#')) return 'has a fragment';
  const scheme = PRIVATE_SCHEME.exec(uri)?.[1];
  const u = parse(uri);
  if (!scheme || !u) return 'not an absolute URI';
  if (scheme === 'https' || scheme === 'http') {
    if (u.username || u.password) return 'has user information';
    if (scheme === 'http' && !isLoopbackUrl(u)) return 'http is allowed only for localhost, 127.0.0.1 and [::1]';
    return null;
  }
  if (DENIED_SCHEMES.has(scheme)) return `the ${scheme}: scheme is not allowed`;
  return null;
}

/**
 * Whether `asked` is one of the registered redirect URIs: the exact string,
 * except that a loopback `http` URI matches with any port (RFC 8252 §7.3; a
 * native app gets a free port each time). Same loopback name, same path and
 * query; nothing is normalised for any other URI.
 */
export function redirectMatches(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  if (redirectUriProblem(asked) !== null) return false;
  const a = parse(asked);
  if (!a || !isLoopbackUrl(a)) return false;
  const portless = (u: URL) => { const c = new URL(u.href); c.port = ''; return c.href; };
  return registered.some((r) => {
    const u = parse(r);
    return !!u && isLoopbackUrl(u) && portless(u) === portless(a);
  });
}

/** A redirect the consent screen must warn about: any local program can claim it (MCP spec). */
export function isLoopbackOrCustom(uri: string): boolean {
  const u = parse(uri);
  if (!u) return false;
  // The host, whatever the scheme: https://localhost is accepted as a redirect and is as local as http://localhost.
  return isLoopbackHost(u) || (u.protocol !== 'https:' && u.protocol !== 'http:');
}

/** The consent screen's name for a redirect target: its host, or the scheme of a private-use one. */
function targetHost(uri: string): string {
  const u = parse(uri);
  if (!u) return '';
  return u.protocol === 'https:' || u.protocol === 'http:' ? u.hostname : u.protocol.slice(0, -1);
}

/** No control, format (direction marks, zero-width) or line characters: the name is shown as the client's on the consent screen. */
const UNSHOWABLE = /[\p{Cc}\p{Cf}\u2028\u2029]/u;

// --- CIMD ---------------------------------------------------------------------

/** The CIMD URL is one we may fetch: checked before any network call. */
function cimdUrl(clientId: string): URL | null {
  if (clientId.length > MAX_URI || !PRINTABLE.test(clientId) || clientId.includes('#')) return null;
  const u = parse(clientId);
  if (!u || u.protocol !== 'https:' || u.username || u.password || u.port !== '') return null;
  if (u.pathname.length <= 1) return null;
  const host = u.hostname;
  if (host.endsWith('.')) return null; // a trailing dot names the same host and would slip past the checks below
  if (host.startsWith('[') || /^[0-9.]+$/.test(host)) return null; // IPv6 or IPv4 literal (the parser turns 3221225985 into dotted form)
  if (host === OUR_HOST || host === 'localhost' || host.endsWith('.localhost')) return null;
  return u;
}

/** The body, read with a running byte count and stopped at the signal; null past `cap` or on abort. */
async function readJsonCapped(res: Response, cap: number, signal: AbortSignal): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
  const aborted = new Promise<never>((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  aborted.catch(() => {});
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      size += value.byteLength;
      if (size > cap) throw new Error('too large');
      chunks.push(value);
    }
  } catch {
    reader.cancel().catch(() => {});
    return null;
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

const isJsonType = (type: string | null) => {
  const media = (type ?? '').split(';')[0].trim().toLowerCase();
  return media === 'application/json' || /^application\/[a-z0-9.+-]+\+json$/.test(media);
};

async function fetchCimd(url: URL, fetcher: typeof fetch, timeoutMs: number): Promise<Client | null> {
  const signal = AbortSignal.timeout(timeoutMs);
  let text: string | null;
  try {
    const res = await fetcher(url.href, { redirect: 'manual', signal, headers: { Accept: 'application/json' } });
    if (res.status !== 200 || !isJsonType(res.headers.get('Content-Type'))
      || Number(res.headers.get('Content-Length') ?? 0) > CIMD_MAX_BYTES) {
      res.body?.cancel().catch(() => {});
      return null;
    }
    text = await readJsonCapped(res, CIMD_MAX_BYTES, signal);
  } catch {
    // A timeout, a refused connection or a bad TLS certificate: the client's document cannot be had.
    return null;
  }
  if (text === null) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null;
  const d = doc as Record<string, unknown>;
  if (d.client_id !== url.href) return null;
  if (!Array.isArray(d.redirect_uris)) return null;
  // Keep only the URIs this server allows; a document with none left is refused.
  const redirectUris = d.redirect_uris.filter((r): r is string => typeof r === 'string' && redirectUriProblem(r) === null);
  if (redirectUris.length === 0) return null;
  // A CIMD client is public here: no secret, PKCE only.
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') return null;
  const raw = typeof d.client_name === 'string' ? d.client_name.trim() : '';
  const name = raw && raw.length <= MAX_NAME && !UNSHOWABLE.test(raw) ? raw : url.hostname;
  return { id: url.href, name, host: url.hostname, redirectUris, kind: 'cimd', authMethod: 'none', secretHash: null };
}

/**
 * The client named by `clientId`: a CIMD document fetched now (an `https://`
 * id), an oauth_clients row (an `rsg_oc_` id), or an error. Writes nothing.
 * `fetcher` and `options.timeoutMs` are for tests; the fetcher defaults to
 * the global fetch at call time, the timeout to 5 s.
 */
export async function resolveClient(
  db: D1Database, clientId: string, fetcher: typeof fetch = globalThis.fetch,
  options: { timeoutMs?: number } = {},
): Promise<Client | { error: 'unknown_client' | 'bad_metadata' }> {
  if (typeof clientId !== 'string') return { error: 'unknown_client' };
  if (clientId.startsWith('https://')) {
    const url = cimdUrl(clientId);
    // The document must name itself with exactly the string the client sent.
    if (!url || url.href !== clientId) return { error: 'bad_metadata' };
    return (await fetchCimd(url, fetcher, options.timeoutMs ?? CIMD_TIMEOUT_MS)) ?? { error: 'bad_metadata' };
  }
  if (clientId.startsWith(PREFIX.client)) {
    const row = await db.prepare('SELECT id, secret_hash, auth_method, name, redirect_uris FROM oauth_clients WHERE id = ?')
      .bind(clientId).first<{ id: string; secret_hash: string; auth_method: Client['authMethod']; name: string; redirect_uris: string }>();
    if (!row) return { error: 'unknown_client' };
    let redirectUris: string[] = [];
    try { redirectUris = JSON.parse(row.redirect_uris); } catch { /* a corrupt row matches no redirect */ }
    return {
      id: row.id, name: row.name, host: targetHost(redirectUris[0] ?? ''), redirectUris,
      kind: 'dcr', authMethod: row.auth_method, secretHash: row.secret_hash,
    };
  }
  return { error: 'unknown_client' };
}

// --- DCR ----------------------------------------------------------------------

const AUTH_METHODS: readonly Client['authMethod'][] = ['client_secret_basic', 'client_secret_post', 'none'];
const GRANT_TYPES = new Set(['authorization_code', 'refresh_token']);
const RESPONSE_TYPES = new Set(['code']);

type Registration =
  | { ok: true; name: string; redirectUris: string[]; authMethod: Client['authMethod'] }
  | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string };

const metadataError = (description: string): Registration => ({ ok: false, error: 'invalid_client_metadata', description });
const subsetOf = (v: unknown, allowed: Set<string>) =>
  v === undefined || (Array.isArray(v) && v.every((x) => typeof x === 'string' && allowed.has(x)));

/**
 * A registration request's metadata (RFC 7591 §2), checked. Unknown fields
 * are ignored and never fetched (logo_uri, jwks_uri, ...). The auth method
 * defaults to client_secret_basic, as the RFC says.
 */
export function parseRegistration(body: unknown): Registration {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return metadataError('The body must be a JSON object.');
  const b = body as Record<string, unknown>;
  const uris = b.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris must be a non-empty list.' };
  if (uris.length > MAX_REDIRECTS) return { ok: false, error: 'invalid_redirect_uri', description: `At most ${MAX_REDIRECTS} redirect_uris.` };
  for (const u of uris) {
    const problem = typeof u === 'string' ? redirectUriProblem(u) : 'not a string';
    if (problem) return { ok: false, error: 'invalid_redirect_uri', description: `A redirect URI is refused: ${problem}.` };
  }
  const redirectUris = uris as string[];
  if (!subsetOf(b.grant_types, GRANT_TYPES)) return metadataError('grant_types may hold only authorization_code and refresh_token.');
  if (Array.isArray(b.grant_types) && b.grant_types.length === 0) return metadataError('grant_types must not be empty.');
  if (!subsetOf(b.response_types, RESPONSE_TYPES)) return metadataError('response_types may hold only code.');
  const method = b.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!AUTH_METHODS.includes(method as Client['authMethod'])) {
    return metadataError('token_endpoint_auth_method must be client_secret_basic, client_secret_post or none.');
  }
  let name = targetHost(redirectUris[0]);
  if (b.client_name !== undefined) {
    if (typeof b.client_name !== 'string') return metadataError('client_name must be a string.');
    const trimmed = b.client_name.trim();
    if (trimmed.length > MAX_NAME) return metadataError(`client_name may be at most ${MAX_NAME} characters.`);
    if (UNSHOWABLE.test(trimmed)) return metadataError('client_name contains control characters.');
    if (trimmed) name = trimmed;
  }
  return { ok: true, name, redirectUris, authMethod: method as Client['authMethod'] };
}

/**
 * The insert of a new DCR client, to batch with the registration counters,
 * and the id and secret to return once. The secret is always issued (Call 8;
 * Perplexity refuses an answer without one) and only its hash is stored.
 * Async: hashing with Web Crypto is. With `guard` (a SQL condition and its
 * binds) the row is inserted only while the condition holds, so a cap is
 * decided inside the batch, not by an earlier read; the batch's result says
 * whether it was (meta.changes).
 */
export async function registerStatement(
  db: D1Database,
  input: { name: string; redirectUris: string[]; authMethod: Client['authMethod']; now: number; guard?: { sql: string; binds: unknown[] } },
): Promise<{ statement: D1PreparedStatement; id: string; secret: string }> {
  const id = newValue(PREFIX.client);
  const secret = newValue(PREFIX.secret);
  const values = [id, await sha256Hex(secret), input.authMethod, input.name, JSON.stringify(input.redirectUris), input.now];
  const statement = input.guard
    ? db.prepare(
      `INSERT INTO oauth_clients (id, secret_hash, auth_method, name, redirect_uris, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE ${input.guard.sql}`,
    ).bind(...values, ...input.guard.binds)
    : db.prepare(
      'INSERT INTO oauth_clients (id, secret_hash, auth_method, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(...values);
  return { statement, id, secret };
}

/**
 * Client authentication at the token endpoint. A CIMD client presents no
 * secret (it has none). A DCR client's presented secret must match by hash
 * (constant time), whichever way it came; no secret is allowed only for a
 * client registered as 'none'. `via` is how the secret came; it is not held
 * against the registered method, since the secret is checked either way.
 */
export async function authenticateClient(
  client: Client, presented: { id: string; secret: string | null; via: 'basic' | 'post' | 'none' },
): Promise<boolean> {
  if (presented.id !== client.id) return false;
  if (client.kind === 'cimd') return presented.secret === null;
  if (presented.secret === null) return client.authMethod === 'none';
  return safeEqual(await sha256Hex(presented.secret), client.secretHash);
}
