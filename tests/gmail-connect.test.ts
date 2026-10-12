import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestGet as start } from '../functions/api/admin/connections/gmail/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/gmail/callback';
import { getConnection, readRefreshToken } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const KEY = Buffer.alloc(32, 1).toString('base64');
const SCOPE = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

function setup(isAdmin = 1) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',?,1,1)`).run(isAdmin);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u2','g2','other@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1),('s2','u2',4000000000,1)`).run();
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', RSG_MAIL_FROM: 'turkey.rsg@gmail.com' };
  return { db, env };
}
const get = (h: unknown, url: string, env: unknown, session = 's1') =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(url, { headers: { Cookie: `rsg_session=${session}` } }), env });

async function begin(env: unknown, lang = '') {
  const res = await get(start, `${BASE}/api/admin/connections/gmail/start${lang}`, env);
  assert.equal(res.status, 302);
  return new URL(res.headers.get('Location')!);
}

function stubGoogle(opts: { email?: string; refresh?: boolean; scope?: string; exchangeStatus?: number } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (opts.exchangeStatus) return new Response('nope', { status: opts.exchangeStatus });
      return Response.json({ access_token: 'at', expires_in: 3600, scope: opts.scope ?? SCOPE, ...(opts.refresh === false ? {} : { refresh_token: 'rt-new' }) });
    }
    if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
      return Response.json({ email: opts.email ?? 'turkey.rsg@gmail.com', email_verified: true });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('', { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('start sends the admin to Google with offline access, consent and the RSG account hinted', async () => {
  const { env } = setup();
  const google = await begin(env);
  assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(google.searchParams.get('access_type'), 'offline');
  assert.equal(google.searchParams.get('prompt'), 'consent');
  assert.equal(google.searchParams.get('login_hint'), 'turkey.rsg@gmail.com');
  assert.equal(google.searchParams.get('redirect_uri'), `${BASE}/api/admin/connections/gmail/callback`);
  assert.match(google.searchParams.get('scope')!, /gmail\.send/);
  assert.ok(google.searchParams.get('state')!.length >= 32);
});

test('start is admin-only', async () => {
  const { env } = setup(0);
  assert.equal((await get(start, `${BASE}/api/admin/connections/gmail/start`, env)).status, 403);
});

test('the happy path stores the sealed token, logs it, and returns to the panel', async () => {
  const { env, db } = setup();
  const state = (await begin(env, '?lang=tr')).searchParams.get('state')!;
  const g = stubGoogle();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    assert.equal(res.headers.get('Location'), `${BASE}/tr/admin?connected=gmail`);
    const row = (await getConnection(env.DB, 'gmail'))!;
    assert.equal(await readRefreshToken(env, row), 'rt-new');
    assert.equal(row.account_name, 'turkey.rsg@gmail.com');
    const actions = (db.prepare('SELECT action FROM audit_log ORDER BY seq').all() as { action: string }[]).map((r) => r.action);
    assert.deepEqual(actions, ['connection.start', 'connection.connect']);
  } finally { g.restore(); }
});

test('a callback replayed after success finds no state', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const g = stubGoogle();
  try {
    await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    const again = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    assert.equal(again.headers.get('Location'), `${BASE}/admin?connection_error=bad_state`);
  } finally { g.restore(); }
});

test('an expired state is refused', async () => {
  const { env, db } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  db.prepare('UPDATE oauth_states SET expires_at = 1').run();
  const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
  assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=bad_state`);
});

test('a state started by one admin cannot be finished by another', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env, 's2');
  assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=not_admin`);
});

test('the wrong Google account is refused, revoked, and the working connection is untouched', async () => {
  const { env, db } = setup();
  const s1 = (await begin(env)).searchParams.get('state')!;
  let g = stubGoogle();
  await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${s1}`, env);
  g.restore();
  const s2 = (await begin(env)).searchParams.get('state')!;
  g = stubGoogle({ email: 'someone.personal@example.org' });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${s2}`, env);
    assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=wrong_account`);
    assert.ok(g.calls.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke')));
    assert.equal(await readRefreshToken(env, (await getConnection(env.DB, 'gmail'))!), 'rt-new');
    const last = db.prepare('SELECT action, details FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { action: string; details: string };
    assert.equal(last.action, 'connection.rejected');
    assert.equal(JSON.parse(last.details).account, 'someone.personal@example.org');
  } finally { g.restore(); }
});

test('a failed userinfo call or a missing email is wrong_account, revoked, nothing stored', async () => {
  for (const mode of ['not-ok', 'no-email'] as const) {
    const { env } = setup();
    const state = (await begin(env)).searchParams.get('state')!;
    const g = stubGoogle();
    const inner = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
        return mode === 'not-ok' ? new Response('no', { status: 500 }) : Response.json({});
      }
      return inner(input, init);
    }) as typeof fetch;
    try {
      const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
      assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=wrong_account`, mode);
      assert.equal(await getConnection(env.DB, 'gmail'), null, mode);
      assert.ok(g.calls.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke')), mode);
    } finally { g.restore(); }
  }
});

test('the account check ignores letter case', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const g = stubGoogle({ email: 'Turkey.RSG@gmail.com' });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    assert.equal(res.headers.get('Location'), `${BASE}/admin?connected=gmail`);
  } finally { g.restore(); }
});

test('a grant that cannot be stored is revoked, audited and reported as store_failed', async () => {
  const { env, db } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const broken = { ...env, TOKEN_ENC_KEY: undefined };
  const g = stubGoogle();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, broken);
    assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=store_failed`);
    assert.equal(await getConnection(env.DB, 'gmail'), null);
    assert.ok(g.calls.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke')));
    const last = db.prepare('SELECT action, details FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { action: string; details: string };
    assert.equal(last.action, 'connection.rejected');
    assert.equal(JSON.parse(last.details).reason, 'store_failed');
  } finally { g.restore(); }
});

test('start without TOKEN_ENC_KEY goes back to the panel and never reaches Google', async () => {
  const { env } = setup();
  const res = await get(start, `${BASE}/api/admin/connections/gmail/start?lang=tr`, { ...env, TOKEN_ENC_KEY: undefined });
  assert.equal(res.headers.get('Location'), `${BASE}/tr/admin?connection_error=store_failed`);
});

test('no refresh token, missing scope, failed exchange and a cancelled consent each say why', async () => {
  const cases: [Parameters<typeof stubGoogle>[0], string, string][] = [
    [{ refresh: false }, 'code=c', 'no_refresh_token'],
    [{ scope: 'openid email https://www.googleapis.com/auth/gmail.send' }, 'code=c', 'missing_scope'],
    [{ exchangeStatus: 400 }, 'code=c', 'token_exchange'],
    [{}, 'error=access_denied', 'cancelled'],
  ];
  for (const [opts, query, code] of cases) {
    const { env } = setup();
    const state = (await begin(env)).searchParams.get('state')!;
    const g = stubGoogle(opts);
    try {
      const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?${query}&state=${state}`, env);
      assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=${code}`, code);
      assert.equal(await getConnection(env.DB, 'gmail'), null, code);
    } finally { g.restore(); }
  }
});
