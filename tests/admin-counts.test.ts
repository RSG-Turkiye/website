import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { onRequestGet } from '../functions/api/admin/counts';

function seed(db: import('node:sqlite').DatabaseSync) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO mail_threads (id, sender_user_id, recipient_email, subject, last_message_at, last_direction, unread, created_at, updated_at) VALUES ('t1','admin','x@example.org','s',1,'in',1,1,1), ('t2','admin','y@example.org','s',1,'out',0,1,1), ('t3','ed','z@example.org','s',1,'in',1,1,1)`).run();
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES
    ('p1','image','a','[]','["instagram"]',?,'pending_approval',1,'ed',1,1),
    ('p2','image','b','[]','["instagram"]',?,'scheduled',1,'ed',1,1),
    ('p3','image','c','[]','["instagram"]',?,'scheduled',1,'ed',1,1)`).run(now + 3600, now + 2 * 86400, now + 30 * 86400);
  db.prepare(`INSERT INTO blog_submissions (id, submitted_by, lang, title, description, category, author, body, slug, status, created_at) VALUES ('b1','mem','en','t','d','c','a','x','s','pending',1), ('b2','mem','en','t','d','c','a','x','s2','approved',1)`).run();
}

test('an admin gets every count', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const res = await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'admin' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { email: 1, social: 1, dm: 0, blog: 1, scheduledThisWeek: 1 });
});

function addSender(db: import('node:sqlite').DatabaseSync) {
  db.prepare(`INSERT INTO users (id, google_id, email, is_sender, created_at, last_login) VALUES ('snd','g-snd','snd@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-snd','snd',4000000000,1)`).run();
  db.prepare(`INSERT INTO mail_threads (id, sender_user_id, recipient_email, subject, last_message_at, last_direction, unread, created_at, updated_at) VALUES ('t4','snd','a@example.org','s',1,'in',1,1,1), ('t5','snd','b@example.org','s',1,'in',1,1,1), ('t6','snd','c@example.org','s',1,'out',0,1,1)`).run();
}

test('a sender who is not an admin gets only their own unread threads', async () => {
  const { env, db } = setupSocial();
  seed(db);
  addSender(db);
  const res = await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'snd' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { email: 2 });
});

test('an admin gets their own unread threads, not everyone\'s', async () => {
  const { env, db } = setupSocial();
  seed(db);
  addSender(db);
  const body = await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'admin' })).json() as Record<string, number>;
  assert.equal(body.email, 1);
});

test('a social publisher gets only the social counts; an editor only what is scheduled', async () => {
  const { env, db } = setupSocial();
  seed(db);
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'pub' })).json(), { social: 1, dm: 0, scheduledThisWeek: 1 });
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'ed' })).json(), { scheduledThisWeek: 1 });
});

test('a count whose query fails is left out; the others are still returned', async (t) => {
  const { env, db } = setupSocial();
  seed(db);
  db.exec('DROP TABLE mail_threads');
  const logged: unknown[] = [];
  t.mock.method(console, 'error', (...a: unknown[]) => { logged.push(a); });
  const res = await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'admin' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { social: 1, dm: 0, blog: 1, scheduledThisWeek: 1 });
  assert.equal(logged.length, 1);
});

test('a member without a panel role is refused; signed out is 401', async () => {
  const { env } = setupSocial();
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'mem' })).status, 403);
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env })).status, 401);
});
