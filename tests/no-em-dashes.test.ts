import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';

/**
 * No em dash in anything a reader sees.
 *
 * There were 721 of them across the two sites, and Emre's objection was not
 * typographic: a page built out of "X — the thing that explains X" reads as
 * machine-written, and most of these were. They are now commas, colons,
 * parentheses or full stops, chosen per sentence.
 *
 * This covers content collections, the translation tables, page and component
 * copy, and the shared data modules. Not code comments, which no reader sees,
 * and not the one deliberate use: an em dash standing in for an empty cell in
 * the admin table, where it is a typographic placeholder rather than prose.
 *
 * The en dash (–) is untouched and allowed: it is the correct character in a
 * date or number range, and "30 Ekim – 2 Kasım" is not what this is about.
 */

const REPO = new URL('../', import.meta.url).pathname;

const ROOTS = [
  'src/content',
  'src/i18n',
  'src/pages',
  'src/components',
  'src/data',
  'symposium_website/src/content',
  'symposium_website/src/i18n',
  'symposium_website/src/pages',
  'symposium_website/src/components',
  'symposium_website/src/data',
];

/** A line that is only a code comment, or the admin table's empty-cell mark. */
function exempt(line: string): boolean {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return true;
  // `u.display_name || '—'` -- a dash standing in for a missing value.
  if (/\|\|\s*['"`]—['"`]/.test(line)) return true;
  return false;
}

test('no em dash appears in anything a reader sees', () => {
  const offenders: string[] = [];
  let scanned = 0;

  for (const root of ROOTS) {
    let files: string[] = [];
    try {
      files = globSync('**/*.{md,ts,tsx,astro,json}', { cwd: join(REPO, root) });
    } catch {
      continue; // a root that does not exist in this checkout
    }
    for (const rel of files) {
      scanned++;
      const lines = readFileSync(join(REPO, root, rel), 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (line.includes('—') && !exempt(line)) {
          offenders.push(`${root}/${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
        }
      });
    }
  }

  assert.ok(scanned > 200, `expected the content and page files, scanned ${scanned}`);

  const shown = offenders.slice(0, 12);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} em dash(es) in reader-facing text. Use a comma, a ` +
      `colon, parentheses or a full stop -- whichever the sentence wants:\n    ` +
      `${shown.join('\n    ')}` +
      `${offenders.length > shown.length ? `\n    ... and ${offenders.length - shown.length} more` : ''}\n  `,
  );
});

test('the en dash is still allowed, because date ranges need it', () => {
  // Guarding against an over-zealous fix that removes both characters: the
  // edition dates read "30 Ekim – 2 Kasım 2025" and should keep doing so.
  const editions = join(REPO, 'symposium_website/src/content/editions');
  const withRange = globSync('*.md', { cwd: editions })
    .map((f) => readFileSync(join(editions, f), 'utf8'))
    .filter((t) => /date:.*–/.test(t));
  assert.ok(
    withRange.length >= 3,
    `expected multi-day editions to keep their en dashes, found ${withRange.length}`,
  );
});
