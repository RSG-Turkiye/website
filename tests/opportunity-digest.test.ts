import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, isDigestSender } from '../functions/_lib/opportunity-digest';
import { renderBody } from '../functions/_lib/markdown';

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

test('a source that never ingested is "nothing yet", not silent, until it has been polled for over 14 days', async () => {
  const fresh = [{ started_at: now - 2 * day, sources: JSON.stringify({ devpost: { fetched: 4, ingested: 0 } }) }];
  const d = await buildDigest([], fresh, async () => '', now);
  assert.match(d.body, /devpost.*henüz ilan getirmedi/);
  assert.doesNotMatch(d.body, /devpost.*sessiz/);
  const old = [
    { started_at: now - 25 * day, sources: JSON.stringify({ devpost: { fetched: 4, ingested: 0 } }) },
    { started_at: now - 2 * day, sources: JSON.stringify({ devpost: { fetched: 4, ingested: 0 } }) },
  ];
  assert.match((await buildDigest([], old, async () => '', now)).body, /devpost.*14\+ gündür sessiz/);
});

test('no runs at all says the collector never ran, without a day count', async () => {
  const d = await buildDigest([], [], async () => '', now);
  assert.match(d.body, /henüz hiç çalışmadı/);
  assert.doesNotMatch(d.body, /\d{3,} gündür/);
});

test('external titles cannot become links or emphasis in the rendered mail', async () => {
  const d = await buildDigest([{ id: 'x', title: '[Click](https://evil.example/p) **WIN** https://evil2.example', url: 'https://ex.org', source: 'tess' }], [], async () => 'https://site/r/x', now);
  const { html } = renderBody(d.body);
  assert.ok(!html.includes('evil.example/p"'), 'markdown link in title was linkified');
  assert.ok(!html.includes('evil2.example"'), 'bare URL in title was linkified');
  assert.ok(!html.includes('<strong>WIN'), 'emphasis in title was applied');
  assert.ok(html.includes('https://ex.org"'), 'the real item url is still linked');
});

test('only a user flagged is_sender may be the digest sender', () => {
  assert.equal(isDigestSender({ is_sender: 1 }), true);
  assert.equal(isDigestSender({ is_sender: 0 }), false);
  assert.equal(isDigestSender(null), false);
});
