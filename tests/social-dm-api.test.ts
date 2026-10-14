import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail } from './lib/social';
import { stubGraph } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
import { onRequestGet as list } from '../functions/api/admin/social/dm/index';
import { onRequestGet as thread } from '../functions/api/admin/social/dm/[id]';
import { onRequestPost as reply } from '../functions/api/admin/social/dm/[id]/reply';
import { onRequestPost as refresh } from '../functions/api/admin/social/dm/refresh';
import { onRequestGet as counts } from '../functions/api/admin/counts';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const now = () => Math.floor(Date.now() / 1000);
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

async function world(opts: { connected?: boolean; scopes?: string } = {}) {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never;
  if (opts.connected !== false) {
    await (await connectionUpsert(env, 'instagram', {
      accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null,
      scopes: opts.scopes ?? 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages',
      expiresAt: now() + 50 * 86400, refreshExpiresAt: null,
    }, 'admin', now() - 86400)).run();
  }
  const t = now();
  s.db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, updated_at) VALUES
    ('open1','instagram','convA','555','ayse',?,NULL,?),
    ('old1','instagram','convB','777',NULL,?,NULL,?),
    ('done1','instagram','convC','888','mehmet',?,?,?)`).run(t - 3600, t, t - 30 * 3600, t, t - 7200, t - 60, t);
  return { ...s, env };
}

test('editors and members are refused on every endpoint; publishers and admins are let in', async () => {
  const { env } = await world();
  for (const as of ['ed', 'mem']) {
    assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as })).status, 403, as);
    assert.equal((await call(thread, 'GET', '/api/admin/social/dm/open1', { env, as, params: { id: 'open1' } })).status, 403, as);
    assert.equal((await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as, params: { id: 'open1' }, body: { text: 'x' } })).status, 403, as);
    assert.equal((await call(refresh, 'POST', '/api/admin/social/dm/refresh', { env, as })).status, 403, as);
  }
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env })).status, 401);
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).status, 200);
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as: 'admin' })).status, 200);
});

test('the list: newest first, derived state, the account name; no conversation ids', async () => {
  const { env } = await world();
  const body = await (await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).json() as any;
  assert.equal(body.status, 'ok');
  assert.equal(body.account, 'rsg_test');
  assert.deepEqual(body.threads.map((t: any) => t.id), ['done1', 'open1', 'old1']);
  const byId = Object.fromEntries(body.threads.map((t: any) => [t.id, t]));
  assert.deepEqual([byId.open1.unread, byId.open1.unanswered, byId.open1.expired], [true, true, false]);
  assert.equal(byId.old1.expired, true);
  assert.equal(byId.done1.unanswered, false);
  assert.ok(!JSON.stringify(body).includes('convA'));
});

test('not connected: status says so and the list still answers', async () => {
  const { env } = await world({ connected: false });
  const body = await (await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).json() as any;
  assert.equal(body.status, 'not_connected');
});

test('opening a thread fetches it live and marks it read for everyone', async () => {
  const { env, db } = await world();
  const g = stubGraph((c) => (c.path === '/convA' ? Response.json({ messages: { data: [
    { id: 'm1', created_time: new Date((now() - 3600) * 1000).toISOString().replace('.000Z', '+0000'), from: { id: '555', username: 'ayse' }, message: 'Merhaba <b>' },
  ] } }) : undefined));
  let body: any;
  try { body = await (await call(thread, 'GET', '/api/admin/social/dm/open1', { env, as: 'pub', params: { id: 'open1' } })).json(); } finally { g.restore(); }
  assert.equal(body.messages[0].text, 'Merhaba <b>');
  assert.equal(body.messages[0].mine, false);
  const r = db.prepare(`SELECT read_at, read_by FROM social_dm_threads WHERE id = 'open1'`).get() as { read_at: number; read_by: string };
  assert.ok(r.read_at > 0);
  assert.equal(r.read_by, 'pub');
  assert.equal((await call(thread, 'GET', '/api/admin/social/dm/nope', { env, as: 'pub', params: { id: 'nope' } })).status, 404);
});

test('a reply goes out, is audited without its text, and marks the thread answered', async () => {
  const { env, db } = await world();
  const g = stubGraph((c) => (c.method === 'POST' && c.path === '/me/messages' ? Response.json({ message_id: 'x' }) : undefined));
  let res: Response;
  try { res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: '  Teşekkürler!  ' } }); } finally { g.restore(); }
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(g.calls[0].params.get('message')!).text, 'Teşekkürler!');
  assert.ok((db.prepare(`SELECT last_outbound_at FROM social_dm_threads WHERE id='open1'`).get() as { last_outbound_at: number }).last_outbound_at > 0);
  const audit = db.prepare(`SELECT action, target_id, details FROM audit_log WHERE action = 'social.dm.reply'`).get() as any;
  assert.equal(audit.target_id, 'open1');
  assert.ok(!String(audit.details ?? '').includes('Teşekkürler'));
});

test('reply checks: empty, 1000 bytes of ş allowed, 1001 refused, expired refused without calling Meta', async () => {
  const { env } = await world();
  const g = stubGraph((c) => (c.path === '/me/messages' ? Response.json({ message_id: 'x' }) : undefined));
  try {
    const send = (id: string, text: string) => call(reply, 'POST', `/api/admin/social/dm/${id}/reply`, { env, as: 'pub', params: { id }, body: { text } });
    assert.equal((await (await send('open1', '   ')).json() as any).code, 'empty');
    assert.equal((await send('open1', 'ş'.repeat(500))).status, 200);
    assert.equal((await (await send('open1', 'ş'.repeat(500) + 'a')).json() as any).code, 'too_long');
    const before = g.calls.length;
    const late = await send('old1', 'geç');
    assert.equal(late.status, 409);
    assert.equal((await late.json() as any).code, 'window_closed');
    assert.equal(g.calls.length, before);
  } finally { g.restore(); }
});

test('Meta says the window closed: 409, and the connection is not broken (R3)', async () => {
  const { env, db } = await world();
  const g = stubGraph(() => Response.json({ error: { code: 10, error_subcode: 2534022, message: 'outside window' } }, { status: 400 }));
  let res: Response;
  try { res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: 'x' } }); } finally { g.restore(); }
  assert.equal(res.status, 409);
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as any).last_error, null);
});

test('CSRF: a cross-site reply is refused', async () => {
  const { env } = await world();
  const res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: 'x' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('counts: dm is unread and still answerable, for publishers only', async () => {
  const { env } = await world();
  assert.equal((await (await call(counts, 'GET', '/api/admin/counts', { env, as: 'pub' })).json() as any).dm, 1);
  assert.equal((await (await call(counts, 'GET', '/api/admin/counts', { env, as: 'ed' })).json() as any).dm, undefined);
});

test('refresh runs a forced poll', async () => {
  const { env } = await world();
  const g = stubGraph((c) => (c.path === '/me/conversations' ? Response.json({ data: [] }) : undefined));
  try {
    const res = await call(refresh, 'POST', '/api/admin/social/dm/refresh', { env, as: 'pub' });
    assert.equal(res.status, 200);
    assert.equal(g.calls[0].path, '/me/conversations');
  } finally { g.restore(); }
});

test('without the messaging scope, thread and reply refuse and never touch Meta or the connection (R6)', async () => {
  const { env, db } = await world({ scopes: 'instagram_business_basic,instagram_business_content_publish' });
  const g = stubGraph(() => Response.json({ error: { code: 200, message: 'permission' } }, { status: 403 }));
  try {
    const t = await (await call(thread, 'GET', '/api/admin/social/dm/open1', { env, as: 'pub', params: { id: 'open1' } })).json() as any;
    assert.equal(t.error, 'connection');
    assert.equal(t.messages, null);
    const r = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: 'x' } });
    assert.equal(r.status, 503);
    assert.equal((await r.json() as any).code, 'connection');
    assert.equal(g.calls.length, 0);
  } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as any).last_error, null);
});
