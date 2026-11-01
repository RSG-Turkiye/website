import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../src/lib/guide-catalog';

/** /guide/catalog.json: the institutional half of the guide, built from git. */

const u = (id: string) => ({ id, name: { en: id, tr: id }, city: 'Ankara', url: 'https://example.edu.tr' });
const p = (id: string, extra = {}) => ({
  id, universityId: 'b', type: 'msc' as const, name: { en: id, tr: id }, institute: { en: 'I', tr: 'E' },
  usualMonths: ['6'] as ('6')[], sourceUrl: 'https://example.edu.tr/p', checkedAt: '2026-11-01', ...extra,
});
const t = (id: string) => ({ id, terms: [id, `${id}-tr`], related: [] });

test('buildCatalog sorts by id and keeps only schema keys', () => {
  const c = buildCatalog([u('b'), u('a')], [p('z'), p('y', { note: 'internal' })], [t('q'), t('p')]);
  assert.deepEqual(c.universities.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(c.programmes.map((x) => x.id), ['y', 'z']);
  assert.deepEqual(c.terms.map((x) => x.id), ['p', 'q']);
  assert.ok(!('note' in c.programmes[0]), 'the internal note is never published');
});

test('a record never checked against an official page says so instead of showing a date', async () => {
  const { checkedLabel } = await import('../src/lib/guide-text');
  assert.equal(checkedLabel('1970-01-01', 'tr'), 'henüz resmi bir sayfadan doğrulanmadı');
  assert.equal(checkedLabel('1970-01-01', 'en'), 'not yet confirmed on an official page');
  assert.match(checkedLabel('2026-11-01', 'tr'), /1 Kasım 2026 tarihinde kontrol edildi/);
});
