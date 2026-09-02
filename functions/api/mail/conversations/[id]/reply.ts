import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../../_lib/auth';
import { checkRateLimit, MAX_BODY_LENGTH } from '../../../../_lib/mail';
import { sendAndLog, type ComposeInput } from '../../../../_lib/compose';
import { replySubject, buildReferences, ingestThread } from '../../../../_lib/conversations';

interface ThreadRecord {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== 'string' || id === '') {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const input = parsed as Record<string, unknown>;
  if (typeof input.body !== 'string') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  const body = input.body.trim();
  if (body === '') return jsonResponse({ error: 'Invalid compose', code: 'empty_body' }, 400);
  if (body.length > MAX_BODY_LENGTH) {
    return jsonResponse({ error: 'Invalid compose', code: 'body_too_long' }, 400);
  }

  // Only the member who owns the conversation may answer in it. An admin can
  // read every thread, but writing as someone else's correspondent would make
  // the audit log say something untrue about who spoke.
  const thread = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, subject
     FROM mail_threads WHERE id = ? AND sender_user_id = ?`
  ).bind(id, user.id).first<ThreadRecord>();

  if (!thread) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  const limit = await checkRateLimit(env.DB, user.id, 1, now);
  if (!limit.ok) return jsonResponse({ error: 'Rate limit exceeded', code: limit.code }, 429);

  const history = await env.DB.prepare(
    `SELECT rfc822_message_id, direction FROM mail_messages
     WHERE thread_id = ? ORDER BY sent_at ASC, id ASC`
  ).bind(id).all<{ rfc822_message_id: string | null; direction: string }>();

  const references = buildReferences(history.results.map((row) => row.rfc822_message_id));
  // Reply to the newest message in the thread, whichever side sent it: that is
  // what a mail client does, and it keeps the chain intact when the last word
  // was ours.
  const inReplyTo = references.length > 0 ? references[references.length - 1] : undefined;

  const composeInput: ComposeInput = {
    senderUserId: user.id,
    recipients: [thread.recipient_email],
    recipientName: thread.recipient_name,
    subject: replySubject(thread.subject),
    body,
    attachmentIds: [],
    threadId: thread.id,
    inReplyTo,
    references,
  };

  const results = await sendAndLog(env, composeInput, []);

  // Re-read the thread so the member sees their reply immediately instead of
  // waiting for the next cron tick. Failing here costs nothing permanent: the
  // mail is sent and the next sync fills the gap.
  try {
    await ingestThread(env, thread.id, Math.floor(Date.now() / 1000));
  } catch {
    // Deliberately ignored -- see above.
  }

  const anySent = results.some((r) => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
