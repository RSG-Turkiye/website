import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as endpoint from '../functions/api/me';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

test('/api/me lists the live grants with their end dates and leaves out expired ones', async () => {
  const now = Math.floor(Date.now() / 1000);
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare('INSERT INTO users (id, google_id, email, is_member, is_writer, created_at, last_login) VALUES (?,?,?,?,?,?,?)')
    .run('u1', 'g1', 'a@example.org', 1, 1, now, now);
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?,?,?,?)').run('s1', 'u1', now + 3600, now);
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_at) VALUES (?,?,?,?,?)');
  grant.run('g-writer', 'u1', 'writer', now + 86400, now - 100);
  grant.run('g-sender', 'u1', 'sender', now - 10, now - 1000);

  const res = await (endpoint.onRequestGet as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/me', { headers: { Cookie: 'rsg_session=s1' } }),
    env: { DB: d1(db) },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { user: { is_writer: boolean; grants: unknown[] } };
  assert.deepEqual(body.user.grants, [{ role: 'writer', expires_at: now + 86400 }]);
  assert.equal(body.user.is_writer, true, 'existing flags are unchanged');
});
