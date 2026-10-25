import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { grantRole, revokeRole, activeGrants, expireGrants, syncColumnsStatement } from '../functions/_lib/role-grants';
import { addMonths } from '../functions/_lib/roles';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
/** The text of one numbered migration note, e.g. note('8i'). */
const note = (id: string) => {
  const start = SCHEMA.indexOf(`-- ${id}.`);
  assert.ok(start >= 0, `note ${id} not found`);
  const next = SCHEMA.slice(start + 1).search(/\n--\s*\n|\n\s*\n/);
  return SCHEMA.slice(start, next < 0 ? undefined : start + 1 + next);
};
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
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  const rows = grants(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].role, 'announcer');
  assert.equal(rows[0].expires_at, NOW + MONTH);
  assert.equal(rows[0].granted_by, 'admin');
  assert.equal(flag(db, 'is_announcer'), 1);
  assert.deepEqual(audits(db), [{
    user_id: 'admin', action: 'role.grant', target_type: 'user', target_id: 'u1',
    details: { role: 'announcer', expiresAt: NOW + MONTH },
  }]);
});

test('when the audit insert fails, neither the grant nor the column changes', async () => {
  const { db, DB } = setup();
  db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
  await assert.rejects(grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: null, by: 'admin' }, NOW), /audit down/);
  assert.equal(grants(db).length, 0);
  assert.equal(flag(db, 'is_announcer'), 0);
});

test('extra statements land in the same batch, and roll back with it', async () => {
  const { db, DB } = setup();
  db.exec("INSERT INTO profiles (user_id, username, display_name, updated_at) VALUES ('u1', 'one', 'One', 0)");
  const extra = () => [DB.prepare("UPDATE profiles SET bio = 'x' WHERE user_id = 'u1'")];
  const bio = () => (db.prepare("SELECT bio FROM profiles WHERE user_id = 'u1'").get() as { bio: string | null }).bio;
  await grantRole(DB, { userId: 'u1', role: 'sender', expiresAt: NOW + MONTH, by: 'admin', extra: extra() }, NOW);
  assert.equal(bio(), 'x');
  db.exec("UPDATE profiles SET bio = NULL");
  db.exec("CREATE TRIGGER no_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'audit down'); END");
  await assert.rejects(revokeRole(DB, { userId: 'u1', role: 'sender', by: 'admin', extra: extra() }, NOW + 1), /audit down/);
  assert.equal(bio(), null);
  assert.equal(flag(db, 'is_sender'), 1);
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
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + DAY, by: 'admin' }, NOW);
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + MONTH, by: 'admin' }, NOW + 10);
  assert.deepEqual(live(db, 'announcer').map((g) => g.expires_at), [NOW + MONTH]);
  const old = grants(db, 'announcer').find((g) => g.expires_at === NOW + DAY)!;
  assert.equal(old.revoked_at, NOW + 10);
  assert.equal(old.revoked_by, 'admin');

  // Earlier end: nothing is inserted, the later row stays, the attempt is still logged.
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + 2 * DAY, by: 'admin' }, NOW + 20);
  assert.equal(grants(db, 'announcer').length, 2);
  assert.deepEqual(live(db, 'announcer').map((g) => g.expires_at), [NOW + MONTH]);
  assert.deepEqual(audits(db).at(-1)!.details, { role: 'announcer', expiresAt: NOW + 2 * DAY, kept: true });

  // null beats any date, and nothing beats null.
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: null, by: 'admin' }, NOW + 30);
  assert.deepEqual(live(db, 'announcer').map((g) => g.expires_at), [null]);
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + 12 * MONTH, by: 'admin' }, NOW + 40);
  assert.deepEqual(live(db, 'announcer').map((g) => g.expires_at), [null]);
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: null, by: 'admin' }, NOW + 50);
  assert.equal(live(db, 'announcer').length, 1);
  assert.equal(flag(db, 'is_announcer'), 1);
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
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + DAY, by: 'admin' }, NOW);
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + 2 * DAY + 10, by: 'admin' }, NOW + 2 * DAY);
  assert.equal(grants(db, 'announcer').length, 2);
  assert.equal(live(db, 'announcer', NOW + 2 * DAY).length, 1);
});

test('revokeRole ends every live grant of the role and clears the column', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'announcer', expiresAt: NOW + MONTH, by: 'admin' }, NOW);
  // A second live row cannot come from grantRole any more; seed it as an older bug or race would.
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('dup', 'u1', 'announcer', NULL, NULL, ?)`).run(NOW);
  assert.equal(live(db, 'announcer').length, 2);
  await revokeRole(DB, { userId: 'u1', role: 'announcer', by: 'admin' }, NOW + 5);
  assert.equal(live(db, 'announcer', NOW + 5).length, 0);
  assert.ok(grants(db, 'announcer').every((g) => g.revoked_at === NOW + 5 && g.revoked_by === 'admin'));
  assert.equal(flag(db, 'is_announcer'), 0);
  const last = audits(db).at(-1)!;
  assert.equal(last.action, 'role.revoke');
  assert.equal(last.user_id, 'admin');
  assert.equal(last.target_id, 'u1');
  assert.equal(last.details.role, 'announcer');
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

test('revoking a permanent social_publisher cuts the social it implied back to one month', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: null, by: 'admin' }, NOW);
  await revokeRole(DB, { userId: 'u1', role: 'social_publisher', by: 'admin' }, NOW + 1);
  assert.deepEqual(live(db, 'social', NOW + 1).map((g) => g.expires_at), [addMonths(NOW + 1, 1)]);
  assert.equal(flag(db, 'is_social'), 1);
  assert.equal(flag(db, 'is_social_publisher'), 0);
  assert.deepEqual(audits(db).at(-1)!.details, { role: 'social_publisher', expiresAt: null, capped: { social: addMonths(NOW + 1, 1) } });
});

test('a social grant already ending within the month is left as it is when the publisher goes', async () => {
  const { db, DB } = setup();
  await grantRole(DB, { userId: 'u1', role: 'social_publisher', expiresAt: NOW + 10 * DAY, by: 'admin' }, NOW);
  await revokeRole(DB, { userId: 'u1', role: 'social_publisher', by: 'admin' }, NOW + 1);
  assert.deepEqual(live(db, 'social', NOW + 1).map((g) => g.expires_at), [NOW + 10 * DAY]);
  assert.deepEqual(audits(db).at(-1)!.details, { role: 'social_publisher', expiresAt: NOW + 10 * DAY });
});

test('the 7f hand recovery leaves a role that survives the next column sync', async () => {
  const { db, DB } = setup();
  const commands = [...note('7f').matchAll(/--command="([^"]+)"/g)].map((m) => m[1].replaceAll('someone@example.com', 'one@example.org'));
  assert.equal(commands.length, 2);
  for (const c of commands) db.exec(c);
  assert.equal(flag(db, 'is_symposium'), 1);
  await syncColumnsStatement(DB, 'u1', NOW).run();
  assert.equal(flag(db, 'is_symposium'), 1);
  const [g] = live(db, 'symposium', NOW);
  assert.equal(g.expires_at, null);
  assert.equal(g.granted_by, null);
  assert.equal((db.prepare("SELECT note FROM role_grants WHERE user_id = 'u1'").get() as { note: string }).note, 'manual recovery');
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
  const backfill = [...note('8i').matchAll(/--command="(INSERT INTO role_grants [^"]+)"/g)].map((m) => m[1]);
  const reconcile = [...note('8i').matchAll(/--command="(UPDATE role_grants [^"]+)"/g)].map((m) => m[1]);
  assert.equal(reconcile.length, 7, 'one reconcile statement per role');
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

test('re-running the 8i backfill and reconcile catches roles changed by the old panel in between', () => {
  const { db } = setup();
  const commands = (verb: string) => [...note('8i').matchAll(new RegExp(`--command="(${verb} role_grants [^"]+)"`, 'g'))].map((m) => m[1]);
  const backfill = commands('INSERT INTO');
  const reconcile = commands('UPDATE');
  db.exec("UPDATE users SET is_writer = 1, is_sender = 1 WHERE id = 'u1'");
  for (const s of backfill) db.exec(s);
  // The old panel, still deployed, changes the columns directly.
  db.exec("UPDATE users SET is_writer = 0, is_announcer = 1 WHERE id = 'u1'");
  for (let run = 0; run < 2; run++) for (const s of [...backfill, ...reconcile]) db.exec(s);
  const liveNow = db.prepare("SELECT role, expires_at FROM role_grants WHERE user_id = 'u1' AND revoked_at IS NULL ORDER BY role").all()
    .map((r) => ({ ...r }));
  assert.deepEqual(liveNow, [
    { role: 'announcer', expires_at: null },
    { role: 'sender', expires_at: null },
  ]);
  const writer = db.prepare("SELECT revoked_at FROM role_grants WHERE user_id = 'u1' AND role = 'writer'").all() as { revoked_at: number | null }[];
  assert.equal(writer.length, 1);
  assert.notEqual(writer[0].revoked_at, null);
});

const seed = (db: DatabaseSync, role: string, expiresAt: number | null, userId = 'u1') =>
  db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(crypto.randomUUID(), userId, role, expiresAt, 'admin', NOW - DAY);

test('expireGrants ends a grant that ran out, clears the column and logs role.expire', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW);
  db.exec("UPDATE users SET is_writer = 1 WHERE id = 'u1'");
  assert.equal(await expireGrants(DB, NOW + 1), 1);
  assert.equal(flag(db, 'is_writer'), 0);
  const [g] = grants(db, 'writer');
  assert.equal(g.revoked_at, NOW);
  assert.equal(g.revoked_by, null);
  assert.deepEqual(audits(db), [{
    user_id: null, action: 'role.expire', target_type: 'user', target_id: 'u1', details: { roles: ['writer'] },
  }]);
});

test('a grant that has not run out yet is left alone', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW + 10);
  db.exec("UPDATE users SET is_writer = 1 WHERE id = 'u1'");
  assert.equal(await expireGrants(DB, NOW), 0);
  assert.equal(flag(db, 'is_writer'), 1);
});

test('a user who also holds the role for good keeps it when the timed grant ends', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW);
  seed(db, 'writer', null);
  db.exec("UPDATE users SET is_writer = 1 WHERE id = 'u1'");
  assert.equal(await expireGrants(DB, NOW + 1), 1);
  assert.equal(flag(db, 'is_writer'), 1);
  assert.equal(live(db, 'writer', NOW + 1).length, 1);
});

test('publisher expiring while editor runs longer keeps is_social', async () => {
  const { db, DB } = setup();
  seed(db, 'social_publisher', NOW);
  seed(db, 'social', NOW + MONTH);
  db.exec("UPDATE users SET is_social = 1, is_social_publisher = 1 WHERE id = 'u1'");
  assert.equal(await expireGrants(DB, NOW + 1), 1);
  assert.equal(flag(db, 'is_social_publisher'), 0);
  assert.equal(flag(db, 'is_social'), 1);
});

test('each user gets one audit row listing all the roles that ended', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW - 5);
  seed(db, 'editor', NOW - 4);
  seed(db, 'writer', NOW - 3, 'admin');
  assert.equal(await expireGrants(DB, NOW), 3);
  const rows = audits(db);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.action === 'role.expire' && r.user_id === null));
  const u1 = rows.find((r) => r.target_id === 'u1')!;
  assert.deepEqual([...u1.details.roles].sort(), ['editor', 'writer']);
});

test('with nothing due, expireGrants runs one indexed SELECT and writes nothing', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW + MONTH);
  seed(db, 'editor', null);
  const prepared: string[] = [];
  const spy = new Proxy(DB, {
    get(target, prop) {
      if (prop === 'prepare') return (q: string) => { prepared.push(q); return target.prepare(q); };
      if (prop === 'batch') return () => { throw new Error('unexpected batch'); };
      return (target as any)[prop];
    },
  }) as D1Database;
  assert.equal(await expireGrants(spy, NOW), 0);
  assert.equal(prepared.length, 1);
  assert.match(prepared[0], /^\s*SELECT/i);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${prepared[0]}`).all(NOW) as { detail: string }[]).map((r) => r.detail);
  assert.ok(plan.some((d) => d.includes('USING INDEX idx_role_grants_expiry')), `no expiry index: ${plan.join(' / ')}`);
});

test('one user failing does not stop the sweep for the others', async () => {
  const { db, DB } = setup();
  seed(db, 'writer', NOW - 5, 'u1');
  seed(db, 'writer', NOW - 3, 'admin');
  db.exec("UPDATE users SET is_writer = 1");
  db.exec("CREATE TRIGGER no_u1 BEFORE INSERT ON audit_log WHEN NEW.target_id = 'u1' BEGIN SELECT RAISE(ABORT, 'audit down for u1'); END");
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    assert.equal(await expireGrants(DB, NOW), 1);
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
  assert.equal(flag(db, 'is_writer'), 1, "u1's batch rolled back");
  assert.equal((db.prepare("SELECT is_writer AS v FROM users WHERE id = 'admin'").get() as { v: number }).v, 0);
  assert.deepEqual(audits(db).map((r) => r.target_id), ['admin']);
});

test('a retired role (writer) cannot be granted, but a live grant of it can still be revoked', async () => {
  const { db, DB } = setup();
  await assert.rejects(grantRole(DB, { userId: 'u1', role: 'writer', expiresAt: NOW + MONTH, by: 'admin' }, NOW), /retired/);
  assert.equal(grants(db, 'writer').length, 0);
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('old', 'u1', 'writer', NULL, NULL, 1)`).run();
  db.exec(`UPDATE users SET is_writer = 1 WHERE id = 'u1'`);
  await revokeRole(DB, { userId: 'u1', role: 'writer', by: 'admin' }, NOW);
  assert.equal(live(db, 'writer').length, 0);
  assert.equal(flag(db, 'is_writer'), 0);
  assert.equal(audits(db).at(-1)!.action, 'role.revoke');
});
