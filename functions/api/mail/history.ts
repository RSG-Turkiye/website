import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);

  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('scope') === 'all';

  // Only an admin may widen the scope. A non-admin asking for everyone's sends
  // silently gets their own -- there is nothing here to warn them about.
  if (wantsAll && user.is_admin === 1) {
    const result = await env.DB.prepare(
      `SELECT s.id, s.recipient_email, s.recipient_name, s.subject, s.status,
              s.error_message, s.sent_at,
              u.email AS sender_email, p.display_name AS sender_name
       FROM sent_emails s
       JOIN users u ON u.id = s.sender_user_id
       LEFT JOIN profiles p ON p.user_id = s.sender_user_id
       ORDER BY s.sent_at DESC
       LIMIT 500`
    ).all();
    return jsonResponse({ sends: result.results });
  }

  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const result = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, subject, status, error_message, sent_at
     FROM sent_emails
     WHERE sender_user_id = ?
     ORDER BY sent_at DESC
     LIMIT 200`
  ).bind(user.id).all();

  return jsonResponse({ sends: result.results });
};
