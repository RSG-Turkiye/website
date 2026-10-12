import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as list from '../functions/api/admin/connections/index';
import * as one from '../functions/api/admin/connections/[platform]';
import * as health from '../functions/api/admin/health';
import { connectionUpsert, markBroken } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 2).toString('base64');
const BASE = 'https://rsg-turkiye.iscbsc.org';

function setup(roles: Record<string, number> = { is_admin: 1 }, schema = SCHEMA) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','admin@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GMAIL_REFRESH_TOKEN: 'legacy' } };
}
const call = (h: unknown, method: string, path: string, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(`${BASE}${path}`, { method, headers: { Cookie: 'rsg_session=s1' } }), env, params });

test('the list shows every platform, never a token, and logs the read', async () => {
  const { env, db } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'turkey.rsg@gmail.com', accessToken: null, refreshToken: 'rt', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 100)).run();
  const res = await call(list.onRequestGet, 'GET', '/api/admin/connections', env);
  const text = await res.text();
  assert.ok(!text.includes('v1.'), 'no sealed token in the response');
  const { connections } = JSON.parse(text) as { connections: { platform: string; status: string; connectedBy: string; hasStoredToken: boolean; usesLegacySecret: boolean }[] };
  assert.deepEqual(connections.map((c) => c.platform), ['gmail', 'instagram', 'linkedin', 'x']);
  assert.equal(connections[0].status, 'connected');
  assert.equal(connections[0].connectedBy, 'admin@example.org');
  assert.equal(connections[0].hasStoredToken, true);
  assert.equal(connections[0].usesLegacySecret, false);
  assert.equal(connections[1].status, 'unused');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'read.connections'`).get() as { n: number }).n, 1);
});

test('Gmail on the secret alone shows as connected via the legacy secret', async () => {
  const { env } = setup();
  const { connections } = await (await call(list.onRequestGet, 'GET', '/api/admin/connections', env)).json() as { connections: { status: string; usesLegacySecret: boolean }[] };
  assert.equal(connections[0].status, 'connected');
  assert.equal(connections[0].usesLegacySecret, true);
});

test('only an admin may list or disconnect', async () => {
  const { env } = setup({ is_symposium: 1 });
  assert.equal((await call(list.onRequestGet, 'GET', '/api/admin/connections', env)).status, 403);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/gmail', env, { platform: 'gmail' })).status, 403);
});

test('disconnect removes the row and is logged; an unknown platform is a 400', async () => {
  const { env, db } = setup();
  await markBroken(env.DB, 'gmail', 'x', 1);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/gmail', env, { platform: 'gmail' })).status, 200);
  assert.equal(db.prepare('SELECT * FROM platform_connections').get(), undefined);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.disconnect'`).get() as { n: number }).n, 1);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/myspace', env, { platform: 'myspace' })).status, 400);
});

test('health is open to any panel role and hides error detail from non-admins', async () => {
  const { env, db } = setup({ is_announcer: 1 });
  await markBroken(env.DB, 'gmail', 'invalid_grant secret detail', Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO dispatch_runs (id, started_at) VALUES (?, ?)').run('r1', Math.floor(Date.now() / 1000));
  const body = await (await call(health.onRequestGet, 'GET', '/api/admin/health', env)).json() as { issues: { lastError: string | null }[]; canFix: boolean };
  assert.equal(body.canFix, false);
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].lastError, null);
});

test('health is 403 for a signed-in user with no panel role', async () => {
  const { env } = setup({ is_member: 1 });
  assert.equal((await call(health.onRequestGet, 'GET', '/api/admin/health', env)).status, 403);
});

test('health before the migration answers with no issues instead of failing', async () => {
  const preMigration = SCHEMA.replace(/CREATE TABLE IF NOT EXISTS platform_connections[\s\S]*?\);/, '');
  const { env } = setup({ is_admin: 1 }, preMigration);
  const res = await call(health.onRequestGet, 'GET', '/api/admin/health', env);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json() as { issues: unknown[] }).issues, []);
});
