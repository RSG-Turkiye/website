import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubMail } from './lib/social';
import { stubHttp } from './lib/http';
import { usageData } from './lib/usage';
import { onRequestPost } from '../functions/api/mail/dispatch';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

/** A tick at a fixed time, with no waitUntil, so everything it starts is awaited before it answers. */
async function dispatchAt(iso: string, db: DatabaseSync) {
  const RealDate = globalThis.Date;
  const at = RealDate.parse(iso);
  class Fixed extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error: forwarding a variadic Date constructor
      super(...(args.length === 0 ? [at] : args));
    }
    static now() { return at; }
  }
  globalThis.Date = Fixed as DateConstructor;
  try {
    return await (onRequestPost as (c: unknown) => Promise<Response>)({
      request: new Request('https://x/api/mail/dispatch', { method: 'POST', headers: { 'X-Dispatch-Secret': 's' } }),
      env: { DB: d1(db), MAIL_SYNC_SECRET: 's', CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok' },
    });
  } finally {
    globalThis.Date = RealDate;
  }
}

type StateRow = { checked_at: number | null; day: string | null; requests: number | null };
const stateRow = (db: DatabaseSync) => db.prepare('SELECT * FROM usage_state WHERE id = 1').get() as StateRow;

let db: DatabaseSync;
let mail: ReturnType<typeof stubMail>;
let cf: ReturnType<typeof stubHttp>;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  mail = stubMail();
  cf = stubHttp(['api.cloudflare.com'], () =>
    new Response(JSON.stringify({ data: { viewer: { accounts: [usageData({ requests: 1234, rowsRead: 0, rowsWritten: 0 })] } } }), { status: 200 }));
});
afterEach(() => {
  cf.restore();
  mail.restore();
});

test('the on-the-hour tick measures usage, even at night', async () => {
  const res = await dispatchAt('2026-10-26T00:00:30Z', db); // 03:00 Istanbul, mail held
  assert.equal(res.status, 200);
  assert.match((await res.json<{ held?: string }>()).held ?? '', /outside/);
  assert.equal(cf.calls.length, 1);
  assert.equal(cf.calls[0].url.pathname, '/client/v4/graphql');
  assert.equal(stateRow(db).day, '2026-10-26');
  assert.equal(stateRow(db).requests, 1234);
});

test('the on-the-hour tick measures usage in the sending window', async () => {
  const res = await dispatchAt('2026-10-26T10:00:00Z', db);
  assert.equal(res.status, 200);
  assert.equal(cf.calls.length, 1);
  assert.equal(stateRow(db).checked_at, Date.parse('2026-10-26T10:00:00Z') / 1000);
});

test('other minutes never call Cloudflare or write usage_state', async () => {
  await dispatchAt('2026-10-26T10:30:00Z', db);
  await dispatchAt('2026-10-26T10:01:00Z', db);
  assert.equal(cf.calls.length, 0);
  assert.equal(stateRow(db).checked_at, null);
});

test('a usage check that throws does not fail the tick', async () => {
  // A GraphQL 500 is caught inside checkUsage, so it cannot test the wrapper.
  // A missing table makes checkUsage itself throw; only the dispatch try/catch saves the tick.
  db.exec('DROP TABLE usage_state');
  const errors: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const res = await dispatchAt('2026-10-26T10:00:00Z', db);
    assert.equal(res.status, 200);
    assert.equal((await res.json<{ ok: boolean }>()).ok, true);
  } finally {
    console.error = original;
  }
  assert.ok(errors.some((e) => e[0] === 'usage check failed'), JSON.stringify(errors.map((e) => String(e[0]))));
});
