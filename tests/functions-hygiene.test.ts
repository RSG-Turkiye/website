import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { idsOf } from '../functions/_lib/compose';

/**
 * Four small things in functions/, each checked against a real database where
 * the behaviour is a query rather than a function.
 */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return db;
}

// --- one attachmentSizes, and the flattening its second caller needs ----------

test('idsOf collects every distinct id across rows', () => {
  assert.deepEqual(
    idsOf([{ attachment_ids: '["a","b"]' }, { attachment_ids: '["b","c"]' }]).sort(),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(idsOf([]), []);
  assert.deepEqual(idsOf([{ attachment_ids: '[]' }]), []);
});

test('a row whose attachment_ids is corrupt costs the tick nothing', () => {
  // The dispatch loop drops such a row anyway. Throwing here would have
  // stopped the whole tick -- every other row included -- because one row's
  // JSON was bad.
  assert.deepEqual(idsOf([{ attachment_ids: 'not json' }, { attachment_ids: '["a"]' }]), ['a']);
  assert.deepEqual(idsOf([{ attachment_ids: '{"a":1}' }]), [], 'an object is not a list of ids');
});

// --- sessions were only ever inserted ------------------------------------------

test('signing in clears sessions that have expired, and only those', () => {
  // Nothing read an expired session -- every lookup filters on expires_at --
  // so this was never a hole. It was a table that only grew.
  const db = database();
  db.exec(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@x.org',1,1)`);
  const now = 1_800_000_000;
  const add = (id: string, expires: number) =>
    db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)')
      .run(id, 'u1', expires, 1);

  add('dead-1', now - 86_400);
  add('dead-2', now - 1);
  add('alive-1', now + 1);
  add('alive-2', now + 86_400);

  const result = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  assert.equal(result.changes, 2, 'both expired rows');

  const left = (db.prepare('SELECT id FROM sessions ORDER BY id').all() as { id: string }[]).map((r) => r.id);
  assert.deepEqual(left, ['alive-1', 'alive-2']);
  db.close();
});

test('a session expiring exactly now is kept, matching the lookup', () => {
  // getSessionUser reads `expires_at > ?`, so a row at exactly `now` is
  // already unusable -- but deleting on `<` rather than `<=` keeps the sweep
  // from being the thing that decides, and the two stay one off in the safe
  // direction rather than disagreeing.
  const db = database();
  db.exec(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@x.org',1,1)`);
  const now = 1_800_000_000;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)').run('edge', 'u1', now, 1);
  assert.equal(db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes, 0);
  db.close();
});

// --- the refresh throttle was a read, then a write ------------------------------

test('two refreshes in the same minute: exactly one claims it', () => {
  // SELECT-compare-UPDATE let both requests read the same old value, both
  // decide they were allowed, and both call Gmail. The throttle exists to
  // protect one shared quota, so two people clicking at once is the case it
  // has to survive, not an edge.
  const db = database();
  const MIN = 60;
  const now = 1_800_000_000;
  db.prepare('UPDATE mail_sync_state SET last_synced_at = ? WHERE id = 1').run(now - 300);

  const claim = (at: number) =>
    db.prepare(
      `UPDATE mail_sync_state SET last_synced_at = ?
       WHERE id = 1 AND (last_synced_at IS NULL OR last_synced_at <= ?)`,
    ).run(at, at - MIN).changes;

  assert.equal(claim(now), 1, 'the first request claims the minute');
  assert.equal(claim(now), 0, 'the second is turned away');
  assert.equal(claim(now + 59), 0, 'and so is one 59 seconds later');
  assert.equal(claim(now + 60), 1, 'the minute is up');
  db.close();
});

test('the first refresh of all, with the column never stamped, is allowed', () => {
  const db = database();
  db.prepare('UPDATE mail_sync_state SET last_synced_at = NULL WHERE id = 1').run();
  const changes = db.prepare(
    `UPDATE mail_sync_state SET last_synced_at = ?
     WHERE id = 1 AND (last_synced_at IS NULL OR last_synced_at <= ?)`,
  ).run(1_800_000_000, 1_800_000_000 - 60).changes;
  assert.equal(changes, 1);
  db.close();
});

// --- an attachment id that names no attachment ------------------------------------

test('scheduling checks its attachment ids against the table', () => {
  // They were kept for their type and nothing else, so a stale or mistyped id
  // was stored, the edit reported success, and the mail failed hours later
  // inside the dispatcher -- at the moment it was due to go out.
  const db = database();
  db.exec(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@x.org',1,1)`);
  const add = (id: string, active: number) =>
    db.prepare(
      `INSERT INTO mail_attachments (id, filename, r2_key, content_type, size_bytes, uploaded_by, uploaded_at, is_active)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, `${id}.pdf`, `k/${id}`, 'application/pdf', 10, 'u1', 1, active);
  add('live', 1);
  add('retired', 0);

  const known = (ids: string[]) =>
    (db.prepare(
      `SELECT id FROM mail_attachments WHERE is_active = 1 AND id IN (${ids.map(() => '?').join(',')})`,
    ).all(...ids) as { id: string }[]).map((r) => r.id);

  assert.deepEqual(known(['live']), ['live']);
  assert.deepEqual(known(['missing']), [], 'an id that names nothing');
  assert.deepEqual(known(['retired']), [], 'a deactivated attachment is not offerable either');
  assert.deepEqual(known(['live', 'missing']).length !== 2, true, 'the count is what the check compares');
  db.close();
});
