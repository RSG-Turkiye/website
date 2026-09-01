import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { buildMime, sendMail, GmailError, encodeAttachmentBody, type MimeAttachment } from '../../_lib/gmail';
import { validateCompose, checkRateLimit, MAX_ATTACHMENT_BYTES } from '../../_lib/mail';

interface ComposeBody {
  to: string;
  recipient_name?: string;
  subject: string;
  body: string;
  attachment_ids?: string[];
}

interface AttachmentRow {
  id: string;
  filename: string;
  r2_key: string;
  content_type: string;
  size_bytes: number;
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

  // Resolve attachments once; the same bytes go to every recipient.
  // De-duplicated so a repeated id cannot trip the count check below and
  // surface as a misleading "unknown attachment" error.
  const attachmentIds = Array.isArray(input.attachment_ids)
    ? [...new Set(input.attachment_ids)]
    : [];
  const attachments: MimeAttachment[] = [];
  if (attachmentIds.length > 0) {
    const placeholders = attachmentIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, filename, r2_key, content_type, size_bytes
       FROM mail_attachments
       WHERE is_active = 1 AND id IN (${placeholders})`
    ).bind(...attachmentIds).all<AttachmentRow>();

    if (rows.results.length !== attachmentIds.length) {
      return jsonResponse({ error: 'Unknown attachment', code: 'unknown_attachment' }, 400);
    }

    const total = rows.results.reduce((sum, r) => sum + r.size_bytes, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ error: 'Attachments too large', code: 'attachments_too_large' }, 400);
    }

    for (const row of rows.results) {
      const object = await env.MAIL_ATTACHMENTS.get(row.r2_key);
      if (!object) return jsonResponse({ error: 'Attachment missing', code: 'unknown_attachment' }, 400);
      // Encode once here, not inside buildMime: buildMime runs once per
      // recipient below, and re-encoding the same bytes for every recipient
      // is both wasted work and, at the attachment size ceiling, a real risk
      // of exhausting the Worker isolate's memory mid-loop.
      attachments.push({
        filename: row.filename,
        contentType: row.content_type,
        base64Body: encodeAttachmentBody(new Uint8Array(await object.arrayBuffer())),
      });
    }
  }

  const attachmentIdsJson = JSON.stringify(attachmentIds);
  const subject = input.subject.trim();
  const body = input.body.trim();
  const recipientName = input.recipient_name?.trim() || null;

  // One Gmail message per recipient: putting ten professors on one To: line
  // would show each of them the entire outreach list.
  const results: Array<{ recipient: string; status: 'sent' | 'failed'; error?: string }> = [];

  for (const recipient of recipients) {
    let gmailId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const raw = buildMime({
        fromAddress: env.RSG_MAIL_FROM,
        // The recipient sees the organisation, not the individual. The member
        // identifies themselves in the body; Reply-To still routes replies to
        // them, and sent_emails records who sent what regardless.
        fromName: 'RSG Türkiye',
        to: recipient,
        // Replies go to the RSG mailbox, not the individual, so the whole
        // team's correspondence stays in one place. Until the inbox view
        // exists, someone has to actually watch that mailbox.
        replyTo: env.RSG_MAIL_FROM,
        subject,
        body,
        attachments,
      });
      gmailId = await sendMail(env, raw);
    } catch (err) {
      errorMessage = err instanceof GmailError ? err.message : String(err);
    }

    await env.DB.prepare(
      `INSERT INTO sent_emails
        (id, sender_user_id, recipient_email, recipient_name, subject, body_snapshot,
         attachment_ids, gmail_message_id, status, error_message, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      user.id,
      recipient,
      recipients.length === 1 ? recipientName : null,
      subject,
      body,
      attachmentIdsJson,
      gmailId,
      gmailId ? 'sent' : 'failed',
      errorMessage,
      Math.floor(Date.now() / 1000),
    ).run();

    results.push(
      gmailId
        ? { recipient, status: 'sent' }
        : { recipient, status: 'failed', error: errorMessage ?? 'unknown error' },
    );
  }

  const anySent = results.some(r => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
