import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== 'string' || id === '') {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  const isAdmin = user.is_admin === 1;

  // Ownership lives in the predicate: an admin's query has no owner clause, a
  // member's does. Knowing a thread id is never authorisation on its own.
  const thread = isAdmin
    ? await env.DB.prepare(
        `SELECT t.id, t.sender_user_id, t.recipient_email, t.recipient_name, t.subject,
                u.email AS sender_email
         FROM mail_threads t JOIN users u ON u.id = t.sender_user_id
         WHERE t.id = ?`
      ).bind(id).first<ThreadRecord>()
    : await env.DB.prepare(
        `SELECT t.id, t.sender_user_id, t.recipient_email, t.recipient_name, t.subject,
                u.email AS sender_email
         FROM mail_threads t JOIN users u ON u.id = t.sender_user_id
         WHERE t.id = ? AND t.sender_user_id = ?`
      ).bind(id, user.id).first<ThreadRecord>();

  if (!thread) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const messages = await env.DB.prepare(
    `SELECT id, direction, from_email, from_name, subject, body_text,
            attachment_count, sent_at
     FROM mail_messages
     WHERE thread_id = ?
     ORDER BY sent_at ASC, id ASC`
  ).bind(id).all();

  // Only the owner opening their own thread clears the flag. An admin reading
  // it must not mark it read for the member who has not seen it yet.
  if (thread.sender_user_id === user.id) {
    await env.DB.prepare(
      'UPDATE mail_threads SET unread = 0, updated_at = ? WHERE id = ? AND sender_user_id = ?'
    ).bind(Math.floor(Date.now() / 1000), id, user.id).run();
  }

  return jsonResponse({
    thread: {
      id: thread.id,
      recipient_email: thread.recipient_email,
      recipient_name: thread.recipient_name,
      subject: thread.subject,
      sender_email: thread.sender_email,
      can_reply: thread.sender_user_id === user.id,
    },
    messages: messages.results,
  });
};

interface ThreadRecord {
  id: string;
  sender_user_id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  sender_email: string;
}
