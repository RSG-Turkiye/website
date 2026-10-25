/**
 * Real content entries for the CMS tests, chosen by their shape, never by
 * name or wording.
 *
 * The panel edits and deletes these files. A test that names
 * `symposium-2026` or pins a date read from it fails the first time someone
 * edits that entry in the panel, which is how #323 broke CI. So each test
 * asks for "an event", "another event" or "a webinar pair whose files have
 * different names", and gets whichever entry fits today.
 *
 * When the content no longer has a shape (the panel deleted the last pair
 * tied by translationKey, say), a synthetic entry of that shape is added to
 * `files` and the index is rebuilt in place, so the tests keep running on
 * something real-shaped instead of failing on what the content happens to
 * hold. `SYNTHETIC` lists what was added.
 *
 * `CMS_FIXTURES=synthetic npm test` uses the synthetic entries even when real
 * ones exist: the way to check that the tests still pass without them.
 */
import { createHash } from 'node:crypto';
import { buildCmsIndex, type CmsIndex } from '../../src/lib/cms/cms-index';
import { slugify } from '../../src/lib/cms/slug';

const base = (p: string) => p.replace(/^.*\//, '').replace(/\.(json|md)$/, '');

/** The value of a top-level `key:` line in Markdown frontmatter, unquoted. */
export function frontmatterValue(text: string, key: string): string {
  const block = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const m = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(block);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
}

/** A synthetic event file (valid against src/data/events.ts). */
function syntheticEvent(id: string, start: string): string {
  return `${JSON.stringify({
    id,
    type: 'meetup',
    start,
    title: { en: `Fixture meetup ${id}`, tr: `Örnek buluşma ${id}` },
    when: { en: start, tr: start },
    location: { en: 'Online', tr: 'Çevrimiçi' },
    description: { en: 'A synthetic event for the tests.', tr: 'Testler için uydurma bir etkinlik.' },
  }, null, 2)}\n`;
}

/** A synthetic webinar side (valid against src/data/webinars.ts). */
function syntheticWebinar(title: string, key: string, date: string): string {
  return [
    '---',
    `title: "${title}"`,
    ...(key ? [`translationKey: "${key}"`] : []),
    `date: ${date}`,
    'speaker: "Ada Örnek"',
    'description: "A synthetic webinar for the tests."',
    `year: ${date.slice(0, 4)}`,
    'type: "student"',
    '---',
    '',
    'Synthetic body.',
    '',
  ].join('\n');
}

const sha1 = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');

export function realFixtures(files: Record<string, string>, index: CmsIndex) {
  const force = process.env.CMS_FIXTURES === 'synthetic';
  const added: string[] = [];
  /** Forced: only what was added here counts. */
  const usable = (...paths: (string | null | undefined)[]) => !force || paths.every((p) => !!p && added.includes(p));
  const add = (path: string, text: string) => { files[path] = text; added.push(path); };
  const rebuild = () => {
    // Shas only when the caller's index carried them.
    const withShas = Object.values(index).some((list) => list.some((e) => e.shas));
    const shas = withShas ? Object.fromEntries(Object.entries(files).map(([p, t]) => [p, sha1(t)])) : undefined;
    Object.assign(index, buildCmsIndex(files, shas));
  };

  const eventPaths = () => Object.keys(files).filter((p) => /^src\/content\/events\/[^/]+\.json$/.test(p) && usable(p)).sort();
  for (let n = eventPaths().length; n < 2; n++) add(`src/content/events/fixture-event-${n}.json`, syntheticEvent(`fixture-event-${n}`, `2090-0${n + 1}-01`));

  const pairsOf = () => index.webinars.filter((w) => w.paths?.en && w.paths?.tr && usable(w.paths.en, w.paths.tr));
  // Tied by translationKey: the two files have different names.
  const keyedOf = () => pairsOf().filter((w) => base(w.paths!.en!) !== base(w.paths!.tr!) && frontmatterValue(files[w.paths!.en!], 'translationKey'));
  // The tests also need a title whose slug is the Turkish file name, built
  // from its words; a name like `a--b` has none.
  const titleOf = (w: CmsIndex['webinars'][number]) => base(w.paths!.tr!).replace(/-/g, ' ');
  const keyOf = (w: CmsIndex['webinars'][number] | undefined) => (w ? frontmatterValue(files[w.paths!.en!], 'translationKey') : '');
  const pick = () => {
    const a = keyedOf().find((w) => slugify(titleOf(w)) === base(w.paths!.tr!));
    const b = keyedOf().find((w) => w !== a && keyOf(w) !== keyOf(a));
    const sameName = pairsOf().find((w) => base(w.paths!.en!) === base(w.paths!.tr!));
    return { a, b, sameName };
  };

  if (added.length) rebuild();
  let { a, b, sameName } = pick();
  if (!a) {
    add('src/content/webinars/en/fixture-talk-one.md', syntheticWebinar('Fixture talk one', 'fixture-talk-one', '2090-03-01'));
    add('src/content/webinars/tr/ornek-konusma-bir.md', syntheticWebinar('Örnek konuşma bir', 'fixture-talk-one', '2090-03-01'));
  }
  if (!b) {
    add('src/content/webinars/en/fixture-talk-two.md', syntheticWebinar('Fixture talk two', 'fixture-talk-two', '2090-04-01'));
    add('src/content/webinars/tr/ornek-konusma-iki.md', syntheticWebinar('Örnek konuşma iki', 'fixture-talk-two', '2090-04-01'));
  }
  if (!sameName) {
    add('src/content/webinars/en/fixture-same-name.md', syntheticWebinar('Fixture same name', '', '2090-05-01'));
    add('src/content/webinars/tr/fixture-same-name.md', syntheticWebinar('Örnek aynı ad', '', '2090-05-01'));
  }
  if (!a || !b || !sameName) {
    rebuild();
    ({ a, b, sameName } = pick());
  }
  const events = eventPaths();

  return {
    /** An event, and its file. */
    EVENT_ID: base(events[0]),
    EVENT_PATH: events[0],
    /** A second, different event. */
    OTHER_EVENT_ID: base(events[1]),
    OTHER_EVENT_PATH: events[1],
    /** A webinar pair whose en and tr files have different names. */
    PAIR_ID: a!.id,
    PAIR_EN: a!.paths!.en!,
    PAIR_TR: a!.paths!.tr!,
    /** A title whose slug is the pair's Turkish file name. */
    PAIR_TR_TITLE: titleOf(a!),
    PAIR_KEY: keyOf(a),
    /** The translationKey of another published pair. */
    OTHER_KEY: keyOf(b),
    /** A webinar pair whose two files share one name. */
    SAME_NAME_ID: sameName!.id,
    /** The synthetic files added to `files` (none while the content has every shape). */
    SYNTHETIC: added,
  };
}
