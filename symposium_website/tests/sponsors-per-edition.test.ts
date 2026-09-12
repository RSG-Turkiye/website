import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sponsors, getSponsorsByEdition, getPastSponsors } from '../src/data/sponsors';

/**
 * A sponsor is listed against the edition it actually supported.
 *
 * Every entry used to say `editions: [2023, 2024]`. The four names came off
 * the 2023 page and the second year was assumed, so three companies were
 * credited with an edition they had nothing to do with, and the three that
 * did back 2024 were missing. The reports RSG sent to the ISCB Student
 * Council name them; this pins what those reports say, because the failure
 * mode is silent and nobody reading the page could tell.
 */

const REPORTED = {
  // 2023: "Special thanks to HIBIT 2023, PhiTech, Genomize, ERES
  // Biotechnology, Gen-Era, ATO, and ISCB-SC."
  2023: ['PhiTech', 'Genomize', 'ERES Biyoteknoloji', 'Gen-Era', 'Ankara Chamber of Commerce'],
  // 2024: Pendik Municipality for the venue, and career presentations "by our
  // esteemed sponsors, Eres Biotechnology and the Systems Biology and
  // Bioinformatics Association".
  2024: ['Pendik Municipality', 'ERES Biyoteknoloji', 'Systems Biology and Bioinformatics Association'],
} as const;

test('each edition credits exactly the sponsors its report names', () => {
  for (const [year, expected] of Object.entries(REPORTED)) {
    const got = getSponsorsByEdition(Number(year)).map((s) => s.name).sort();
    assert.deepEqual(got, [...expected].sort(), `sponsors of ${year}`);
  }
});

test('no sponsor is credited with an edition that has not happened', () => {
  // The 2026 symposium has no sponsors yet. Carrying one over from an earlier
  // year would name a company as a backer of an event it has not agreed to
  // back, which is what the old getSponsorsForOrLatest did.
  assert.deepEqual(getSponsorsByEdition(2026), []);
  assert.ok(getPastSponsors(2026).length >= 5, 'past supporters should still be listed');
});

test('every sponsor has a name and at least one edition', () => {
  for (const s of sponsors) {
    assert.ok(s.name.trim(), 'a sponsor with no name');
    assert.ok(s.editions.length > 0, `${s.name} supports no edition`);
    assert.ok(!s.logo || s.logo.startsWith('https://'), `${s.name}: logo is not an https URL`);
    assert.ok(!s.url || s.url.startsWith('https://'), `${s.name}: url is not an https URL`);
  }
});

test('an edition page shows the sponsors of that edition and no others', {
  skip: !existsSync(join(new URL('../', import.meta.url).pathname, 'dist')) && 'run `npm run build` first',
}, () => {
  const dist = join(new URL('../', import.meta.url).pathname, 'dist');
  const page = (path: string) => readFileSync(join(dist, path, 'index.html'), 'utf8');

  for (const prefix of ['editions', 'tr/editions']) {
    const y2024 = page(`${prefix}/2024`);
    assert.match(y2024, /Pendik Municipality/, `${prefix}/2024 should credit Pendik`);
    assert.doesNotMatch(y2024, /Gen-Era/, `${prefix}/2024 should not credit a 2023 supporter`);

    const y2023 = page(`${prefix}/2023`);
    assert.match(y2023, /Gen-Era/, `${prefix}/2023 should credit Gen-Era`);
    assert.doesNotMatch(y2023, /Pendik Municipality/, `${prefix}/2023 should not credit a 2024 supporter`);
  }

  // 2025 has no recorded sponsors, so the section is absent rather than empty.
  assert.doesNotMatch(page('editions/2025'), /Pendik Municipality|Gen-Era|PhiTech/);
});
