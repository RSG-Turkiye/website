import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { canSocialEdit, canSocialPublish, canSeeAdminPanel } from '../functions/_lib/auth';
import { onRequestPatch } from '../functions/api/admin/users';
import { verifyChain, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const none = { is_admin: 0, is_announcer: 0, is_symposium: 0, is_social: 0, is_social_publisher: 0 };

test('who may edit and who may publish', () => {
  assert.equal(canSocialEdit(none), false);
  assert.equal(canSocialEdit({ ...none, is_social: 1 }), true);
  assert.equal(canSocialEdit({ ...none, is_social_publisher: 1 }), true, 'a publisher can always edit');
  assert.equal(canSocialEdit({ ...none, is_admin: 1 }), true);
  assert.equal(canSocialPublish({ ...none, is_social: 1 }), false);
  assert.equal(canSocialPublish({ ...none, is_social_publisher: 1 }), true);
  assert.equal(canSocialPublish({ ...none, is_admin: 1 }), true);
});

test('a column missing before the migration reads as no role', () => {
  const legacy = { is_admin: 0, is_announcer: 0, is_symposium: 0 } as never;
  assert.equal(canSocialEdit(legacy), false);
  assert.equal(canSeeAdminPanel(legacy), false);
});

test('the admin panel opens for any panel role', () => {
  assert.equal(canSeeAdminPanel(none), false);
  for (const k of ['is_admin', 'is_announcer', 'is_symposium', 'is_social', 'is_social_publisher'] as const) {
    assert.equal(canSeeAdminPanel({ ...none, [k]: 1 }), true, k);
  }
});

function setup(isAdmin = 1) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',?,1,1)`).run(isAdmin);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u2','g2','new@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) } as never };
}
const patch = (env: unknown, body: unknown) =>
  (onRequestPatch as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/users', {
      method: 'PATCH', headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    env,
  });
const flags = (db: DatabaseSync) => db.prepare(`SELECT is_social, is_social_publisher FROM users WHERE id = 'u2'`).get();

test('making someone a publisher makes them an editor too, and is logged', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_social_publisher' })).status, 200);
  assert.deepEqual({ ...flags(db) }, { is_social: 1, is_social_publisher: 1 });
  const log = db.prepare('SELECT * FROM audit_log').all() as unknown as AuditRow[];
  assert.equal(log.length, 1);
  assert.equal(log[0].user_id, 'u1');
  assert.equal(log[0].action, 'role.change');
  assert.equal(log[0].target_id, 'u2');
  assert.deepEqual(JSON.parse(log[0].details), { role: 'is_social_publisher', value: 1, email: 'new@example.org' });
  assert.equal((await verifyChain(log)).ok, true);
});

test('removing the editor role removes publisher; removing publisher keeps editor', async () => {
  const { db, env } = setup();
  await patch(env, { user_id: 'u2', action: 'make_social_publisher' });
  await patch(env, { user_id: 'u2', action: 'remove_social_publisher' });
  assert.deepEqual({ ...flags(db) }, { is_social: 1, is_social_publisher: 0 });
  await patch(env, { user_id: 'u2', action: 'make_social_publisher' });
  await patch(env, { user_id: 'u2', action: 'remove_social' });
  assert.deepEqual({ ...flags(db) }, { is_social: 0, is_social_publisher: 0 });
});

test('existing role actions are logged too', async () => {
  const { db, env } = setup();
  await patch(env, { user_id: 'u2', action: 'make_symposium' });
  const row = db.prepare('SELECT details FROM audit_log').get() as { details: string };
  assert.deepEqual(JSON.parse(row.details), { role: 'is_symposium', value: 1, email: 'new@example.org' });
});

test('the other member actions are logged as well', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO profiles (user_id, username, display_name, updated_at) VALUES ('u2','new','New',1)`).run();
  assert.equal((await patch(env, { user_id: 'u2', action: 'clear_bio' })).status, 200);
  const row = db.prepare('SELECT action, target_id FROM audit_log').get() as { action: string; target_id: string };
  assert.deepEqual({ ...row }, { action: 'user.clear_bio', target_id: 'u2' });
});

test('an unknown user is a 404 and nothing is logged', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'nobody', action: 'make_social' })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('a non-admin cannot grant roles', async () => {
  const { db, env } = setup(0);
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_social' })).status, 403);
  assert.deepEqual({ ...flags(db) }, { is_social: 0, is_social_publisher: 0 });
});
