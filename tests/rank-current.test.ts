import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as members from '../functions/api/members';
import * as member from '../functions/api/members/[username]';
import * as adminUsers from '../functions/api/admin/users';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

test('a demoted member shows the rank they hold now, on every page that shows one', async () => {
  // getCurrentRank was fixed to read the latest entry, but the directory, the
  // profile and the admin list each had their own copy of the old query, which
  // took the highest rank ever held: an admin's demotion showed nowhere.
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, is_member, created_at, last_login) VALUES ('u1','g1','admin@example.org',1,1,1,1)`).run();
  db.prepare(`INSERT INTO profiles (user_id, username, display_name, updated_at) VALUES ('u1','ayse','Ayşe',1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const award = db.prepare(`INSERT INTO rank_history (id, user_id, rank, rank_ordinal, reason, computed_at) VALUES (?, 'u1', ?, ?, ?, ?)`);
  award.run('r1', 'sapling', 3, 'auto_learning_path_progress', 100);
  award.run('r2', 'seed', 1, 'admin_manual', 200);

  const env = { DB: d1(db) };
  const get = (handler: unknown, path: string, params: Record<string, string> = {}) =>
    (handler as (c: unknown) => Promise<Response>)({
      request: new Request(`https://rsg-turkiye.iscbsc.org${path}`, { headers: { Cookie: 'rsg_session=s1' } }),
      env,
      params,
    }).then((r) => r.json() as Promise<any>);

  const list = await get(members.onRequestGet, '/api/members');
  assert.equal(list.members.find((m: any) => m.username === 'ayse').rank, 'seed', 'directory');

  const one = await get(member.onRequestGet, '/api/members/ayse', { username: 'ayse' });
  assert.equal(one.member.rank, 'seed', 'profile');

  const admin = await get(adminUsers.onRequestGet, '/api/admin/users');
  const row = (admin.users ?? admin).find((u: any) => u.id === 'u1');
  assert.equal(row.current_rank ?? row.rank, 'seed', 'admin list');
});
