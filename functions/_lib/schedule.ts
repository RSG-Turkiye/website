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


/**
 * The hours the queue is allowed to deliver in, in Türkiye time.
 *
 * The backlog does not care what time it is, and on 2026-09-05 it delivered
 * sponsorship mail at 04:10 and 07:38 in the morning. Nobody chose that hour;
 * it is simply when Cloudflare happened to invoke the Worker. A recipient
 * woken by an outreach email remembers who sent it.
 *
 * The window is generous rather than office hours -- someone scheduling for
 * 08:05 meant 08:05 -- and it closes at ten in the evening.
 */
export const SEND_WINDOW = { startHour: 8, endHour: 22 } as const;

/**
 * Türkiye has been on UTC+3 all year round since 2016, with no daylight
 * saving, so the offset is a constant rather than something to look up. If
 * that ever changes this is the one place that needs to know.
 */
const TR_OFFSET_HOURS = 3;

/**
 * Whether the queue may deliver at `now`.
 *
 * Applies to the queue only. Someone pressing send themselves has chosen the
 * moment, and it is not this code's place to overrule them; what it governs
 * is mail going out unattended while its sender is asleep.
 */
export function withinSendingWindow(now: Date): boolean {
  const hour = (now.getUTCHours() + TR_OFFSET_HOURS) % 24;
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}
