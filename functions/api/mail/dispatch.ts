import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { checkRateLimit } from '../../_lib/mail';
import { shouldGiveUp, withinSendingWindow, SEND_WINDOW } from '../../_lib/schedule';
import {
  planTick,
  needsSplitting,
  splitRecipients,
  remainingRecipients,
} from '../../_lib/mail-queue';
import { startRun, finishRun, markPhase, pruneRuns, isPruneTick } from '../../_lib/dispatch-log';
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
  /** Set when an earlier invocation took this row to send it. Null on a row
   * nobody has started, and on every row written before the column existed. */
  claimed_at: number | null;
}

/**
 * A ceiling for light mail, and nothing more: the byte budget below is what
 * governs anything carrying an attachment. Twenty attachment-free messages in
 * one invocation is well within the isolate; twenty heavy ones is what killed
 * it on 2026-09-04, and the budget, not this number, is what now prevents
 * that.
 */
const BATCH = 20;

/**
 * Attachment bytes one invocation may work with, after the cost multiplier.
 *
 * A recipient's message exists in memory several times over -- the base64
 * attachment, the MIME containing it, the base64url of that, the JSON body --
 * so the isolate's 128 MB goes quickly.
 *
 * Back to 40 MB, and this time the number is measured rather than argued.
 *
 * It was raised to 100 on 2026-09-05 on the theory that Cloudflare fired the
 * cron in bursts and one invocation should therefore do more. That theory was
 * wrong -- dispatch_runs and mail_sync_state both show the cron firing every
 * single minute -- and the raise made things worse in a way that only became
 * visible once the tick logged itself: at 100 MB a tick takes two of these
 * 9.36 MB rows, sends the first, and is killed on the second. Four ticks in a
 * row, four started, none finished, one message each.
 *
 * The rule the evidence actually supports is simpler than a budget: one
 * message of this size per invocation. Not one row -- one message. A row with
 * two recipients is two messages and died the same way, which is what stalled
 * the queue for six and a half hours earlier the same day. `needsSplitting`
 * and `splitRows` below turn those back into one-recipient rows so that this
 * budget means what it says.
 *
 * 32.8 MB is one such message after the cost multiplier. Forty admits one and
 * refuses two, which is exactly the observed limit. It is not derived: 1102
 * says nothing about which resource ran out, and three attempts to reason it
 * out from first principles were all wrong when measured. Move it on evidence
 * -- and now there is a table that supplies some.
 */
const BYTE_BUDGET = 40 * 1024 * 1024;

/**
 * How many of one tick's slots a single sender may take.
 *
 * Without a ceiling the queue is one global line, so forty-two sponsorship
 * mails scheduled five minutes earlier put two invitations behind all of
 * them. Time still decides the order; it no longer decides the whole tick.
 */
const PER_SENDER = 2;

/**
 * How long a claimed row stays untouchable.
 *
 * Long enough that a healthy dispatch always finishes and deletes the row
 * inside it, short enough that a genuine crash before the send retries
 * promptly. The row is not lost either way -- past the lease it is
 * reconsidered, and sent_emails.scheduled_id then says whether it already
 * went out.
 */
const CLAIM_LEASE_SECONDS = 10 * 60;

/** Wider than BATCH so there is something to be fair between. */
const CANDIDATE_WINDOW = 60;

/**
 * Settles up with rows whose lease expired, before anything else looks at them.
 *
 * Such a row was taken by an invocation that never got to its delete, so some
 * of its recipients may already have their mail and the rest are still owed
 * theirs. Both wrong answers have happened here: resending the row whole
 * mailed one recipient the same sponsorship letter twice on 2026-09-04, and
 * dropping it as "already sent" would have quietly written off two of the
 * three recipients on a row still sitting in the queue on 2026-09-05.
 *
 * So the row is narrowed to who is actually still owed. Emptied, it is
 * dequeued; narrowed, it loses its claim and carries on as an ordinary row --
 * which also lets `needsSplitting` below see its real size rather than the
 * size it had before half of it was delivered.
 *
 * Returns how many rows were finished off this way, for the tick's own count.
 * Mutates `rows` so the rest of the tick sees what it decided.
 */
async function reconcileClaimed(env: Env, rows: ScheduledRow[], now: number): Promise<number> {
  let settled = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row.claimed_at === null || row.claimed_at === undefined) continue;

    let recipients: string[];
    try {
      recipients = JSON.parse(row.recipients);
      if (!Array.isArray(recipients)) continue; // the loop below logs and drops it
    } catch {
      continue;
    }

    const logged = await env.DB.prepare(
      'SELECT recipient_email FROM sent_emails WHERE scheduled_id = ?'
    ).bind(row.id).all<{ recipient_email: string }>();
    if (logged.results.length === 0) continue;

    const remaining = remainingRecipients(recipients, logged.results.map((r) => r.recipient_email));
    if (remaining.length === 0) {
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      rows.splice(i, 1);
      settled++;
      continue;
    }

    await env.DB.prepare(
      'UPDATE scheduled_emails SET recipients = ?, claimed_at = NULL, updated_at = ? WHERE id = ?'
    ).bind(JSON.stringify(remaining), now, row.id).run();
    row.recipients = JSON.stringify(remaining);
    row.claimed_at = null;
  }
  return settled;
}

/**
 * Rewrites each given row as one row per recipient, in one atomic batch.
 *
 * New rows inherit the original's scheduled time, so a split changes when
 * nothing about when the mail was meant to go -- only how many messages one
 * invocation is asked to build at once. attempts and first_tried_at are not
 * carried over: none of these recipients has been attempted, and inheriting a
 * give-up clock from a row that never actually tried would retire mail that
 * has not had its chance.
 *
 * Atomic matters here. Half of a split is either a lost recipient or a
 * duplicated one, and D1's batch is the only thing standing between us and
 * both. If it fails, nothing changes and the row is split again next tick.
 *
 * Every row reaching here has been through `reconcileClaimed`, so its
 * recipient list is people who are actually still owed mail. Splitting a list
 * that still contained delivered addresses would give them new row ids the
 * dedupe check has never heard of, and mail them twice -- which happened once,
 * on 2026-09-04, by a different route. Once was enough.
 */
async function splitRows(env: Env, rows: ScheduledRow[], now: number): Promise<void> {
  const statements: D1PreparedStatement[] = [];
  for (const row of rows) {
    const lists = splitRecipients(row);
    if (lists.length < 2) continue;

    // The original row keeps the first recipient rather than being deleted and
    // reinserted: anything already holding its id -- a claim, a sent_emails
    // row written by an invocation that died before its delete -- stays valid.
    statements.push(
      env.DB.prepare(
        'UPDATE scheduled_emails SET recipients = ?, claimed_at = NULL, updated_at = ? WHERE id = ?'
      ).bind(JSON.stringify(lists[0]), now, row.id)
    );
    for (const list of lists.slice(1)) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO scheduled_emails
             (id, sender_user_id, recipients, subject, body, attachment_ids,
              scheduled_at, attempts, created_at, updated_at)
           SELECT ?, sender_user_id, ?, subject, body, attachment_ids,
                  scheduled_at, 0, ?, ?
           FROM scheduled_emails WHERE id = ?`
        ).bind(crypto.randomUUID(), JSON.stringify(list), now, now, row.id)
      );
    }
  }
  if (statements.length > 0) await env.DB.batch(statements);
}

/** Every distinct attachment in the candidate window, by size on disk. */
async function attachmentSizes(env: Env, rows: { attachment_ids: string }[]): Promise<Map<string, number>> {
  const ids = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.attachment_ids);
      if (Array.isArray(parsed)) for (const id of parsed) ids.add(String(id));
    } catch {
      // Corrupt rows are dropped in the loop below; they just cost nothing here.
    }
  }
  if (ids.size === 0) return new Map();
  const list = [...ids];
  const rowsOut = await env.DB.prepare(
    `SELECT id, size_bytes FROM mail_attachments WHERE id IN (${list.map(() => '?').join(',')})`
  ).bind(...list).all<{ id: string; size_bytes: number }>();
  return new Map(rowsOut.results.map((r) => [r.id, r.size_bytes]));
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Without this, anyone could drain the queue early or burn the Gmail quota
  // by hammering the endpoint.
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  // Written before the tick does anything else, so a row that never gains a
  // finished_at is an invocation that started and was killed -- which is what
  // an isolate over its memory limit looks like from outside. Started even
  // for a held tick, because on 2026-09-05 "the cron fired and deliberately
  // did nothing" and "the cron did not fire at all" were indistinguishable,
  // and they need opposite fixes. See dispatch-log.ts.
  const runId = await startRun(env.DB, crypto.randomUUID(), now);

  // The queue delivers during waking hours only. Cloudflare invokes this
  // Worker whenever it likes -- on 2026-09-05 that was 04:10 and 07:38 in the
  // morning -- and nobody chose those hours for their mail. Rows simply wait:
  // nothing is attempted, so no attempt is recorded and the give-up clock
  // does not start ticking through the night.
  if (!withinSendingWindow(new Date())) {
    const held = `outside ${SEND_WINDOW.startHour}:00-${SEND_WINDOW.endHour}:00 Europe/Istanbul`;
    await finishRun(env.DB, runId, now, { candidates: 0, planned: 0, sent: 0, failed: 0, retried: 0, alreadySent: 0, held });
    return jsonResponse({ ok: true, processed: 0, sent: 0, failed: 0, retried: 0, alreadySent: 0, held });
  }

  try {
    return await tick(env, now, runId);
  } catch (err) {
    // Recorded, then re-raised unchanged: the caller still sees the 500 and
    // the Worker still logs a failed invocation. The counts stay NULL because
    // a tick that threw does not know them.
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
};

/**
 * One pass over the queue. Split out from the handler above only so the
 * handler can wrap it in a single try/catch without re-indenting all of it.
 */
async function tick(env: Env, now: number, runId: string | null): Promise<Response> {
  // Shared across every row in this batch: a mail-out sends one file to
  // everyone, so it is fetched from R2 and encoded once rather than once per
  // recipient.
  const attachmentCache: AttachmentCache = new Map();

  const candidates = await env.DB.prepare(
    `SELECT id, sender_user_id, recipients, subject, body,
            attachment_ids, first_tried_at, claimed_at
     FROM scheduled_emails
     WHERE scheduled_at <= ?
       AND (claimed_at IS NULL OR claimed_at <= ?)
     ORDER BY scheduled_at ASC
     LIMIT ?`
  ).bind(now, now - CLAIM_LEASE_SECONDS, CANDIDATE_WINDOW).all<ScheduledRow>();

  // Oldest first still, but no sender takes more than PER_SENDER of a tick.
  // Attachment sizes decide how much of a tick each row costs, so they are
  // read once for the whole candidate window rather than per row.
  const sizes = await attachmentSizes(env, candidates.results);
  const sizeOf = (id: string) => sizes.get(id) ?? 0;
  const plan = { batch: BATCH, perSender: PER_SENDER, byteBudget: BYTE_BUDGET };

  // Rows whose lease expired are settled up with first: who has already had
  // their mail is subtracted, and a row with nobody left is dequeued. This
  // happens before the split below so that a half-delivered row is measured
  // and broken up by what it still owes, not by what it originally carried.
  const alreadySent = await reconcileClaimed(env, candidates.results, now);

  // A row carrying more recipients than one invocation can send is broken up
  // before anything is planned, so the budget below is comparing like with
  // like: after this, every candidate row is exactly one message. See
  // needsSplitting -- these rows are what stalled the queue for six and a
  // half hours on 2026-09-05.
  //
  // Split rows are not sent this tick. They re-enter the queue as ordinary
  // one-recipient rows and are picked up a minute later, which keeps this
  // step to a single atomic write and out of the sending path entirely.
  const oversized = needsSplitting(candidates.results, plan, sizeOf);
  if (oversized.length > 0) {
    const split = new Set(oversized.map((row) => row.id));
    await splitRows(env, oversized, now);
    candidates.results = candidates.results.filter((row) => !split.has(row.id));
  }

  const due = { results: planTick(candidates.results, plan, sizeOf) };
  await markPhase(env.DB, runId, 'planned', String(due.results.length));

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
      scheduledId: row.id,
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

      // Retired here, before the attachment is touched, and that order is the
      // whole point. A row that kills the invocation does it while reading and
      // encoding the attachment below, so every check placed after that line
      // is a check the row never reaches: it returns to the head of the queue
      // a minute later, kills the next tick in the same place, and is never
      // retired by anything. Two rows did precisely that for six and a half
      // hours on 2026-09-05, and dispatch_runs recorded seven consecutive
      // ticks stopping at `planned` to prove it. Everything terminal and cheap
      // belongs above the expensive step.
      if (shouldGiveUp(row.first_tried_at, now)) {
        await drop('Killed the dispatcher on every attempt across the retry window');
        continue;
      }

      // An admin who retires an attachment should not have the old version go
      // out later. Also terminal.
      const resolved = await resolveAttachments(env, attachmentIds, attachmentCache);
      if (!resolved.ok) {
        await drop('Attachment unavailable when the scheduled time arrived: ' + resolved.code);
        continue;
      }
      // Past the R2 read and the base64, which is where the memory goes.
      await markPhase(env.DB, runId, 'resolved', row.id);

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

      // Claimed before the send and committed on its own, so that an
      // invocation killed mid-send leaves a row that is visibly in flight
      // rather than one that looks untouched and gets sent again by the very
      // next tick.
      //
      // The attempt is counted here rather than in the catch below for the
      // same reason: a row that kills the isolate never reaches a catch, so
      // an attempts column only touched on handled errors stays at zero
      // through hundreds of fatal tries and the give-up clock above never
      // starts.
      await env.DB.prepare(
        `UPDATE scheduled_emails
         SET claimed_at = ?, attempts = attempts + 1,
             first_tried_at = COALESCE(first_tried_at, ?), updated_at = ?
         WHERE id = ?`
      ).bind(now, now, now, row.id).run();
      await markPhase(env.DB, runId, 'claimed', row.id);

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
      await markPhase(env.DB, runId, 'sent', row.id);
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

  // `candidates` is the count the 2026-09-05 stall needed and did not have:
  // rows were due all afternoon, so a tick reporting zero candidates would
  // have pointed straight at the query rather than at the sending.
  await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), {
    candidates: candidates.results.length,
    planned: due.results.length,
    sent,
    failed,
    retried,
    alreadySent,
  });
  // Hourly rather than every minute; see isPruneTick.
  if (isPruneTick(now)) await pruneRuns(env.DB, now);

  return jsonResponse({ ok: true, processed: due.results.length, sent, failed, retried, alreadySent });
}
