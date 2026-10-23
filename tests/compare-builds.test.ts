import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareBuilds } from '../scripts/compare-builds';

function build(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cb-'));
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

test('a changed asset hash is not a difference', () => {
  const a = build({ 'index.html': '<link href="/_astro/index.Bx3k9aZq.css"><script src="/_astro/app.D41d8cd9.js">' });
  const b = build({ 'index.html': '<link href="/_astro/index.Qq77xx01.css"><script src="/_astro/app.99aa88bb.js">' });
  assert.deepEqual(compareBuilds(a, b), { changed: [], added: [], removed: [] });
});

test('a changed paragraph is listed', () => {
  const a = build({ 'a/index.html': '<p>one</p>', 'b.txt': 'x' });
  const b = build({ 'a/index.html': '<p>two</p>', 'b.txt': 'x' });
  assert.deepEqual(compareBuilds(a, b).changed, ['a/index.html']);
});

test('a file in only one build is added or removed', () => {
  const a = build({ 'old.xml': '<a/>', 'same.html': 'x' });
  const b = build({ 'new.txt': 'n', 'same.html': 'x' });
  const r = compareBuilds(a, b);
  assert.deepEqual(r.added, ['new.txt']);
  assert.deepEqual(r.removed, ['old.xml']);
});
