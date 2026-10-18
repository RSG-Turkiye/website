import type { Env } from '../_lib/auth';
import {
  generateId,
  createSession,
  sessionCookie,
  signedInMarker,
  redirectResponse,
  getBaseUrl,
} from '../_lib/auth';
import { awardRank } from '../_lib/rank';
import { readNext, clearNextCookie } from '../_lib/next-path';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const base = getBaseUrl(request);

  if (!code) {
    return redirectResponse(`${base}/?auth_error=no_code`);
  }

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: `${base}/auth/callback`,
      grant_type: 'authorization_code',
    }),
  });

  if (!tokenRes.ok) {
    return redirectResponse(`${base}/?auth_error=token_exchange`);
  }

  let tokens: { access_token: string };
  try {
    tokens = await tokenRes.json<{ access_token: string }>();
  } catch {
    return redirectResponse(`${base}/?auth_error=token_parse`);
  }

  // Get user info from Google
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    return redirectResponse(`${base}/?auth_error=userinfo`);
  }

  let googleUser: { id: string; email: string; name: string; picture: string };
  try {
    googleUser = await userRes.json<{
      id: string;
      email: string;
      name: string;
      picture: string;
    }>();
  } catch {
    return redirectResponse(`${base}/?auth_error=userinfo_parse`);
  }

  const now = Math.floor(Date.now() / 1000);

  // Upsert user
  let user = await env.DB.prepare(
    'SELECT * FROM users WHERE google_id = ?'
  ).bind(googleUser.id).first<{ id: string; email: string }>();

  if (!user) {
    const newId = generateId();
    await env.DB.prepare(
      'INSERT INTO users (id, google_id, email, is_member, is_admin, created_at, last_login) VALUES (?, ?, ?, 0, 0, ?, ?)'
    ).bind(newId, googleUser.id, googleUser.email, now, now).run();
    user = { id: newId, email: googleUser.email };
    await awardRank(newId, 'seed', 'new_member_default', env);

    // Redirect new users to profile setup
    const { token, expires } = await createSession(user.id, env);
    const res = redirectResponse(`${base}/account/setup`, { 'Set-Cookie': sessionCookie(token, expires) });
    res.headers.append('Set-Cookie', clearNextCookie());
    res.headers.append('Set-Cookie', signedInMarker(expires));
    return res;
  }

  // Update last login
  await env.DB.prepare(
    'UPDATE users SET last_login = ? WHERE id = ?'
  ).bind(now, user.id).run();

  // Check if profile exists
  const profile = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  const { token, expires } = await createSession(user.id, env);
  // A new profile is set up first; otherwise back to the page that sent them to sign in.
  const next = profile ? readNext(request) : null;
  const dest = profile ? `${base}${next ?? '/account'}` : `${base}/account/setup`;
  const res = redirectResponse(dest, { 'Set-Cookie': sessionCookie(token, expires) });
  res.headers.append('Set-Cookie', clearNextCookie());
  res.headers.append('Set-Cookie', signedInMarker(expires));
  return res;
};
