import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail, KEYS } from './lib/social';
import { stubHttp, type HttpCall } from './lib/http';
import { stubGraph } from './lib/instagram';
import { chooseChannel } from '../functions/_lib/buffer-connect';
import { bufferPublishStep, resetRateMemory, type BufferChannel } from '../functions/_lib/social/buffer';
import { instagramPublishStep } from '../functions/_lib/social/instagram';
import { connectionUpsert, getConnection, connectionStatus } from '../functions/_lib/connections';
import { dmStatus, pollDms } from '../functions/_lib/social-dm-poll';
import { dispatchSocial } from '../functions/_lib/social-dispatcher';
import { onRequestPost as connectInstagram } from '../functions/api/admin/connections/instagram/buffer';
import { onRequestGet as dmList } from '../functions/api/admin/social/dm/index';
import { onRequestGet as dmThread } from '../functions/api/admin/social/dm/[id]';
import { onRequestPost as dmReply } from '../functions/api/admin/social/dm/[id]/reply';
import { onRequestGet as dmDebug } from '../functions/api/admin/social/dm/debug';
import { onRequestPost as refresh } from '../functions/api/admin/social/refresh-tokens';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const NOW = 1_800_000_000;
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); resetRateMemory(); });
afterEach(() => mail.restore());

function world(extra: Record<string, unknown> = { BUFFER_API_KEY: 'buf-key', BUFFER_KEY_EXPIRES: '2027-10-19' }) {
  const s = setupSocial();
  return { ...s, env: { ...(s.env as object), MAIL_SYNC_SECRET: 'tick', ...extra } as never };
}
const DB = (env: unknown) => (env as { DB: D1Database }).DB;
async function viaBuffer(env: unknown, connectedAt = NOW - 86400) {
  await (await connectionUpsert(env as never, 'instagram', {
    accountId: 'ig-chan', accountName: 'rsgturkey', accessToken: null, refreshToken: null, scopes: 'buffer:org1', expiresAt: null, refreshExpiresAt: null,
  }, 'admin', connectedAt)).run();
}
const noInstagram = () => stubGraph((c) => { throw new Error(`no Instagram call expected: ${c.path}`); });

const channel = (id: string, type: string, extra: Partial<BufferChannel> = {}): BufferChannel =>
  ({ id, name: `@${id}`, service: 'instagram', type, organizationId: 'org1', isDisconnected: false, isLocked: false, ...extra });

test('connect choice for Instagram: a professional account, never a personal one; broken ones are not offered', () => {
  assert.deepEqual(chooseChannel('instagram', [channel('me', 'personal'), channel('rsgturkey', 'business')], null), { ok: true, channel: channel('rsgturkey', 'business') });
  assert.equal((chooseChannel('instagram', [channel('a', 'professional'), channel('b', 'creator')], null) as { code: string }).code, 'choose');
  assert.deepEqual(chooseChannel('instagram', [channel('me', 'personal')], null), { ok: false, code: 'no_channel' });
  assert.deepEqual(chooseChannel('instagram', [channel('rsgturkey', 'business', { isLocked: true })], null), { ok: false, code: 'channel_unusable' });
  assert.deepEqual(chooseChannel('instagram', [{ ...channel('li', 'page'), service: 'linkedin' }], null), { ok: false, code: 'no_channel' });
});

test('connect through Buffer saves the Instagram channel', async () => {
  const { env } = world();
  const b = stubHttp(['api.buffer.com'], (c) => {
    const q = String((c.body as { query: string }).query);
    if (q.startsWith('query Orgs')) return Response.json({ data: { account: { organizations: [{ id: 'org1' }] } } });
    if (q.startsWith('query Channels')) return Response.json({ data: { channels: [{ id: 'ig1', name: 'rsgturkey', service: 'instagram', type: 'business' }, { id: 'li1', name: 'RSG', service: 'linkedin', type: 'page' }] } });
    return undefined;
  });
  try {
    const res = await call(connectInstagram, 'POST', '/api/admin/connections/instagram/buffer', { env, as: 'admin', body: {} });
    assert.equal(res.status, 200);
  } finally { b.restore(); }
  const row = (await getConnection(DB(env), 'instagram'))!;
  assert.deepEqual([row.account_id, row.scopes, row.access_token_enc], ['ig1', 'buffer:org1', null]);
});

const img = (n: number) => ({ key: `k${n}.jpg`, url: `${ORIGIN}/api/images/k${n}.jpg`, alt: `Alt ${n}` });
function input(post: PostForPlatform, containerId: string | null = null): PublishInput {
  return { account: { id: 'ig-chan', name: 'rsgturkey', org: 'org1' }, token: 'buf-key', post, state: { containerId }, now: NOW, platform: 'instagram', checkpoint: async () => true };
}
async function created(post: PostForPlatform) {
  let sent: { assets: unknown[]; metadata?: unknown; text: string } | null = null;
  const s = stubHttp(['api.buffer.com'], (c: HttpCall) => {
    sent = (c.body as { variables: { input: typeof sent } }).variables.input;
    return Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'bp1' } } } });
  });
  try { return { result: await bufferPublishStep(input(post)), sent: sent! as { assets: unknown[]; metadata?: unknown; text: string } }; } finally { s.restore(); }
}

test('Instagram through Buffer: an image is a post with one asset, a carousel all of them, a story one image as a story', async () => {
  const image = await created({ type: 'image', caption: 'Merhaba\n\n🔗 Link profilde', media: [img(1)] });
  assert.equal(image.result.kind, 'pending');
  assert.deepEqual(image.sent.metadata, { instagram: { type: 'post', shouldShareToFeed: true } });
  assert.equal(image.sent.assets.length, 1);
  assert.equal(image.sent.text, 'Merhaba\n\n🔗 Link profilde', 'the caption as captionFor made it');

  const carousel = await created({ type: 'carousel', caption: 'Üç görsel', media: [img(1), img(2), img(3)] });
  assert.deepEqual(carousel.sent.metadata, { instagram: { type: 'post', shouldShareToFeed: true } });
  assert.deepEqual(carousel.sent.assets, [1, 2, 3].map((n) => ({ image: { url: `${ORIGIN}/api/images/k${n}.jpg`, metadata: { altText: `Alt ${n}` } } })));

  const story = await created({ type: 'story', caption: '', media: [img(1), img(2)] });
  assert.deepEqual(story.sent.metadata, { instagram: { type: 'story', shouldShareToFeed: true } });
  assert.equal(story.sent.assets.length, 1);

  const s = stubHttp(['api.buffer.com'], () => { throw new Error('no call'); });
  try {
    const eleven = await bufferPublishStep(input({ type: 'carousel', caption: 'x', media: Array.from({ length: 11 }, (_, i) => img(i)) }));
    assert.deepEqual(eleven, { kind: 'fail', reason: 'carousel_count: Instagram takes up to 10 images' });
  } finally { s.restore(); }
});

test('LinkedIn and X still get no Instagram metadata and no stories', async () => {
  const s = stubHttp(['api.buffer.com'], (c: HttpCall) => {
    assert.equal(((c.body as { variables: { input: { metadata?: unknown } } }).variables.input.metadata), undefined);
    return Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'b' } } } });
  });
  try {
    assert.equal((await bufferPublishStep({ ...input({ type: 'image', caption: 'x', media: [img(1)] }), platform: 'linkedin' })).kind, 'pending');
    assert.equal((await bufferPublishStep({ ...input({ type: 'story', caption: 'x', media: [img(1)] }), platform: 'x' })).kind, 'fail');
  } finally { s.restore(); }
});

test('switching to Buffer with a direct Instagram container fails honestly: a publish may have happened', async () => {
  const s = stubHttp(['api.buffer.com'], () => { throw new Error('no call'); });
  try {
    const r = await bufferPublishStep(input({ type: 'image', caption: 'x', media: [img(1)] }, '17895695668004550'));
    assert.equal(r.kind, 'fail');
    assert.match((r as { reason: string }).reason, /^uncertain: an Instagram container from the direct connection/);
    assert.equal((r as { clearContainer?: boolean }).clearContainer, true, 'Retry after a check goes through Buffer');
  } finally { s.restore(); }
});

test('switching back to direct Instagram: a started Buffer state fails, an idle one starts a fresh container', async () => {
  const post: PostForPlatform = { type: 'image', caption: 'x', media: [img(1)] };
  const g = noInstagram();
  try {
    const started = await instagramPublishStep({ igUserId: '1784', token: 'ig', post, state: { containerId: JSON.stringify({ buf: 1, attempt: NOW, first: NOW, postId: null, next: 0, polls: 0 }) } });
    assert.deepEqual(started, { kind: 'fail', reason: 'uncertain: a Buffer post may already have gone out before switching back; check the account, then retry', clearContainer: true });
  } finally { g.restore(); }
  const ok = stubGraph((c) => (c.method === 'POST' && c.path === '/1784/media' ? Response.json({ id: 'c1' }) : undefined));
  try {
    const idle = await instagramPublishStep({ igUserId: '1784', token: 'ig', post, state: { containerId: JSON.stringify({ buf: 1, attempt: null, first: null, postId: null, next: 0, polls: 0 }) } });
    assert.deepEqual(idle, { kind: 'pending', containerId: 'c1', notes: [] });
  } finally { ok.restore(); }
});

test('DMs with Instagram through Buffer: the tab says why, nothing reaches Instagram with the Buffer key, no mail', async () => {
  const { env, db } = world();
  await viaBuffer(env);
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, updated_at) VALUES ('t1','instagram','conv1','p1','ayse',?,?)`).run(NOW - 3600, NOW - 3600);
  const g = noInstagram();
  try {
    assert.equal(await dmStatus(env, NOW), 'via_buffer');
    assert.deepEqual(await pollDms(env, NOW, ORIGIN), { fetched: 0, updated: 0, skipped: 'via_buffer' });
    const list = await (await call(dmList, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).json() as { status: string };
    assert.equal(list.status, 'via_buffer');
    const th = await (await call(dmThread, 'GET', '/api/admin/social/dm/t1', { env, as: 'pub', params: { id: 't1' } })).json() as { error: string };
    assert.equal(th.error, 'connection');
    assert.equal((await call(dmReply, 'POST', '/api/admin/social/dm/t1/reply', { env, as: 'pub', params: { id: 't1' }, body: { text: 'Merhaba' } })).status, 503);
    const dbg = await (await call(dmDebug, 'GET', '/api/admin/social/dm/debug', { env, as: 'admin' })).json() as { token: string };
    assert.equal(dbg.token, 'via_buffer');
  } finally { g.restore(); }
  assert.equal(mail.sent.length, 0);
});

test('the daily job never refreshes an Instagram token for a Buffer row, and checks its Buffer channel instead', async () => {
  const { env } = world();
  const now = Math.floor(Date.now() / 1000);
  await viaBuffer(env, now - 100);
  // A stored end inside the refresh window would have triggered a refresh before.
  await DB(env).prepare(`UPDATE platform_connections SET expires_at = ? WHERE platform = 'instagram'`).bind(now + 5 * 86400).run();
  const g = noInstagram();
  const b = stubHttp(['api.buffer.com'], (c) => {
    const q = String((c.body as { query: string }).query);
    if (q.startsWith('query Orgs')) return Response.json({ data: { account: { organizations: [{ id: 'org1' }] } } });
    return Response.json({ data: { channels: [{ id: 'ig-chan', name: 'rsgturkey', service: 'instagram', type: 'business', isDisconnected: true }] } });
  });
  try {
    const res = await (refresh as (c: unknown) => Promise<Response>)({ request: new Request(`${ORIGIN}/api/admin/social/refresh-tokens`, { method: 'POST', headers: { 'X-Archive-Secret': 'cron-secret' } }), env });
    const body = await res.json() as { refreshed: boolean; buffer: string };
    assert.deepEqual([body.refreshed, body.buffer], [false, 'broken']);
  } finally { b.restore(); g.restore(); }
  assert.match((await getConnection(DB(env), 'instagram'))!.last_error!, /^buffer: the channel is disconnected/);
  assert.equal(mail.sent.filter((m) => /Instagram bağlantısı koptu/.test(m.subject)).length, 1);
});

test('the tick: Instagram through Buffer posts through Buffer; a missing key is reported once, as a Buffer problem', async () => {
  const { env, db } = world();
  await viaBuffer(env);
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?,'["instagram"]',?,'scheduled',1,'ed',1,1)`).run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), NOW);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1','instagram','queued')`).run();
  const g = noInstagram();
  const b = stubHttp(['api.buffer.com'], (c) => {
    const v = (c.body as { variables: { input: { metadata: unknown } } }).variables.input;
    assert.deepEqual(v.metadata, { instagram: { type: 'post', shouldShareToFeed: true } });
    return Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'bp1' } } } });
  });
  try { await dispatchSocial(env as never, NOW + 30, ORIGIN); } finally { b.restore(); g.restore(); }
  assert.equal((db.prepare(`SELECT status FROM social_post_targets`).get() as { status: string }).status, 'publishing');
  assert.equal(mail.sent.length, 0);

  const keyless = world({});
  await viaBuffer(keyless.env);
  const g2 = noInstagram();
  try {
    await dispatchSocial(keyless.env as never, NOW, ORIGIN);
    await dispatchSocial(keyless.env as never, NOW + 60, ORIGIN);
  } finally { g2.restore(); }
  const row = (await getConnection(DB(keyless.env), 'instagram'))!;
  assert.equal(row.last_error, 'buffer: the BUFFER_API_KEY secret is not set');
  assert.equal(connectionStatus(row, NOW + 61), 'broken');
  assert.equal(mail.sent.filter((m) => /Instagram bağlantısı koptu/.test(m.subject)).length, 1, 'once, not every tick');
});
