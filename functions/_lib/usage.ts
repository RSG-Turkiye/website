/**
 * The free plan's daily limits, measured once an hour by the mail tick.
 *
 * Cloudflare's free plan stops the whole site for the rest of the UTC day when
 * one of three counters runs out: Workers and Pages Functions requests, D1
 * rows read, D1 rows written (CLAUDE.md, "Data and the free tier"). The check
 * reads today's three numbers from Cloudflare's GraphQL Analytics API, keeps
 * them in the one row of usage_state for the admin Overview card, and mails
 * the admins once per metric and threshold per UTC day.
 */
import type { Env } from './auth';
import { runGuardedWithAudit } from './audit';
import { adminEmails, notifyEach } from './social-notify';
import { usageAlertMessage } from './usage-alert';
import { configured, gql, type AnalyticsEnv } from './web-analytics';

/** Per account, reset 00:00 UTC. */
export const FREE_LIMITS = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000 } as const;
export type Metric = keyof typeof FREE_LIMITS;

/** Percent of a limit. A value counts as passed at limit * threshold / 100 exactly. */
export const THRESHOLDS = [70, 90] as const;
export type Threshold = typeof THRESHOLDS[number];

/** A metric whose query failed this hour is null: one wrong name costs one line, not all three. */
export type Usage = Record<Metric, number | null>;
export type Crossing = { metric: Metric; threshold: Threshold; value: number; limit: number };

const METRICS = Object.keys(FREE_LIMITS) as Metric[];

/** 'YYYY-MM-DD' in UTC: the day the limits count, not the day in Türkiye. */
export function utcDay(now: number): string {
  return new Date(now * 1000).toISOString().slice(0, 10);
}

/**
 * Thresholds passed and not yet alerted today. `alerted` holds keys such as
 * 'rowsRead:70'. Ordered by metric as in FREE_LIMITS, then threshold ascending.
 */
export function crossings(usage: Usage, alerted: string[]): Crossing[] {
  const done = new Set(alerted);
  const out: Crossing[] = [];
  for (const metric of METRICS) {
    const limit = FREE_LIMITS[metric];
    const value = usage[metric];
    if (value === null) continue;
    for (const threshold of THRESHOLDS) {
      if (value >= (limit * threshold) / 100 && !done.has(`${metric}:${threshold}`)) out.push({ metric, threshold, value, limit });
    }
  }
  return out;
}

/**
 * Today's numbers, one GraphQL request per dataset. Separate requests, because
 * Cloudflare rejects a whole query for one unknown name: a wrong Pages name
 * must cost only the requests line, never the D1 rows (the metric that caused
 * the 2026-10-18 outage). Each answers with summed groups; the code adds up
 * every group it gets.
 *
 * requests = Workers + Pages Functions: the 100,000 is per account and Pages
 * Functions requests count toward it. Whether Cloudflare also lists Pages
 * Functions under workersInvocationsAdaptive is not documented, so the Workers
 * query groups by scriptName and the card shows the list to admins: if the
 * Pages project is in it, this counts twice (alerts early, never late) and the
 * `pages` query should go (README, "Usage alert").
 *
 * D1 is summed for the whole account, with no database filter, because the
 * free D1 limits are per account.
 *
 * workersInvocationsAdaptive (with datetime filters, as Cloudflare's Workers
 * tutorial) and d1AnalyticsAdaptiveGroups (date_geq/date_leq, as its metrics
 * page) are in Cloudflare's docs; pagesFunctionsInvocationsAdaptiveGroups and
 * its fields come from a schema mirror. A wrong name makes Cloudflare answer
 * with `errors`, which gql throws: that metric reads null and the check says so.
 */
const WORKERS_QUERY = `query ($account: string!, $from: string!, $to: string!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 1000, filter: { datetime_geq: $from, datetime_lt: $to }) { dimensions { scriptName } sum { requests } }
  } }
}`;
const PAGES_QUERY = `query ($account: string!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    pages: pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { requests } }
  } }
}`;
const D1_QUERY = `query ($account: string!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $day, date_leq: $day }) { sum { rowsRead rowsWritten } }
  } }
}`;

type SumGroup = { dimensions?: { scriptName?: unknown } | null; sum?: Record<string, unknown> | null };
type Account = Record<string, SumGroup[] | null | undefined>;
type UsageAnswer = { viewer?: { accounts?: Account[] } };

/**
 * The sum of one field over a dataset's groups. An empty list is a day with no
 * traffic yet (the 00:00 UTC hour) and reads as 0. A dataset missing from the
 * answer, or a group without the field, is an answer this code does not
 * understand: it throws rather than report a zero that would hide real usage.
 */
function total(account: Account, dataset: string, field: string): number {
  const groups = account[dataset];
  if (!Array.isArray(groups)) throw new Error(`no ${dataset} in the answer`);
  let sum = 0;
  for (const g of groups) {
    const v = g?.sum?.[field];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`no ${dataset}.sum.${field} in the answer`);
    sum += v;
  }
  return sum;
}

async function account(env: AnalyticsEnv, query: string, variables: Record<string, string>, fetcher: typeof fetch): Promise<Account> {
  const data = await gql<UsageAnswer>(env, query, { account: env.CF_ACCOUNT_ID, ...variables }, fetcher);
  const a = data.viewer?.accounts?.[0];
  if (!a) throw new Error('no account in the answer');
  return a;
}

/** Worker requests by script, largest first, at most 10: what the card shows admins. */
export type ScriptRequests = { name: string; requests: number }[];

/** What one hour measured. A part that failed is null and has its message in `errors`. */
export type Reading = {
  usage: Usage;
  /** The two halves of `requests`, for the card: which scripts the Workers number counts, and the Pages Functions number. */
  workers: ScriptRequests | null; pages: number | null;
  errors: string[];
};

function byScript(account: Account): ScriptRequests {
  total(account, 'workers', 'requests'); // throws on a shape it does not understand
  const sums = new Map<string, number>();
  for (const g of account.workers!) {
    const name = typeof g.dimensions?.scriptName === 'string' ? g.dimensions.scriptName : '(unknown)';
    sums.set(name, (sums.get(name) ?? 0) + (g.sum!.requests as number));
  }
  return [...sums].map(([name, requests]) => ({ name, requests })).sort((a, b) => b.requests - a.requests).slice(0, 10);
}

/** Never throws: each of the three queries fails on its own and says so in `errors`. */
export async function readUsage(env: AnalyticsEnv, day: string, fetcher: typeof fetch = fetch): Promise<Reading> {
  const next = utcDay(Date.parse(`${day}T00:00:00Z`) / 1000 + 86400);
  const [workers, pages, d1] = await Promise.allSettled([
    account(env, WORKERS_QUERY, { from: `${day}T00:00:00Z`, to: `${next}T00:00:00Z` }, fetcher).then((a) => ({ list: byScript(a), sum: total(a, 'workers', 'requests') })),
    account(env, PAGES_QUERY, { day }, fetcher).then((a) => total(a, 'pages', 'requests')),
    account(env, D1_QUERY, { day }, fetcher).then((a) => ({ read: total(a, 'd1', 'rowsRead'), written: total(a, 'd1', 'rowsWritten') })),
  ]);
  const errors: string[] = [];
  const why = (name: string, r: PromiseRejectedResult) => errors.push(`${name}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
  if (workers.status === 'rejected') why('workers', workers);
  if (pages.status === 'rejected') why('pages', pages);
  if (d1.status === 'rejected') why('d1', d1);
  const w = workers.status === 'fulfilled' ? workers.value : null;
  const p = pages.status === 'fulfilled' ? pages.value : null;
  const d = d1.status === 'fulfilled' ? d1.value : null;
  return {
    // A requests number missing one half would hide real usage: null, not a lower figure.
    usage: { requests: w && p !== null ? w.sum + p : null, rowsRead: d?.read ?? null, rowsWritten: d?.written ?? null },
    workers: w?.list ?? null, pages: p, errors,
  };
}

/** What the card shows admins about the requests number: see USAGE queries above. */
export type Parts = { workers: ScriptRequests | null; pages: number | null };

export type UsageState = {
  checkedAt: number | null; measuredAt: number | null; day: string | null; usage: Usage;
  parts: Parts | null;
  error: string | null; alertDay: string | null; alerted: string[];
};

type StateRow = {
  checked_at: number | null; measured_at: number | null; day: string | null;
  requests: number | null; rows_read: number | null; rows_written: number | null; parts: string | null;
  error: string | null; alert_day: string | null; alerted: string;
};

/** The row as stored, or null when the table (before migration 8m) or the row is missing. One row read. */
async function readRow(db: D1Database): Promise<StateRow | null> {
  try {
    return await db.prepare('SELECT * FROM usage_state WHERE id = 1').first<StateRow>();
  } catch {
    return null;
  }
}

function parseAlerted(raw: string | null | undefined): string[] {
  try {
    const list = JSON.parse(raw ?? '[]');
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

function parseParts(raw: string | null | undefined): Parts | null {
  try {
    const p = JSON.parse(raw ?? 'null');
    return p && typeof p === 'object' ? { workers: Array.isArray(p.workers) ? p.workers : null, pages: typeof p.pages === 'number' ? p.pages : null } : null;
  } catch {
    return null;
  }
}

/** Null when the table or the row is missing. Never throws. */
export async function readUsageState(db: D1Database): Promise<UsageState | null> {
  const r = await readRow(db);
  if (!r) return null;
  return {
    checkedAt: r.checked_at, measuredAt: r.measured_at, day: r.day,
    usage: { requests: r.requests, rowsRead: r.rows_read, rowsWritten: r.rows_written },
    parts: parseParts(r.parts),
    error: r.error, alertDay: r.alert_day, alerted: parseAlerted(r.alerted),
  };
}

/** The panel link in the alert mail: fixed, never taken from the request, which could be a *.pages.dev deployment URL. */
const PANEL_URL = 'https://rsg-turkiye.iscbsc.org/admin#genel';

/**
 * The hourly job, run from the mail tick (functions/api/mail/dispatch.ts).
 *
 * D1 cost. A normal hour: 1 row read (the pre-read of usage_state) + 1 to 2
 * more for the upserts' key lookups, and 1 row written (the measurement), so
 * about 2 reads + 1 write. A failed hour: 1 read + 1 write (the error).
 * An alert hour adds the admins' users rows read, the audit chain head read
 * (1), the claim (1 row written) and the audit insert (the row, idx_audit_at,
 * idx_audit_user and the prev_hash unique index: about 4 written). At most 6
 * alert hours a day (3 metrics x 2 thresholds), so a day costs under 50 reads
 * and 50 writes, plus at most 6 x (admins + 6).
 *
 * The alert is claimed before it is sent. A mail lost to a Gmail failure is
 * not resent: a resend loop is the worse failure, and the panel banner says
 * when Gmail is broken. If D1 refuses the measurement write (writes over the
 * limit), this throws before any mail, so nothing goes out that is not
 * recorded; the dispatch wrapper catches it. A day that jumps from under 70%
 * to the limit of rows written in one hour therefore gets no mail: the card
 * (a failed check) is the signal then (README, "Usage alert").
 *
 * A metric whose query failed is skipped, not read as zero: the others are
 * still stored and alerted on, and the error says which part failed.
 */
export async function checkUsage(
  env: Env & AnalyticsEnv, now: number, fetcher: typeof fetch = fetch,
): Promise<'not_configured' | 'failed' | 'measured' | 'alerted'> {
  if (!configured(env)) return 'not_configured';
  const day = utcDay(now);

  const reading = await readUsage(env, day, fetcher);
  const error = reading.errors.length ? reading.errors.join('; ').slice(0, 200) : null;
  const fresh = reading.usage;
  if (METRICS.every((m) => fresh[m] === null)) {
    // Only checked_at and error: the last good numbers stay for the card.
    await env.DB.prepare(
      'INSERT INTO usage_state (id, checked_at, error) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error',
    ).bind(now, error).run();
    return 'failed';
  }

  const state = await readRow(env.DB);
  // A part that failed keeps today's earlier number, never yesterday's.
  const kept = state?.day === day ? state : null;
  const stored = {
    requests: fresh.requests ?? kept?.requests ?? null,
    rowsRead: fresh.rowsRead ?? kept?.rows_read ?? null,
    rowsWritten: fresh.rowsWritten ?? kept?.rows_written ?? null,
  };
  const parts: Parts = { workers: reading.workers, pages: reading.pages };
  // An upsert, never a plain UPDATE: if the seed row were missing, an UPDATE
  // would match nothing and fail silently every hour. alert_day and alerted
  // are never touched here, or each hour would reset the day's claims.
  await env.DB.prepare(
    `INSERT INTO usage_state (id, checked_at, measured_at, day, requests, rows_read, rows_written, parts, error) VALUES (1, ?1, ?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, measured_at = excluded.measured_at, day = excluded.day,
       requests = excluded.requests, rows_read = excluded.rows_read, rows_written = excluded.rows_written, parts = excluded.parts, error = excluded.error`,
  ).bind(now, day, stored.requests, stored.rowsRead, stored.rowsWritten, JSON.stringify(parts), error).run();

  const oldDay = state?.alert_day ?? null;
  const oldAlerted = state?.alerted ?? '[]';
  const alerted = oldDay === day ? parseAlerted(oldAlerted) : [];
  const list = crossings(fresh, alerted);
  if (list.length === 0) return error ? 'failed' : 'measured';

  const recipients = await adminEmails(env.DB);
  // The guard matches only the state read above, compared as stored, so of
  // two checks racing on the same state only one changes the row and writes
  // the audit row (changes() = 1). It also covers a failed pre-read: readRow
  // then answers null, `alerted` reads as empty and crossings re-proposes
  // pairs already mailed, but the stale (NULL, '[]') matches no row. Do not
  // simplify the guard to WHERE id = 1.
  const claimed = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE usage_state SET alert_day = ?, alerted = ? WHERE id = 1 AND alert_day IS ? AND alerted = ?')
      .bind(day, JSON.stringify([...alerted, ...list.map((c) => `${c.metric}:${c.threshold}`)]), oldDay, oldAlerted),
    { condition: 'changes() = 1', binds: [] },
    [],
    {
      userId: null, action: 'usage.alert', targetType: 'usage', targetId: day,
      details: { alerts: list.map(({ metric, threshold, value, limit }) => ({ metric, threshold, value, limit })), recipients: recipients.length },
    },
    now,
  );
  if (!claimed) return error ? 'failed' : 'measured';

  await notifyEach(env, recipients, usageAlertMessage(list, PANEL_URL));
  return 'alerted';
}
