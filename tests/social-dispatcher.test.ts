import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail, KEYS } from './lib/social';
import { stubGraph, type GraphCall } from './lib/instagram';
import { dispatchSocial } from '../functions/_lib/social-dispatcher';
import { onRequestPost as endpoint } from '../functions/api/social/dispatch';
import { connectionUpsert } from '../functions/_lib/connections';
import { LATE_SECONDS, RETRY_WINDOW_SECONDS } from '../functions/_lib/social-dispatch';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const T0 = 1_800_000_000;
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';

let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world(opts: { connected?: boolean; platforms?: string[]; at?: number } = {}) {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never as Parameters<typeof dispatchSocial>[0];
  s.db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
                VALUES ('p1','image','Merhaba',?,?,?,'scheduled',2,'ed',1,1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), JSON.stringify(opts.platforms ?? ['instagram']), opts.at ?? T0);
  for (const p of opts.platforms ?? ['instagram']) s.db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1', ?, 'queued')`).run(p);
  return { ...s, env };
}
async function connect(env: unknown) {
  const stmt = await connectionUpsert(env as never, 'instagram', {
    accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null, scopes: 'x', expiresAt: T0 + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', T0 - 86400);
  await stmt.run();
}
const target = (db: import('node:sqlite').DatabaseSync) => ({ ...db.prepare(`SELECT status, container_id, remote_id, permalink, last_error, claimed_at FROM social_post_targets WHERE platform = 'instagram'`).get() as object }) as Record<string, unknown>;
const postStatus = (db: import('node:sqlite').DatabaseSync) => (db.prepare(`SELECT status FROM social_posts WHERE id = 'p1'`).get() as { status: string }).status;
const actions = (db: import('node:sqlite').DatabaseSync) => (db.prepare(`SELECT action FROM audit_log ORDER BY at, rowid`).all() as { action: string }[]).map((r) => r.action);

function graphFlow(states: string[]) {
  let poll = 0;
  return (c: GraphCall) => {
    if (c.method === 'POST' && c.path === `/${IG}/media`) return Response.json({ id: 'c1' });
    if (c.path === '/c1') return Response.json({ status_code: states[Math.min(poll++, states.length - 1)] });
    if (c.method === 'POST' && c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return Response.json({ permalink: 'https://www.instagram.com/p/abc/' });
    return undefined;
  };
}

test('a post goes out over two ticks: container, then publish; the post becomes published', async () => {
  const { env, db, } = world();
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    assert.deepEqual([target(db).status, target(db).container_id, target(db).claimed_at], ['publishing', 'c1', null], 'lease released after the step');
    assert.equal(postStatus(db), 'scheduled');
    await dispatchSocial(env, T0 + 90, ORIGIN);
  } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).remote_id, target(db).permalink], ['published', 'm1', 'https://www.instagram.com/p/abc/']);
  assert.equal(postStatus(db), 'published');
  assert.deepEqual(actions(db).filter((a) => a.startsWith('social.')), ['social.target.container', 'social.post.published', 'social.target.published']);
  assert.equal((db.prepare(`SELECT revision FROM social_posts`).get() as { revision: number }).revision, 3, 'an open composer gets post_changed');
});

test('a crash after publishing: the next tick sees PUBLISHED and does not publish again', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET status = 'publishing', container_id = 'c1'`).run();
  const g = stubGraph(graphFlow(['PUBLISHED']));
  try { await dispatchSocial(env, T0 + 90, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'published');
  assert.equal(g.calls.some((c) => c.path.endsWith('/media_publish')), false);
});

test('no connection: the target waits once, one mail goes out, later ticks are quiet', async () => {
  const { env, db, waits } = world();
  await dispatchSocial(env, T0 + 30, ORIGIN);
  await Promise.allSettled(waits);
  assert.equal(target(db).status, 'waiting_connection');
  const mailed = mail.sent.length;
  assert.ok(mailed > 0);
  await dispatchSocial(env, T0 + 90, ORIGIN);
  assert.equal(mail.sent.length, mailed, 'nothing new');
  assert.equal(actions(db).filter((a) => a === 'social.target.waiting').length, 1);
});

test('reconnected two days later: the target needs a person, it does not go out', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + LATE_SECONDS + 60, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'needs_confirmation');
  assert.equal(g.calls.length, 0);
  assert.equal(postStatus(db), 'scheduled');
});

test('a confirmed late target goes out', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET confirmed_at = ?`).run(T0 + 2 * 86400);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + 2 * 86400 + 30, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'publishing');
});

test('an expired token: the target waits, the connection is marked broken, admins are told', async () => {
  const { env, db, waits } = world();
  await connect(env);
  const g = stubGraph(() => Response.json({ error: { code: 190, error_subcode: 463, message: 'expired' } }, { status: 400 }));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  await Promise.allSettled(waits);
  assert.equal(target(db).status, 'waiting_connection');
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections WHERE platform = 'instagram'`).get() as { last_error_at: number | null }).last_error_at);
  assert.ok(mail.sent.some((m) => m.to === 'admin@example.org' && /bağlantısı koptu/.test(m.subject)));
});

test('a content error fails the target and the post, with the reason stored', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(() => Response.json({ error: { code: 36003, error_subcode: 2207009, message: 'ratio' } }, { status: 400 }));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).last_error], ['failed', 'bad_ratio: ratio']);
  assert.equal(postStatus(db), 'failed');
});

test('transient errors retry each tick and fail after the window', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(() => new Response('', { status: 503 }));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    assert.equal(target(db).status, 'queued');
    await dispatchSocial(env, T0 + 30 + RETRY_WINDOW_SECONDS, ORIGIN);
  } finally { g.restore(); }
  assert.equal(target(db).status, 'failed');
});

test('LinkedIn is skipped until phase 5; the Instagram half still makes the post published', async () => {
  const { env, db } = world({ platforms: ['instagram', 'linkedin'] });
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    await dispatchSocial(env, T0 + 90, ORIGIN);
  } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT status, last_error FROM social_post_targets WHERE platform = 'linkedin'`).get() as { status: string }).status, 'skipped');
  assert.equal(postStatus(db), 'published');
});

test('a post in the future and a cancelled post are left alone', async () => {
  const { env, db } = world({ at: T0 + 3600 });
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0, ORIGIN); } finally { g.restore(); }
  assert.equal(g.calls.length, 0);
  db.prepare(`UPDATE social_posts SET scheduled_at = ?, status = 'cancelled'`).run(T0 - 60);
  const g2 = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0, ORIGIN); } finally { g2.restore(); }
  assert.equal(g2.calls.length, 0);
});

test('the endpoint refuses a wrong secret and records its run as social', async () => {
  const { env, db } = world();
  const bad = await (endpoint as (c: unknown) => Promise<Response>)({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'nope' } }), env });
  assert.equal(bad.status, 403);
  const ok = await (endpoint as (c: unknown) => Promise<Response>)({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'tick' } }), env });
  assert.equal(ok.status, 200);
  assert.equal((db.prepare(`SELECT kind FROM dispatch_runs`).get() as { kind: string }).kind, 'social');
});

test('a target under a live lease is not claimed', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET claimed_at = ?`).run(T0 + 30 - 60);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  assert.equal(g.calls.length, 0);
  assert.equal(target(db).claimed_at, T0 + 30 - 60);
});

test('an expired lease with a container is reclaimed and recorded as published without publishing again', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET status = 'publishing', container_id = 'c1', claimed_at = ?`).run(T0 + 30 - 601);
  const g = stubGraph(graphFlow(['PUBLISHED']));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'published');
  assert.equal(target(db).claimed_at, null);
  assert.equal(g.calls.some((c) => c.path.endsWith('/media_publish')), false);
  assert.equal(postStatus(db), 'published');
});

test('a reclaimed target ends in this tick result, with its lease released', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET claimed_at = ?`).run(T0 + 30 - 601);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).container_id, target(db).claimed_at], ['publishing', 'c1', null]);
});

test('a post whose targets all settled but is still scheduled is settled by the next tick', async () => {
  const { env, db } = world();
  db.prepare(`UPDATE social_post_targets SET status = 'published', remote_id = 'm1'`).run();
  await dispatchSocial(env, T0 + 30, ORIGIN);
  assert.equal(postStatus(db), 'published');
  assert.ok(actions(db).includes('social.post.published'));
});

test('an unreadable stored token marks the connection broken and tells admins once', async () => {
  const { env, db } = world();
  await connect(env);
  const bad = { ...(env as object), TOKEN_ENC_KEY: Buffer.alloc(32, 9).toString('base64') } as never as Parameters<typeof dispatchSocial>[0];
  await dispatchSocial(bad, T0 + 30, ORIGIN);
  assert.equal(target(db).status, 'waiting_connection');
  assert.equal(mail.sent.filter((m) => /bağlantısı koptu/.test(m.subject) && m.to === 'admin@example.org').length, 1);
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections WHERE platform = 'instagram'`).get() as { last_error_at: number | null }).last_error_at);
});

test('a target re-queued with its container after a long wait is held by lateness; once confirmed, the status read records it published', async () => {
  const { env, db, waits } = world({ at: T0 - 2 * 86400 });
  await connect(env);
  // As after a reconnect: queued, retry clock reset, the container from before the wait kept.
  db.prepare(`UPDATE social_post_targets SET container_id = 'c1', first_tried_at = NULL, attempts = 0`).run();
  const g = stubGraph(graphFlow(['PUBLISHED']));
  try { await dispatchSocial(env, T0, ORIGIN); } finally { g.restore(); }
  await Promise.allSettled(waits);
  assert.equal(g.calls.length, 0, 'no Graph call while a person has not decided');
  assert.deepEqual([target(db).status, target(db).container_id], ['needs_confirmation', 'c1'], 'the container is kept for the status read');
  assert.ok(mail.sent.some((m) => m.to === 'pub@example.org'));

  // Publish anyway: queued again, confirmed.
  db.prepare(`UPDATE social_post_targets SET status = 'queued', confirmed_at = ?`).run(T0 + 60);
  const g2 = stubGraph(graphFlow(['PUBLISHED']));
  try { await dispatchSocial(env, T0 + 90, ORIGIN); } finally { g2.restore(); }
  assert.equal(target(db).status, 'published');
  assert.equal(g2.calls.some((c) => c.path.endsWith('/media_publish')), false, 'never published a second time');
  assert.equal(g2.calls.some((c) => c.method === 'POST'), false, 'no new container either');
  assert.equal(postStatus(db), 'published');
});

test('a container Instagram reports as ERROR fails the target and lets go of it, so the post can be fixed', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET status = 'publishing', container_id = 'c1', first_tried_at = ?`).run(T0);
  const g = stubGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'ERROR', status: 'Error: unsupported' }) : undefined));
  try { await dispatchSocial(env, T0 + 90, ORIGIN); } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).container_id, target(db).last_error], ['failed', null, 'container_error: Error: unsupported']);
  assert.equal(postStatus(db), 'failed');
});
