// The fixed values of the site's own OAuth server (plan 6), which lets a
// member connect a web connector (claude.ai, ChatGPT and other MCP clients)
// to /api/mcp by signing in instead of pasting a personal token. A
// connection is an agent_tokens row of kind 'oauth' (agent-tokens.ts); this
// file holds only constants and pure helpers, and imports nothing from
// agent-tokens.ts, so the discovery documents can use it without the rest.

/** The authorization server's identifier: AS metadata `issuer` and every authorization response's `iss` (RFC 9207). */
export const ISSUER = 'https://rsg-turkiye.iscbsc.org';
/** The one protected resource and the access token's audience (RFC 8707): the URL a member types into the client. */
export const MCP_RESOURCE = 'https://rsg-turkiye.iscbsc.org/api/mcp';
/** Protected resource metadata (RFC 9728), named in every 401 from the agent path. */
export const PRM_URL = 'https://rsg-turkiye.iscbsc.org/.well-known/oauth-protected-resource/api/mcp';

/** Seconds. An access token is short-lived; a code is spent at once; a replayed refresh value inside REUSE_GRACE is a lost answer, not theft. */
export const ACCESS_TTL = 3600;
export const CODE_TTL = 120;
export const REUSE_GRACE = 60;

/** How long a connection lives, chosen on the consent screen like a token's life; no refresh extends it. */
export const CONNECTION_DAYS: readonly number[] = [7, 30, 90];
export const DEFAULT_DAYS = 30;

/** Per member: live connections (apart from the 5 personal tokens) and unexpired codes. */
export const MAX_CONNECTIONS = 5;
export const MAX_LIVE_CODES = 5;

export const PREFIX = {
  access: 'rsg_oat_',
  refresh: 'rsg_ort_',
  code: 'rsg_oac_',
  client: 'rsg_oc_',
  secret: 'rsg_ocs_',
} as const;

/** `prefix` and 32 random bytes in base64url (43 characters). */
export function newValue(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return prefix + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex. 32 random bytes need no salt or pepper: there is nothing to guess. */
export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The `resource` a client sent names our MCP endpoint: the exact string,
 * with only the scheme and host compared without case. Compared as text,
 * not parsed, so nothing a URL parser would repair or normalize (a missing
 * `//`, backslashes, whitespace, `:443`, `/./`) counts; nor does a trailing
 * slash, a query (even an empty `?`), a fragment or userinfo.
 */
export function isCanonicalResource(v: string): boolean {
  return v.length === MCP_RESOURCE.length
    && v.slice(0, ISSUER.length).toLowerCase() === ISSUER
    && v.slice(ISSUER.length) === MCP_RESOURCE.slice(ISSUER.length);
}

/**
 * A refresh value names its connection's row id, so the token endpoint
 * finds the row by primary key and no refresh index is written. Only the
 * secret part makes it unguessable; the row keeps the whole value's hash.
 */
export function newRefreshValue(rowId: string): string {
  return `${PREFIX.refresh}${rowId}.${newValue('')}`;
}

const REFRESH = /^rsg_ort_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.[A-Za-z0-9_-]{43}$/;

/** The row id inside a refresh value, or null for anything that is not one. */
export function parseRefresh(v: string): { rowId: string } | null {
  const m = REFRESH.exec(v);
  return m ? { rowId: m[1] } : null;
}
