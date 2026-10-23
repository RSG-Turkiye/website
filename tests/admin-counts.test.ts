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
  assert.deepEqual(await res.json(), { email: 1, social: 1, dm: 0, socialTotal: 1, blog: 1, scheduledThisWeek: 1, cmsMine: 0, cmsQueue: 0, cmsTotal: 0 });
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
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'pub' })).json(), { social: 1, dm: 0, socialTotal: 1, scheduledThisWeek: 1 });
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
  assert.deepEqual(await res.json(), { social: 1, dm: 0, socialTotal: 1, blog: 1, scheduledThisWeek: 1, cmsMine: 0, cmsQueue: 0, cmsTotal: 0 });
  assert.equal(logged.length, 1);
});

test('a member without a panel role is refused; signed out is 401', async () => {
  const { env } = setupSocial();
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'mem' })).status, 403);
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env })).status, 401);
});

test('socialTotal is approvals plus unread DMs; an editor gets neither', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, last_inbound_at, updated_at) VALUES ('t1','instagram','c1','p1',?,?)`).run(now - 600, now);
  const pub = await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'pub' })).json() as Record<string, number>;
  assert.deepEqual([pub.social, pub.dm, pub.socialTotal], [1, 1, 2]);
  const ed = await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'ed' })).json() as Record<string, number>;
  assert.equal(ed.socialTotal, undefined);
  assert.equal(ed.social, undefined);
});

function seedCms(db: import('node:sqlite').DatabaseSync) {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, role] of [['ced', 'content.etkinlikler.edit'], ['cap', 'content.etkinlikler.approve']]) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
    db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)`).run(`g-${id}`, id, role);
  }
  const add = db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, created_at, updated_at)
    VALUES (?, 'events', ?, 'update', '{}', '{}', ?, ?, 1, ?)`);
  add.run('d1', 'a', 'rejected', 'ced', now);
  add.run('d2', 'b', 'pr_failed', 'ced', now);
  add.run('d3', 'c', 'draft', 'ced', now);
  add.run('d4', 'd', 'submitted', 'ced', now);
  add.run('d5', 'e', 'submitted', 'cap', now);
  add.run('d6', 'f', 'approved', 'cap', now - 3600); // an approval that never finished
  add.run('d7', 'g', 'approved', 'cap', now); // one under way
  add.run('d8', 'h', 'rejected', 'cap', now);
}

test('content counts: an editor\'s drafts that need action; an approver\'s queue too', async () => {
  const { env, db } = setupSocial();
  seedCms(db);
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'ced' })).json(), { cmsMine: 2, cmsTotal: 2 });
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'cap' })).json(), { cmsMine: 1, cmsQueue: 3, cmsTotal: 4 });
  const admin = await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'admin' })).json() as Record<string, number>;
  assert.deepEqual([admin.cmsMine, admin.cmsQueue, admin.cmsTotal], [0, 3, 3]);
  const pub = await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'pub' })).json() as Record<string, number>;
  assert.equal(pub.cmsMine, undefined, 'no content role, no content count');
});
