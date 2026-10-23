import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { pageTextSchema, textLookup } from '../src/data/page-text';

/**
 * src/content/pages: the hand-written text of a page, one JSON file per page,
 * each key mapping to `{ en, tr }`. pageText(page, lang) reads it at build
 * time; an unknown key must fail the build rather than render nothing.
 */

const dir = new URL('../src/content/pages/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const raw = files.map((f) => ({ f, json: JSON.parse(readFileSync(dir + f, 'utf8')) }));

test('an unknown key throws, naming the page and the key', () => {
  const t = textLookup('about', { hero_title: { en: 'About', tr: 'Hakkımızda' } }, 'en');
  assert.throws(() => t('hero_titel'), (e: Error) => /about/.test(e.message) && /hero_titel/.test(e.message));
});

test('a known key returns the text in the requested language', () => {
  const record = { hero_title: { en: 'About', tr: 'Hakkımızda' } };
  assert.equal(textLookup('about', record, 'en')('hero_title'), 'About');
  assert.equal(textLookup('about', record, 'tr')('hero_title'), 'Hakkımızda');
});

test('about, home, join and resources exist, validate, and every value has non-empty en and tr', () => {
  assert.deepEqual(files.sort(), ['about.json', 'home.json', 'join.json', 'resources.json']);
  for (const { f, json } of raw) {
    const r = pageTextSchema.safeParse(json);
    assert.ok(r.success, `${f}: ${r.success ? '' : r.error.message}`);
    for (const [key, v] of Object.entries(json as Record<string, { en: string; tr: string }>)) {
      assert.ok(v.en.trim().length > 0, `${f} ${key}: empty en`);
      assert.ok(v.tr.trim().length > 0, `${f} ${key}: empty tr`);
    }
  }
});

test('the schema refuses an empty language or a missing one', () => {
  assert.equal(pageTextSchema.safeParse({ k: { en: 'x', tr: '' } }).success, false);
  assert.equal(pageTextSchema.safeParse({ k: { en: 'x' } }).success, false);
});

test('every key the pages ask for exists in their JSON, and no JSON key is unused', () => {
  const pages: Record<string, string[]> = {
    about: ['src/pages/about.astro', 'src/pages/tr/about.astro'],
    join: ['src/pages/join.astro', 'src/pages/tr/join.astro'],
    home: ['src/pages/index.astro', 'src/pages/tr/index.astro'],
    resources: ['src/pages/resources.astro', 'src/pages/tr/resources.astro'],
  };
  for (const [page, paths] of Object.entries(pages)) {
    const json = JSON.parse(readFileSync(dir + page + '.json', 'utf8'));
    const used = new Set<string>();
    for (const p of paths) {
      const src = readFileSync(new URL('../' + p, import.meta.url), 'utf8');
      assert.match(src, new RegExp(`pageText\\('${page}'`), `${p} does not read ${page}`);
      const keys = [...src.matchAll(/\btx\('([^']+)'\)/g)].map((m) => m[1]);
      for (const k of keys) {
        assert.ok(k in json, `${p}: tx('${k}') is not in ${page}.json`);
        used.add(k);
      }
    }
    for (const k of Object.keys(json)) assert.ok(used.has(k), `${page}.json: ${k} is never used`);
  }
});
