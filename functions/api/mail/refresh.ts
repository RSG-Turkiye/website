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

  // Claiming the minute and reading it are one statement.
  //
  // This used to SELECT the timestamp, compare it, and UPDATE it -- three
  // steps with two members' requests able to interleave between them. Both
  // read the same old value, both decided they were allowed, and both called
  // Gmail. The throttle exists to protect one shared quota, so the case it
  // has to survive is exactly the one where two people click at once.
  //
  // The UPDATE stamps the attempt rather than the success: runSync writes this
  // column on every path it completes, but a sync that throws early -- a
  // revoked scope, an unreachable mailbox -- would leave it as it was, and
  // every page load would then hit Gmail unthrottled.
  const claim = await env.DB.prepare(
    `UPDATE mail_sync_state
     SET last_synced_at = ?
     WHERE id = 1 AND (last_synced_at IS NULL OR last_synced_at <= ?)`
  ).bind(now, now - MIN_REFRESH_SECONDS).run();

  if (claim.meta.changes !== 1) {
    // Somebody else has the minute. Two members opening the page together is
    // the normal case, not an abuse to punish: answer 200 and let this one
    // read the cache.
    const state = await env.DB.prepare(
      'SELECT last_synced_at FROM mail_sync_state WHERE id = 1'
    ).first<{ last_synced_at: number | null }>();
    const last = state?.last_synced_at ?? now;
    return jsonResponse({
      ok: true,
      skipped: true,
      retryAfter: Math.max(0, MIN_REFRESH_SECONDS - (now - last)),
    });
  }

  const result = await runSync(env, new URL(request.url).origin);
  // Deliberately not returning runSync's body. It carries operator
  // diagnostics -- `seen` counts every thread Gmail reported changed,
  // including the unrelated mailbox activity this sync discards -- and this
  // endpoint, unlike /api/mail/sync, is reachable by any authorised member.
  // The page reads only the status.
  return jsonResponse({ ok: result.ok }, result.status);
};
