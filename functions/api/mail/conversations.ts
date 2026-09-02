import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';
import { snippet } from '../../_lib/conversations';

interface ThreadRow {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  last_message_at: number;
  last_direction: string;
  unread: number;
  last_body: string | null;
  sender_email?: string;
  sender_name?: string | null;
}

function present(rows: ThreadRow[]) {
  return rows.map(({ last_body, ...rest }) => ({
    ...rest,
    snippet: snippet(last_body ?? ''),
  }));
}

// The newest message's text, for the list preview. A correlated subquery keeps
// this to one round trip; joining mail_messages and filtering afterwards would
// pull every message of every thread across the wire to show 140 characters.
const LAST_BODY = `(SELECT m.body_text FROM mail_messages m
                     WHERE m.thread_id = t.id
                     ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_body`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('scope') === 'all' && user.is_admin === 1;

  // The account page wants only the badge number; sending it 300 threads to
  // count them client-side would make every profile view expensive.
  if (url.searchParams.get('only') === 'count') {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM mail_threads WHERE sender_user_id = ? AND unread = 1'
    ).bind(user.id).first<{ n: number }>();
    return jsonResponse({ unreadCount: row?.n ?? 0 });
  }

  const rows = wantsAll
    ? await env.DB.prepare(
        `SELECT t.id, t.recipient_email, t.recipient_name, t.subject,
                t.last_message_at, t.last_direction, t.unread,
                u.email AS sender_email, p.display_name AS sender_name,
                ${LAST_BODY}
         FROM mail_threads t
         JOIN users u ON u.id = t.sender_user_id
         LEFT JOIN profiles p ON p.user_id = t.sender_user_id
         ORDER BY t.last_message_at DESC
         LIMIT 300`
      ).all<ThreadRow>()
    : await env.DB.prepare(
        `SELECT t.id, t.recipient_email, t.recipient_name, t.subject,
                t.last_message_at, t.last_direction, t.unread,
                ${LAST_BODY}
         FROM mail_threads t
         WHERE t.sender_user_id = ?
         ORDER BY t.last_message_at DESC
         LIMIT 300`
      ).bind(user.id).all<ThreadRow>();

  const unread = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mail_threads WHERE sender_user_id = ? AND unread = 1'
  ).bind(user.id).first<{ n: number }>();

  return jsonResponse({
    threads: present(rows.results),
    // Always the caller's own unread count, even in the admin-wide view: it is
    // the number on their own badge, and it should not change meaning because
    // they toggled a filter.
    unreadCount: unread?.n ?? 0,
    scope: wantsAll ? 'all' : 'own',
    isAdmin: user.is_admin === 1,
  });
};
