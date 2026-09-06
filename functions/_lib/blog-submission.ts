/**
 * What a member may put in a blog submission.
 *
 * The create endpoint checked that six fields were truthy and nothing else.
 * That left two ways to write a row nobody can do anything with.
 *
 * `tags` was stored as `JSON.stringify(body.tags ?? [])` with no check that it
 * was an array. Send `"tags": "genomics"` and the column holds `"genomics"`
 * quoted -- valid JSON, not an array. The member list and the admin list both
 * survive it because they only parse; the approve path does
 * `JSON.parse(row.tags).map(...)`, which throws on a string. So that
 * submission can never be approved: every attempt is a raw 500 with no JSON
 * error to show the admin. The writer cannot fix it either, because editing is
 * only allowed on a rejected submission -- and rejecting then resubmitting
 * went through the same unchecked line again.
 *
 * A non-string `title` was the other: `slugify` calls `.replace` on it and a
 * number throws before anything is stored.
 *
 * Lengths are here for a plainer reason. These fields become a markdown file
 * in a pull request, and nothing bounded them at all.
 */
import { parseHttpUrl } from './url';

export const LIMITS = {
  title: 200,
  description: 500,
  category: 60,
  author: 120,
  body: 200_000,
  tag: 40,
  tags: 12,
} as const;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

export function submissionText(raw: unknown, max: number, label: string): Checked<string> {
  if (typeof raw !== 'string') return { ok: false, error: `${label} must be text.` };
  const value = raw.trim();
  if (value === '') return { ok: false, error: `${label} is required.` };
  if (value.length > max) return { ok: false, error: `${label} must be ${max} characters or fewer.` };
  return { ok: true, value };
}

/**
 * Tags, as the JSON string the column holds.
 *
 * Returns the serialised form because that is what every caller stores, and
 * because serialising in one place is what stops a caller from stringifying
 * something that is not an array -- which is the whole defect.
 */
export function submissionTags(raw: unknown): Checked<string> {
  if (raw === undefined || raw === null) return { ok: true, value: '[]' };
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: 'Tags must be a list. A single tag still goes in a list, like ["genomics"].',
    };
  }
  if (raw.length > LIMITS.tags) {
    return { ok: false, error: `At most ${LIMITS.tags} tags.` };
  }
  const tags: string[] = [];
  for (const tag of raw) {
    if (typeof tag !== 'string') return { ok: false, error: 'Every tag must be text.' };
    const value = tag.trim();
    if (value === '') continue; // an empty box in the form, not an error
    if (value.length > LIMITS.tag) {
      return { ok: false, error: `Each tag must be ${LIMITS.tag} characters or fewer.` };
    }
    if (!tags.includes(value)) tags.push(value);
  }
  return { ok: true, value: JSON.stringify(tags) };
}

/** The hero image, which goes verbatim into the post's frontmatter. */
export function submissionImageUrl(raw: unknown): Checked<string> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: '' };
  if (typeof raw !== 'string') return { ok: false, error: 'Image URL must be text.' };
  try {
    return { ok: true, value: parseHttpUrl(raw, 'Image URL') };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Tags read back out of a row.
 *
 * Defensive on the way out as well as on the way in, because the rows written
 * before this module existed are still there and a row that cannot be
 * approved is worse than a row with no tags.
 */
export function tagsFromRow(stored: string): string[] {
  try {
    const parsed: unknown = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}
