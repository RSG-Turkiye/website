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
    // Both name fields. A hall written only in Turkish is exactly as
    // published as one written only in English, and `venueTr` was added
    // after this rule -- a check that knew about one field and not the
    // other would read as passing while the name sat in the file.
    for (const field of ['venue', 'venueTr'] as const) {
      assert.equal(
        fields[field] ?? '',
        '',
        `${file} withholds its venue and still records the name in ${field}. ` +
          `The site shows "venue to be announced" from venuePublic alone; the ` +
          `name belongs wherever the organisers keep it until the day it is ` +
          `announced, and this repository is public.`,
      );
    }
  }
});

test('2026 announces its hall, and announces it consistently', () => {
  // This edition is why the rule above exists: its hall was withheld from
  // 2026-09-06 until the organisers announced it on 2026-09-10. It is kept
  // here as the worked example of the other state -- announced -- because
  // the halfway house is what goes wrong: a name recorded with the flag
  // still off, or a translation with no canonical name behind it.
  const fields = frontmatter(readFileSync(join(EDITIONS, '2026.md'), 'utf8'));
  assert.equal(fields.venuePublic, 'true', 'the hall is announced');
  assert.ok(fields.venue, 'so the canonical name is recorded');
  assert.ok(fields.venueTr, 'and the Turkish one, since both pages print it');
  assert.equal(fields.cityPublic, 'true');
  assert.equal(fields.venueCity, 'Ankara');
});

test('no edition translates a hall it has not named', () => {
  // venueTr is the translation of venue, never a substitute: locationFor
  // decides whether a hall exists from `venue` alone, so a venueTr with no
  // venue behind it would print on the Turkish pages and nowhere else.
  for (const file of editionFiles) {
    const fields = frontmatter(readFileSync(join(EDITIONS, file), 'utf8'));
    if (!fields.venueTr) continue;
    assert.ok(fields.venue, `${file} has venueTr but no venue`);
  }
});

test('no edition translates a city it has not named', () => {
  // The same rule as venueTr, for the same reason. `venueCity` alone decides
  // whether a city may be shown -- cityPublic gates it and locationFor reads
  // it -- so a venueCityTr with nothing behind it would appear on the Turkish
  // pages while the English ones said nothing, and a withheld city would leak
  // in one language only.
  for (const file of editionFiles) {
    const fields = frontmatter(readFileSync(join(EDITIONS, file), 'utf8'));
    if (!fields.venueCityTr) continue;
    assert.ok(fields.venueCity, `${file} has venueCityTr but no venueCity`);
  }
});

test('no Turkish page is left printing an English city name', () => {
  // Four editions read "Istanbul" and "Online" under Turkish headings for as
  // long as the site had no venueCityTr. The city is one of three words on an
  // edition card, so it is half the card. This lists the spellings that are
  // wrong in Turkish rather than trying to detect translation in general:
  // "Ankara", "Antalya", "İzmir" and "Güzelyurt" are already the same in
  // both, and asking for a translation of those would invite a pointless one.
  const needsTurkish: Record<string, string> = {
    Istanbul: 'İstanbul',
    Online: 'Çevrimiçi',
    Cappadocia: 'Kapadokya',
    Izmir: 'İzmir',
  };
  for (const file of editionFiles) {
    const fields = frontmatter(readFileSync(join(EDITIONS, file), 'utf8'));
    const want = needsTurkish[fields.venueCity ?? ''];
    if (!want) continue;
    assert.equal(
      fields.venueCityTr ?? '',
      want,
      `${file} has venueCity "${fields.venueCity}", which is not how it is ` +
        `written in Turkish. Set venueCityTr: "${want}" so the Turkish ` +
        `edition card and hero do not print the English spelling.`,
    );
  }
});
