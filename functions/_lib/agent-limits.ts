// Rate limits, daily quotas, the agents' daily budget, size limits and
// auto-revoke for agent tokens, enforced in the Function (there is no free
// WAF rate limiting on this account).
//
// The free plan's ceilings are the reason for the shape: Workers 100,000
// requests a day and D1 100,000 rows written a day for the whole site, and
// running out of either stops everything (sessions, mail, the panel) until
// 00:00 UTC. So agents together get at most AGENT_BUDGET requests a day, and
// a request costs as few D1 writes as possible:
//
// - All counters live in `agent_counters`, one row per UTC day and subject
//   (a token, or an IP). A row holds every counter of its subject (the
//   current minute, the day, the quotas), so an allowed request bumps one
//   row, its token's. The table is WITHOUT ROWID with no other index, so a
//   bump is one row written.
// - The key starts with the day, zero-padded: today's token rows are one
//   primary-key range, read in the same statement as the IP's row and the
//   day's failures row, and the member's day, the agents' request pools and
//   their write pools are sums over that range. The nightly prune deletes
//   the days before today by the same range.
// - Check, then bump: a request refused by a daily limit, the budget, a
//   quota or a blocked IP writes nothing. Only the minute limit counts its
//   refusals (the flood signal needs them), until the flood revokes the token.
// - IP rows count only failures: a value that matches no token, or a
//   header that is no token value. Nothing is written per value. An IP past
//   IP_FAILED_AUTH is refused without a write (an IPv6 address counts by its
//   /64), and past FAILURES_PER_DAY for all addresses together a failure is
//   refused without any write. Two places do not count the IP: /oauth/token
//   and an rsg_oat_ bearer value. Hosted connectors (claude.ai, ChatGPT) reach
//   us from addresses their members share, so an outsider's junk would cut
//   them all off; those values are 256-bit random, so the count protected
//   nothing but D1 writes, which the day's cap still bounds (the day's row
//   alone: one write).
//
// Counts read before the bump can race: two requests at once may both pass
// the last free slot. The overshoot is a few requests, never a budget risk.
//
// The dependency runs one way, agent-tokens -> agent-limits: this file must
// not import agent-tokens (tests/agent-tokens.test.ts allows only a listed
// few files to), so the principal is typed here by the fields it needs.

import { jsonResponse } from './auth';
import { runGuardedWithAudit, type AuditEntry } from './audit';
import type { AgentRoute } from './agent-routes';

const MINUTE = 60;
const DAY = 86400;

/** Call 4 and Call 5 of the agent-access plan, and the owner's budget of 2026-10-26. */
export const LIMITS = Object.freeze({
  /**
   * All agent requests together, per UTC day: the general pool, which any
   * route may use, then the reserve, which only social work may use once the
   * general pool is spent. 15,000 in all, 15% of the Workers free plan's
   * 100,000 requests a day; people in the panel are never counted.
   */
  AGENT_GENERAL_PER_DAY: 12_000,
  AGENT_RESERVE_PER_DAY: 3_000,
  /**
   * All agents' writes, submits and uploads together (what the handlers
   * write to D1), per UTC day: a general pool, then a reserve only social
   * work may use. Each is about 10 rows with its audit row, so 2,000 keep
   * agents' handler writes near 20,000 of D1's 100,000 rows a day.
   */
  AGENT_WRITES_GENERAL_PER_DAY: 1_600,
  AGENT_WRITES_RESERVE_PER_DAY: 400,
  /**
   * Failed authentications counted from every address together, per UTC day.
   * Past it, a value that matches no token (or a header that is no token
   * value) is refused with no D1 write at all.
   */
  FAILURES_PER_DAY: 5_000,
  /** One member's requests per UTC day, across all their tokens. */
  MEMBER_PER_DAY: 300,
  TOKEN_PER_MINUTE: 30,
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

/** The whole agent ceiling, both pools. */
export const AGENT_BUDGET = LIMITS.AGENT_GENERAL_PER_DAY + LIMITS.AGENT_RESERVE_PER_DAY;
/** The whole ceiling on agents' handler writes, both pools. */
export const AGENT_WRITE_BUDGET = LIMITS.AGENT_WRITES_GENERAL_PER_DAY + LIMITS.AGENT_WRITES_RESERVE_PER_DAY;

export type QuotaColumn = 'writes' | 'submits' | 'uploads';
const QUOTA: Record<NonNullable<AgentRoute['quota']>, { column: QuotaColumn; limit: number }> = {
  write: { column: 'writes', limit: LIMITS.WRITES_PER_DAY },
  submit: { column: 'submits', limit: LIMITS.SUBMITS_PER_DAY },
  upload: { column: 'uploads', limit: LIMITS.UPLOADS_PER_DAY },
};

/** What the checks need of an AgentPrincipal (agent-tokens.ts). */
export interface LimitedPrincipal {
  tokenId: string;
  userId: string;
  route: AgentRoute;
  /** The token value, for the leak check only; never logged or stored. */
  value: string;
  /** What this request, with this body, spends: whether it is social work (the reserve), and which quota. */
  charge: (body: string) => Charge;
  /**
   * Set by checkToken on an MCP message whose tool has a quota: the quota
   * spent in the message's own upsert, or 'full'. The tool's inner request
   * then spends nothing more (authenticateInternal in agent-tokens.ts).
   */
  quotaPaid?: QuotaColumn | 'full' | 'budget';
}

/** What a request spends besides one request: the reserve may serve it (social work), and its quota. */
export interface Charge { reserve: boolean; quota?: AgentRoute['quota'] }

export type RevokeReason = 'refusals' | 'flood' | 'leaked' | 'refresh_reuse';

const windowEnd = (windowSeconds: number, now: number) => (Math.floor(now / windowSeconds) + 1) * windowSeconds;

/** Seconds left in the window, at least 1: what Retry-After says. */
const secondsLeft = (windowSeconds: number, now: number) => Math.max(1, windowEnd(windowSeconds, now) - now);

export function rateLimited(retryAfter: number, extra: Record<string, unknown> = {}): Response {
  const res = jsonResponse({ error: 'Too many requests', code: 'rate_limited', ...extra }, 429);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

/** A daily limit or quota: its window ends at 00:00 UTC, which the answer says too. */
const dailyLimited = (now: number) => rateLimited(secondsLeft(DAY, now), { resets: '00:00 UTC' });

/** The agents' budget for the day is spent: every token waits for 00:00 UTC. */
export function agentBudgetSpent(now: number): Response {
  const retryAfter = secondsLeft(DAY, now);
  const res = jsonResponse({
    error: 'Too many requests',
    code: 'agent_budget',
    retry_after: retryAfter,
    message: 'Ajan kotası bugün doldu, yarın tekrar deneyin / Agent quota is used up for today, try again tomorrow',
  }, 429);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

const tooLarge = () => jsonResponse({ error: 'The request body is too large', code: 'too_large' }, 413);
const leaked = () => jsonResponse({
  error: "The request contains this token's own value, so the token has been revoked. Make a new one in the panel and keep it in your tool's secret settings.",
  code: 'leaked',
}, 400);

// --- the counter rows ------------------------------------------------------

/** The UTC day, zero-padded so keys sort by day. */
const dayKey = (now: number) => String(Math.floor(now / DAY)).padStart(6, '0');
const tokenBucket = (tokenId: string, now: number) => `${dayKey(now)}:t:${tokenId}`;
const ipBucket = (ip: string, now: number) => `${dayKey(now)}:i:${ip}`;
/** The one row that counts every address's failed authentications today. */
const failuresBucket = (now: number) => `${dayKey(now)}:g:failures`;

/** Every bucket key before this one belongs to an earlier day: what the prune deletes. */
export const firstBucketOfDay = (now: number) => dayKey(now);

interface TokenCounts {
  bucket: string; user_id: string | null; general: number; reserve: number;
  writes: number; submits: number; uploads: number; quota_reserve: number; refusals: number; minute: number; minute_n: number;
}
interface IpCounts { requests: number; minute: number; minute_n: number; fail_window: number; fail_n: number }

/**
 * Today's counters for this request: its IP's row, the day's failure count,
 * and every token row of the day (the pools are their sums).
 */
export interface Snapshot { ip: IpCounts | null; failures: number; tokens: TokenCounts[] }

/**
 * One statement: the IP's row and the failures row by primary key, and
 * today's token rows by a primary-key range. Rows read: one per token used
 * today, plus two.
 */
export async function readSnapshot(db: D1Database, ip: string, now: number, tokens = true): Promise<Snapshot> {
  const day = dayKey(now);
  const rows = (await db.prepare(
    'SELECT * FROM agent_counters WHERE bucket IN (?1, ?2) OR (bucket >= ?3 AND bucket < ?4)',
  ).bind(ipBucket(ip, now), failuresBucket(now), tokens ? `${day}:t:` : '', tokens ? `${day}:t;` : '').all<TokenCounts & IpCounts>()).results;
  const ipRow = rows.find((r) => r.bucket === ipBucket(ip, now));
  const failures = rows.find((r) => r.bucket === failuresBucket(now));
  return { ip: ipRow ?? null, failures: failures?.requests ?? 0, tokens: rows.filter((r) => r !== ipRow && r !== failures) };
}

/**
 * Today's agent requests and writes, for the admin Overview card
 * (functions/api/admin/health.ts): the sums of today's token rows, one
 * primary-key range. Rows read: one per token used today.
 */
export async function agentUsageToday(db: D1Database, now: number): Promise<{ requests: number; writes: number }> {
  const day = dayKey(now);
  const r = await db.prepare(
    'SELECT COALESCE(SUM(general + reserve), 0) AS requests, COALESCE(SUM(writes + submits + uploads), 0) AS writes FROM agent_counters WHERE bucket >= ?1 AND bucket < ?2',
  ).bind(`${day}:t:`, `${day}:t;`).first<{ requests: number; writes: number }>();
  return { requests: r?.requests ?? 0, writes: r?.writes ?? 0 };
}

/**
 * The IP's refusal, if it is cut off: too many failed authentications in
 * the window, or its minute or day used up. Decided from the row as read,
 * so a cut-off IP costs no write.
 */
export function ipRefusal(row: IpCounts | null, now: number): Response | null {
  if (!row) return null;
  const failWindow = LIMITS.IP_FAILED_AUTH_WINDOW;
  if (row.fail_window === Math.floor(now / failWindow) && row.fail_n >= LIMITS.IP_FAILED_AUTH) return rateLimited(secondsLeft(failWindow, now));
  if (row.minute === Math.floor(now / MINUTE) && row.minute_n >= LIMITS.IP_PER_MINUTE) return rateLimited(secondsLeft(MINUTE, now));
  if (row.requests >= LIMITS.IP_PER_DAY) return rateLimited(secondsLeft(DAY, now));
  return null;
}

/**
 * One failed authentication: the day's failures row, and this IP's row
 * unless `countIp` is false (two rows or one, in one batch). Past
 * FAILURES_PER_DAY (or the IP's window limit) nothing is written: the
 * upserts are conditional, so the cap holds under a burst too.
 */
async function countFailure(db: D1Database, ip: string, snapshot: Snapshot, now: number, countIp: boolean): Promise<void> {
  if (snapshot.failures >= LIMITS.FAILURES_PER_DAY) return;
  // The snapshot is only the fast path: the writer judges the cap, so a burst that all read the same count cannot pass it.
  const day = db.prepare(
    'INSERT INTO agent_counters (bucket, requests) VALUES (?1, 1) ON CONFLICT(bucket) DO UPDATE SET requests = requests + 1 WHERE agent_counters.requests < ?2',
  ).bind(failuresBucket(now), LIMITS.FAILURES_PER_DAY);
  await db.batch(countIp ? [bumpIp(db, ip, now, true), day] : [day]);
}

/** One more failed request from this IP (and a failed authentication when `failed`). One upsert. */
function bumpIp(db: D1Database, ip: string, now: number, failed: boolean): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO agent_counters (bucket, requests, minute, minute_n, fail_window, fail_n) VALUES (?1, 1, ?2, 1, ?3, ?4)
     ON CONFLICT(bucket) DO UPDATE SET
       requests = requests + 1,
       minute_n = CASE WHEN minute = excluded.minute THEN minute_n + 1 ELSE 1 END,
       minute = excluded.minute,
       fail_n = CASE WHEN excluded.fail_n = 0 THEN fail_n WHEN fail_window = excluded.fail_window THEN fail_n + 1 ELSE 1 END,
       fail_window = CASE WHEN excluded.fail_n = 0 THEN fail_window ELSE excluded.fail_window END
     WHERE excluded.fail_n = 0 OR fail_window != excluded.fail_window OR fail_n < ?5`,
  ).bind(ipBucket(ip, now), Math.floor(now / MINUTE), failed ? Math.floor(now / LIMITS.IP_FAILED_AUTH_WINDOW) : 0, failed ? 1 : 0, LIMITS.IP_FAILED_AUTH);
}

interface TokenDelta { minute: boolean; general?: number; reserve?: number; quota?: QuotaColumn; quotaReserve?: boolean; refusals?: number }

/** Adds `delta` to the token's row for today. One upsert; returns the row's minute_n and refusals. */
function bumpToken(db: D1Database, p: Pick<LimitedPrincipal, 'tokenId' | 'userId'>, now: number, d: TokenDelta): D1PreparedStatement {
  const q = (c: QuotaColumn) => (d.quota === c ? 1 : 0);
  return db.prepare(
    `INSERT INTO agent_counters (bucket, user_id, minute, minute_n, general, reserve, writes, submits, uploads, refusals, quota_reserve)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(bucket) DO UPDATE SET
       minute_n = CASE WHEN excluded.minute_n = 0 THEN minute_n WHEN minute = excluded.minute THEN minute_n + 1 ELSE 1 END,
       minute = CASE WHEN excluded.minute_n = 0 THEN minute ELSE excluded.minute END,
       general = general + excluded.general, reserve = reserve + excluded.reserve,
       writes = writes + excluded.writes, submits = submits + excluded.submits, uploads = uploads + excluded.uploads,
       refusals = refusals + excluded.refusals, quota_reserve = quota_reserve + excluded.quota_reserve
     RETURNING minute_n, refusals`,
  ).bind(
    tokenBucket(p.tokenId, now), p.userId, Math.floor(now / MINUTE), d.minute ? 1 : 0,
    d.general ?? 0, d.reserve ?? 0, q('writes'), q('submits'), q('uploads'), d.refusals ?? 0, d.quota && d.quotaReserve ? 1 : 0,
  );
}

/** Runs the token's upsert; the token row's counts after it. */
async function bump(db: D1Database, token: D1PreparedStatement): Promise<{ minute_n: number; refusals: number }> {
  return (await token.first<{ minute_n: number; refusals: number }>()) ?? { minute_n: 0, refusals: 0 };
}

/**
 * Who an IP limit counts: an IPv4 address as it is, an IPv6 address by its
 * /64, since one machine usually holds a whole /64 and could otherwise step
 * through addresses.
 */
export function ipSubject(ip: string): string {
  if (!ip.includes(':')) return ip;
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1); // ::ffff:192.0.2.1
  const [head, tail] = ip.toLowerCase().split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).map((g) => (parseInt(g || '0', 16) || 0).toString(16)).join(':')}::/64`;
}

/** SHA-256 of the caller's IP (its /64 for IPv6), as `ipHash` in certificates.ts; the IP itself is never stored. */
export async function ipKey(request: Request): Promise<string> {
  const ip = ipSubject(request.headers.get('CF-Connecting-IP') ?? 'unknown');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rsg-agent:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A personal token starts with "rsg_pat_", an OAuth connection's access and
 * refresh values with "rsg_oat_" and "rsg_ort_"; an upload that holds any of
 * them is refused (leaked). As ASCII (UTF-8) and as UTF-16 in both byte
 * orders, which is how EXIF UserComment and the Windows XP* tags store text.
 */
const PREFIX_TEXTS = ['rsg_pat_', 'rsg_oat_', 'rsg_ort_'];
const VALUE_NEEDLES = PREFIX_TEXTS.flatMap((p) => [
  new TextEncoder().encode(p),
  new Uint8Array([...p].flatMap((c) => [c.charCodeAt(0), 0])),
  new Uint8Array([...p].flatMap((c) => [0, c.charCodeAt(0)])),
]);
/** Bytes carried over from one chunk to the next, so a needle split across them is found. */
const CARRY = Math.max(...VALUE_NEEDLES.map((n) => n.length)) - 1;

/** Whether `bytes` holds `needle`, from `from` on. */
function holdsBytes(bytes: Uint8Array, needle: Uint8Array): boolean {
  const first = needle[0];
  for (let i = bytes.indexOf(first); i !== -1 && i <= bytes.length - needle.length; i = bytes.indexOf(first, i + 1)) {
    let j = 1;
    while (j < needle.length && bytes[i + j] === needle[j]) j++;
    if (j === needle.length) return true;
  }
  return false;
}

/**
 * Reads the body with a running byte count, as readFeed in podcast/pull.ts
 * does, so a body without Content-Length (chunked) is never read past `cap`.
 * Returns the bytes, or 'too_large' once the body passes the cap. With
 * `keep: false` nothing is kept (an empty array comes back), and the bytes
 * are searched for a token value as they stream, with the end of each chunk
 * carried over so a value split across two chunks is still found: then
 * 'leaked'.
 */
async function readCounted(request: Pick<Request, 'body'>, cap: number, keep: boolean): Promise<Uint8Array | 'too_large' | 'leaked'> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let carry = new Uint8Array(0);
  let found = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      // Not awaited: on a clone (a tee branch) the cancel settles only once
      // the other branch is cancelled too, which the caller does next.
      reader.cancel().catch(() => {});
      return 'too_large';
    }
    if (keep) chunks.push(value);
    else if (!found) {
      const window = new Uint8Array(carry.length + value.byteLength);
      window.set(carry);
      window.set(value, carry.length);
      found = VALUE_NEEDLES.some((needle) => holdsBytes(window, needle));
      carry = window.slice(Math.max(0, window.length - CARRY));
    }
  }
  if (found) return 'leaked';
  if (!keep) return new Uint8Array(0);
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return all;
}

/** The body as text, or null once it passes `cap` bytes. No body: ''. */
export async function readCapped(request: Pick<Request, 'body'>, cap: number): Promise<string | null> {
  const bytes = await readCounted(request, cap, true);
  return typeof bytes === 'string' ? null : new TextDecoder().decode(bytes);
}

/**
 * An upload body, counted as it streams and searched for a token value
 * (any `rsg_pat_`, `rsg_oat_` or `rsg_ort_`, this token's or another's, as
 * ASCII or UTF-16) without
 * decoding: 'ok',
 * 'too_large' or 'leaked'. Nothing is kept.
 */
export async function scanUpload(request: Pick<Request, 'body'>, cap: number): Promise<'ok' | 'too_large' | 'leaked'> {
  const out = await readCounted(request, cap, false);
  return typeof out === 'string' ? out : 'ok';
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
 * A bearer request on a route outside the table (the middleware answers 403
 * human_only). A cut-off IP gets 429 with no write. Otherwise, a value of a
 * live token counts one refusal on that token,
 * and at REFUSALS_PER_DAY the token is revoked; a value that matches no
 * token counts as a failed authentication (countFailure); a revoked or expired
 * token's value, or a header that is no token value at all, writes nothing.
 */
export type RefusedToken = { id: string; user_id: string } | 'unknown' | 'dead' | 'none';

export async function countRefusal(
  db: D1Database, request: Request, lookup: () => Promise<RefusedToken>, now: number,
): Promise<Response | null> {
  const ip = await ipKey(request);
  const snapshot = await readSnapshot(db, ip, now, false);
  const refused = ipRefusal(snapshot.ip, now);
  if (refused) return refused;
  const token = await lookup();
  if (token === 'none' || token === 'dead') return null;
  if (token === 'unknown') {
    await countFailure(db, ip, snapshot, now, true);
    return null;
  }
  const { refusals } = await bump(db, bumpToken(db, { tokenId: token.id, userId: token.user_id }, now, { minute: false, refusals: 1 }));
  if (refusals >= LIMITS.REFUSALS_PER_DAY) await autoRevoke(db, token.id, 'refusals', now);
  return null;
}

/**
 * A value that matches no token (or is no token value), or a wrong guess at
 * /oauth/token: one failed authentication of the IP and of the day, unless
 * the day's failures are already at FAILURES_PER_DAY (then nothing is
 * written). `countIp` false (an rsg_oat_ value, /oauth/token) counts the
 * day only, since those callers share addresses (see the top of this file).
 */
export async function countFailedAuth(db: D1Database, ip: string, snapshot: Snapshot, now: number, countIp = true): Promise<void> {
  await countFailure(db, ip, snapshot, now, countIp);
}

// --- the leak check --------------------------------------------------------

/** %XX sequences undone one by one, so one bad sequence does not stop the rest. */
const percentDecoded = (s: string) => s.replace(/%([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));

/** Numeric character references and the named ones for _ undone. */
const entityDecoded = (s: string) => s
  .replace(/&#[xX]([0-9a-fA-F]{1,6});?/g, (_m, h: string) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
  .replace(/&#([0-9]{1,7});?/g, (_m, d: string) => String.fromCodePoint(Math.min(Number(d), 0x10ffff)))
  .replace(/&(lowbar|UnderBar);/g, '_');

/** The string values of a parsed JSON value, in order, and its keys apart. */
function stringLeaves(v: unknown, out = { values: [] as string[], keys: [] as string[] }) {
  if (typeof v === 'string') out.values.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v !== null && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.keys.push(k); stringLeaves(x, out); }
  return out;
}

/**
 * Whether this text holds the token value, written in any way that
 * whatever stores or shows it would turn back into the value:
 * - as written;
 * - when the text is JSON, in any string after its escapes are undone
 *   (`\u0072sg_pat_...`), or split across strings (all string leaves
 *   joined);
 * - percent-encoded (`%72sg_pat_...`) or as HTML character references
 *   (`&#x72;sg_pat_...`), or both, in any of the above.
 */
export function holdsValue(text: string, value: string): boolean {
  const texts = [text];
  try {
    const { values, keys } = stringLeaves(JSON.parse(text));
    texts.push(values.join(''), ...values, ...keys);
  } catch { /* not JSON: the text alone */ }
  for (const t of texts) {
    if (t.includes(value)) return true;
    if (!/[%&]/.test(t)) continue;
    const p = percentDecoded(t);
    const e = entityDecoded(t);
    if ([p, e, entityDecoded(p), percentDecoded(e)].some((x) => x.includes(value))) return true;
  }
  return false;
}

/** Revokes the token (`leaked`) and gives the answer for the request that carried its value. */
export async function refuseLeak(db: D1Database, principal: Pick<LimitedPrincipal, 'tokenId'>, now: number): Promise<Response> {
  await autoRevoke(db, principal.tokenId, 'leaked', now);
  return leaked();
}

// --- the token's checks ----------------------------------------------------

/**
 * The token's own checks, run by authenticateAgent once the token, its
 * member and route are known, with the snapshot it read for this request.
 * In order:
 * 1. Body size, and the leak signal (before any counter, so a leaked value
 *    is revoked even in a request that is over a limit). An upload is
 *    searched for a token prefix as bytes; any other body as text.
 * 2. Daily limits, refused with no write: the member's day, the route's
 *    quota, the agents' request pools and, for a request with a quota, the
 *    agents' write pools (each general, then the reserve for social work).
 * 3. The minute: the flood signal and the minute limit, on one count that
 *    includes refused attempts (these write the minute count only).
 * 4. One upsert of the token's row (minute, pool, quota, write pool).
 * A body over the cap is answered 413 only after step 4: it counts as a
 * request, and as a write or submit where the route has that quota.
 * null: go on.
 */
export async function checkToken(
  db: D1Database, request: Request, principal: LimitedPrincipal, at: { ip: string; snapshot: Snapshot }, now: number,
): Promise<Response | null> {
  const upload = principal.route.quota === 'upload';
  const cap = upload ? LIMITS.UPLOAD_BODY_BYTES : LIMITS.BODY_BYTES;
  let text = '';
  let fits = true;
  if (request.body) {
    // A declared length over the cap is refused before anything is read.
    const declared = Number(request.headers.get('Content-Length') ?? 0);
    if (declared > cap) fits = false;
    else if (upload) {
      const scan = await scanUpload(request.clone(), cap);
      if (scan === 'leaked') {
        await request.body.cancel().catch(() => {});
        return refuseLeak(db, principal, now);
      }
      fits = scan === 'ok';
    } else {
      const body = await readCapped(request.clone(), cap);
      fits = body !== null;
      text = body ?? '';
    }
    // The handler never runs, so the original can go too: the stream's
    // source is then cancelled as well, not left waiting.
    if (!fits) await request.body.cancel().catch(() => {});
  }

  // Any text body, whatever its Content-Type says (curl -d sends JSON as a form).
  if (fits && holdsValue(text, principal.value)) return refuseLeak(db, principal, now);

  const { snapshot } = at;
  const mine = snapshot.tokens.find((t) => t.bucket === tokenBucket(principal.tokenId, now));
  let general = 0, reserve = 0, member = 0, quotaSpent = 0, quotaReserve = 0;
  for (const t of snapshot.tokens) {
    general += t.general;
    reserve += t.reserve;
    quotaSpent += t.writes + t.submits + t.uploads;
    quotaReserve += t.quota_reserve;
    if (t.user_id === principal.userId) member += t.general + t.reserve;
  }
  if (member >= LIMITS.MEMBER_PER_DAY) return dailyLimited(now);
  const charge = principal.charge(text);
  const quota = charge.quota ? QUOTA[charge.quota] : null;
  const quotaFull = quota !== null && (mine?.[quota.column] ?? 0) >= quota.limit;
  // A REST route's quota refuses here. An MCP message goes on, and its tool
  // answers 429 as a tool result (authenticateInternal), so the agent sees why.
  if (quotaFull && principal.route.quota) return dailyLimited(now);
  let pool: 'general' | 'reserve';
  if (general < LIMITS.AGENT_GENERAL_PER_DAY) pool = 'general';
  else if (reserve < LIMITS.AGENT_RESERVE_PER_DAY && charge.reserve) pool = 'reserve';
  else return agentBudgetSpent(now);
  // The agents' write budget, for a request with a quota, in the same way:
  // general first, then the reserve for social work. Spent: refused with no
  // write on REST; an MCP message goes on and its tool answers agent_budget.
  let writePool: 'general' | 'reserve' | 'spent' | null = null;
  if (quota && !quotaFull) {
    if (quotaSpent - quotaReserve < LIMITS.AGENT_WRITES_GENERAL_PER_DAY) writePool = 'general';
    else if (quotaReserve < LIMITS.AGENT_WRITES_RESERVE_PER_DAY && charge.reserve) writePool = 'reserve';
    else writePool = 'spent';
  }
  if (writePool === 'spent' && principal.route.quota) return agentBudgetSpent(now);

  const thisMinute = Math.floor(now / MINUTE);
  const perMinute = (mine?.minute === thisMinute ? mine.minute_n : 0) + 1;
  if (perMinute > LIMITS.TOKEN_PER_MINUTE) {
    const counted = await bump(db, bumpToken(db, principal, now, { minute: true }));
    if (Math.max(perMinute, counted.minute_n) >= LIMITS.FLOOD_PER_MINUTE) await autoRevoke(db, principal.tokenId, 'flood', now);
    return rateLimited(secondsLeft(MINUTE, now));
  }
  const spend = quota && writePool !== null && writePool !== 'spent' ? quota.column : undefined;
  await bump(db, bumpToken(db, principal, now, { minute: true, [pool]: 1, quota: spend, quotaReserve: writePool === 'reserve' }));
  if (quota && !principal.route.quota) principal.quotaPaid = spend ?? (quotaFull ? 'full' : 'budget');
  return fits ? null : tooLarge();
}

/**
 * The route's daily quota (writes, submits, uploads) alone, for an MCP
 * tool's inner REST request: the outer /api/mcp request already passed every
 * other check, counted once against the minute, the member's day and the
 * pools, and spent this quota and the agents' write budget in its own upsert
 * (`paid`). So nothing is written here: the answer is null when the message
 * paid, 429 when the quota or the write budget was spent, and agent_budget
 * when nothing paid for it (no tool does that today).
 */
export async function checkQuota(
  _db: D1Database, principal: Pick<LimitedPrincipal, 'tokenId' | 'userId' | 'route'>, now: number, paid?: QuotaColumn | 'full' | 'budget',
): Promise<Response | null> {
  const quota = principal.route.quota ? QUOTA[principal.route.quota] : null;
  if (!quota) return null;
  if (paid === 'full') return dailyLimited(now);
  if (paid === 'budget') return agentBudgetSpent(now);
  if (paid === quota.column) return null;
  // Not paid by its message: refused, rather than spent outside the agents'
  // write budget, which only checkToken can see. No tool reaches this today.
  return agentBudgetSpent(now);
}

// --- OAuth: the token endpoint and registration (plan 6) ---------------------

/** The token endpoint's refusal, in OAuth's error shape (Call 7). */
function oauthLimited(retryAfter: number): Response {
  const res = jsonResponse({ error: 'rate_limited' }, 429);
  res.headers.set('Retry-After', String(retryAfter));
  return res;
}

/** What a connection is, for chargeConnection: its row id (the counter key), its member, and whether its scopes include social work (the reserve). */
export interface ChargedConnection { tokenId: string; userId: string; social: boolean }

/**
 * A code exchange or a refresh at /oauth/token, counted as one request of
 * that connection, as checkToken counts an API request: the member's day,
 * the agents' pools (the reserve only when `social`), then the
 * minute limit and the flood revoke. No IP cut-off (hosted connectors share
 * addresses) and no body checks: the token endpoint reads its own small
 * form. Allowed: one upsert of the connection's row.
 * Refused for the day or the budget: no write. Answers 429
 * `{ error: 'rate_limited' }` with Retry-After, or the agent_budget answer.
 */
export async function chargeConnection(db: D1Database, c: ChargedConnection, ip: string, now: number): Promise<Response | null> {
  const snapshot = await readSnapshot(db, ip, now);
  let general = 0, reserve = 0, member = 0;
  for (const t of snapshot.tokens) {
    general += t.general;
    reserve += t.reserve;
    if (t.user_id === c.userId) member += t.general + t.reserve;
  }
  if (member >= LIMITS.MEMBER_PER_DAY) return oauthLimited(secondsLeft(DAY, now));
  let pool: 'general' | 'reserve';
  if (general < LIMITS.AGENT_GENERAL_PER_DAY) pool = 'general';
  else if (reserve < LIMITS.AGENT_RESERVE_PER_DAY && c.social) pool = 'reserve';
  else return agentBudgetSpent(now);

  const mine = snapshot.tokens.find((t) => t.bucket === tokenBucket(c.tokenId, now));
  const perMinute = (mine?.minute === Math.floor(now / MINUTE) ? mine.minute_n : 0) + 1;
  if (perMinute > LIMITS.TOKEN_PER_MINUTE) {
    const counted = await bump(db, bumpToken(db, c, now, { minute: true }));
    if (Math.max(perMinute, counted.minute_n) >= LIMITS.FLOOD_PER_MINUTE) await autoRevoke(db, c.tokenId, 'flood', now);
    return oauthLimited(secondsLeft(MINUTE, now));
  }
  await bump(db, bumpToken(db, c, now, { minute: true, [pool]: 1 }));
  return null;
}

/** Registrations at /oauth/register, per IP (its /64) and for everyone, per UTC day. */
export const REGISTRATIONS_PER_IP = 10;
export const REGISTRATIONS_PER_DAY = 200;
// Day-prefixed like every counter key, so the nightly prune deletes them; 'r'
// and 'g' sort before 't', so readSnapshot's token range never sees them.
const registrationIpBucket = (ip: string, now: number) => `${dayKey(now)}:r:${ip}`;
const registrationsBucket = (now: number) => `${dayKey(now)}:g:registrations`;

/**
 * 429 when this IP has registered REGISTRATIONS_PER_IP clients today, or
 * everyone REGISTRATIONS_PER_DAY; else null. One statement, two rows read by
 * primary key, nothing written.
 */
export async function registrationRefusal(db: D1Database, ip: string, now: number): Promise<Response | null> {
  const rows = (await db.prepare('SELECT bucket, requests FROM agent_counters WHERE bucket IN (?1, ?2)')
    .bind(registrationIpBucket(ip, now), registrationsBucket(now)).all<{ bucket: string; requests: number }>()).results;
  const count = (bucket: string) => rows.find((r) => r.bucket === bucket)?.requests ?? 0;
  if (count(registrationIpBucket(ip, now)) >= REGISTRATIONS_PER_IP || count(registrationsBucket(now)) >= REGISTRATIONS_PER_DAY) {
    return oauthLimited(secondsLeft(DAY, now));
  }
  return null;
}

/**
 * The condition that makes a registration's insert atomic with its cap: this
 * IP is under REGISTRATIONS_PER_IP and the day under REGISTRATIONS_PER_DAY,
 * judged inside the batch. registrationRefusal stays the cheap read that
 * answers first; this closes the gap parallel requests could slip through.
 */
export function registrationGuard(ip: string, now: number): { sql: string; binds: unknown[] } {
  const under = '(SELECT COALESCE(SUM(requests), 0) FROM agent_counters WHERE bucket = ?) < ?';
  return {
    sql: `${under} AND ${under}`,
    binds: [registrationIpBucket(ip, now), REGISTRATIONS_PER_IP, registrationsBucket(now), REGISTRATIONS_PER_DAY],
  };
}

/**
 * The two counter upserts of an allowed registration, to batch with the client's insert (three rows in all).
 * With `afterGuardedInsert` each counts only if the statement before it
 * changed a row (the guarded insert, then the first upsert), so a refused
 * registration bumps nothing.
 */
export function registrationBumps(db: D1Database, ip: string, now: number, afterGuardedInsert = false): D1PreparedStatement[] {
  const upsert = afterGuardedInsert
    ? 'INSERT INTO agent_counters (bucket, requests) SELECT ?, 1 WHERE changes() > 0 ON CONFLICT(bucket) DO UPDATE SET requests = requests + 1'
    : 'INSERT INTO agent_counters (bucket, requests) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET requests = requests + 1';
  return [db.prepare(upsert).bind(registrationIpBucket(ip, now)), db.prepare(upsert).bind(registrationsBucket(now))];
}
