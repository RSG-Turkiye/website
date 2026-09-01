import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { validateCompose } from '../../_lib/mail';
import { validateScheduledAt } from '../../_lib/schedule';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  // An admin sees every member's queue, matching how the send log already works.
  const result = user.is_admin === 1
    ? await env.DB.prepare(
        `SELECT s.id, s.recipients, s.recipient_name, s.subject, s.body,
                s.attachment_ids, s.scheduled_at, u.email AS sender_email
         FROM scheduled_emails s
         JOIN users u ON u.id = s.sender_user_id
         ORDER BY s.scheduled_at ASC LIMIT 200`
      ).all()
    : await env.DB.prepare(
        `SELECT id, recipients, recipient_name, subject, body,
                attachment_ids, scheduled_at
         FROM scheduled_emails
         WHERE sender_user_id = ?
         ORDER BY scheduled_at ASC LIMIT 200`
      ).bind(user.id).all();

  return jsonResponse({ scheduled: result.results });
};

/** Knowing an id is not authorisation: the row must belong to this member. */
async function ownRow(env: Env, id: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT id FROM scheduled_emails WHERE id = ? AND sender_user_id = ?'
  ).bind(id, userId).first<{ id: string }>();
  return row !== null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const body = parsed as Record<string, unknown>;

  if (typeof body.id !== 'string' || typeof body.to !== 'string'
      || typeof body.subject !== 'string' || typeof body.body !== 'string'
      || (body.recipient_name !== undefined && typeof body.recipient_name !== 'string')) {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  if (!(await ownRow(env, body.id, user.id))) {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  const validation = validateCompose({ to: body.to, subject: body.subject, body: body.body });
  if (!validation.ok) return jsonResponse({ error: 'Invalid compose', code: validation.code }, 400);

  const when = validateScheduledAt(body.scheduled_at, Math.floor(Date.now() / 1000));
  if (!when.ok) return jsonResponse({ error: 'Invalid schedule time', code: when.code }, 400);

  const attachmentIds = Array.isArray(body.attachment_ids)
    ? [...new Set(body.attachment_ids.filter((v): v is string => typeof v === 'string'))]
    : [];

  await env.DB.prepare(
    `UPDATE scheduled_emails
     SET recipients = ?, recipient_name = ?, subject = ?, body = ?,
         attachment_ids = ?, scheduled_at = ?, updated_at = ?
     WHERE id = ? AND sender_user_id = ?`
  ).bind(
    JSON.stringify(validation.recipients),
    (body.recipient_name as string | undefined)?.trim() || null,
    body.subject.trim(),
    body.body.trim(),
    JSON.stringify(attachmentIds),
    when.scheduledAt,
    Math.floor(Date.now() / 1000),
    body.id,
    user.id,
  ).run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.id !== 'string') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  // Cancelling deletes the row: the queue is transient, and a message
  // cancelled before sending was never sent, so it has no place in the log.
  const res = await env.DB.prepare(
    'DELETE FROM scheduled_emails WHERE id = ? AND sender_user_id = ?'
  ).bind(body.id, user.id).run();

  if (res.meta.changes === 0) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  return jsonResponse({ ok: true });
};
