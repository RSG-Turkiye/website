import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const filter = url.searchParams.get('filter') ?? 'all'; // all | members | pending

  let query = `
    SELECT
      u.id, u.email, u.is_member, u.is_admin, u.created_at, u.last_login,
      p.username, p.display_name, p.institution, p.is_public
    FROM users u
    LEFT JOIN profiles p ON p.user_id = u.id
  `;

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (filter === 'members') conditions.push('u.is_member = 1');
  if (filter === 'pending') conditions.push('u.is_member = 0');

  if (search) {
    conditions.push('(u.email LIKE ? OR p.username LIKE ? OR p.display_name LIKE ?)');
    const s = `%${search}%`;
    bindings.push(s, s, s);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY u.created_at DESC LIMIT 100';

  const stmt = env.DB.prepare(query);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all();

  return jsonResponse({ users: result.results });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{
    user_id: string;
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_private' | 'clear_bio';
  }>();

  if (!body.user_id || !body.action) {
    return jsonResponse({ error: 'Missing user_id or action' }, 400);
  }

  // Prevent self-demotion
  if ((body.action === 'remove_admin') && body.user_id === user.id) {
    return jsonResponse({ error: 'Cannot remove your own admin status' }, 400);
  }

  switch (body.action) {
    case 'verify':
      await env.DB.prepare('UPDATE users SET is_member = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'unverify':
      await env.DB.prepare('UPDATE users SET is_member = 0 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'make_admin':
      await env.DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_admin':
      await env.DB.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'make_private':
      await env.DB.prepare('UPDATE profiles SET is_public = 0 WHERE user_id = ?').bind(body.user_id).run();
      break;
    case 'clear_bio':
      await env.DB.prepare('UPDATE profiles SET bio = NULL WHERE user_id = ?').bind(body.user_id).run();
      break;
    default:
      return jsonResponse({ error: 'Unknown action' }, 400);
  }

  return jsonResponse({ ok: true });
};
