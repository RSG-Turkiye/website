/**
 * Which of the due rows this tick should actually process, and why not more.
 *
 * Two things went wrong on 2026-09-04 and both are decided here.
 *
 * The queue was one global line ordered by scheduled time, so a member who
 * scheduled forty-two sponsorship mails at 05:00 put two attachment-free
 * invitations, about a kilobyte each, behind all forty-two. They were still
 * unsent five hours later. Time should decide the order; it should not decide
 * the whole tick. Rows are handed out round by round, at most `perSender` per
 * sender per round, so one mail is never stuck behind forty.
 *
 * The batch was also a fixed count, and a count is the wrong unit. Sending one
 * recipient a 9.36 MB attachment costs roughly forty-five megabytes of
 * transient strings: the base64 attachment, the MIME message containing it,
 * the base64url of that, and the JSON body wrapping it again. Five of those
 * in a loop exceeded the isolate's 128 MB and Cloudflare killed the
 * invocation with 1102 -- every tick, for hours. So the tick is budgeted in
 * bytes: light mail flows many at a time, heavy mail goes one at a time and
 * actually arrives.
 *
 * Pure, so both rules can be tested without a database or a mailbox.
 */
export interface QueueRow {
  id: string;
  sender_user_id: string;
  attachment_ids: string;
  /** JSON array. Each recipient gets their own message, so a row with three
   * of them costs three times what one does -- putting them all on a single
   * To: line would show every professor the whole outreach list. */
  recipients: string;
}

export interface TickPlan {
  batch: number;
  perSender: number;
  /** Attachment bytes one invocation may work with. Compared against the
   * measured cost below, not against the raw file size. */
  byteBudget: number;
}

/**
 * What one recipient costs in transient memory, as a multiple of the
 * attachment's size on disk. Base64 is 4/3, and the message is built, encoded
 * again for the wire, and wrapped in JSON -- measured against the isolate's
 * limit rather than derived, so it is deliberately pessimistic.
 */
export const COST_MULTIPLIER = 3.5;

function parseList(json: string): unknown[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // a corrupt row is dropped downstream; do not let it skew the plan
  }
}

/**
 * What sending this row costs in transient memory.
 *
 * The attachment is fetched and encoded once, but everything after that is
 * per recipient: sendAndLog builds a separate MIME for each, encodes it for
 * the wire, and wraps it in JSON. So three recipients on one row cost three
 * times what one does, and budgeting on the attachment alone -- which is what
 * the first version of this did -- underestimates a multi-recipient row by
 * exactly that factor.
 */
export function costOf(
  attachmentIds: unknown[],
  recipientCount: number,
  sizeOf: (id: string) => number
): number {
  const bytes = attachmentIds.reduce<number>((sum, id) => sum + sizeOf(String(id)), 0);
  return bytes * Math.max(1, recipientCount) * COST_MULTIPLIER;
}

function rowCost(row: QueueRow, sizeOf: (id: string) => number): number {
  return costOf(parseList(row.attachment_ids), parseList(row.recipients).length, sizeOf);
}

export function planTick<T extends QueueRow>(
  due: T[],
  plan: TickPlan,
  sizeOf: (id: string) => number
): T[] {
  if (plan.batch <= 0 || plan.perSender <= 0) return [];

  // Preserve each sender's own order: the query hands these over oldest-first
  // and a sender's mail should still go in the order they scheduled it.
  const bySender = new Map<string, T[]>();
  for (const row of due) {
    const queue = bySender.get(row.sender_user_id);
    if (queue) queue.push(row);
    else bySender.set(row.sender_user_id, [row]);
  }

  const picked: T[] = [];
  let spent = 0;
  // Map keeps insertion order, so the sender whose oldest mail is oldest
  // overall leads every round.
  for (let round = 0; round < plan.perSender; round++) {
    for (const queue of bySender.values()) {
      const row = queue[round];
      if (!row) continue;

      const cost = rowCost(row, sizeOf);
      // Skip what does not fit rather than stopping here. Stopping would put
      // the budget back where the plain queue was: the first heavy sender
      // would spend it all and everything behind them would wait again --
      // which is the exact failure this function exists to prevent. A mail
      // too big for a whole tick is still taken when nothing else has been,
      // so heavy mail cannot starve either; it simply goes one at a time.
      // A row that costs nothing always rides along: an attachment-free mail
      // adds no memory worth budgeting, and holding it back because a heavy
      // one already filled the tick is how the light mail got stranded in the
      // first place.
      if (cost > 0 && picked.length > 0 && spent + cost > plan.byteBudget) continue;

      picked.push(row);
      spent += cost;
      if (picked.length === plan.batch) return picked;
    }
  }
  return picked;
}

/**
 * Rows that can never be sent as they stand.
 *
 * A row is one queue entry but not one message: each recipient gets their own
 * MIME, built, encoded and posted separately, because putting them all on one
 * To: line would show every professor the whole outreach list. So a row with
 * three recipients is three messages, and with a 9.36 MB attachment that is
 * three times the memory a single one costs -- past what the isolate survives,
 * whatever the budget says.
 *
 * On 2026-09-05 that is precisely what stopped the queue: two two-recipient
 * rows sat at the head, each one over the whole tick's budget. planTick takes
 * such a row anyway rather than let it starve -- correctly, since refusing it
 * would mean it never went at all -- and the invocation died on the second
 * recipient every time, leaving no attempt recorded and the same row at the
 * head a minute later. Six and a half hours, no mail, no trace.
 *
 * Splitting them into one row per recipient is what makes the byte budget
 * honest: after this, every row is one message and the budget can refuse a
 * second one.
 */
export function needsSplitting<T extends QueueRow>(
  due: T[],
  plan: TickPlan,
  sizeOf: (id: string) => number
): T[] {
  return due.filter((row) => {
    const recipients = parseList(row.recipients);
    return recipients.length > 1 && rowCost(row, sizeOf) > plan.byteBudget;
  });
}

/** The one-recipient lists a row splits into, in the order they were given. */
export function splitRecipients(row: QueueRow): string[][] {
  return parseList(row.recipients).map((r) => [String(r)]);
}
