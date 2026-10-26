// OAuth end to end (plan 6, Task 8): each client shape walks the real
// handlers in-process, from the 401 at /api/mcp through discovery, sign-in,
// consent, the token exchange and a tool call, to a refresh and a disconnect.
// A real SQLite copy of the D1 schema; a fake GitHub and the clients' own
// metadata documents behind global.fetch. Nothing leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { grantRole, revokeRole } from '../functions/_lib/role-grants';
import { agentGroupRights, authenticateAgent } from '../functions/_lib/agent-tokens';
import { ISSUER, MCP_RESOURCE, PRM_URL } from '../functions/_lib/oauth-config';
import * as prm from '../functions/.well-known/oauth-protected-resource/api/mcp';
import * as asMeta from '../functions/.well-known/oauth-authorization-server';
import * as authorize from '../functions/oauth/authorize';
import * as token from '../functions/oauth/token';
import * as register from '../functions/oauth/register';
import * as mcp from '../functions/api/mcp';
import * as tokensApi from '../functions/api/agent-tokens/index';
import * as tokenApi from '../functions/api/agent-tokens/[id]';
import * as approve from '../functions/api/cms/drafts/[id]/approve';
import { onRequest as middleware } from '../functions/api/_middleware';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const NOW = Math.floor(Date.now() / 1000);
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const AREA = 'cms.etkinlikler';

// --- the outside world -------------------------------------------------------

const CLIENTS: Record<string, { client_name: string; redirect_uris: string[] }> = {
  'https://claude.example/oauth/client.json': { client_name: 'Claude', redirect_uris: ['https://claude.example/api/mcp/auth_callback'] },
  'https://chatgpt.example/oauth/client.json': { client_name: 'ChatGPT', redirect_uris: ['https://chatgpt.example/connector_platform_oauth_redirect'] },
};
const FILE_PATH = 'src/content/events/fixture-meetup-2026.json';
const FILES: Record<string, string> = {
  [FILE_PATH]: `${JSON.stringify({ id: 'fixture-meetup-2026', type: 'meetup', start: '2026-03-06', title: { en: 'Fixture meetup', tr: 'Örnek buluşma' }, when: { en: '6 March 2026', tr: '6 Mart 2026' }, location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'A meetup.', tr: 'Bir buluşma.' } }, null, 2)}\n`,
};
const INDEX = buildCmsIndex(FILES);
const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input instanceof Request ? input.url : input));
  const doc = CLIENTS[url.href];
  if (doc) {
    return new Response(JSON.stringify({ client_id: url.href, token_endpoint_auth_method: 'none', ...doc }), { headers: { 'Content-Type': 'application/json' } });
  }
  if ((init?.method ?? 'GET') === 'GET' && url.pathname.includes('/contents/')) {
    const content = FILES[decodeURIComponent(url.pathname.split('/contents/')[1])];
    if (content === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ sha: blobSha(content), content: Buffer.from(content).toString('base64'), encoding: 'base64' }));
  }
  throw new Error(`unexpected fetch in tests: ${url}`);
}) as never;

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const DB = d1(db) as never as D1Database;
  // 'ed' edits Etkinlikler; 'approver' also approves it (and so must still never approve through a connection).
  for (const id of ['ed', 'approver']) {
    db.prepare(`INSERT INTO users (id, google_id, email, is_member, created_at, last_login) VALUES (?, ?, ?, 1, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
    await grantRole(DB, { userId: id, role: 'content.etkinlikler.edit', expiresAt: null, by: null }, NOW - 100);
  }
  await grantRole(DB, { userId: 'approver', role: 'content.etkinlikler.approve', expiresAt: null, by: null }, NOW - 100);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('boss', 'g-boss', 'boss@example.org', 1, 1, 1)`).run();
  const assets = { fetch: async (r: Request) => new URL(r.url).pathname === '/cms-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 }) };
  const env = { DB, GITHUB_PAT: 'unused', ASSETS: assets } as never;
  return { db, DB, env };
}
type Env = Awaited<ReturnType<typeof setup>>['env'];

const ctx = (request: Request, env: Env) => ({ request, env, params: {}, waitUntil() {}, data: {} });
type Handler = (c: unknown) => Response | Promise<Response>;
const run = (h: unknown, request: Request, env: Env, params: Record<string, string> = {}) => (h as Handler)({ ...ctx(request, env), params });
const cookie = (who: string | null) => (who ? { Cookie: `rsg_session=s-${who}` } : {});

const mcpPost = (env: Env, access: string | null, message: unknown) => run(mcp.onRequestPost, new Request(`${BASE}/api/mcp`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(access ? { Authorization: `Bearer ${access}` } : {}) },
  body: JSON.stringify(message),
}), env);
let rpcId = 1;
const rpc = async (env: Env, access: string, method: string, params?: unknown) => {
  const res = await mcpPost(env, access, { jsonrpc: '2.0', id: rpcId++, method, ...(params === undefined ? {} : { params }) });
  return { status: res.status, res, body: res.status === 200 ? await res.json() as any : null };
};
const toolNames = async (env: Env, access: string) => ((await rpc(env, access, 'tools/list')).body.result.tools as { name: string }[]).map((t) => t.name).sort();
const callTool = async (env: Env, access: string, name: string, args: Record<string, unknown>) => {
  const { body } = await rpc(env, access, 'tools/call', { name, arguments: args });
  assert.ok(body.result, JSON.stringify(body));
  assert.equal(body.result.isError, undefined, JSON.stringify(body.result));
  return JSON.parse(body.result.content[0].text);
};

const newEvent = () => ({
  id: 'meetup-ankara-2027', type: 'meetup', start: '2027-03-06',
  title: { en: 'Ankara meetup', tr: 'Ankara buluşması' }, when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'An evening meetup.', tr: 'Bir akşam buluşması.' },
});

// --- the OAuth steps ---------------------------------------------------------

const authorizeUrl = (clientId: string, redirect: string, state = 'st-1') => `${BASE}/oauth/authorize?${new URLSearchParams({
  response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: CHALLENGE, code_challenge_method: 'S256',
  state, scope: `${AREA}:draft`, resource: MCP_RESOURCE,
})}`;

/** GET authorize (signed in) and the Allow POST the page would send; returns the redirect's query. */
async function consent(env: Env, who: string, clientId: string, redirect: string, scopes = [[AREA, 'draft']]) {
  const url = authorizeUrl(clientId, redirect);
  const page = await run(authorize.onRequestGet, new Request(url, { headers: cookie(who) }), env);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes('name="action" value="allow"'), 'the consent page offers Allow');
  const form = new URLSearchParams(new URL(url).searchParams);
  form.set('action', 'allow');
  form.set('days', '30');
  for (const [area, level] of scopes) { form.append('area', area); form.set(`level_${area}`, level); }
  const res = await run(authorize.onRequestPost, new Request(`${BASE}/oauth/authorize`, {
    method: 'POST', body: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...cookie(who) },
  }), env);
  assert.equal(res.status, 303, 'Allow is a 303, never a 307');
  const back = new URL(res.headers.get('Location')!);
  assert.ok(back.href.startsWith(redirect), `back to ${redirect}: ${back.href}`);
  assert.equal(back.searchParams.get('state'), 'st-1');
  assert.ok(back.searchParams.get('code'), 'a code');
  return { html, query: back.searchParams, redirectUrl: back };
}

async function exchange(env: Env, params: Record<string, string>, headers: Record<string, string> = {}) {
  return run(token.onRequestPost, new Request(`${BASE}/oauth/token`, {
    method: 'POST', body: new URLSearchParams(params), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.5', ...headers },
  }), env);
}
type Pair = { access_token: string; refresh_token: string; expires_in: number; token_type: string; scope: string };
const codeParams = (code: string, clientId: string, redirect: string) => ({
  grant_type: 'authorization_code', code, redirect_uri: redirect, code_verifier: VERIFIER, resource: MCP_RESOURCE, client_id: clientId,
});

const connectionRow = (db: DatabaseSync, id: string) => db.prepare('SELECT id, user_id, kind, label, scopes, client_id, revoked_at, expires_at FROM agent_tokens WHERE id = ?').get(id) as Record<string, unknown> | undefined;

/** One MCP session with a connection from first contact to disconnect: the walk both CIMD shapes share. */
async function walk(clientId: string, redirect: string, name: string) {
  const { db, env } = await setup();

  // 1. No token: 401 naming the metadata document.
  const bare = await mcpPost(env, null, { jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(bare.status, 401);
  assert.equal(bare.headers.get('WWW-Authenticate'), `Bearer resource_metadata="${PRM_URL}"`);
  assert.equal(PRM_URL, `${ISSUER}/.well-known/oauth-protected-resource/api/mcp`);

  // 2. That document, then the authorization server's.
  const resource = await (await run(prm.onRequestGet, new Request(PRM_URL), env)).json() as Record<string, unknown>;
  assert.equal(resource.resource, MCP_RESOURCE);
  assert.deepEqual(resource.authorization_servers, [ISSUER]);
  const meta = await (await run(asMeta.onRequestGet, new Request(`${BASE}/.well-known/oauth-authorization-server`), env)).json() as Record<string, any>;
  assert.equal(meta.issuer, ISSUER);
  assert.equal(meta.client_id_metadata_document_supported, true);
  assert.equal(meta.authorization_endpoint, `${BASE}/oauth/authorize`);
  assert.equal(meta.token_endpoint, `${BASE}/oauth/token`);

  // 3. Signed out the authorize URL sends the member to sign in, carrying the whole request.
  const out = await run(authorize.onRequestGet, new Request(authorizeUrl(clientId, redirect)), env);
  assert.equal(out.status, 302);
  const login = new URL(out.headers.get('Location')!, BASE);
  assert.equal(login.pathname, '/auth/login');
  assert.ok(login.searchParams.get('next')!.startsWith('/oauth/authorize?'));

  // 4. Signed in: consent, then Allow.
  const { html, query } = await consent(env, 'ed', clientId, redirect);
  assert.ok(html.includes(name), 'the page names the app');
  assert.equal(query.get('iss'), meta.issuer, 'iss in the redirect is the metadata issuer');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get()!.n, 1, 'Allow wrote one code');

  // 5. The code becomes a connection.
  const res = await exchange(env, codeParams(query.get('code')!, clientId, redirect));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const pair = await res.json() as Pair;
  assert.equal(pair.token_type, 'Bearer');
  assert.equal(pair.scope, `${AREA}:draft`);
  assert.match(pair.access_token, /^rsg_oat_/);
  const connection = db.prepare("SELECT id FROM agent_tokens WHERE kind = 'oauth'").get() as { id: string };
  assert.ok(pair.refresh_token.startsWith(`rsg_ort_${connection.id}.`));
  assert.equal(connectionRow(db, connection.id)!.label, `${name} (${new URL(clientId).hostname})`, 'the label is the one the consent screen stored');
  assert.equal(connectionRow(db, connection.id)!.client_id, clientId);

  // 6. A session at /api/mcp, ending in a draft.
  const init = await rpc(env, pair.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } });
  assert.equal(init.status, 200);
  assert.equal(init.body.result.serverInfo.name, 'rsg-turkiye');
  const tools = await toolNames(env, pair.access_token);
  assert.ok(tools.includes('cms_create_draft') && tools.includes('cms_submit_draft'), tools.join(','));
  assert.ok(tools.every((t) => t.startsWith('cms_')), 'only the consented area');
  const created = await callTool(env, pair.access_token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(created.draft.by_agent, true);
  const draftId = created.draft.id as string;
  assert.equal(db.prepare('SELECT agent_token_id FROM content_drafts WHERE id = ?').get(draftId)!.agent_token_id, connection.id);
  const audit = db.prepare("SELECT user_id, details FROM audit_log WHERE action = 'cms.draft.create'").get() as { user_id: string; details: string };
  assert.equal(audit.user_id, 'ed', 'in the member\'s name');
  assert.equal(JSON.parse(audit.details).agent_token, connection.id, 'the audit row carries the connection\'s id');
  assert.equal(JSON.parse(audit.details).via, 'agent');

  // 7. Losing the role takes the tools away at once; the connection itself is untouched.
  const before = connectionRow(db, connection.id);
  await revokeRole(env.DB as D1Database, { userId: 'ed', role: 'content.etkinlikler.edit', by: 'boss' }, Math.floor(Date.now() / 1000));
  const bare2 = await toolNames(env, pair.access_token).catch((e) => String(e));
  assert.ok(Array.isArray(bare2) && !bare2.some((t) => t.startsWith('cms_')), `no cms_ tool left: ${bare2}`);
  assert.deepEqual(connectionRow(db, connection.id), before, 'the connection row is unchanged');
  await grantRole(env.DB as D1Database, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: null, by: null }, Math.floor(Date.now() / 1000));
  assert.ok((await toolNames(env, pair.access_token)).includes('cms_create_draft'), 'granted again, the tools are back');

  // 8. Refresh rotates the pair in place.
  const refreshed = await exchange(env, { grant_type: 'refresh_token', refresh_token: pair.refresh_token, resource: MCP_RESOURCE, client_id: clientId });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json() as Pair;
  assert.notEqual(next.access_token, pair.access_token);
  assert.notEqual(next.refresh_token, pair.refresh_token);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tokens WHERE kind = 'oauth'").get()!.n, 1, 'the same connection row');
  assert.ok((await toolNames(env, next.access_token)).includes('cms_create_draft'));

  // 9. The panel lists the connection and disconnects it.
  const list = await (await run(tokensApi.onRequestGet, new Request(`${BASE}/api/agent-tokens`, { headers: cookie('ed') }), env)).json() as { mine: Record<string, unknown>[] };
  const listed = list.mine.find((t) => t.id === connection.id);
  assert.ok(listed, 'the panel lists the connection');
  assert.equal(listed!.kind, 'oauth');
  assert.equal(listed!.label, `${name} (${new URL(clientId).hostname})`);
  const del = await run(tokenApi.onRequestDelete, new Request(`${BASE}/api/agent-tokens/${connection.id}`, { method: 'DELETE', headers: { ...cookie('ed'), Origin: BASE } }), env, { id: connection.id });
  assert.equal(del.status, 200);

  // 10. Everything the app holds stops at once.
  assert.equal((await mcpPost(env, next.access_token, { jsonrpc: '2.0', id: 99, method: 'tools/list' })).status, 401);
  const dead = await exchange(env, { grant_type: 'refresh_token', refresh_token: next.refresh_token, resource: MCP_RESOURCE, client_id: clientId });
  assert.equal(dead.status, 400);
  assert.equal(((await dead.json()) as Record<string, string>).error, 'invalid_grant');
  return { db, env };
}

// --- the client shapes -------------------------------------------------------

test('Claude shape (CIMD, public client): 401 to tool call, role loss, refresh, disconnect', async () => {
  await walk('https://claude.example/oauth/client.json', 'https://claude.example/api/mcp/auth_callback', 'Claude');
});

test('ChatGPT shape (CIMD): the same walk, and the redirect iss equals the metadata issuer', async () => {
  const { db } = await walk('https://chatgpt.example/oauth/client.json', 'https://chatgpt.example/connector_platform_oauth_redirect', 'ChatGPT');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tokens WHERE kind = 'oauth' AND revoked_at IS NOT NULL").get()!.n, 1);
});

test('Cursor shape (DCR, custom scheme): register, authorize to cursor://, exchange without a secret and with Basic', async () => {
  const { db, env } = await setup();
  const CURSOR = 'cursor://anysphere.cursor-retrieval/oauth/user-mcp/callback';
  const registerClient = async (method: string) => {
    const res = await run(register.onRequestPost, new Request(`${BASE}/oauth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
      body: JSON.stringify({ client_name: 'Cursor', redirect_uris: [CURSOR], token_endpoint_auth_method: method }),
    }), env);
    assert.equal(res.status, 201);
    return await res.json() as { client_id: string; client_secret: string };
  };

  // Public: the secret is omitted at the token endpoint.
  const pub = await registerClient('none');
  const first = await consent(env, 'ed', pub.client_id, CURSOR);
  assert.ok(first.html.includes(CURSOR), 'the warning page shows the whole custom-scheme address');
  assert.equal(first.redirectUrl.protocol, 'cursor:');
  assert.equal(first.query.get('iss'), ISSUER);
  const viaNone = await exchange(env, codeParams(first.query.get('code')!, pub.client_id, CURSOR));
  assert.equal(viaNone.status, 200);
  const pair = await viaNone.json() as Pair;
  assert.ok((await toolNames(env, pair.access_token)).includes('cms_create_draft'));

  // Confidential: HTTP Basic.
  const conf = await registerClient('client_secret_basic');
  const second = await consent(env, 'ed', conf.client_id, CURSOR);
  const noAuth = await exchange(env, codeParams(second.query.get('code')!, conf.client_id, CURSOR));
  assert.equal(noAuth.status, 401, 'a client with a secret cannot leave it out');
  const { client_id: _id, ...grant } = codeParams(second.query.get('code')!, conf.client_id, CURSOR);
  const basic = `Basic ${Buffer.from(`${encodeURIComponent(conf.client_id)}:${encodeURIComponent(conf.client_secret)}`).toString('base64')}`;
  const viaBasic = await exchange(env, grant, { Authorization: basic });
  assert.equal(viaBasic.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agent_tokens WHERE kind = 'oauth'").get()!.n, 2);
  // A redirect the client did not register never gets a code.
  const stray = await run(authorize.onRequestGet, new Request(authorizeUrl(conf.client_id, 'cursor://evil/cb'), { headers: cookie('ed') }), env);
  assert.equal(stray.status, 400);
  assert.equal(stray.headers.get('Location'), null);
});

test('approve is unreachable: no tool approves, and POST approve with an access token is 403 human_only', async () => {
  const { db, env } = await setup();
  const client = 'https://claude.example/oauth/client.json';
  const redirect = 'https://claude.example/api/mcp/auth_callback';
  const { query } = await consent(env, 'approver', client, redirect);
  const pair = await (await exchange(env, codeParams(query.get('code')!, client, redirect))).json() as Pair;

  const tools = await toolNames(env, pair.access_token);
  assert.ok(tools.length > 0 && !tools.some((t) => /approve|reject|cancel|publish/.test(t)), tools.join(','));
  const draft = await callTool(env, pair.access_token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  const id = draft.draft.id as string;
  await callTool(env, pair.access_token, 'cms_submit_draft', { id });
  assert.equal(db.prepare('SELECT status FROM content_drafts WHERE id = ?').get(id)!.status, 'submitted', 'submitted, waiting for a person');

  // The same member, in the panel, could approve; through the connection the route is refused before any handler runs.
  const request = new Request(`${BASE}/api/cms/drafts/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${pair.access_token}` } });
  let handlerRan = false;
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request, env, params: { id }, waitUntil() {}, next: async () => { handlerRan = true; return run(approve.onRequestPost, request, env, { id }); },
  });
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as Record<string, string>).code, 'human_only');
  assert.equal(handlerRan, false);
  // The handler itself refuses a token too, should the table ever let one through.
  const direct = await run(approve.onRequestPost, new Request(`${BASE}/api/cms/drafts/${id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${pair.access_token}` } }), env, { id });
  assert.equal(direct.status, 403);
  assert.equal(db.prepare('SELECT status FROM content_drafts WHERE id = ?').get(id)!.status, 'submitted', 'nothing changed');
  // And the connection holds no approve right, however the member's roles read.
  const auth = await authenticateAgent(new Request(`${BASE}/api/mcp`, { headers: { Authorization: `Bearer ${pair.access_token}` } }), env as never, Math.floor(Date.now() / 1000));
  assert.equal(auth.kind, 'agent');
  if (auth.kind === 'agent') assert.ok(Object.values(agentGroupRights(auth.agent, 'draft')).every((r) => r.approve === false));
});
