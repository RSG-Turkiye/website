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

export type Usage = Record<Metric, number>;
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
    for (const threshold of THRESHOLDS) {
      if (value >= (limit * threshold) / 100 && !done.has(`${metric}:${threshold}`)) out.push({ metric, threshold, value, limit });
    }
  }
  return out;
}

/**
 * Today's three numbers in one GraphQL request, three aliased datasets, each
 * filtered by the UTC date only. No dimensions, so each dataset answers with
 * one summed group; the code still adds up every group it gets.
 *
 * requests = Workers + Pages Functions: the 100,000 is per account and Pages
 * Functions requests count toward it. If Cloudflare also lists Pages
 * Functions under workersInvocationsAdaptive, this counts them twice, which
 * alerts early rather than late (README, "Usage alert").
 *
 * D1 is summed for the whole account, with no database filter, because the
 * free D1 limits are per account.
 *
 * The workersInvocationsAdaptive and d1AnalyticsAdaptiveGroups names are in
 * Cloudflare's docs; pagesFunctionsInvocationsAdaptiveGroups and its fields
 * come from a schema mirror. A wrong name makes Cloudflare answer with
 * `errors`, which gql throws: the check fails and says so, and never mails.
 */
const USAGE_QUERY = `query ($account: string!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 1000, filter: { date: $day }) { sum { requests } }
    pages: pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { requests } }
    d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { rowsRead rowsWritten } }
  } }
}`;

type SumGroup = { sum?: Record<string, unknown> | null };
type UsageAnswer = { viewer?: { accounts?: Record<string, SumGroup[] | null | undefined>[] } };

/**
 * The sum of one field over a dataset's groups. An empty list is a day with no
 * traffic yet (the 00:00 UTC hour) and reads as 0. A dataset missing from the
 * answer, or a group without the field, is an answer this code does not
 * understand: it throws rather than report a zero that would hide real usage.
 */
function total(account: Record<string, SumGroup[] | null | undefined>, dataset: string, field: string): number {
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

/** Throws on an HTTP error, GraphQL `errors`, no account in the answer, or a dataset or field missing from it. */
export async function readUsage(env: AnalyticsEnv, day: string, fetcher: typeof fetch = fetch): Promise<Usage> {
  const data = await gql<UsageAnswer>(env, USAGE_QUERY, { account: env.CF_ACCOUNT_ID, day }, fetcher);
  const account = data.viewer?.accounts?.[0];
  if (!account) throw new Error('no account in the answer');
  return {
    requests: total(account, 'workers', 'requests') + total(account, 'pages', 'requests'),
    rowsRead: total(account, 'd1', 'rowsRead'),
    rowsWritten: total(account, 'd1', 'rowsWritten'),
  };
}

export type UsageState = {
  checkedAt: number | null; measuredAt: number | null; day: string | null; usage: Usage | null;
  error: string | null; alertDay: string | null; alerted: string[];
};

type StateRow = {
  checked_at: number | null; measured_at: number | null; day: string | null;
  requests: number | null; rows_read: number | null; rows_written: number | null;
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

/** Null when the table or the row is missing. Never throws. */
export async function readUsageState(db: D1Database): Promise<UsageState | null> {
  const r = await readRow(db);
  if (!r) return null;
  const measured = r.requests !== null && r.rows_read !== null && r.rows_written !== null;
  return {
    checkedAt: r.checked_at, measuredAt: r.measured_at, day: r.day,
    usage: measured ? { requests: r.requests!, rowsRead: r.rows_read!, rowsWritten: r.rows_written! } : null,
    error: r.error, alertDay: r.alert_day, alerted: parseAlerted(r.alerted),
  };
}

/**
 * The hourly job, run from the mail tick (functions/api/mail/dispatch.ts).
 *
 * D1 cost. A normal hour: 1 row read (usage_state) + 1 row written (the
 * measurement). A failed hour: 1 row written (the error), nothing read. An
 * alert hour adds the admins' users rows read, the audit chain head read (1),
 * the claim (1 row written) and the audit insert (the row, idx_audit_at,
 * idx_audit_user and the prev_hash unique index: about 4 written). At most 6
 * alert hours a day (3 metrics x 2 thresholds), so a day costs under 25 reads
 * and 25 writes, plus at most 6 x (admins + 6).
 *
 * The alert is claimed before it is sent. A mail lost to a Gmail failure is
 * not resent: a resend loop is the worse failure, and the panel banner says
 * when Gmail is broken. If D1 refuses the measurement write (writes over the
 * limit), this throws before any mail, so nothing goes out that is not
 * recorded; the dispatch wrapper catches it.
 */
export async function checkUsage(
  env: Env & AnalyticsEnv, now: number, origin: string, fetcher: typeof fetch = fetch,
): Promise<'not_configured' | 'failed' | 'measured' | 'alerted'> {
  if (!configured(env)) return 'not_configured';
  const day = utcDay(now);

  let usage: Usage;
  try {
    usage = await readUsage(env, day, fetcher);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    // Only checked_at and error: the last good numbers stay for the card.
    await env.DB.prepare(
      'INSERT INTO usage_state (id, checked_at, error) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error',
    ).bind(now, message).run();
    return 'failed';
  }

  const state = await readRow(env.DB);
  // An upsert, never a plain UPDATE: if the seed row were missing, an UPDATE
  // would match nothing and fail silently every hour. alert_day and alerted
  // are never touched here, or each hour would reset the day's claims.
  await env.DB.prepare(
    `INSERT INTO usage_state (id, checked_at, measured_at, day, requests, rows_read, rows_written, error) VALUES (1, ?1, ?1, ?2, ?3, ?4, ?5, NULL)
     ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, measured_at = excluded.measured_at, day = excluded.day,
       requests = excluded.requests, rows_read = excluded.rows_read, rows_written = excluded.rows_written, error = NULL`,
  ).bind(now, day, usage.requests, usage.rowsRead, usage.rowsWritten).run();

  const oldDay = state?.alert_day ?? null;
  const oldAlerted = state?.alerted ?? '[]';
  const alerted = oldDay === day ? parseAlerted(oldAlerted) : [];
  const list = crossings(usage, alerted);
  if (list.length === 0) return 'measured';

  const recipients = await adminEmails(env.DB);
  // The guard matches only the state read above, compared as stored, so of
  // two checks racing on the same state only one changes the row and writes
  // the audit row (changes() = 1).
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
  if (!claimed) return 'measured';

  await notifyEach(env, recipients, usageAlertMessage(list, `${origin}/admin#genel`));
  return 'alerted';
}
