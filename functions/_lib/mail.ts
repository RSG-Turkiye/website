/**
 * Domain rules for sending mail as RSG: who may send how much, and what
 * counts as a well-formed compose. Deliberately free of Gmail and HTTP so it
 * can be unit-tested outside the Workers runtime.
 */

export const MAX_RECIPIENTS = 10;
// Gmail's message ceiling is 25MB after base64 inflation, but that reasoning
// assumes a single encode. gmail.ts now encodes each attachment once per
// compose (not once per recipient), so the peak cost is one attachment's
// encode -- still capped well under the Worker isolate's ~128MB, since an
// 18MB source buffer would itself blow past that during encoding. 5MB
// comfortably fits a sponsorship PDF and has not been verified against a
// real Gmail account end to end (no GMAIL_REFRESH_TOKEN configured yet), so
// stay conservative rather than find the real ceiling by OOMing in production.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 20000;

export const RATE_LIMITS = {
  perUserPerHour: 20,
  perUserPerDay: 100,
  globalPerDay: 300, // consumer Gmail caps around 500/day; leave headroom
} as const;

export function parseRecipients(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n\r]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export type ComposeValidation =
  | { ok: true; recipients: string[] }
  | { ok: false; code: string };

export function validateCompose(input: { to: string; subject: string; body: string }): ComposeValidation {
  const recipients = parseRecipients(input.to ?? '');
  if (recipients.length === 0) return { ok: false, code: 'no_recipients' };
  if (recipients.length > MAX_RECIPIENTS) return { ok: false, code: 'too_many_recipients' };
  if (!recipients.every(isValidEmail)) return { ok: false, code: 'invalid_email' };

  const subject = (input.subject ?? '').trim();
  if (!subject) return { ok: false, code: 'empty_subject' };
  if (subject.length > MAX_SUBJECT_LENGTH) return { ok: false, code: 'subject_too_long' };

  const body = (input.body ?? '').trim();
  if (!body) return { ok: false, code: 'empty_body' };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, code: 'body_too_long' };

  return { ok: true, recipients };
}

/** The slice of D1Database this module needs; D1Database satisfies it structurally. */
export interface RateLimitDb {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
}

export type RateLimitResult = { ok: true } | { ok: false; code: string };

/**
 * `now` is unix seconds. `recipientCount` is how many rows this compose is
 * about to write -- it is added to each window before comparing, so a compose
 * can never push a window past its limit.
 *
 * Only rows with status = 'sent' count: a failed send consumed no Gmail quota,
 * so it must not consume ours either.
 */
export async function checkRateLimit(
  db: RateLimitDb,
  userId: string,
  recipientCount: number,
  now: number,
): Promise<RateLimitResult> {
  const hourAgo = now - 3600;
  const dayAgo = now - 86400;

  const perUserHour = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE sender_user_id = ? AND status = 'sent' AND sent_at > ?")
    .bind(userId, hourAgo)
    .first<{ n: number }>();
  if ((perUserHour?.n ?? 0) + recipientCount > RATE_LIMITS.perUserPerHour) {
    return { ok: false, code: 'rate_limit_hour' };
  }

  const perUserDay = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE sender_user_id = ? AND status = 'sent' AND sent_at > ?")
    .bind(userId, dayAgo)
    .first<{ n: number }>();
  if ((perUserDay?.n ?? 0) + recipientCount > RATE_LIMITS.perUserPerDay) {
    return { ok: false, code: 'rate_limit_day' };
  }

  const globalDay = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE status = 'sent' AND sent_at > ?")
    .bind(dayAgo)
    .first<{ n: number }>();
  if ((globalDay?.n ?? 0) + recipientCount > RATE_LIMITS.globalPerDay) {
    return { ok: false, code: 'rate_limit_global' };
  }

  return { ok: true };
}
