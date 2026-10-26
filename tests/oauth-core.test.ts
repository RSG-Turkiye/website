// A connection made by OAuth sign-in (plan 6, Task 1) is an agent credential
// like a personal token: an agent_tokens row of kind 'oauth' whose access
// token works on /api/mcp only, and only until it expires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { bearer, mintConnection, mintToken } from './lib/agent';
import { agentGroupRights, authenticateAgent, newTokenValue, type AgentAuth } from '../functions/_lib/agent-tokens';
import {
  ISSUER, MCP_RESOURCE, PRM_URL, PREFIX, isCanonicalResource, newRefreshValue, newValue, parseRefresh, sha256Hex,
} from '../functions/_lib/oauth-config';
import { grantRole } from '../functions/_lib/role-grants';
import { onRequest as middleware } from '../functions/api/_middleware';
import * as mcp from '../functions/api/mcp';
import * as drafts from '../functions/api/cms/drafts';
import * as tokens from '../functions/api/agent-tokens/index';
import { onRequestPost as prune } from '../functions/api/admin/audit/prune';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const CHALLENGE = `Bearer resource_metadata="${PRM_URL}"`;
const INVALID = `${CHALLENGE}, error="invalid_token"`;

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of ['ed', 'admin']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  const DB = d1(db) as never;
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: now() + 30 * DAY, by: null }, now());
  await grantRole(DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, now());
  // Any call to the content index means a handler ran.
  const ASSETS = { fetch: async () => { throw new Error('the handler ran'); } };
  return { db, env: { DB, ASSETS, SYMPOSIUM_ARCHIVE_SECRET: 's3cret' } as never };
}

const req = (method: string, path: string, headers: Record<string, string> = {}, body?: string) =>
  new Request(`${BASE}${path}`, { method, headers, body });

function refusal(auth: AgentAuth): Response {
  assert.equal(auth.kind, 'refused');
  return (auth as Extract<AgentAuth, { kind: 'refused' }>).response;
}

const counterBuckets = (db: DatabaseSync) =>
  (db.prepare('SELECT bucket FROM agent_counters').all() as { bucket: string }[]).map((r) => r.bucket);

const changes = (db: DatabaseSync) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;

test('oauth access token on /api/mcp authenticates with the connection\'s rights', async () => {
  const { db, env } = await setup();
  const { id, access } = await mintConnection(db, 'ed', ['cms.etkinlikler:draft']);
  const auth = await authenticateAgent(req('POST', '/api/mcp', bearer(access)), env, now());
  assert.equal(auth.kind, 'agent');
  const { agent } = auth as Extract<AgentAuth, { kind: 'agent' }>;
  assert.equal(agent.tokenId, id);
  const rights = agentGroupRights(agent, 'draft');
  assert.equal(rights.etkinlikler.edit, true);
  assert.ok(Object.values(rights).every((r) => r.approve === false), 'never approve');
  assert.equal(rights.yazilar.edit, false, 'nothing beyond the scope');
});

test('oauth access token after access_expires_at is 401 invalid_token and writes no failure', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { accessExpiresAt: now() - 1 });
  const before = changes(db);
  const res = refusal(await authenticateAgent(req('POST', '/api/mcp', bearer(access)), env, now()));
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { error: 'Unauthorized', code: 'unauthorized' });
  const header = res.headers.get('WWW-Authenticate') ?? '';
  assert.ok(header.includes('error="invalid_token"'), header);
  assert.ok(header.includes('resource_metadata="https://rsg-turkiye.iscbsc.org/.well-known/oauth-protected-resource/api/mcp"'), header);
  assert.deepEqual(counterBuckets(db).filter((b) => b.includes(':i:') || b.includes(':g:failures')), []);
  assert.equal(changes(db), before, 'a stale access token writes nothing');
});

test('oauth access token on a REST table route is 401', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'admin', ['cms.etkinlikler:draft']);
  const auth = refusal(await authenticateAgent(req('GET', '/api/cms/drafts', bearer(access)), env, now()));
  assert.equal(auth.status, 401);
  assert.equal(auth.headers.get('WWW-Authenticate'), INVALID);

  // The middleware passes a table route on; the handler's gate refuses before any work.
  const before = changes(db);
  const request = req('GET', '/api/cms/drafts', bearer(access));
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request, env, params: {}, waitUntil() {}, next: () => (drafts.onRequestGet as unknown as (c: unknown) => Promise<Response>)({ request, env, params: {} }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('WWW-Authenticate'), INVALID);
  assert.equal(changes(db), before, 'nothing written, no counter bumped');
});

test('oauth access token on a route outside the table is 403 human_only from the middleware', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'admin', ['cms.etkinlikler:draft']);
  let called = 0;
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request: req('GET', '/api/admin/users', bearer(access)), env, params: {}, waitUntil() {},
    next: async () => { called++; return new Response('handler'); },
  });
  assert.equal(called, 0);
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { code: string }).code, 'human_only');
});

test('a revoked connection is 401', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { revokedAt: now() - 60 });
  const res = refusal(await authenticateAgent(req('POST', '/api/mcp', bearer(access)), env, now()));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('WWW-Authenticate'), INVALID);
});

test('the connection\'s own end is 401 even with a live access token', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { expiresAt: now() - 1 });
  assert.equal(refusal(await authenticateAgent(req('POST', '/api/mcp', bearer(access)), env, now())).status, 401);
});

test('an oauth row presented with the personal prefix, or a PAT row with the oauth prefix, is 401', async () => {
  const { db, env } = await setup();
  // Stored hashes of values whose prefix does not match the row's kind.
  const pat = newValue(PREFIX.access).replace(PREFIX.access, 'rsg_pat_');
  await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { id: '0b6f4a52-3c1d-4e8f-9a2b-7c6d5e4f3a21' });
  db.prepare('UPDATE agent_tokens SET token_hash = ? WHERE id = ?').run(await sha256Hex(pat), '0b6f4a52-3c1d-4e8f-9a2b-7c6d5e4f3a21');
  assert.equal(refusal(await authenticateAgent(req('POST', '/api/mcp', bearer(pat)), env, now())).status, 401);
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  const oat = PREFIX.access + value.slice('rsg_pat_'.length);
  db.prepare('UPDATE agent_tokens SET token_hash = ? WHERE token_hash = ?').run(await sha256Hex(oat), await sha256Hex(value));
  assert.equal(refusal(await authenticateAgent(req('POST', '/api/mcp', bearer(oat)), env, now())).status, 401);
});

test('an expired oauth access token is a dead token to the middleware: no failure counted', async () => {
  const { db, env } = await setup();
  const { access } = await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { accessExpiresAt: now() - 1 });
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request: req('GET', '/api/admin/users', bearer(access)), env, params: {}, waitUntil() {}, next: async () => new Response('handler'),
  });
  assert.equal(res.status, 403);
  assert.deepEqual(counterBuckets(db), []);
});

test('no Authorization header on /api/mcp is 401 with resource_metadata and no error param', async () => {
  const { env } = await setup();
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  const res = await (mcp.onRequestPost as unknown as (c: unknown) => Promise<Response>)({
    request: req('POST', '/api/mcp', { 'Content-Type': 'application/json' }, body), env, params: {}, waitUntil() {},
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('WWW-Authenticate'), CHALLENGE);
  const get = await (mcp.onRequestGet as unknown as (c: unknown) => Promise<Response>)({ request: req('GET', '/api/mcp'), env, params: {} });
  assert.equal(get.status, 401);
  assert.equal(get.headers.get('WWW-Authenticate'), CHALLENGE);
});

test('PAT behaviour is unchanged', async () => {
  const { db, env } = await setup();
  assert.match(newTokenValue(), /^rsg_pat_[A-Za-z0-9_-]{43}$/);
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  assert.equal((await authenticateAgent(req('GET', '/api/cms/drafts', bearer(value)), env, now())).kind, 'agent');
  assert.equal((await authenticateAgent(req('POST', '/api/mcp', bearer(value)), env, now())).kind, 'agent');
});

const session = { Cookie: 'rsg_session=s-ed' };

test('creating a 5th personal token ignores live connections', async () => {
  const { db, env } = await setup();
  for (let i = 0; i < 5; i++) await mintConnection(db, 'ed', ['cms.etkinlikler:draft']);
  for (let i = 0; i < 4; i++) await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  const post = () => (tokens.onRequestPost as unknown as (c: unknown) => Promise<Response>)({
    request: req('POST', '/api/agent-tokens', { ...session, 'Content-Type': 'application/json' },
      JSON.stringify({ label: 'fifth', scopes: ['cms.etkinlikler:draft'] })),
    env,
  });
  const res = await post();
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((await res.json() as { token: { kind: string } }).token.kind, 'pat');
  assert.equal((db.prepare(`SELECT kind FROM agent_tokens WHERE label = 'fifth'`).get() as { kind: string }).kind, 'pat');
  assert.equal((await post()).status, 409, 'the sixth personal token is still refused');
});

test('GET /api/agent-tokens lists connections with kind oauth and no hash fields', async () => {
  const { db, env } = await setup();
  const conn = await mintConnection(db, 'ed', ['cms.etkinlikler:draft']);
  await mintToken(db, 'ed', ['cms.etkinlikler:read']);
  const res = await (tokens.onRequestGet as unknown as (c: unknown) => Promise<Response>)({ request: req('GET', '/api/agent-tokens', session), env });
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text) as { mine: { id: string; kind: string }[] };
  assert.deepEqual(body.mine.map((t) => t.kind).sort(), ['oauth', 'pat']);
  assert.equal(body.mine.find((t) => t.id === conn.id)?.kind, 'oauth');
  const keys = new Set<string>();
  JSON.parse(text, (k, v) => { keys.add(k); return v; });
  for (const k of ['token_hash', 'refresh_hash', 'prev_refresh_hash', 'client_id']) assert.ok(!keys.has(k), k);
  assert.ok(!text.includes(await sha256Hex(conn.refresh)) && !text.includes(conn.access) && !text.includes(conn.refresh));
});

test('prune deletes expired codes and unused DCR clients older than a day', async () => {
  const { db, env } = await setup();
  const t = now();
  const client = db.prepare(`INSERT INTO oauth_clients (id, secret_hash, auth_method, name, redirect_uris, created_at) VALUES (?, 'h', 'client_secret_basic', 'n', '[]', ?)`);
  client.run('rsg_oc_unused', t - 2 * DAY);
  client.run('rsg_oc_connected', t - 2 * DAY);
  client.run('rsg_oc_coded', t - 2 * DAY);
  client.run('rsg_oc_fresh', t - 60);
  const code = db.prepare(`INSERT INTO oauth_codes (code_hash, user_id, client_id, label, redirect_uri, code_challenge, scopes, days, expires_at)
    VALUES (?, 'ed', ?, 'l', 'https://client.example.org/cb', 'c', '[]', 30, ?)`);
  code.run('expired', 'https://client.example.org/oauth/client.json', t - 1);
  code.run('live', 'rsg_oc_coded', t + 120);
  await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { clientId: 'rsg_oc_connected' });

  const res = await (prune as unknown as (c: unknown) => Promise<Response>)({
    request: req('POST', '/api/admin/audit/prune', { 'X-Archive-Secret': 's3cret' }), env,
  });
  assert.equal(res.status, 200);
  assert.deepEqual((db.prepare('SELECT code_hash FROM oauth_codes').all() as { code_hash: string }[]).map((r) => r.code_hash), ['live']);
  assert.deepEqual((db.prepare('SELECT id FROM oauth_clients ORDER BY id').all() as { id: string }[]).map((r) => r.id),
    ['rsg_oc_coded', 'rsg_oc_connected', 'rsg_oc_fresh']);
  const details = JSON.parse((db.prepare(`SELECT details FROM audit_log WHERE action = 'audit.prune'`).get() as { details: string }).details);
  assert.equal(details.oauthCodes, 1);
  assert.equal(details.oauthClients, 1);
});

test('isCanonicalResource', () => {
  assert.equal(MCP_RESOURCE, `${ISSUER}/api/mcp`);
  assert.equal(isCanonicalResource('https://rsg-turkiye.iscbsc.org/api/mcp'), true);
  assert.equal(isCanonicalResource('HTTPS://RSG-TURKIYE.ISCBSC.ORG/api/mcp'), true);
  for (const v of [
    'https://rsg-turkiye.iscbsc.org/api/mcp/', 'https://rsg-turkiye.iscbsc.org/api/mcp?x=1', 'https://rsg-turkiye.iscbsc.org/api/mcp#f',
    'https://rsg-turkiye.iscbsc.org/api/mcp?', 'http://rsg-turkiye.iscbsc.org/api/mcp', 'https://example.org/api/mcp',
    'https://rsg-turkiye.iscbsc.org/API/MCP', 'https://user@rsg-turkiye.iscbsc.org/api/mcp', '', 'not a url',
  ]) assert.equal(isCanonicalResource(v), false, v);
});

test('refresh values carry the row id and nothing else parses', () => {
  const id = crypto.randomUUID();
  const value = newRefreshValue(id);
  assert.match(value, /^rsg_ort_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(parseRefresh(value), { rowId: id });
  assert.notEqual(newRefreshValue(id), value);
  assert.equal(parseRefresh(value.replace('rsg_ort_', 'rsg_oat_')), null);
  assert.equal(parseRefresh(`rsg_ort_not-a-uuid.${value.slice(-43)}`), null);
  assert.equal(parseRefresh(`rsg_ort_${id}.short`), null);
  assert.equal(parseRefresh(`rsg_ort_${id.toUpperCase()}.${value.slice(-43)}`), null);
  assert.equal(parseRefresh(newValue(PREFIX.access)), null);
  for (const p of Object.values(PREFIX)) assert.match(newValue(p), new RegExp(`^${p}[A-Za-z0-9_-]{43}$`));
});
