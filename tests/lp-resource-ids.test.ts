import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Learning-path progress is saved under each resource's id, in the browser and
 * in D1. Ids used to be positions, so inserting a card moved every member's
 * ticks onto the wrong resources. Now they are written in the content, and
 * these checks keep them usable as keys.
 */

const ROOT = new URL('../src/content/', import.meta.url).pathname;
// The same rule functions/api/progress.ts applies; an id it rejects is never saved.
const SAVABLE = /^[a-z0-9_-]+$/i;

// What must be the same in both languages; only title and description are translated.
const SHARED = ['tag', 'url', 'webinarSlug', 'youtubeUrl', 'speaker', 'year'] as const;
type Resource = { id: string } & Partial<Record<(typeof SHARED)[number], string>>;

/**
 * Each resource in file order. Read line by line rather than with a YAML
 * parser (none is a dependency): a resource starts at its `- id:` line, and a
 * resource with no id (an indented `title:` with none above it) reads as "".
 */
function resourceRecords(collection: string, lang: string): Map<string, Resource[]> {
  const out = new Map<string, Resource[]>();
  for (const name of readdirSync(`${ROOT}${collection}/${lang}`).filter((n) => n.endsWith('.md'))) {
    const front = readFileSync(`${ROOT}${collection}/${lang}/${name}`, 'utf8').split(/^---$/m)[1];
    const list: Resource[] = [];
    let current: Resource | null = null;
    for (const line of front.split('\n')) {
      const id = line.match(/^\s+- id: "([^"]*)"\s*$/);
      if (id) { current = { id: id[1] }; list.push(current); continue; }
      if (/^\s+- title: /.test(line)) { current = { id: '' }; list.push(current); continue; }
      if (/^\s+- type: /.test(line)) { current = null; continue; }
      const field = line.match(/^\s+(\w+): "?(.*?)"?\s*$/);
      if (current && field && (SHARED as readonly string[]).includes(field[1])) {
        current[field[1] as (typeof SHARED)[number]] = field[2];
      }
    }
    out.set(name, list);
  }
  return out;
}
const resourcesOf = (collection: string, lang: string) =>
  new Map([...resourceRecords(collection, lang)].map(([file, list]) => [file, list.map((r) => r.id)]));

test('every learning-path resource has an id the progress API will save', () => {
  for (const collection of ['lp-levels', 'lp-roadmap']) {
    for (const lang of ['en', 'tr']) {
      for (const [file, ids] of resourcesOf(collection, lang)) {
        for (const id of ids) {
          // progress.ts allows 120; Turkish pages add "tr-".
          assert.ok(SAVABLE.test(id) && id.length <= 110, `${collection}/${lang}/${file}: bad id "${id}"`);
        }
      }
    }
  }
});

test('ids are unique across all learning paths and the roadmap', () => {
  // One namespace: the progress table has a row per (user, id), whatever page it came from.
  const seen = new Map<string, string>();
  for (const collection of ['lp-levels', 'lp-roadmap']) {
    for (const [file, ids] of resourcesOf(collection, 'en')) {
      for (const id of ids) {
        assert.ok(!seen.has(id), `"${id}" is in both ${seen.get(id)} and ${collection}/${file}`);
        seen.set(id, `${collection}/${file}`);
      }
    }
  }
  assert.ok(seen.size > 100, `expected the full set, found ${seen.size}`);
});

test('the Turkish file carries the same ids in the same order as the English one', () => {
  for (const collection of ['lp-levels', 'lp-roadmap']) {
    const en = resourcesOf(collection, 'en');
    const tr = resourcesOf(collection, 'tr');
    for (const [file, ids] of en) {
      assert.deepEqual(tr.get(file), ids, `${collection}/tr/${file} differs from en/`);
    }
  }
});

test('a resource links to the same place in both languages', () => {
  // A link fixed in one language only is how the two drift: the next #35 would
  // be half-repaired. Site-relative links differ by their /tr prefix alone.
  for (const collection of ['lp-levels', 'lp-roadmap']) {
    const en = resourceRecords(collection, 'en');
    const tr = resourceRecords(collection, 'tr');
    for (const [file, list] of en) {
      const twins = tr.get(file) ?? [];
      list.forEach((r, i) => {
        const t = { ...twins[i] };
        if (t.url?.startsWith('/tr/')) t.url = t.url.slice(3);
        for (const key of SHARED) {
          assert.equal(t[key], r[key], `${collection}/${file} ${r.id}: ${key} is "${r[key]}" in en/ but "${twins[i]?.[key]}" in tr/`);
        }
      });
    }
  }
});
