import type { Env } from '../_lib/auth';
import { getSessionUser, clearSessionCookie, clearSignedInMarker, redirectResponse, getBaseUrl, checkCsrf } from '../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  if (!checkCsrf(request, env)) return redirectResponse(`${base}/`);
  const user = await getSessionUser(request, env);

  if (user) {
    // Delete all sessions for this user
    await env.DB.prepare(
      'DELETE FROM sessions WHERE user_id = ?'
    ).bind(user.id).run();
  }

  const res = redirectResponse(`${base}/`, {
    'Set-Cookie': clearSessionCookie(),
  });
  res.headers.append('Set-Cookie', clearSignedInMarker());
  return res;
};
