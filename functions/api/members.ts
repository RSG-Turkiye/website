import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse } from '../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const interest = url.searchParams.get('interest')?.trim() ?? '';
  const badge = url.searchParams.get('badge')?.trim() ?? '';
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '24'), 48);
  const offset = Math.max(parseInt(url.searchParams.get('offset') ?? '0'), 0);

  const conditions: string[] = ['p.is_public = 1'];
  const bindings: (string | number)[] = [];

  if (search) {
    conditions.push('(p.display_name LIKE ? OR p.username LIKE ? OR p.institution LIKE ?)');
    const s = `%${search}%`;
    bindings.push(s, s, s);
  }

  if (interest) {
    conditions.push('EXISTS (SELECT 1 FROM user_interests ui WHERE ui.user_id = p.user_id AND ui.interest = ?)');
    bindings.push(interest);
  }

  if (badge) {
    conditions.push('EXISTS (SELECT 1 FROM user_badges ub WHERE ub.user_id = p.user_id AND ub.badge = ?)');
    bindings.push(badge);
  }

  const where = 'WHERE ' + conditions.join(' AND ');

  const query = `
    SELECT
      p.username, p.display_name, p.avatar_url, p.institution, p.bio,
      u.is_member,
      (SELECT GROUP_CONCAT(ub.badge) FROM user_badges ub WHERE ub.user_id = p.user_id) AS badges_raw,
      (SELECT GROUP_CONCAT(ui.interest) FROM user_interests ui WHERE ui.user_id = p.user_id) AS interests_raw
    FROM profiles p
    JOIN users u ON u.id = p.user_id
    ${where}
    ORDER BY u.is_member DESC, p.updated_at DESC
    LIMIT ? OFFSET ?
  `;

  bindings.push(limit, offset);

  const result = await env.DB.prepare(query).bind(...bindings).all<{
    username: string;
    display_name: string;
    avatar_url: string | null;
    institution: string | null;
    bio: string | null;
    is_member: number;
    badges_raw: string | null;
    interests_raw: string | null;
  }>();

  const members = result.results.map(m => ({
    ...m,
    is_member: m.is_member === 1,
    badges: m.badges_raw ? m.badges_raw.split(',') : [],
    interests: m.interests_raw ? m.interests_raw.split(',') : [],
    badges_raw: undefined,
    interests_raw: undefined,
  }));

  return jsonResponse({ members });
};
