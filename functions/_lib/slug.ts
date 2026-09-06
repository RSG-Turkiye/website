/**
 * One URL-safe slug, for both things that make them.
 *
 * There were two: one in _lib/symposium.ts for speaker and session slugs, one
 * in api/blog-submissions.ts for post filenames. Run against the same inputs
 * they agree on every realistic string -- Turkish letters, accents, casing,
 * punctuation -- and differ in exactly one thing: the blog one caps the result
 * at 80 characters and the symposium one does not.
 *
 * Which is fine, and is the parameter below. What was not fine is how the cap
 * was applied: `.slice(0, 80)` came after the trailing hyphens were stripped,
 * so a cut that landed on a hyphen left one on the end. src/content/blog/en/
 * has a published example --
 * `computational-analysis-and-integration-of-large-scale-biological-data-with-deep-`
 * -- and that URL is live, so it stays; this stops the next one.
 *
 * Idempotent: slugifying an already-slugged string returns it unchanged, so a
 * hand-typed slug that gets re-saved never drifts and re-slugging a
 * speakerSlugs entry to match is always a no-op.
 */

/**
 * Turkish letters transliterated explicitly.
 *
 * Dotless ı (U+0131) has no NFKD canonical decomposition -- unlike ö, ğ, ü, ş
 * and ç, which decompose into base + diacritic and lose the diacritic below --
 * so without this it survives the normalise, fails the [a-z0-9] filter, and
 * becomes a stray hyphen in the middle of a word.
 */
const TURKISH: Record<string, string> = {
  'İ': 'i', 'I': 'i', 'ı': 'i',
  'Ğ': 'g', 'ğ': 'g',
  'Ü': 'u', 'ü': 'u',
  'Ş': 's', 'ş': 's',
  'Ö': 'o', 'ö': 'o',
  'Ç': 'c', 'ç': 'c',
};

export interface SlugOptions {
  /** Cut the slug to at most this many characters, on a word boundary. */
  maxLength?: number;
}

export function slugify(value: string, options: SlugOptions = {}): string {
  let transliterated = '';
  for (const ch of value) transliterated += TURKISH[ch] ?? ch;

  const slug = transliterated
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // any other language's accents, split out by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const max = options.maxLength;
  if (max === undefined || slug.length <= max) return slug;
  // Trim after cutting, not before: the cut is what creates the trailing
  // hyphen, so stripping first cannot remove it.
  return slug.slice(0, max).replace(/-+$/, '');
}
