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

function attachmentBytes(row: QueueRow, sizeOf: (id: string) => number): number {
  let ids: string[];
  try {
    ids = JSON.parse(row.attachment_ids);
  } catch {
    return 0; // a corrupt row is dropped downstream; do not let it skew the plan
  }
  return Array.isArray(ids) ? ids.reduce((sum, id) => sum + sizeOf(id), 0) : 0;
}

export function planTick<T extends QueueRow>(
  due: T[],
  plan: TickPlan,
  sizeOf: (id: string) => number,
  /** Rows too large for any single invocation, collected for the caller to
   * report rather than silently retry. */
  oversized?: T[]
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

      const cost = attachmentBytes(row, sizeOf) * COST_MULTIPLIER;

      // A mail too big for an entire invocation is not attempted at all.
      //
      // It used to be taken anyway, on the reasoning that something too large
      // must still eventually go out. That reasoning was wrong: taking it
      // meant the invocation died, and because it died before dequeuing
      // anything, it took the whole tick down with it -- every five minutes,
      // for hours, while forty-nine recipients waited behind one file. A mail
      // that cannot be sent should be reported, not retried forever at
      // everyone else's expense.
      if (cost > plan.byteBudget) {
        oversized?.push(row);
        continue;
      }

      // Skip what does not fit in what is left rather than stopping here.
      // Stopping would put the budget back where the plain queue was: the
      // first heavy sender would spend it all and everything behind them
      // would wait again, which is the failure this function exists to
      // prevent.
      if (picked.length > 0 && spent + cost > plan.byteBudget) continue;

      picked.push(row);
      spent += cost;
      if (picked.length === plan.batch) return picked;
    }
  }
  return picked;
}
