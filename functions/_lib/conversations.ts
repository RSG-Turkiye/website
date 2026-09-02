import type { ParsedMessage } from './gmail-read';
import type { Env } from './auth';
import { fetchThread, parseThread } from './gmail-read';
import { buildMime, sendMail } from './gmail';
import { renderBody } from './markdown';

/**
 * Conversations: the threads the site started, and what to do with them.
 *
 * The decisions live here as pure functions so they can be tested without a
 * database or a Gmail account; the SQL and the network calls that use them sit
 * below in the same file (Task 6) with nothing clever in them.
 */

/** One notification per thread per hour, however many replies arrive. */
export const NOTIFY_THROTTLE_SECONDS = 3600;

/**
 * A References header naming every message in a long thread would run past
 * the line length mail servers are willing to accept. Clients only need
 * enough of the tail to place the reply.
 */
export const MAX_REFERENCES = 10;

export const SNIPPET_LENGTH = 140;

export interface ThreadState {
  lastMessageAt: number;
  lastDirection: 'out' | 'in';
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  // `RE :` and `re:` are both prefixes a real client produces; matching only
  // the exact string `Re: ` would give "Re: RE : Sempozyum" after two rounds.
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`.trim();
}

export function buildReferences(messageIds: Array<string | null>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of messageIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered.slice(-MAX_REFERENCES);
}

export function computeThreadState(messages: ParsedMessage[]): ThreadState | null {
  if (messages.length === 0) return null;
  let latest = messages[0];
  // `>=` rather than `>`: on a tie the later entry wins, which matches the
  // ascending order parseThread produces and keeps the answer stable.
  for (const message of messages) {
    if (message.sentAt >= latest.sentAt) latest = message;
  }
  return { lastMessageAt: latest.sentAt, lastDirection: latest.direction };
}

export function shouldNotify(lastNotifiedAt: number | null, now: number): boolean {
  if (lastNotifiedAt === null) return true;
  // A stamp in the future (clock skew between D1 and the isolate) fails this
  // comparison and suppresses the mail, which is the safe direction to err.
  return now - lastNotifiedAt >= NOTIFY_THROTTLE_SECONDS;
}

export function snippet(bodyText: string, max = SNIPPET_LENGTH): string {
  const flat = bodyText.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

export interface RegisterThreadParams {
  threadId: string;
  senderUserId: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  sentAt: number;
}

/**
 * Record that the site sent into this thread.
 *
 * This is the only way a row enters mail_threads, and mail_threads is the only
 * set of threads the sync is permitted to read. Everything the feature
 * promises about not touching the rest of the mailbox rests on that.
 *
 * Called for replies too, where the row already exists: the INSERT is ignored
 * and the UPDATE moves the thread up the list.
 */
export async function registerThread(env: Env, params: RegisterThreadParams): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_threads
      (id, sender_user_id, recipient_email, recipient_name, subject,
       last_message_at, last_direction, unread, last_notified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'out', 0, NULL, ?, ?)`
  ).bind(
    params.threadId,
    params.senderUserId,
    params.recipientEmail,
    params.recipientName,
    params.subject,
    params.sentAt,
    params.sentAt,
    params.sentAt,
  ).run();

  // Guarded by the timestamp so an out-of-order call cannot drag a thread
  // backwards in the list.
  await env.DB.prepare(
    `UPDATE mail_threads
     SET last_message_at = ?, last_direction = 'out', updated_at = ?
     WHERE id = ? AND last_message_at < ?`
  ).bind(params.sentAt, params.sentAt, params.threadId, params.sentAt).run();
}

export interface IngestResult {
  newInbound: number;
  total: number;
}

/**
 * Pull one thread from Gmail into the local cache.
 *
 * The lookup at the top IS the `assertKnownThread` guard the spec calls for.
 * It lives here rather than as a separate exported function because this is
 * the only place a Gmail read is ever issued from: an id that is not in
 * mail_threads is never fetched, so no request this feature can be made to
 * serve will read a message the site did not start. A standalone helper called
 * from one caller would only make it easier to add a second caller that
 * forgets it.
 */
export async function ingestThread(env: Env, threadId: string, now: number): Promise<IngestResult> {
  const known = await env.DB.prepare(
    'SELECT id FROM mail_threads WHERE id = ?'
  ).bind(threadId).first<{ id: string }>();
  if (!known) return { newInbound: 0, total: 0 };

  const messages = parseThread(await fetchThread(env, threadId), env.RSG_MAIL_FROM);

  let newInbound = 0;
  for (const message of messages) {
    // INSERT OR IGNORE against Gmail's own message id as the primary key is
    // what makes re-syncing a thread harmless. `meta.changes` then tells us
    // truthfully whether this message is new, which is what the notification
    // decision needs -- counting parsed messages instead would re-notify on
    // every sync.
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO mail_messages
        (id, thread_id, direction, rfc822_message_id, from_email, from_name,
         subject, body_text, attachment_count, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      message.id,
      threadId,
      message.direction,
      message.rfc822MessageId,
      message.fromEmail,
      message.fromName,
      message.subject,
      message.bodyText,
      message.attachmentCount,
      message.sentAt,
      now,
    ).run();

    if (res.meta.changes > 0 && message.direction === 'in') newInbound += 1;
  }

  const state = computeThreadState(messages);
  if (state) {
    await env.DB.prepare(
      `UPDATE mail_threads
       SET last_message_at = ?, last_direction = ?, updated_at = ?,
           unread = CASE WHEN ? > 0 THEN 1 ELSE unread END
       WHERE id = ?`
    ).bind(state.lastMessageAt, state.lastDirection, now, newInbound, threadId).run();
  }

  return { newInbound, total: messages.length };
}

/**
 * Tell the member who started a thread that it has a reply waiting.
 *
 * Returns whether a mail actually went out, so the caller can report it.
 */
export async function notifyThreadOwner(
  env: Env,
  threadId: string,
  siteOrigin: string,
  now: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT t.subject, t.recipient_email, t.last_notified_at, u.email AS owner_email
     FROM mail_threads t
     JOIN users u ON u.id = t.sender_user_id
     WHERE t.id = ?`
  ).bind(threadId).first<{
    subject: string;
    recipient_email: string;
    last_notified_at: number | null;
    owner_email: string;
  }>();

  if (!row) return false;
  if (!shouldNotify(row.last_notified_at, now)) return false;

  const link = `${siteOrigin}/tr/account/conversations`;
  const body = [
    `${row.recipient_email} adlı kişi "${row.subject}" konulu e-postanıza cevap verdi.`,
    '',
    // The member answers on the site, not by replying to this mail: a reply to
    // this address opens a thread the site never started and therefore cannot
    // see. The sentence has to carry that, because the Reply-To cannot.
    `Cevabı okumak ve yanıtlamak için siteye gidin: ${link}`,
    '',
    'RSG Türkiye',
  ].join('\n');

  const raw = buildMime({
    fromAddress: env.RSG_MAIL_FROM,
    fromName: 'RSG Türkiye',
    to: row.owner_email,
    replyTo: env.RSG_MAIL_FROM,
    subject: `Yeni cevap: ${row.subject}`,
    body: renderBody(body),
    attachments: [],
  });

  // Deliberately not sendAndLog. That helper registers a thread and writes to
  // sent_emails, and neither is right here: registering would make the system
  // a correspondent of itself and start notifying about its own notifications,
  // and logging would bury members' real sends under machine mail.
  await sendMail(env, raw);

  await env.DB.prepare(
    'UPDATE mail_threads SET last_notified_at = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, threadId).run();

  return true;
}
