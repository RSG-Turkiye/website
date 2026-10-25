import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { bearer, mintToken } from './lib/agent';
import { authenticateAgent, newTokenValue, type AgentAuth } from '../functions/_lib/agent-tokens';
import { LIMITS, bump } from '../functions/_lib/agent-limits';
import { onRequest as middleware } from '../functions/api/_middleware';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const UUID = '0b6f4a52-3c1d-4e8f-9a2b-7c6d5e4f3a21';
/** A minute boundary, and DAY0 a UTC day boundary. */
const NOW = 1_800_000_000;
const DAY0 = 20_834 * 86_400;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('ed', 'g-ed', 'ed@example.org', 1, 1)`).run();
  const binds: string[] = [];
  const DB = d1(db, (sql) => binds.push(sql)) as never;
  return { db, DB, env: { DB } as never, binds };
}

const req = (method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}) =>
  new Request(`${BASE}${path}`, { method, headers: init.headers, body: init.body, duplex: 'half' } as RequestInit);

const status = (auth: AgentAuth) => (auth.kind === 'refused' ? auth.response.status : auth.kind === 'agent' ? 200 : 0);

const tokenRow = (db: DatabaseSync, id: string) => ({ ...(
  db.prepare('SELECT revoked_at, revoke_reason FROM agent_tokens WHERE id = ?').get(id) as { revoked_at: number | null; revoke_reason: string | null }) });
const revokeAudits = (db: DatabaseSync) =>
  db.prepare(`SELECT * FROM audit_log WHERE action = 'agent_token.auto_revoke'`).all() as { user_id: string | null; target_type: string; target_id: string; details: string }[];

/** A stream body of `chunks` 1 KB pieces, made only as they are pulled. */
function slowBody(chunks: number) {
  const seen = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.pulled === chunks) { controller.close(); return; }
      seen.pulled++;
      controller.enqueue(new Uint8Array(1024).fill(0x61));
    },
    cancel() { seen.cancelled = true; },
  });
  return { stream, seen };
}

test('bump: one counter per window, counted up by one upsert, expiring at the window end', async () => {
  const { DB, db } = setup();
  assert.equal(await bump(DB, 'x', 60, NOW), 1);
  assert.equal(await bump(DB, 'x', 60, NOW + 59), 2);
  assert.equal(await bump(DB, 'x', 60, NOW + 60), 1);
  const rows = db.prepare('SELECT * FROM agent_rate ORDER BY bucket').all() as { bucket: string; n: number; expires_at: number }[];
  assert.deepEqual(rows.map((r) => ({ ...r })), [
    { bucket: `x:${NOW / 60}`, n: 2, expires_at: NOW + 60 },
    { bucket: `x:${NOW / 60 + 1}`, n: 1, expires_at: NOW + 120 },
  ]);
});

test('Review Focus 4: 30 requests a minute pass, the 31st is 429 with Retry-After, the next minute passes again', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  for (let i = 0; i < 30; i++) assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + i)), 200, `request ${i + 1}`);
  const over = await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 30);
  assert.equal(over.kind, 'refused');
  const res = (over as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Too many requests', code: 'rate_limited' });
  const retry = Number(res.headers.get('Retry-After'));
  assert.ok(retry >= 1 && retry <= 60, `Retry-After ${retry}`);
  assert.equal(retry, 30);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 60)), 200);
  assert.equal(tokenRow(db, 't1').revoked_at, null);
});

test('Review Focus 4: at 90 requests in a minute the token is revoked (flood), with one audit row; the next is 401', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  const codes: number[] = [];
  for (let i = 0; i < 90; i++) codes.push(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + Math.floor(i / 2))));
  assert.deepEqual([codes.filter((c) => c === 200).length, codes.filter((c) => c === 429).length], [30, 60]);
  assert.deepEqual(tokenRow(db, 't1'), { revoked_at: NOW + 44, revoke_reason: 'flood' });
  const audits = revokeAudits(db);
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].user_id, audits[0].target_type, audits[0].target_id, JSON.parse(audits[0].details)], [null, 'agent_token', 't1', { reason: 'flood' }]);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 45)), 401);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 120)), 401);
  assert.equal(revokeAudits(db).length, 1);
});

test('the 1001st request of a UTC day is 429 until 00:00 UTC', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  // Two seconds apart: 30 a minute, never over the minute limit.
  for (let i = 0; i < 1000; i++) {
    assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, DAY0 + 2 * i)), 200, `request ${i + 1}`);
  }
  const at = DAY0 + 2000 + 60; // a fresh minute
  const over = await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, at);
  const res = (over as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 429);
  assert.equal(Number(res.headers.get('Retry-After')), DAY0 + 86_400 - at);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, DAY0 + 86_399)), 429);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, DAY0 + 86_400)), 200);
});

test('the 21st submit of a day is 429 while reads still pass', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  for (let i = 0; i < 20; i++) assert.equal(status(await authenticateAgent(req('POST', `/api/cms/drafts/${UUID}/submit`, { headers: bearer(value) }), env, NOW + i)), 200);
  assert.equal(status(await authenticateAgent(req('POST', `/api/cms/drafts/${UUID}/submit`, { headers: bearer(value) }), env, NOW + 20)), 429);
  assert.equal(status(await authenticateAgent(req('POST', `/api/social/posts/${UUID}/submit`, { headers: bearer(value) }), env, NOW + 120)), 429, 'one submit quota per token');
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 21)), 200);
  assert.equal(status(await authenticateAgent(req('PATCH', `/api/cms/drafts/${UUID}`, { headers: bearer(value), body: '{}' }), env, NOW + 22)), 200);
});

test('the 201st write and the 21st upload of a day are 429', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const image = new Uint8Array(100);
  for (let i = 0; i < 20; i++) assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: image }), env, NOW + i)), 200);
  assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: image }), env, NOW + 20)), 429);

  const other = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't2' });
  for (let i = 0; i < 200; i++) assert.equal(status(await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(other), body: '{}' }), env, DAY0 + 2 * i)), 200);
  assert.equal(status(await authenticateAgent(req('DELETE', `/api/cms/drafts/${UUID}`, { headers: bearer(other) }), env, DAY0 + 600)), 429);
});

test('a body that holds the token value is 400 leaked, and the token is revoked', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const body = JSON.stringify({ type: 'event', data: { title: `my key is ${value}` } });
  const auth = await authenticateAgent(req('POST', '/api/cms/drafts', { headers: { ...bearer(value), 'Content-Type': 'application/json' }, body }), env, NOW);
  const res = (auth as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, 'leaked');
  assert.deepEqual(tokenRow(db, 't1'), { revoked_at: NOW, revoke_reason: 'leaked' });
  assert.equal(revokeAudits(db).length, 1);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 1)), 401);

  // Whatever the Content-Type says: curl -d sends JSON as a form.
  const v2 = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't2' });
  assert.equal(status(await authenticateAgent(req('POST', '/api/cms/drafts', { headers: { ...bearer(v2), 'Content-Type': 'application/x-www-form-urlencoded' }, body: `{"x":"${v2}"}` }), env, NOW)), 400);
  // Another token's value is just text.
  const v3 = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't3' });
  assert.equal(status(await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(v3), body: JSON.stringify({ x: newTokenValue() }) }), env, NOW)), 200);
});

test('body size: 256 KB on JSON routes, by Content-Length or by a capped stream read; 5 MB on upload', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const tooLarge = { error: 'The request body is too large', code: 'too_large' };

  // Declared too large: refused before a byte is read.
  const declared = slowBody(300);
  const a = await authenticateAgent(req('POST', '/api/cms/drafts', { headers: { ...bearer(value), 'Content-Length': String(300 * 1024) }, body: declared.stream }), env, NOW);
  const aRes = (a as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(aRes.status, 413);
  assert.deepEqual(await aRes.json(), tooLarge);
  assert.ok(declared.seen.pulled <= 1, `pulled ${declared.seen.pulled} KB`);

  // Chunked, no Content-Length: read up to the cap, then cancelled.
  const chunked = slowBody(300);
  const b = await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(value), body: chunked.stream }), env, NOW + 1);
  assert.equal(status(b), 413);
  // 257 KB passes the cap; the clone (a tee) may have pulled a chunk or two ahead.
  assert.ok(chunked.seen.pulled <= 257 + 3, `read ${chunked.seen.pulled} KB of a 300 KB body past a 256 KB cap`);
  assert.equal(chunked.seen.cancelled, true);

  // 10 KB chunked passes, and the handler still reads the whole body.
  const small = slowBody(10);
  const request = req('POST', '/api/cms/drafts', { headers: bearer(value), body: small.stream });
  assert.equal(status(await authenticateAgent(request, env, NOW + 2)), 200);
  assert.equal((await request.text()).length, 10 * 1024);

  // 4 MB to the upload route passes the size check; just over 5 MB does not.
  const four = req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: new Uint8Array(4 * 1024 * 1024) });
  assert.equal(status(await authenticateAgent(four, env, NOW + 3)), 200);
  assert.equal((await four.arrayBuffer()).byteLength, 4 * 1024 * 1024);
  assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: slowBody(5 * 1024 + 1).stream }), env, NOW + 4)), 413);
  assert.equal(LIMITS.UPLOAD_BODY_BYTES, 5 * 1024 * 1024);
});

/** The middleware with a clock and a handler that runs the token gate, as cmsGate will. */
async function throughMiddleware(env: unknown, request: Request, now: number) {
  const realNow = Date.now;
  Date.now = () => now * 1000;
  try {
    return await (middleware as unknown as (c: unknown) => Promise<Response>)({
      request, env, params: {}, waitUntil() {},
      next: async () => {
        const auth = await authenticateAgent(request, env as never, now);
        return auth.kind === 'refused' ? auth.response : new Response('handler');
      },
    });
  } finally {
    Date.now = realNow;
  }
}

test('20 human_only refusals in a day revoke the token (refusals), with one audit row', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  for (let i = 0; i < 19; i++) assert.equal((await throughMiddleware(env, req('POST', `/api/cms/drafts/${UUID}/approve`, { headers: bearer(value) }), NOW + i)).status, 403);
  assert.equal(tokenRow(db, 't1').revoked_at, null);
  assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: bearer(value) }), NOW + 19)).status, 403);
  assert.deepEqual(tokenRow(db, 't1'), { revoked_at: NOW + 19, revoke_reason: 'refusals' });
  const audits = revokeAudits(db);
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].target_id, JSON.parse(audits[0].details)], ['t1', { reason: 'refusals' }]);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: bearer(value) }), NOW + 20)).status, 401);
  for (let i = 0; i < 5; i++) await throughMiddleware(env, req('GET', '/api/me', { headers: bearer(value) }), NOW + 21 + i);
  assert.equal(revokeAudits(db).length, 1);

  // A made-up token sprayed at refused routes writes no audit row.
  const fake = newTokenValue();
  for (let i = 0; i < 25; i++) await throughMiddleware(env, req('GET', '/api/me', { headers: bearer(fake) }), NOW + 30 + i);
  assert.equal(revokeAudits(db).length, 1);
});

test('11 bad tokens from one IP in 10 minutes: the 11th and a valid token from that IP get 429; another IP does not', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  const from = (ip: string, token: string) => req('GET', '/api/cms/drafts', { headers: { ...bearer(token), 'CF-Connecting-IP': ip } });
  for (let i = 0; i < 10; i++) assert.equal((await throughMiddleware(env, from('192.0.2.1', newTokenValue()), NOW + i * 30)).status, 401, `bad ${i + 1}`);
  const eleventh = await throughMiddleware(env, from('192.0.2.1', newTokenValue()), NOW + 310);
  assert.equal(eleventh.status, 429);
  assert.equal(Number(eleventh.headers.get('Retry-After')), 600 - 310);
  assert.equal((await throughMiddleware(env, from('192.0.2.1', value), NOW + 311)).status, 429);
  assert.equal((await throughMiddleware(env, from('198.51.100.7', value), NOW + 312)).status, 200);
  // The next window lets that IP in again.
  assert.equal((await throughMiddleware(env, from('192.0.2.1', value), NOW + 600)).status, 200);
});

test('per IP: the 61st bearer request in a minute is 429, valid or not', async () => {
  const { db, env } = setup();
  const values = [await mintToken(db, 'ed', ['cms.etkinlikler:read']), await mintToken(db, 'ed', ['cms.etkinlikler:read']), await mintToken(db, 'ed', ['cms.etkinlikler:read'])];
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  for (let i = 0; i < 60; i++) {
    assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(values[i % 3]), ...ip } }), NOW + i % 60)).status, 200, `request ${i + 1}`);
  }
  const res = await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(values[0]), ...ip } }), NOW + 59);
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Retry-After'), '1');
  // The IP stays hashed: no row holds the address.
  assert.ok(!JSON.stringify(db.prepare('SELECT bucket FROM agent_rate').all()).includes('203.0.113.9'));
});

test('one allowed GET through authenticateAgent and checkToken runs at most 8 statements', async () => {
  const { db, env, binds } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW)), 200);
  assert.ok(binds.length <= 8, `${binds.length} statements:\n${binds.join('\n')}`);
  // A submit adds its quota bucket and stays within the bound too.
  binds.length = 0;
  const writer = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't2' });
  assert.equal(status(await authenticateAgent(req('POST', `/api/cms/drafts/${UUID}/submit`, { headers: bearer(writer) }), env, NOW)), 200);
  assert.ok(binds.length <= 8, `${binds.length} statements:\n${binds.join('\n')}`);
});
