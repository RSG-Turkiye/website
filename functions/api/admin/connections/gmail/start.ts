import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { gmailAuthUrl } from '../../../../_lib/gmail-oauth';
import { appendAudit } from '../../../../_lib/audit';

/** A link in the Connections pane, not a fetch: the browser navigates here and on to Google. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  const state = await createState(env.DB, 'gmail', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'gmail' }, now);
  return redirectResponse(gmailAuthUrl(env, getBaseUrl(request), state));
};
