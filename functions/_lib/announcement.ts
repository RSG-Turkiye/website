/**
 * What an announcement is allowed to contain.
 *
 * Two endpoints write these -- POST /api/admin/announcements and PATCH on
 * /[id] -- and they disagreed about nearly everything. The POST checked three
 * string lengths and the truthiness of the rest; the PATCH ran `.length` on
 * whatever arrived, so a numeric title passed and was stored as a number.
 * Neither checked the two fields that matter.
 *
 * `expires_at` is the sharp one. The column has INTEGER affinity but SQLite
 * stores what it is given, and in SQLite every TEXT value compares greater
 * than every INTEGER. So `expires_at = "2026-12-31"` makes
 * `WHERE expires_at > ?` true for ever: the announcement is published to the
 * home page of every visitor and no date will ever retire it. There is no
 * error, nothing in a log, and the only way back is a hand-written UPDATE.
 *
 * `button_url` is rendered into an href. The main site neutralises
 * `javascript:` when it renders (src/pages/index.astro), and the symposium
 * side has always refused it at the door via parseHttpUrl -- so the two
 * surfaces that store the same column disagreed on the rule. They do not now.
 */
import { parseHttpUrl } from './url';

export const MAX_TITLE = 80;
export const MAX_DESCRIPTION = 200;
export const MAX_BUTTON_TEXT = 30;

/**
 * The range an expiry may fall in, as unix seconds.
 *
 * Not "any integer": 0 is 1970, which reads as "unset" and behaves as
 * "expired for ever", and a value in milliseconds -- the mistake a browser
 * makes every time -- lands in the year 58000 and never expires either. Both
 * are typos with no error message, so they are refused here rather than
 * stored.
 */
export const EARLIEST_EXPIRY = 1_600_000_000; // 2020-09
export const LATEST_EXPIRY = 4_000_000_000; // 2096-10

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function announcementText(
  raw: unknown,
  max: number,
  label: string,
  required: boolean,
): FieldResult<string> {
  if (raw === undefined || raw === null || raw === '') {
    return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: '' };
  }
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` };
  if (raw.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value: raw };
}

/** An expiry that will actually expire. */
export function announcementExpiry(raw: unknown): FieldResult<number> {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    return { ok: false, error: 'Expiry must be a whole number of seconds since 1970.' };
  }
  if (raw < EARLIEST_EXPIRY || raw > LATEST_EXPIRY) {
    return {
      ok: false,
      error:
        `Expiry ${raw} is outside the range this site accepts. ` +
        `It wants seconds since 1970 -- milliseconds are a thousand times too large ` +
        `and would never expire.`,
    };
  }
  return { ok: true, value: raw };
}

/** A button link that a browser will follow and nothing else. */
export function announcementUrl(raw: unknown, required: boolean): FieldResult<string> {
  if (raw === undefined || raw === null || raw === '') {
    return required ? { ok: false, error: 'Button URL is required.' } : { ok: true, value: '' };
  }
  if (typeof raw !== 'string') return { ok: false, error: 'Button URL must be text.' };
  try {
    return { ok: true, value: parseHttpUrl(raw, 'Button URL') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
