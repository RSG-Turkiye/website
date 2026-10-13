import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { appendAudit } from '../../../../_lib/audit';
import { instagramAuthUrl } from '../../../../_lib/social/instagram';

/** "Connect Instagram": admin only, a one-use state, then Instagram's own consent screen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET || !env.TOKEN_ENC_KEY) {
    return redirectResponse(`${getBaseUrl(request)}${returnTo}?connection_error=not_configured`);
  }
  const state = await createState(env.DB, 'instagram', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'instagram' }, now);
  return redirectResponse(instagramAuthUrl(env, getBaseUrl(request), state));
};
