import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { universitySchema, programmeSchema, relatedTermSchema, checkGuideContent, RESERVED_UNIVERSITY_IDS } from '../src/data/guide';

/**
 * The guide's git content: universities, MSc programmes and related-term
 * groups (spec docs/superpowers/specs/2026-11-01-grad-lab-guide-design.md).
 * Professors and labs are never here (CLAUDE.md rule 4).
 */

const uni = { id: 'ornek-teknik', name: { en: 'Example Technical University', tr: 'Örnek Teknik Üniversitesi' }, city: 'Kocaeli', url: 'https://example.edu.tr' };
const prog = {
  id: 'ornek-teknik-bioinformatics', universityId: 'ornek-teknik', type: 'msc',
  name: { en: 'Bioinformatics MSc', tr: 'Biyoinformatik YL' },
  institute: { en: 'Graduate School', tr: 'Lisansüstü Eğitim Enstitüsü' },
  usualMonths: ['6', '12'], announcementUrl: 'https://example.edu.tr/ilan', sourceUrl: 'https://example.edu.tr/prog', checkedAt: '2026-11-01',
};
const term = { id: 'protein-structure', terms: ['protein structure', 'protein yapısı'], related: [] as string[] };

test('a well-formed university, programme and term group validate and check clean', () => {
  assert.ok(universitySchema.safeParse(uni).success);
  assert.ok(programmeSchema.safeParse(prog).success);
  assert.ok(relatedTermSchema.safeParse(term).success);
  assert.deepEqual(checkGuideContent([uni], [prog], [term]), []);
});

test("every programme's universityId names a university file", () => {
  const errs = checkGuideContent([uni], [{ ...prog, universityId: 'missing' }], []);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /missing/);
});

test('every related id names a term file', () => {
  const errs = checkGuideContent([], [], [{ ...term, related: ['nowhere'] }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /nowhere/);
});

test('programme window opens <= closes', () => {
  assert.ok(programmeSchema.safeParse({ ...prog, windowOpens: '2027-01-05', windowCloses: '2027-01-20' }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, windowOpens: '2027-01-20', windowCloses: '2027-01-05' }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, windowOpens: '2027-01-05' }).success, 'both ends or neither');
});

test('usualMonths are 1–12', () => {
  assert.ok(!programmeSchema.safeParse({ ...prog, usualMonths: ['0'] }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, usualMonths: ['13'] }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, usualMonths: [6] }).success, 'month numbers are written as text, as the panel edits them');
});

test('usual months may be unknown (empty): the card then points to the announcement', () => {
  assert.ok(programmeSchema.safeParse({ ...prog, usualMonths: [] }).success);
});

test('a PhD names the MSc it continues; an MSc names none', () => {
  const phd = { ...prog, id: 'ornek-teknik-bioinformatics-phd', type: 'phd', mscId: 'ornek-teknik-bioinformatics' };
  assert.ok(programmeSchema.safeParse(phd).success);
  assert.ok(!programmeSchema.safeParse({ ...phd, mscId: undefined }).success, 'a PhD without its MSc');
  assert.ok(!programmeSchema.safeParse({ ...prog, mscId: 'x' }).success, 'an MSc with an mscId');
  assert.ok(!programmeSchema.safeParse({ ...prog, type: 'ma' }).success);
  assert.deepEqual(checkGuideContent([uni], [prog, phd], []), []);
  assert.equal(checkGuideContent([uni], [phd], []).length, 1, 'its MSc must exist');
  assert.equal(checkGuideContent([uni, { ...uni, id: 'baska' }], [{ ...prog, universityId: 'baska' }, phd], []).length, 1, 'and be at the same university');
});

test('a term group needs at least two spellings', () => {
  assert.ok(!relatedTermSchema.safeParse({ ...term, terms: ['protein structure'] }).success);
});

test('university ids do not collide with reserved route names (universities, catalog, index)', () => {
  for (const id of ['universities', 'catalog', 'index']) {
    assert.ok(RESERVED_UNIVERSITY_IDS.includes(id));
    assert.ok(!universitySchema.safeParse({ ...uni, id }).success, id);
  }
});

// The real content, whatever it holds.
const dirs = { universities: 'guide-universities', programmes: 'guide-programmes', terms: 'guide-terms' } as const;
const read = (d: string) => {
  const url = new URL(`../src/content/${d}/`, import.meta.url);
  if (!existsSync(url)) return [] as { file: string; raw: string; data: any }[];
  return readdirSync(url).filter((f) => f.endsWith('.json')).map((file) => {
    const raw = readFileSync(new URL(file, url), 'utf8');
    return { file, raw, data: JSON.parse(raw) };
  });
};

test('the guide content files validate, are named by id and cross-reference cleanly', () => {
  const u = read(dirs.universities), p = read(dirs.programmes), t = read(dirs.terms);
  for (const [files, schema] of [[u, universitySchema], [p, programmeSchema], [t, relatedTermSchema]] as const) {
    for (const f of files) {
      const r = schema.safeParse(f.data);
      assert.ok(r.success, `${f.file}: ${r.success ? '' : r.error.message}`);
      assert.equal(f.file, `${f.data.id}.json`);
    }
  }
  assert.deepEqual(checkGuideContent(u.map((f) => f.data), p.map((f) => f.data), t.map((f) => f.data)), []);
});

test("no guide content file contains '@' (no e-mail slipped in)", () => {
  for (const d of Object.values(dirs)) for (const f of read(d)) assert.ok(!f.raw.includes('@'), `${d}/${f.file}`);
});

test('Final #4: links are http(s) only, never javascript: or data:', () => {
  assert.ok(!universitySchema.safeParse({ ...uni, url: 'javascript:alert(1)' }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, announcementUrl: 'data:text/html,x' }).success);
  assert.ok(!programmeSchema.safeParse({ ...prog, sourceUrl: 'ftp://example.edu.tr' }).success);
  assert.ok(programmeSchema.safeParse({ ...prog, calendarUrl: 'http://example.edu.tr/takvim' }).success);
});
