import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/**
 * db/schema.sql builds the database it claims to build.
 *
 * Migrations here are applied by hand, and the file's own second line says
 * "Apply with: wrangler d1 execute rsg-members --file=db/schema.sql" -- a
 * promise that the file is complete. Three weeks ago it stopped being: the
 * queue's `sent_emails.scheduled_id` was added to production by an ALTER in
 * migration note 7g and never folded into the CREATE TABLE, so any database
 * built from this file lacked the column. Production was fine; every fresh
 * one -- a local dev database, a new preview, a restore -- was not, and the
 * INSERT that needs the column is one whose failure is deliberately swallowed,
 * so mail would have gone out with no log of it.
 *
 * The check is not a list of columns somebody has to remember to extend. It
 * reads the migration notes, finds every ALTER TABLE ... ADD COLUMN they tell
 * an operator to run, and requires the same column to exist in a database
 * built from the file alone. Add a migration note tomorrow and this asks you
 * to fold it in, which is the rule that was broken.
 */

const SCHEMA = new URL('../db/schema.sql', import.meta.url).pathname;
const sql = readFileSync(SCHEMA, 'utf8');

/** A database built from nothing but this file, the way a fresh one is. */
function freshDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(sql);
  return db;
}

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((r) => r.name);

test('the whole file applies without error', () => {
  // It is one statement short of applying that broke /api/announcements in
  // production on 3 September; a file that will not apply at all is worse.
  const db = freshDatabase();
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
  ).map((r) => r.name);
  assert.ok(tables.length >= 20, `expected the schema's tables, found ${tables.length}`);
  db.close();
});

test('every column a migration note adds by hand is also in the file body', () => {
  // The notes are comments, so this reads them as text rather than running
  // them: the point is that an operator should not need to.
  const adds = [...sql.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map(([, table, column]) => ({
    table,
    column,
  }));
  assert.ok(adds.length >= 4, `expected the ALTER notes, found ${adds.length}`);

  const db = freshDatabase();
  for (const { table, column } of adds) {
    assert.ok(
      columnsOf(db, table).includes(column),
      `Migration note tells an operator to add ${table}.${column}, and a database ` +
        `built from this file alone does not have it. Fold it into the CREATE ` +
        `TABLE -- the note stays, for databases that already exist.`,
    );
  }
  db.close();
});

test('an index is never created before the table it indexes', () => {
  // SQLite fails with "no such table" and the file stops there, leaving a
  // half-built database. This has happened once, and reordering fixed it; the
  // ordering is easy to undo by accident when a table is added.
  const statements = sql
    .split(';')
    .map((s) =>
      s
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);

  const created = new Set<string>();
  for (const statement of statements) {
    const table = /CREATE TABLE(?: IF NOT EXISTS)? (\w+)/i.exec(statement);
    if (table) created.add(table[1]);
    const index = /CREATE(?: UNIQUE)? INDEX(?: IF NOT EXISTS)? \w+ ON (\w+)/i.exec(statement);
    if (index) {
      assert.ok(created.has(index[1]), `index on ${index[1]} comes before the table`);
    }
  }
});

test('the tables the mail queue depends on carry the columns it reads', () => {
  // Named explicitly, because these are the ones whose absence is silent:
  // insertLog's failure is swallowed by design, and dispatch_runs is written
  // through wrapped calls that never throw.
  const db = freshDatabase();
  const required: [string, string[]][] = [
    ['sent_emails', ['scheduled_id', 'gmail_thread_id']],
    ['scheduled_emails', ['claimed_at', 'attempts', 'first_tried_at']],
    ['dispatch_runs', ['phase', 'finished_at', 'candidates']],
    ['announcements', ['site']],
  ];
  for (const [table, columns] of required) {
    const actual = columnsOf(db, table);
    for (const column of columns) {
      assert.ok(actual.includes(column), `${table}.${column} is missing from a fresh database`);
    }
  }
  db.close();
});
