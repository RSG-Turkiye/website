import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { setupSocial, stubMail } from './lib/social';
import { numbers, errorGql, partialGql, usageData, unknownFieldGql } from './lib/usage';
import { checkUsage, readUsageState } from '../functions/_lib/usage';
import { usageAlertMessage } from '../functions/_lib/usage-alert';

const NOON = Date.parse('2026-10-26T12:00:00Z') / 1000;

type StateRow = { checked_at: number | null; measured_at: number | null; day: string | null; requests: number | null; rows_read: number | null; rows_written: number | null; parts: string | null; error: string | null; alert_day: string | null; alerted: string };
const stateRow = (db: DatabaseSync) => db.prepare('SELECT * FROM usage_state WHERE id = 1').get() as StateRow;
const auditCount = (db: DatabaseSync, action: string) => (db.prepare('SELECT COUNT(*) AS n FROM audit_log WHERE action = ?').get(action) as { n: number }).n;

let db: DatabaseSync;
let env: never;
let envWithout: never;
let mail: ReturnType<typeof stubMail>;

beforeEach(() => {
  const s = setupSocial();
  db = s.db;
  envWithout = s.env;
  env = { ...(s.env as object), CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok' } as never;
  mail = stubMail();
});
afterEach(() => mail.restore());

function recordingFetch(calls: unknown[]): typeof fetch {
  return (async (...args: unknown[]) => { calls.push(args); return new Response('{}'); }) as typeof fetch;
}

test('without the token nothing is fetched or written', async () => {
  const calls: unknown[] = [];
  assert.equal(await checkUsage(envWithout, NOON, recordingFetch(calls)), 'not_configured');
  assert.equal(calls.length, 0);
  assert.equal(stateRow(db).checked_at, null);
});

test('below 70% the numbers are stored and no mail goes', async () => {
  assert.equal(await checkUsage(env, NOON, numbers({ requests: 10_000, rowsRead: 200, rowsWritten: 30 })), 'measured');
  const row = stateRow(db);
  assert.deepEqual([row.day, row.requests, row.rows_read, row.rows_written, row.checked_at, row.measured_at, row.error], ['2026-10-26', 10_000, 200, 30, NOON, NOON, null]);
  assert.equal(mail.sent.length, 0);
});

test('70% mails each admin once and logs one usage.alert row', async () => {
  assert.equal(await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 })), 'alerted');
  assert.deepEqual(mail.sent.map((m) => m.to), ['admin@example.org']);
  assert.match(mail.sent[0].subject, /70%/);
  assert.equal(auditCount(db, 'usage.alert'), 1);
  const audit = db.prepare(`SELECT user_id, target_type, target_id, details FROM audit_log WHERE action = 'usage.alert'`).get() as { user_id: string | null; target_type: string; target_id: string; details: string };
  assert.equal(audit.user_id, null);
  assert.equal(audit.target_type, 'usage');
  assert.equal(audit.target_id, '2026-10-26');
  assert.deepEqual(JSON.parse(audit.details), { alerts: [{ metric: 'requests', threshold: 70, value: 71_000, limit: 100_000 }], recipients: 1 });
  assert.deepEqual([stateRow(db).alert_day, JSON.parse(stateRow(db).alerted)], ['2026-10-26', ['requests:70']]);
});

test('the same threshold does not mail again the same UTC day', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(await checkUsage(env, NOON + 3600, numbers({ requests: 75_000, rowsRead: 0, rowsWritten: 0 })), 'measured');
  assert.equal(mail.sent.length, 1);
  assert.equal(stateRow(db).requests, 75_000);
  assert.deepEqual(JSON.parse(stateRow(db).alerted), ['requests:70']);
});

test('90% mails a second time', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(await checkUsage(env, NOON + 3600, numbers({ requests: 91_000, rowsRead: 0, rowsWritten: 0 })), 'alerted');
  assert.equal(mail.sent.length, 2);
  assert.match(mail.sent[1].subject, /90%/);
  assert.equal(auditCount(db, 'usage.alert'), 2);
});

test('70% and 90% crossed in one hour send one mail naming 90%', async () => {
  await checkUsage(env, NOON, numbers({ requests: 95_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(mail.sent.length, 1);
  assert.match(mail.sent[0].subject, /90%/);
  assert.deepEqual(JSON.parse(stateRow(db).alerted), ['requests:70', 'requests:90']);
});

test('another metric crossing later the same day mails once more', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  await checkUsage(env, NOON + 3600, numbers({ requests: 72_000, rowsRead: 0, rowsWritten: 80_000 }));
  assert.equal(mail.sent.length, 2);
  assert.deepEqual(JSON.parse(stateRow(db).alerted), ['requests:70', 'rowsWritten:70']);
});

test('a new UTC day can alert again', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  const nextDay = Date.parse('2026-10-27T01:00:00Z') / 1000;
  assert.equal(await checkUsage(env, nextDay, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 })), 'alerted');
  assert.equal(mail.sent.length, 2);
  assert.deepEqual([stateRow(db).alert_day, JSON.parse(stateRow(db).alerted)], ['2026-10-27', ['requests:70']]);
});

test('a failed GraphQL call stores the error, keeps the numbers and mails nobody', async () => {
  await checkUsage(env, NOON, numbers({ requests: 10_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(await checkUsage(env, NOON + 3600, errorGql('not authorized')), 'failed');
  const row = stateRow(db);
  assert.equal(row.requests, 10_000);
  assert.equal(row.measured_at, NOON);
  assert.equal(row.checked_at, NOON + 3600);
  assert.match(row.error ?? '', /not authorized/);
  assert.equal(mail.sent.length, 0);
});

test('a wrong Pages name still stores and alerts D1 rows, and says what failed', async () => {
  const d1 = { workers: [], pages: [], d1: [{ sum: { rowsRead: 4_800_000, rowsWritten: 10 } }] };
  assert.equal(await checkUsage(env, NOON, partialGql([], d1, /pagesFunctions/, 'Cannot query field "pagesFunctionsInvocationsAdaptiveGroups"')), 'alerted');
  assert.match(mail.sent[0].subject, /90%/);
  const row = stateRow(db);
  assert.deepEqual([row.requests, row.rows_read, row.rows_written, row.day], [null, 4_800_000, 10, '2026-10-26']);
  assert.match(row.error ?? '', /^pages: Cannot query field/);
  assert.deepEqual(JSON.parse(row.alerted), ['rowsRead:70', 'rowsRead:90']);
});

test('a half that fails keeps today\'s earlier number but never yesterday\'s', async () => {
  const good = usageData({ requests: 30_000, rowsRead: 100, rowsWritten: 5 });
  await checkUsage(env, NOON, numbers({ requests: 30_000, rowsRead: 100, rowsWritten: 5 }));
  assert.equal(await checkUsage(env, NOON + 3600, partialGql([], good, /pagesFunctions/, 'nope')), 'failed');
  assert.deepEqual([stateRow(db).requests, stateRow(db).rows_read], [30_000, 100]);
  const nextDay = Date.parse('2026-10-27T01:00:00Z') / 1000;
  await checkUsage(env, nextDay, partialGql([], good, /pagesFunctions/, 'nope'));
  assert.deepEqual([stateRow(db).day, stateRow(db).requests, stateRow(db).rows_read], ['2026-10-27', null, 100]);
});

test('the requests parts are stored for the card', async () => {
  await checkUsage(env, NOON, numbers({ requests: 5, rowsRead: 0, rowsWritten: 0 }));
  assert.deepEqual(JSON.parse(stateRow(db).parts!), { workers: [], pages: 5 });
});

test('a failed pre-read cannot cause a second mail for the same threshold', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  const real = (env as unknown as { DB: D1Database }).DB;
  const blind = { ...(env as object), DB: new Proxy(real, {
    get: (t, k) => k === 'prepare'
      ? (sql: string) => { if (sql.startsWith('SELECT * FROM usage_state')) throw new Error('D1 hiccup'); return t.prepare(sql); }
      : (t as never)[k as never] && typeof (t as never)[k as never] === 'function' ? ((t as never)[k as never] as (...a: unknown[]) => unknown).bind(t) : (t as never)[k as never],
  }) } as never;
  assert.equal(await checkUsage(blind, NOON + 3600, numbers({ requests: 72_000, rowsRead: 0, rowsWritten: 0 })), 'measured');
  assert.equal(mail.sent.length, 1);
  assert.equal(auditCount(db, 'usage.alert'), 1);
});

// The text part is base64 in the MIME; decode it so the link can be read.
const mime = (raw: string) => Buffer.from(/base64\r?\n\r?\n([A-Za-z0-9+/=\r\n]+)/.exec(raw)?.[1].replace(/\s/g, '') ?? '', 'base64').toString('utf8');

test('the mail links to the fixed panel address, whatever answered the tick', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  assert.match(mime(mail.mimes[0]), /Panel: https:\/\/rsg-turkiye\.iscbsc\.org\/admin#genel/);
});

test('a field name Cloudflare does not know fails the check and mails nobody', async () => {
  assert.equal(await checkUsage(env, NOON, unknownFieldGql), 'failed');
  assert.match(stateRow(db).error ?? '', /Cannot query field/);
  assert.equal(stateRow(db).day, null);
  assert.equal(mail.sent.length, 0);
  assert.equal(auditCount(db, 'usage.alert'), 0);
});

test('a long error is cut to 200 characters', async () => {
  await checkUsage(env, NOON, errorGql('x'.repeat(500)));
  assert.equal(stateRow(db).error?.length, 200);
});

test('a later success clears the error', async () => {
  await checkUsage(env, NOON, errorGql('not authorized'));
  await checkUsage(env, NOON + 3600, numbers({ requests: 1, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(stateRow(db).error, null);
});

test('D1 refusing writes mails nobody', async () => {
  db.exec('DROP TABLE usage_state'); // stands in for D1 refusing writes
  await assert.rejects(checkUsage(env, NOON, numbers({ requests: 99_000, rowsRead: 0, rowsWritten: 0 })));
  assert.equal(mail.sent.length, 0);
});

test('mail failure does not resend next hour', async () => {
  mail.fail();
  const original = console.error;
  console.error = () => {}; // the failed send is logged; expected here
  try {
    await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  } finally {
    console.error = original;
  }
  assert.equal(await checkUsage(env, NOON + 3600, numbers({ requests: 72_000, rowsRead: 0, rowsWritten: 0 })), 'measured');
  assert.equal(auditCount(db, 'usage.alert'), 1);
});

test('a missing seed row is written by the measurement', async () => {
  db.exec('DELETE FROM usage_state');
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(stateRow(db).requests, 71_000);
  assert.equal(mail.sent.length, 1);
});

test('readUsageState is null without the table, and reads the row', async () => {
  await checkUsage(env, NOON, numbers({ requests: 71_000, rowsRead: 5, rowsWritten: 6 }));
  assert.deepEqual(await readUsageState((env as { DB: D1Database }).DB), {
    checkedAt: NOON, measuredAt: NOON, day: '2026-10-26', usage: { requests: 71_000, rowsRead: 5, rowsWritten: 6 }, parts: { workers: [], pages: 71_000 },
    error: null, alertDay: '2026-10-26', alerted: ['requests:70'],
  });
  db.exec('DROP TABLE usage_state');
  assert.equal(await readUsageState((env as { DB: D1Database }).DB), null);
});

test('the alert mail is Turkish first and names the metric and the reset', () => {
  const m = usageAlertMessage([{ metric: 'rowsRead', threshold: 90, value: 4_600_000, limit: 5_000_000 }], 'https://rsg-turkiye.iscbsc.org/admin#genel');
  assert.ok(m.text.indexOf('D1 okunan satır') < m.text.indexOf('D1 rows read'));
  assert.ok(m.text.indexOf('D1 okunan satır') >= 0);
  assert.match(m.text, /92%/);
  assert.match(m.text, /00:00 UTC/);
  assert.match(m.text, /every D1 read fails/);
  assert.match(m.text, /https:\/\/rsg-turkiye\.iscbsc\.org\/admin#genel/);
  assert.equal(m.subject, 'Ücretsiz kota %90 sınırını geçti / Free-tier usage passed 90%');
});

test('the alert mail names the highest threshold and every pair', () => {
  const m = usageAlertMessage([
    { metric: 'requests', threshold: 70, value: 95_000, limit: 100_000 },
    { metric: 'requests', threshold: 90, value: 95_000, limit: 100_000 },
    { metric: 'rowsWritten', threshold: 70, value: 71_000, limit: 100_000 },
  ], 'https://x/admin#genel');
  assert.match(m.subject, /90%/);
  assert.match(m.text, /Worker requests/);
  assert.match(m.text, /D1 rows written/);
  assert.match(m.text, /every API call fails/);
  assert.match(m.text, /every D1 write fails/);
  assert.doesNotMatch(m.text, /\u2014/);
});
