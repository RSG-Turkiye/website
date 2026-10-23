import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

/**
 * Every file in the JSON content collections is a lowercase slug: the admin
 * panel will create and rename these files, and a name that differs only in
 * case is a different file on Linux and the same one on macOS.
 */

const NAME = /^[a-z0-9-]+\.json$/;

for (const d of ['workshops', 'events', 'resources', 'committees', 'pages']) {
  test(`src/content/${d}: every file name is a lowercase slug ending in .json`, () => {
    const names = readdirSync(new URL(`../src/content/${d}/`, import.meta.url));
    assert.ok(names.length > 0, d);
    for (const f of names) assert.match(f, NAME, `src/content/${d}/${f}`);
  });
}
