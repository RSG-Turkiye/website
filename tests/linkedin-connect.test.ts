import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { stubHttp } from './lib/http';
import { onRequestGet as start } from '../functions/api/admin/connections/linkedin/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/linkedin/callback';
import { createState } from '../functions/_lib/oauth-state';
import { getConnection, readAccessToken, readRefreshToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
const HOSTS = ['www.linkedin.com', 'api.linkedin.com'];
const ORG = '424242';

function world() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, LINKEDIN_CLIENT_ID: 'cid', LINKEDIN_CLIENT_SECRET: 'csecret', LINKEDIN_ORGANIZATION: 'rsgturkey' };
  return { ...s, env };
}
const linkedin = (scope = 'w_organization_social,r_organization_social,rw_organization_admin', refresh = true) => stubHttp(HOSTS, (c) => {
  if (c.url.pathname === '/oauth/v2/accessToken') {
    return Response.json({ access_token: 'li-access', expires_in: 5184000, scope, ...(refresh ? { refresh_token: 'li-refresh', refresh_token_expires_in: 31536000 } : {}) });
  }
  if (c.url.pathname === '/rest/organizationAcls') return Response.json({ elements: [{ organization: `urn:li:organization:${ORG}`, state: 'APPROVED' }] });
  if (c.url.pathname === `/rest/organizations/${ORG}`) return Response.json({ vanityName: 'rsgturkey', localizedName: 'ISCB-SC RSG-Türkiye' });
  return undefined;
});

test('start: admins only, and it sends the browser to LinkedIn with a state and every scope', async () => {
  const { env } = world();
  assert.equal((await call(start, 'GET', '/api/admin/connections/linkedin/start', { env, as: 'pub' })).status, 403);
  const res = await call(start, 'GET', '/api/admin/connections/linkedin/start?lang=tr', { env, as: 'admin' });
  const to = new URL(res.headers.get('Location')!);
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('scope'), 'w_organization_social r_organization_social rw_organization_admin');
  assert.ok(to.searchParams.get('state'));
});

test('start without the app configured says so instead of failing at LinkedIn', async () => {
  const { env } = world();
  const res = await call(start, 'GET', '/api/admin/connections/linkedin/start', { env: { ...env, LINKEDIN_CLIENT_SECRET: undefined }, as: 'admin' });
  assert.match(res.headers.get('Location')!, /connection_error=not_configured/);
});

test('callback stores the Page, both tokens sealed, and re-queues waiting LinkedIn targets', async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES ('p1','image','x','[]','["linkedin"]',1,'scheduled',1,'ed',1,1)`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1','linkedin','waiting_connection')`).run();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin();
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connected=linkedin$/);
  const row = (await getConnection((env as { DB: D1Database }).DB, 'linkedin'))!;
  assert.equal(row.account_id, ORG);
  assert.equal(row.account_name, 'ISCB-SC RSG-Türkiye');
  assert.equal(await readAccessToken(env, row), 'li-access');
  assert.equal(await readRefreshToken(env, row), 'li-refresh');
  assert.ok(row.refresh_expires_at! > row.expires_at!);
  assert.equal((db.prepare(`SELECT status FROM social_post_targets`).get() as { status: string }).status, 'queued');
});

test('callback refuses a member who does not administer the configured Page, and stores nothing', async () => {
  const { env } = world();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin();
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env: { ...env, LINKEDIN_ORGANIZATION: 'another-page' }, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=not_page_admin/);
  assert.equal(await getConnection((env as { DB: D1Database }).DB, 'linkedin'), null);
});

test('callback refuses a token missing a scope', async () => {
  const { env } = world();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin('w_organization_social');
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=missing_scope/);
  assert.equal(await getConnection((env as { DB: D1Database }).DB, 'linkedin'), null);
});

const DBOF = (env: unknown) => (env as { DB: D1Database }).DB;
const stateFor = (env: unknown, user: string) => createState(DBOF(env), 'linkedin', user, '/admin', Math.floor(Date.now() / 1000));
async function finish(env: unknown, as: string, query: string, stub = linkedin()) {
  try { return (await call(callback, 'GET', `/api/admin/connections/linkedin/callback?${query}`, { env, as })).headers.get('Location')!; } finally { stub.restore(); }
}

test('callback: a state created for another user, or a non-admin session, is refused and stores nothing', async () => {
  const { env } = world();
  assert.match(await finish(env, 'admin', `code=abc&state=${await stateFor(env, 'pub')}`), /connection_error=not_admin/);
  assert.match(await finish(env, 'pub', `code=abc&state=${await stateFor(env, 'pub')}`), /connection_error=not_admin/);
  assert.match(await finish(env, 'ed', `code=abc&state=${await stateFor(env, 'ed')}`), /connection_error=not_admin/);
  assert.equal(await getConnection(DBOF(env), 'linkedin'), null);
});

test('callback: a state works once; a replayed or unknown state is bad_state', async () => {
  const { env } = world();
  const state = await stateFor(env, 'admin');
  assert.match(await finish(env, 'admin', `code=abc&state=${state}`), /connected=linkedin$/);
  assert.match(await finish(env, 'admin', `code=abc&state=${state}`), /connection_error=bad_state/);
  assert.match(await finish(env, 'admin', 'code=abc&state=never-issued'), /connection_error=bad_state/);
  assert.match(await finish(env, 'admin', 'code=abc'), /connection_error=bad_state/);
});

test('callback: the member declining at LinkedIn is cancelled, and nothing is stored', async () => {
  const { env } = world();
  assert.match(await finish(env, 'admin', `error=access_denied&state=${await stateFor(env, 'admin')}`), /connection_error=cancelled/);
  assert.equal(await getConnection(DBOF(env), 'linkedin'), null);
});

test('callback: a failed token exchange is token_exchange, and nothing is stored', async () => {
  const { env } = world();
  const failing = stubHttp(HOSTS, (c) => (c.url.pathname === '/oauth/v2/accessToken' ? new Response('bad', { status: 400 }) : undefined));
  assert.match(await finish(env, 'admin', `code=abc&state=${await stateFor(env, 'admin')}`, failing), /connection_error=token_exchange/);
  assert.equal(await getConnection(DBOF(env), 'linkedin'), null);
});
