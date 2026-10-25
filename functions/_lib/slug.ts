/**
 * One URL-safe slug, for the symposium's speaker and session slugs.
 *
 * It was merged with the member blog form's own slugify, which capped post
 * file names at 80 characters. That form is retired (blog posts are panel CMS
 * drafts, named by src/lib/cms/slug.ts), and the cap went with it. Its old
 * rule stripped trailing hyphens before cutting, so a cut could end on one:
 * src/content/blog/en/ has a published example --
 * `computational-analysis-and-integration-of-large-scale-biological-data-with-deep-`
 * -- and that URL is live, so it stays.
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

export function slugify(value: string): string {
  let transliterated = '';
  for (const ch of value) transliterated += TURKISH[ch] ?? ch;

  return transliterated
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // any other language's accents, split out by NFKD
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
