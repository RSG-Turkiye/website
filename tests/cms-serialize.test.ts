import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CMS_TYPES, checkId, cmsType } from '../src/lib/cms/types';
import {
  serializeJson, parseJson, serializeMarkdown, parseMarkdown, markdownPairPaths, jsonPath,
} from '../src/lib/cms/serialize';
import { jsonSchemaFor } from '../src/lib/cms/json-schema';
import { webinarSchema } from '../src/data/webinars';
import { eventSchema } from '../src/data/events';
import { workshopSchema } from '../src/data/workshops';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (rel: string) => readFileSync(ROOT + rel, 'utf8');
const files = (dir: string, ext: string) =>
  readdirSync(ROOT + dir).filter((f) => f.endsWith(ext)).map((f) => `${dir}/${f}`);

const events = cmsType('events')!;
const workshops = cmsType('workshops')!;
const webinars = cmsType('webinars')!;

const WEBINAR_FILES = [
  ...files('src/content/webinars/en', '.md'),
  ...files('src/content/webinars/tr', '.md'),
];

test('the registry lists the three types, and every dir exists', () => {
  assert.deepEqual(CMS_TYPES.map((t) => t.key), ['events', 'workshops', 'webinars']);
  for (const t of CMS_TYPES) {
    assert.equal(t.group, 'etkinlikler');
    assert.ok(existsSync(ROOT + t.dir), t.dir);
    assert.ok(t.label.en && t.label.tr);
  }
  assert.equal(events.format, 'json');
  assert.equal(workshops.format, 'json');
  assert.equal(webinars.format, 'markdown-pair');
  assert.equal(events.schema, eventSchema);
  assert.equal(workshops.schema, workshopSchema);
  assert.equal(webinars.schema, webinarSchema);
});

test('cmsType answers null for anything not in the registry', () => {
  assert.equal(cmsType('blog'), null);
  assert.equal(cmsType('constructor'), null);
  assert.equal(cmsType(''), null);
});

test('idFrom: events by id, workshops by lower-cased repo, webinars by a slug of the title', () => {
  assert.equal(events.idFrom({ id: 'meetup-izmir-2025' }), 'meetup-izmir-2025');
  assert.equal(workshops.idFrom({ repo: 'AnkaPy' }), 'ankapy');
  assert.equal(
    webinars.idFrom({ frontmatter: { title: 'Çok-Ölçekli Işık: Genomik & AI, 2026!' } }),
    'cok-olcekli-isik-genomik-ai-2026',
  );
});

test('every existing JSON file survives parse then serialize byte for byte', () => {
  for (const [type, dir] of [[events, 'src/content/events'], [workshops, 'src/content/workshops']] as const) {
    const list = files(dir, '.json');
    assert.ok(list.length > 0, dir);
    for (const f of list) {
      const text = read(f);
      assert.equal(serializeJson(type, parseJson(type, text)), text, f);
    }
  }
});

test('an event\'s file name is its id; every JSON file name is a valid id', () => {
  // Only idInData types (events) keep the name tied to the data. Others are
  // named once, at creation: an approved update may change a workshop's repo
  // and keep its file name (plan 4, A1), so that is not asserted for them.
  assert.equal(events.idInData, true);
  assert.equal(workshops.idInData, false);
  for (const f of files('src/content/events', '.json')) {
    assert.equal(`${events.idFrom(parseJson(events, read(f)))}.json`, f.split('/').pop(), f);
  }
  for (const f of files('src/content/workshops', '.json')) {
    const name = f.split('/').pop()!.replace(/\.json$/, '');
    assert.equal(checkId(name), name, f);
  }
});

test('parseJson keeps dates as written: it returns the input, not the parsed schema output', () => {
  const data = parseJson(events, '{\n  "id": "x",\n  "start": "2025-11-30"\n}\n') as { start: unknown };
  assert.equal(data.start, '2025-11-30');
});

test('every existing webinar file survives parse then serialize byte for byte', () => {
  assert.ok(WEBINAR_FILES.length > 100);
  for (const f of WEBINAR_FILES) {
    const text = read(f);
    assert.equal(serializeMarkdown(webinars, parseMarkdown(webinars, text)), text, f);
  }
});

test('the parsed frontmatter of every webinar passes the schema Astro builds with', () => {
  for (const f of WEBINAR_FILES) {
    const r = webinarSchema.safeParse(parseMarkdown(webinars, read(f)).frontmatter);
    assert.ok(r.success, `${f}: ${r.success ? '' : r.error.message}`);
  }
});

// Synthetic webinars in the styles the real files are written in: plain
// values, quoted values with trailing comments, and a frontmatter that ends
// on a blank line. They live here rather than being read from
// src/content/webinars, so a panel edit to any real webinar cannot fail the
// serializer's tests (A2). The real files are covered by the round-trip tests
// above, which hold whatever the files say.
const PLAIN = `---
title: A Talk in the Plain Style
date: 2020-05-05
speaker: Ada Örnek
speakerAffiliation: Example University / Example Institute
speakerTitle: Researcher
description: A talk whose values are written plain, as most older files are.
youtubeUrl: "https://www.youtube.com/watch?v=plainplain1"
slidesUrl: ""
year: 2020
type: bioinfonet
image: ""
topic: ""
keyTakeaways:
  - "The first point of the talk"
  - "The second point of the talk"
---

Body text.
`;
const QUOTED = `---
title: "A Talk in the Quoted Style"
date: 2025-12-12
speaker: "Ada Örnek"
speakerTitle: "Researcher"
speakerAffiliation: "Example University"
description: "A talk whose values are quoted, with comments on two keys."
youtubeUrl: "https://www.youtube.com/watch?v=quotedquote"
slidesUrl: ""    # leave empty string if none: ""
image: ""
topic: "Structural Bioinformatics"
keyTakeaways:
  - "The first point of the talk."
year: 2025
type: bioinfonet   # use "student" for student webinar series
---

Body text.
`;
const TRAILING_BLANK = `---
title: Boş Satırla Biten Bir Konuşma
date: 2022-04-13
speaker: Ada Örnek
speakerAffiliation: Örnek Üniversitesi
speakerTitle: Doçent
description: Ön bilgisi bir boş satırla biten bir konuşma.
youtubeUrl: "https://www.youtube.com/watch?v=blankblank1"
slidesUrl: ""
year: 2022
type: bioinfonet
image: ""
topic: ""
keyTakeaways: []

---

**Gövde**
`;

/** The lines that differ between two texts of the same line count. */
function changedLines(a: string, b: string) {
  const x = a.split('\n');
  const y = b.split('\n');
  assert.equal(x.length, y.length, 'line count changed');
  return x.flatMap((line, i) => (line === y[i] ? [] : [i]));
}

test('editing one frontmatter value changes that line and no other, in every webinar', () => {
  for (const f of WEBINAR_FILES) {
    const text = read(f);
    const parsed = parseMarkdown(webinars, text);
    const lineOf = text.split('\n').findIndex((l) => l.startsWith('youtubeUrl:'));
    if (lineOf === -1) continue; // youtubeUrl is optional; this edit then adds a line
    const out = serializeMarkdown(webinars, {
      ...parsed,
      frontmatter: { ...parsed.frontmatter, youtubeUrl: 'https://www.youtube.com/watch?v=NEW' },
    });
    assert.deepEqual(changedLines(text, out), [lineOf], f);
    assert.equal(out.split('\n')[lineOf], 'youtubeUrl: "https://www.youtube.com/watch?v=NEW"', f);
  }
});

test('an edited value keeps its own quoting: plain stays plain, quoted stays quoted', () => {
  const plain = PLAIN;
  const p = parseMarkdown(webinars, plain);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speaker: 'Someone Else' } });
  assert.match(out, /^speaker: Someone Else$/m);
  // A value that cannot be plain any more is quoted rather than corrupted.
  const out2 = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speaker: 'A: B' } });
  assert.equal(parseMarkdown(webinars, out2).frontmatter.speaker, 'A: B');

  const quoted = QUOTED;
  const q = parseMarkdown(webinars, quoted);
  const out3 = serializeMarkdown(webinars, { ...q, frontmatter: { ...q.frontmatter, speaker: 'Someone Else' } });
  assert.match(out3, /^speaker: "Someone Else"$/m);
});

test('a trailing comment stays with its line when the value changes', () => {
  const text = QUOTED;
  const p = parseMarkdown(webinars, text);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, type: 'student' } });
  assert.match(out, /^type: student {3}# use "student" for student webinar series$/m);
  assert.deepEqual(changedLines(text, out).length, 1);
});

test('lists: emptied, filled, and removed keys; the body is replaced untouched', () => {
  const text = PLAIN;
  const p = parseMarkdown(webinars, text);
  const emptied = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, keyTakeaways: [] } });
  assert.match(emptied, /^keyTakeaways: \[\]\n---\n/m);
  const refilled = parseMarkdown(webinars, emptied);
  const filled = serializeMarkdown(webinars, {
    ...refilled, frontmatter: { ...refilled.frontmatter, keyTakeaways: ['One', 'Two: three'] },
  });
  assert.match(filled, /^keyTakeaways:\n {2}- "One"\n {2}- "Two: three"\n---\n/m);

  const { topic: _topic, ...rest } = p.frontmatter;
  const removed = serializeMarkdown(webinars, { ...p, frontmatter: rest, body: '\nNew body.\n' });
  assert.ok(!/^topic:/m.test(removed));
  assert.ok(removed.endsWith('---\n\nNew body.\n'));
  assert.equal(removed.replace(/\n---\n[\s\S]*$/, ''), text.replace(/\n---\n[\s\S]*$/, '').replace('\ntopic: ""', ''));
});

test('a key the file did not have, with no later key, is added inside the frontmatter, before a trailing blank line', () => {
  const text = TRAILING_BLANK;
  const p = parseMarkdown(webinars, text);
  // `domains` is the schema's last key but one; nothing in the file comes after it.
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, domains: ['genomics'] } });
  assert.match(out, /^keyTakeaways: \[\]\ndomains:\n {2}- "genomics"\n\n---\n/m);
  assert.equal(parseMarkdown(webinars, out).body, p.body);
});

test('a key the file did not have goes at its schema position, before the first later key', () => {
  const p = parseMarkdown(webinars, TRAILING_BLANK);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speakerPhoto: '/api/images/x.jpg', translationKey: 'k' } });
  assert.match(out, /^title: .*\ntranslationKey: "k"\ndate: 2022-04-13\n/m);
  assert.match(out, /^speakerTitle: Doçent\nspeakerPhoto: "\/api\/images\/x.jpg"\ndescription: /m);
  assert.equal(out.split('\n').length, TRAILING_BLANK.split('\n').length + 2, 'two lines added, none changed');
  // A key the schema does not know still goes last.
  const unknown = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, zzz: 'x' } });
  assert.match(unknown, /^keyTakeaways: \[\]\nzzz: "x"\n\n---\n/m);
});

test('a new webinar (no source) is written in the dominant style', () => {
  const out = serializeMarkdown(webinars, {
    frontmatter: {
      keyTakeaways: ['First point', 'Second point'],
      title: 'A New Talk: Methods',
      year: 2026,
      date: '2026-11-05',
      type: 'bioinfonet',
      speaker: 'Ada Lovelace',
      description: 'What it covers.',
      youtubeUrl: '',
    },
    body: '\nThe abstract.\n',
  });
  assert.equal(out, [
    '---',
    'title: "A New Talk: Methods"',
    'date: 2026-11-05',
    'speaker: "Ada Lovelace"',
    'description: "What it covers."',
    'youtubeUrl: ""',
    'year: 2026',
    'type: bioinfonet',
    'keyTakeaways:',
    '  - "First point"',
    '  - "Second point"',
    '---',
    '',
    'The abstract.',
    '',
  ].join('\n'));
  const back = parseMarkdown(webinars, out);
  assert.equal(back.frontmatter.date, '2026-11-05');
  assert.ok(webinarSchema.safeParse(back.frontmatter).success);
});

test('parseMarkdown rejects a file without frontmatter fences', () => {
  assert.throws(() => parseMarkdown(webinars, 'title: x\n'), /frontmatter/);
  assert.throws(() => parseMarkdown(webinars, '---\ntitle: [unclosed\n---\n'), /YAML/);
});

test('markdownPairPaths puts the id under en/ and tr/', () => {
  assert.deepEqual(markdownPairPaths(webinars, 'some-talk'), {
    en: 'src/content/webinars/en/some-talk.md',
    tr: 'src/content/webinars/tr/some-talk.md',
  });
  assert.throws(() => markdownPairPaths(webinars, '../escape'), /Invalid id/);
  assert.throws(() => markdownPairPaths(events, 'x'), /markdown/);
});

test('jsonSchemaFor: events mark start as a date string', () => {
  const s = jsonSchemaFor(events) as any;
  assert.equal(s.type, 'object');
  assert.equal(s.properties.start.type, 'string');
  assert.equal(s.properties.start.format, 'date');
  assert.ok(s.required.includes('start'));
});

test('jsonSchemaFor: workshops', () => {
  const s = jsonSchemaFor(workshops) as any;
  assert.deepEqual(Object.keys(s.properties), ['year', 'title', 'topics', 'repo']);
  assert.equal(s.properties.year.type, 'number');
});

test('jsonSchemaFor: webinars are the frontmatter plus a required body string, date as a date', () => {
  const s = jsonSchemaFor(webinars) as any;
  assert.deepEqual(s.properties.body, { type: 'string' });
  assert.ok(s.required.includes('body'));
  assert.ok(s.required.includes('title'));
  assert.ok(!s.required.includes('slidesUrl'), 'defaulted fields are optional on input');
  assert.equal(s.properties.date.type, 'string');
  assert.equal(s.properties.date.format, 'date');
});

test('a multi-line value on a key with a trailing comment stays one line; the comment stays a comment', () => {
  const text = QUOTED;
  const p = parseMarkdown(webinars, text);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, type: 'a\nb', slidesUrl: 'x\n---\ny' } });
  assert.match(out, /^type: "a\\nb" {3}# use "student" for student webinar series$/m);
  assert.match(out, /^slidesUrl: "x\\n---\\ny" {4}# leave empty string if none: ""$/m);
  assert.equal(changedLines(text, out).length, 2);
  const back = parseMarkdown(webinars, out);
  assert.equal(back.frontmatter.type, 'a\nb');
  assert.equal(back.frontmatter.slidesUrl, 'x\n---\ny');
  assert.equal(back.body, p.body);
  // A plain-style key and a list item with a line break are quoted too.
  const plain = parseMarkdown(webinars, PLAIN);
  const out2 = serializeMarkdown(webinars, {
    ...plain, frontmatter: { ...plain.frontmatter, speaker: 'x\ny', keyTakeaways: ['p\nq'] },
  });
  assert.match(out2, /^speaker: "x\\ny"$/m);
  assert.match(out2, /^ {2}- "p\\nq"$/m);
});

test('serializeJson writes keys in schema order, nested objects and lists too', () => {
  const out = serializeJson(events, {
    when: { tr: 'b', en: 'a' },
    id: 'x',
    links: [{ url: 'u', label: { tr: 't', en: 'e' } }],
    type: 'meetup',
  });
  assert.equal(out, `${JSON.stringify({
    id: 'x', type: 'meetup', when: { en: 'a', tr: 'b' }, links: [{ label: { en: 'e', tr: 't' }, url: 'u' }],
  }, null, 2)}\n`);
  assert.equal(
    serializeJson(workshops, { repo: 'R', extra: 1, year: 2020 }),
    `${JSON.stringify({ year: 2020, repo: 'R', extra: 1 }, null, 2)}\n`,
  );
});

test('jsonPath checks the id; idFrom never returns an invalid one', () => {
  assert.equal(jsonPath(events, 'meetup-izmir-2025'), 'src/content/events/meetup-izmir-2025.json');
  for (const bad of ['../x', 'Foo Bar', '']) {
    assert.throws(() => jsonPath(events, bad), /Invalid id/);
    assert.throws(() => markdownPairPaths(webinars, bad), /Invalid id/);
    assert.throws(() => events.idFrom({ id: bad }), /Invalid id/);
  }
  assert.throws(() => jsonPath(webinars, 'x'), /json/);
  assert.throws(() => webinars.idFrom({ frontmatter: { title: '—!?' } }), /no letters or digits/);
  assert.throws(() => workshops.idFrom({ repo: '__' }), /no letters or digits/);
});

test('checkId refuses anything that is not a string, before the pattern sees it', () => {
  // RegExp.test coerces its argument: undefined became "undefined", a valid slug.
  for (const bad of [undefined, null, 42, ['a'], { toString: () => 'a' }]) {
    assert.throws(() => checkId(bad as never), /Invalid id/);
  }
  assert.equal(checkId('symposium-2026'), 'symposium-2026');
});

// ── Plan 4, Task 3: nested frontmatter (learning paths) ──────────────────────
// The lp types are not registered yet (Task 6b); a stand-in carries only the
// schema, which is all the serializer reads.

import { z } from 'astro/zod';
import type { CmsType } from '../src/lib/cms/types';

const NESTED = { schema: z.object({
  title: z.string(),
  type: z.string(),
  sections: z.array(z.object({ type: z.string(), items: z.array(z.object({ id: z.string(), label: z.string(), year: z.number().optional() })) })),
}) } as unknown as CmsType;

test('a new entry is written with keys in the schema\'s order at every depth', () => {
  const out = serializeMarkdown(NESTED, {
    frontmatter: {
      sections: [{ items: [{ label: 'One: a', year: 2020, id: 'one' }, { label: 'Two', id: 'two' }], type: 'reading' }, { items: [], type: 'tools' }],
      type: 'path',
      title: 'Nested',
    },
    body: '\nBody.\n',
  });
  assert.equal(out, [
    '---',
    'title: "Nested"',
    'type: path',
    'sections:',
    '  - type: reading',
    '    items:',
    '      - id: "one"',
    '        label: "One: a"',
    '        year: 2020',
    '      - id: "two"',
    '        label: "Two"',
    '  - type: tools',
    '    items: []',
    '---',
    '',
    'Body.',
    '',
  ].join('\n'));
});

test('an edited nested list is rewritten in schema order and the same style, so an edit to one item changes one line', () => {
  const { source: _s, ...fresh } = parseMarkdown(NESTED, serializeMarkdown(NESTED, {
    frontmatter: { title: 'Nested', type: 'path', sections: [{ type: 'reading', items: [{ id: 'one', label: 'One' }, { id: 'two', label: 'Two' }] }] },
    body: '\n',
  }));
  const text = serializeMarkdown(NESTED, fresh);
  const p = parseMarkdown(NESTED, text);
  const sections = structuredClone(p.frontmatter.sections) as { type: string; items: Record<string, unknown>[] }[];
  // The panel's form may hand the keys back in any order.
  sections[0].items[1] = { label: 'Two, edited', id: 'two' };
  const out = serializeMarkdown(NESTED, { ...p, frontmatter: { ...p.frontmatter, sections } });
  assert.deepEqual(changedLines(text, out), [text.split('\n').indexOf('        label: "Two"')]);
  assert.match(out, /^ {8}label: "Two, edited"$/m);
});

import { lpDomainSchema, lpLevelSchema, lpRoadmapSchema } from '../src/data/learning-paths';

const LP_FILES = ([['lp-domains', lpDomainSchema], ['lp-levels', lpLevelSchema], ['lp-roadmap', lpRoadmapSchema]] as const)
  .flatMap(([dir, schema]) => ['en', 'tr'].flatMap((lang) => files(`src/content/${dir}/${lang}`, '.md').map((f) => ({ f, type: { schema } as unknown as CmsType }))));

test('every learning-path file survives parse then serialize byte for byte', () => {
  assert.ok(LP_FILES.length > 0);
  for (const { f, type } of LP_FILES) {
    const text = read(f);
    assert.equal(serializeMarkdown(type, parseMarkdown(type, text)), text, f);
  }
});

test('every learning-path file is in the form the serializer writes, so a panel edit changes only its own lines', () => {
  // The panel rewrites a changed top-level key whole: one edited resource
  // rewrites its file's `sections` or `resources`. In this form that is the
  // edited lines only. A file written in another style (a plain `tag:
  // Reading`, a blank line between sections) still builds, but its first
  // panel edit rewrites the whole list. `npm run cms:normalize` fixes it.
  for (const { f, type } of LP_FILES) {
    const text = read(f);
    const { source: _s, ...entry } = parseMarkdown(type, text);
    assert.equal(serializeMarkdown(type, entry), text, `${f} is not in the form the panel writes: run \`npm run cms:normalize\``);
    assert.ok(type.schema.safeParse(entry.frontmatter).success, f);
  }
});

test('a learning-path key added by the panel lands where the normaliser puts it', () => {
  // A level file without prerequisites: the panel adds them, and the file is
  // then exactly what scripts/cms-normalize.ts would write.
  const type = { schema: lpLevelSchema } as unknown as CmsType;
  const fm = { domain: 'genomics', level: 'explorer', orientation: 'O.', sections: [{ type: 'foundations', resources: [{ id: 'x-1', title: 'T', description: 'D', tag: 'Reading', url: 'https://example.org' }] }] };
  const text = serializeMarkdown(type, { frontmatter: fm, body: '\n' });
  const p = parseMarkdown(type, text);
  const out = serializeMarkdown(type, { ...p, frontmatter: { ...p.frontmatter, prerequisites: ['Some biology'] } });
  const { source: _s, ...fresh } = parseMarkdown(type, out);
  assert.equal(out, serializeMarkdown(type, fresh));
  assert.match(out, /^orientation: "O."\nprerequisites:\n {2}- "Some biology"\nsections:/m);
});
