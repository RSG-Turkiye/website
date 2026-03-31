import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ params, env }) => {
  const username = (params.username as string)?.toLowerCase();
  if (!username) return jsonResponse({ error: 'Not found' }, 404);

  const profile = await env.DB.prepare(`
    SELECT
      p.username, p.display_name, p.avatar_url, p.institution, p.bio, p.is_public,
      u.is_member,
      (SELECT GROUP_CONCAT(ub.badge) FROM user_badges ub WHERE ub.user_id = p.user_id) AS badges_raw,
      (SELECT GROUP_CONCAT(ui.interest) FROM user_interests ui WHERE ui.user_id = p.user_id) AS interests_raw
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    WHERE p.username = ? AND p.is_public = 1
  `).bind(username).first<{
    username: string;
    display_name: string;
    avatar_url: string | null;
    institution: string | null;
    bio: string | null;
    is_public: number;
    is_member: number;
    badges_raw: string | null;
    interests_raw: string | null;
  }>();

  if (!profile) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({
    member: {
      username: profile.username,
      display_name: profile.display_name,
      avatar_url: profile.avatar_url,
      institution: profile.institution,
      bio: profile.bio,
      is_member: profile.is_member === 1,
      badges: profile.badges_raw ? profile.badges_raw.split(',') : [],
      interests: profile.interests_raw ? profile.interests_raw.split(',') : [],
    }
  });
};
