import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../src/i18n/ui';
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

test('every edition with a date has a Turkish one', () => {
  // The date is a hand-written string, so it needs its own translation the
  // way the title and subtitle do. Without one the Turkish page prints
  // "October 30 - November 2, 2025" under a Turkish heading.
  const offenders: string[] = [];
  for (const f of readdirSync('src/content/editions').filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(`src/content/editions/${f}`, 'utf8');
    if (/^date:\s*\S/m.test(text) && !/^dateTr:\s*\S/m.test(text)) offenders.push(f);
  }
  assert.deepEqual(offenders, []);
});

// --- the UI dictionary itself --------------------------------------------

test('every interface string exists in both languages', () => {
  // `t()` falls back to English for a key the Turkish table lacks, so a
  // missing translation renders an English sentence in a Turkish page and
  // nothing anywhere reports it -- not a type error, not a build warning,
  // not a visibly broken page. Fifteen keys were added for the venue
  // directions and the only thing standing between that and a half-English
  // page was remembering to paste them twice.
  const en = Object.keys(ui.en);
  const tr = Object.keys(ui.tr);
  // A floor, not a count: this only has to notice an import that came back
  // empty. Pinning the exact number would fail on every new string.
  assert.ok(en.length > 50, `expected the dictionary, found ${en.length} keys`);

  const missingTr = en.filter((k) => !(k in ui.tr));
  const missingEn = tr.filter((k) => !(k in ui.en));
  assert.deepEqual(missingTr, [], 'these keys have no Turkish translation');
  assert.deepEqual(missingEn, [], 'these keys exist only in Turkish');
});
