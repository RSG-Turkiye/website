import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { checkRateLimit } from '../../_lib/mail';
import { shouldGiveUp } from '../../_lib/schedule';
import {
  resolveAttachments,
  sendAndLog,
  logFailure,
  type ComposeInput,
  type RecipientResult,
  type AttachmentCache,
} from '../../_lib/compose';

interface ScheduledRow {
  id: string;
  sender_user_id: string;
  recipients: string;
  subject: string;
  body: string;
  attachment_ids: string;
  first_tried_at: number | null;
}

/** At most this many queued messages per call, so one tick cannot run long. */
/**
 * Deliberately small. Each message carries the full attachment inline, so a
 * mail-out with a 9 MB PDF builds a ~12.5 MB MIME body per recipient; twenty
 * of those in one invocation is what the 128 MB isolate could not survive.
 * With the attachment encoded once per dispatch, the remaining cost is one
 * body at a time, and a small batch keeps the peak flat.
 *
 * Five a minute drains a hundred-recipient mail-out in twenty minutes, which
 * is the shape these actually take.
 */
const BATCH = 5;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Without this, anyone could drain the queue early or burn the Gmail quota
  // by hammering the endpoint.
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  // Shared across every row in this batch: a mail-out sends one file to
  // everyone, so it is fetched from R2 and encoded once rather than once per
  // recipient.
  const attachmentCache: AttachmentCache = new Map();

  const due = await env.DB.prepare(
    `SELECT id, sender_user_id, recipients, subject, body,
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
      subject: row.subject,
      body: row.body,
      attachmentIds,
    };

    const drop = async (reason: string) => {
      await logFailure(env, input, reason);
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      failed++;
    };

    // Set the instant the finally block's own DELETE below resolves. It has
    // to live out here, not inside the try, so the catch at the bottom of
    // this iteration -- which runs in a separate block scope -- can still see
    // it and tell "the row is definitely gone" apart from "something failed
    // before we know whether it's gone".
    let dequeued = false;

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
      const resolved = await resolveAttachments(env, attachmentIds, attachmentCache);
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

      let results: RecipientResult[] = [];
      // Holds whichever of "sendAndLog threw" or "the DELETE below threw" was
      // the FIRST of the two, so it survives to the outer catch. Plain
      // try/finally would lose this: if the try's body throws and the
      // finally's own body then also throws, JS discards the try's exception
      // and propagates the finally's instead -- here that would mean
      // last_error recording a D1 delete hiccup instead of the real send
      // failure that caused it. sendAndLog is written to never throw for a
      // per-recipient reason (see its own comment), so in practice this path
      // is only reachable by a genuine bug in sendAndLog itself, but the fix
      // is a few lines and costs nothing to keep.
      let firstFailure: unknown;
      try {
        results = await sendAndLog(env, input, resolved.attachments);
      } catch (err) {
        firstFailure = err;
      } finally {
        // Mail has now been attempted -- possibly delivered to some or all
        // recipients via the per-recipient try/catch inside sendAndLog.
        // Retaining this row would resend to every recipient, including ones
        // already mailed, on the next tick. The row leaves the queue
        // unconditionally once a send has been attempted, regardless of what
        // else throws.
        try {
          await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
          dequeued = true;
        } catch (deleteErr) {
          if (firstFailure === undefined) firstFailure = deleteErr;
        }
      }
      if (firstFailure !== undefined) throw firstFailure;
      if (results.some(r => r.status === 'sent')) sent++; else failed++;
    } catch (err) {
      // Unlike malformed JSON, a throw here (a D1 hiccup, a transient R2 read
      // failure inside resolveAttachments, or the DELETE above failing) is not
      // automatically proof the message can never send -- UNLESS the row has
      // already been dequeued. sendAndLog does not throw for a per-recipient
      // reason (a Gmail failure or a log-write failure both turn into a
      // 'failed' RecipientResult, not an exception), so by the time `dequeued`
      // is true, sendAndLog has already run to completion and written
      // whatever sent_emails rows it could for every recipient. There is
      // nothing left to retry -- recipients that never got attempted do not
      // exist in this scenario -- and calling logFailure here would write a
      // 'failed' row for recipients that may well have sent successfully,
      // contradicting the log sendAndLog already wrote. So: nothing to retry,
      // nothing to re-log, just count it and move on.
      //
      // When the row is still queued, the pre-existing behaviour is correct:
      // stamp attempts/first_tried_at and retry, unless the retry window has
      // elapsed, in which case give up and record the failure for real.
      const message = err instanceof Error ? err.message : String(err);
      if (dequeued) {
        failed++;
      } else if (shouldGiveUp(row.first_tried_at, now)) {
        await logFailure(env, input, 'Unexpected error, giving up after retry window: ' + message);
        await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
        failed++;
      } else {
        await env.DB.prepare(
          `UPDATE scheduled_emails
           SET attempts = attempts + 1,
               first_tried_at = COALESCE(first_tried_at, ?),
               last_error = ?,
               updated_at = ?
           WHERE id = ?`
        ).bind(now, 'Unexpected error, will retry: ' + message, now, row.id).run();
        retried++;
      }
    }
  }

  return jsonResponse({ ok: true, processed: due.results.length, sent, failed, retried });
};
