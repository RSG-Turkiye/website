import type { Env } from './auth';
import { generateId } from './auth';
import { buildMime, sendMail, GmailError, encodeAttachmentBody, type MimeAttachment } from './gmail';
import { MAX_ATTACHMENT_BYTES } from './mail';
import { renderBody } from './markdown';
import { registerThread } from './conversations';

/**
 * The send path, shared by the compose endpoint and the scheduled dispatcher.
 *
 * It lives here rather than in the endpoint so the dispatcher does not have to
 * reimplement attachment resolution, MIME assembly, the per-recipient fan-out
 * and the logging — four things that must stay identical whether mail goes now
 * or in three days.
 */

export interface ComposeInput {
  senderUserId: string;
  recipients: string[];
  subject: string;
  /** Markdown source, exactly as the member wrote it. */
  body: string;
  attachmentIds: string[];
  /** Set only for a reply; see functions/_lib/conversations.ts. */
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface RecipientResult {
  recipient: string;
  status: 'sent' | 'failed';
  error?: string;
  /**
   * The send outcome above -- whichever it was -- could not be written to
   * `sent_emails`. The caller still learns the true status, but the audit
   * trail is missing a row for this recipient.
   */
  auditFailed?: boolean;
  /**
   * The message went out, but its Gmail thread could not be recorded in
   * `mail_threads`. The mail is sent and logged; the conversation it started
   * will simply never appear on the site, and nothing backfills it.
   */
  registrationFailed?: boolean;
}

interface AttachmentRow {
  id: string;
  filename: string;
  r2_key: string;
  content_type: string;
  size_bytes: number;
}

export type AttachmentResolution =
  | { ok: true; attachments: MimeAttachment[] }
  | { ok: false; code: string };

/**
 * Encoded attachments already resolved in this invocation, keyed by
 * attachment id.
 *
 * A mail-out sends the same file to everyone: one sponsorship round put a
 * 9.36 MB PDF on 32 scheduled emails. Resolving per email meant fetching that
 * PDF from R2 and base64-encoding it once per recipient -- roughly 190 MB of
 * encoding and 250 MB of resulting strings in a single dispatch, against a
 * 128 MB isolate. The invocation was killed with Cloudflare's 1102 before
 * most of the batch went out, and the queue crawled at about three mails per
 * five-minute tick.
 *
 * Pass one of these per dispatch and the file is fetched and encoded once.
 */
export type AttachmentCache = Map<string, MimeAttachment>;

export async function resolveAttachments(
  env: Env,
  attachmentIds: string[],
  cache?: AttachmentCache,
): Promise<AttachmentResolution> {
  if (attachmentIds.length === 0) return { ok: true, attachments: [] };

  const cached = cache && attachmentIds.every((id) => cache.has(id));
  if (cached) {
    return { ok: true, attachments: attachmentIds.map((id) => cache!.get(id)!) };
  }

  const placeholders = attachmentIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, filename, r2_key, content_type, size_bytes
     FROM mail_attachments
     WHERE is_active = 1 AND id IN (${placeholders})`
  ).bind(...attachmentIds).all<AttachmentRow>();

  if (rows.results.length !== attachmentIds.length) {
    return { ok: false, code: 'unknown_attachment' };
  }

  const total = rows.results.reduce((sum, r) => sum + r.size_bytes, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    return { ok: false, code: 'attachments_too_large' };
  }

  const attachments: MimeAttachment[] = [];
  for (const row of rows.results) {
    const object = await env.MAIL_ATTACHMENTS.get(row.r2_key);
    if (!object) return { ok: false, code: 'unknown_attachment' };
    // Encode once here, not inside buildMime: buildMime runs once per
    // recipient below, and re-encoding the same bytes for every recipient is
    // both wasted work and, at the attachment size ceiling, a real risk of
    // exhausting the Worker isolate's memory mid-loop.
    const attachment: MimeAttachment = {
      filename: row.filename,
      contentType: row.content_type,
      base64Body: encodeAttachmentBody(new Uint8Array(await object.arrayBuffer())),
    };
    cache?.set(row.id, attachment);
    attachments.push(attachment);
  }

  return { ok: true, attachments };
}

async function insertLog(
  env: Env,
  input: ComposeInput,
  recipient: string,
  gmailId: string | null,
  gmailThreadId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sent_emails
      (id, sender_user_id, recipient_email, subject, body_snapshot,
       attachment_ids, gmail_message_id, gmail_thread_id, status, error_message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(),
    input.senderUserId,
    recipient,
    input.subject,
    input.body,
    JSON.stringify(input.attachmentIds),
    gmailId,
    gmailThreadId,
    gmailId ? 'sent' : 'failed',
    errorMessage,
    Math.floor(Date.now() / 1000),
  ).run();
}

export async function sendAndLog(
  env: Env,
  input: ComposeInput,
  attachments: MimeAttachment[],
): Promise<RecipientResult[]> {
  const results: RecipientResult[] = [];

  // One Gmail message per recipient: putting ten professors on one To: line
  // would show each of them the entire outreach list.
  for (const recipient of input.recipients) {
    let gmailId: string | null = null;
    let gmailThreadId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const raw = buildMime({
        fromAddress: env.RSG_MAIL_FROM,
        // The recipient sees the organisation, not the individual. The member
        // identifies themselves in the body; sent_emails records who sent what.
        fromName: 'RSG Türkiye',
        to: recipient,
        // Replies go to the RSG mailbox so the team's correspondence stays in
        // one place.
        replyTo: env.RSG_MAIL_FROM,
        subject: input.subject,
        body: renderBody(input.body),
        attachments,
        inReplyTo: input.inReplyTo,
        references: input.references,
      });
      const sent = await sendMail(env, raw, input.threadId);
      gmailId = sent.id;
      gmailThreadId = sent.threadId;
    } catch (err) {
      errorMessage = err instanceof GmailError ? err.message : String(err);
    }

    // insertLog gets its own try/catch, deliberately separate from the one
    // above: a D1 write failure for this recipient's log row is not a reason
    // to abort the recipients still waiting in this loop. Before this fix,
    // insertLog sat outside any try, so a single logging failure on, say,
    // recipient 3 of 5 threw out of sendAndLog entirely -- recipients 4 and 5
    // were then never attempted, and the caller (the immediate-send endpoint,
    // or the dispatcher's per-row try/finally) saw an exception instead of a
    // result list, with no way to tell which recipients had already been
    // mailed. sendAndLog must not throw for a per-recipient reason; a failure
    // belongs in this recipient's own result instead.
    let auditFailed = false;
    try {
      await insertLog(env, input, recipient, gmailId, gmailThreadId, errorMessage);
    } catch (err) {
      auditFailed = true;
      console.error('sendAndLog: audit write failed for', recipient, err);
    }

    // Registering gets its own try/catch for the same reason insertLog does:
    // a D1 failure here must not abort the recipients still waiting in this
    // loop. The cost of losing it is that this conversation never appears on
    // the site -- bad, but not as bad as silently skipping recipients.
    let registrationFailed = false;
    if (gmailId && gmailThreadId) {
      try {
        await registerThread(env, {
          threadId: gmailThreadId,
          senderUserId: input.senderUserId,
          recipientEmail: recipient,
          subject: input.subject,
          sentAt: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        registrationFailed = true;
        console.error('sendAndLog: thread registration failed for', recipient, err);
      }
    }

    results.push(
      gmailId
        ? {
            recipient,
            status: 'sent',
            ...(auditFailed ? { auditFailed: true } : {}),
            ...(registrationFailed ? { registrationFailed: true } : {}),
          }
        : {
            recipient,
            status: 'failed',
            error: errorMessage ?? 'unknown error',
            ...(auditFailed ? { auditFailed: true } : {}),
            ...(registrationFailed ? { registrationFailed: true } : {}),
          },
    );
  }

  return results;
}

/**
 * Record a compose that was never attempted — a queued message whose sender
 * lost permission, or whose attachment was retired. It belongs in the log as a
 * failure with a reason, not nowhere.
 */
export async function logFailure(env: Env, input: ComposeInput, reason: string): Promise<void> {
  for (const recipient of input.recipients) {
    await insertLog(env, input, recipient, null, null, reason);
  }
}
