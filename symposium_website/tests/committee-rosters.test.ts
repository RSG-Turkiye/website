import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The committed committee rosters carry names, nothing else.
 *
 * Every one of these files was transcribed from a Drive spreadsheet that also
 * held email addresses, phone numbers, t-shirt sizes and attendance notes. The
 * repo is public. The stripping was done by hand once; this is what stops the
 * next person -- volunteer or model -- from pasting a whole sheet in, which is
 * exactly how the 2024 file would have arrived if nobody had looked.
 *
 * Emre's ask was that volunteers fill these in themselves in future. That only
 * works if filling one in wrongly fails loudly.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = join(ROOT, 'src/content/committee');

interface Member {
  name: string;
  role?: string;
  roleTr?: string;
  affiliation?: string;
  photo?: string;
  linkedin?: string;
  teams?: { en?: string; tr?: string }[];
}

function rosters(): { file: string; year: number; people: Member[] }[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const data = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      return { file: f, year: data.year, people: data.people ?? [] };
    });
}

test('the rosters parse and their year matches their filename', () => {
  const all = rosters();
  assert.ok(all.length >= 3, `expected the past-edition rosters, found ${all.length}`);
  for (const { file, year, people } of all) {
    assert.equal(year, Number(file.replace('.json', '')), `${file}: year does not match the filename`);
    assert.ok(people.length > 0, `${file}: no people`);
  }
});

test('no roster carries contact details', () => {
  const offenders: string[] = [];
  for (const { file } of rosters()) {
    const raw = readFileSync(join(DIR, file), 'utf8');
    raw.split('\n').forEach((line, i) => {
      // An email address. LinkedIn URLs are allowed and have no @.
      if (line.includes('@')) offenders.push(`${file}:${i + 1}  email address`);
      // A phone number, however it is punctuated. Years are four digits and
      // survive; 5 331 05 54 11 does not.
      if (/(?:\d[\s()-]*){7,}/.test(line)) offenders.push(`${file}:${i + 1}  phone number`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `contact details in a public roster. Names, affiliations and photos only:\n    ${offenders.join('\n    ')}\n  `,
  );
});

test('every listed person has a full name', () => {
  // A single first name on a card reads as a mistake, and it is: three 2019
  // volunteers are missing from these files for exactly this reason, because
  // the source sheet recorded only "Bengisu", "Işın" and "Beste".
  const offenders: string[] = [];
  for (const { file, people } of rosters()) {
    for (const person of people) {
      if (person.name.trim().split(/\s+/).length < 2) {
        offenders.push(`${file}: "${person.name}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], `first name only:\n    ${offenders.join('\n    ')}\n  `);
});

test('affiliations name an institution, not a degree', () => {
  // The schema has one affiliation field for both languages, so it holds a
  // proper noun. "Master's Student, Health Informatics, Hacettepe University"
  // would be English on the Turkish page; "Uludağ Üniversitesi, Lisans" leaks
  // a degree level nobody asked to publish.
  const banned = /\b(lisans|yüksek lisans|doktora|msc|bsc|phd|undergraduate|master'?s|student|öğrencisi|candidate)\b/i;
  const offenders: string[] = [];
  for (const { file, people } of rosters()) {
    for (const person of people) {
      if (person.affiliation && banned.test(person.affiliation)) {
        offenders.push(`${file}: ${person.name} -- "${person.affiliation}"`);
      }
    }
  }
  assert.deepEqual(offenders, [], `degree level in an affiliation:\n    ${offenders.join('\n    ')}\n  `);
});

test('a past edition page shows its committee, and one without a roster shows nothing', {
  skip: !existsSync(join(ROOT, 'dist')) && 'run `npm run build` first',
}, () => {
  const page = (path: string) => readFileSync(join(ROOT, 'dist', path, 'index.html'), 'utf8');

  for (const path of ['editions/2024', 'tr/editions/2024']) {
    const html = page(path);
    assert.match(html, /Vuslat Berfin Sakızcı/, `${path}: no committee member`);
    assert.match(html, /Core Team|Sponsorluk/, `${path}: no team heading`);
  }
  // The section heading, and under it the team headings from the 2024 sheet.
  assert.match(page('editions/2024'), /Organising Committee[\s\S]*Core Team[\s\S]*Sponsorship/);
  assert.match(page('tr/editions/2024'), /Düzenleme Kurulu[\s\S]*Düzenleme Komitesi[\s\S]*Sponsorluk/);

  // 2013 has no roster and never will. The section is absent, not empty.
  assert.doesNotMatch(page('editions/2013'), /Organising Committee/, '2013 should not show a committee heading');
  assert.doesNotMatch(page('tr/editions/2013'), /Düzenleme Kurulu/, '2013 should not show a committee heading');
});
