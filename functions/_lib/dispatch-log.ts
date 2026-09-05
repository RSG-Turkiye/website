/**
 * A record of what each dispatch tick actually did.
 *
 * On 2026-09-05 the mail queue stalled for six and a half hours: the cron
 * Worker fired every minute -- mail_sync_state proves it, because nothing but
 * the cron calls /api/mail/sync -- and yet not one queue row was claimed. A
 * tick that reaches its own loop always writes a claim before sending, so the
 * loop was never reached, and there was no way to find out why: `wrangler
 * tail` is the only window onto a Pages Function and it would not connect.
 *
 * So the tick writes its own history instead. One row per invocation, and
 * deliberately written in two parts:
 *
 *   no row at all          the invocation never happened
 *   finished_at IS NULL    it started and never came back -- killed mid-tick,
 *                          which is what an isolate over its memory limit
 *                          looks like from the outside
 *   finished_at set        it ran to the end, and `candidates`/`planned` say
 *                          whether it found work and chose to do any of it
 *
 * Those three cases need three different fixes and, in this incident, the
 * lack of any way to tell them apart cost a day. Nothing here changes what
 * the tick does: every write is wrapped, and a logging failure is swallowed
 * rather than allowed to fail a send.
 */
export interface RunLogDb {
  prepare(query: string): {
    bind(...values: unknown[]): { run(): Promise<unknown> };
  };
}

/**
 * How far a tick got. Written as it goes, so a tick that never returns still
 * says where it stopped -- which is the whole difficulty with a killed
 * isolate: the code that would have reported the failure is the code that
 * did not run.
 *
 * The order is the order of the work. `resolved` means the attachment came
 * out of R2 and was base64-encoded, which is the memory-hungry part; `claimed`
 * means the row was marked in flight, which happens after that and before any
 * Gmail call. A tick stuck at `planned` and one stuck at `claimed` are dying
 * in different places and need different fixes -- on 2026-09-05 the queue did
 * both within ten minutes and there was no way to tell.
 */
export type Phase = 'planned' | 'resolved' | 'claimed' | 'sent';

/**
 * Every count is optional and stored as NULL when absent, because a tick that
 * threw before it read the queue genuinely does not know how many rows were
 * due -- and writing 0 there would read as "there was no mail", which is the
 * opposite of what happened.
 */
export interface RunSummary {
  candidates?: number;
  planned?: number;
  sent?: number;
  failed?: number;
  retried?: number;
  alreadySent?: number;
  /** Set when the tick deliberately did nothing, e.g. outside the send window. */
  held?: string;
  /** Set when the tick threw. The throw is re-raised; this only records it. */
  error?: string;
}

/**
 * How long a run row is kept. Long enough to cover a weekend -- the stall
 * that prompted this was noticed the next morning -- and short enough that
 * the table stays small without anyone tending it.
 */
export const RUN_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Whether this tick should also delete expired rows.
 *
 * The cron runs every minute, so pruning on every one of them would be 1,440
 * DELETEs a day to remove 1,440 rows -- work proportional to the schedule
 * rather than to the data. Once an hour is enough: `at` is unix seconds, so
 * the first tick of each hour is the one whose second-of-hour is under a
 * minute. Pure, so the interval can be tested without waiting an hour.
 */
export function isPruneTick(at: number): boolean {
  return at % 3600 < 60;
}

/**
 * Records that a tick began. Returns the row's id, or null if the write
 * failed -- in which case the caller carries on unlogged rather than
 * refusing to send mail because a diagnostic table was unavailable.
 */
export async function startRun(db: RunLogDb, id: string, at: number): Promise<string | null> {
  try {
    await db
      .prepare('INSERT INTO dispatch_runs (id, started_at) VALUES (?, ?)')
      .bind(id, at)
      .run();
    return id;
  } catch {
    return null;
  }
}

/** Records how a tick ended. Never throws, for the same reason as above. */
export async function finishRun(
  db: RunLogDb,
  id: string | null,
  at: number,
  summary: RunSummary,
): Promise<void> {
  if (id === null) return;
  try {
    await db
      .prepare(
        `UPDATE dispatch_runs
         SET finished_at = ?, candidates = ?, planned = ?, sent = ?,
             failed = ?, retried = ?, already_sent = ?, held = ?, error = ?
         WHERE id = ?`,
      )
      .bind(
        at,
        summary.candidates ?? null,
        summary.planned ?? null,
        summary.sent ?? null,
        summary.failed ?? null,
        summary.retried ?? null,
        summary.alreadySent ?? null,
        summary.held ?? null,
        summary.error ?? null,
        id,
      )
      .run();
  } catch {
    // A tick that sent mail and could not say so is still a tick that sent
    // mail. The sent_emails log, not this table, is the record that matters.
  }
}

/**
 * Records how far the tick has got. One small write per phase, on a schedule
 * that plans at most a handful of messages per invocation. Never throws, for
 * the same reason as the rest of this module.
 */
export async function markPhase(
  db: RunLogDb,
  id: string | null,
  phase: Phase,
  detail?: string,
): Promise<void> {
  if (id === null) return;
  try {
    await db
      .prepare('UPDATE dispatch_runs SET phase = ? WHERE id = ?')
      .bind(detail === undefined ? phase : `${phase}:${detail}`, id)
      .run();
  } catch {
    // Diagnostics, and the tick has real work to do.
  }
}

/** Deletes run rows past the retention window. Never throws. */
export async function pruneRuns(db: RunLogDb, at: number): Promise<void> {
  try {
    await db
      .prepare('DELETE FROM dispatch_runs WHERE started_at < ?')
      .bind(at - RUN_RETENTION_SECONDS)
      .run();
  } catch {
    // Housekeeping. If it fails the table grows a little; nothing breaks.
  }
}
