import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as list from '../functions/api/admin/audit/index';
import * as exp from '../functions/api/admin/audit/export';
import * as verify from '../functions/api/admin/audit/verify';
import * as view from '../functions/api/audit/view';
import { appendAudit } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';

function setup(roles: Record<string, number> = { is_admin: 1 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','admin@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u2','g2','editor@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) as never } };
}
const call = (h: unknown, method: string, path: string, env: unknown, body?: unknown) =>
  (h as (c: unknown) => Promise<Response>)({
    request: new Request(`${BASE}${path}`, { method, headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  });

test('the list filters by person and action, newest first, with paging', async () => {
  const { env } = setup();
  for (let i = 0; i < 3; i++) await appendAudit(env.DB, { userId: 'u2', action: 'role.change' }, 100 + i);
  await appendAudit(env.DB, { userId: 'u1', action: 'connection.start' }, 200);
  const res = await call(list.onRequestGet, 'GET', '/api/admin/audit?user=editor&action=role', env);
  const body = await res.json() as { rows: { seq: number; user_email: string }[]; hasMore: boolean };
  assert.deepEqual(body.rows.map((r) => r.seq), [3, 2, 1]);
  assert.equal(body.rows[0].user_email, 'editor@example.org');
  assert.equal(body.hasMore, false);
  const older = await (await call(list.onRequestGet, 'GET', '/api/admin/audit?before=2', env)).json() as { rows: { seq: number }[] };
  assert.deepEqual(older.rows.map((r) => r.seq), [1]);
});

test('date filters are inclusive unix bounds', async () => {
  const { env } = setup();
  await appendAudit(env.DB, { userId: 'u1', action: 'a' }, 100);
  await appendAudit(env.DB, { userId: 'u1', action: 'b' }, 200);
  const body = await (await call(list.onRequestGet, 'GET', '/api/admin/audit?from=150&to=250', env)).json() as { rows: { action: string }[] };
  assert.deepEqual(body.rows.filter((r) => r.action !== 'read.audit').map((r) => r.action), ['b']);
});

test('export is logged before it is served, and CSV is a download', async () => {
  const { env, db } = setup();
  await appendAudit(env.DB, { userId: 'u2', action: 'role.change' }, 100);
  const res = await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=csv', env);
  assert.equal(res.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('Content-Disposition')!, /attachment; filename="rsg-audit-\d{8}\.csv"/);
  const csv = await res.text();
  assert.match(csv, /audit\.export/, 'the export row is inside the export');
  const json = await (await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=json', env)).json() as unknown[];
  assert.ok(Array.isArray(json));
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'audit.export'`).get() as { n: number }).n, 2);
});

test('verify reports an intact chain, and a broken one after tampering', async () => {
  const { env, db } = setup();
  for (let i = 0; i < 3; i++) await appendAudit(env.DB, { userId: 'u2', action: `a${i}` }, 100 + i);
  const ok = await (await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).json() as { ok: boolean };
  assert.equal(ok.ok, true);
  db.prepare(`UPDATE audit_log SET action = 'forged' WHERE seq = 2`).run();
  const bad = await (await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).json() as { ok: boolean; brokenAt: number };
  assert.deepEqual([bad.ok, bad.brokenAt], [false, 2]);
});

test('audit endpoints are admin-only', async () => {
  const { env } = setup({ is_symposium: 1 });
  assert.equal((await call(list.onRequestGet, 'GET', '/api/admin/audit', env)).status, 403);
  assert.equal((await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=csv', env)).status, 403);
  assert.equal((await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).status, 403);
});

test('a pane view from any panel role is logged; junk pane names are refused', async () => {
  const { env, db } = setup({ is_symposium: 1 });
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, { pane: 'symposium' })).status, 204);
  const row = db.prepare('SELECT action, target_type, target_id, user_id FROM audit_log').get();
  assert.deepEqual({ ...row as object }, { action: 'view.pane', target_type: 'pane', target_id: 'symposium', user_id: 'u1' });
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, { pane: '<script>' })).status, 400);
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, {})).status, 400);
});
