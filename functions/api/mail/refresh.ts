import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { runSync } from './sync';

/**
 * The page-driven half of the sync.
 *
 * The cron Worker runs every five minutes; this is what makes opening the page
 * feel immediate. It is throttled globally rather than per member, because the
 * thing being protected is one shared Gmail quota, not one member's patience.
 */
const MIN_REFRESH_SECONDS = 60;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const state = await env.DB.prepare(
    'SELECT last_synced_at FROM mail_sync_state WHERE id = 1'
  ).first<{ last_synced_at: number | null }>();

  const last = state?.last_synced_at ?? null;
  if (last !== null && now - last < MIN_REFRESH_SECONDS) {
    // Two members opening the page in the same minute is the normal case, not
    // an abuse to punish: answer 200 and let them read the cache.
    return jsonResponse({ ok: true, skipped: true, retryAfter: MIN_REFRESH_SECONDS - (now - last) });
  }

  // Stamp the attempt before delegating, not after. runSync writes this column
  // on every path it completes, but a sync that throws early -- a revoked
  // scope, a mailbox that is not reachable -- would leave it NULL forever, and
  // every page load would then hit Gmail unthrottled. The throttle guards a
  // shared quota, so it has to count attempts, not successes.
  await env.DB.prepare(
    'UPDATE mail_sync_state SET last_synced_at = ? WHERE id = 1'
  ).bind(now).run();

  return runSync(env, new URL(request.url).origin);
};
