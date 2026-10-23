import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { grantRole, revokeRole, activeGrants } from '../functions/_lib/role-grants';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;
const DAY = 86400;
const MONTH = 30 * DAY;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare('INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 0, 0)');
  add.run('u1', 'g1', 'one@example.org');
  add.run('admin', 'g2', 'admin@example.org');
  return { db, DB: d1(db) as unknown as D1Database };
}

type Grant = { id: string; role: string; expires_at: number | null; granted_by: string | null; revoked_at: number | null; revoked_by: string | null };
const grants = (db: DatabaseSync, role?: string) =>
  db.prepare(`SELECT * FROM role_grants WHERE user_id = 'u1'${role ? ' AND role = ?' : ''} ORDER BY granted_at, rowid`)
    .all(...(role ? [role] : [])) as Grant[];
const live = (db: DatabaseSync, role: string, now = NOW) =>
  grants(db, role).filter((g) => g.revoked_at === null && (g.expires_at === null || g.expires_at > now));
const flag = (db: DatabaseSync, column: string) =>
  (db.prepare(`SELECT ${column} AS v FROM users WHERE id = 'u1'`).get() as { v: number }).v;
const audits = (db: DatabaseSync) =>
  (db.prepare('SELECT user_id, action, target_type, target_id, details FROM audit_log ORDER BY seq').all() as
    { user_id: string; action: string; target_type: string; target_id: string; details: string }[])
    .map((r) => ({ ...r, details: JSON.parse(r.details) }));

test('grantRole writes the grant, sets the column and logs role.grant', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  const rows = grants(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'writer');
  assert.equal(rows[0].expires_at, NOW + MONTH);
  assert.equal(rows[0].granted_by, 'admin');
  assert.equal(flag(db, 'is_writer'), 1);
  assert.deepEqual(audits(db), [{
    user_id: 'admin', action: 'role.grant', target_type: 'user', target_id: 'u1',
    details: { role: 'writer', expiresAt: NOW + MONTH },
  }]);
});

test('when the audit insert fails, neither the grant nor the column changes', async () => {
  const { db, DB } = setup();
  db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
  await assert.rejects(grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: null, by: 'admin' }, NOW), /audit down/);
  assert.equal(grants(db).length, 0);
  assert.equal(flag(db, 'is_writer'), 0);
});

test('granting social_publisher for a month also makes social active until the same end', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  assert.equal(grants(db).length, 2);
  assert.deepEqual(live(db, 'social_publisher').map((g) => g.expires_at), [NOW + MONTH]);
  assert.deepEqual(live(db, 'social').map((g) => g.expires_at), [NOW + MONTH]);
  assert.equal(flag(db, 'is_social'), 1);
  assert.equal(flag(db, 'is_social_publisher'), 1);
  assert.equal(audits(db).length, 1);
});

test('granting a role the user already holds keeps one live row, the one with the later end', async () => {
  const { db, DB } = setup();
  // Later end: the old row is revoked by the granter and the new one replaces it.
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + DAY, by: 'admin' }, NOW);
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + MONTH, by: 'admin' }, NOW + 10);
  assert.deepEqual(live(db, 'writer').map((g) => g.expires_at), [NOW + MONTH]);
  const old = grants(db, 'writer').find((g) => g.expires_at === NOW + DAY)!;
  assert.equal(old.revoked_at, NOW + 10);
  assert.equal(old.revoked_by, 'admin');

  // Earlier end: nothing is inserted, the later row stays, the attempt is still logged.
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + 2 * DAY, by: 'admin' }, NOW + 20);
  assert.equal(grants(db, 'writer').length, 2);
  assert.deepEqual(live(db, 'writer').map((g) => g.expires_at), [NOW + MONTH]);
  assert.deepEqual(audits(db).at(-1)!.details, { role: 'writer', expiresAt: NOW + 2 * DAY, kept: true });

  // null beats any date, and nothing beats null.
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: null, by: 'admin' }, NOW + 30);
  assert.deepEqual(live(db, 'writer').map((g) => g.expires_at), [null]);
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + 12 * MONTH, by: 'admin' }, NOW + 40);
  assert.deepEqual(live(db, 'writer').map((g) => g.expires_at), [null]);
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: null, by: 'admin' }, NOW + 50);
  assert.equal(live(db, 'writer').length, 1);
  assert.equal(flag(db, 'is_writer'), 1);
});

test('the implied social grant follows the same rule', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'social', expiresAt: NOW + 2 * MONTH, by: 'admin' }, NOW);
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  // The longer social grant is kept.
  assert.deepEqual(live(db, 'social').map((g) => g.expires_at), [NOW + 2 * MONTH]);
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: null, by: 'admin' }, NOW);
  assert.deepEqual(live(db, 'social').map((g) => g.expires_at), [null]);
  assert.deepEqual(live(db, 'social_publisher').map((g) => g.expires_at), [null]);
});

test('an expired grant is not held, so granting again inserts a new live row', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + DAY, by: 'admin' }, NOW);
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + 2 * DAY + 10, by: 'admin' }, NOW + 2 * DAY);
  assert.equal(grants(db, 'writer').length, 2);
  assert.equal(live(db, 'writer', NOW + 2 * DAY).length, 1);
});

test('revokeRole ends every live grant of the role and clears the column', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  // A second live row cannot come from grantRole any more; seed it as an older bug or race would.
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('dup', 'u1', 'writer', NULL, NULL, ?)`).run(NOW);
  assert.equal(live(db, 'writer').length, 2);
  await revokeRole(DB, { userId: 'u1', role: 'writer', by: 'admin' }, NOW + 5);
  assert.equal(live(db, 'writer', NOW + 5).length, 0);
  assert.ok(grants(db, 'writer').every((g) => g.revoked_at === NOW + 5 && g.revoked_by === 'admin'));
  assert.equal(flag(db, 'is_writer'), 0);
  const last = audits(db).at(-1)!;
  assert.equal(last.action, 'role.revoke');
  assert.equal(last.user_id, 'admin');
  assert.equal(last.target_id, 'u1');
  assert.equal(last.details.role, 'writer');
});

test('revoking social also revokes social_publisher; revoking social_publisher leaves social', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  await revokeRole(DB, { userId: 'u1', role: 'social_publisher', by: 'admin' }, NOW + 1);
  assert.equal(flag(db, 'is_social_publisher'), 0);
  assert.equal(flag(db, 'is_social'), 1);
  assert.equal(live(db, 'social', NOW + 1).length, 1);

  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: NOW + MONTH, by: 'admin' }, NOW + 2);
  await revokeRole(DB, { userId: 'u1', role: 'social', by: 'admin' }, NOW + 3);
  assert.equal(live(db, 'social', NOW + 3).length, 0);
  assert.equal(live(db, 'social_publisher', NOW + 3).length, 0);
  assert.equal(flag(db, 'is_social'), 0);
  assert.equal(flag(db, 'is_social_publisher'), 0);
});

test('activeGrants leaves out revoked and expired grants', async () => {
  const { db, DB } = setup();
  const add = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, revoked_at) VALUES (?, ?, ?, ?, NULL, 0, ?)');
  add.run('a', 'u1', 'writer', NOW + DAY, null);
  add.run('b', 'u1', 'admin', null, null);
  add.run('c', 'u1', 'sender', NOW, null); // ends exactly now: gone
  add.run('d', 'u1', 'symposium', null, NOW - 1); // revoked
  add.run('e', 'admin', 'announcer', null, null); // someone else
  const rows = await activeGrants(DB, 'u1', NOW);
  assert.deepEqual(rows.sort((x, y) => x.role.localeCompare(y.role)), [
    { role: 'admin', expires_at: null },
    { role: 'writer', expires_at: NOW + DAY },
  ]);
});

test('the 8i backfill, run twice, gives one permanent grant per existing flag', () => {
  const { db } = setup();
  db.exec("UPDATE users SET is_admin = 1, is_writer = 1 WHERE id = 'admin'");
  db.exec("UPDATE users SET is_social = 1, is_social_publisher = 1, is_sender = 1 WHERE id = 'u1'");
  // The note's own commands, so the test checks what an operator would run.
  const backfill = [...SCHEMA.matchAll(/--command="(INSERT INTO role_grants [^"]+)"/g)].map((m) => m[1]);
  assert.equal(backfill.length, 7, 'one backfill statement per role');
  for (let run = 0; run < 2; run++) for (const s of backfill) db.exec(s);
  const rows = db.prepare('SELECT user_id, role, expires_at, granted_by FROM role_grants ORDER BY user_id, role').all()
    .map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { user_id: 'admin', role: 'admin', expires_at: null, granted_by: null },
    { user_id: 'admin', role: 'writer', expires_at: null, granted_by: null },
    { user_id: 'u1', role: 'sender', expires_at: null, granted_by: null },
    { user_id: 'u1', role: 'social', expires_at: null, granted_by: null },
    { user_id: 'u1', role: 'social_publisher', expires_at: null, granted_by: null },
  ]);
});
