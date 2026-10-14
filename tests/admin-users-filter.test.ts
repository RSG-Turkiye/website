import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { onRequestGet } from '../functions/api/admin/users';

const ids = async (res: Response) => ((await res.json()) as { users: { id: string }[] }).users.map((u) => u.id).sort();

test('filter=roles lists only people who hold a role', async () => {
  const { env, db } = setupSocial();
  db.prepare(`INSERT INTO users (id, google_id, email, is_symposium, created_at, last_login) VALUES ('sym', 'g-sym', 'sym@example.org', 1, 1, 1)`).run();
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('none', 'g-none', 'none@example.org', 1, 1)`).run();
  const res = await call(onRequestGet, 'GET', '/api/admin/users?filter=roles', { env, as: 'admin' });
  assert.equal(res.status, 200);
  assert.deepEqual(await ids(res), ['admin', 'ed', 'ed2', 'pub', 'sym']);
});

test('filter=roles combines with search', async () => {
  const { env } = setupSocial();
  const res = await call(onRequestGet, 'GET', '/api/admin/users?filter=roles&search=ed2', { env, as: 'admin' });
  assert.deepEqual(await ids(res), ['ed2']);
});

test('filter=all still lists people without a role', async () => {
  const { env } = setupSocial();
  const res = await call(onRequestGet, 'GET', '/api/admin/users?filter=all', { env, as: 'admin' });
  assert.ok((await ids(res)).includes('mem'));
});
