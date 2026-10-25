import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { activeGrants } from '../functions/_lib/role-grants';
import { rightsFromRoles } from '../functions/_lib/roles';
import { d1 } from './lib/d1-sqlite';

/**
 * Migration note 8k (db/schema.sql): the retired writer role moves to
 * content.yazilar.edit. The SQL is read out of the note itself, so what is
 * tested is exactly what the owner runs against production.
 */
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOTE = SCHEMA.slice(SCHEMA.indexOf('-- 8k.'), SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS users'));
const COMMANDS = [...NOTE.matchAll(/--remote --command="([^"]+)"/g)].map((m) => m[1]);
const MOVE = COMMANDS.find((c) => c.startsWith('INSERT INTO role_grants'))!;
const CHECK = COMMANDS.find((c) => c.startsWith('SELECT'))!;

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
type Grant = { id: string; user_id: string; role: string; expires_at: number | null; granted_by: string | null; revoked_at: number | null; note: string | null };

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const t = now();
  const user = db.prepare('INSERT INTO users (id, google_id, email, is_admin, is_writer, is_sender, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?, 1, 1)');
  user.run('admin', 'g0', 'admin@example.org', 1, 0, 0);
  user.run('perm', 'g1', 'one@example.org', 0, 1, 0); // permanent writer: capped at 30 days
  user.run('soon', 'g2', 'two@example.org', 0, 1, 1); // writer ending in 10 days, and a sender
  user.run('gone', 'g3', 'three@example.org', 0, 0, 0); // writer taken away earlier
  user.run('lapsed', 'g4', 'four@example.org', 0, 0, 0); // writer past its end, not yet swept
  user.run('both', 'g5', 'five@example.org', 0, 1, 0); // writer and a Yazılar grant ending sooner: extended
  user.run('held', 'g7', 'seven@example.org', 0, 1, 0); // writer and a permanent Yazılar grant: kept
  user.run('longer', 'g8', 'eight@example.org', 0, 1, 0); // writer ending before the Yazılar grant it holds: kept
  user.run('long', 'g6', 'six@example.org', 0, 1, 0); // writer ending in 60 days: capped at 30
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, revoked_at) VALUES (?, ?, ?, ?, ?, 1, ?)');
  grant.run('a', 'admin', 'admin', null, null, null);
  grant.run('w-perm', 'perm', 'writer', null, null, null);
  grant.run('e-perm', 'perm', 'content.etkinlikler.edit', t + 20 * DAY, 'admin', null);
  grant.run('w-soon', 'soon', 'writer', t + 10 * DAY, 'admin', null);
  grant.run('s-soon', 'soon', 'sender', t + 15 * DAY, 'admin', null);
  grant.run('w-gone', 'gone', 'writer', null, null, t - DAY);
  grant.run('w-lapsed', 'lapsed', 'writer', t - DAY, 'admin', null);
  grant.run('w-both', 'both', 'writer', null, null, null);
  grant.run('y-both', 'both', 'content.yazilar.edit', t + 5 * DAY, 'admin', null);
  grant.run('w-long', 'long', 'writer', t + 60 * DAY, 'admin', null);
  grant.run('w-held', 'held', 'writer', t + 20 * DAY, 'admin', null);
  grant.run('y-held', 'held', 'content.yazilar.edit', null, 'admin', null);
  grant.run('w-longer', 'longer', 'writer', t + 10 * DAY, 'admin', null);
  grant.run('y-longer', 'longer', 'content.yazilar.edit', t + 25 * DAY, 'admin', null);
  // A grant made in the panel may carry a note; 8k adds to it, never replaces it.
  db.exec("UPDATE role_grants SET note = 'earlier note' WHERE id IN ('w-held', 'y-both')");
  return db;
}

const all = (db: DatabaseSync) => db.prepare('SELECT id, user_id, role, expires_at, granted_by, revoked_at, note FROM role_grants ORDER BY id').all() as unknown as Grant[];
const byId = (db: DatabaseSync, id: string) => all(db).find((g) => g.id === id)!;
const moved = (db: DatabaseSync, userId: string) =>
  all(db).filter((g) => g.user_id === userId && g.role === 'content.yazilar.edit' && g.note === 'migration 8k: moved from writer');
const flag = (db: DatabaseSync, userId: string, column: string) =>
  (db.prepare(`SELECT ${column} AS v FROM users WHERE id = ?`).get(userId) as { v: number }).v;

test('the note carries a look-first SELECT and one move command', () => {
  assert.equal(COMMANDS.length, 2, NOTE);
  assert.ok(MOVE && CHECK);
  // No person is named in the note: it finds the grant by role.
  assert.doesNotMatch(NOTE, /@|user_id = '/);
});

test('8k moves each live writer to Yazılar for at most 30 days and leaves every other role alone', async () => {
  const db = setup();
  const before = all(db);
  const t0 = now();
  db.exec(MOVE);
  const t1 = now();

  // Permanent writer: a Yazılar grant ending 30 days from now; writer ended.
  const [perm] = moved(db, 'perm');
  assert.ok(perm.expires_at! >= t0 + 30 * DAY && perm.expires_at! <= t1 + 30 * DAY, `ends ${perm.expires_at}`);
  assert.equal(perm.granted_by, null);
  assert.equal(perm.revoked_at, null);
  assert.ok(byId(db, 'w-perm').revoked_at! >= t0);
  assert.equal(byId(db, 'w-perm').note, 'migration 8k: moved to content.yazilar.edit');
  assert.equal(flag(db, 'perm', 'is_writer'), 0);

  // Writer ending sooner: the Yazılar grant keeps that end.
  const [soon] = moved(db, 'soon');
  assert.equal(soon.expires_at, byId(db, 'w-soon').expires_at);
  assert.notEqual(byId(db, 'w-soon').revoked_at, null);
  assert.equal(flag(db, 'soon', 'is_writer'), 0);

  // Writer ending later than 30 days: capped, as an edit role runs at most a month.
  const [long] = moved(db, 'long');
  assert.ok(long.expires_at! >= t0 + 30 * DAY && long.expires_at! <= t1 + 30 * DAY, `ends ${long.expires_at}`);

  // A Yazılar grant ending sooner than the writer's (capped) end is extended to it, not duplicated.
  assert.deepEqual(moved(db, 'both'), []);
  const yBoth = byId(db, 'y-both');
  assert.ok(yBoth.expires_at! >= t0 + 30 * DAY && yBoth.expires_at! <= t1 + 30 * DAY, `extended to ${yBoth.expires_at}`);
  assert.equal(yBoth.note, 'earlier note; migration 8k: extended for writer');
  assert.equal(byId(db, 'w-both').note, 'migration 8k: moved to content.yazilar.edit');
  assert.notEqual(byId(db, 'w-both').revoked_at, null);
  assert.equal(flag(db, 'both', 'is_writer'), 0);

  // A Yazılar grant that already lasts long enough is left alone; the writer ends,
  // its note says nothing moved, and an earlier note is kept.
  assert.notEqual(byId(db, 'w-held').revoked_at, null);
  assert.equal(byId(db, 'w-held').note, 'earlier note; migration 8k: ended, content.yazilar.edit already held');
  assert.notEqual(byId(db, 'w-longer').revoked_at, null);
  assert.equal(byId(db, 'w-longer').note, 'migration 8k: ended, content.yazilar.edit already held');

  // A writer grant that was already ended, or has run out, gives nothing.
  assert.deepEqual(moved(db, 'gone'), []);
  assert.deepEqual(moved(db, 'lapsed'), []);
  assert.deepEqual(byId(db, 'w-gone'), before.find((g) => g.id === 'w-gone'));
  assert.deepEqual(byId(db, 'w-lapsed'), before.find((g) => g.id === 'w-lapsed'));

  // Every other grant and column is untouched.
  for (const id of ['a', 'e-perm', 's-soon', 'y-held', 'y-longer']) assert.deepEqual(byId(db, id), before.find((g) => g.id === id), id);
  assert.equal(flag(db, 'admin', 'is_admin'), 1);
  assert.equal(flag(db, 'soon', 'is_sender'), 1);
  assert.equal(all(db).length, before.length + 3);

  // What the panel and /account read: the moved person now edits Yazılar, and no live writer is left.
  const roles = (await activeGrants(d1(db) as never, 'perm', now())).map((g) => g.role);
  assert.ok(rightsFromRoles(roles, false).yazilar.edit);
  assert.ok(!roles.includes('writer'));
  const check = db.prepare(CHECK).all() as { role: string; live: number }[];
  assert.deepEqual(check.map((r) => [r.role, r.live]), [['content.yazilar.edit', 6]]);
});

test('8k run twice changes nothing the second time', () => {
  const db = setup();
  db.exec(MOVE);
  const once = all(db);
  db.exec(MOVE);
  assert.deepEqual(all(db), once);
});

test('a run cut off after the insert is finished by running it again; the ending alone ends nothing', () => {
  const [insert, extend, end, sync] = MOVE.split(/; (?=INSERT |UPDATE )/);
  assert.ok(insert.startsWith('INSERT') && extend.includes('extended') && end.startsWith('UPDATE role_grants SET revoked_at') && sync.startsWith('UPDATE users'));

  // The end and the cache rewrite without the insert: nobody loses writer without getting Yazılar.
  const lost = setup();
  lost.exec(`${end}; ${sync}`);
  assert.equal(byId(lost, 'w-perm').revoked_at, null);
  assert.equal(flag(lost, 'perm', 'is_writer'), 1);

  // Only the insert landed: running the whole command again ends the writer grant, once.
  const half = setup();
  half.exec(insert);
  half.exec(MOVE);
  assert.equal(moved(half, 'perm').length, 1);
  assert.notEqual(byId(half, 'w-perm').revoked_at, null);
  assert.equal(flag(half, 'perm', 'is_writer'), 0);
});
