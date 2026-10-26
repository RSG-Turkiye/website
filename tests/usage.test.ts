import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcDay, crossings, readUsage } from '../functions/_lib/usage';
import { fakeGql, errorGql, unknownFieldGql } from './lib/usage';

test('utcDay is the UTC date, not Istanbul', () => {
  assert.equal(utcDay(Date.parse('2026-10-26T23:30:00Z') / 1000), '2026-10-26'); // 02:30 on the 27th in Türkiye
  assert.equal(utcDay(Date.parse('2026-10-27T00:00:00Z') / 1000), '2026-10-27');
});

test('a value at exactly 70% crosses; one below does not', () => {
  assert.deepEqual(crossings({ requests: 70_000, rowsRead: 3_499_999, rowsWritten: 0 }, []).map((c) => `${c.metric}:${c.threshold}`), ['requests:70']);
});

test('90% crosses both thresholds', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 0, rowsWritten: 95_000 }, []).map((c) => `${c.metric}:${c.threshold}`), ['rowsWritten:70', 'rowsWritten:90']);
});

test('already alerted pairs are left out', () => {
  assert.deepEqual(crossings({ requests: 95_000, rowsRead: 0, rowsWritten: 0 }, ['requests:70']).map((c) => c.threshold), [90]);
});

test('a crossing carries its value and limit', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 4_000_000, rowsWritten: 0 }, [])[0], { metric: 'rowsRead', threshold: 70, value: 4_000_000, limit: 5_000_000 });
});

test('crossings come in metric order, then threshold ascending', () => {
  assert.deepEqual(
    crossings({ requests: 95_000, rowsRead: 4_000_000, rowsWritten: 95_000 }, []).map((c) => `${c.metric}:${c.threshold}`),
    ['requests:70', 'requests:90', 'rowsRead:70', 'rowsWritten:70', 'rowsWritten:90'],
  );
});

const ENV = { CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok' };

test('readUsage adds Workers and Pages requests and reads D1 rows', async () => {
  const seen: unknown[] = [];
  const usage = await readUsage(ENV, '2026-10-26', fakeGql(seen, { workers: [{ sum: { requests: 1500 } }, { sum: { requests: 500 } }], pages: [{ sum: { requests: 40_000 } }], d1: [{ sum: { rowsRead: 1_000_000, rowsWritten: 20_000 } }] }));
  assert.deepEqual(usage, { requests: 42_000, rowsRead: 1_000_000, rowsWritten: 20_000 });
  assert.deepEqual((seen[0] as { variables: unknown }).variables, { account: 'acc', day: '2026-10-26' });
});

test('the query asks the three datasets by date, one request', async () => {
  const seen: { query: string }[] = [];
  await readUsage(ENV, '2026-10-26', fakeGql(seen, { workers: [], pages: [], d1: [] }));
  assert.equal(seen.length, 1);
  const q = seen[0].query;
  assert.match(q, /workers: workersInvocationsAdaptive\(limit: 1000, filter: \{ date: \$day \}\) \{ sum \{ requests \} \}/);
  assert.match(q, /pages: pagesFunctionsInvocationsAdaptiveGroups\(limit: 1000, filter: \{ date: \$day \}\) \{ sum \{ requests \} \}/);
  assert.match(q, /d1: d1AnalyticsAdaptiveGroups\(limit: 1000, filter: \{ date: \$day \}\) \{ sum \{ rowsRead rowsWritten \} \}/);
});

test('empty groups read as zero', async () => {
  assert.deepEqual(await readUsage(ENV, '2026-10-26', fakeGql([], { workers: [], pages: [], d1: [] })), { requests: 0, rowsRead: 0, rowsWritten: 0 });
});

test('a GraphQL error is thrown with its message', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', errorGql('not authorized for that account')), /not authorized/);
});

test('an HTTP failure is thrown', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', async () => new Response('no', { status: 401 })), /HTTP 401/);
});

test('a field name Cloudflare does not know is a failure, not zero', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', unknownFieldGql), /Cannot query field "pagesFunctionsInvocationsAdaptiveGroups"/);
});

test('a dataset missing from the answer is a failure, not zero', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', fakeGql([], { workers: [], d1: [] })), /pages/);
  await assert.rejects(readUsage(ENV, '2026-10-26', fakeGql([], { workers: [], pages: null, d1: [] })), /pages/);
});

test('a group without its sum is a failure, not zero', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', fakeGql([], { workers: [], pages: [], d1: [{ sum: { rowsRead: 5 } }] })), /rowsWritten/);
});

test('no account in the answer is a failure', async () => {
  const none: typeof fetch = (async () => new Response(JSON.stringify({ data: { viewer: { accounts: [] } } }), { status: 200 })) as typeof fetch;
  await assert.rejects(readUsage(ENV, '2026-10-26', none), /account/);
});
