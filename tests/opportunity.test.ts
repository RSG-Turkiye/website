import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  validateIngestItem, isStudentLevel, expiryFor, upsertStatements, PUBLIC_LIST_SQL,
  signRemoval, verifyRemoval,
} from '../functions/_lib/opportunity';

function db() {
  const d = new DatabaseSync(':memory:');
  const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const create = /CREATE TABLE IF NOT EXISTS opportunities \([\s\S]*?\n\);/.exec(sql)![0];
  d.exec(create);
  for (const idx of sql.match(/CREATE (UNIQUE )?INDEX IF NOT EXISTS idx_opportunities[^;]*;/g) ?? []) d.exec(idx);
  return d;
}
const base = { url: 'https://example.org/a', title: 'PhD in genomics', source: 'tess', type: 'phd_position', levels: ['phd'] };
const run = (d: DatabaseSync, s: { sql: string; values: unknown[] }) => d.prepare(s.sql).run(...(s.values as never[]));

test('a valid item passes and unknown levels or types are rejected', () => {
  assert.equal(validateIngestItem(base).ok, true);
  assert.equal(validateIngestItem({ ...base, levels: ['wizard'] }).ok, false);
  assert.equal(validateIngestItem({ ...base, type: 'party' }).ok, false);
  assert.equal(validateIngestItem({ ...base, url: 'javascript:alert(1)' }).ok, false);
  assert.equal(validateIngestItem({ ...base, title: '' }).ok, false);
});

test('only undergrad, msc or phd count as student level', () => {
  assert.equal(isStudentLevel(['postdoc']), false);
  assert.equal(isStudentLevel(['professional', 'msc']), true);
  assert.equal(isStudentLevel([]), false);
});

test('expiry is the deadline, else first seen plus 45 days', () => {
  assert.equal(expiryFor(2_000_000_000, 1_000), 2_000_000_000);
  assert.equal(expiryFor(null, 1_000), 1_000 + 45 * 86400);
});

test('a student item is published, a postdoc-only item is stored but not listed', () => {
  const d = db();
  run(d, upsertStatements(base, 100, 'id1'));
  run(d, upsertStatements({ ...base, url: 'https://example.org/b', levels: ['postdoc'] }, 100, 'id2'));
  const rows = d.prepare(PUBLIC_LIST_SQL).all(100, 0, 50) as { id: string }[];
  assert.deepEqual(rows.map((r) => r.id), ['id1']);
  assert.equal((d.prepare('SELECT COUNT(*) n FROM opportunities').get() as { n: number }).n, 2);
});

test('ingest never resurrects a removed row', () => {
  const d = db();
  run(d, upsertStatements(base, 100, 'id1'));
  d.prepare('UPDATE opportunities SET removed_at = 150, removed_by = ? WHERE id = ?').run('digest', 'id1');
  run(d, upsertStatements({ ...base, title: 'changed' }, 200, 'id-new'));
  const row = d.prepare('SELECT id, title, removed_at FROM opportunities').get() as { id: string; title: string; removed_at: number };
  assert.equal(row.id, 'id1');
  assert.equal(row.removed_at, 150);
  assert.equal((d.prepare(PUBLIC_LIST_SQL).all(300, 0, 50) as unknown[]).length, 0);
});

test('re-ingesting the same URL updates in place and keeps first_seen', () => {
  const d = db();
  run(d, upsertStatements(base, 100, 'id1'));
  run(d, upsertStatements({ ...base, title: 'PhD in genomics (extended)' }, 500, 'id2'));
  const row = d.prepare('SELECT id, title, first_seen FROM opportunities').get() as { id: string; title: string; first_seen: number };
  assert.deepEqual([row.id, row.title, row.first_seen], ['id1', 'PhD in genomics (extended)', 100]);
});

test('expired and slack-only items are not public', () => {
  const d = db();
  run(d, upsertStatements({ ...base, deadline: 150 }, 100, 'id1'));
  run(d, upsertStatements({ ...base, url: 'https://example.org/s', visibility: 'slack' }, 100, 'id2'));
  assert.equal((d.prepare(PUBLIC_LIST_SQL).all(200, 0, 50) as unknown[]).length, 0);
});

test('removal tokens verify only for their own id', async () => {
  const t = await signRemoval('id1', 'secret');
  assert.equal(await verifyRemoval('id1', t, 'secret'), true);
  assert.equal(await verifyRemoval('id2', t, 'secret'), false);
  assert.equal(await verifyRemoval('id1', t, 'other'), false);
});

test('a re-ingest that drops the student level unpublishes, and a later one republishes', () => {
  const d = db();
  run(d, upsertStatements(base, 100, 'id1'));
  run(d, upsertStatements({ ...base, levels: ['postdoc'] }, 200, 'id2'));
  assert.equal((d.prepare(PUBLIC_LIST_SQL).all(300, 0, 50) as unknown[]).length, 0);
  run(d, upsertStatements({ ...base, levels: ['msc'] }, 400, 'id3'));
  assert.equal((d.prepare(PUBLIC_LIST_SQL).all(450, 0, 50) as unknown[]).length, 1);
});
