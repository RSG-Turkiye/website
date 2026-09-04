import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { validateCompose, checkRateLimit } from '../../_lib/mail';
import { resolveAttachments, sendAndLog, type ComposeInput } from '../../_lib/compose';
import { validateScheduledAt } from '../../_lib/schedule';
import { costOf } from '../../_lib/mail-queue';

interface ComposeBody {
  to: string;
  subject: string;
  body: string;
  attachment_ids?: string[];
  scheduled_at?: number;
}

/**
 * What one request may spend before the work is handed to the queue instead.
 *
 * Lower than the dispatcher's own budget on purpose: this runs while somebody
 * is waiting for the response, and a request that dies here leaves a
 * half-finished mail-out with no row to retry and no record of who was
 * reached.
 */
const INLINE_BUDGET = 8 * 1024 * 1024;

/** Sizes for the attachments named, so the cost can be worked out up front. */
async function attachmentSizes(env: Env, ids: string[]): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await env.DB.prepare(
    `SELECT id, size_bytes FROM mail_attachments WHERE id IN (${ids.map(() => '?').join(',')})`
  ).bind(...ids).all<{ id: string; size_bytes: number }>();
  return new Map(rows.results.map((r) => [r.id, r.size_bytes]));
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const input = parsed as ComposeBody;

  // request.json<T>()'s generic is compile-time only -- it does not check
  // that the caller actually sent strings. Reject the wrong shape here, with
  // a coded 400, before any of it reaches validateCompose/parseRecipients,
  // which assume strings and throw (uncaught) on anything else.
  if (
    typeof input.to !== 'string' ||
    typeof input.subject !== 'string' ||
    typeof input.body !== 'string' ||
    (input.attachment_ids !== undefined &&
      (!Array.isArray(input.attachment_ids) ||
        !input.attachment_ids.every((id) => typeof id === 'string')))
  ) {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const validation = validateCompose({
    to: input.to,
    subject: input.subject,
    body: input.body,
  });
  if (!validation.ok) return jsonResponse({ error: 'Invalid compose', code: validation.code }, 400);
  const recipients = validation.recipients;

  // Queue instead of sending. The rate limit is deliberately NOT consumed
  // here: it is checked when the message actually goes out, so one member
  // cannot queue a hundred messages and lock the shared quota in advance.
  if (input.scheduled_at !== undefined) {
    const when = validateScheduledAt(input.scheduled_at, Math.floor(Date.now() / 1000));
    if (!when.ok) return jsonResponse({ error: 'Invalid schedule time', code: when.code }, 400);

    const attachmentIds = Array.isArray(input.attachment_ids)
      ? [...new Set(input.attachment_ids)]
      : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const id = generateId();

    await env.DB.prepare(
      `INSERT INTO scheduled_emails
        (id, sender_user_id, recipients, subject, body,
         attachment_ids, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      JSON.stringify(recipients),
      input.subject.trim(),
      input.body.trim(),
      JSON.stringify(attachmentIds),
      when.scheduledAt,
      nowSec,
      nowSec,
    ).run();

    return jsonResponse({ ok: true, scheduled: true, id }, 201);
  }

  const now = Math.floor(Date.now() / 1000);

  // Checked before anything is sent, and a rejection writes no sent_emails
  // row -- logging a blocked attempt would corrupt the count that blocked it.
  const limit = await checkRateLimit(env.DB, user.id, recipients.length, now);
  if (!limit.ok) return jsonResponse({ error: 'Rate limit exceeded', code: limit.code }, 429);

  const attachmentIds = Array.isArray(input.attachment_ids)
    ? [...new Set(input.attachment_ids)]
    : [];

  // What this send would cost in one request, before committing to doing it
  // in one request. The queue learned this the hard way on 2026-09-04: a
  // 9 MB attachment costs several times its size per recipient, and enough of
  // them together get the invocation killed with no way to tell which
  // recipients were reached. Here that would be worse than in the queue --
  // there is no row to retry, so the sender gets an error and a half-finished
  // mail-out they cannot safely repeat.
  const sizes = await attachmentSizes(env, attachmentIds);
  const cost = costOf(attachmentIds, recipients.length, (id) => sizes.get(id) ?? 0);
  if (cost > INLINE_BUDGET) {
    const id = generateId();
    const nowSec = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `INSERT INTO scheduled_emails
        (id, sender_user_id, recipients, subject, body,
         attachment_ids, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      JSON.stringify(recipients),
      input.subject.trim(),
      input.body.trim(),
      JSON.stringify(attachmentIds),
      nowSec,
      nowSec,
      nowSec,
    ).run();
    // Due immediately, so the next cron tick starts on it. The sender is told
    // it is going rather than told it failed.
    return jsonResponse({ ok: true, queued: true, id, code: 'too_large_to_send_inline' }, 202);
  }

  const resolved = await resolveAttachments(env, attachmentIds);
  if (!resolved.ok) {
    return jsonResponse({ error: 'Attachment problem', code: resolved.code }, 400);
  }

  const composeInput: ComposeInput = {
    senderUserId: user.id,
    recipients,
    subject: input.subject.trim(),
    body: input.body.trim(),
    attachmentIds,
  };

  const results = await sendAndLog(env, composeInput, resolved.attachments);
  const anySent = results.some(r => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
