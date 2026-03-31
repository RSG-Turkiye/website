import type { Env } from '../_lib/auth';
import { getBaseUrl, redirectResponse } from '../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const redirectUri = `${base}/auth/callback`;

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });

  return redirectResponse(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
};
