import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestPost } from '../functions/api/admin/audit/prune';
import { appendAudit, verifyChain, AUDIT_RETENTION_SECONDS, type AuditRow } from '../functions/_lib/audit';
import { safeEqual } from '../functions/_lib/secret';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = Math.floor(Date.now() / 1000);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, env: { DB: d1(db) as never, SYMPOSIUM_ARCHIVE_SECRET: 's3cret' } };
}
const prune = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/audit/prune', { method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {} }),
    env,
  });

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), false, 'an unset secret never matches');
  assert.equal(safeEqual(null, 'x'), false);
});

test('rows older than a year go, the chain still verifies, and the prune is logged', async () => {
  const { env, db } = setup();
  await appendAudit(env.DB, { userId: 'u', action: 'old' }, NOW - AUDIT_RETENTION_SECONDS - 10);
  await appendAudit(env.DB, { userId: 'u', action: 'old' }, NOW - AUDIT_RETENTION_SECONDS - 5);
  await appendAudit(env.DB, { userId: 'u', action: 'recent' }, NOW - 60);
  assert.equal((await prune(env)).status, 403);
  assert.equal((await prune(env, 'wrong')).status, 403);
  const res = await prune(env, 's3cret');
  assert.deepEqual(await res.json(), { ok: true, deleted: 2 });
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[];
  assert.deepEqual(rows.map((r) => r.action), ['recent', 'audit.prune']);
  assert.deepEqual(await verifyChain(rows), { ok: true, checked: 2, anchoredAfterPrune: true });
});
