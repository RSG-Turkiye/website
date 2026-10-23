import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { workshopSchema, sortWorkshops } from '../src/data/workshops';

const dir = new URL('../src/content/workshops/', import.meta.url).pathname;
const entries = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ f, data: JSON.parse(readFileSync(dir + f, 'utf8')) }));

test('every workshop validates against the schema', () => {
  assert.ok(entries.length > 0);
  for (const e of entries) {
    const r = workshopSchema.safeParse(e.data);
    assert.ok(r.success, `${e.f}: ${r.success ? '' : r.error.message}`);
  }
});

test('repo values are unique, and each file is named after its repo in lower case', () => {
  // The repo keeps its real case: it is the GitHub URL. The file name is the
  // lowercase slug every content file name is.
  const repos = entries.map((e) => e.data.repo.toLowerCase());
  assert.equal(new Set(repos).size, repos.length);
  for (const e of entries) assert.equal(e.f, `${e.data.repo.toLowerCase().replace(/_/g, '-')}.json`);
});

test('the schema refuses a misspelt key', () => {
  const w = entries[0].data;
  assert.equal(workshopSchema.safeParse({ ...w, topcis: 'x' }).success, false);
});

test('sorting is newest year first, ties by repo', () => {
  const list = [
    { year: 2020, title: 'a', topics: 't', repo: 'B' },
    { year: 2021, title: 'b', topics: 't', repo: 'Z' },
    { year: 2020, title: 'c', topics: 't', repo: 'A' },
  ];
  assert.deepEqual(sortWorkshops(list).map((w) => w.repo), ['Z', 'A', 'B']);
});
