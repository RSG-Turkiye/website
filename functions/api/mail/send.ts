import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { validateCompose, checkRateLimit } from '../../_lib/mail';
import { resolveAttachments, sendAndLog, type ComposeInput } from '../../_lib/compose';

interface ComposeBody {
  to: string;
  recipient_name?: string;
  subject: string;
  body: string;
  attachment_ids?: string[];
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
    (input.recipient_name !== undefined && typeof input.recipient_name !== 'string') ||
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

  const now = Math.floor(Date.now() / 1000);

  // Checked before anything is sent, and a rejection writes no sent_emails
  // row -- logging a blocked attempt would corrupt the count that blocked it.
  const limit = await checkRateLimit(env.DB, user.id, recipients.length, now);
  if (!limit.ok) return jsonResponse({ error: 'Rate limit exceeded', code: limit.code }, 429);

  const attachmentIds = Array.isArray(input.attachment_ids)
    ? [...new Set(input.attachment_ids)]
    : [];

  const resolved = await resolveAttachments(env, attachmentIds);
  if (!resolved.ok) {
    return jsonResponse({ error: 'Attachment problem', code: resolved.code }, 400);
  }

  const composeInput: ComposeInput = {
    senderUserId: user.id,
    recipients,
    recipientName: input.recipient_name?.trim() || null,
    subject: input.subject.trim(),
    body: input.body.trim(),
    attachmentIds,
  };

  const results = await sendAndLog(env, composeInput, resolved.attachments);
  const anySent = results.some(r => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
