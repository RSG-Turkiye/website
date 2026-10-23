import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestPost } from '../functions/api/mail/dispatch';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

async function dispatchAt(iso: string, db: DatabaseSync) {
  const RealDate = globalThis.Date;
  const at = RealDate.parse(iso);
  class Fixed extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error -- forwarding a variadic Date constructor
      super(...(args.length === 0 ? [at] : args));
    }
    static now() { return at; }
  }
  globalThis.Date = Fixed as DateConstructor;
  try {
    return await (onRequestPost as (c: unknown) => Promise<Response>)({
      request: new Request('https://x/api/mail/dispatch', { method: 'POST', headers: { 'X-Dispatch-Secret': 's' } }),
      env: { DB: d1(db), MAIL_SYNC_SECRET: 's' },
    });
  } finally {
    globalThis.Date = RealDate;
  }
}

function seeded(expiresAt: number) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO users (id, google_id, email, created_at, last_login, is_writer) VALUES (?, ?, ?, 0, 0, 1)').run('u1', 'g1', 'one@example.org');
  db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, 0)').run('g1', 'u1', 'writer', expiresAt, 'u1');
  return db;
}
const writer = (db: DatabaseSync) => (db.prepare("SELECT is_writer AS v FROM users WHERE id = 'u1'").get() as { v: number }).v;

test('a grant that ends at night is swept on the hourly tick although mail is held', async () => {
  const at = Date.parse('2026-09-08T00:00:00Z') / 1000; // 03:00 Istanbul, on the hour
  const db = seeded(at - 600);
  const res = await dispatchAt('2026-09-08T00:00:00Z', db);
  assert.match((await res.json<{ held?: string }>()).held ?? '', /outside 8:00-22:00/);
  assert.equal(writer(db), 0);
});

test('off the hourly tick the night dispatch does not sweep', async () => {
  const at = Date.parse('2026-09-08T00:30:00Z') / 1000;
  const db = seeded(at - 600);
  await dispatchAt('2026-09-08T00:30:00Z', db);
  assert.equal(writer(db), 1);
});
