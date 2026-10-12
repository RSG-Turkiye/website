import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, KEYS } from './lib/social';
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
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled', revision = 3 WHERE id = ?`).run(json.id);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform) VALUES (?, 'instagram')`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Değişti', revision: 3 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 4, status: 'pending_approval' });
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
