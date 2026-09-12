import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { FOUNDED_YEAR, yearsSinceFounding } from '../src/data/events';

/**
 * Two things that were written by hand in dozens of places and drifted.
 *
 * The abbreviation: the hero said "ISCB-SC RSG-Turkiye" and the footer's
 * tagline, the copyright line, the page descriptions and the Event structured
 * data all said "ISCB SC" without the hyphen -- the same name, spelled two
 * ways, sometimes on the same page.
 *
 * The founding year: the homepage counter read a flat "10+" since the site
 * was built. The group turned ten in 2021.
 */

const ROOTS = ['src', 'symposium_website/src', 'functions'];
const REPO = new URL('../', import.meta.url).pathname;

test('the abbreviation is hyphenated everywhere', () => {
  const offenders: string[] = [];
  for (const root of ROOTS) {
    for (const rel of globSync('**/*.{ts,astro,md,tsx,js}', { cwd: join(REPO, root) })) {
      const text = readFileSync(join(REPO, root, rel), 'utf8');
      // Word boundary on both sides: "ISCB SCHOOL" or a sentence ending
      // "...the ISCB" followed by "SC..." are not this.
      if (/\bISCB SC\b/.test(text)) offenders.push(`${root}/${rel}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `These write the abbreviation as "ISCB SC". It is "ISCB-SC" on the hero, ` +
      `in both footers and in the structured data:\n    ${offenders.join('\n    ')}\n  `,
  );
});

test('the founding year is 2011, and the counter is derived from it', () => {
  assert.equal(FOUNDED_YEAR, 2011);
  assert.equal(yearsSinceFounding(new Date('2021-06-01')), 10);
  assert.equal(yearsSinceFounding(new Date('2026-09-12')), 15);
  // It moves on its own, which is the whole point.
  assert.equal(yearsSinceFounding(new Date('2031-01-01')), 20);
});

test('no page hard-codes the years-since-founding counter', () => {
  const offenders = ['src/pages/index.astro', 'src/pages/tr/index.astro'].filter((p) => {
    const text = readFileSync(join(REPO, p), 'utf8');
    return /n:\s*'\d+\+'\s*,\s*label:\s*t\('stats\.years'\)/.test(text);
  });
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(', ')} writes the years counter as a literal. It read ` +
      `"10+" for five years after that stopped being true; use ` +
      `yearsSinceFounding(new Date()).`,
  );
});

test('the founding year and the first symposium are not confused', () => {
  // "Since 2012" on the symposium site is about the symposiums, and is right:
  // the first was in Cappadocia in April 2012. The stat labelled "founding
  // year" is about the group, and is 2011. This checks the stat blocks only.
  for (const page of [
    'symposium_website/src/pages/index.astro',
    'symposium_website/src/pages/about.astro',
    'symposium_website/src/pages/tr/index.astro',
    'symposium_website/src/pages/tr/about.astro',
  ]) {
    const text = readFileSync(join(REPO, page), 'utf8');
    const stat = /label:[^,]*"Kuruluş Yılı"[^}]*value:\s*"(\d{4})"/.exec(text);
    assert.ok(stat, `${page} no longer has a founding-year stat`);
    assert.equal(stat![1], String(FOUNDED_YEAR), `${page} founding-year stat`);
  }
});
