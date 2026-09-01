import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { checkRateLimit } from '../../_lib/mail';
import { shouldGiveUp } from '../../_lib/schedule';
import { resolveAttachments, sendAndLog, logFailure, type ComposeInput } from '../../_lib/compose';

interface ScheduledRow {
  id: string;
  sender_user_id: string;
  recipients: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  attachment_ids: string;
  first_tried_at: number | null;
}

/** At most this many queued messages per call, so one tick cannot run long. */
const BATCH = 20;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Without this, anyone could drain the queue early or burn the Gmail quota
  // by hammering the endpoint.
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  const due = await env.DB.prepare(
    `SELECT id, sender_user_id, recipients, recipient_name, subject, body,
            attachment_ids, first_tried_at
     FROM scheduled_emails
     WHERE scheduled_at <= ?
     ORDER BY scheduled_at ASC
     LIMIT ?`
  ).bind(now, BATCH).all<ScheduledRow>();

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due.results) {
    // Malformed recipients/attachment_ids is terminal: it can never become
    // valid JSON on a later tick. Guarded separately from the try/catch below
    // (and checked first) so a corrupt row is logged and removed rather than
    // sitting at the head of this ORDER BY scheduled_at ASC query forever,
    // blocking every other member's due mail behind it. Not reachable through
    // the app today -- send.ts and scheduled.ts both JSON.stringify a
    // validated array before inserting -- but the cost of guarding it is a
    // few lines against a total failure mode.
    let recipients: string[];
    let attachmentIds: string[];
    try {
      recipients = JSON.parse(row.recipients);
      attachmentIds = JSON.parse(row.attachment_ids);
      if (!Array.isArray(recipients) || !Array.isArray(attachmentIds)) {
        throw new Error('recipients or attachment_ids did not parse to an array');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logFailure(
        env,
        {
          senderUserId: row.sender_user_id,
          recipients: [`corrupt-row:${row.id}`],
          recipientName: row.recipient_name,
          subject: row.subject,
          body: row.body,
          attachmentIds: [],
        },
        'Queue row corrupted, recipients or attachment_ids is not valid JSON: ' + message,
      );
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      failed++;
      continue;
    }

    const input: ComposeInput = {
      senderUserId: row.sender_user_id,
      recipients,
      recipientName: row.recipient_name,
      subject: row.subject,
      body: row.body,
      attachmentIds,
    };

    const drop = async (reason: string) => {
      await logFailure(env, input, reason);
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      failed++;
    };

    try {
      // Revoking someone's permission has to stop mail they queued before it was
      // revoked, or revocation means nothing. Terminal: it will not resolve.
      const sender = await env.DB.prepare('SELECT is_sender FROM users WHERE id = ?')
        .bind(row.sender_user_id).first<{ is_sender: number }>();
      if (!sender || sender.is_sender !== 1) {
        await drop('Sender no longer authorised when the scheduled time arrived');
        continue;
      }

      // An admin who retires an attachment should not have the old version go
      // out later. Also terminal.
      const resolved = await resolveAttachments(env, attachmentIds);
      if (!resolved.ok) {
        await drop('Attachment unavailable when the scheduled time arrived: ' + resolved.code);
        continue;
      }

      // A full rate limit is transient — wait for the next tick, up to the
      // retry window.
      const limit = await checkRateLimit(env.DB, row.sender_user_id, recipients.length, now);
      if (!limit.ok) {
        if (shouldGiveUp(row.first_tried_at, now)) {
          await drop('Rate limit still full after the retry window: ' + limit.code);
        } else {
          await env.DB.prepare(
            `UPDATE scheduled_emails
             SET attempts = attempts + 1,
                 first_tried_at = COALESCE(first_tried_at, ?),
                 last_error = ?,
                 updated_at = ?
             WHERE id = ?`
          ).bind(now, limit.code, now, row.id).run();
          retried++;
        }
        continue;
      }

      const results = await sendAndLog(env, input, resolved.attachments);
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      if (results.some(r => r.status === 'sent')) sent++; else failed++;
    } catch (err) {
      // Unlike malformed JSON, a throw here (a D1 hiccup, a transient R2
      // read failure inside resolveAttachments) is not proof the message can
      // never send. Record it and leave the row queued for the next tick --
      // converting a momentary blip into a dropped, unlogged message would be
      // worse than trying again in fifteen minutes.
      const message = err instanceof Error ? err.message : String(err);
      await env.DB.prepare(
        `UPDATE scheduled_emails SET last_error = ?, updated_at = ? WHERE id = ?`
      ).bind('Unexpected error, will retry: ' + message, now, row.id).run();
    }
  }

  return jsonResponse({ ok: true, processed: due.results.length, sent, failed, retried });
};
