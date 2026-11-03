import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupResults, chipsFor, type SearchResult } from '../src/lib/guide-search';
import { programmeStatus, applyBlockHtml, orderProgrammes, applyBlocksHtml } from '../src/lib/guide-apply';
import type { IndexProfessor } from '../functions/_lib/guide-index';
import type { GuideCatalog } from '../src/lib/guide-catalog';

/** Results grouped by university, and the shared apply block. Names are invented. */

const prof = (over: Partial<IndexProfessor>): IndexProfessor => ({
  id: 'p_1', title: 'Dr.', name: 'A', universityId: 'ornek', department: '', labId: null,
  profileUrl: '', openalexId: null, topics: [], programmeIds: [], checkedAt: '2026-11-01', source: '', ...over,
});
const P = (id: string, universityId: string, extra: object = {}) => ({
  id, universityId, type: 'msc' as const, name: { en: id, tr: id }, institute: { en: 'Inst', tr: 'Enst' },
  usualMonths: ['10' as const, '11' as const], sourceUrl: 'https://example.edu.tr/src', checkedAt: '2026-10-01', ...extra,
});
const catalog: GuideCatalog = {
  universities: [
    { id: 'ornek', name: { en: 'Ornek', tr: 'Örnek' }, city: 'Ankara', url: 'https://o.edu.tr' },
    { id: 'baska', name: { en: 'Baska', tr: 'Başka' }, city: 'İzmir', url: 'https://b.edu.tr' },
    { id: 'bos', name: { en: 'Bos', tr: 'Boş' }, city: 'Mersin', url: 'https://e.edu.tr' },
  ],
  programmes: [P('ornek-a', 'ornek'), P('ornek-b', 'ornek'), P('baska-a', 'baska')],
  terms: [],
};
const r = (p: Partial<IndexProfessor>, score: number, matched: string[] = []): SearchResult => ({ professor: prof(p), score, matched });

test('groups follow their best score; inside a group, verified professors first, then by name, never by score', () => {
  const g = groupResults([
    r({ id: 'p1', name: 'Zeki', universityId: 'ornek' }, 10),
    r({ id: 'p2', name: 'Ayla', universityId: 'ornek', checkedAt: '1970-01-01' }, 9),
    r({ id: 'p3', name: 'Cem', universityId: 'ornek' }, 1),
    r({ id: 'p4', name: 'Deniz', universityId: 'baska' }, 5),
  ], catalog, {});
  assert.deepEqual(g.groups.map((x) => x.university.id), ['ornek', 'baska']);
  assert.deepEqual(g.groups[0].professors.map((x) => x.professor.name), ['Cem', 'Zeki', 'Ayla']);
});

test('universities without a programme go into their own list, after the others', () => {
  const g = groupResults([r({ id: 'p1', universityId: 'bos' }, 10), r({ id: 'p2', universityId: 'baska' }, 1)], catalog, {});
  assert.deepEqual(g.groups.map((x) => x.university.id), ['baska']);
  assert.deepEqual(g.withoutProgramme.map((x) => x.university.id), ['bos']);
});

test('a group shows its university’s programmes once, each with any page-changed date', () => {
  const g = groupResults([r({ id: 'p1', universityId: 'ornek', programmeIds: ['ornek-b'] }), r({ id: 'p2', universityId: 'ornek' }, 0)].map((x) => ({ ...x, score: 1 })), catalog, { 'ornek-b': '2026-10-20' });
  assert.deepEqual(g.groups[0].programmes.map((p) => [p.id, p.pageChangedSince ?? null]), [['ornek-a', null], ['ornek-b', '2026-10-20']]);
  const dead = groupResults([r({ id: 'p1', universityId: 'ornek', programmeIds: ['gone', 'ornek-a', 'baska-a'] }, 1)], catalog, {});
  assert.deepEqual(dead.groups[0].professors[0].programmeIds, ['ornek-a'], 'a dead id or another university\u2019s programme is dropped');
});

test('chips: at most 5, matched first, one per spelling, lower case unless an acronym', () => {
  assert.deepEqual(
    chipsFor(['Yapısal biyoloji', 'yapısal biyoloji', 'HLA', 'Docking', 'RNA-seq', 'Protein Structure', 'Genomics', 'Extra'], ['protein structure']),
    [{ text: 'protein structure', hit: true }, { text: 'yapısal biyoloji', hit: false }, { text: 'HLA', hit: false }, { text: 'docking', hit: false }, { text: 'RNA-seq', hit: false }],
  );
});

test('status: open, upcoming, and only months or nothing when no exact window is current', () => {
  assert.deepEqual(programmeStatus(P('x', 'o', { windowOpens: '2026-11-01', windowCloses: '2026-12-15' }), '2026-11-20'), { kind: 'open', closes: '2026-12-15' });
  assert.deepEqual(programmeStatus(P('x', 'o', { windowOpens: '2027-01-03', windowCloses: '2027-01-20' }), '2026-11-20'), { kind: 'upcoming', opens: '2027-01-03' });
  assert.deepEqual(programmeStatus(P('x', 'o', { windowOpens: '2026-01-03', windowCloses: '2026-01-20' }), '2026-11-20'), { kind: 'months', months: ['10', '11'] });
  assert.deepEqual(programmeStatus(P('x', 'o', { usualMonths: [] }), '2026-11-20'), { kind: 'unknown' });
});

test('apply block: the programme name links to the announcement, says when it was checked, and escapes', () => {
  const html = applyBlockHtml(P('x', 'o', { name: { en: 'A<b>', tr: 'A<b>' }, announcementUrl: 'https://ilan.example.edu.tr/a' }), 'tr', '2026-11-20');
  assert.match(html, /<a href="https:\/\/ilan\.example\.edu\.tr\/a"[^>]*>A&lt;b&gt;<\/a>/);
  assert.match(html, /Kesin tarih yok/);
  assert.match(html, /genelde Ekim, Kasım/);
  assert.match(html, /1 Ekim 2026/);
  assert.doesNotMatch(html, /güvenmeyin/);
});

test('apply block: no announcement link falls back to the source page; open status names the closing day', () => {
  const html = applyBlockHtml(P('x', 'o', { windowOpens: '2026-11-01', windowCloses: '2026-12-15' }), 'tr', '2026-11-20');
  assert.match(html, /href="https:\/\/example\.edu\.tr\/src"/);
  assert.match(html, /Başvurular açık/);
  assert.match(html, /15 Aralık 2026/);
});

test('apply block carries the page-changed warning, in both languages', () => {
  assert.match(applyBlockHtml(P('x', 'o'), 'tr', '2026-11-20', '2026-10-20'), /20 Ekim 2026 civarında değişti/);
  assert.match(applyBlockHtml(P('x', 'o'), 'en', '2026-11-20', '2026-10-20'), /changed around 20 October 2026/);
});

test('a group shows only the known programmes when every professor\u2019s is known, all of them otherwise', () => {
  const known = groupResults([r({ id: 'p1', universityId: 'ornek', programmeIds: ['ornek-b'] }, 1)], catalog, {});
  assert.deepEqual(known.groups[0].programmes.map((p) => p.id), ['ornek-b']);
  const mixed = groupResults([r({ id: 'p1', universityId: 'ornek', programmeIds: ['ornek-b'] }, 1), r({ id: 'p2', universityId: 'ornek' }, 1)], catalog, {});
  assert.deepEqual(mixed.groups[0].programmes.map((p) => p.id), ['ornek-a', 'ornek-b']);
});

test('a PhD shows with the MSc it continues, after it, and only when that MSc shows', () => {
  const cat: GuideCatalog = {
    ...catalog,
    programmes: [P('ornek-a', 'ornek'), P('ornek-b', 'ornek'), { ...P('ornek-a-phd', 'ornek'), type: 'phd' as const, mscId: 'ornek-a' }, { ...P('ornek-b-phd', 'ornek'), type: 'phd' as const, mscId: 'ornek-b' }],
  };
  const known = groupResults([r({ id: 'p1', universityId: 'ornek', programmeIds: ['ornek-a'] }, 1)], cat, {});
  assert.deepEqual(known.groups[0].programmes.map((p) => p.id), ['ornek-a', 'ornek-a-phd']);
  const unknown = groupResults([r({ id: 'p1', universityId: 'ornek' }, 1)], cat, {});
  assert.deepEqual(unknown.groups[0].programmes.map((p) => p.id), ['ornek-a', 'ornek-a-phd', 'ornek-b', 'ornek-b-phd']);
});

test("a PhD's apply block says supervision has its own conditions", () => {
  const html = applyBlockHtml({ ...P('ornek-a-phd', 'ornek'), type: 'phd', mscId: 'ornek-a' }, 'tr', '2026-11-03');
  assert.match(html, /Doktora danışmanlığı/);
  assert.doesNotMatch(applyBlockHtml(P('ornek-a', 'ornek'), 'tr', '2026-11-03'), /Doktora danışmanlığı/);
  assert.match(applyBlockHtml({ ...P('x-phd', 'ornek'), type: 'phd', mscId: 'x' }, 'en', '2026-11-03'), /PhD supervision/);
});

test("a university's programmes list each MSc, then the PhD that continues it", () => {
  const list = [{ ...P('x-b-phd', 'ornek'), type: 'phd' as const, mscId: 'x-b', name: { en: 'B PhD', tr: 'B Doktora' } }, { ...P('x-b', 'ornek'), name: { en: 'B', tr: 'B' } }, { ...P('x-a', 'ornek'), name: { en: 'A', tr: 'A' } }];
  assert.deepEqual(orderProgrammes(list, 'tr').map((p) => p.id), ['x-a', 'x-b', 'x-b-phd']);
});

test('a PhD with the same institute and months as its MSc is one line inside the MSc block; otherwise a block of its own', () => {
  const msc = P('ornek-a', 'ornek');
  const same = { ...P('ornek-a-phd', 'ornek'), type: 'phd' as const, mscId: 'ornek-a', name: { en: 'A PhD', tr: 'A Doktora' } };
  const html = applyBlocksHtml([msc, same], 'tr', '2026-11-03', {});
  assert.equal((html.match(/border-l-2/g) || []).length, 1, 'one block');
  assert.match(html, /Doktora: <a [^>]*>A Doktora<\/a>/);
  assert.match(html, /Doktora danışmanlığının ayrı şartları vardır/);
  const other = { ...same, usualMonths: ['8' as const] };
  assert.equal((applyBlocksHtml([msc, other], 'tr', '2026-11-03', {}).match(/border-l-2/g) || []).length, 2, 'different months: its own block');
});
