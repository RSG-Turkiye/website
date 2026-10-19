import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail } from './lib/social';
import { stubHttp, type HttpCall } from './lib/http';
import { onRequestPost as connectLinkedin } from '../functions/api/admin/connections/linkedin/buffer';
import { onRequestPost as connectX } from '../functions/api/admin/connections/x/buffer';
import { onRequestGet as listConnections } from '../functions/api/admin/connections/index';
import { onRequestPost as refresh, checkBuffer } from '../functions/api/admin/social/refresh-tokens';
import { chooseChannel } from '../functions/_lib/buffer-connect';
import { connectionUpsert, connectionStatus, getConnection, bufferKeyExpiry, markBroken, withLiveExpiry } from '../functions/_lib/connections';
import { onRequestGet as health } from '../functions/api/admin/health';
import { usableToken } from '../functions/_lib/social/tokens';
import type { BufferChannel } from '../functions/_lib/social/buffer';

const KEY_END = '2027-10-19';
const END = Date.UTC(2027, 9, 19) / 1000;
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world(extra: Record<string, unknown> = { BUFFER_API_KEY: 'buf-key', BUFFER_KEY_EXPIRES: KEY_END }) {
  const s = setupSocial();
  return { ...s, env: { ...(s.env as object), ...extra } as never };
}
const DB = (env: unknown) => (env as { DB: D1Database }).DB;

const ch = (id: string, service: string, type: string, extra: Partial<BufferChannel> = {}) =>
  ({ id, name: `${service} ${id}`, displayName: `${service} ${id}`, service, type, isDisconnected: false, isLocked: false, ...extra });
/** Buffer with one organisation and these channels. */
function buffer(channels: unknown[], seen: HttpCall[] = []) {
  return stubHttp(['api.buffer.com'], (c) => {
    seen.push(c);
    const q = String((c.body as { query: string }).query);
    if (q.startsWith('query Orgs')) return Response.json({ data: { account: { organizations: [{ id: 'org1' }] } } });
    if (q.startsWith('query Channels')) return Response.json({ data: { channels } });
    return undefined;
  });
}

test('choosing a channel: the one asked for, the only fitting one, or a list', () => {
  const page = { id: 'p', name: 'RSG Page', service: 'linkedin', type: 'page', organizationId: 'o', isDisconnected: false, isLocked: false };
  const profile = { ...page, id: 'me', type: 'profile' };
  assert.deepEqual(chooseChannel('linkedin', [profile, page], null), { ok: true, channel: page });
  assert.deepEqual(chooseChannel('linkedin', [profile], null), { ok: false, code: 'no_channel' });
  assert.deepEqual(chooseChannel('linkedin', [page, { ...page, id: 'p2', name: 'Other' }], null), { ok: false, code: 'choose', choices: [{ id: 'p', name: 'RSG Page' }, { id: 'p2', name: 'Other' }] });
  assert.deepEqual(chooseChannel('linkedin', [page], 'me'), { ok: false, code: 'unknown_channel' }, 'a profile cannot be forced');
  const down = { ...page, isDisconnected: true };
  const locked = { ...page, id: 'p3', isLocked: true };
  assert.deepEqual(chooseChannel('linkedin', [down, locked], null), { ok: false, code: 'channel_unusable' });
  assert.deepEqual(chooseChannel('linkedin', [down, { ...page, id: 'ok' }], null), { ok: true, channel: { ...page, id: 'ok' } }, 'a broken one is not offered');
  assert.deepEqual(chooseChannel('linkedin', [down], 'p'), { ok: false, code: 'channel_unusable' });
});

test('connect through Buffer saves the LinkedIn Page, never the profile, and re-queues waiting posts', async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO social_posts (id, type, caption, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES ('p1','image','x','["linkedin"]', 100, 'scheduled', 1, 'ed', 1, 1)`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, attempts) VALUES ('p1','linkedin','waiting_connection', 2)`).run();
  const seen: HttpCall[] = [];
  const b = buffer([ch('me', 'linkedin', 'profile'), ch('page1', 'linkedin', 'page'), ch('ig', 'instagram', 'business')], seen);
  try {
    const res = await call(connectLinkedin, 'POST', '/api/admin/connections/linkedin/buffer', { env, as: 'admin', body: {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, platform: 'linkedin', accountName: 'linkedin page1' });
  } finally { b.restore(); }
  assert.equal(seen[0].headers.get('Authorization'), 'Bearer buf-key');
  const row = (await getConnection(DB(env), 'linkedin'))!;
  assert.equal(row.account_id, 'page1');
  assert.equal(row.scopes, 'buffer:org1');
  assert.equal(row.access_token_enc, null, 'the key is never stored');
  assert.equal(row.expires_at, END);
  assert.equal((db.prepare(`SELECT status FROM social_post_targets`).get() as { status: string }).status, 'queued');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.connect' AND target_id = 'linkedin'`).get() as { n: number }).n, 1);
});

test('connect through Buffer: admins only, needs the key, a list when there is a choice, 409 when nothing fits', async () => {
  const { env } = world();
  assert.equal((await call(connectX, 'POST', '/api/admin/connections/x/buffer', { env, as: 'pub', body: {} })).status, 403);
  const bare = world({});
  assert.equal(((await (await call(connectX, 'POST', '/api/admin/connections/x/buffer', { env: bare.env, as: 'admin', body: {} })).json()) as { code: string }).code, 'not_configured');

  const two = buffer([ch('t1', 'twitter', 'profile'), ch('t2', 'twitter', 'profile')]);
  try {
    const res = await call(connectX, 'POST', '/api/admin/connections/x/buffer', { env, as: 'admin', body: {} });
    assert.deepEqual(await res.json(), { choose: [{ id: 't1', name: 'twitter t1' }, { id: 't2', name: 'twitter t2' }] });
    assert.equal(await getConnection(DB(env), 'x'), null, 'nothing saved until one is chosen');
    const picked = await call(connectX, 'POST', '/api/admin/connections/x/buffer', { env, as: 'admin', body: { channelId: 't2' } });
    assert.equal(picked.status, 200);
    assert.equal((await getConnection(DB(env), 'x'))!.account_id, 't2');
  } finally { two.restore(); }

  const none = buffer([ch('ig', 'instagram', 'business')]);
  try {
    const res = await call(connectLinkedin, 'POST', '/api/admin/connections/linkedin/buffer', { env, as: 'admin', body: {} });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, 'no_channel');
  } finally { none.restore(); }

  const locked = buffer([ch('t9', 'twitter', 'profile', { isLocked: true })]);
  try {
    const res = await call(connectX, 'POST', '/api/admin/connections/x/buffer', { env: world().env, as: 'admin', body: {} });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { code: string }).code, 'channel_unusable');
  } finally { locked.restore(); }

  const refused = stubHttp(['api.buffer.com'], () => Response.json({ errors: [{ message: 'bad key', extensions: { code: 'UNAUTHORIZED' } }] }, { status: 401 }));
  try {
    const res = await call(connectLinkedin, 'POST', '/api/admin/connections/linkedin/buffer', { env, as: 'admin', body: {} });
    assert.equal(res.status, 502);
    assert.equal(((await res.json()) as { code: string }).code, 'buffer_auth');
  } finally { refused.restore(); }
});

async function bufferRow(env: unknown, platform: 'linkedin' | 'x', expiresAt: number | null, connectedAt = 100) {
  await (await connectionUpsert(env as never, platform, { accountId: `${platform}-chan`, accountName: 'RSG', accessToken: null, refreshToken: null, scopes: 'buffer:org1', expiresAt, refreshExpiresAt: null }, 'admin', connectedAt)).run();
}

test('a Buffer row counts as connected, hands out the key with its organisation, and never runs X\'s token refresh', async () => {
  const { env } = world();
  await bufferRow(env, 'x', null);
  const row = withLiveExpiry((await getConnection(DB(env), 'x'))!, env as never)!;
  assert.equal(connectionStatus(row, END - 30 * 86400), 'connected');
  assert.equal(connectionStatus(row, END - 10 * 86400), 'expiring', '14 days before the key ends');
  assert.equal(connectionStatus(row, END + 1), 'broken', 'after it');
  const s = stubHttp(['api.x.com'], () => { throw new Error('X must not be called'); });
  try {
    assert.deepEqual(await usableToken(env as never, 'x', END - 30 * 86400), { ok: true, token: 'buf-key', account: { id: 'x-chan', name: 'RSG', org: 'org1' }, via: 'buffer' });
    assert.deepEqual(await usableToken(env as never, 'x', END + 1), { ok: false, why: 'broken' });
  } finally { s.restore(); }
  const keyless = world({});
  await bufferRow(keyless.env, 'x', null);
  assert.deepEqual(await usableToken(keyless.env as never, 'x', END - 30 * 86400), { ok: false, why: 'unreadable', reason: 'buffer: the BUFFER_API_KEY secret is not set' });
});

test('a rotated key counts at once: the end date is read from the variable, not the stored row', async () => {
  const { env } = world({ BUFFER_API_KEY: 'new-key', BUFFER_KEY_EXPIRES: '2028-10-19' });
  await bufferRow(env, 'linkedin', END - 86400, 100);
  const after = END + 86400;
  assert.equal((await usableToken(env as never, 'linkedin', after)).ok, true, 'the stored date has passed, the new one has not');
  const res = await call(listConnections, 'GET', '/api/admin/connections', { env, as: 'admin' });
  const li = ((await res.json()) as { connections: { platform: string; expiresAt: number }[] }).connections.find((c) => c.platform === 'linkedin')!;
  assert.equal(li.expiresAt, Date.UTC(2028, 9, 19) / 1000);
  const banner = await (await call(health, 'GET', '/api/admin/health', { env, as: 'admin' })).json() as { issues: { kind: string; platform?: string }[] };
  assert.ok(!banner.issues.some((i) => i.platform === 'linkedin'), 'no expiring banner for a key with a year left');
});

test('the key end date is read from BUFFER_KEY_EXPIRES, and only a real date counts', () => {
  assert.equal(bufferKeyExpiry({ BUFFER_KEY_EXPIRES: KEY_END }), END);
  assert.equal(bufferKeyExpiry({ BUFFER_KEY_EXPIRES: 'next year' }), null);
  assert.equal(bufferKeyExpiry({}), null);
});

test('the Connections list says a row goes through Buffer and lets it be disconnected', async () => {
  const { env } = world();
  await bufferRow(env, 'linkedin', END);
  const res = await call(listConnections, 'GET', '/api/admin/connections', { env, as: 'admin' });
  const { connections } = await res.json() as { connections: { platform: string; via: string | null; hasStoredToken: boolean; status: string; expiresAt: number | null }[] };
  const li = connections.find((c) => c.platform === 'linkedin')!;
  assert.equal(li.via, 'buffer');
  assert.equal(li.hasStoredToken, true);
  assert.equal(li.expiresAt, END);
  assert.equal(connections.find((c) => c.platform === 'instagram')!.via, null);
});

test('daily: a channel disconnected in Buffer breaks its connection and mails the admins once', async () => {
  const { env } = world();
  const now = Math.floor(Date.now() / 1000);
  await bufferRow(env, 'linkedin', END);
  await bufferRow(env, 'x', END);
  const seen: HttpCall[] = [];
  const b = buffer([ch('linkedin-chan', 'linkedin', 'page', { isDisconnected: true }), ch('x-chan', 'twitter', 'profile')], seen);
  try {
    assert.equal(await checkBuffer(env as never, now, 'https://rsg-turkiye.iscbsc.org/admin'), 'broken');
    assert.equal(await checkBuffer(env as never, now + 60, 'https://rsg-turkiye.iscbsc.org/admin'), 'broken');
  } finally { b.restore(); }
  assert.equal(seen.filter((c) => String((c.body as { query: string }).query).startsWith('query Channels')).length, 2, 'one channels call a day');
  assert.equal(connectionStatus((await getConnection(DB(env), 'linkedin'))!, now + 61), 'broken');
  assert.equal(connectionStatus((await getConnection(DB(env), 'x'))!, now + 61), 'connected');
  assert.equal(mail.sent.filter((m) => /LinkedIn bağlantısı koptu/.test(m.subject)).length, 1, 'mailed once');
});

test('daily: a connection broken for another reason (an auth refusal on publish) is not healed by a healthy channel', async () => {
  const { env } = world();
  const now = Math.floor(Date.now() / 1000);
  await bufferRow(env, 'x', END, now - 100);
  await markBroken(DB(env), 'x', 'auth: Not authorized', now - 50);
  const b = buffer([ch('x-chan', 'twitter', 'profile')]);
  try { await checkBuffer(env as never, now, 'p'); } finally { b.restore(); }
  assert.equal(connectionStatus((await getConnection(DB(env), 'x'))!, now), 'broken');
});

test('daily: a refused key (FORBIDDEN, as the publish step reads it) breaks every Buffer connection', async () => {
  const { env } = world();
  const now = Math.floor(Date.now() / 1000);
  await bufferRow(env, 'linkedin', END, now - 100);
  const b = stubHttp(['api.buffer.com'], () => Response.json({ data: null, errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] }));
  try { assert.equal(await checkBuffer(env as never, now, 'p'), 'broken'); } finally { b.restore(); }
  assert.match((await getConnection(DB(env), 'linkedin'))!.last_error!, /^buffer: Buffer refused the key/);
});

test('daily: a channel healthy again is marked working and its waiting posts re-queued', async () => {
  const { env, db } = world();
  const now = Math.floor(Date.now() / 1000);
  await bufferRow(env, 'linkedin', END, now - 100);
  await markBroken(DB(env), 'linkedin', 'buffer: disconnected', now - 50);
  db.prepare(`INSERT INTO social_posts (id, type, caption, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES ('p1','image','x','["linkedin"]', 100, 'scheduled', 1, 'ed', 1, 1)`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, attempts) VALUES ('p1','linkedin','waiting_connection', 0)`).run();
  const b = buffer([ch('linkedin-chan', 'linkedin', 'page')]);
  try { assert.equal(await checkBuffer(env as never, now, 'p'), 'ok'); } finally { b.restore(); }
  assert.equal(connectionStatus((await getConnection(DB(env), 'linkedin'))!, now), 'connected');
  assert.equal((db.prepare(`SELECT status FROM social_post_targets`).get() as { status: string }).status, 'queued');
  assert.equal(mail.sent.length, 0);
});

test('daily: the admins are reminded 30, 14 and 3 days before the key ends', async () => {
  const { env, db } = world();
  await bufferRow(env, 'x', null);
  const b = buffer([ch('x-chan', 'twitter', 'profile')]);
  try {
    for (const days of [31, 30, 29, 14, 3]) {
      const before = mail.sent.length;
      const result = await checkBuffer(env as never, END - days * 86400, 'p');
      const reminded = mail.sent.length > before;
      assert.equal(reminded, [30, 14, 3].includes(days), `day ${days}`);
      if (reminded) {
        assert.equal(result, 'reminded');
        assert.match(mail.sent.at(-1)!.subject, /Buffer API/);
      }
    }
  } finally { b.restore(); }
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.expiry_reminder' AND target_id = 'buffer'`).get() as { n: number }).n, 3);
});

test('daily: no Buffer connection, no Buffer call; the cron reports it', async () => {
  const { env } = world();
  const b = stubHttp(['api.buffer.com'], () => { throw new Error('Buffer must not be called'); });
  try {
    const res = await (refresh as (c: unknown) => Promise<Response>)({ request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/social/refresh-tokens', { method: 'POST', headers: { 'X-Archive-Secret': 'cron-secret' } }), env });
    assert.equal(((await res.json()) as { buffer: string }).buffer, 'none');
  } finally { b.restore(); }
});
