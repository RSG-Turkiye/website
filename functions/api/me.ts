import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse } from '../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);

  if (!user) {
    return jsonResponse({ user: null }, 401);
  }

  const profile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  const badges = await env.DB.prepare(
    'SELECT badge FROM user_badges WHERE user_id = ?'
  ).bind(user.id).all<{ badge: string }>();

  const interests = await env.DB.prepare(
    'SELECT interest FROM user_interests WHERE user_id = ?'
  ).bind(user.id).all<{ interest: string }>();

  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
    },
    profile: profile ?? null,
    badges: badges.results.map(b => b.badge),
    interests: interests.results.map(i => i.interest),
  });
};
