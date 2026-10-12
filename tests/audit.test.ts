import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { appendAudit, runWithAudit, verifyChain, toCsv, GENESIS, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@example.org',1,1)`).run();
  return { db, DB: d1(db) as never };
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[];

test('the first row links to GENESIS and each next row to the one before', async () => {
  const { db, DB } = setup();
  await appendAudit(DB, { userId: 'u1', action: 'role.change', targetType: 'user', targetId: 'u2', details: { role: 'is_social', value: 1 } }, 100);
  await appendAudit(DB, { userId: null, action: 'audit.prune' }, 101);
  const [a, b] = rows(db);
  assert.equal(a.prev_hash, GENESIS);
  assert.equal(b.prev_hash, a.hash);
  assert.equal(a.details, '{"role":"is_social","value":1}');
  assert.equal(b.details, '{}');
  assert.deepEqual(await verifyChain(rows(db)), { ok: true, checked: 2, anchoredAfterPrune: false });
});

test('concurrent appends do not fork the chain', async () => {
  const { db, DB } = setup();
  await Promise.all([1, 2, 3, 4, 5].map((n) => appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100)));
  const all = rows(db);
  assert.equal(all.length, 5);
  assert.equal((await verifyChain(all)).ok, true);
});

test('runWithAudit applies the statements and the audit row together', async () => {
  const { db, DB } = setup();
  await runWithAudit(DB, [DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind('u1')], { userId: 'u1', action: 'role.change' }, 100);
  assert.equal((db.prepare('SELECT is_admin FROM users').get() as { is_admin: number }).is_admin, 1);
  assert.equal(rows(db).length, 1);
});

test('when the audit row cannot be written the mutation does not happen', async () => {
  const { db, DB } = setup();
  db.exec('DROP TABLE audit_log');
  await assert.rejects(runWithAudit(DB, [DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind('u1')], { userId: 'u1', action: 'role.change' }, 100));
  assert.equal((db.prepare('SELECT is_admin FROM users').get() as { is_admin: number }).is_admin, 0);
});

test('an edited row is caught as a hash break, a removed row as a link break', async () => {
  const { db, DB } = setup();
  for (const n of [1, 2, 3]) await appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100 + n);
  const edited = rows(db).map((r) => (r.seq === 2 ? { ...r, action: 'something-else' } : r));
  assert.deepEqual(await verifyChain(edited), { ok: false, checked: 1, brokenAt: 2, reason: 'hash' });
  const removed = rows(db).filter((r) => r.seq !== 2);
  assert.deepEqual(await verifyChain(removed), { ok: false, checked: 1, brokenAt: 3, reason: 'link' });
});

test('a chain whose first row is not GENESIS-linked verifies, flagged as pruned', async () => {
  const { db, DB } = setup();
  for (const n of [1, 2, 3]) await appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100 + n);
  const tail = rows(db).slice(1);
  assert.deepEqual(await verifyChain(tail), { ok: true, checked: 2, anchoredAfterPrune: true });
});

test('CSV quotes what needs quoting and defuses spreadsheet formulas', () => {
  const csv = toCsv([{ seq: 1, at: 0, user_id: 'u1', user_email: '=cmd@example.org', action: 'x', target_type: null, target_id: 'a,b', details: '{"q":"x,y"}', prev_hash: 'p', hash: 'h' }]);
  const [header, line] = csv.trimEnd().split('\r\n');
  assert.equal(header, 'seq,at,user_email,action,target_type,target_id,details,prev_hash,hash');
  assert.equal(line, `1,1970-01-01T00:00:00.000Z,'=cmd@example.org,x,,"a,b","{""q"":""x,y""}",p,h`);
});
