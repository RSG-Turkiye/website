import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { onRequestPost } from '../functions/api/admin/certificates/purge';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = Math.floor(Date.now() / 1000);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare(`INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at) VALUES (?,2026,?,?,'participation',1,'u1',?,?)`);
  add.run('old', 'a@example.org', 'A', NOW - 40 * 86400, NOW - 10);
  add.run('gone', 'b@example.org', 'B', NOW - 40 * 86400, NOW - 10);
  add.run('new', 'c@example.org', 'C', NOW, NOW + 86400);
  db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').run('h', NOW - 2 * 86400);
  db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').run('h', NOW - 60);
  const r2 = fakeR2();
  r2.store.set('certificates/old.pdf', { body: new Uint8Array(1) });
  r2.store.set('certificates/new.pdf', { body: new Uint8Array(1) });
  // 'gone' has no object: the lifecycle rule got there first.
  return { db, r2, env: { DB: d1(db), MAIL_ATTACHMENTS: r2, SYMPOSIUM_ARCHIVE_SECRET: 's3cret' } as never };
}
const purge = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/certificates/purge', {
      method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {},
    }),
    env,
  });

test('without the secret nothing is deleted', async () => {
  const { env, db } = setup();
  assert.equal((await purge(env)).status, 403);
  assert.equal((await purge(env, 'wrong')).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 3);
});

test('expired certificates go from R2 and D1, emails included; current ones stay', async () => {
  const { env, db, r2 } = setup();
  const res = await purge(env, 's3cret');
  assert.deepEqual(await res.json(), { ok: true, certificates: 2, lookups: 1 });
  assert.deepEqual([...r2.store.keys()], ['certificates/new.pdf']);
  const emails = (db.prepare('SELECT email FROM symposium_certificates').all() as { email: string }[]).map((r) => r.email);
  assert.deepEqual(emails, ['c@example.org']);
});

test('a second run finds nothing', async () => {
  const { env } = setup();
  await purge(env, 's3cret');
  assert.deepEqual(await (await purge(env, 's3cret')).json(), { ok: true, certificates: 0, lookups: 0 });
});
