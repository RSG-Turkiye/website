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
      env.DB.prepare('SELECT MAX(started_at) AS t FROM dispatch_runs').first<{ t: number | null }>(),
    ]);
    const issues = healthIssues({ connections, legacyGmail: Boolean(env.GMAIL_REFRESH_TOKEN), lastRunAt: lastRun?.t ?? null, now })
      .map((i) => (i.kind === 'connection' && !canFix ? { ...i, lastError: null } : i));
    return jsonResponse({ issues, canFix });
  } catch (err) {
    console.error('health check failed', err);
    return jsonResponse({ issues: [], canFix });
  }
};
