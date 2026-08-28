import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { RANK_ORDINALS, awardRank, type Rank } from '../../_lib/rank';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const url = new URL(request.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const filter = url.searchParams.get('filter') ?? 'all'; // all | members | pending

  let query = `
    SELECT
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.is_writer, u.created_at, u.last_login,
      p.username, p.display_name, p.institution, p.is_public,
      COALESCE(
        (SELECT rank FROM rank_history rh WHERE rh.user_id = u.id
         ORDER BY rank_ordinal DESC, computed_at DESC LIMIT 1),
        'seed'
      ) as current_rank,
      (SELECT GROUP_CONCAT(badge_code) FROM user_achievement_badges uab
       WHERE uab.user_id = u.id) as badge_codes
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

  const badgeCatalog = await env.DB.prepare(
    'SELECT code, name_en, name_tr FROM achievement_badges ORDER BY name_en'
  ).all();

  return jsonResponse({ users: result.results, badge_catalog: badgeCatalog.results });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{
    user_id: string;
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_announcer' | 'remove_announcer'
      | 'make_writer' | 'remove_writer' | 'make_private' | 'clear_bio' | 'set_rank' | 'award_badge' | 'revoke_badge';
    value?: string;
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
    case 'make_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 0 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'make_writer':
      await env.DB.prepare('UPDATE users SET is_writer = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_writer':
      await env.DB.prepare('UPDATE users SET is_writer = 0 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'make_private':
      await env.DB.prepare('UPDATE profiles SET is_public = 0 WHERE user_id = ?').bind(body.user_id).run();
      break;
    case 'clear_bio':
      await env.DB.prepare('UPDATE profiles SET bio = NULL WHERE user_id = ?').bind(body.user_id).run();
      break;
    case 'set_rank': {
      const rank = body.value as Rank | undefined;
      if (!rank || !(rank in RANK_ORDINALS)) return jsonResponse({ error: 'Invalid rank' }, 400);
      await awardRank(body.user_id, rank, 'admin_manual', env);
      break;
    }
    case 'award_badge': {
      if (!body.value) return jsonResponse({ error: 'Missing badge code' }, 400);
      await env.DB.prepare(
        'INSERT OR IGNORE INTO user_achievement_badges (user_id, badge_code, awarded_at, awarded_by) VALUES (?, ?, ?, ?)'
      ).bind(body.user_id, body.value, Math.floor(Date.now() / 1000), user.id).run();
      break;
    }
    case 'revoke_badge': {
      if (!body.value) return jsonResponse({ error: 'Missing badge code' }, 400);
      await env.DB.prepare(
        'DELETE FROM user_achievement_badges WHERE user_id = ? AND badge_code = ?'
      ).bind(body.user_id, body.value).run();
      break;
    }
    default:
      return jsonResponse({ error: 'Unknown action' }, 400);
  }

  return jsonResponse({ ok: true });
};
