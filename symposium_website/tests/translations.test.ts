import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// The Turkish edition pages rendered English prose for years because the body
// only ever existed once. Now it exists twice, which means it can also drift:
// add an edition and forget the translation and the page quietly falls back to
// English again -- working, and wrong.

const years = (dir: string) =>
  readdirSync(dir).filter((f) => f.endsWith('.md')).map((f) => f.replace('.md', '')).sort();

test('every edition has a Turkish body', () => {
  const en = years('src/content/editions');
  const tr = years('src/content/editions-tr');
  assert.deepEqual(en.filter((y) => !tr.includes(y)), [], 'editions with no Turkish body');
});

test('no Turkish body is left behind for an edition that no longer exists', () => {
  const en = years('src/content/editions');
  const tr = years('src/content/editions-tr');
  assert.deepEqual(tr.filter((y) => !en.includes(y)), []);
});

test('a Turkish body declares the year its filename claims', () => {
  // The page pairs them on the `year` field, not the filename, so a mismatch
  // would silently serve one edition's prose on another's page.
  const offenders: string[] = [];
  for (const y of years('src/content/editions-tr')) {
    const text = readFileSync(`src/content/editions-tr/${y}.md`, 'utf8');
    const m = /^year:\s*(\d{4})\s*$/m.exec(text);
    if (!m || m[1] !== y) offenders.push(`${y}.md declares ${m?.[1] ?? 'nothing'}`);
  }
  assert.deepEqual(offenders, []);
});
