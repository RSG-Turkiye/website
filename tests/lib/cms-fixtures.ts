/**
 * Real content entries for the CMS tests, chosen by their shape, never by
 * name or wording.
 *
 * The panel edits and deletes these files. A test that names
 * `symposium-2026` or pins a date read from it fails the first time someone
 * edits that entry in the panel, which is how #323 broke CI. So each test
 * asks for "an event", "another event" or "a webinar pair whose files have
 * different names", and gets whichever entry fits today.
 */
import type { CmsIndex } from '../../src/lib/cms/cms-index';

const base = (p: string) => p.replace(/^.*\//, '').replace(/\.(json|md)$/, '');

/** The value of a top-level `key:` line in Markdown frontmatter, unquoted. */
export function frontmatterValue(text: string, key: string): string {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

export function realFixtures(files: Record<string, string>, index: CmsIndex) {
  const events = Object.keys(files).filter((p) => /^src\/content\/events\/[^/]+\.json$/.test(p)).sort();
  if (events.length < 2) throw new Error('the CMS tests need at least two events');

  const pairs = index.webinars.filter((w) => w.paths?.en && w.paths?.tr);
  // Tied by translationKey: the two files have different names.
  const keyed = pairs.filter((w) => base(w.paths!.en!) !== base(w.paths!.tr!) && frontmatterValue(files[w.paths!.en!], 'translationKey'));
  if (keyed.length < 2) throw new Error('the CMS tests need two webinar pairs tied by translationKey');
  const [a, b] = keyed;
  const sameName = pairs.find((w) => base(w.paths!.en!) === base(w.paths!.tr!));
  if (!sameName) throw new Error('the CMS tests need a webinar pair with the same file name');

  return {
    /** An event, and its file. */
    EVENT_ID: base(events[0]),
    EVENT_PATH: events[0],
    /** A second, different event. */
    OTHER_EVENT_ID: base(events[1]),
    OTHER_EVENT_PATH: events[1],
    /** A webinar pair whose en and tr files have different names. */
    PAIR_ID: a.id,
    PAIR_EN: a.paths!.en!,
    PAIR_TR: a.paths!.tr!,
    PAIR_KEY: frontmatterValue(files[a.paths!.en!], 'translationKey'),
    /** The translationKey of another published pair. */
    OTHER_KEY: frontmatterValue(files[b.paths!.en!], 'translationKey'),
    /** A webinar pair whose two files share one name. */
    SAME_NAME_ID: sameName.id,
  };
}
