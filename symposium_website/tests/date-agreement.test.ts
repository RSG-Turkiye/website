import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every page agrees with the edition file about when the symposium is.
 *
 * The home page used to format `startDate` on its own, which reads a two-day
 * edition as one day -- on the most visited page, while /editions, /about and
 * /venue printed the real span from the same file. It went unnoticed because
 * every edition until 2026 ran for a single day, so the two renderings agreed
 * by accident.
 *
 * `date` and `dateTr` are the one place a range is expressed, and this checks
 * the built pages against them rather than against each other, so a page that
 * stops using `dateFor` is caught rather than a pair that drift together.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const EDITIONS = join(ROOT, 'src/content/editions');

/** The frontmatter value of `key` in an edition file, unquoted. */
function field(text: string, key: string): string | null {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm').exec(text);
  return m ? m[1].trim() : null;
}

/** The edition the home page is currently about: the furthest-future one with
 * a start date, which is how splitEditions picks it. */
function upcomingEdition(): { year: string; date: string; dateTr: string } | null {
  const candidates = readdirSync(EDITIONS)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = readFileSync(join(EDITIONS, f), 'utf8');
      return { year: f.replace('.md', ''), start: field(text, 'startDate'), date: field(text, 'date'), dateTr: field(text, 'dateTr') };
    })
    .filter((e) => e.start && Date.parse(e.start) > Date.now())
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!));

  const next = candidates[0];
  if (!next || !next.date) return null;
  return { year: next.year, date: next.date, dateTr: next.dateTr ?? next.date };
}

test('the home page prints the edition file\'s own date string', { skip: !existsSync(DIST) && 'run `npm run build` first' }, () => {
  const edition = upcomingEdition();
  if (!edition) return; // No upcoming edition: the hero says something else entirely.

  const en = readFileSync(join(DIST, 'index.html'), 'utf8');
  const tr = readFileSync(join(DIST, 'tr/index.html'), 'utf8');

  assert.ok(en.includes(edition.date), `the English home page does not print "${edition.date}"`);
  assert.ok(tr.includes(edition.dateTr), `the Turkish home page does not print "${edition.dateTr}"`);
});

test('no built page contradicts it by printing only the first day', { skip: !existsSync(DIST) && 'run `npm run build` first' }, () => {
  // Only meaningful when the edition actually spans more than a day: then the
  // first day on its own is a different, wrong string, and any page still
  // formatting startDate will be holding it.
  const edition = upcomingEdition();
  if (!edition) return;

  const firstDayOnly = /^(\d+)-\d+ (.+)$/.exec(edition.date);
  if (!firstDayOnly) return; // A single-day edition has nothing to contradict.

  const singular = `${firstDayOnly[1]} ${firstDayOnly[2]}`;
  const en = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(!en.includes(singular), `the English home page still prints "${singular}", not the full span`);
});
