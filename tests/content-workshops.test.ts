import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { workshopSchema } from '../src/data/workshops';

const dir = new URL('../src/content/workshops/', import.meta.url).pathname;
const entries = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, data: JSON.parse(readFileSync(dir + f, 'utf8')) }));

test('there are six workshops and each validates against the schema', () => {
  assert.equal(entries.length, 6);
  for (const e of entries) workshopSchema.parse(e.data);
});

test('repo values are unique and name their file', () => {
  const repos = entries.map((e) => e.data.repo);
  assert.equal(new Set(repos).size, repos.length);
  for (const e of entries) assert.equal(e.f, `${e.data.repo}.json`);
});

test('sorting reproduces the order the page had before the collection', async () => {
  const { sortWorkshops } = await import('../src/data/workshops');
  assert.deepEqual(sortWorkshops(entries.map((e) => e.data)).map((w) => w.repo), [
    'RSG-Single-Cell-Workshop2024',
    'Computational_Structural_Biology_Workshop',
    'Workshop2021',
    'Single-Cell-Workshop2020',
    'Workshop2020',
    'AnkaPy',
  ]);
});
