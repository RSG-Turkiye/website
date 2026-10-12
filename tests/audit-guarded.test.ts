import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { runGuardedWithAudit, verifyChain, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, nonce TEXT, note TEXT)`);
  db.prepare(`INSERT INTO t (id, rev) VALUES ('a', 0)`).run();
  return { db, DB: d1(db) as never as D1Database };
}
// The proof names something only this writer wrote (its nonce): a revision
// number would also be true for a loser that computed the same next revision.
const PROOF = (nonce: string) => ({ condition: 'EXISTS (SELECT 1 FROM t WHERE id = ? AND nonce = ?)', binds: ['a', nonce] });
const GUARD = (DB: D1Database, rev: number, nonce: string) => DB.prepare('UPDATE t SET rev = rev + 1, nonce = ? WHERE id = ? AND rev = ?').bind(nonce, 'a', rev);
const AFTER = (DB: D1Database, nonce: string) => DB.prepare(`UPDATE t SET note = 'after' WHERE id = ? AND EXISTS (SELECT 1 FROM t WHERE id = ? AND nonce = ?)`).bind('a', 'a', nonce);

test('when the guard applies, the audit row and the after-statements land', async () => {
  const { db, DB } = setup();
  const ok = await runGuardedWithAudit(DB, GUARD(DB, 0, 'n1'), PROOF('n1'), [AFTER(DB, 'n1')], { userId: 'u1', action: 'x.change' }, 100);
  assert.equal(ok, true);
  assert.deepEqual({ ...db.prepare('SELECT rev, note FROM t').get() as object }, { rev: 1, note: 'after' });
  const rows = db.prepare('SELECT * FROM audit_log').all() as unknown as AuditRow[];
  assert.equal(rows.length, 1);
  assert.equal((await verifyChain(rows)).ok, true);
});

test('when the guard matches nothing, nothing is written and false comes back', async () => {
  const { db, DB } = setup();
  const ok = await runGuardedWithAudit(DB, GUARD(DB, 7, 'n1'), PROOF('n1'), [AFTER(DB, 'n1')], { userId: 'u1', action: 'x.change' }, 100);
  assert.equal(ok, false);
  assert.deepEqual({ ...db.prepare('SELECT rev, note FROM t').get() as object }, { rev: 0, note: null });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('two writers racing on one revision: exactly one wins, and only the winner is logged', async () => {
  const { db, DB } = setup();
  const attempt = (nonce: string) => runGuardedWithAudit(
    DB, GUARD(DB, 0, nonce), PROOF(nonce), [AFTER(DB, nonce)], { userId: 'u1', action: `x.${nonce}` }, 100,
  );
  const results = await Promise.all([attempt('n1'), attempt('n2')]);
  assert.deepEqual([...results].sort(), [false, true]);
  const logged = (db.prepare('SELECT action FROM audit_log').all() as { action: string }[]).map((r) => r.action);
  const winner = results[0] ? 'x.n1' : 'x.n2';
  assert.deepEqual(logged, [winner]);
});
