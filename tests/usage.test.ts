import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcDay, crossings, readUsage } from '../functions/_lib/usage';
import { fakeGql, errorGql, partialGql, unknownFieldGql } from './lib/usage';

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
const DAY = '2026-10-26';

test('a metric that could not be read does not cross, and the others still do', () => {
  assert.deepEqual(crossings({ requests: null, rowsRead: 4_000_000, rowsWritten: null }, []).map((c) => `${c.metric}:${c.threshold}`), ['rowsRead:70']);
});

test('readUsage adds Workers and Pages requests and reads D1 rows', async () => {
  const seen: unknown[] = [];
  const r = await readUsage(ENV, DAY, fakeGql(seen, {
    workers: [{ dimensions: { scriptName: 'rsg-mail-cron' }, sum: { requests: 1500 } }, { dimensions: { scriptName: 'rsg-symposium-cron' }, sum: { requests: 500 } }],
    pages: [{ sum: { requests: 40_000 } }], d1: [{ sum: { rowsRead: 1_000_000, rowsWritten: 20_000 } }],
  }));
  assert.deepEqual(r.usage, { requests: 42_000, rowsRead: 1_000_000, rowsWritten: 20_000 });
  assert.deepEqual(r.errors, []);
  assert.equal(r.pages, 40_000);
  assert.deepEqual(r.workers, [{ name: 'rsg-mail-cron', requests: 1500 }, { name: 'rsg-symposium-cron', requests: 500 }]);
});

test('Worker requests are listed by script, largest first, repeats added', async () => {
  const w = (name: string, n: number) => ({ dimensions: { scriptName: name }, sum: { requests: n } });
  const r = await readUsage(ENV, DAY, fakeGql([], { workers: [w('a', 1), w('website', 90), w('a', 4)], pages: [], d1: [] }));
  assert.deepEqual(r.workers, [{ name: 'website', requests: 90 }, { name: 'a', requests: 5 }]);
});

test('three requests, one per dataset, each by its own filter', async () => {
  const seen: { query: string; variables: Record<string, string> }[] = [];
  await readUsage(ENV, DAY, fakeGql(seen, { workers: [], pages: [], d1: [] }));
  assert.equal(seen.length, 3);
  const q = (name: string) => seen.find((s) => s.query.includes(name))!;
  assert.match(q('workersInvocationsAdaptive').query, /workers: workersInvocationsAdaptive\(limit: 1000, filter: \{ datetime_geq: \$from, datetime_lt: \$to \}\) \{ dimensions \{ scriptName \} sum \{ requests \} \}/);
  assert.match(q('pagesFunctionsInvocationsAdaptiveGroups').query, /pages: pagesFunctionsInvocationsAdaptiveGroups\(limit: 1000, filter: \{ date: \$day \}\) \{ sum \{ requests \} \}/);
  assert.match(q('d1AnalyticsAdaptiveGroups').query, /d1: d1AnalyticsAdaptiveGroups\(limit: 1000, filter: \{ date_geq: \$day, date_leq: \$day \}\) \{ sum \{ rowsRead rowsWritten \} \}/);
  assert.deepEqual(q('workersInvocationsAdaptive').variables, { account: 'acc', from: '2026-10-26T00:00:00Z', to: '2026-10-27T00:00:00Z' });
  assert.deepEqual(q('pagesFunctionsInvocationsAdaptiveGroups').variables, { account: 'acc', day: DAY });
  assert.deepEqual(q('d1AnalyticsAdaptiveGroups').variables, { account: 'acc', day: DAY });
  // The Workers query lists the scripts it counts only in `dimensions`; no query names two datasets.
  assert.ok(seen.every((s) => (s.query.match(/Adaptive/g) ?? []).length === 1));
});

test('empty groups read as zero', async () => {
  const r = await readUsage(ENV, DAY, fakeGql([], { workers: [], pages: [], d1: [] }));
  assert.deepEqual(r.usage, { requests: 0, rowsRead: 0, rowsWritten: 0 });
  assert.deepEqual(r.errors, []);
});

test('a wrong Pages name costs only the requests line', async () => {
  const r = await readUsage(ENV, DAY, partialGql([], { workers: [], pages: [], d1: [{ sum: { rowsRead: 4_800_000, rowsWritten: 7 } }] }, /pagesFunctions/, 'Cannot query field "pagesFunctionsInvocationsAdaptiveGroups"'));
  assert.deepEqual(r.usage, { requests: null, rowsRead: 4_800_000, rowsWritten: 7 });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /^pages: Cannot query field/);
});

test('a wrong D1 name leaves the requests', async () => {
  const r = await readUsage(ENV, DAY, partialGql([], { workers: [], pages: [{ sum: { requests: 9 } }], d1: [] }, /d1Analytics/, 'nope'));
  assert.deepEqual(r.usage, { requests: 9, rowsRead: null, rowsWritten: null });
  assert.match(r.errors[0], /^d1: nope/);
});

test('every query failing gives all nulls and every message', async () => {
  const r = await readUsage(ENV, DAY, errorGql('not authorized for that account'));
  assert.deepEqual(r.usage, { requests: null, rowsRead: null, rowsWritten: null });
  assert.equal(r.errors.length, 3);
  assert.match(r.errors.join(), /not authorized/);
});

test('an HTTP failure is an error, not a throw', async () => {
  const r = await readUsage(ENV, DAY, async () => new Response('no', { status: 401 }));
  assert.match(r.errors[0], /HTTP 401/);
});

test('a field name Cloudflare does not know is a failure, not zero', async () => {
  const r = await readUsage(ENV, DAY, unknownFieldGql);
  assert.match(r.errors.join(), /Cannot query field "pagesFunctionsInvocationsAdaptiveGroups"/);
  assert.equal(r.usage.requests, null);
});

test('a dataset missing from the answer is a failure, not zero', async () => {
  const r = await readUsage(ENV, DAY, fakeGql([], { workers: [], d1: [] }));
  assert.match(r.errors.join(), /pages/);
  assert.equal(r.usage.requests, null);
  assert.equal((await readUsage(ENV, DAY, fakeGql([], { workers: [], pages: null, d1: [] }))).usage.requests, null);
});

test('a group without its sum is a failure, not zero', async () => {
  const r = await readUsage(ENV, DAY, fakeGql([], { workers: [], pages: [], d1: [{ sum: { rowsRead: 5 } }] }));
  assert.match(r.errors.join(), /rowsWritten/);
  assert.deepEqual([r.usage.rowsRead, r.usage.rowsWritten], [null, null]);
});

test('no account in the answer is a failure', async () => {
  const none: typeof fetch = (async () => new Response(JSON.stringify({ data: { viewer: { accounts: [] } } }), { status: 200 })) as typeof fetch;
  assert.match((await readUsage(ENV, DAY, none)).errors.join(), /account/);
});
