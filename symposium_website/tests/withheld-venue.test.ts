import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A hall that is not being announced must not be in this repository.
 *
 * The repository is public. On 2026-09-06 two independent reviews found the
 * 2026 hall committed in plain text in an edition file, a test fixture and
 * three planning documents, while every rendered page correctly said "venue to
 * be announced". The secret was never leaked by the site; it was published by
 * the source.
 *
 * The reason it was there is worth keeping in mind, because it was not
 * carelessness: `locationFor` used to decide "withheld" by finding a venue
 * string that was not public, so committing the hall was the only way to make
 * the site say the city now and the hall later. That rule has moved to the
 * flag, and this test is what stops the old habit coming back -- a comment in
 * the file would not.
 *
 * It reads the markdown directly rather than through Astro's content API so
 * that it also catches a hall in a file that fails to parse, and so it cannot
 * be satisfied by a schema default.
 */

const EDITIONS = new URL('../src/content/editions/', import.meta.url).pathname;

function frontmatter(text: string): Record<string, string> {
  const end = text.indexOf('\n---', 4);
  const block = text.slice(text.indexOf('---') + 3, end === -1 ? undefined : end);
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (line.trim().startsWith('#')) continue; // a comment, not a field
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return fields;
}

const editionFiles = readdirSync(EDITIONS).filter((f) => f.endsWith('.md'));

test('there is something to check', () => {
  assert.ok(editionFiles.length >= 9, `expected the edition files, found ${editionFiles.length}`);
});

test('no edition names a hall it is not announcing', () => {
  for (const file of editionFiles) {
    const fields = frontmatter(readFileSync(join(EDITIONS, file), 'utf8'));
    if (fields.venuePublic !== 'false') continue;
    assert.equal(
      fields.venue ?? '',
      '',
      `${file} withholds its venue and still records the name. The site shows ` +
        `"venue to be announced" from venuePublic alone; the name belongs ` +
        `wherever the organisers keep it until the day it is announced, and ` +
        `this repository is public.`,
    );
  }
});

test('the 2026 edition is the case this exists for, and it is clean', () => {
  const fields = frontmatter(readFileSync(join(EDITIONS, '2026.md'), 'utf8'));
  assert.equal(fields.venuePublic, 'false', 'the hall is still unannounced');
  assert.equal(fields.venue, '', 'and its name is not here');
  assert.equal(fields.cityPublic, 'true', 'while the city is public, so travel can be booked');
  assert.equal(fields.venueCity, 'Ankara');
});
