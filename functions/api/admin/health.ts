import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, canSeeAdminPanel } from '../../_lib/auth';
import { listConnections } from '../../_lib/connections';
import { healthIssues } from '../../_lib/health';

/**
 * What the banner above every admin pane shows. Every panel role sees it;
 * only an admin sees the provider's error text and gets the fix button. If
 * the tables are not there yet (deployed before the migration) it answers
 * with no issues rather than a 500 -- a banner that errors is worse than none.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const canFix = user.is_admin === 1;

  try {
    const now = Math.floor(Date.now() / 1000);
    const [connections, lastRun] = await Promise.all([
      listConnections(env.DB),
      lastRuns(env.DB),
    ]);
    const issues = healthIssues({ connections, legacyGmail: Boolean(env.GMAIL_REFRESH_TOKEN), lastRunAt: lastRun.mail, lastSocialRunAt: lastRun.social, now })
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
      `SELECT MAX(CASE WHEN kind = 'mail' THEN started_at END) AS mail, MAX(CASE WHEN kind = 'social' THEN started_at END) AS social FROM dispatch_runs`,
    ).first<{ mail: number | null; social: number | null }>();
    return { mail: r?.mail ?? null, social: r?.social ?? null };
  } catch {
    const r = await db.prepare('SELECT MAX(started_at) AS t FROM dispatch_runs').first<{ t: number | null }>();
    return { mail: r?.t ?? null, social: undefined };
  }
}
