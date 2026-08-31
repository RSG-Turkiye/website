import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { parseRecipients } from '../../_lib/mail';

/**
 * users.is_sender is the authority for "may this user send"; sender_grants is
 * the record of how they came to be allowed. Both are written together, here,
 * so no caller can set one without the other.
 */
export async function grantSender(
  env: Env,
  userId: string,
  team: string | null,
  grantedBy: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET is_sender = 1 WHERE id = ?').bind(userId),
    env.DB.prepare(
      'INSERT INTO sender_grants (id, user_id, team, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(generateId(), userId, team, grantedBy, now),
  ]);
}

export async function revokeSender(env: Env, userId: string, revokedBy: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET is_sender = 0 WHERE id = ?').bind(userId),
    env.DB.prepare(
      `UPDATE sender_grants SET revoked_by = ?, revoked_at = ?
       WHERE id = (
         SELECT id FROM sender_grants
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY granted_at DESC LIMIT 1
       )`
    ).bind(revokedBy, now, userId),
  ]);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, p.display_name, g.team, g.granted_at,
            gb.email AS granted_by_email
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN sender_grants g
       ON g.id = (SELECT id FROM sender_grants s
                  WHERE s.user_id = u.id AND s.revoked_at IS NULL
                  ORDER BY s.granted_at DESC LIMIT 1)
     LEFT JOIN users gb ON gb.id = g.granted_by
     WHERE u.is_sender = 1
     ORDER BY g.granted_at DESC`
  ).all();

  return jsonResponse({ senders: result.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{ emails: string; team?: string }>();
  const emails = parseRecipients(body.emails ?? '');
  if (emails.length === 0) return jsonResponse({ error: 'No emails given', code: 'no_emails' }, 400);
  if (emails.length > 200) return jsonResponse({ error: 'Too many emails', code: 'too_many_emails' }, 400);

  const team = body.team?.trim() || null;
  const granted: string[] = [];
  const unknown: string[] = [];

  for (const email of emails) {
    const row = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .bind(email).first<{ id: string }>();
    if (!row) {
      unknown.push(email);
      continue;
    }
    await grantSender(env, row.id, team, user.id);
    granted.push(email);
  }

  // `unknown` is the point of this endpoint's response shape: silently
  // dropping the three people who typed their address differently is the
  // failure mode worth designing against.
  return jsonResponse({ ok: true, granted, unknown });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{ user_id: string; action: 'revoke' }>();
  if (!body.user_id || body.action !== 'revoke') {
    return jsonResponse({ error: 'Unknown action' }, 400);
  }

  await revokeSender(env, body.user_id, user.id);
  return jsonResponse({ ok: true });
};
