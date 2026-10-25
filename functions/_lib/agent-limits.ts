// Rate limits, daily quotas, size limits and auto-revoke for agent tokens,
// enforced in the Function (there is no free WAF rate limiting on this
// account). Every counter is a fixed-window bucket in `agent_rate`, bumped
// by one upsert that returns the new count, so a check never counts rows.
// The bucket key carries its window index, so a new window is a new row and
// nothing has to reset; the nightly audit prune deletes expired buckets.
//
// The dependency runs one way, agent-tokens -> agent-limits: this file must
// not import agent-tokens (tests/agent-tokens.test.ts allows only a listed
// few files to), so the principal is typed here by the fields it needs.

import { jsonResponse } from './auth';
import { runGuardedWithAudit, type AuditEntry } from './audit';
import type { AgentRoute } from './agent-routes';

const MINUTE = 60;
const DAY = 86400;

/** Call 4 and Call 5 of the agent-access plan. */
export const LIMITS = Object.freeze({
  TOKEN_PER_MINUTE: 30,
  TOKEN_PER_DAY: 1000,
  WRITES_PER_DAY: 200,
  SUBMITS_PER_DAY: 20,
  UPLOADS_PER_DAY: 20,
  IP_PER_MINUTE: 60,
  IP_PER_DAY: 3000,
  IP_FAILED_AUTH: 10,
  IP_FAILED_AUTH_WINDOW: 600,
  /**
   * Attempts in one minute, refused ones included, that revoke the token
   * (`flood`): a loop. Above the token's minute limit and below the IP's, so
   * one machine reaches it before its IP is cut off.
   */
  FLOOD_PER_MINUTE: 50,
  /** human_only refusals from one token in a UTC day. Revokes (`refusals`). */
  REFUSALS_PER_DAY: 20,
  BODY_BYTES: 256 * 1024,
  UPLOAD_BODY_BYTES: 5 * 1024 * 1024,
});

const QUOTA: Record<NonNullable<AgentRoute['quota']>, { key: string; limit: number }> = {
  write: { key: 'w', limit: LIMITS.WRITES_PER_DAY },
  submit: { key: 's', limit: LIMITS.SUBMITS_PER_DAY },
  upload: { key: 'u', limit: LIMITS.UPLOADS_PER_DAY },
};

/** What the checks need of an AgentPrincipal (agent-tokens.ts). */
export interface LimitedPrincipal {
  tokenId: string;
  route: AgentRoute;
  /** The token value, for the leak check only; never logged or stored. */
  value: string;
}

export type RevokeReason = 'refusals' | 'flood' | 'leaked';

const windowEnd = (windowSeconds: number, now: number) => (Math.floor(now / windowSeconds) + 1) * windowSeconds;

/**
 * Adds one to the counter `<bucket>:<window index>` and returns the new count.
 * One statement: an upsert with RETURNING, keyed on the primary key.
 */
export async function bump(db: D1Database, bucket: string, windowSeconds: number, now: number): Promise<number> {
  const key = `${bucket}:${Math.floor(now / windowSeconds)}`;
  const row = await db.prepare(
    'INSERT INTO agent_rate (bucket, n, expires_at) VALUES (?, 1, ?) ON CONFLICT(bucket) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(key, windowEnd(windowSeconds, now)).first<{ n: number }>();
  return row?.n ?? 1;
}

/** Seconds left in the window, at least 1: what Retry-After says. */
const secondsLeft = (windowSeconds: number, now: number) => Math.max(1, windowEnd(windowSeconds, now) - now);

export function rateLimited(retryAfter: number): Response {
  const res = jsonResponse({ error: 'Too many requests', code: 'rate_limited' }, 429);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

const tooLarge = () => jsonResponse({ error: 'The request body is too large', code: 'too_large' }, 413);
const leaked = () => jsonResponse({
  error: "The request contains this token's own value, so the token has been revoked. Make a new one in the panel and keep it in your tool's secret settings.",
  code: 'leaked',
}, 400);

/** SHA-256 of the caller's IP, as `ipHash` in certificates.ts; the IP itself is never stored. */
export async function ipKey(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rsg-agent:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Reads the body with a running byte count, as readFeed in podcast/pull.ts
 * does, so a body without Content-Length (chunked) is never read past `cap`.
 * Returns the bytes (or, with `keep: false`, an empty array: counted only,
 * nothing kept), or null once the body passes the cap.
 */
async function readCounted(request: Pick<Request, 'body'>, cap: number, keep: boolean): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      // Not awaited: on a clone (a tee branch) the cancel settles only once
      // the other branch is cancelled too, which the caller does next.
      reader.cancel().catch(() => {});
      return null;
    }
    if (keep) chunks.push(value);
  }
  if (!keep) return new Uint8Array(0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

/** The body as text, or null once it passes `cap` bytes. No body: ''. */
export async function readCapped(request: Pick<Request, 'body'>, cap: number): Promise<string | null> {
  const bytes = await readCounted(request, cap, true);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

/** Whether the body stays within `cap` bytes, counted as it streams; nothing is kept or decoded. */
export async function withinCap(request: Pick<Request, 'body'>, cap: number): Promise<boolean> {
  return (await readCounted(request, cap, false)) !== null;
}

const revokeEntry = (tokenId: string, reason: RevokeReason): AuditEntry => ({
  userId: null, action: 'agent_token.auto_revoke', targetType: 'agent_token', targetId: tokenId, details: { reason },
});

/**
 * Revokes the token and writes its audit row in one batch. The audit row is
 * written only when this UPDATE revoked the token: `changes()` in the audit
 * insert is the row count of the UPDATE just before it in the same batch.
 * So callers may call it on every request past a limit; a token already
 * revoked (by an earlier request, or by a person) gets no second row.
 * Returns whether this call revoked it.
 */
export function autoRevoke(db: D1Database, tokenId: string, reason: RevokeReason, now: number): Promise<boolean> {
  const update = db.prepare('UPDATE agent_tokens SET revoked_at = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL')
    .bind(now, reason, tokenId);
  return runGuardedWithAudit(db, update, { condition: 'changes() = 1', binds: [] }, [], revokeEntry(tokenId, reason), now);
}

/**
 * Counts one human_only refusal for the token with this hash (the middleware
 * refuses before any lookup, so it has only the hash). From the limit on it
 * looks for a live token with that hash and revokes it; a made-up token has
 * none, so it writes no audit row.
 */
export async function countRefusal(db: D1Database, tokenHash: string, now: number): Promise<void> {
  const n = await bump(db, `r:${tokenHash}:d`, DAY, now);
  if (n < LIMITS.REFUSALS_PER_DAY) return;
  const row = await db.prepare('SELECT id FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL').bind(tokenHash).first<{ id: string }>();
  if (row) await autoRevoke(db, row.id, 'refusals', now);
}

/** The failed-authentication counter of this IP for the current window. */
const failBucket = (ip: string) => `f:${ip}`;

/** One more failed authentication from this IP (the middleware saw a 401). */
export async function countFailedAuth(db: D1Database, request: Request, now: number): Promise<void> {
  await bump(db, failBucket(await ipKey(request)), LIMITS.IP_FAILED_AUTH_WINDOW, now);
}

/**
 * Per-IP limits on every request that carries an Authorization header, valid
 * or not. An IP with too many failed authentications in the window gets 429
 * for the rest of it, whatever token it sends next.
 */
export async function checkIp(db: D1Database, request: Request, now: number): Promise<Response | null> {
  const ip = await ipKey(request);
  const failWindow = LIMITS.IP_FAILED_AUTH_WINDOW;
  const failKey = `${failBucket(ip)}:${Math.floor(now / failWindow)}`;
  const failed = await db.prepare('SELECT n FROM agent_rate WHERE bucket = ?').bind(failKey).first<{ n: number }>();
  if ((failed?.n ?? 0) >= LIMITS.IP_FAILED_AUTH) return rateLimited(secondsLeft(failWindow, now));
  if (await bump(db, `i:${ip}:m`, MINUTE, now) > LIMITS.IP_PER_MINUTE) return rateLimited(secondsLeft(MINUTE, now));
  if (await bump(db, `i:${ip}:d`, DAY, now) > LIMITS.IP_PER_DAY) return rateLimited(secondsLeft(DAY, now));
  return null;
}

/**
 * The token's own checks, run by authenticateAgent once the token, its
 * member and route are known. In order: body size; the leak signal (before
 * the counters, so a leaked value is revoked even in a request that is over
 * a limit); the flood signal and the minute limit, both on one count that
 * includes refused attempts; the day limit and the route's quota. null: go on.
 */
export async function checkToken(
  db: D1Database, _env: unknown, request: Request, principal: LimitedPrincipal, now: number,
): Promise<Response | null> {
  // The upload route's body is an image: counted only, never kept or
  // decoded, and not checked for the value (binary is not content).
  const upload = principal.route.quota === 'upload';
  const cap = upload ? LIMITS.UPLOAD_BODY_BYTES : LIMITS.BODY_BYTES;
  let text = '';
  if (request.body) {
    // A declared length over the cap is refused before anything is read.
    const declared = Number(request.headers.get('Content-Length') ?? 0);
    let fits: boolean;
    if (declared > cap) fits = false;
    else if (upload) fits = await withinCap(request.clone(), cap);
    else {
      const body = await readCapped(request.clone(), cap);
      fits = body !== null;
      text = body ?? '';
    }
    if (!fits) {
      // The handler never runs, so the original can go too: the stream's
      // source is then cancelled as well, not left waiting.
      await request.body.cancel().catch(() => {});
      return tooLarge();
    }
  }

  // Any text body, whatever its Content-Type says (curl -d sends JSON as a form).
  if (text.includes(principal.value)) {
    await autoRevoke(db, principal.tokenId, 'leaked', now);
    return leaked();
  }

  const t = `t:${principal.tokenId}`;
  const perMinute = await bump(db, `${t}:m`, MINUTE, now);
  if (perMinute >= LIMITS.FLOOD_PER_MINUTE) {
    await autoRevoke(db, principal.tokenId, 'flood', now);
    return rateLimited(secondsLeft(MINUTE, now));
  }
  if (perMinute > LIMITS.TOKEN_PER_MINUTE) return rateLimited(secondsLeft(MINUTE, now));
  if (await bump(db, `${t}:d`, DAY, now) > LIMITS.TOKEN_PER_DAY) return rateLimited(secondsLeft(DAY, now));
  const quota = principal.route.quota ? QUOTA[principal.route.quota] : null;
  if (quota && await bump(db, `${t}:${quota.key}`, DAY, now) > quota.limit) return rateLimited(secondsLeft(DAY, now));
  return null;
}
