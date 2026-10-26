// /oauth/register (plan 6, Task 6): RFC 7591 registration, capped and rate limited.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubHttp } from './lib/http';
import * as register from '../functions/oauth/register';
import { REGISTRATIONS_PER_DAY, REGISTRATIONS_PER_IP } from '../functions/_lib/agent-limits';
import { resolveClient } from '../functions/_lib/oauth-clients';
import { sha256Hex } from '../functions/_lib/oauth-config';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
type Handler = (c: unknown) => Response | Promise<Response>;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, DB: d1(db) as never as D1Database };
}
const snapshot = (db: DatabaseSync) => JSON.stringify([
  db.prepare('SELECT * FROM oauth_clients ORDER BY id').all(),
  db.prepare('SELECT * FROM agent_counters ORDER BY bucket').all(),
]);

function post(DB: D1Database, body: BodyInit, headers: Record<string, string> = { 'Content-Type': 'application/json' }, ip = '203.0.113.7') {
  const request = new Request('https://rsg-turkiye.iscbsc.org/oauth/register', {
    method: 'POST', body, headers: { ...headers, 'CF-Connecting-IP': ip },
  });
  return (register.onRequestPost as unknown as Handler)({ request, env: { DB }, params: {}, waitUntil: () => {}, data: {} });
}
const json = (DB: D1Database, meta: unknown, ip?: string) => post(DB, JSON.stringify(meta), undefined, ip);
const cursor = { client_name: 'Cursor', redirect_uris: ['cursor://anysphere.cursor-retrieval/oauth/callback', 'http://127.0.0.1:33418/cb', 'http://localhost:7777/cb'] };

test('a Cursor-style registration with three redirect URIs is 201 and stores a hash, not the secret', async () => {
  const { db, DB } = setup();
  const res = await json(DB, { ...cursor, token_endpoint_auth_method: 'client_secret_post' });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  const out = await res.json() as Record<string, unknown>;
  assert.match(String(out.client_id), /^rsg_oc_/);
  assert.match(String(out.client_secret), /^rsg_ocs_/);
  assert.equal(out.token_endpoint_auth_method, 'client_secret_post');
  assert.equal(out.client_secret_expires_at, 0);
  assert.equal(out.client_name, 'Cursor');
  assert.deepEqual(out.redirect_uris, cursor.redirect_uris);
  assert.deepEqual(out.grant_types, ['authorization_code', 'refresh_token']);
  assert.deepEqual(out.response_types, ['code']);
  assert.equal(typeof out.client_id_issued_at, 'number');
  const row = db.prepare('SELECT * FROM oauth_clients').get() as { secret_hash: string };
  assert.equal(row.secret_hash, await sha256Hex(String(out.client_secret)));
  assert.ok(!JSON.stringify(row).includes(String(out.client_secret)));
  assert.deepEqual(db.prepare("SELECT requests FROM agent_counters WHERE bucket LIKE '%:r:%' OR bucket LIKE '%:g:registrations'").all().map((r) => r.requests), [1, 1]);
});

test('no token_endpoint_auth_method means client_secret_basic; none still returns a secret', async () => {
  const { DB } = setup();
  const basic = await (await json(DB, cursor)).json() as Record<string, unknown>;
  assert.equal(basic.token_endpoint_auth_method, 'client_secret_basic');
  const none = await json(DB, { ...cursor, token_endpoint_auth_method: 'none' });
  assert.equal(none.status, 201);
  const out = await none.json() as Record<string, unknown>;
  assert.equal(out.token_endpoint_auth_method, 'none');
  assert.match(String(out.client_secret), /^rsg_ocs_/);
  assert.match(String(out.client_id), /^rsg_oc_/);
});

test('the 11th registration from one IP and the 201st of the day are 429 and write nothing', async () => {
  const { db, DB } = setup();
  for (let i = 0; i < REGISTRATIONS_PER_IP; i++) assert.equal((await json(DB, cursor)).status, 201);
  const before = snapshot(db);
  const res = await json(DB, cursor);
  assert.equal(res.status, 429);
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(snapshot(db), before);

  const day = db.prepare("SELECT bucket FROM agent_counters WHERE bucket LIKE '%:g:registrations'").get() as { bucket: string };
  db.prepare('UPDATE agent_counters SET requests = ? WHERE bucket = ?').run(REGISTRATIONS_PER_DAY, day.bucket);
  const full = snapshot(db);
  assert.equal((await json(DB, cursor, '198.51.100.9')).status, 429);
  assert.equal(snapshot(db), full);
});

test('the cap holds inside the batch when the pre-check passed', async () => {
  const { db, DB } = setup();
  const requests = await Promise.all(Array.from({ length: REGISTRATIONS_PER_IP }, () => json(DB, cursor)));
  assert.ok(requests.every((r) => r.status === 201));
  // Simulate a request that read the counters before the last one wrote: the guard alone must refuse.
  const { registerStatement } = await import('../functions/_lib/oauth-clients');
  const { registrationBumps, registrationGuard, ipKey } = await import('../functions/_lib/agent-limits');
  const ip = await ipKey(new Request('https://x.test', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }));
  const now = Math.floor(Date.now() / 1000);
  const before = snapshot(db);
  const { statement } = await registerStatement(DB, { name: 'x', redirectUris: ['https://a.example/cb'], authMethod: 'none', now, guard: registrationGuard(ip, now) });
  const out = await DB.batch([statement, ...registrationBumps(DB, ip, now, true)]);
  assert.equal(out[0].meta.changes, 0);
  assert.equal(snapshot(db), before);
});

test('the day half of the guard alone refuses: the IP is under its cap, the day is at 200', async () => {
  const { db, DB } = setup();
  const { registerStatement } = await import('../functions/_lib/oauth-clients');
  const { registrationGuard } = await import('../functions/_lib/agent-limits');
  const now = Math.floor(Date.now() / 1000);
  const day = `${String(Math.floor(now / 86_400)).padStart(6, '0')}:g:registrations`;
  const attempt = async (ip: string) => {
    const { statement } = await registerStatement(DB, { name: 'x', redirectUris: ['https://a.example/cb'], authMethod: 'none', now, guard: registrationGuard(ip, now) });
    return (await statement.run()).meta.changes;
  };
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(day, REGISTRATIONS_PER_DAY - 1);
  assert.equal(await attempt('fresh-ip'), 1, 'one slot left');
  db.prepare('UPDATE agent_counters SET requests = ? WHERE bucket = ?').run(REGISTRATIONS_PER_DAY, day);
  const before = snapshot(db);
  assert.equal(await attempt('another-ip'), 0, 'a full day refuses an IP that has registered nothing');
  assert.equal(snapshot(db), before);
});

/** A DB whose first `stale` reads of the registration counters see none, as if a parallel request had not written yet. */
function staleCounters(db: DatabaseSync, stale: number, failBatch = false) {
  const real = d1(db);
  let left = stale;
  return {
    ...real,
    prepare(sql: string) {
      const st = real.prepare(sql);
      if (!sql.includes('FROM agent_counters WHERE bucket IN') || left <= 0) return st;
      left--;
      return { bind: () => ({ all: async () => ({ results: [] }) }) };
    },
    batch: failBatch ? async () => { throw new Error('D1 is down'); } : real.batch,
  } as never as D1Database;
}

test('the guard refusing an insert the pre-check let through is a 429 with Retry-After and writes nothing', async () => {
  const { db, DB } = setup();
  for (let i = 0; i < REGISTRATIONS_PER_IP; i++) assert.equal((await json(DB, cursor)).status, 201);
  const before = snapshot(db);
  // Only the pre-check read is stale: the guard refuses in the batch, and the re-read tells the true story.
  const raced = await json(staleCounters(db, 1), cursor);
  assert.equal(raced.status, 429);
  assert.deepEqual(await raced.json(), { error: 'rate_limited' });
  assert.ok(Number(raced.headers.get('Retry-After')) > 0);
  assert.equal(raced.headers.get('Cache-Control'), 'no-store');
  assert.equal(raced.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(snapshot(db), before, 'the refused registration wrote no client and bumped no counter');
  // Both reads stale: the fallback answer, a minute.
  const both = await json(staleCounters(db, 2), cursor);
  assert.equal(both.status, 429);
  assert.equal(both.headers.get('Retry-After'), '60');
  assert.equal(snapshot(db), before);
});

test('the content type is application/json, with parameters allowed and no look-alikes', async () => {
  const { db, DB } = setup();
  const body = JSON.stringify(cursor);
  for (const type of ['application/json', 'Application/JSON', 'application/json; charset=utf-8', ' application/json ;charset=UTF-8']) {
    assert.equal((await post(DB, body, { 'Content-Type': type })).status, 201, type);
  }
  const before = snapshot(db);
  for (const type of ['application/jsonx', 'application/json-patch+json', 'application/jsonp', 'text/plain', 'application/x-www-form-urlencoded', '']) {
    const res = await post(DB, body, type ? { 'Content-Type': type } : {});
    assert.equal(res.status, 400, `"${type}"`);
    assert.equal(((await res.json()) as Record<string, string>).error, 'invalid_client_metadata');
  }
  assert.equal(snapshot(db), before);
});

test('a batch that throws answers a JSON 500 with CORS, not a bare one', async () => {
  const { db, DB } = setup();
  void DB;
  const res = await json(staleCounters(db, 0, true), cursor);
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.deepEqual(await res.json(), { error: 'server_error' });
});

test('a bad redirect URI is 400 invalid_redirect_uri and writes nothing', async () => {
  const { db, DB } = setup();
  const before = snapshot(db);
  const res = await json(DB, { redirect_uris: ['http://evil.example/cb'] });
  assert.equal(res.status, 400);
  const out = await res.json() as Record<string, string>;
  assert.equal(out.error, 'invalid_redirect_uri');
  assert.ok(out.error_description);
  assert.equal(snapshot(db), before);
  const meta = await json(DB, { redirect_uris: ['https://a.example/cb'], token_endpoint_auth_method: 'private_key_jwt' });
  assert.equal(meta.status, 400);
  assert.equal(((await meta.json()) as Record<string, string>).error, 'invalid_client_metadata');
  assert.equal(snapshot(db), before);
});

test('a 9 KB body is 400, form-encoded is 400, invalid JSON is 400; none write', async () => {
  const { db, DB } = setup();
  const before = snapshot(db);
  const big = await json(DB, { ...cursor, client_name: 'x'.repeat(9 * 1024) });
  assert.equal(big.status, 400);
  assert.equal(((await big.json()) as Record<string, string>).error, 'invalid_client_metadata');
  const form = await post(DB, 'redirect_uris=https%3A%2F%2Fa.example%2Fcb', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(form.status, 400);
  assert.equal((await post(DB, '{not json')).status, 400);
  assert.equal(snapshot(db), before);
});

test('logo_uri, client_uri, jwks_uri and tos_uri are ignored and never fetched', async () => {
  const { DB } = setup();
  const http = stubHttp([], () => undefined);
  try {
    const res = await json(DB, {
      ...cursor, logo_uri: 'https://logo.example/l.png', client_uri: 'https://client.example/', jwks_uri: 'https://jwks.example/k', tos_uri: 'https://tos.example/t',
    });
    assert.equal(res.status, 201);
    assert.equal(http.calls.length, 0);
    assert.ok(!('logo_uri' in ((await res.json()) as object)));
  } finally { http.restore(); }
});

test('the registered client resolves with the same redirect URIs', async () => {
  const { DB } = setup();
  const out = await (await json(DB, cursor)).json() as { client_id: string };
  const client = await resolveClient(DB, out.client_id);
  assert.ok(!('error' in client));
  if ('error' in client) return;
  assert.deepEqual(client.redirectUris, cursor.redirect_uris);
  assert.equal(client.kind, 'dcr');
});

test('OPTIONS answers the CORS preflight', async () => {
  const res = await (register.onRequestOptions as unknown as Handler)({});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
});
