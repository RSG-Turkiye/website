// Agent tokens on the social API and the image upload (plan 5, Task 4).
// A token drafts and submits posts and plans in its member's name, as a
// non-publisher: nothing it submits is ever scheduled, it never sees an
// e-mail address, and approve / requeue are a person's job.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { setupSocial, call, settle, stubMail, KEYS, BASE } from './lib/social';
import { mintToken, bearer } from './lib/agent';
import { fakeR2 } from './lib/fake-r2';
import { grantRole } from '../functions/_lib/role-grants';
import { socialGate } from '../functions/_lib/social-api';
import { authenticateAgent, markInternal } from '../functions/_lib/agent-tokens';
import * as posts from '../functions/api/social/posts/index';
import * as post from '../functions/api/social/posts/[id]';
import * as submit from '../functions/api/social/posts/[id]/submit';
import * as approve from '../functions/api/social/posts/[id]/approve';
import * as requeue from '../functions/api/social/posts/[id]/requeue';
import * as reject from '../functions/api/social/posts/[id]/reject';
import * as cancel from '../functions/api/social/posts/[id]/cancel';
import * as plans from '../functions/api/social/plans/index';
import * as plan from '../functions/api/social/plans/[id]';
import * as upload from '../functions/api/blog-submissions/upload-image';

const NOW = Math.floor(Date.now() / 1000);
const draft = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram', 'linkedin'], scheduledAt: NOW + 3600 };
const story = { type: 'story', media: [{ key: KEYS.story, alt: 'Sahne' }], platforms: ['instagram'], scheduledAt: NOW + 600 };
const validPlan = { title: 'Konuşmacı 3 tanıtımı', scheduledAt: NOW + 86400, platforms: ['instagram'], postType: 'image', assigneeId: 'ed', note: '' };

let mail: ReturnType<typeof stubMail>;
const pending: Promise<unknown>[] = [];
beforeEach(() => { mail = stubMail(); });
afterEach(async () => { await settle(pending.splice(0)); mail.restore(); });

/** setupSocial plus the live grants a token's rights are computed from. */
async function setup() {
  const s = setupSocial();
  const DB = (s.env as { DB: D1Database }).DB;
  await grantRole(DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, NOW - 100);
  await grantRole(DB, { userId: 'pub', role: 'social_publisher', expiresAt: null, by: null }, NOW - 100);
  await grantRole(DB, { userId: 'ed', role: 'social', expiresAt: null, by: null }, NOW - 100);
  await grantRole(DB, { userId: 'ed2', role: 'social', expiresAt: null, by: null }, NOW - 100);
  return s;
}

type Opts = { token?: string; as?: string; body?: unknown; params?: Record<string, string> };
const req = (handler: unknown, method: string, path: string, env: unknown, o: Opts) =>
  call(handler, method, path, { env, as: o.as, body: o.body, params: o.params, waits: pending, headers: o.token ? bearer(o.token) : {} });

const audits = (db: DatabaseSync, action: string) =>
  (db.prepare('SELECT details FROM audit_log WHERE action = ? ORDER BY seq').all(action) as { details: string }[]).map((r) => JSON.parse(r.details) as Record<string, unknown>);
const auditCount = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n;
const postRow = (db: DatabaseSync, id: string) =>
  db.prepare('SELECT status, revision, caption, approved_by, event_mode_id, agent_token_id FROM social_posts WHERE id = ?').get(id) as {
    status: string; revision: number; caption: string; approved_by: string | null; event_mode_id: string | null; agent_token_id: string | null;
  };
const targetCount = (db: DatabaseSync) => (db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n;

async function createByToken(env: unknown, token: string, body: Record<string, unknown> = draft): Promise<string> {
  const res = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { token, body });
  assert.equal(res.status, 201);
  return (await res.json() as { id: string }).id;
}
const submitByToken = (env: unknown, token: string, id: string, revision = 0) =>
  req(submit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, env, { token, params: { id }, body: { revision } });

// Review Focus 1 ------------------------------------------------------------

test('a publisher\'s social:draft token creates and submits a ready post: pending, never scheduled, no targets', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'pub', ['social:draft'], { id: 'tok-pub' });
  const id = await createByToken(env, token);
  assert.equal(postRow(db, id).agent_token_id, 'tok-pub');
  const res = await submitByToken(env, token, id);
  assert.deepEqual(await res.json(), { ok: true, revision: 1, status: 'pending_approval' });
  const row = postRow(db, id);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.approved_by, null);
  assert.equal(targetCount(db), 0);
  for (const action of ['social.post.create', 'social.post.submit']) {
    const [d] = audits(db, action);
    assert.equal(d.via, 'agent', action);
    assert.equal(d.agent_token, 'tok-pub', action);
  }
});

test('an admin\'s token (users.is_admin set) still only drafts: submit and story stay pending, a scheduled post is not editable', async () => {
  const { env, db } = await setup();
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["admin"]','pub',1)`).run(NOW - 60, NOW + 3600);
  const token = await mintToken(db, 'admin', ['social:draft']);
  for (const body of [draft, story]) {
    const id = await createByToken(env, token, body);
    assert.equal((await (await submitByToken(env, token, id)).json() as { status: string }).status, 'pending_approval');
    assert.equal(postRow(db, id).approved_by, null);
  }
  assert.equal(targetCount(db), 0);
  // The admin schedules a post of their own in the panel; their token cannot edit it.
  const sid = (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'admin', body: draft })).json() as { id: string }).id;
  assert.equal((await (await req(submit.onRequestPost, 'POST', `/api/social/posts/${sid}/submit`, env, { as: 'admin', params: { id: sid }, body: { revision: 0 } })).json() as { status: string }).status, 'scheduled');
  const before = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(sid);
  const res = await req(post.onRequestPatch, 'PATCH', `/api/social/posts/${sid}`, env, { token, params: { id: sid }, body: { ...draft, caption: 'Değişti', revision: 1 } });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'not_editable');
  assert.deepEqual(db.prepare('SELECT * FROM social_posts WHERE id = ?').get(sid), before);
});

test('a token with a valid publisher session cookie beside it still acts as the token (pending)', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'pub', ['social:draft']);
  const id = await createByToken(env, token);
  const res = await req(submit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, env, { token, as: 'pub', params: { id }, body: { revision: 0 } });
  assert.equal((await res.json() as { status: string }).status, 'pending_approval');
  assert.equal(targetCount(db), 0);
});

test('an editor\'s token submitting a story inside an open event window that names them stays pending', async () => {
  const { env, db } = await setup();
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 60, NOW + 3600);
  const token = await mintToken(db, 'ed', ['social:draft']);
  const id = await createByToken(env, token, story);
  const res = await submitByToken(env, token, id);
  assert.equal((await res.json() as { status: string }).status, 'pending_approval');
  const row = postRow(db, id);
  assert.equal(row.status, 'pending_approval');
  assert.equal(row.event_mode_id, null);
  assert.equal(targetCount(db), 0);
});

test('a token PATCH of a scheduled post is 409 not_editable and the row is unchanged', async () => {
  const { env, db } = await setup();
  // The publisher schedules their own post in the panel.
  const created = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'pub', body: draft });
  const { id } = await created.json() as { id: string };
  assert.equal((await req(submit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, env, { as: 'pub', params: { id }, body: { revision: 0 } })).status, 200);
  const before = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id);
  const targetsBefore = db.prepare('SELECT * FROM social_post_targets ORDER BY platform').all();
  const audited = auditCount(db);
  const token = await mintToken(db, 'pub', ['social:draft']);
  const res = await req(post.onRequestPatch, 'PATCH', `/api/social/posts/${id}`, env, { token, params: { id }, body: { ...draft, caption: 'Değişti', revision: 1 } });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'not_editable');
  assert.deepEqual(db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id), before);
  assert.deepEqual(db.prepare('SELECT * FROM social_post_targets ORDER BY platform').all(), targetsBefore);
  assert.equal(auditCount(db), audited);
});

test('a token may PATCH a pending post; it stays pending, is marked, and the audit says agent', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const created = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'ed', body: draft });
  const { id } = await created.json() as { id: string };
  assert.equal(postRow(db, id).agent_token_id, null);
  await req(submit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, env, { as: 'ed', params: { id }, body: { revision: 0 } });
  const res = await req(post.onRequestPatch, 'PATCH', `/api/social/posts/${id}`, env, { token, params: { id }, body: { ...draft, caption: 'Yeni', revision: 1 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 2, status: 'pending_approval' });
  assert.equal(postRow(db, id).agent_token_id, 'tok-ed');
  const [d] = audits(db, 'social.post.update');
  assert.equal(d.via, 'agent');
  assert.equal(d.agent_token, 'tok-ed');
});

test('a person\'s later save keeps the agent mark', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const id = await createByToken(env, token);
  const res = await req(post.onRequestPatch, 'PATCH', `/api/social/posts/${id}`, env, { as: 'ed', params: { id }, body: { ...draft, caption: 'Elle', revision: 0 } });
  assert.equal(res.status, 200);
  assert.equal(postRow(db, id).caption, 'Elle');
  assert.equal(postRow(db, id).agent_token_id, 'tok-ed');
  assert.equal(audits(db, 'social.post.update')[0].via, undefined);
});

test('approve, reject, cancel and requeue answer 403 human_only to any token, and nothing changes', async () => {
  const { env, db } = await setup();
  const created = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'ed', body: draft });
  const { id } = await created.json() as { id: string };
  await req(submit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, env, { as: 'ed', params: { id }, body: { revision: 0 } });
  const before = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id);
  const audited = auditCount(db);
  for (const [who, scope] of [['admin', 'social:draft'], ['pub', 'social:draft'], ['ed', 'social:read']] as const) {
    const token = await mintToken(db, who, [scope]);
    for (const [handler, path] of [[approve.onRequestPost, 'approve'], [reject.onRequestPost, 'reject'], [cancel.onRequestPost, 'cancel'], [requeue.onRequestPost, 'requeue']] as const) {
      const res = await req(handler, 'POST', `/api/social/posts/${id}/${path}`, env, { token, as: who, params: { id }, body: { revision: 1 } });
      assert.equal(res.status, 403, `${who} ${path}`);
      assert.equal((await res.json() as { code: string }).code, 'human_only', `${who} ${path}`);
    }
  }
  assert.deepEqual(db.prepare('SELECT * FROM social_posts WHERE id = ?').get(id), before);
  assert.equal(targetCount(db), 0);
  assert.equal(auditCount(db), audited);
});

test('socialGate refuses a token human_only whenever publish rights are asked for, even on a table route', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'admin', ['social:draft']);
  const request = new Request(`${BASE}/api/social/posts`, { method: 'POST', headers: bearer(token) });
  const gate = await socialGate(request, env, 'publish', true);
  assert.equal(gate.ok, false);
  if (!gate.ok) {
    assert.equal(gate.response.status, 403);
    assert.equal((await gate.response.json() as { code: string }).code, 'human_only');
  }
});

// Bearer decides --------------------------------------------------------------

test('a bad bearer token beside a valid session is 401, on social and on upload', async () => {
  const { env, db } = await setup();
  const bad = 'rsg_pat_' + 'A'.repeat(43);
  const res = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { token: bad, as: 'pub', body: draft });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_posts').get() as { n: number }).n, 0);
  const up = await uploadAs({ ...env as object, BLOG_IMAGES: fakeR2() }, { token: bad, cookie: 's-pub' });
  assert.equal(up.status, 401);
});

test('a token passes with a foreign Origin (no CSRF check on the bearer path); the cookie path still refuses it', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft']);
  const foreign = { Origin: 'https://evil.example' };
  const res = await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, body: draft, headers: { ...foreign, ...bearer(token) } });
  assert.equal(res.status, 201);
  const up = await (upload.onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...foreign, ...bearer(token) }, body: jpeg(1080, 1350) }),
    env: { ...env as object, BLOG_IMAGES: fakeR2() },
  });
  assert.equal(up.status, 200);
  assert.equal((await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, as: 'ed', body: draft, headers: foreign })).status, 403);
});

test('a revoked token is 401', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft'], { revokedAt: NOW - 1 });
  const res = await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { token, body: draft });
  assert.equal(res.status, 401);
});

// E-mail addresses -------------------------------------------------------------

test('a token sees authorEmail null on a post and in lists, assigneeEmail null on plans; byAgent is shown', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'pub', ['social:read']);
  const draftToken = await mintToken(db, 'pub', ['social:draft']);
  const humanId = (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'pub', body: draft })).json() as { id: string }).id;
  const agentId = await createByToken(env, draftToken);
  await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'pub', body: { ...draft, scheduledAt: null } });
  await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { as: 'ed', body: validPlan });

  const one = await (await req(post.onRequestGet, 'GET', `/api/social/posts/${humanId}`, env, { token, params: { id: humanId } })).json() as { authorEmail: unknown; byAgent: boolean };
  assert.equal(one.authorEmail, null);
  assert.equal(one.byAgent, false);
  const two = await (await req(post.onRequestGet, 'GET', `/api/social/posts/${agentId}`, env, { token, params: { id: agentId } })).json() as { byAgent: boolean; agentTokenId?: unknown };
  assert.equal(two.byAgent, true);
  assert.equal('agentTokenId' in two, false);

  for (const query of [`from=${NOW}&to=${NOW + 86400}`, 'drafts=1']) {
    const list = await (await req(posts.onRequestGet, 'GET', `/api/social/posts?${query}`, env, { token })).json() as { posts: { authorEmail: unknown }[] };
    assert.ok(list.posts.length > 0, query);
    assert.ok(list.posts.every((p) => p.authorEmail === null), query);
  }
  const planList = await (await req(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 2 * 86400}`, env, { token })).json() as { plans: { assigneeEmail: unknown; assigneeId: string }[] };
  assert.equal(planList.plans.length, 1);
  assert.equal(planList.plans[0].assigneeEmail, null);
  assert.equal(planList.plans[0].assigneeId, 'ed');

  // The panel itself still sees the addresses.
  const panel = await (await req(post.onRequestGet, 'GET', `/api/social/posts/${humanId}`, env, { as: 'pub', params: { id: humanId } })).json() as { authorEmail: unknown };
  assert.equal(panel.authorEmail, 'pub@example.org');
  const panelPlans = await (await req(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 2 * 86400}`, env, { as: 'pub' })).json() as { plans: { assigneeEmail: unknown }[] };
  assert.equal(panelPlans.plans[0].assigneeEmail, 'ed@example.org');
});

test('a token sees only its member\'s own posts and published ones; colleagues\' unpublished posts are not there', async () => {
  const { env, db } = await setup();
  const make = async (as: string, body: Record<string, unknown> = draft) =>
    (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as, body })).json() as { id: string }).id;
  const othersDraft = await make('ed2');
  const othersPending = await make('ed2');
  await req(submit.onRequestPost, 'POST', `/api/social/posts/${othersPending}/submit`, env, { as: 'ed2', params: { id: othersPending }, body: { revision: 0 } });
  const othersScheduled = await make('pub');
  await req(submit.onRequestPost, 'POST', `/api/social/posts/${othersScheduled}/submit`, env, { as: 'pub', params: { id: othersScheduled }, body: { revision: 0 } });
  const othersFailed = await make('ed2');
  const othersPublished = await make('ed2');
  const othersPartly = await make('ed2');
  db.prepare(`UPDATE social_posts SET status = 'failed' WHERE id = ?`).run(othersFailed);
  db.prepare(`UPDATE social_posts SET status = 'published', review_note = 'iç not' WHERE id = ?`).run(othersPublished);
  db.prepare(`UPDATE social_posts SET status = 'partially_published' WHERE id = ?`).run(othersPartly);
  const ownDraft = await make('ed');
  const ownPending = await make('ed');
  await req(submit.onRequestPost, 'POST', `/api/social/posts/${ownPending}/submit`, env, { as: 'ed', params: { id: ownPending }, body: { revision: 0 } });
  const token = await mintToken(db, 'ed', ['social:read']);

  const ids = async (query: string) =>
    (await (await req(posts.onRequestGet, 'GET', `/api/social/posts?${query}`, env, { token })).json() as { posts: { id: string }[] }).posts.map((p) => p.id).sort();
  assert.deepEqual(await ids(`from=${NOW}&to=${NOW + 86400}`), [othersPartly, othersPublished, ownDraft, ownPending].sort());
  assert.deepEqual(await ids('status=pending_approval'), [ownPending]);
  assert.deepEqual(await ids('status=scheduled'), []);
  assert.deepEqual(await ids('done=1'), [othersPartly, othersPublished].sort());
  // The panel, for the same member, still lists the whole calendar.
  const panel = (await (await req(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 86400}`, env, { as: 'ed' })).json() as { posts: unknown[] }).posts;
  assert.equal(panel.length, 8);

  for (const id of [othersDraft, othersPending, othersScheduled, othersFailed]) {
    const res = await req(post.onRequestGet, 'GET', `/api/social/posts/${id}`, env, { token, params: { id } });
    assert.equal(res.status, 404, id);
  }
  for (const id of [ownDraft, ownPending, othersPublished, othersPartly]) {
    assert.equal((await req(post.onRequestGet, 'GET', `/api/social/posts/${id}`, env, { token, params: { id } })).status, 200, id);
  }
});

test('a token gets no platform error text, and a review note only on its member\'s own posts', async () => {
  const { env, db } = await setup();
  const make = async (as: string) =>
    (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as, body: draft })).json() as { id: string }).id;
  const own = await make('ed');
  const others = await make('ed2');
  for (const id of [own, others]) {
    db.prepare(`UPDATE social_posts SET status = 'partially_published', review_note = 'not' WHERE id = ?`).run(id);
    db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, last_error) VALUES (?, 'linkedin', 'failed', 'platform said no')`).run(id);
  }
  const token = await mintToken(db, 'ed', ['social:read']);
  type P = { id: string; reviewNote: string | null; targets: { lastError: string | null }[] };
  const one = async (id: string) => await (await req(post.onRequestGet, 'GET', `/api/social/posts/${id}`, env, { token, params: { id } })).json() as P;
  assert.equal((await one(own)).reviewNote, 'not');
  assert.equal((await one(others)).reviewNote, null);
  for (const id of [own, others]) assert.deepEqual((await one(id)).targets.map((t) => t.lastError), [null]);
  const list = (await (await req(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 86400}`, env, { token })).json() as { posts: P[] }).posts;
  assert.deepEqual(list.map((p) => [p.id === own, p.reviewNote, p.targets[0].lastError]).sort(), [[false, null, null], [true, 'not', null]]);
  // The panel still sees both.
  const panel = await (await req(post.onRequestGet, 'GET', `/api/social/posts/${others}`, env, { as: 'ed', params: { id: others } })).json() as P;
  assert.deepEqual([panel.reviewNote, panel.targets[0].lastError], ['not', 'platform said no']);
});

test('a token\'s drafts list holds only its member\'s own drafts, even for a publisher', async () => {
  const { env, db } = await setup();
  await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'ed', body: { ...draft, scheduledAt: null } });
  const mine = (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'pub', body: { ...draft, scheduledAt: null } })).json() as { id: string }).id;
  const token = await mintToken(db, 'pub', ['social:read']);
  const list = await (await req(posts.onRequestGet, 'GET', '/api/social/posts?drafts=1', env, { token })).json() as { posts: { id: string }[] };
  assert.deepEqual(list.posts.map((p) => p.id), [mine]);
});

// Scope and role -------------------------------------------------------------------

test('a social:read token cannot create a post or a plan', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:read']);
  assert.equal((await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { token, body: draft })).status, 403);
  assert.equal((await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { token, body: validPlan })).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_posts').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_plans').get() as { n: number }).n, 0);
});

test('a social:draft token whose member holds no social grant is 403; a CMS-only token is 403', async () => {
  const { env, db } = await setup();
  const memToken = await mintToken(db, 'mem', ['social:draft']);
  assert.equal((await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { token: memToken, body: draft })).status, 403);
  const cmsToken = await mintToken(db, 'ed', ['cms.yazilar:draft']);
  assert.equal((await req(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 10}`, env, { token: cmsToken })).status, 403);
});

test('a social editor\'s token creates a post on an open plan, and the plan is linked', async () => {
  const { env, db } = await setup();
  const planId = (await (await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { as: 'pub', body: validPlan })).json() as { id: string }).id;
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const id = await createByToken(env, token, { ...draft, planId });
  assert.equal((db.prepare('SELECT post_id FROM social_plans WHERE id = ?').get(planId) as { post_id: string }).post_id, id);
  assert.equal(postRow(db, id).agent_token_id, 'tok-ed');
  const [d] = audits(db, 'social.post.create');
  assert.equal(d.planId, planId);
  assert.equal(d.via, 'agent');
});

test('a token deletes its member\'s own draft; the delete is audited as agent', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const id = await createByToken(env, token);
  const res = await req(post.onRequestDelete, 'DELETE', `/api/social/posts/${id}`, env, { token, params: { id }, body: { revision: 0 } });
  assert.equal(res.status, 200);
  assert.equal(db.prepare('SELECT id FROM social_posts WHERE id = ?').get(id), undefined);
  const [d] = audits(db, 'social.post.delete');
  assert.equal(d.via, 'agent');
  assert.equal(d.agent_token, 'tok-ed');
});

test('a publisher\'s token cannot edit or delete another member\'s draft', async () => {
  const { env, db } = await setup();
  const id = (await (await req(posts.onRequestPost, 'POST', '/api/social/posts', env, { as: 'ed', body: draft })).json() as { id: string }).id;
  const token = await mintToken(db, 'pub', ['social:draft']);
  assert.equal((await req(post.onRequestPatch, 'PATCH', `/api/social/posts/${id}`, env, { token, params: { id }, body: { ...draft, revision: 0 } })).status, 403);
  assert.equal((await req(post.onRequestDelete, 'DELETE', `/api/social/posts/${id}`, env, { token, params: { id }, body: { revision: 0 } })).status, 403);
  assert.ok(db.prepare('SELECT id FROM social_posts WHERE id = ?').get(id));
});

// Plans ------------------------------------------------------------------------------

test('plans: a token creates, edits the date (reminder reset), deletes its own empty plan; each audit says agent', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const created = await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { token, body: validPlan });
  assert.equal(created.status, 201);
  const { id } = await created.json() as { id: string };
  assert.equal((db.prepare('SELECT created_by FROM social_plans WHERE id = ?').get(id) as { created_by: string }).created_by, 'ed');
  db.prepare('UPDATE social_plans SET reminded_at = 5 WHERE id = ?').run(id);
  const patched = await req(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, env, { token, params: { id }, body: { scheduledAt: NOW + 2 * 86400 } });
  assert.equal(patched.status, 200);
  const row = db.prepare('SELECT scheduled_at, reminded_at FROM social_plans WHERE id = ?').get(id) as { scheduled_at: number; reminded_at: number | null };
  assert.deepEqual([row.scheduled_at, row.reminded_at], [NOW + 2 * 86400, null]);
  const deleted = await req(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, env, { token, params: { id } });
  assert.equal(deleted.status, 200);
  assert.equal(db.prepare('SELECT id FROM social_plans WHERE id = ?').get(id), undefined);
  for (const action of ['social.plan.create', 'social.plan.update', 'social.plan.delete']) {
    const [d] = audits(db, action);
    assert.equal(d.via, 'agent', action);
    assert.equal(d.agent_token, 'tok-ed', action);
  }
});

test('plans: a token deleting a plan another member created is 403 not_allowed and the row stays', async () => {
  const { env, db } = await setup();
  const id = (await (await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { as: 'ed2', body: validPlan })).json() as { id: string }).id;
  const audited = auditCount(db);
  const token = await mintToken(db, 'pub', ['social:draft']);
  const res = await req(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, env, { token, params: { id } });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { code: string }).code, 'not_allowed');
  assert.ok(db.prepare('SELECT id FROM social_plans WHERE id = ?').get(id));
  assert.equal(auditCount(db), audited);
  // A person still deletes it in the panel.
  assert.equal((await req(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, env, { as: 'pub', params: { id } })).status, 200);
});

test('plans: a token cannot delete its own plan once it has a post', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft']);
  const planId = (await (await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { token, body: validPlan })).json() as { id: string }).id;
  await createByToken(env, token, { ...draft, planId });
  const res = await req(plan.onRequestDelete, 'DELETE', `/api/social/plans/${planId}`, env, { token, params: { id: planId } });
  assert.equal(res.status, 409);
  assert.ok(db.prepare('SELECT id FROM social_plans WHERE id = ?').get(planId));
});

test('plans: a social:read token cannot create, edit or delete', async () => {
  const { env, db } = await setup();
  const id = (await (await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { as: 'ed', body: validPlan })).json() as { id: string }).id;
  const token = await mintToken(db, 'ed', ['social:read']);
  assert.equal((await req(plans.onRequestPost, 'POST', '/api/social/plans', env, { token, body: validPlan })).status, 403);
  assert.equal((await req(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, env, { token, params: { id }, body: { title: 'x' } })).status, 403);
  assert.equal((await req(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, env, { token, params: { id } })).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_plans').get() as { n: number }).n, 1);
});

// Upload -------------------------------------------------------------------------------

const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0, 0, 0, 0, 0, 0, 0, 0]);

function uploadAs(env: unknown, o: { token?: string; cookie?: string }) {
  const headers: Record<string, string> = { 'Content-Type': 'image/jpeg', ...(o.token ? bearer(o.token) : {}) };
  if (o.cookie) headers.Cookie = `rsg_session=${o.cookie}`;
  return (upload.onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers, body: jpeg(1080, 1350) }),
    env,
  });
}

test('upload: a social:draft token stores the image and logs media.upload as agent', async () => {
  const { env, db } = await setup();
  const bucket = fakeR2();
  const token = await mintToken(db, 'ed', ['social:draft'], { id: 'tok-ed' });
  const res = await uploadAs({ ...env as object, BLOG_IMAGES: bucket }, { token });
  assert.equal(res.status, 200);
  const { key } = await res.json() as { key: string };
  assert.ok(bucket.store.has(key));
  assert.equal((db.prepare('SELECT uploaded_by FROM social_media WHERE key = ?').get(key) as { uploaded_by: string }).uploaded_by, 'ed');
  const [d] = audits(db, 'media.upload');
  assert.equal(d.via, 'agent');
  assert.equal(d.agent_token, 'tok-ed');
});

test('upload: a CMS draft token of a group the member edits may upload', async () => {
  const { env, db } = await setup();
  const DB = (env as { DB: D1Database }).DB;
  await grantRole(DB, { userId: 'mem', role: 'content.yazilar.edit', expiresAt: NOW + 86400, by: null }, NOW - 100);
  const token = await mintToken(db, 'mem', ['cms.yazilar:draft']);
  assert.equal((await uploadAs({ ...env as object, BLOG_IMAGES: fakeR2() }, { token })).status, 200);
});

test('upload: read-level and social:read tokens get 403 and nothing is stored', async () => {
  const { env, db } = await setup();
  const DB = (env as { DB: D1Database }).DB;
  await grantRole(DB, { userId: 'mem', role: 'content.yazilar.edit', expiresAt: NOW + 86400, by: null }, NOW - 100);
  const bucket = fakeR2();
  for (const [who, scope] of [['mem', 'cms.yazilar:read'], ['ed', 'social:read'], ['mem', 'social:draft']] as const) {
    const token = await mintToken(db, who, [scope]);
    assert.equal((await uploadAs({ ...env as object, BLOG_IMAGES: bucket }, { token })).status, 403, `${who} ${scope}`);
  }
  assert.equal(bucket.store.size, 0);
  assert.equal(audits(db, 'media.upload').length, 0);
});

test('upload: the cookie path is unchanged (CSRF and session as before)', async () => {
  const { env } = await setup();
  const res = await uploadAs({ ...env as object, BLOG_IMAGES: fakeR2() }, { cookie: 's-ed' });
  assert.equal(res.status, 200);
  assert.equal((await uploadAs({ ...env as object, BLOG_IMAGES: fakeR2() }, {})).status, 401);
});

test('socialGate lets a token through only on a social route, as cmsGate does for cms', async () => {
  const { env, db } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft', 'cms.etkinlikler:draft'], { id: 'tok-area' });
  // A token request authenticated on a route outside the social area (the upload route), handed to the social gate.
  const outer = await authenticateAgent(new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: bearer(token), body: 'x' }), env as never, NOW);
  assert.equal(outer.kind, 'agent');
  const inner = new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: bearer(token) });
  markInternal(inner, outer as Extract<typeof outer, { kind: 'agent' }>);
  const gate = await socialGate(inner, env as never, 'edit', true);
  assert.equal(gate.ok, false);
  const res = (gate as Extract<typeof gate, { ok: false }>).response;
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code: string }).code, 'human_only');
});
