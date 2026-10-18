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

/**
 * Each resource's id, in file order. Read line by line rather than with a YAML
 * parser (none is a dependency): a resource is an indented `title:` line, and
 * its id is the `- id:` line just above it. A resource without one reads as "".
 */
function resourcesOf(collection: string, lang: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const name of readdirSync(`${ROOT}${collection}/${lang}`).filter((n) => n.endsWith('.md'))) {
    const front = readFileSync(`${ROOT}${collection}/${lang}/${name}`, 'utf8').split(/^---$/m)[1];
    const ids: string[] = [];
    let pending: string | null = null;
    for (const line of front.split('\n')) {
      const id = line.match(/^\s+- id: "([^"]*)"\s*$/);
      if (id) { pending = id[1]; continue; }
      if (/^\s+(- )?title: /.test(line)) { ids.push(pending ?? ''); pending = null; }
    }
    out.set(name, ids);
  }
  return out;
}

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
