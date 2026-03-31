import type { Env } from '../_lib/auth';
import { getSessionUser, clearSessionCookie, redirectResponse, getBaseUrl } from '../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const user = await getSessionUser(request, env);

  if (user) {
    // Delete all sessions for this user
    await env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ?'
    ).bind(user.id).run();
  }

  return redirectResponse(`${base}/`, {
    'Set-Cookie': clearSessionCookie(),
  });
};
