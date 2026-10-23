import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse, hasSignedInMarker, signedInMarker, clearSignedInMarker, SESSION_DURATION } from '../_lib/auth';
import { getCurrentRank } from '../_lib/rank';
import { activeGrants } from '../_lib/role-grants';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);

  if (!user) {
    const res = jsonResponse({ user: null }, 401);
    // A marker that outlived its session would make every page ask again.
    if (hasSignedInMarker(request)) res.headers.append('Set-Cookie', clearSignedInMarker());
    return res;
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

  const rank = await getCurrentRank(user.id, env);

  const achievementBadges = await env.DB.prepare(
    'SELECT badge_code FROM user_achievement_badges WHERE user_id = ?'
  ).bind(user.id).all<{ badge_code: string }>();

  // The header renders from this response, so a missing role_grants table
  // (migration 8i not applied yet) must not take the whole answer down.
  let grants: Awaited<ReturnType<typeof activeGrants>> = [];
  try {
    grants = await activeGrants(env.DB, user.id, Math.floor(Date.now() / 1000));
  } catch (err) {
    console.error('/api/me: activeGrants failed', err);
  }

  const res = jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
      is_announcer: user.is_announcer === 1,
      is_writer: user.is_writer === 1,
      is_sender: user.is_sender === 1,
      is_symposium: user.is_symposium === 1,
      is_social: user.is_social === 1,
      is_social_publisher: user.is_social_publisher === 1,
      grants,
    },
    profile: profile ?? null,
    badges: badges.results.map(b => b.badge),
    interests: interests.results.map(i => i.interest),
    rank: rank?.rank ?? 'seed',
    achievement_badges: achievementBadges.results.map(b => b.badge_code),
  });
  // Sessions from before the marker existed get it here, on their next page.
  if (!hasSignedInMarker(request)) {
    res.headers.append('Set-Cookie', signedInMarker(new Date(Date.now() + SESSION_DURATION * 1000)));
  }
  return res;
};
