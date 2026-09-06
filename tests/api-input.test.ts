import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { intParam, PAGE_LIMIT, PAGE_OFFSET } from '../functions/_lib/params';
import { isRank, RANK_ORDINALS } from '../functions/_lib/rank';

/**
 * Three ways a request reached the database without being read first.
 */

// --- ?limit=abc ---------------------------------------------------------------

test('a limit that is not a number is the default, not NaN', () => {
  // Math.min(parseInt('abc'), 48) is NaN, and NaN went into `LIMIT ?`. D1
  // refuses it, so /api/members answered 500 to a request that was merely
  // wrong -- and an admin reading the logs sees a server error.
  assert.equal(intParam('abc', PAGE_LIMIT), 24);
  assert.equal(intParam('', PAGE_LIMIT), 24);
  assert.equal(intParam(null, PAGE_LIMIT), 24);
  assert.equal(intParam('12.5', PAGE_LIMIT), 24);
  assert.equal(intParam('0x10', PAGE_LIMIT), 24);
});

test('scientific notation is refused rather than silently truncated', () => {
  // parseInt('1e9') is 1. A caller asking for a big page got one row and no
  // indication why -- the quietest of the three failures.
  assert.equal(intParam('1e9', PAGE_LIMIT), 24);
});

test('a real number is clamped into range at both ends', () => {
  assert.equal(intParam('10', PAGE_LIMIT), 10);
  assert.equal(intParam('48', PAGE_LIMIT), 48);
  assert.equal(intParam('1000', PAGE_LIMIT), 48);
  assert.equal(intParam('0', PAGE_LIMIT), 1, 'zero rows is not a page');
  assert.equal(intParam('-5', PAGE_LIMIT), 1);
  assert.equal(intParam('-5', PAGE_OFFSET), 0);
  assert.equal(intParam('99999999999999999999', PAGE_OFFSET), 0, 'past Number.MAX_SAFE_INTEGER');
});

// --- `rank in RANK_ORDINALS` ---------------------------------------------------

test('a property of Object.prototype is not a rank', () => {
  // `in` walks the prototype chain. "toString" passed the check, and
  // RANK_ORDINALS["toString"] -- a function -- was bound as the rank ordinal.
  for (const notARank of ['toString', 'constructor', 'hasOwnProperty', '__proto__', 'valueOf']) {
    assert.equal(notARank in RANK_ORDINALS, true, 'the old check passed all of these');
    assert.equal(isRank(notARank), false, notARank);
  }
});

test('the four real ranks still are ranks', () => {
  for (const rank of ['seed', 'sprout', 'sapling', 'legacy_tree']) {
    assert.equal(isRank(rank), true, rank);
  }
});

test('a non-string is not a rank either', () => {
  for (const bad of [null, undefined, 42, {}, [], true]) {
    assert.equal(isRank(bad), false, String(bad));
  }
});

// --- the demotion that did not happen -------------------------------------------

/**
 * getCurrentRank's ORDER BY, run against a real database.
 *
 * It used to be `rank_ordinal DESC, computed_at DESC` -- the highest rank
 * ever held. An admin setting a lower one wrote a row that was then never
 * read: the demotion looked like it worked and changed nothing anybody saw.
 */
function historyDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  const schema = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
  db.exec(schema);
  db.exec(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1', 'g1', 'a@x.org', 1, 1)`);
  return db;
}

const NEWEST = 'SELECT rank FROM rank_history WHERE user_id = ? ORDER BY computed_at DESC, rowid DESC LIMIT 1';
const HIGHEST = 'SELECT rank FROM rank_history WHERE user_id = ? ORDER BY rank_ordinal DESC, computed_at DESC LIMIT 1';

test('an admin demotion is what the member now holds', () => {
  const db = historyDb();
  const add = (id: string, rank: string, ordinal: number, at: number, reason: string) =>
    db
      .prepare('INSERT INTO rank_history (id, user_id, rank, rank_ordinal, reason, computed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'u1', rank, ordinal, reason, at);

  add('r1', 'seed', 1, 100, 'auto_learning_path_progress');
  add('r2', 'sapling', 3, 200, 'auto_learning_path_progress');
  add('r3', 'sprout', 2, 300, 'admin_manual');

  assert.equal((db.prepare(NEWEST).get('u1') as { rank: string }).rank, 'sprout', 'the demotion holds');
  assert.equal((db.prepare(HIGHEST).get('u1') as { rank: string }).rank, 'sapling', 'the old query ignored it');
  db.close();
});

test('two ranks written in the same second resolve to the later row', () => {
  // computed_at is whole seconds, so a second key is needed or the answer
  // depends on how SQLite feels about ties.
  const db = historyDb();
  const add = (id: string, rank: string, ordinal: number) =>
    db
      .prepare('INSERT INTO rank_history (id, user_id, rank, rank_ordinal, reason, computed_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'u1', rank, ordinal, 'admin_manual', 500);
  add('r1', 'legacy_tree', 4);
  add('r2', 'seed', 1);
  assert.equal((db.prepare(NEWEST).get('u1') as { rank: string }).rank, 'seed');
  db.close();
});

// --- a badge code that is not a badge --------------------------------------------

test('an unknown badge code is a foreign key error, which is why it must be checked first', () => {
  const db = historyDb();
  db.exec('PRAGMA foreign_keys = ON');
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO user_achievement_badges (user_id, badge_code, awarded_at, awarded_by) VALUES (?, ?, ?, ?)')
        .run('u1', 'no_such_badge', 1, 'u1'),
    /FOREIGN KEY/i,
    'this is the 500 the admin panel used to return',
  );

  const known = db.prepare('SELECT 1 FROM achievement_badges WHERE code = ?').get('no_such_badge');
  assert.equal(known, undefined, 'and this is the check that turns it into a 400');
  assert.ok(db.prepare('SELECT 1 FROM achievement_badges WHERE code = ?').get('read_qc'), 'a real one passes');
  db.close();
});
