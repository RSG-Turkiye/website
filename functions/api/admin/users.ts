import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { isRank, awardRank, MANUAL_REASON } from '../../_lib/rank';
import { runWithAudit, appendAudit } from '../../_lib/audit';
import { grantSender, revokeSender } from './senders';
import { grantRole, revokeRole, requestedExpiry, activeGrants, activeGrantsFor, LIVE } from '../../_lib/role-grants';
import { ROLES, roleDef, grantableBy, type RoleDef } from '../../_lib/roles';

/** Roles with no is_* column: only role_grants knows who holds them. */
const GRANT_ONLY = ROLES.filter((r) => !r.column).map((r) => r.key);
const inList = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/**
 * What an approver who is not an admin sees: just enough for the Roles view
 * to show and change the roles they may grant. Holders of those roles, or a
 * search among members (never the whole directory), with id, name, username
 * and those grants, never an e-mail address. The search matches a display
 * name or username, literally (LIKE wildcards escaped), at least three
 * characters, ten people at most; or a whole e-mail address, exactly (any
 * case), which finds that one person without showing the address back.
 */
async function approverList(db: D1Database, url: URL, roles: string[], now: number): Promise<Response> {
  const filter = url.searchParams.get('filter') ?? 'all';
  const search = url.searchParams.get('search')?.trim() ?? '';
  let where: string;
  let binds: (string | number)[];
  let limit = 100;
  if (filter === 'roles') {
    where = `EXISTS (SELECT 1 FROM role_grants WHERE user_id = u.id AND role IN (${inList(roles.length)}) AND ${LIVE})`;
    binds = [...roles, now];
  } else if (filter === 'all' && search) {
    if ([...search].length < 3) return jsonResponse({ error: 'Search too short', code: 'search_too_short' }, 400);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(search)) {
      where = 'u.is_member = 1 AND lower(u.email) = lower(?)';
      binds = [search];
      limit = 1;
    } else {
      where = "u.is_member = 1 AND (p.username LIKE ? ESCAPE '\\' OR p.display_name LIKE ? ESCAPE '\\')";
      const q = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      binds = [q, q];
      limit = 10;
    }
  } else {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  const { results } = await db.prepare(
    `SELECT u.id, p.display_name, p.username FROM users u LEFT JOIN profiles p ON p.user_id = u.id WHERE ${where} ORDER BY u.created_at DESC LIMIT ${limit}`,
  ).bind(...binds).all<{ id: string; display_name: string | null; username: string | null; grants?: unknown }>();
  const grants = await activeGrantsFor(db, results.map((r) => r.id), now);
  for (const r of results) r.grants = (grants.get(r.id) ?? []).filter((g) => roles.includes(g.role));
  return jsonResponse({ users: results, badge_catalog: [] });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  if (!user.is_admin) {
    const grantable = grantableBy((await activeGrants(env.DB, user.id, now)).map((g) => g.role));
    if (grantable.length === 0) return jsonResponse({ error: 'Forbidden' }, 403);
    return approverList(env.DB, url, grantable, now);
  }

  const search = url.searchParams.get('search')?.trim() ?? '';
  const filter = url.searchParams.get('filter') ?? 'all'; // all | members | pending | roles

  let query = `
    SELECT
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.is_writer, u.is_sender, u.is_symposium, u.is_social, u.is_social_publisher, u.created_at, u.last_login,
      p.username, p.display_name, p.institution, p.is_public,
      COALESCE(
        (SELECT rank FROM rank_history rh WHERE rh.user_id = u.id
         ORDER BY computed_at DESC, rowid DESC LIMIT 1),
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
  // Anyone holding a role, for the Roles tab and the "Has a role" filter:
  // filtered here so the 100-row cap below cannot hide a role holder.
  // Content roles have no column, so their holders are found in role_grants.
  if (filter === 'roles') {
    conditions.push(`(u.is_admin=1 OR u.is_announcer=1 OR u.is_writer=1 OR u.is_sender=1 OR u.is_symposium=1 OR u.is_social=1 OR u.is_social_publisher=1
      OR EXISTS (SELECT 1 FROM role_grants WHERE user_id = u.id AND role IN (${inList(GRANT_ONLY.length)}) AND ${LIVE}))`);
    bindings.push(...GRANT_ONLY, now);
  }

  if (search) {
    conditions.push('(u.email LIKE ? OR p.username LIKE ? OR p.display_name LIKE ?)');
    const s = `%${search}%`;
    bindings.push(s, s, s);
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY u.created_at DESC LIMIT 100';

  const stmt = env.DB.prepare(query);
  const result = await (bindings.length > 0 ? stmt.bind(...bindings) : stmt).all();

  // The Roles tab shows when each grant ends, and content roles, having no
  // column, are known only from grants, so every list carries them. One
  // query per 99 users, not one per user.
  const rows = result.results as { id: string; grants?: unknown }[];
  const grants = await activeGrantsFor(env.DB, rows.map((r) => r.id), now);
  for (const r of rows) r.grants = grants.get(r.id) ?? [];

  const badgeCatalog = await env.DB.prepare(
    'SELECT code, name_en, name_tr FROM achievement_badges ORDER BY name_en'
  ).all();

  return jsonResponse({ users: result.results, badge_catalog: badgeCatalog.results });
};

/**
 * Membership is a flag, not a role: it has no end date and no grant row.
 * Written with its audit row -- see runWithAudit.
 */
const MEMBERSHIP_UPDATES: Record<string, { sql: string; value: 0 | 1 }> = {
  verify:   { sql: 'UPDATE users SET is_member = 1 WHERE id = ?', value: 1 },
  unverify: { sql: 'UPDATE users SET is_member = 0 WHERE id = ?', value: 0 },
};

/**
 * make_<role> and remove_<role> for every role in the catalog. They go
 * through grantRole and revokeRole, which also rewrite the users.is_*
 * columns, so nothing here sets a column by hand: a direct write would be
 * undone by the next resync. Publisher implies editor in both directions:
 * granting publisher grants both, removing editor removes both.
 */
function roleAction(action: string): { op: 'make' | 'remove'; def: RoleDef } | null {
  const m = /^(make|remove)_(.+)$/.exec(action);
  const def = m ? roleDef(m[2]) : null;
  return m && def ? { op: m[1] as 'make' | 'remove', def } : null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  const isAdmin = user.is_admin === 1;

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const body = parsed as {
    user_id?: unknown;
    action?: unknown;
    value?: unknown;
    duration?: unknown;
  };

  // request.json<T>()'s generic is compile-time only -- it does not check
  // that the caller actually sent strings. Reject the wrong shape here, with
  // a coded 400, before body.value?.trim() and the string-keyed switch below
  // run on non-strings and throw (uncaught).
  if (
    typeof body.user_id !== 'string' ||
    typeof body.action !== 'string' ||
    (body.value !== undefined && typeof body.value !== 'string')
  ) {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  if (!body.user_id || !body.action) {
    return jsonResponse({ error: 'Missing user_id or action' }, 400);
  }

  // A non-admin may only make_ or remove_ a role they are the approver of
  // (an Etkinlikler approver and Etkinlikler edit, say). Everything else is
  // an admin's. requestedExpiry below still bounds what they may grant.
  const role = roleAction(body.action);
  if (!isAdmin) {
    const live = (await activeGrants(env.DB, user.id, Math.floor(Date.now() / 1000))).map((g) => g.role);
    if (!role || !grantableBy(live).includes(role.def.key)) return jsonResponse({ error: 'Forbidden', code: 'not_allowed' }, 403);
  }

  // Prevent self-demotion
  if ((body.action === 'remove_admin') && body.user_id === user.id) {
    return jsonResponse({ error: 'Cannot remove your own admin status' }, 400);
  }

  // Own keys only: "constructor" or "__proto__" must fall through to Unknown action.
  const membership = Object.hasOwn(MEMBERSHIP_UPDATES, body.action) ? MEMBERSHIP_UPDATES[body.action] : undefined;
  let target: { email: string } | null = null;
  if (membership || role) {
    target = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(body.user_id).first<{ email: string }>();
    if (!target) return jsonResponse({ error: 'Unknown user' }, 404);
  }
  if (membership) {
    await runWithAudit(env.DB, [env.DB.prepare(membership.sql).bind(body.user_id)], {
      userId: user.id, action: 'role.change', targetType: 'user', targetId: body.user_id,
      details: { role: 'is_member', value: membership.value, email: target!.email },
    });
    return jsonResponse({ ok: true });
  }
  if (role) {
    // role.grant and role.revoke rows are written by grantRole and revokeRole.
    const now = Math.floor(Date.now() / 1000);
    if (role.op === 'remove') {
      if (role.def.key === 'sender') await revokeSender(env, body.user_id, user.id);
      else await revokeRole(env.DB, { userId: body.user_id, role: role.def.key, by: user.id }, now);
      return jsonResponse({ ok: true });
    }
    const expiry = await requestedExpiry(env.DB, role.def, body.duration, now, { id: user.id, isAdmin });
    if (!expiry.ok) return jsonResponse({ error: 'Invalid duration', code: expiry.code }, 400);
    if (role.def.key === 'sender') {
      await grantSender(env, body.user_id, body.value?.trim() || null, user.id, expiry.expiresAt, now);
    } else {
      await grantRole(env.DB, { userId: body.user_id, role: role.def.key, expiresAt: expiry.expiresAt, by: user.id }, now);
    }
    return jsonResponse({ ok: true });
  }

  switch (body.action) {
    case 'make_private':
      await env.DB.prepare('UPDATE profiles SET is_public = 0 WHERE user_id = ?').bind(body.user_id).run();
      break;
    case 'clear_bio':
      await env.DB.prepare('UPDATE profiles SET bio = NULL WHERE user_id = ?').bind(body.user_id).run();
      break;
    case 'set_rank': {
      // isRank, not `in`: `in` walks the prototype chain, so "toString" was a
      // valid rank and its ordinal was a function.
      if (!isRank(body.value)) return jsonResponse({ error: 'Invalid rank' }, 400);
      await awardRank(body.user_id, body.value, MANUAL_REASON, env);
      break;
    }
    case 'award_badge': {
      if (!body.value) return jsonResponse({ error: 'Missing badge code' }, 400);
      // badge_code is a foreign key. Without this, a code that is not in
      // achievement_badges -- a typo, a badge that was removed -- came back
      // as a 500 from the constraint, telling the admin nothing about what
      // they got wrong.
      const known = await env.DB.prepare(
        'SELECT 1 FROM achievement_badges WHERE code = ?'
      ).bind(body.value).first();
      if (!known) return jsonResponse({ error: `Unknown badge code: ${body.value}` }, 400);
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

  await appendAudit(env.DB, {
    userId: user.id, action: `user.${body.action}`, targetType: 'user', targetId: body.user_id,
    details: { value: body.value ?? null },
  });
  return jsonResponse({ ok: true });
};
