/** Refresh in the DM tab: a poll now, at most every 30 seconds (shared, plan ruling R2). */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish, checkCsrf } from '../../../../_lib/auth';
import { pollDms } from '../../../../_lib/social-dm-poll';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request, env)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  try {
    const s = await pollDms(env, Math.floor(Date.now() / 1000), new URL(request.url).origin, { force: true });
    return jsonResponse({ ok: true, skipped: s.skipped });
  } catch (err) {
    console.error('DM refresh failed', err);
    return jsonResponse({ error: 'Unavailable', code: 'unavailable' }, 503);
  }
};
