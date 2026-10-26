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
