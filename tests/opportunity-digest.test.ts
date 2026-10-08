import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from '../functions/_lib/opportunity-digest';

const day = 86400, now = 1_800_000_000;
const runs = [
  { started_at: now - 2 * day, sources: JSON.stringify({ tess: { fetched: 40, ingested: 12 }, nfcore: { fetched: 3, ingested: 1 } }) },
  { started_at: now - 20 * day, sources: JSON.stringify({ galaxy: { fetched: 5, ingested: 2 } }) },
];

test('the digest lists each item with its remove link', async () => {
  const d = await buildDigest([{ id: 'x1', title: 'Summer school', url: 'https://ex.org', source: 'tess' }], runs, async (id) => `https://site/r/${id}`, now);
  assert.match(d.subject, /1/);
  assert.ok(d.body.includes('Summer school'));
  assert.ok(d.body.includes('https://site/r/x1'));
});

test('a source silent for 14 days is flagged', async () => {
  const d = await buildDigest([], runs, async () => '', now);
  assert.match(d.body, /galaxy.*(sessiz|silent)/i);
  assert.doesNotMatch(d.body, /tess.*(sessiz|silent)/i);
});

test('no run in 3 days is called out', async () => {
  const d = await buildDigest([], [{ started_at: now - 4 * day, sources: '{}' }], async () => '', now);
  assert.match(d.body, /toplayıcı.*(çalışmadı|did not run)/i);
});
