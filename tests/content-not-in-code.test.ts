import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Events, workshops, resources and committees live in src/content/*.json so
 * the admin panel can edit them (as pull requests). If a data array comes
 * back into src/data or a page, there are two sources of truth and the panel
 * edits the wrong one. This fails when that happens.
 */

const root = new URL('../', import.meta.url);

for (const name of ['events', 'workshops', 'committees']) {
  test(`src/data/${name}.ts exports no data array`, async () => {
    const mod = (await import(new URL(`src/data/${name}.ts`, root).pathname)) as Record<string, unknown>;
    const arrays = Object.entries(mod).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
    assert.deepEqual(arrays, [], `${name}.ts exports data (${arrays.join(', ')}); it belongs in src/content/${name}/`);
  });
}

test('the resources pages define no literal Resource[] array', () => {
  const pages = ['src/pages/resources.astro', 'src/pages/tr/resources.astro'];
  for (const f of pages) {
    const src = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(src, /Resource\[\]\s*=\s*\[/, `${f} defines a Resource[] literal`);
    assert.doesNotMatch(src, /=\s*\[\s*\{\s*title\s*:/, `${f} defines an array of resource objects`);
  }
});

test('the content directories are not empty', () => {
  for (const d of ['events', 'workshops', 'committees', 'resources']) {
    assert.ok(readdirSync(new URL(`src/content/${d}/`, root)).some((f) => f.endsWith('.json')), d);
  }
});
