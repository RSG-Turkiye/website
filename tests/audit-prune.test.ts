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

test('the prune also removes expired agent rate buckets and agent tokens dead for over a year', async () => {
  const { env, db } = setup();
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u', 'g-u', 'u@example.org', 1, 1)`).run();
  const bucket = db.prepare('INSERT INTO agent_rate (bucket, n, expires_at) VALUES (?, 1, ?)');
  bucket.run('t:a:m:1', NOW - 60);
  bucket.run('t:a:d:1', NOW - 1);
  bucket.run('t:a:d:2', NOW + 3600);
  const year = AUDIT_RETENTION_SECONDS;
  const token = db.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, hint, label, scopes, created_at, expires_at, revoked_at) VALUES (?, 'u', ?, 'abcd', 'l', '["social:read"]', 1, ?, ?)`,
  );
  token.run('revoked-long-ago', 'h1', NOW + 86400, NOW - year - 10);
  token.run('expired-long-ago', 'h2', NOW - year - 10, null);
  token.run('revoked-lately', 'h3', NOW - year + 86400, NOW - 86400);
  token.run('expired-lately', 'h4', NOW - 86400, null);
  token.run('live', 'h5', NOW + 86400, null);

  const res = await prune(env, 's3cret');
  assert.equal(res.status, 200);
  assert.deepEqual((db.prepare('SELECT bucket FROM agent_rate').all() as { bucket: string }[]).map((r) => r.bucket), ['t:a:d:2']);
  assert.deepEqual((db.prepare('SELECT id FROM agent_tokens ORDER BY id').all() as { id: string }[]).map((r) => r.id), ['expired-lately', 'live', 'revoked-lately']);
  const row = db.prepare(`SELECT details FROM audit_log WHERE action = 'audit.prune'`).get() as { details: string };
  assert.deepEqual(JSON.parse(row.details), { deleted: 0, cutoff: JSON.parse(row.details).cutoff, agentRate: 2, agentTokens: 2 });
});
