// The admin Statistics section: counts only, never who. Each figure is asked
// for over a few periods (this month, last month, this year, last year), all
// in Türkiye time, which has no daylight saving: UTC+3 all year.

export const TR_OFFSET = 3 * 3600;

export interface Period { key: string; from: number; to: number }

/** Start of the Türkiye-time month containing `ts`, `delta` months away. */
function monthStart(ts: number, delta = 0): number {
  const d = new Date((ts + TR_OFFSET) * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + delta, 1) / 1000 - TR_OFFSET;
}

function yearStart(year: number): number {
  return Date.UTC(year, 0, 1) / 1000 - TR_OFFSET;
}

export function trYear(ts: number): number {
  return new Date((ts + TR_OFFSET) * 1000).getUTCFullYear();
}

/**
 * The columns of every table. The current year gets this month, last month,
 * this year so far and last year; an earlier year gets itself and the one
 * before, which is what a yearly report compares.
 */
export function periodsFor(year: number, now: number): Period[] {
  if (year === trYear(now)) {
    return [
      { key: 'thisMonth', from: monthStart(now), to: now },
      { key: 'lastMonth', from: monthStart(now, -1), to: monthStart(now) },
      { key: 'thisYear', from: yearStart(year), to: now },
      { key: 'lastYear', from: yearStart(year - 1), to: yearStart(year) },
    ];
  }
  return [
    { key: 'year', from: yearStart(year), to: yearStart(year + 1) },
    { key: 'previousYear', from: yearStart(year - 1), to: yearStart(year) },
  ];
}

/** Counts each timestamp into every period it falls in (from inclusive, to exclusive). */
export function bucket(times: number[], periods: Period[]): number[] {
  return periods.map((p) => times.filter((t) => t >= p.from && t < p.to).length);
}

/** Distinct keys per period, for "how many people" rather than "how many times". */
export function distinctBucket(rows: { key: string; at: number }[], periods: Period[]): number[] {
  return periods.map((p) => new Set(rows.filter((r) => r.at >= p.from && r.at < p.to).map((r) => r.key)).size);
}

/**
 * The learning-path area a progress id belongs to: its first segment, after
 * the "tr-" Turkish pages add. "genomics-explorer-foundations-0" is genomics,
 * "tr-roadmap-2-1" is the roadmap.
 */
export function areaOf(resourceId: string): string {
  return resourceId.replace(/^tr-/, '').split('-')[0] || 'other';
}

export interface Row { key: string; values: number[] }

type Db = D1Database;

async function times(db: Db, sql: string, from: number, ...binds: unknown[]): Promise<number[]> {
  const { results } = await db.prepare(sql).bind(from, ...binds).all<{ at: number }>();
  return results.map((r) => r.at);
}

/** Everything the section shows that lives in D1. One read per table per view. */
export async function d1Stats(db: Db, periods: Period[]) {
  const from = Math.min(...periods.map((p) => p.from));

  const [accounts, members, progress, submitted, reviewed, sent, replies, social, certs, purged] = await Promise.all([
    times(db, 'SELECT created_at AS at FROM users WHERE created_at >= ?', from),
    db.prepare('SELECT COUNT(*) AS accounts, COALESCE(SUM(is_member), 0) AS members FROM users')
      .first<{ accounts: number; members: number }>(),
    db.prepare('SELECT user_id, resource_id, completed_at AS at FROM progress WHERE completed = 1 AND completed_at >= ?')
      .bind(from).all<{ user_id: string; resource_id: string; at: number }>(),
    times(db, 'SELECT created_at AS at FROM blog_submissions WHERE created_at >= ?', from),
    db.prepare("SELECT status, reviewed_at AS at FROM blog_submissions WHERE reviewed_at >= ? AND status IN ('approved', 'rejected')")
      .bind(from).all<{ status: string; at: number }>(),
    times(db, "SELECT sent_at AS at FROM sent_emails WHERE sent_at >= ? AND status = 'sent'", from),
    times(db, "SELECT sent_at AS at FROM mail_messages WHERE sent_at >= ? AND direction = 'in'", from),
    db.prepare("SELECT platform, published_at AS at FROM social_post_targets WHERE status = 'published' AND published_at >= ?")
      .bind(from).all<{ platform: string; at: number }>(),
    // Certificates still stored, per symposium year, counted per person.
    db.prepare(
      `SELECT year, SUM(n) AS certificates, COUNT(*) AS people, SUM(v > 0) AS viewed, SUM(d > 0) AS downloaded FROM (
         SELECT year, email, COUNT(*) AS n, SUM(views) AS v, SUM(downloads) AS d
         FROM symposium_certificates GROUP BY year, email
       ) GROUP BY year`
    ).all<CertYear>(),
    db.prepare('SELECT year, certificates, people, viewed, downloaded FROM certificate_stats').all<CertYear>(),
  ]);

  const done = progress.results;
  const areas = [...new Set(done.map((r) => areaOf(r.resource_id)))].sort();
  const platforms = ['instagram', 'linkedin', 'x'];

  return {
    snapshot: { accounts: members?.accounts ?? 0, members: members?.members ?? 0 },
    membership: [{ key: 'accounts', values: bucket(accounts, periods) }],
    learning: [
      { key: 'learners', values: distinctBucket(done.map((r) => ({ key: r.user_id, at: r.at })), periods) },
      { key: 'completed', values: bucket(done.map((r) => r.at), periods) },
      ...areas.map((area) => ({
        key: `area:${area}`,
        values: bucket(done.filter((r) => areaOf(r.resource_id) === area).map((r) => r.at), periods),
      })),
    ],
    // The old member form's history only (blog_submissions, read only since
    // the form was retired). Posts written in the panel CMS are not counted
    // here: drafts are pruned after 90 days and audit rows after a year, so
    // neither backs a yearly comparison. Published posts are counted from git
    // instead (the Content block's "Blog posts" row, by pubDate).
    submissions: [
      { key: 'submitted', values: bucket(submitted, periods) },
      { key: 'approved', values: bucket(reviewed.results.filter((r) => r.status === 'approved').map((r) => r.at), periods) },
      { key: 'rejected', values: bucket(reviewed.results.filter((r) => r.status === 'rejected').map((r) => r.at), periods) },
    ],
    mail: [
      { key: 'sent', values: bucket(sent, periods) },
      { key: 'replies', values: bucket(replies, periods) },
    ],
    social: platforms.map((platform) => ({
      key: platform,
      values: bucket(social.results.filter((r) => r.platform === platform).map((r) => r.at), periods),
    })),
    certificates: mergeCertYears(certs.results, purged.results),
  };
}

export interface CertYear { year: number; certificates: number; people: number; viewed: number; downloaded: number }

/**
 * One line per symposium year. A year can have both purged and stored
 * certificates (uploads on different days), so the two are added up.
 */
export function mergeCertYears(stored: CertYear[], purged: CertYear[]): CertYear[] {
  const byYear = new Map<number, CertYear>();
  for (const r of [...stored, ...purged]) {
    const prev = byYear.get(r.year);
    byYear.set(r.year, prev ? {
      year: r.year,
      certificates: prev.certificates + r.certificates,
      people: prev.people + r.people,
      viewed: prev.viewed + r.viewed,
      downloaded: prev.downloaded + r.downloaded,
    } : { ...r });
  }
  return [...byYear.values()].sort((a, b) => b.year - a.year);
}
