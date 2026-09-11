import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { sponsors, getSponsorsByEdition, getPastSponsors } from '../src/data/sponsors';

/**
 * A past sponsor is never presented as a current one.
 *
 * The site used to fall back: asked for the upcoming edition's sponsors and
 * given none, it showed the last edition that had any -- so PhiTech,
 * Genomize, ERES and the Ankara Chamber of Commerce sat under "Our
 * Sponsors" on a page about the 2026 symposium. They had sponsored 2023 and
 * 2024. Nothing on the page said so, and nobody reading it could tell it
 * was naming firms as backers of an event they had not agreed to back.
 *
 * The pure functions are checked directly; the rendered pages are checked
 * because the mistake was never in the data, it was in what the pages did
 * with it.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(DIST + 'index.html');
const html = (page: string) => readFileSync(DIST + page, 'utf8');

const YEAR = 2026;

test('the fixture this rests on: nobody sponsors the upcoming edition yet', () => {
  // When 2026 gains a sponsor these tests still hold, but the interesting
  // case -- an empty current list beside a full past one -- stops being
  // exercised, and this says so rather than passing quietly.
  assert.equal(getSponsorsByEdition(YEAR).length, 0,
    'a 2026 sponsor was added; the empty-state assertions below no longer test anything');
  assert.ok(getPastSponsors(YEAR).length >= 3, 'expected the 2023/2024 sponsors');
});

test('getPastSponsors excludes anyone sponsoring the edition asked about', () => {
  // The one thing that must never be true: a current sponsor listed as past.
  const current = new Set(getSponsorsByEdition(2024).map((s) => s.name));
  for (const { sponsor } of getPastSponsors(2024)) {
    assert.ok(!current.has(sponsor.name), `${sponsor.name} is both current and past for 2024`);
  }
});

test('getPastSponsors reports only the years before the one asked about', () => {
  for (const { sponsor, years } of getPastSponsors(2024)) {
    for (const y of years) assert.ok(y < 2024, `${sponsor.name} listed under ${y}, which is not past for 2024`);
  }
});

test('the newest supporter comes first, and ties break by name', () => {
  const rows = getPastSponsors(YEAR);
  const keys = rows.map((r) => [-r.years[0], r.sponsor.name] as const);
  const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  assert.deepEqual(keys, sorted, 'order depends on the order of the sponsors array');
});

test('no past-only sponsor appears on the home page', { skip: !built && 'no build in dist/' }, () => {
  const pastOnly = sponsors.filter((s) => !s.editions.includes(YEAR)).map((s) => s.name);
  assert.ok(pastOnly.length > 0, 'expected some past-only sponsors to check for');
  for (const page of ['index.html', 'tr/index.html']) {
    const body = html(page);
    for (const name of pastOnly) {
      assert.ok(!body.includes(name), `${page} shows ${name}, who has not sponsored ${YEAR}`);
    }
  }
});

test('the sponsors page says which edition each past supporter backed', { skip: !built && 'no build in dist/' }, () => {
  for (const page of ['sponsors/index.html', 'tr/sponsors/index.html']) {
    const body = html(page);
    for (const { sponsor, years } of getPastSponsors(YEAR)) {
      assert.ok(body.includes(sponsor.name), `${page} is missing ${sponsor.name}`);
      assert.ok(body.includes(years.join(', ')),
        `${page} names ${sponsor.name} without saying which edition they sponsored`);
    }
  }
});

test('the sponsors page separates the two, in both languages', { skip: !built && 'no build in dist/' }, () => {
  // Headings, not just presence: the whole fix is that the reader can tell
  // which list is which.
  const headings = (page: string) =>
    [...html(page).matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1]);
  assert.deepEqual(headings('sponsors/index.html'),
    ['Sponsors of the 2026 symposium', 'Those who have supported us']);
  assert.deepEqual(headings('tr/sponsors/index.html'),
    ['2026 sempozyumunun sponsorları', 'Bize destek olanlar']);
});
