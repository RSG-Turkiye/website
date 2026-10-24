// The build-time index (/cms-index.json) is built from the CMS_TYPES
// registry, not per-type code. For the Etkinlikler types its output must be
// byte for byte what plan 3's builder gave (tests/lib/cms-index-v1.ts, frozen),
// for the files in this checkout and for a synthetic set with the edge cases.
// The comparison is between two builders, never with a stored copy of real
// content, so a content edit cannot fail it (plan 4, A2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { z } from 'astro/zod';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { gitBlobShas } from '../src/lib/cms/blob-sha';
import { CMS_TYPES, defineType, type CmsTypeKey } from '../src/lib/cms/types';
import { buildCmsIndexV1 } from './lib/cms-index-v1';

const ROOT = new URL('../', import.meta.url).pathname;

function checkout(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['src/content/events', 'src/content/workshops']) {
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = readFileSync(`${ROOT}${dir}/${f}`, 'utf8');
  }
  for (const lang of ['en', 'tr']) {
    const dir = `src/content/webinars/${lang}`;
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = readFileSync(`${ROOT}${dir}/${f}`, 'utf8');
  }
  return out;
}

const event = (id: string, start: string, title: string) => JSON.stringify({ id, type: 'meetup', start, title: { en: title, tr: title } }, null, 2) + '\n';
const workshop = (title: string, year: number) => JSON.stringify({ title, repo: title.replace(/ /g, '_'), year }, null, 2) + '\n';
const md = (fm: string, body = 'Body.\n') => `---\n${fm}\n---\n${body}`;

/** Two events on one day (tie broken by id), workshops of one year, a pair
 * tied by translationKey under different names, a Turkish file with no
 * English twin, an English one with no Turkish twin, and one with no title. */
const SYNTHETIC: Record<string, string> = {
  'src/content/events/b-meetup.json': event('b-meetup', '2027-03-06', 'B meetup'),
  'src/content/events/a-meetup.json': event('a-meetup', '2027-03-06', 'A meetup'),
  'src/content/events/old-meetup.json': event('old-meetup', '2019-01-01', 'Old'),
  'src/content/workshops/x-one.json': workshop('X one', 2024),
  'src/content/workshops/x-two.json': workshop('X two', 2024),
  'src/content/workshops/y.json': workshop('Y', 2026),
  'src/content/webinars/en/paired-en.md': md('title: Paired\ndate: 2025-05-05\ntranslationKey: pk'),
  'src/content/webinars/tr/paired-tr-name.md': md('title: Eşli\ndate: 2025-05-05\ntranslationKey: pk'),
  'src/content/webinars/en/same.md': md('title: Same name\ndate: 2024-01-02'),
  'src/content/webinars/tr/same.md': md('title: Aynı ad\ndate: 2024-01-02'),
  'src/content/webinars/tr/only-tr.md': md('title: Yalnız Türkçe\ndate: 2023-03-03'),
  'src/content/webinars/en/only-en.md': md('title: English only\ndate: 2026-06-06'),
  'src/content/webinars/en/untitled.md': md('date: 2022-02-02'),
  'src/content/webinars/en/undated.md': md('title: Undated'),
};

/** Plan 3's types: the index keeps their part exactly as it was; later groups add keys after them. */
const ETKINLIKLER = CMS_TYPES.filter((t) => t.group === 'etkinlikler');

test('the Etkinlikler index is byte-identical to plan 3\'s, for this checkout, with and without shas', async () => {
  const files = checkout();
  const shas = await gitBlobShas(files);
  assert.equal(JSON.stringify(buildCmsIndex(files, shas, ETKINLIKLER)), JSON.stringify(buildCmsIndexV1(files, shas)));
  assert.equal(JSON.stringify(buildCmsIndex(files, undefined, ETKINLIKLER)), JSON.stringify(buildCmsIndexV1(files)));
});

test('the Etkinlikler index is byte-identical to plan 3\'s for the edge cases', async () => {
  const shas = await gitBlobShas(SYNTHETIC);
  const now = JSON.stringify(buildCmsIndex(SYNTHETIC, shas, ETKINLIKLER));
  assert.equal(now, JSON.stringify(buildCmsIndexV1(SYNTHETIC, shas)));
  // And the cases are really in it.
  const index = JSON.parse(now);
  assert.deepEqual(index.events.map((e: { id: string }) => e.id), ['a-meetup', 'b-meetup', 'old-meetup']);
  assert.ok(index.webinars.some((w: { id: string; paths: unknown }) => w.id === 'paired-en' && JSON.stringify(w.paths) === JSON.stringify({ en: 'src/content/webinars/en/paired-en.md', tr: 'src/content/webinars/tr/paired-tr-name.md' })));
  assert.ok(index.webinars.some((w: { id: string; paths: { en: unknown } }) => w.id === 'only-tr' && w.paths.en === null));
  assert.equal(index.webinars.find((w: { id: string }) => w.id === 'untitled').title, 'untitled');
});

test('any registered type is listed from its own dir, format and extractors', () => {
  const posts = defineType({
    key: 'posts' as CmsTypeKey,
    group: 'yazilar',
    dir: 'src/content/posts',
    format: 'json',
    schema: z.object({ name: z.string() }),
    idFrom: () => 'x',
    idField: 'name',
    indexTitle: (d: { name: string }) => d.name,
    label: { en: 'Posts', tr: 'Yazılar' },
  });
  const files = {
    'src/content/posts/b.json': '{"name":"Bee"}',
    'src/content/posts/a.json': '{"name":"Ay"}',
    'src/content/posts/nested/c.json': '{"name":"not a direct child"}',
    'src/content/events/a-meetup.json': SYNTHETIC['src/content/events/a-meetup.json'],
  };
  const index = buildCmsIndex(files, undefined, [...CMS_TYPES, posts]) as Record<string, unknown>;
  assert.deepEqual(Object.keys(index), [...CMS_TYPES.map((t) => t.key), 'posts']);
  // No indexDate: no date, ordered by id.
  assert.deepEqual(index.posts, [{ id: 'a', title: 'Ay' }, { id: 'b', title: 'Bee' }]);
});

test('/cms-index.json reads every registered type\'s files', () => {
  // import.meta.glob takes literal patterns, so the page cannot read the
  // registry; this keeps the two in step.
  const page = readFileSync(`${ROOT}src/pages/cms-index.json.ts`, 'utf8');
  for (const t of CMS_TYPES) {
    const pattern = t.format === 'json' ? `'/${t.dir}/*.json'` : `'/${t.dir}/*/*.md'`;
    assert.ok(page.includes(pattern), `${t.key}: ${pattern}`);
  }
});

test('committees are listed by file name with their English name, no date', () => {
  const dir = 'src/content/committees';
  const files = Object.fromEntries(readdirSync(`${ROOT}${dir}`).map((f) => [`${dir}/${f}`, readFileSync(`${ROOT}${dir}/${f}`, 'utf8')]));
  const index = buildCmsIndex(files);
  const expected = Object.entries(files).map(([p, text]) => ({ id: p.slice(dir.length + 1, -'.json'.length), title: JSON.parse(text).name.en }))
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(index.committees, expected);
});

test('resources are listed by file name with their English title and their section, no date', () => {
  const dir = 'src/content/resources';
  const files = Object.fromEntries(readdirSync(`${ROOT}${dir}`).map((f) => [`${dir}/${f}`, readFileSync(`${ROOT}${dir}/${f}`, 'utf8')]));
  const index = buildCmsIndex(files);
  const expected = Object.entries(files).map(([p, text]) => {
    const d = JSON.parse(text);
    return { id: p.slice(dir.length + 1, -'.json'.length), title: d.title.en, section: d.section };
  }).sort((a, b) => a.id.localeCompare(b.id));
  assert.ok(expected.length > 0);
  assert.deepEqual(index.resources, expected);
});

test('learning-path entries pair by file name (they have no translationKey), titled from their own keys (A5)', () => {
  const fm = (lines: string[]) => md(lines.join('\n'), '');
  const files: Record<string, string> = {
    'src/content/lp-domains/en/fx.md': fm(['name: "Fixture"', 'emoji: "🧪"', 'tagline: "T"', 'order: 1', 'goDeeper: []']),
    'src/content/lp-domains/tr/fx.md': fm(['name: "Örnek"', 'emoji: "🧪"', 'tagline: "T"', 'order: 1', 'goDeeper: []']),
    'src/content/lp-levels/en/fx-explorer.md': fm(['domain: "fx"', 'level: "explorer"', 'orientation: "O"', 'prerequisites: []', 'sections: []']),
    'src/content/lp-levels/tr/fx-explorer.md': fm(['domain: "fx"', 'level: "explorer"', 'orientation: "G"', 'prerequisites: []', 'sections: []']),
    'src/content/lp-roadmap/en/03-try.md': fm(['number: 3', 'emoji: "🧪"', 'title: "Try"', 'subtitle: "S"', 'color: "red"', 'resources: []']),
    'src/content/lp-roadmap/tr/03-try.md': fm(['number: 3', 'emoji: "🧪"', 'title: "Dene"', 'subtitle: "S"', 'color: "red"', 'resources: []']),
    'src/content/lp-roadmap/en/01-start.md': fm(['number: 1', 'emoji: "🧪"', 'title: "Start"', 'subtitle: "S"', 'color: "navy"', 'resources: []']),
    'src/content/lp-roadmap/tr/01-start.md': fm(['number: 1', 'emoji: "🧪"', 'title: "Başla"', 'subtitle: "S"', 'color: "navy"', 'resources: []']),
  };
  const index = buildCmsIndex(files);
  const pathsOf = (dir: string, id: string) => ({ en: `src/content/${dir}/en/${id}.md`, tr: `src/content/${dir}/tr/${id}.md` });
  assert.deepEqual(index['lp-domains'], [{ id: 'fx', title: 'Fixture', paths: pathsOf('lp-domains', 'fx') }]);
  assert.deepEqual(index['lp-levels'], [{ id: 'fx-explorer', title: 'fx · explorer', paths: pathsOf('lp-levels', 'fx-explorer') }]);
  // The roadmap in its order: by file name, which starts with the number.
  assert.deepEqual(index['lp-roadmap'], [
    { id: '01-start', title: '1. Start', paths: pathsOf('lp-roadmap', '01-start') },
    { id: '03-try', title: '3. Try', paths: pathsOf('lp-roadmap', '03-try') },
  ]);
});
