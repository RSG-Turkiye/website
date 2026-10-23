import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resourceSchema, sortResources, resourcesFor } from '../src/data/resources';

const dir = new URL('../src/content/resources/', import.meta.url).pathname;
const entries = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, data: resourceSchema.parse(JSON.parse(readFileSync(dir + f, 'utf8'))) }));
const all = entries.map((e) => e.data);

// The literal lists the two pages carried (English titles), in page order.
const expected: Record<string, string[]> = {
  learning: ['Rosalind', 'OSSU Bioinformatics', 'EMBL-EBI Training', 'Harvard HBC Training', 'Galaxy Training Network', 'TeachOpenCADD', 'StatQuest with Josh Starmer', 'The Carpentries', 'Bioinformatics Specialization (Coursera)'],
  'md-drug': ['GROMACS Tutorials (Lemkul)', 'NAMD Tutorials (UIUC)', 'CHARMM-GUI', 'TeachOpenCADD', 'Galaxy for Molecular Dynamics'],
};

test('there are 36 resources, one file each, every field in both languages', () => {
  assert.equal(entries.length, 36);
  for (const { data: r } of entries) {
    for (const f of [r.title, r.description]) assert.ok(f.en.trim() && f.tr.trim());
    assert.ok(r.tags.en.length > 0);
    assert.equal(r.tags.en.length, r.tags.tr.length);
  }
});

test('slugs are unique and each section has contiguous orders from 0', () => {
  assert.equal(new Set(entries.map((e) => e.f)).size, entries.length);
  for (const s of new Set(all.map((r) => r.section))) {
    const orders = all.filter((r) => r.section === s).map((r) => r.order).sort((a, b) => a - b);
    assert.deepEqual(orders, orders.map((_, i) => i), s);
  }
});

test('titles per section match the old arrays', () => {
  const sorted = sortResources(all);
  for (const [section, titles] of Object.entries(expected)) {
    assert.deepEqual(sorted.filter((r) => r.section === section).map((r) => r.title.en), titles);
  }
  assert.deepEqual(
    [...new Set(sorted.map((r) => r.section))],
    ['learning', 'md-drug', 'databases', 'tools', 'community'],
  );
  assert.equal(sorted.filter((r) => r.section === 'databases').length, 10);
  assert.equal(sorted.filter((r) => r.section === 'tools').length, 9);
  assert.equal(sorted.filter((r) => r.section === 'community').length, 3);
});

test('TeachOpenCADD sits in two sections as two files', () => {
  const t = all.filter((r) => r.title.en === 'TeachOpenCADD');
  assert.deepEqual(t.map((r) => r.section).sort(), ['learning', 'md-drug']);
});

test('resourcesFor picks one language', () => {
  const tr = resourcesFor(all, 'learning', 'tr');
  assert.equal(tr[2].title, 'EMBL-EBI Eğitim');
  assert.equal(resourcesFor(all, 'learning', 'en')[2].title, 'EMBL-EBI Training');
});
