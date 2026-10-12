import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, settle, stubMail, KEYS } from './lib/social';
import * as posts from '../functions/api/social/posts/index';
import * as submit from '../functions/api/social/posts/[id]/submit';
import * as approve from '../functions/api/social/posts/[id]/approve';
import * as reject from '../functions/api/social/posts/[id]/reject';
import * as cancel from '../functions/api/social/posts/[id]/cancel';

const NOW = Math.floor(Date.now() / 1000);
const draft = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram', 'linkedin'], scheduledAt: NOW + 3600 };

async function newPost(env: unknown, as = 'ed', body: Record<string, unknown> = draft) {
  return (await (await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, as, body })).json() as { id: string }).id;
}
/** Notifications not awaited by a test are collected here and settled before the stub is removed. */
const pending: Promise<unknown>[] = [];
const act = (handler: unknown, path: string, env: unknown, as: string, id: string, body: Record<string, unknown>, waits: Promise<unknown>[] = pending) =>
  call(handler, 'POST', `/api/social/posts/${id}/${path}`, { env, as, params: { id }, body, waits });
const status = (db: import('node:sqlite').DatabaseSync, id: string) => (db.prepare('SELECT status, revision FROM social_posts WHERE id = ?').get(id) as { status: string; revision: number });
const targets = (db: import('node:sqlite').DatabaseSync) => (db.prepare('SELECT platform FROM social_post_targets ORDER BY platform').all() as { platform: string }[]).map((r) => r.platform);

// Every test runs with Google stubbed, so no notification ever reaches the network.
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(async () => { await settle(pending.splice(0)); mail.restore(); });

/** Creates and submits as `as`; the submit's own notification is settled and forgotten. */
async function submitted(env: unknown, as = 'ed', body: Record<string, unknown> = draft): Promise<string> {
  const id = await newPost(env, as, body);
  const waits: Promise<unknown>[] = [];
  const res = await act(submit.onRequestPost, 'submit', env, as, id, { revision: 0 }, waits);
  assert.equal(res.status, 200);
  await settle(waits);
  mail.sent.length = 0;
  return id;
}

test('an editor submits: pending, publishers are mailed, nothing queued yet', async () => {
  const { env, db, waits } = setupSocial();
  const id = await newPost(env);
  const res = await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 }, waits);
  assert.deepEqual(await res.json(), { ok: true, revision: 1, status: 'pending_approval' });
  await settle(waits);
  assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'pub@example.org']);
  assert.match(mail.sent[0].subject, /Onay bekleyen gönderi/);
  assert.deepEqual(targets(db), []);
});

test('submitting an unready post is a 422 listing what to fix', async () => {
  const { env } = setupSocial();
  const id = await newPost(env, 'ed', { ...draft, media: [{ key: KEYS.feed, alt: '' }] });
  const res = await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 });
  assert.equal(res.status, 422);
  assert.deepEqual((await res.json() as { problems: { code: string }[] }).problems.map((p) => p.code), ['missing_alt']);
});

test('a publisher submits straight to scheduled with targets', async () => {
  const { env, db } = setupSocial();
  const id = await newPost(env, 'pub');
  assert.deepEqual(await (await act(submit.onRequestPost, 'submit', env, 'pub', id, { revision: 0 })).json(), { ok: true, revision: 1, status: 'scheduled' });
  assert.deepEqual(targets(db), ['instagram', 'linkedin']);
  assert.equal((db.prepare('SELECT approved_by FROM social_posts').get() as { approved_by: string }).approved_by, 'pub');
});

test('an editor\'s story skips approval only inside an event window that names them', async () => {
  const { env, db } = setupSocial();
  const story = { type: 'story', media: [{ key: KEYS.story, alt: 'Sahne' }], platforms: ['instagram'], scheduledAt: NOW + 600 };
  const id1 = await newPost(env, 'ed', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id1, { revision: 0 })).json() as { status: string }).status, 'pending_approval');
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 60, NOW + 3600);
  const id2 = await newPost(env, 'ed', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id2, { revision: 0 })).json() as { status: string }).status, 'scheduled');
  assert.equal((db.prepare('SELECT event_mode_id FROM social_posts WHERE id = ?').get(id2) as { event_mode_id: string }).event_mode_id, 'e');
  const id3 = await newPost(env, 'ed2', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed2', id3, { revision: 0 })).json() as { status: string }).status, 'pending_approval', 'ed2 is not named');
  const id4 = await newPost(env, 'ed', draft);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id4, { revision: 0 })).json() as { status: string }).status, 'pending_approval', 'event mode covers stories only');
});

test('approve schedules, builds targets and mails the author', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  const res = await act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 }, waits);
  assert.deepEqual(await res.json(), { ok: true, revision: 2, status: 'scheduled' });
  await settle(waits);
  assert.deepEqual(targets(db), ['instagram', 'linkedin']);
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org']);
  assert.match(mail.sent[0].subject, /onaylandı/);
});

test('an editor cannot approve', async () => {
  const { env } = setupSocial();
  const id = await submitted(env);
  assert.equal((await act(approve.onRequestPost, 'approve', env, 'ed2', id, { revision: 1 })).status, 403);
});

test('approving a request whose time has passed is refused', async () => {
  const { env, db } = setupSocial();
  const id = await submitted(env);
  db.prepare('UPDATE social_posts SET scheduled_at = ? WHERE id = ?').run(NOW - 60, id);
  const res = await act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 });
  assert.equal(res.status, 422);
  assert.ok((await res.json() as { problems: { code: string }[] }).problems.some((p) => p.code === 'schedule_in_past'));
  assert.equal(status(db, id).status, 'pending_approval');
});

test('approve and reject at the same moment: one wins, the other changes nothing and mails nobody', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  const [a, r] = await Promise.all([
    act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 }, waits),
    act(reject.onRequestPost, 'reject', env, 'admin', id, { revision: 1, note: 'Görseli değiştir' }, waits),
  ]);
  await settle(waits);
  assert.deepEqual([a.status, r.status].sort(), [200, 409]);
  const decisions = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('social.post.approve', 'social.post.reject')`).get() as { n: number }).n;
  assert.equal(decisions, 1);
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org'], 'only the winner mails the author');
});

test('reject needs a note, stores it, and mails the author', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  assert.equal((await act(reject.onRequestPost, 'reject', env, 'pub', id, { revision: 1, note: '' })).status, 400);
  assert.equal((await act(reject.onRequestPost, 'reject', env, 'pub', id, { revision: 1, note: 'Görseli değiştir' }, waits)).status, 200);
  await settle(waits);
  assert.deepEqual({ ...db.prepare('SELECT status, review_note FROM social_posts').get() as object }, { status: 'rejected', review_note: 'Görseli değiştir' });
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org']);
});

test('a broken Gmail never fails the action', async () => {
  const { env, waits } = setupSocial();
  mail.fail();
  const id = await newPost(env);
  assert.equal((await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 }, waits)).status, 200);
  await settle(waits);
  assert.equal(mail.sent.length, 0);
});

test('cancel removes targets and frees the plan; drafts cannot be cancelled', async () => {
  const { env, db } = setupSocial();
  const id = await newPost(env, 'pub');
  db.prepare(`INSERT INTO social_plans (id, title, scheduled_at, created_by, created_at, updated_at, post_id) VALUES ('pl','P',?, 'pub', 1, 1, ?)`).run(NOW + 3600, id);
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'pub', id, { revision: 0 })).status, 409, 'a draft is deleted, not cancelled');
  await act(submit.onRequestPost, 'submit', env, 'pub', id, { revision: 0 });
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'ed', id, { revision: 1 })).status, 403, 'not ed\'s post');
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'pub', id, { revision: 1 })).status, 200);
  assert.equal(status(db, id).status, 'cancelled');
  assert.deepEqual(targets(db), []);
  assert.equal((db.prepare(`SELECT post_id FROM social_plans WHERE id = 'pl'`).get() as { post_id: string | null }).post_id, null);
});

test('a revision ahead of the row is a 409 and writes nothing', async () => {
  const { env, db } = setupSocial();
  const id = await newPost(env);
  const res = await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 1 });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'post_changed');
  assert.deepEqual({ ...status(db, id) }, { status: 'draft', revision: 0 });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.post.submit'`).get() as { n: number }).n, 0);
});
