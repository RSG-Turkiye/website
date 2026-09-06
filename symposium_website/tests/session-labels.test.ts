import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ui } from '../src/i18n/ui';

/**
 * Every session type has a label, in both languages.
 *
 * SessionRow printed `session.type` straight out of the JSON, so a Turkish
 * reader of /tr/schedule got "Keynote", "Break" and "Networking" in the
 * middle of a Turkish programme. The badge is translated now, which means a
 * type with no key renders the key itself -- "session.type.poster" in a
 * coloured pill -- and nothing else would report it.
 *
 * The list is not written out here. It is read from the Zod enum in
 * content.config.ts, which is the thing that decides what a session type can
 * be, so adding one to the schema asks for its two labels.
 */

const CONFIG = new URL('../src/content.config.ts', import.meta.url).pathname;

test('the schema and the translations agree on the session types', () => {
  const source = readFileSync(CONFIG, 'utf8');
  const enumLine = /type:\s*z\.enum\(\[([^\]]+)\]\)/.exec(source);
  assert.ok(enumLine, 'could not find the session type enum in content.config.ts');

  const types = [...enumLine[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(types.length >= 8, `expected the session types, found ${types.length}`);

  const missing: string[] = [];
  for (const lang of ['en', 'tr'] as const) {
    for (const type of types) {
      const key = `session.type.${type}` as keyof (typeof ui)['en'];
      const label = (ui[lang] as Record<string, string>)[key];
      if (!label) missing.push(`${lang}: ${key}`);
      else if (label === key) missing.push(`${lang}: ${key} is its own key`);
    }
  }
  assert.deepEqual(missing, [], `a session type would render as its key:\n    ${missing.join('\n    ')}\n  `);
});

test('the two languages do not simply share the English labels', () => {
  // A "translation" that copies the English is the bug wearing a hat. Panel
  // and Poster are the same word in Turkish and are allowed to be.
  const same = ['opening', 'keynote', 'workshop', 'talk', 'networking', 'break', 'closing'].filter(
    (type) =>
      (ui.en as Record<string, string>)[`session.type.${type}`] ===
      (ui.tr as Record<string, string>)[`session.type.${type}`],
  );
  assert.deepEqual(same, [], `still English in Turkish: ${same.join(', ')}`);
});

/**
 * Cloudflare Pages serves the 404.html nearest the requested path. There was
 * one 404, built once, and getLangFromUrl saw "/404" -- so it answered in
 * English wherever it appeared, and its one button led out of Turkish.
 */
test('there is a Turkish 404 where Cloudflare Pages will look for it', () => {
  const dist = new URL('../dist/', import.meta.url).pathname;
  if (!existsSync(dist)) return; // CI builds before it tests; a fresh clone has none
  assert.ok(existsSync(`${dist}404.html`), 'the root 404 is still emitted');
  assert.ok(existsSync(`${dist}tr/404.html`), 'dist/tr/404.html is missing; /tr/* would answer in English');
  assert.match(readFileSync(`${dist}tr/404.html`, 'utf8'), /Sayfa Bulunamad/);
});
