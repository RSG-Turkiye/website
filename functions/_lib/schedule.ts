/**
 * When a queued message may be sent, and when to stop trying.
 *
 * Pure and free of I/O so the arithmetic can be tested exhaustively; the
 * dispatcher supplies `now` rather than reading the clock here.
 */

/** Unbounded scheduling means a forgotten message surfacing months later. */
export const MAX_SCHEDULE_AHEAD_SECONDS = 60 * 24 * 3600;

/** How long a rate-limited message keeps trying before it is recorded failed. */
export const RETRY_WINDOW_SECONDS = 6 * 3600;

export type ScheduleValidation =
  | { ok: true; scheduledAt: number }
  | { ok: false; code: string };

export function validateScheduledAt(value: unknown, now: number): ScheduleValidation {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, code: 'invalid_schedule_time' };
  }
  if (value < now) return { ok: false, code: 'schedule_in_past' };
  if (value > now + MAX_SCHEDULE_AHEAD_SECONDS) return { ok: false, code: 'schedule_too_far' };
  return { ok: true, scheduledAt: value };
}

/**
 * A message is only abandoned once the whole retry window has elapsed since
 * the first attempt. Late is better than silent; forever is worse than a
 * recorded failure.
 */
export function shouldGiveUp(firstTriedAt: number | null, now: number): boolean {
  if (firstTriedAt === null) return false;
  return now - firstTriedAt > RETRY_WINDOW_SECONDS;
}
