import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resourceSchema, sortResources, resourcesFor } from '../src/data/resources';

const dir = new URL('../src/content/resources/', import.meta.url).pathname;
const entries = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, data: resourceSchema.parse(JSON.parse(readFileSync(dir + f, 'utf8'))) }));
const all = entries.map((e) => e.data);

test('every resource validates and has every field in both languages', () => {
  assert.ok(entries.length > 0);
  for (const { data: r } of entries) {
    for (const f of [r.title, r.description]) assert.ok(f.en.trim() && f.tr.trim());
    assert.ok(r.tags.en.length > 0);
    assert.equal(r.tags.en.length, r.tags.tr.length);
  }
});

test('slugs are unique, and orders are non-negative integers', () => {
  // Not contiguous and not unique: orders go in steps of 10, a deleted link
  // leaves a gap, and a tie sorts by English title (A3, amended).
  assert.equal(new Set(entries.map((e) => e.f)).size, entries.length);
  for (const s of new Set(all.map((r) => r.section))) {
    const orders = all.filter((r) => r.section === s).map((r) => r.order);
    for (const o of orders) assert.ok(Number.isInteger(o) && o >= 0, `${s}: ${o}`);
  }
});

test('a tie on order sorts by English title', () => {
  const r = (order: number, en: string) => ({ ...all[0], section: 'tools' as const, order, title: { en, tr: en } });
  assert.deepEqual(sortResources([r(10, 'B'), r(20, 'A'), r(10, 'A')]).map((x) => `${x.order}${x.title.en}`), ['10A', '10B', '20A']);
});

test('sections sort in page order, then by order within a section', () => {
  const sections = [...new Set(sortResources(all).map((r) => r.section))];
  const pageOrder = ['learning', 'md-drug', 'databases', 'tools', 'community'];
  assert.deepEqual(sections, pageOrder.filter((s) => sections.includes(s as never)));
});

test('the schema refuses a misspelt key, at the top and in nested objects', () => {
  const r = all[0];
  assert.equal(resourceSchema.safeParse({ ...r, opensourse: true }).success, false);
  assert.equal(resourceSchema.safeParse({ ...r, title: { ...r.title, de: 'x' } }).success, false);
  assert.equal(resourceSchema.safeParse({ ...r, tags: { ...r.tags, de: [] } }).success, false);
});

test('resourcesFor picks one language', () => {
  const two = (title: string, i: number) => ({ section: 'tools' as const, order: i, title: { en: `${title} en`, tr: `${title} tr` }, description: { en: 'd', tr: 'd' }, url: 'https://x.org', tags: { en: ['a'], tr: ['a'] }, opensource: true });
  const list = [two('b', 1), two('a', 0)];
  assert.deepEqual(resourcesFor(list, 'tools', 'tr').map((r) => r.title), ['a tr', 'b tr']);
  assert.deepEqual(resourcesFor(list, 'tools', 'en').map((r) => r.title), ['a en', 'b en']);
});
