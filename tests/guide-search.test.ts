import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fold, tokens, expandQuery, search, joinCard } from '../src/lib/guide-search';
import type { GuideIndex, IndexProfessor } from '../functions/_lib/guide-index';
import type { GuideCatalog } from '../src/lib/guide-catalog';

/** The guide's search, run in the browser. Names are invented. */

const prof = (over: Partial<IndexProfessor>): IndexProfessor => ({
  id: 'p_000000000001', title: 'Doç. Dr.', name: 'Örnek Hoca A', universityId: 'ornek', department: 'Biyomühendislik', labId: null,
  profileUrl: '', openalexId: null, topics: [], programmeIds: [], checkedAt: '2026-11-01', source: '', ...over,
});
const P = (id: string, universityId: string, extra: object = {}) => ({
  id, universityId, type: 'msc' as const, name: { en: id, tr: id }, institute: { en: 'I', tr: 'E' },
  usualMonths: ['6' as const], sourceUrl: 'https://example.edu.tr', checkedAt: '2026-11-01', ...extra,
});

const catalog: GuideCatalog = {
  universities: [
    { id: 'ornek', name: { en: 'Example', tr: 'Örnek' }, city: 'Kocaeli', url: 'https://example.edu.tr' },
    { id: 'baska', name: { en: 'Other', tr: 'Başka' }, city: 'İstanbul', url: 'https://other.edu.tr' },
    { id: 'bos', name: { en: 'Empty', tr: 'Boş' }, city: 'Ankara', url: 'https://empty.edu.tr' },
  ],
  programmes: [P('ornek-bioinf', 'ornek'), P('ornek-cmpe', 'ornek'), P('baska-mbg', 'baska', { windowOpens: '2027-01-05', windowCloses: '2027-01-20' })],
  terms: [
    { id: 'protein-structure', terms: ['protein structure', 'protein yapısı', 'structural bioinformatics'], related: ['docking'] },
    { id: 'docking', terms: ['molecular docking', 'docking'], related: [] },
  ],
};

const index: GuideIndex = {
  generatedAt: '2026-11-01T00:00:00.000Z',
  labs: [],
  professors: [
    prof({ id: 'p_a', name: 'Örnek Hoca A', topics: ['protein structure'], programmeIds: ['ornek-bioinf'] }),
    prof({ id: 'p_b', name: 'Örnek Hoca B', universityId: 'baska', topics: ['Sistem Biyolojisi', 'docking'] }),
    prof({ id: 'p_c', name: 'Işık Örnek', universityId: 'baska', topics: ['metabolomics'] }),
  ],
};

test('fold("İSTANBUL") === fold("istanbul")', () => {
  assert.equal(fold('İSTANBUL'), fold('istanbul'));
  assert.equal(fold('İstanbul'), 'istanbul');
});

test('fold("IŞIK") === fold("ışık") and a decomposed ş folds like ş', () => {
  assert.equal(fold('IŞIK'), fold('ışık'));
  assert.equal(fold('Yıldız'), fold('YILDIZ'));
  assert.equal(fold('ş'), fold('ş'));
});

test('tokens("ışık") is ["isik"]', () => {
  assert.deepEqual(tokens('ışık'), ['isik']);
  assert.deepEqual(tokens('protein-yapısı, docking'), ['protein', 'yapisi', 'docking']);
});

test('"protein yapısı" finds a professor tagged "protein structure" via a term group and lists it in alsoSearched', () => {
  const r = search('protein yapısı', null, index, catalog);
  assert.equal(r[0].professor.id, 'p_a');
  const { alsoSearched } = expandQuery('protein yapısı', catalog.terms);
  assert.ok(alsoSearched.includes('protein structure'));
  assert.ok(alsoSearched.includes('molecular docking'), 'related groups are tried too');
});

test('an exact topic match outranks a related-term match', () => {
  const r = search('protein structure', null, index, catalog);
  assert.deepEqual(r.map((x) => x.professor.id), ['p_a', 'p_b'], 'B only matches through the related "docking" group');
});

test('"biyoloji" finds "sistem biyolojisi"', () => {
  assert.deepEqual(search('biyoloji', null, index, catalog).map((x) => x.professor.id), ['p_b']);
});

test('city filter keeps only that city', () => {
  assert.deepEqual(search('docking', 'İstanbul', index, catalog).map((x) => x.professor.id), ['p_b']);
  assert.deepEqual(search('docking', 'Ankara', index, catalog), []);
});

test('name search finds "Örnek Hoca A" by "ornek"', () => {
  assert.ok(search('ornek hoca a', null, index, catalog).some((x) => x.professor.id === 'p_a'));
});

test('an empty query lists everyone in the city, by name', () => {
  assert.deepEqual(search('', 'İstanbul', index, catalog).map((x) => x.professor.id), ['p_c', 'p_b']);
});

test('equal scores sort by name with localeCompare tr', () => {
  const twin: GuideIndex = { ...index, professors: [prof({ id: 'p_z', name: 'Zeynep', topics: ['docking'] }), prof({ id: 'p_c2', name: 'Çağla', topics: ['docking'] })] };
  assert.deepEqual(search('docking', null, twin, catalog).map((x) => x.professor.name), ['Çağla', 'Zeynep']);
});

test('joinCard falls back to all university programmes', () => {
  const c = joinCard(prof({ programmeIds: [] }), catalog, '2026-11-01');
  assert.deepEqual(c.programmes.map((p) => p.id), ['ornek-bioinf', 'ornek-cmpe']);
  assert.equal(c.programmeUnknown, false);
});

test('joinCard ignores a programme id missing from the catalog', () => {
  const c = joinCard(prof({ programmeIds: ['gone', 'ornek-bioinf'] }), catalog, '2026-11-01');
  assert.deepEqual(c.programmes.map((p) => p.id), ['ornek-bioinf']);
  const d = joinCard(prof({ programmeIds: ['gone'] }), catalog, '2026-11-01');
  assert.deepEqual(d.programmes.map((p) => p.id), ['ornek-bioinf', 'ornek-cmpe'], 'only dead ids: fall back');
});

test('joinCard sets programmeUnknown for a university with none', () => {
  const c = joinCard(prof({ universityId: 'bos' }), catalog, '2026-11-01');
  assert.deepEqual(c.programmes, []);
  assert.equal(c.programmeUnknown, true);
});

test('a reported window is hidden the day after it closes', () => {
  const p = prof({ universityId: 'baska', programmeIds: ['baska-mbg'] });
  assert.equal(joinCard(p, catalog, '2027-01-20').programmes[0].showWindow, true);
  assert.equal(joinCard(p, catalog, '2027-01-21').programmes[0].showWindow, false);
});
