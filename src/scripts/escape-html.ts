/**
 * Escaping for the places this site builds HTML as a string.
 *
 * Several pages render lists by assembling markup and assigning it to
 * innerHTML. That is fine for markup the page wrote and fatal for anything a
 * member typed, and on 2026-09-06 the two had been mixed: the members
 * directory and the admin user table both interpolated display_name,
 * institution and bio straight into a template literal. Anyone with a Google
 * account could sign in, put markup in their bio, and have it run in the
 * browser of every signed-in visitor -- and in the admin panel, where a
 * same-origin request can grant its sender is_admin.
 *
 * It lives here rather than being copied into each page because it had been
 * copied into one page already: admin-panel.ts had this function and used it
 * on the email column while missing the two columns beside it. One copy, one
 * import, and the next page that renders a member cannot quietly do without.
 */

/** Text safe to place in element content or inside a double-quoted attribute. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

/**
 * Where member avatars may be loaded from.
 *
 * Uploads go to Cloudinary, and the field is a URL the member supplies rather
 * than a file the site received, so it is only ever this one host.
 */
const AVATAR_HOST = 'res.cloudinary.com';

/**
 * An avatar URL that is safe to put in a src attribute, or null.
 *
 * A prefix test is not enough on its own, which is how the server-side check
 * was written: `https://res.cloudinary.com/x" onerror="..."` starts with the
 * expected string and still closes the attribute. Parsing rejects a different
 * host outright and percent-encodes what it keeps, and the caller escapes the
 * result as well -- neither alone, both together.
 */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.hostname !== AVATAR_HOST) return null;
    return url.toString();
  } catch {
    return null;
  }
}
