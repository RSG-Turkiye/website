import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubGraph } from './lib/instagram';
import { onRequestGet as start } from '../functions/api/admin/connections/instagram/start';
import { onRequestGet as gmailStart } from '../functions/api/admin/connections/gmail/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/instagram/callback';
import { getConnection, readAccessToken } from '../functions/_lib/connections';
import { needsRefresh, instagramMe, refreshInstagramToken } from '../functions/_lib/social/instagram';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const KEY = Buffer.alloc(32, 1).toString('base64');

function setup(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, INSTAGRAM_APP_ID: 'app-1', INSTAGRAM_APP_SECRET: 'sec-1', ...extra };
  return { db, env };
}
const get = (h: unknown, url: string, env: unknown) =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(url, { headers: { Cookie: 'rsg_session=s1' } }), env });

async function begin(env: unknown) {
  const res = await get(start, `${BASE}/api/admin/connections/instagram/start`, env);
  assert.equal(res.status, 302);
  return new URL(res.headers.get('Location')!);
}

function instagram(opts: { accountType?: string; permissions?: string; flat?: boolean } = {}) {
  return stubGraph((c) => {
    if (c.host === 'api.instagram.com' && c.path === '/oauth/access_token') {
      const row = { access_token: 'short', user_id: 111, permissions: opts.permissions ?? 'instagram_business_basic,instagram_business_content_publish' };
      return Response.json(opts.flat ? row : { data: [row] });
    }
    if (c.path === '/access_token') return Response.json({ access_token: 'long-1', token_type: 'bearer', expires_in: 5184000 });
    if (c.path === '/me') return Response.json({ user_id: '17841400000000000', id: 'app-scoped', username: 'rsg_test', account_type: opts.accountType ?? 'MEDIA_CREATOR' });
    return undefined;
  });
}

test('start sends the admin to Instagram with both scopes and our callback', async () => {
  const { env } = setup();
  const u = await begin(env);
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'app-1');
  assert.equal(u.searchParams.get('redirect_uri'), `${BASE}/api/admin/connections/instagram/callback`);
  assert.equal(u.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
  assert.ok(u.searchParams.get('state'));
});

test('start without the app credentials says so instead of failing at Instagram', async () => {
  const { env } = setup({ INSTAGRAM_APP_SECRET: undefined });
  const res = await get(start, `${BASE}/api/admin/connections/instagram/start`, env);
  assert.match(res.headers.get('Location')!, /connection_error=not_configured/);
});

test('callback stores a sealed long-lived token under the account id from /me, and re-queues waiting targets', async () => {
  const { env, db } = setup();
  db.prepare(`INSERT INTO social_posts (id, type, created_by, created_at, updated_at, status) VALUES ('p1','image','u1',1,1,'scheduled')`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, claimed_at, first_tried_at, attempts, last_error, confirmed_at) VALUES ('p1','instagram','waiting_connection', 5, 5, 3, 'auth: x', 4)`).run();
  const state = (await begin(env)).searchParams.get('state')!;
  const ig = instagram();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc%23_&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /\/admin\?connected=instagram$/);
    assert.equal(ig.calls[0].params.get('code'), 'abc', 'the #_ suffix is stripped');
    assert.equal(ig.calls[0].params.get('redirect_uri'), `${BASE}/api/admin/connections/instagram/callback`);
  } finally { ig.restore(); }
  const row = (await getConnection(env.DB as never, 'instagram'))!;
  assert.equal(row.account_id, '17841400000000000');
  assert.equal(row.account_name, 'rsg_test');
  assert.ok(row.expires_at! > Math.floor(Date.now() / 1000) + 59 * 86400);
  assert.equal(await readAccessToken(env, row), 'long-1');
  assert.notEqual(row.access_token_enc, 'long-1');
  assert.deepEqual(
    { ...db.prepare(`SELECT status, claimed_at, first_tried_at, attempts, last_error, confirmed_at FROM social_post_targets`).get() as object },
    { status: 'queued', claimed_at: null, first_tried_at: null, attempts: 0, last_error: null, confirmed_at: null },
    'an old confirmation does not let a target that waited days go out unattended',
  );
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.connect'`).get() as { n: number }).n, 1);
});

test('callback accepts the flat token shape too', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const ig = instagram({ flat: true });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /connected=instagram/);
  } finally { ig.restore(); }
});

test('callback refuses a personal account and a grant without publishing', async () => {
  for (const [opts, code] of [[{ accountType: 'PERSONAL' }, 'not_professional'], [{ permissions: 'instagram_business_basic' }, 'missing_scope']] as const) {
    const { env } = setup();
    const state = (await begin(env)).searchParams.get('state')!;
    const ig = instagram(opts);
    try {
      const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
      assert.match(res.headers.get('Location')!, new RegExp(`connection_error=${code}`));
    } finally { ig.restore(); }
    assert.equal(await getConnection(env.DB as never, 'instagram'), null);
  }
});

test('a cancelled authorisation stores nothing', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?error=access_denied&state=${state}`, env);
  assert.match(res.headers.get('Location')!, /connection_error=cancelled/);
  assert.equal(await getConnection(env.DB as never, 'instagram'), null);
});

test('a Gmail state presented at the Instagram callback is refused and stores nothing', async () => {
  const { env } = setup();
  const g = await get(gmailStart, `${BASE}/api/admin/connections/gmail/start`, env);
  const state = new URL(g.headers.get('Location')!).searchParams.get('state')!;
  const ig = instagram();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /connection_error=bad_state/);
    assert.equal(ig.calls.length, 0);
  } finally { ig.restore(); }
  assert.equal(await getConnection(env.DB as never, 'instagram'), null);
});

test('/me failing after a good exchange stores nothing', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const ig = stubGraph((c) => {
    if (c.path === '/oauth/access_token') return Response.json({ data: [{ access_token: 'short', user_id: 111, permissions: 'instagram_business_basic,instagram_business_content_publish' }] });
    if (c.path === '/access_token') return Response.json({ access_token: 'long-1', expires_in: 5184000 });
    if (c.path === '/me') return new Response('{}', { status: 500 });
    return undefined;
  });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /connection_error=token_exchange/);
  } finally { ig.restore(); }
  assert.equal(await getConnection(env.DB as never, 'instagram'), null);
});

test('instagramMe refuses a user_id too large for a JSON number', async () => {
  const ig = stubGraph((c) => c.path === '/me' ? new Response('{"user_id":17841400000000000123,"username":"x","account_type":"CREATOR"}') : undefined);
  try { assert.deepEqual(await instagramMe('t'), { ok: false, status: 200, auth: false }); } finally { ig.restore(); }
});

test('a refresh network error does not leak the token', async () => {
  const before = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('boom https://graph.instagram.com/x?access_token=SECRET'); }) as typeof fetch;
  try {
    const r = await refreshInstagramToken('SECRET');
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.reason === 'network');
  } finally { globalThis.fetch = before; }
});

test('a token is refreshed when under 20 days are left and it is at least a day old', () => {
  const now = 1_800_000_000;
  assert.equal(needsRefresh({ expires_at: now + 19 * 86400, connected_at: now - 40 * 86400 }, now), true);
  assert.equal(needsRefresh({ expires_at: now + 21 * 86400, connected_at: now - 40 * 86400 }, now), false);
  assert.equal(needsRefresh({ expires_at: now + 19 * 86400, connected_at: now - 3600 }, now), false);
  assert.equal(needsRefresh({ expires_at: null, connected_at: now - 40 * 86400 }, now), false);
});
