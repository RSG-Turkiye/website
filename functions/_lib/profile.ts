/**
 * What a member is allowed to put in their own profile.
 *
 * Pure, and separate from the endpoint, because these are the rules rather
 * than the plumbing: they are worth reading in one place and worth testing
 * without a database.
 *
 * The escaping that makes this text safe to render lives at the sinks, in
 * src/scripts/escape-html.ts, and that is where it belongs -- a length limit
 * is not a security control and nothing here should be mistaken for one. What
 * these do is stop a field that is displayed in a card and a table from being
 * used as unbounded storage, and refuse an avatar URL that points anywhere
 * but the host uploads actually go to.
 */

/** Longest institution a profile may carry. The longest real one is 26. */
export const MAX_INSTITUTION = 120;

/** Longest bio a profile may carry. The longest real one is 219. */
export const MAX_BIO = 600;

export type TextResult = { ok: true; value: string | null } | { ok: false; error: string };

/**
 * An optional free-text profile field: trimmed, length-checked, and empty
 * treated as absent so a cleared box stores NULL rather than "".
 */
export function optionalText(raw: unknown, max: number, label: string): TextResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` };
  const value = raw.trim();
  if (value === '') return { ok: true, value: null };
  if (value.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value };
}

/** Uploads go to Cloudinary; an avatar may come from there and nowhere else. */
const AVATAR_HOST = 'res.cloudinary.com';

/**
 * The avatar URL to store, or null.
 *
 * This was a `startsWith` test, which a URL can satisfy and still be hostile:
 * `https://res.cloudinary.com/x" onerror="..."` has the right prefix and, in
 * a page that built an img tag by concatenation, closed the attribute and ran.
 * Parsing settles the host properly and percent-encodes what it keeps. The
 * pages escape it as well; this is the half that can also refuse.
 */
export function avatarUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw === '') return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST) return null;
    return url.toString();
  } catch {
    return null;
  }
}
