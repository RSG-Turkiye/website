import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { stubHttp } from './lib/http';
import { onRequestGet as start } from '../functions/api/admin/connections/x/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/x/callback';
import { pkceVerifier, pkceChallenge } from '../functions/_lib/social/x';
import { createState } from '../functions/_lib/oauth-state';
import { getConnection, readAccessToken, readRefreshToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
const SCOPE = 'tweet.read tweet.write users.read media.write offline.access';
function world() {
  const s = setupSocial();
  return { ...s, env: { ...(s.env as object), TOKEN_ENC_KEY: KEY, X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret' } };
}

test('start sends the admin to X with a PKCE challenge derived from the state', async () => {
  const { env } = world();
  const res = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const to = new URL(res.headers.get('Location')!);
  assert.equal(to.origin + to.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const state = to.searchParams.get('state')!;
  assert.equal(to.searchParams.get('code_challenge'), await pkceChallenge(await pkceVerifier('xsecret', state)));
  assert.equal(to.searchParams.get('scope'), SCOPE);
});

test('start: admins only, and an unconfigured app is said so', async () => {
  const { env } = world();
  assert.equal((await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'pub' })).status, 403);
  const res = await call(start, 'GET', '/api/admin/connections/x/start', { env: { ...env, X_CLIENT_SECRET: undefined }, as: 'admin' });
  assert.match(res.headers.get('Location')!, /connection_error=not_configured/);
});

test('callback exchanges the code with the same verifier and stores the account with both tokens', async () => {
  const { env } = world();
  const res0 = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const state = new URL(res0.headers.get('Location')!).searchParams.get('state')!;
  const g = stubHttp(['api.x.com'], (c) => {
    if (c.url.pathname === '/2/oauth2/token') {
      return Response.json({ access_token: 'xa', refresh_token: 'xr', expires_in: 7200, scope: SCOPE });
    }
    if (c.url.pathname === '/2/users/me') return Response.json({ data: { id: '77', username: 'rsgturkey', name: 'RSG' } });
    return undefined;
  });
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/x/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connected=x$/);
  const tokenCall = g.calls.find((c) => c.url.pathname === '/2/oauth2/token')!;
  assert.equal((tokenCall.body as URLSearchParams).get('code_verifier'), await pkceVerifier('xsecret', state));
  const row = (await getConnection((env as { DB: D1Database }).DB, 'x'))!;
  assert.deepEqual([row.account_id, row.account_name], ['77', 'rsgturkey']);
  assert.equal(await readAccessToken(env, row), 'xa');
  assert.equal(await readRefreshToken(env, row), 'xr');
});

test('callback without a refresh token is refused: X would stop working in two hours', async () => {
  const { env } = world();
  const res0 = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const state = new URL(res0.headers.get('Location')!).searchParams.get('state')!;
  const g = stubHttp(['api.x.com'], (c) => (c.url.pathname === '/2/oauth2/token'
    ? Response.json({ access_token: 'xa', expires_in: 7200, scope: SCOPE })
    : Response.json({ data: { id: '77', username: 'rsgturkey' } })));
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/x/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=no_refresh_token/);
  assert.equal(await getConnection((env as { DB: D1Database }).DB, 'x'), null);
});

const HOSTS = ['api.x.com'];
const okX = () => stubHttp(HOSTS, (c) => (c.url.pathname === '/2/oauth2/token'
  ? Response.json({ access_token: 'xa', refresh_token: 'xr', expires_in: 7200, scope: SCOPE })
  : Response.json({ data: { id: '77', username: 'rsgturkey' } })));
const DBOF = (env: unknown) => (env as { DB: D1Database }).DB;
const stateFor = (env: unknown, user: string) => createState(DBOF(env), 'x', user, '/admin', Math.floor(Date.now() / 1000));
async function finish(env: unknown, as: string, query: string, stub = okX()) {
  try { return (await call(callback, 'GET', `/api/admin/connections/x/callback?${query}`, { env, as })).headers.get('Location')!; } finally { stub.restore(); }
}

test('callback: a state created for another user, or a non-admin session, is refused and stores nothing', async () => {
  const { env } = world();
  assert.match(await finish(env, 'admin', `code=abc&state=${await stateFor(env, 'pub')}`), /connection_error=not_admin/);
  assert.match(await finish(env, 'pub', `code=abc&state=${await stateFor(env, 'pub')}`), /connection_error=not_admin/);
  assert.match(await finish(env, 'ed', `code=abc&state=${await stateFor(env, 'ed')}`), /connection_error=not_admin/);
  assert.equal(await getConnection(DBOF(env), 'x'), null);
});

test('callback: a state works once; a replayed or unknown state is bad_state', async () => {
  const { env } = world();
  const state = await stateFor(env, 'admin');
  assert.match(await finish(env, 'admin', `code=abc&state=${state}`), /connected=x$/);
  assert.match(await finish(env, 'admin', `code=abc&state=${state}`), /connection_error=bad_state/);
  assert.match(await finish(env, 'admin', 'code=abc&state=never-issued'), /connection_error=bad_state/);
  assert.match(await finish(env, 'admin', 'code=abc'), /connection_error=bad_state/);
});

test('callback: the member declining at X is cancelled, and nothing is stored', async () => {
  const { env } = world();
  assert.match(await finish(env, 'admin', `error=access_denied&state=${await stateFor(env, 'admin')}`), /connection_error=cancelled/);
  assert.equal(await getConnection(DBOF(env), 'x'), null);
});

test('callback: a failed token exchange is token_exchange, and nothing is stored', async () => {
  const { env } = world();
  const failing = stubHttp(HOSTS, (c) => (c.url.pathname === '/2/oauth2/token' ? new Response('bad', { status: 400 }) : undefined));
  assert.match(await finish(env, 'admin', `code=abc&state=${await stateFor(env, 'admin')}`, failing), /connection_error=token_exchange/);
  assert.equal(await getConnection(DBOF(env), 'x'), null);
});

test('callback: a token missing a scope is refused, and nothing is stored', async () => {
  const { env } = world();
  const narrow = stubHttp(HOSTS, () => Response.json({ access_token: 'xa', refresh_token: 'xr', expires_in: 7200, scope: 'tweet.read' }));
  assert.match(await finish(env, 'admin', `code=abc&state=${await stateFor(env, 'admin')}`, narrow), /connection_error=missing_scope/);
  assert.equal(await getConnection(DBOF(env), 'x'), null);
});
