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

test('the Etkinlikler index is byte-identical to plan 3\'s, for this checkout, with and without shas', async () => {
  const files = checkout();
  const shas = await gitBlobShas(files);
  assert.equal(JSON.stringify(buildCmsIndex(files, shas, CMS_TYPES)), JSON.stringify(buildCmsIndexV1(files, shas)));
  assert.equal(JSON.stringify(buildCmsIndex(files)), JSON.stringify(buildCmsIndexV1(files)));
});

test('the Etkinlikler index is byte-identical to plan 3\'s for the edge cases', async () => {
  const shas = await gitBlobShas(SYNTHETIC);
  const now = JSON.stringify(buildCmsIndex(SYNTHETIC, shas));
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
  assert.deepEqual(Object.keys(index), ['events', 'workshops', 'webinars', 'posts']);
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
