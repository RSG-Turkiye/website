import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { call } from './lib/social';
import { groupRights, rightsFromRoles, canOpenAdminPanel } from '../functions/_lib/cms-access';
import { canSeeAdminPanel, type User } from '../functions/_lib/auth';
import * as view from '../functions/api/audit/view';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = { Origin: 'https://rsg-turkiye.iscbsc.org' };
const NOW = 2_000_000_000;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1)');
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, NULL, 1)');
  const session = db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, isAdmin] of [['admin', 1], ['editor', 0], ['approver', 0], ['lapsed', 0], ['nobody', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, isAdmin);
    session.run(`s-${id}`, id);
  }
  grant.run('g1', 'editor', 'content.etkinlikler.edit', NOW + 86400);
  grant.run('g2', 'approver', 'content.etkinlikler.approve', null);
  grant.run('g3', 'lapsed', 'content.etkinlikler.edit', NOW - 1);
  const env = { DB: d1(db) } as never as { DB: D1Database };
  const user = (id: string) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as User;
  return { db, env, user };
}

test('groupRights: admin, editor, approver, and an editor whose grant has run out', async () => {
  const { env, user } = setup();
  assert.deepEqual(await groupRights(env.DB, user('admin'), NOW), { etkinlikler: { edit: true, approve: true } });
  assert.deepEqual(await groupRights(env.DB, user('editor'), NOW), { etkinlikler: { edit: true, approve: false } });
  // An approver can do everything an editor can.
  assert.deepEqual(await groupRights(env.DB, user('approver'), NOW), { etkinlikler: { edit: true, approve: true } });
  assert.deepEqual(await groupRights(env.DB, user('lapsed'), NOW), { etkinlikler: { edit: false, approve: false } });
  assert.deepEqual(await groupRights(env.DB, user('nobody'), NOW), { etkinlikler: { edit: false, approve: false } });
});

test('rightsFromRoles ignores roles of other groups and look-alikes', () => {
  assert.deepEqual(rightsFromRoles(['content.blog.edit', 'writer', 'content.etkinlikler.editor'], false), { etkinlikler: { edit: false, approve: false } });
});

test('a content-only editor passes canSeeAdminPanel', async () => {
  const { env, user } = setup();
  const none = user('nobody');
  assert.equal(canSeeAdminPanel(none), false);
  assert.equal(canSeeAdminPanel(none, true), true);
  assert.equal(await canOpenAdminPanel(env.DB, user('editor'), NOW), true);
  assert.equal(await canOpenAdminPanel(env.DB, user('approver'), NOW), true);
  assert.equal(await canOpenAdminPanel(env.DB, user('lapsed'), NOW), false);
  assert.equal(await canOpenAdminPanel(env.DB, none, NOW), false);
});

test('a panel endpoint lets a content-only editor in, and still keeps out someone without a role', async () => {
  const { db } = setup();
  const env = { DB: d1(db) };
  const post = (as: string) => call(view.onRequestPost, 'POST', '/api/audit/view', { env, as, headers: ORIGIN, body: { pane: 'genel' } });
  assert.equal((await post('editor')).status, 204);
  assert.equal((await post('nobody')).status, 403);
});
