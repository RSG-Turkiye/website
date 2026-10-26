// The token endpoint (plan 6, Task 5): a code becomes a connection, a refresh
// value becomes a new pair, and every refusal leaves D1 as it found it
// (except the failed-authentication count a wrong guess is charged).
import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { mintConnection, mintToken } from './lib/agent';
import { grantRole } from '../functions/_lib/role-grants';
import { registerStatement } from '../functions/_lib/oauth-clients';
import { LIMITS } from '../functions/_lib/agent-limits';
import { MCP_RESOURCE, sha256Hex } from '../functions/_lib/oauth-config';
import * as token from '../functions/oauth/token';
import * as mcp from '../functions/api/mcp';
import { onRequestDelete } from '../functions/api/agent-tokens/[id]';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const NOW = 1_800_000_000;
const DAY = 86400;
const REDIRECT = 'https://app.example.org/callback';
const VERIFIER = 'v'.repeat(64);
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');
const SCOPES = ['cms.etkinlikler:draft'];

interface Client { id: string; secret: string }

async function setup(t: TestContext, now = NOW) {
  t.mock.timers.enable({ apis: ['Date'], now: now * 1000 });
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of ['ed', 'ed2']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
    await grantRole(d1(db) as never, { userId: id, role: 'content.etkinlikler.edit', expiresAt: now + 90 * DAY, by: null }, now);
  }
  const DB = d1(db) as never as D1Database;
  const env = { DB, ASSETS: { fetch: async () => { throw new Error('the handler ran'); } } } as never;
  return { db, DB, env };
}

async function dcr(DB: D1Database, authMethod: 'none' | 'client_secret_basic' | 'client_secret_post' = 'client_secret_basic'): Promise<Client> {
  const r = await registerStatement(DB, { name: 'Test App', redirectUris: [REDIRECT], authMethod, now: NOW });
  await r.statement.run();
  return { id: r.id, secret: r.secret };
}

let seq = 0;
/** An oauth_codes row as Task 4 leaves it; returns the code value. */
async function makeCode(db: DatabaseSync, c: Client, o: { user?: string; scopes?: string[]; days?: number; uri?: string; challenge?: string; expiresAt?: number; label?: string } = {}) {
  const code = `rsg_oac_${String(seq++).padStart(43, 'c')}`;
  db.prepare(
    `INSERT INTO oauth_codes (code_hash, user_id, client_id, label, redirect_uri, code_challenge, scopes, days, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(await sha256Hex(code), o.user ?? 'ed', c.id, o.label ?? 'Test App (app.example.org)', o.uri ?? REDIRECT, o.challenge ?? CHALLENGE, JSON.stringify(o.scopes ?? SCOPES), o.days ?? 30, o.expiresAt ?? NOW + 120);
  return code;
}

const basic = (c: Client, secret = c.secret) => ({ Authorization: `Basic ${Buffer.from(`${encodeURIComponent(c.id)}:${encodeURIComponent(secret)}`).toString('base64')}` });

async function call(env: never, params: Record<string, string>, headers: Record<string, string> = {}, raw?: { body: string; type: string }) {
  const request = new Request(`${BASE}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': raw?.type ?? 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: raw?.body ?? new URLSearchParams(params).toString(),
  });
  return (token.onRequestPost as unknown as (c: unknown) => Promise<Response>)({ request, env, params: {}, waitUntil() {} });
}

type Body = Record<string, unknown>;
const exchange = (env: never, c: Client, code: string, o: Partial<Record<string, string>> = {}, headers: Record<string, string> = {}) =>
  call(env, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: c.id, client_secret: c.secret, ...o }, headers);
const refresh = (env: never, c: Client, value: string, o: Partial<Record<string, string>> = {}) =>
  call(env, { grant_type: 'refresh_token', refresh_token: value, client_id: c.id, client_secret: c.secret, ...o });

const rows = (db: DatabaseSync, sql: string, ...a: unknown[]) => db.prepare(sql).all(...(a as never[])) as Record<string, unknown>[];
const count = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const changes = (db: DatabaseSync) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const failuresRows = (db: DatabaseSync) => count(db, 'agent_counters');

async function listTools(env: never, access: string): Promise<string[]> {
  const request = new Request(`${BASE}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const res = await (mcp.onRequestPost as unknown as (c: unknown) => Promise<Response>)({ request, env, params: {}, waitUntil() {}, data: {} });
  if (res.status !== 200) return [`status ${res.status}`];
  return ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((x) => x.name).sort();
}
const mcpStatus = async (env: never, access: string) => {
  const request = new Request(`${BASE}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${access}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  return (await (mcp.onRequestPost as unknown as (c: unknown) => Promise<Response>)({ request, env, params: {}, waitUntil() {}, data: {} })).status;
};

// --- the code grant ----------------------------------------------------------

test('code exchange issues tokens that work at /api/mcp', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  const res = await exchange(env, c, code);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.json() as Body;
  assert.equal(body.token_type, 'Bearer');
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, SCOPES.join(' '));
  assert.match(String(body.refresh_token), /^rsg_ort_[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  assert.match(String(body.access_token), /^rsg_oat_[A-Za-z0-9_-]{43}$/);

  const tools = await listTools(env, String(body.access_token));
  assert.ok(tools.length > 0 && !tools.some((n) => /social/.test(n)), tools.join(','));
  const same = await mintConnection(db, 'ed', SCOPES);
  assert.deepEqual(tools, await listTools(env, same.access), 'the tools of the consented scope only');

  const row = rows(db, `SELECT * FROM agent_tokens WHERE kind = 'oauth' AND client_id = ?`, c.id)[0];
  assert.equal(row.user_id, 'ed');
  assert.equal(row.label, `Test App (app.example.org)`);
  assert.equal(row.hint, '');
  assert.equal(row.expires_at, NOW + 30 * DAY);
  assert.equal(row.access_expires_at, NOW + 3600);
  assert.equal(row.refreshed_at, NOW);
  assert.equal(row.prev_refresh_hash, null);
  assert.equal(row.refresh_hash, await sha256Hex(String(body.refresh_token)));

  const audit = rows(db, `SELECT * FROM audit_log WHERE action = 'agent_token.create'`);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].target_id, row.id);
  assert.equal(audit[0].user_id, 'ed');
  assert.equal((JSON.parse(String(audit[0].details)) as Body).kind, 'oauth');
  const log = JSON.stringify(rows(db, 'SELECT * FROM audit_log'));
  for (const v of [body.access_token, body.refresh_token, code, c.secret]) assert.ok(!log.includes(String(v)), 'no secret in audit_log');
});

test('a public client (auth method none) exchanges with no secret', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB, 'none');
  const code = await makeCode(db, c);
  const res = await call(env, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: c.id });
  assert.equal(res.status, 200);
});

test('the code works once', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  assert.equal((await exchange(env, c, code)).status, 200);
  const second = await exchange(env, c, code);
  assert.equal(second.status, 400);
  assert.equal(((await second.json()) as Body).error, 'invalid_grant');
  assert.equal(count(db, 'agent_tokens'), 1);
});

test('wrong verifier, other client, other redirect_uri, expired code', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const other = await dcr(DB);
  const cases: [string, () => Promise<Response>, string][] = [
    ['wrong verifier', async () => exchange(env, c, await makeCode(db, c), { code_verifier: 'w'.repeat(64) }), 'invalid_grant'],
    ['other client', async () => exchange(env, other, await makeCode(db, c)), 'invalid_grant'],
    ['other redirect_uri', async () => exchange(env, c, await makeCode(db, c), { redirect_uri: `${REDIRECT}/` }), 'invalid_grant'],
    ['expired code', async () => exchange(env, c, await makeCode(db, c, { expiresAt: NOW - 1 })), 'invalid_grant'],
  ];
  for (const [name, run, error] of cases) {
    db.prepare('DELETE FROM agent_counters').run();
    const res = await run();
    assert.equal(res.status, 400, name);
    assert.equal(((await res.json()) as Body).error, error, name);
    assert.equal(count(db, 'agent_tokens'), 0, `${name}: nothing issued`);
    // Each failed guess is counted against the day only, never an IP. (The pre-charge of a live code adds its own row.)
    const buckets = rows(db, 'SELECT bucket FROM agent_counters').map((r) => String(r.bucket));
    assert.deepEqual(buckets.filter((b) => !b.includes(':t:')), [`${String(Math.floor(NOW / DAY)).padStart(6, '0')}:g:failures`], `${name}: failure counted`);
  }
  // The canonical resource is accepted.
  const ok = await exchange(env, c, await makeCode(db, c), { resource: MCP_RESOURCE });
  assert.equal(ok.status, 200);
});

test('a non-canonical resource is invalid_target and spends nothing: no write, the code stays redeemable', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  const before = changes(db);
  const res = await exchange(env, c, code, { resource: `${MCP_RESOURCE}/` });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Body).error, 'invalid_target');
  assert.equal(changes(db), before);
  assert.equal(count(db, 'oauth_codes'), 1);
  assert.equal((await exchange(env, c, code, { resource: MCP_RESOURCE })).status, 200, 'the same code redeems with the right resource');
});

test('the connection label is the one stored with the code at consent', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const res = await exchange(env, c, await makeCode(db, c, { label: 'Consented (other.example.org)' }));
  assert.equal(res.status, 200);
  assert.equal(rows(db, `SELECT label FROM agent_tokens WHERE client_id = ?`, c.id)[0].label, 'Consented (other.example.org)');
});

test('a mismatching exchange still spends the code', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  assert.equal((await exchange(env, c, code, { code_verifier: 'w'.repeat(64) })).status, 400);
  assert.equal(count(db, 'oauth_codes'), 0);
  assert.equal((await exchange(env, c, code)).status, 400, 'the right verifier is too late');
});

test('JSON body is 400 invalid_request and a 9 KB body is 400', async (t) => {
  const { env } = await setup(t);
  const json = await call(env, {}, {}, { body: '{"grant_type":"refresh_token"}', type: 'application/json' });
  assert.equal(json.status, 400);
  assert.equal(((await json.json()) as Body).error, 'invalid_request');
  const big = await call(env, {}, {}, { body: `grant_type=authorization_code&code=${'a'.repeat(9 * 1024)}`, type: 'application/x-www-form-urlencoded' });
  assert.equal(big.status, 400);
  assert.equal(((await big.json()) as Body).error, 'invalid_request');
});

test('Content-Type: application/x-www-form-urlencoded;charset=UTF-8 is accepted', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  const res = await call(env, {}, {}, {
    type: 'application/x-www-form-urlencoded;charset=UTF-8',
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: c.id, client_secret: c.secret }).toString(),
  });
  assert.equal(res.status, 200);
});

test('unknown grant type, missing grant type and repeated parameters are refused', async (t) => {
  const { DB, env } = await setup(t);
  const c = await dcr(DB);
  const bad = await call(env, { grant_type: 'password', client_id: c.id, client_secret: c.secret });
  assert.equal(((await bad.json()) as Body).error, 'unsupported_grant_type');
  const none = await call(env, { client_id: c.id, client_secret: c.secret });
  assert.equal(((await none.json()) as Body).error, 'invalid_request');
  const twice = await call(env, {}, {}, { type: 'application/x-www-form-urlencoded', body: 'grant_type=refresh_token&grant_type=refresh_token' });
  assert.equal(((await twice.json()) as Body).error, 'invalid_request');
});

test('OPTIONS answers the preflight with CORS', async (t) => {
  await setup(t);
  const res = (token.onRequestOptions as unknown as () => Response)();
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});

// --- client authentication ---------------------------------------------------

test('confidential DCR client: Basic and post both work, a wrong secret is 401 invalid_client with WWW-Authenticate Basic', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const viaBasic = await call(env, { grant_type: 'authorization_code', code: await makeCode(db, c), redirect_uri: REDIRECT, code_verifier: VERIFIER }, basic(c));
  assert.equal(viaBasic.status, 200);
  const viaPost = await exchange(env, c, await makeCode(db, c));
  assert.equal(viaPost.status, 200);

  const wrongBasic = await call(env, { grant_type: 'authorization_code', code: await makeCode(db, c), redirect_uri: REDIRECT, code_verifier: VERIFIER }, basic(c, 'nope'));
  assert.equal(wrongBasic.status, 401);
  assert.equal(((await wrongBasic.json()) as Body).error, 'invalid_client');
  assert.equal(wrongBasic.headers.get('WWW-Authenticate'), 'Basic realm="rsg-turkiye"');
  const wrongPost = await exchange(env, c, await makeCode(db, c), { client_secret: 'nope' });
  assert.equal(wrongPost.status, 401);
  assert.equal(wrongPost.headers.get('WWW-Authenticate'), null);
  const noSecret = await call(env, { grant_type: 'authorization_code', code: await makeCode(db, c), redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: c.id });
  assert.equal(noSecret.status, 401, 'no secret for a client that has one');
  const emptySecret = await exchange(env, c, await makeCode(db, c), { client_secret: '' });
  assert.equal(emptySecret.status, 401, 'an empty secret is a wrong secret');
  const unknown = await call(env, { grant_type: 'authorization_code', code: 'x', client_id: 'rsg_oc_unknown', client_secret: 'y' });
  assert.equal(unknown.status, 401);
  assert.equal(count(db, 'agent_tokens'), 2, 'only the two good ones');
  assert.equal(count(db, 'oauth_codes'), 4, 'a refused client does not spend any code');
});

test('both a Basic header and body credentials are invalid_request', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const res = await call(env, { grant_type: 'authorization_code', code: await makeCode(db, c), redirect_uri: REDIRECT, code_verifier: VERIFIER, client_id: c.id }, basic(c));
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Body).error, 'invalid_request');
});

test('misses at the token endpoint never cut an IP off: 12 junk codes are all invalid_grant, then a valid exchange succeeds', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH + 2; i++) {
    const res = await exchange(env, c, `rsg_oac_${String(i).padStart(43, 'j')}`);
    assert.equal(res.status, 400, `#${i + 1}`);
    assert.equal(((await res.json()) as Body).error, 'invalid_grant');
  }
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH + 2; i++) assert.equal((await exchange(env, c, 'x', { client_secret: 'nope' })).status, 401, `secret #${i + 1}`);
  const buckets = rows(db, 'SELECT bucket FROM agent_counters').map((r) => String(r.bucket));
  assert.deepEqual(buckets, [`${String(Math.floor(NOW / DAY)).padStart(6, '0')}:g:failures`], 'only the day\'s count, no IP row');
  assert.equal((await exchange(env, c, await makeCode(db, c))).status, 200);
});

test('past the day\'s failure cap a miss writes no row', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(`${String(Math.floor(NOW / DAY)).padStart(6, '0')}:g:failures`, LIMITS.FAILURES_PER_DAY);
  const before = changes(db);
  assert.equal((await exchange(env, c, 'rsg_oac_nothing')).status, 400);
  assert.equal((await exchange(env, c, 'x', { client_secret: 'nope' })).status, 401);
  assert.equal(changes(db), before);
});

// --- limits ------------------------------------------------------------------

test('a 6th connection\'s exchange is invalid_grant and writes no agent_tokens row', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  for (let i = 0; i < 5; i++) assert.equal((await exchange(env, c, await makeCode(db, c))).status, 200);
  assert.equal(count(db, 'agent_tokens'), 5);
  const audits = count(db, 'audit_log');
  const sixth = await exchange(env, c, await makeCode(db, c));
  assert.equal(sixth.status, 400);
  assert.equal(((await sixth.json()) as Body).error, 'invalid_grant');
  assert.equal(count(db, 'agent_tokens'), 5);
  assert.equal(count(db, 'audit_log'), audits, 'no audit row for a connection that was not made');
  // Another member is unaffected, and a revoked connection frees a slot.
  assert.equal((await exchange(env, c, await makeCode(db, c, { user: 'ed2' }))).status, 200);
  db.prepare(`UPDATE agent_tokens SET revoked_at = ? WHERE user_id = 'ed' AND id = (SELECT id FROM agent_tokens WHERE user_id = 'ed' LIMIT 1)`).run(NOW);
  assert.equal((await exchange(env, c, await makeCode(db, c))).status, 200);
});

test('a member at 300 requests today gets 429 rate_limited with Retry-After and no write, on both grants', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const day = String(Math.floor(NOW / DAY)).padStart(6, '0');
  // Code far from expiry, so it can outlast the day.
  const code = await makeCode(db, c, { expiresAt: NOW + 3 * DAY });
  const live = await exchange(env, c, await makeCode(db, c));
  assert.equal(live.status, 200);
  const first = (await live.json()) as Body;
  db.prepare('INSERT INTO agent_counters (bucket, user_id, general) VALUES (?, ?, ?)').run(`${day}:t:spent`, 'ed', LIMITS.MEMBER_PER_DAY);

  const snapshot = () => JSON.stringify([rows(db, 'SELECT * FROM agent_counters ORDER BY bucket'), rows(db, 'SELECT * FROM agent_tokens'), rows(db, 'SELECT * FROM oauth_codes'), count(db, 'audit_log')]);
  const before = snapshot();
  const ex = await exchange(env, c, code);
  assert.equal(ex.status, 429);
  assert.equal(((await ex.json()) as Body).error, 'rate_limited');
  assert.ok(Number(ex.headers.get('Retry-After')) > 0);
  const rf = await refresh(env, c, String(first.refresh_token));
  assert.equal(rf.status, 429);
  assert.equal(((await rf.json()) as Body).error, 'rate_limited');
  assert.equal(snapshot(), before, 'both refusals wrote nothing; the code is still there');

  t.mock.timers.setTime((NOW + DAY) * 1000);
  const again = await exchange(env, c, code);
  assert.equal(again.status, 200, 'the same code redeems once the day resets');
});

test('an IP row at its limits does not refuse the token endpoint', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const { ipKey } = await import('../functions/_lib/agent-limits');
  const ip = await ipKey(new Request(BASE, { headers: { 'CF-Connecting-IP': '203.0.113.9' } }));
  db.prepare('INSERT INTO agent_counters (bucket, minute, minute_n, fail_window, fail_n) VALUES (?, ?, ?, ?, ?)')
    .run(`${String(Math.floor(NOW / DAY)).padStart(6, '0')}:i:${ip}`, Math.floor(NOW / 60), LIMITS.IP_PER_MINUTE, Math.floor(NOW / LIMITS.IP_FAILED_AUTH_WINDOW), LIMITS.IP_FAILED_AUTH);
  assert.equal((await exchange(env, c, await makeCode(db, c))).status, 200);
});

// --- the refresh grant -------------------------------------------------------

async function connected(t: TestContext) {
  const s = await setup(t);
  const c = await dcr(s.DB);
  const res = await exchange(s.env, c, await makeCode(s.db, c));
  const body = (await res.json()) as { access_token: string; refresh_token: string };
  const id = (rows(s.db, `SELECT id FROM agent_tokens WHERE client_id = ?`, c.id)[0].id) as string;
  return { ...s, c, id, access: body.access_token, refresh: body.refresh_token };
}

test('refresh rotates in place', async (t) => {
  const { db, env, c, id, access, refresh: first } = await connected(t);
  t.mock.timers.setTime((NOW + 600) * 1000);
  const res = await refresh(env, c, first);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = (await res.json()) as Body;
  assert.equal(body.expires_in, 3600);
  assert.equal(body.scope, SCOPES.join(' '));
  assert.notEqual(body.access_token, access);
  assert.notEqual(body.refresh_token, first);
  assert.match(String(body.refresh_token), new RegExp(`^rsg_ort_${id}\\.`));
  assert.equal(count(db, 'agent_tokens'), 1);
  const row = rows(db, 'SELECT * FROM agent_tokens WHERE id = ?', id)[0];
  assert.equal(row.token_hash, await sha256Hex(String(body.access_token)));
  assert.equal(row.refresh_hash, await sha256Hex(String(body.refresh_token)));
  assert.equal(row.prev_refresh_hash, await sha256Hex(first), 'the old refresh is prev_refresh_hash');
  assert.equal(row.refreshed_at, NOW + 600);
  assert.equal(row.access_expires_at, NOW + 600 + 3600);
  assert.equal(await mcpStatus(env, access), 401, 'the old access token is dead');
  assert.equal(await mcpStatus(env, String(body.access_token)), 200);
  assert.equal(rows(db, `SELECT * FROM audit_log WHERE action LIKE 'agent_token.%'`).length, 1, 'a refresh writes no audit row');
});

test('old refresh within 60 s is invalid_grant and the connection lives; after 60 s it revokes with one auto_revoke row', async (t) => {
  const { db, env, c, id, refresh: first } = await connected(t);
  t.mock.timers.setTime((NOW + 10) * 1000);
  const rotated = (await (await refresh(env, c, first)).json()) as { access_token: string; refresh_token: string };

  t.mock.timers.setTime((NOW + 10 + 60) * 1000);
  const retry = await refresh(env, c, first);
  assert.equal(retry.status, 400);
  assert.equal(((await retry.json()) as Body).error, 'invalid_grant');
  assert.equal(rows(db, 'SELECT revoked_at FROM agent_tokens WHERE id = ?', id)[0].revoked_at, null, 'inside the grace the connection lives');
  assert.equal(count(db, 'agent_counters') > 0, true);
  assert.equal(await mcpStatus(env, rotated.access_token), 200);
  assert.equal(rows(db, `SELECT * FROM audit_log WHERE action = 'agent_token.auto_revoke'`).length, 0);

  t.mock.timers.setTime((NOW + 10 + 61) * 1000);
  const stolen = await refresh(env, c, first);
  assert.equal(((await stolen.json()) as Body).error, 'invalid_grant');
  const revoked = rows(db, 'SELECT revoked_at, revoke_reason FROM agent_tokens WHERE id = ?', id)[0];
  assert.equal(revoked.revoke_reason, 'refresh_reuse');
  const audit = rows(db, `SELECT * FROM audit_log WHERE action = 'agent_token.auto_revoke'`);
  assert.equal(audit.length, 1);
  assert.equal((JSON.parse(String(audit[0].details)) as Body).reason, 'refresh_reuse');
  assert.equal(await mcpStatus(env, rotated.access_token), 401);
  assert.equal(((await (await refresh(env, c, rotated.refresh_token)).json()) as Body).error, 'invalid_grant', 'the current refresh fails too');
  const again = await refresh(env, c, first);
  assert.equal(again.status, 400);
  assert.equal(rows(db, `SELECT * FROM audit_log WHERE action = 'agent_token.auto_revoke'`).length, 1, 'still one row');
});

test('two refreshes racing with one value rotate once', async (t) => {
  const { db, env, c, id, refresh: first } = await connected(t);
  const [a, b] = await Promise.all([refresh(env, c, first), refresh(env, c, first)]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 400]);
  const loser = a.status === 400 ? a : b;
  assert.equal(((await loser.json()) as Body).error, 'invalid_grant');
  const winner = (await (a.status === 200 ? a : b).json()) as { refresh_token: string };
  const row = rows(db, 'SELECT refresh_hash, prev_refresh_hash, revoked_at FROM agent_tokens WHERE id = ?', id)[0];
  assert.equal(row.refresh_hash, await sha256Hex(winner.refresh_token));
  assert.equal(row.prev_refresh_hash, await sha256Hex(first));
  assert.equal(row.revoked_at, null);
});

test('refresh of a disconnected connection is invalid_grant', async (t) => {
  const { db, env, c, id, refresh: value } = await connected(t);
  const del = await onRequestDelete({
    request: new Request(`${BASE}/api/agent-tokens/${id}`, { method: 'DELETE', headers: { Cookie: 'rsg_session=s-ed' } }), env, params: { id },
  } as never);
  assert.ok(del.status < 300, String(del.status));
  assert.ok(rows(db, 'SELECT revoked_at FROM agent_tokens WHERE id = ?', id)[0].revoked_at !== null);
  const res = await refresh(env, c, value);
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as Body).error, 'invalid_grant');
});

test('refresh after the connection\'s life ends is invalid_grant, and expires_in never runs past expires_at', async (t) => {
  const { db, env, c, id, refresh: first } = await connected(t);
  // The connection ends in 30 minutes: the next access token lives that long only.
  db.prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?').run(NOW + 1800, id);
  const res = await refresh(env, c, first);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { expires_in: number; refresh_token: string };
  assert.equal(body.expires_in, 1800);
  assert.equal(rows(db, 'SELECT access_expires_at FROM agent_tokens WHERE id = ?', id)[0].access_expires_at, NOW + 1800);
  t.mock.timers.setTime((NOW + 1800) * 1000);
  const late = await refresh(env, c, body.refresh_token);
  assert.equal(late.status, 400);
  assert.equal(((await late.json()) as Body).error, 'invalid_grant');
});

test('refresh with a value of another connection, another client or no known shape is invalid_grant and counted', async (t) => {
  const { db, DB, env, c, id, refresh: value } = await connected(t);
  const other = await dcr(DB);
  const cases: [string, Promise<Response>][] = [
    ['another client', refresh(env, other, value)],
    ['garbage', refresh(env, c, 'rsg_ort_garbage')],
    ['unknown id', refresh(env, c, `rsg_ort_${crypto.randomUUID()}.${'A'.repeat(43)}`)],
    ['right id, wrong secret', refresh(env, c, `rsg_ort_${id}.${'A'.repeat(43)}`)],
  ];
  for (const [name, p] of cases) {
    db.prepare('DELETE FROM agent_counters').run();
    const res = await p;
    assert.equal(res.status, 400, name);
    assert.equal(((await res.json()) as Body).error, 'invalid_grant', name);
  }
  assert.equal(rows(db, 'SELECT revoked_at FROM agent_tokens WHERE id = ?', id)[0].revoked_at, null, 'a wrong guess does not revoke');
  db.prepare('DELETE FROM agent_counters').run();
  assert.equal((await refresh(env, c, `rsg_ort_${id}.${'A'.repeat(43)}`)).status, 400);
  assert.equal(failuresRows(db), 1, 'a wrong guess is counted against the day only');
  // A personal token's row is never refreshable.
  const pat = await mintConnection(db, 'ed', SCOPES);
  db.prepare(`UPDATE agent_tokens SET kind = 'pat' WHERE id = ?`).run(pat.id);
  assert.equal((await refresh(env, c, pat.refresh)).status, 400);
});

test('a scope parameter on refresh is ignored', async (t) => {
  const { env, c, refresh: first } = await connected(t);
  const res = await refresh(env, c, first, { scope: 'social:draft' });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as Body).scope, SCOPES.join(' '));
});

test('refresh checks resource like the code grant, before anything is read', async (t) => {
  const { db, env, c, refresh: first } = await connected(t);
  const before = changes(db);
  const bad = await refresh(env, c, first, { resource: `${MCP_RESOURCE}/` });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as Body).error, 'invalid_target');
  assert.equal(changes(db), before);
  assert.equal((await refresh(env, c, first, { resource: MCP_RESOURCE })).status, 200, 'the value was not spent');
});

test('a refresh with a Basic-authenticated confidential client works', async (t) => {
  const { env, c, refresh: first } = await connected(t);
  const res = await call(env, { grant_type: 'refresh_token', refresh_token: first }, basic(c));
  assert.equal(res.status, 200);
});

// --- cost --------------------------------------------------------------------

test('the D1 rows written by an exchange and a refresh stay within the Global Constraints table', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const code = await makeCode(db, c);
  const before = changes(db);
  const res = await exchange(env, c, code);
  assert.equal(res.status, 200);
  const exchangeRows = changes(db) - before;
  assert.ok(exchangeRows <= 9, `exchange wrote ${exchangeRows} rows`);
  const body = (await res.json()) as { refresh_token: string };
  const mid = changes(db);
  assert.equal((await refresh(env, c, body.refresh_token)).status, 200);
  const refreshRows = changes(db) - mid;
  assert.ok(refreshRows <= 5, `refresh wrote ${refreshRows} rows`);
});

test('a refused refresh and a refused exchange write nothing beyond the failure count', async (t) => {
  const { db, DB, env } = await setup(t);
  const c = await dcr(DB);
  const before = changes(db);
  const res = await exchange(env, c, 'rsg_oac_nothing');
  assert.equal(res.status, 400);
  assert.equal(changes(db) - before, 1, 'the day\'s count only');
});

// --- shared platform addresses at /api/mcp -------------------------------------

const mcpFrom = async (env: never, value: string, ip: string) => {
  const request = new Request(`${BASE}/api/mcp`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${value}`, 'CF-Connecting-IP': ip },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  return (await (mcp.onRequestPost as unknown as (c: unknown) => Promise<Response>)({ request, env, params: {}, waitUntil() {}, data: {} })).status;
};
const junkAccess = (i: number) => `rsg_oat_${String(i).padStart(43, 'j')}`;
const failureBucket = `${String(Math.floor(NOW / DAY)).padStart(6, '0')}:g:failures`;

test('unknown rsg_oat_ bearers from one IP never cut off a valid connection from that IP, and count against the day only', async (t) => {
  const { db, env } = await setup(t);
  const conn = await mintConnection(db, 'ed', SCOPES);
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH + 2; i++) assert.equal(await mcpFrom(env, junkAccess(i), '198.51.100.20'), 401, `#${i + 1}`);
  assert.equal(await mcpFrom(env, conn.access, '198.51.100.20'), 200);
  assert.deepEqual(rows(db, `SELECT bucket FROM agent_counters WHERE bucket NOT LIKE '%:t:%'`).map((r) => r.bucket), [failureBucket]);
});

test('past the day\'s failure cap an unknown rsg_oat_ bearer writes no row', async (t) => {
  const { db, env } = await setup(t);
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(failureBucket, LIMITS.FAILURES_PER_DAY);
  const before = changes(db);
  assert.equal(await mcpFrom(env, junkAccess(1), '198.51.100.21'), 401);
  assert.equal(changes(db), before);
});

test('a personal token (rsg_pat_) is still cut off by its IP\'s failures', async (t) => {
  const { db, env } = await setup(t);
  const pat = await mintToken(db, 'ed', SCOPES);
  const { newTokenValue } = await import('../functions/_lib/agent-tokens');
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH; i++) assert.equal(await mcpFrom(env, newTokenValue(), '198.51.100.22'), 401, `#${i + 1}`);
  assert.equal(await mcpFrom(env, pat, '198.51.100.22'), 429);
});
