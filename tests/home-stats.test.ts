import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { symposiumCount } from '../src/lib/home-stats';

/**
 * The home page counts what the group has produced, from the data that
 * records it, so the numbers never need editing by hand: the symposium count
 * said "12" for a year after the 13th had taken place.
 */

const EDITIONS = new URL('../symposium_website/src/content/editions/', import.meta.url);

test('a symposium counts once it has started, not when its page is added', () => {
  const editions = [
    { year: 2025, startDate: new Date('2025-10-04') },
    { year: 2026, startDate: new Date('2026-10-10') },
    { year: 2027, startDate: new Date('2027-10-01') },
  ];
  assert.equal(symposiumCount(editions, new Date('2026-10-09')), 1);
  assert.equal(symposiumCount(editions, new Date('2026-10-10')), 2);
  assert.equal(symposiumCount(editions, new Date('2026-12-31')), 2, 'next year\'s page is not counted early');
});

test('an edition page with only a year counts once that year is over', () => {
  assert.equal(symposiumCount([{ year: 2012 }], new Date('2012-06-01')), 0);
  assert.equal(symposiumCount([{ year: 2012 }], new Date('2013-01-01')), 1);
});

test('every edition page names its year, which the count falls back to', () => {
  const files = readdirSync(EDITIONS).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 13);
  for (const f of files) {
    assert.match(readFileSync(new URL(f, EDITIONS), 'utf8'), /^year: \d{4}$/m, f);
  }
});

test('the home pages no longer show a member count', () => {
  for (const page of ['../src/pages/index.astro', '../src/pages/tr/index.astro']) {
    const src = readFileSync(new URL(page, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /500\+|stats\.members/, page);
    assert.match(src, /symposiumCount\(/, page);
  }
});
