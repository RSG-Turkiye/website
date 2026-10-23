import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, canSeeAdminPanel } from '../../_lib/auth';
import { listConnections, withLiveExpiry } from '../../_lib/connections';
import { healthIssues } from '../../_lib/health';

/**
 * What the banner above every admin pane shows. Every panel role but the
 * content roles sees it;
 * only an admin sees the provider's error text and gets the fix button. If
 * the tables are not there yet (deployed before the migration) it answers
 * with no issues rather than a 500 -- a banner that errors is worse than none.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  // Not content editors: the banner is about mail and social connections and
  // the scheduler, which the Etkinlikler panel has nothing to do with. The
  // panel's health fetch fails quietly for them and shows no banner.
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const canFix = user.is_admin === 1;

  try {
    const now = Math.floor(Date.now() / 1000);
    const [connections, lastRun] = await Promise.all([
      listConnections(env.DB),
      lastRuns(env.DB),
    ]);
    const issues = healthIssues({ connections: connections.map((c) => withLiveExpiry(c, env)!), legacyGmail: Boolean(env.GMAIL_REFRESH_TOKEN), lastRunAt: lastRun.mail, lastSocialRunAt: lastRun.social, now })
      .map((i) => (i.kind === 'connection' && !canFix ? { ...i, lastError: null } : i));
    return jsonResponse({ issues, canFix });
  } catch (err) {
    console.error('health check failed', err);
    return jsonResponse({ issues: [], canFix });
  }
};

/** Mail and social ticks separately; before migration 8e there is no kind column, so only mail is measured. */
async function lastRuns(db: D1Database): Promise<{ mail: number | null; social: number | null | undefined }> {
  try {
    const r = await db.prepare(
      // Two subqueries, not MAX(CASE ...): each is one lookup in idx_dispatch_runs_kind_started instead of a table scan.
      `SELECT (SELECT MAX(started_at) FROM dispatch_runs WHERE kind = 'mail') AS mail,
              (SELECT MAX(started_at) FROM dispatch_runs WHERE kind = 'social') AS social`,
    ).first<{ mail: number | null; social: number | null }>();
    return { mail: r?.mail ?? null, social: r?.social ?? null };
  } catch {
    const r = await db.prepare('SELECT MAX(started_at) AS t FROM dispatch_runs').first<{ t: number | null }>();
    return { mail: r?.t ?? null, social: undefined };
  }
}
