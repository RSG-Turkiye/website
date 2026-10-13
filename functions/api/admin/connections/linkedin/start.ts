import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { appendAudit } from '../../../../_lib/audit';
import { linkedinAuthUrl } from '../../../../_lib/social/linkedin';

/** "Connect LinkedIn": admin only, a one-use state, then LinkedIn's consent screen. The member must administer the RSG Page. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET || !env.LINKEDIN_ORGANIZATION || !env.TOKEN_ENC_KEY) {
    return redirectResponse(`${getBaseUrl(request)}${returnTo}?connection_error=not_configured`);
  }
  const state = await createState(env.DB, 'linkedin', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'linkedin' }, now);
  return redirectResponse(linkedinAuthUrl(env, getBaseUrl(request), state));
};
