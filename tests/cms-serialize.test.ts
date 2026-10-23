import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { CMS_TYPES, cmsType } from '../src/lib/cms/types';
import {
  serializeJson, parseJson, serializeMarkdown, parseMarkdown, markdownPairPaths,
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

test('the JSON file name is the id the registry derives', () => {
  for (const f of files('src/content/events', '.json')) {
    assert.equal(`${events.idFrom(parseJson(events, read(f)))}.json`, f.split('/').pop(), f);
  }
  for (const f of files('src/content/workshops', '.json')) {
    assert.equal(`${workshops.idFrom(parseJson(workshops, read(f)))}.json`, f.split('/').pop(), f);
  }
});

test('parseJson keeps dates as written: it returns the input, not the parsed schema output', () => {
  const data = parseJson(events, read('src/content/events/meetup-izmir-2025.json')) as { start: unknown };
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
    const out = serializeMarkdown(webinars, {
      ...parsed,
      frontmatter: { ...parsed.frontmatter, youtubeUrl: 'https://www.youtube.com/watch?v=NEW' },
    });
    assert.deepEqual(changedLines(text, out), [lineOf], f);
    assert.equal(out.split('\n')[lineOf], 'youtubeUrl: "https://www.youtube.com/watch?v=NEW"', f);
  }
});

test('an edited value keeps its own quoting: plain stays plain, quoted stays quoted', () => {
  const plain = read('src/content/webinars/en/accessing-multi-omics-data-tumour-profiling-aashil-batavia.md');
  const p = parseMarkdown(webinars, plain);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speaker: 'Someone Else' } });
  assert.match(out, /^speaker: Someone Else$/m);
  // A value that cannot be plain any more is quoted rather than corrupted.
  const out2 = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speaker: 'A: B' } });
  assert.equal(parseMarkdown(webinars, out2).frontmatter.speaker, 'A: B');

  const quoted = read('src/content/webinars/en/physics-based-and-ai-methods-for-protein-interaction-analysis-2025.md');
  const q = parseMarkdown(webinars, quoted);
  const out3 = serializeMarkdown(webinars, { ...q, frontmatter: { ...q.frontmatter, speaker: 'Someone Else' } });
  assert.match(out3, /^speaker: "Someone Else"$/m);
});

test('a trailing comment stays with its line when the value changes', () => {
  const text = read('src/content/webinars/en/physics-based-and-ai-methods-for-protein-interaction-analysis-2025.md');
  const p = parseMarkdown(webinars, text);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, type: 'student' } });
  assert.match(out, /^type: student {3}# use "student" for student webinar series$/m);
  assert.deepEqual(changedLines(text, out).length, 1);
});

test('lists: emptied, filled, and removed keys; the body is replaced untouched', () => {
  const text = read('src/content/webinars/en/accessing-multi-omics-data-tumour-profiling-aashil-batavia.md');
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

test('a key the file did not have is added inside the frontmatter, before a trailing blank line', () => {
  const text = read('src/content/webinars/tr/modelling-complex-microbial-communities-nagarajan.md');
  const p = parseMarkdown(webinars, text);
  const out = serializeMarkdown(webinars, { ...p, frontmatter: { ...p.frontmatter, speakerPhoto: '/api/images/x.jpg' } });
  assert.match(out, /^keyTakeaways: \[\]\nspeakerPhoto: "\/api\/images\/x.jpg"\n\n---\n/m);
  assert.equal(parseMarkdown(webinars, out).body, p.body);
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
  assert.throws(() => markdownPairPaths(webinars, '../escape'), /id/);
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
