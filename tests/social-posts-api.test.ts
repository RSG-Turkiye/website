import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, settle, stubMail, KEYS } from './lib/social';
import * as posts from '../functions/api/social/posts/index';
import * as post from '../functions/api/social/posts/[id]';
import * as plans from '../functions/api/social/plans/index';

const NOW = Math.floor(Date.now() / 1000);
const draft = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: NOW + 3600 };

async function create(env: unknown, as: string, body: Record<string, unknown> = draft) {
  const res = await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, as, body });
  return { res, json: await res.json() as { id: string; revision: number } };
}

test('an editor creates a draft; GET shows it with image URLs and the author', async () => {
  const { env } = setupSocial();
  const { res, json } = await create(env, 'ed');
  assert.equal(res.status, 201);
  assert.equal(json.revision, 0);
  const got = await (await call(post.onRequestGet, 'GET', `/api/social/posts/${json.id}`, { env, as: 'ed2', params: { id: json.id } })).json() as { status: string; authorEmail: string; media: { url: string }[] };
  assert.equal(got.status, 'draft');
  assert.equal(got.authorEmail, 'ed@example.org');
  assert.equal(got.media[0].url, `https://rsg-turkiye.iscbsc.org/api/images/${KEYS.feed}`);
});

test('creating from a plan copies its slot and links it; a taken plan refuses a second post', async () => {
  const { env, db } = setupSocial();
  const planRes = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: { title: 'P', scheduledAt: NOW + 7200, platforms: ['linkedin'], postType: 'carousel' } });
  const { id: planId } = await planRes.json() as { id: string };
  const { json } = await create(env, 'ed', { type: 'carousel', planId });
  const row = db.prepare('SELECT scheduled_at, platforms FROM social_posts WHERE id = ?').get(json.id) as { scheduled_at: number; platforms: string };
  assert.deepEqual([row.scheduled_at, JSON.parse(row.platforms)], [NOW + 7200, ['linkedin']]);
  assert.equal((db.prepare('SELECT post_id FROM social_plans WHERE id = ?').get(planId) as { post_id: string }).post_id, json.id);
  const second = await create(env, 'ed2', { type: 'image', planId });
  assert.equal(second.res.status, 409);
  assert.equal((second.json as unknown as { code: string }).code, 'plan_taken');
});

test('a stale revision is refused and changes nothing', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  const ok = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'İkinci', revision: 0 } });
  assert.equal(ok.status, 200);
  const stale = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Üçüncü', revision: 0 } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { code: string }).code, 'post_changed');
  assert.equal((db.prepare('SELECT caption FROM social_posts').get() as { caption: string }).caption, 'İkinci');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.post.update'`).get() as { n: number }).n, 1);
});

test('another editor cannot edit my draft; a publisher can', async () => {
  const { env } = setupSocial();
  const { json } = await create(env, 'ed');
  assert.equal((await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed2', params: { id: json.id }, body: { ...draft, revision: 0 } })).status, 403);
  assert.equal((await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, revision: 0 } })).status, 200);
});

test('an editor editing a scheduled post sends it back for approval and removes its targets', async () => {
  const mail = stubMail();
  const { env, db, waits } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled', revision = 3 WHERE id = ?`).run(json.id);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform) VALUES (?, 'instagram')`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Değişti', revision: 3 }, waits });
  assert.deepEqual(await res.json(), { ok: true, revision: 4, status: 'pending_approval' });
  await settle(waits);
  mail.restore();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 0);
});

test('a publisher editing a scheduled post keeps it scheduled and rebuilds targets, if still ready', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled' WHERE id = ?`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, platforms: ['instagram', 'linkedin'], revision: 0 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 1, status: 'scheduled' });
  assert.deepEqual((db.prepare('SELECT platform FROM social_post_targets ORDER BY platform').all() as { platform: string }[]).map((r) => r.platform), ['instagram', 'linkedin']);
  const broken = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, media: [{ key: KEYS.feed, alt: '' }], revision: 1 } });
  assert.equal(broken.status, 422);
  assert.deepEqual((await broken.json() as { problems: { code: string }[] }).problems.map((p) => p.code), ['missing_alt']);
});

test('only drafts and rejected posts can be deleted, and deleting frees the plan', async () => {
  const { env, db } = setupSocial();
  const { id: planId } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: { title: 'P', scheduledAt: NOW + 7200, platforms: ['instagram'] } })).json() as { id: string };
  const { json } = await create(env, 'ed', { type: 'image', planId });
  db.prepare(`UPDATE social_posts SET status = 'pending_approval' WHERE id = ?`).run(json.id);
  assert.equal((await call(post.onRequestDelete, 'DELETE', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { revision: 0 } })).status, 409);
  db.prepare(`UPDATE social_posts SET status = 'draft' WHERE id = ?`).run(json.id);
  assert.equal((await call(post.onRequestDelete, 'DELETE', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { revision: 0 } })).status, 200);
  assert.equal((db.prepare('SELECT post_id FROM social_plans WHERE id = ?').get(planId) as { post_id: string | null }).post_id, null);
});

test('list: a date range, pending posts, and undated drafts', async () => {
  const { env, db } = setupSocial();
  const a = (await create(env, 'ed')).json.id;
  const b = (await create(env, 'ed2', { type: 'image' })).json.id;
  db.prepare(`UPDATE social_posts SET status = 'pending_approval' WHERE id = ?`).run(a);
  const ranged = await (await call(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 86400}`, { env, as: 'ed' })).json() as { posts: { id: string }[] };
  assert.deepEqual(ranged.posts.map((p) => p.id), [a]);
  const pending = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?status=pending_approval', { env, as: 'pub' })).json() as { posts: { id: string }[] };
  assert.deepEqual(pending.posts.map((p) => p.id), [a]);
  const mine = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { env, as: 'ed' })).json() as { posts: { id: string }[] };
  assert.deepEqual(mine.posts.map((p) => p.id), [], 'b is ed2\'s and a has a date');
  const all = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { env, as: 'pub' })).json() as { posts: { id: string }[] };
  assert.deepEqual(all.posts.map((p) => p.id), [b]);
  assert.equal((await call(posts.onRequestGet, 'GET', '/api/social/posts?status=toString', { env, as: 'pub' })).status, 400);
});

test('a revision that does not match the row read is refused before any decision, in both directions', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled', revision = 2 WHERE id = ?`).run(json.id);
  for (const revision of [1, 3]) {
    const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Eski', revision } });
    assert.equal(res.status, 409);
    assert.equal((await res.json() as { code: string }).code, 'post_changed');
  }
  const del = await call(post.onRequestDelete, 'DELETE', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { revision: 1 } });
  assert.equal(del.status, 409);
  const row = db.prepare('SELECT caption, status, revision FROM social_posts WHERE id = ?').get(json.id) as { caption: string; status: string; revision: number };
  assert.deepEqual([row.caption, row.status, row.revision], ['Merhaba', 'scheduled', 2]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'social.post.%'`).get() as { n: number }).n, 1, 'only the create is logged');
});

test('an editor editing a scheduled post mails the publishers and clears the old approval', async () => {
  const mail = stubMail();
  try {
    const { env, db, waits } = setupSocial();
    const { json } = await create(env, 'ed');
    db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',1,2,'[]','pub',1)`).run();
    db.prepare(`UPDATE social_posts SET status = 'scheduled', approved_by = 'pub', approved_at = 5, event_mode_id = 'e' WHERE id = ?`).run(json.id);
    const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Yeni', revision: 0 }, waits });
    assert.equal((await res.json() as { status: string }).status, 'pending_approval');
    await settle(waits);
    assert.ok(mail.sent.some((m) => m.to === 'pub@example.org'));
    assert.ok(!mail.sent.some((m) => m.to === 'ed@example.org'));
    const row = db.prepare('SELECT approved_by, approved_at, event_mode_id FROM social_posts WHERE id = ?').get(json.id);
    assert.deepEqual({ ...row }, { approved_by: null, approved_at: null, event_mode_id: null });
  } finally { mail.restore(); }
});

test('a rejected post edited back to a draft loses its review note', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'rejected', review_note = 'Düzelt' WHERE id = ?`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, revision: 0 } });
  assert.equal((await res.json() as { status: string }).status, 'draft');
  assert.equal((db.prepare('SELECT review_note FROM social_posts WHERE id = ?').get(json.id) as { review_note: string | null }).review_note, null);
});

test('120 posts in range list with every target, and no query binds more than D1 allows', async () => {
  const { env, db, bindLog } = setupSocial();
  const ins = db.prepare(`INSERT INTO social_posts (id, type, caption, caption_overrides, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES (?, 'image', 'c', '{}', '[]', '["instagram"]', ?, 'draft', 0, 'ed', 1, 1)`);
  const tgt = db.prepare(`INSERT INTO social_post_targets (post_id, platform) VALUES (?, 'instagram')`);
  for (let i = 0; i < 120; i++) { ins.run(`p${i}`, NOW + 100 + i); tgt.run(`p${i}`); }
  bindLog.length = 0;
  const res = await call(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 86400}`, { env, as: 'ed' });
  const list = (await res.json() as { posts: { targets: unknown[] }[] }).posts;
  assert.equal(list.length, 120);
  assert.ok(list.every((p) => p.targets.length === 1));
  assert.ok(bindLog.length > 0 && Math.max(...bindLog.map((b) => b.count)) <= 100);
});

test('an editor\'s story counts as covered only when it goes out before the window closes', async () => {
  const { env, db } = setupSocial();
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 60, NOW + 3600);
  const story = { type: 'story', caption: '', media: [{ key: KEYS.story, alt: 'Sahne' }], platforms: ['instagram'] };
  const { json } = await create(env, 'ed', { ...story, scheduledAt: NOW + 600 });
  db.prepare(`UPDATE social_posts SET status = 'scheduled' WHERE id = ?`).run(json.id);
  const inside = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...story, scheduledAt: NOW + 900, revision: 0 } });
  assert.equal((await inside.json() as { status: string }).status, 'scheduled');
  assert.equal((db.prepare('SELECT event_mode_id FROM social_posts WHERE id = ?').get(json.id) as { event_mode_id: string }).event_mode_id, 'e');
  const after = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...story, scheduledAt: NOW + 7200, revision: 1 } });
  assert.equal((await after.json() as { status: string }).status, 'pending_approval');
  assert.equal((db.prepare('SELECT event_mode_id FROM social_posts WHERE id = ?').get(json.id) as { event_mode_id: string | null }).event_mode_id, null);
});

test('a missing post is a 404 with a code', async () => {
  const { env } = setupSocial();
  const res = await call(post.onRequestGet, 'GET', '/api/social/posts/nope', { env, as: 'ed', params: { id: 'nope' } });
  assert.equal(res.status, 404);
  assert.equal((await res.json() as { code: string }).code, 'not_found');
});
