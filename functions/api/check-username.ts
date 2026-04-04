import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse } from '../_lib/auth';

const RESERVED = ['admin', 'api', 'auth', 'account', 'login', 'logout', 'members', 'profile', 'settings', 'setup'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ available: false }, 401);

  const url = new URL(request.url);
  const username = url.searchParams.get('username')?.toLowerCase().trim();

  if (!username || username.length < 3 || username.length > 30 || !/^[a-z0-9_-]+$/.test(username)) {
    return jsonResponse({ available: false });
  }

  if (RESERVED.includes(username)) {
    return jsonResponse({ available: false });
  }

  const existing = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE username = ?'
  ).bind(username).first();

  return jsonResponse({ available: !existing });
};
