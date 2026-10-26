import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { bearer, mintToken } from './lib/agent';
import { authenticateAgent, newTokenValue, type AgentAuth } from '../functions/_lib/agent-tokens';
import { LIMITS, countFailedAuth, AGENT_BUDGET, AGENT_WRITE_BUDGET, autoRevoke, holdsValue, ipSubject } from '../functions/_lib/agent-limits';
import { onRequest as middleware } from '../functions/api/_middleware';
import { grantRole } from '../functions/_lib/role-grants';

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

/** The zero-padded UTC day that starts every counter key. */
const dayKey = (now: number) => String(Math.floor(now / 86_400)).padStart(6, '0');
/** Rows changed on this connection so far: a request that writes nothing leaves it unchanged. */
const changes = (db: DatabaseSync) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const counters = (db: DatabaseSync) => db.prepare('SELECT * FROM agent_counters ORDER BY bucket').all() as Record<string, unknown>[];
/** Another member's token row for today, holding `general` and `reserve` requests: the agents' pools, spent. */
function spend(db: DatabaseSync, now: number, general: number, reserve = 0) {
  db.prepare('INSERT INTO agent_counters (bucket, user_id, general, reserve) VALUES (?, ?, ?, ?)').run(`${dayKey(now)}:t:someone-else`, 'other', general, reserve);
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

test('an allowed request writes one counter row, its token\'s, keyed by the UTC day; nothing for its IP', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW)), 200);
  const rows = counters(db);
  assert.deepEqual(rows.map((r) => [r.bucket, r.user_id, r.general, r.minute_n]), [[`${dayKey(NOW)}:t:t1`, 'ed', 1, 1]]);
  const before = changes(db);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 1)), 200);
  assert.equal(changes(db) - before, 1, 'one upsert');
  assert.equal(counters(db).length, 1);
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

test('the 301st request of a member\'s UTC day, across all their tokens, is 429 until 00:00 UTC, and writes nothing', async () => {
  const { db, env } = setup();
  const a = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  const b = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't2' });
  // Two seconds apart per token: never over a minute limit.
  for (let i = 0; i < 300; i++) {
    assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(i % 2 ? b : a) }), env, DAY0 + i)), 200, `request ${i + 1}`);
  }
  const at = DAY0 + 600;
  const before = changes(db);
  const over = await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(a) }), env, at);
  const res = (over as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'Too many requests', code: 'rate_limited', resets: '00:00 UTC' });
  assert.equal(Number(res.headers.get('Retry-After')), DAY0 + 86_400 - at);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(b) }), env, DAY0 + 86_399)), 429);
  assert.equal(changes(db), before, 'a refusal for the day writes nothing');
  // Another member is not affected; the next day the member starts again.
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('ed2', 'g-ed2', 'ed2@example.org', 1, 1)`).run();
  const c = await mintToken(db, 'ed2', ['cms.etkinlikler:read'], { id: 't3' });
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(c) }), env, DAY0 + 700)), 200);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(a) }), env, DAY0 + 86_400)), 200);
  assert.equal(LIMITS.MEMBER_PER_DAY, 300);
});

test('the agents\' budget: 12,000 general a day, then 3,000 for social work only; 429 agent_budget until 00:00 UTC, with no write', async () => {
  const { db, env } = setup();
  assert.deepEqual([LIMITS.AGENT_GENERAL_PER_DAY, LIMITS.AGENT_RESERVE_PER_DAY, AGENT_BUDGET], [12_000, 3_000, 15_000]);
  const cms = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const social = await mintToken(db, 'ed', ['social:draft'], { id: 't2' });
  spend(db, NOW, LIMITS.AGENT_GENERAL_PER_DAY - 1);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(cms) }), env, NOW)), 200, 'the last general request');

  const before = changes(db);
  const over = await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(cms), body: '{}' }), env, NOW + 1);
  const res = (over as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 429);
  const left = 86_400 - ((NOW + 1) % 86_400);
  assert.deepEqual(await res.json(), {
    error: 'Too many requests', code: 'agent_budget', retry_after: left,
    message: 'Ajan kotası bugün doldu, yarın tekrar deneyin / Agent quota is used up for today, try again tomorrow',
  });
  assert.equal(Number(res.headers.get('Retry-After')), left);
  assert.equal(changes(db), before);

  // A token that may not do social work now does not reach the reserve, even on a social route.
  const noSocial = await authenticateAgent(req('GET', '/api/social/posts', { headers: bearer(social) }), env, NOW + 2);
  assert.equal(((await (noSocial as Extract<AgentAuth, { kind: 'refused' }>).response.json()) as { code: string }).code, 'agent_budget');
  await grantRole(env.DB as never, { userId: 'ed', role: 'social', expiresAt: null, by: null }, NOW - 100);

  // Social routes go on, from the reserve; a cms route does not.
  for (const [method, path] of [['GET', '/api/social/posts'], ['POST', '/api/social/posts'], ['POST', `/api/social/posts/${UUID}/submit`], ['PATCH', `/api/social/plans/${UUID}`]]) {
    assert.equal(status(await authenticateAgent(req(method, path, { headers: bearer(social), body: method === 'GET' ? undefined : '{}' }), env, NOW + 2)), 200, `${method} ${path}`);
  }
  const mine = counters(db).find((r) => r.bucket === `${dayKey(NOW)}:t:t2`)!;
  assert.deepEqual([mine.general, mine.reserve], [0, 4]);
  // An upload is social work for a token that may draft social posts now (scope and a live grant).
  const upload = () => authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(social), body: new Uint8Array(10) }), env, NOW + 3);
  assert.equal(status(await upload()), 200);
  assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(cms), body: new Uint8Array(10) }), env, NOW + 3)), 429, 'a cms token\'s upload is not');

  // With the reserve spent too, social waits as well.
  db.prepare('UPDATE agent_counters SET reserve = ? WHERE bucket = ?').run(LIMITS.AGENT_RESERVE_PER_DAY, `${dayKey(NOW)}:t:someone-else`);
  const spent = await authenticateAgent(req('GET', '/api/social/posts', { headers: bearer(social) }), env, NOW + 4);
  assert.equal(((await (spent as Extract<AgentAuth, { kind: 'refused' }>).response.json()) as { code: string }).code, 'agent_budget');
  // The next UTC day, everyone starts again.
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(cms) }), env, NOW + 86_400)), 200);
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

  // Checked before the counters: a token over its minute limit is still revoked for a leak.
  const v4 = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't4' });
  for (let i = 0; i < 30; i++) await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(v4) }), env, NOW + 120);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(v4) }), env, NOW + 121)), 429);
  assert.equal(status(await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(v4), body: `{"x":"${v4}"}` }), env, NOW + 122)), 400);
  assert.equal(tokenRow(db, 't4').revoke_reason, 'leaked');
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

  // A body over the cap still counts: one request, and a write on a write route.
  const before = counters(db).find((r) => r.bucket === `${dayKey(NOW)}:t:t1`)!;
  assert.equal(status(await authenticateAgent(req('PATCH', `/api/cms/drafts/${UUID}`, { headers: { ...bearer(value), 'Content-Length': String(300 * 1024) }, body: slowBody(300).stream }), env, NOW + 5)), 413);
  const after = counters(db).find((r) => r.bucket === `${dayKey(NOW)}:t:t1`)!;
  assert.deepEqual([Number(after.general) - Number(before.general), Number(after.writes) - Number(before.writes)], [1, 1]);
  assert.equal(tokenRow(db, 't1').revoked_at, null);
});

test('an upload is searched as bytes for rsg_pat_ (any token value), across chunk ends: 400 leaked and the token revoked', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: new TextEncoder().encode('GIF89a rsg_pa t_') }), env, NOW)), 200);
  // The prefix split over two chunks of a stream.
  const parts = ['GIF89a ....... rsg_p', `at_${'A'.repeat(43)} more`].map((t) => new TextEncoder().encode(t));
  const stream = new ReadableStream<Uint8Array>({ pull(c) { const next = parts.shift(); if (next) c.enqueue(next); else c.close(); } });
  const auth = await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: stream }), env, NOW + 1);
  const res = (auth as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, 'leaked');
  assert.deepEqual(tokenRow(db, 't1'), { revoked_at: NOW + 1, revoke_reason: 'leaked' });
  // Its own value in one piece too.
  const v2 = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't2' });
  assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(v2), body: new TextEncoder().encode(`GIF89a ${v2}`) }), env, NOW + 2)), 400);
});

test('the leak check sees the value percent-encoded, as HTML character references, JSON-escaped, or split across strings', async () => {
  const value = newTokenValue();
  const pct = [...value].map((c, i) => (i % 3 ? c : `%${c.charCodeAt(0).toString(16)}`)).join('');
  const ent = `&#x72;${value.slice(1, 7)}&lowbar;${value.slice(8)}`;
  const dec = `&#114;${value.slice(1)}`;
  for (const text of [
    value, `{"a":"${pct}"}`, pct, `{"a":"${ent}"}`, dec, `{"a":"\\u0072${value.slice(1)}"}`,
    JSON.stringify({ a: value.slice(0, 20), b: { c: [value.slice(20)] } }), JSON.stringify({ a: encodeURIComponent(ent) }),
  ]) {
    assert.equal(holdsValue(text, value), true, text);
  }
  for (const text of ['', JSON.stringify({ a: newTokenValue() }), `{"a":"${value.slice(0, 20)}"}`, '%zz&#xzz;']) {
    assert.equal(holdsValue(text, value), false, text);
  }
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

test('valid tokens are not counted per IP: three tokens from one address make 90 requests in a minute, no IP row', async () => {
  const { db, env } = setup();
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('ed2', 'g-ed2', 'ed2@example.org', 1, 1), ('ed3', 'g-ed3', 'ed3@example.org', 1, 1)`).run();
  const values = [await mintToken(db, 'ed', ['cms.etkinlikler:read']), await mintToken(db, 'ed2', ['cms.etkinlikler:read']), await mintToken(db, 'ed3', ['cms.etkinlikler:read'])];
  const ip = { 'CF-Connecting-IP': '203.0.113.9' };
  for (let i = 0; i < 90; i++) {
    assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(values[i % 3]), ...ip } }), NOW + (i % 60))).status, 200, `request ${i + 1}`);
  }
  assert.ok(counters(db).every((r) => String(r.bucket).includes(':t:')), 'token rows only');
});

test('one allowed request through authenticateAgent runs at most 6 statements, one of them a counter upsert', async () => {
  const { db, env, binds } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW)), 200);
  // The counters read, the token, the member, the grants, one upsert, and last_used_at at most every 5 minutes.
  assert.ok(binds.length <= 6, `${binds.length} statements:\n${binds.join('\n')}`);
  assert.equal(binds.filter((b) => /INSERT INTO agent_counters/.test(b)).length, 1);
  // A submit spends its quota in the same token upsert: no more statements.
  binds.length = 0;
  const writer = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't2' });
  assert.equal(status(await authenticateAgent(req('POST', `/api/cms/drafts/${UUID}/submit`, { headers: bearer(writer) }), env, NOW)), 200);
  assert.ok(binds.length <= 6, `${binds.length} statements:\n${binds.join('\n')}`);
  assert.equal(binds.filter((b) => /INSERT INTO agent_counters/.test(b)).length, 1);
});

// --- fix round 1 ---------------------------------------------------------

test('Review Focus 4: from one IP, the 50th attempt in a minute revokes the token (flood), refused attempts counted; the next is 401', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  const ip = { 'CF-Connecting-IP': '192.0.2.10' };
  const codes: number[] = [];
  for (let i = 0; i < 50; i++) codes.push((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), ...ip } }), NOW + Math.floor(i / 2))).status);
  assert.deepEqual([codes.filter((c) => c === 200).length, codes.filter((c) => c === 429).length], [30, 20]);
  assert.deepEqual(tokenRow(db, 't1'), { revoked_at: NOW + 24, revoke_reason: 'flood' });
  const audits = revokeAudits(db);
  assert.equal(audits.length, 1);
  assert.deepEqual([audits[0].user_id, audits[0].target_type, audits[0].target_id, JSON.parse(audits[0].details)], [null, 'agent_token', 't1', { reason: 'flood' }]);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), ...ip } }), NOW + 25)).status, 401);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), ...ip } }), NOW + 120)).status, 401);
  assert.equal(revokeAudits(db).length, 1);
});

test('flood from several IPs, each well under its own limit, revokes the token too', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  for (let i = 0; i < 50; i++) {
    await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), 'CF-Connecting-IP': `198.51.100.${i % 5}` } }), NOW + i);
  }
  assert.equal(tokenRow(db, 't1').revoke_reason, 'flood');
  assert.equal(revokeAudits(db).length, 1);
});

test('a revoke that failed at the threshold is made by the next attempt past it, still with one audit row', async () => {
  const { db, DB, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  // Push the minute count past the threshold without a revoke, as a failed write would leave it.
  db.prepare('INSERT INTO agent_counters (bucket, user_id, minute, minute_n) VALUES (?, ?, ?, ?)').run(`${dayKey(NOW)}:t:t1`, 'ed', NOW / 60, LIMITS.FLOOD_PER_MINUTE);
  assert.equal(tokenRow(db, 't1').revoked_at, null);
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 1)), 429);
  assert.equal(tokenRow(db, 't1').revoke_reason, 'flood');
  assert.equal(revokeAudits(db).length, 1);
  // A token a person already revoked gets no automatic row.
  await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't2', revokedAt: NOW - 5 });
  assert.equal(await autoRevoke(DB, 't2', 'flood', NOW), false);
  assert.equal(await autoRevoke(DB, 't1', 'flood', NOW), false);
  assert.equal(revokeAudits(db).length, 1);
});

test('made-up values write no row per value: they count as failed authentications of the IP, which is then refused with no write at all', async () => {
  const { db, env } = setup();
  const ip = { 'CF-Connecting-IP': '203.0.113.20' };
  // Outside the table (403) and inside it (401) alike.
  for (let i = 0; i < 5; i++) assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: { ...bearer(newTokenValue()), ...ip } }), NOW + i)).status, 403);
  for (let i = 0; i < 5; i++) assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), ...ip } }), NOW + 5 + i)).status, 401);
  const rows = counters(db);
  assert.deepEqual(rows.map((r) => String(r.bucket).split(':')[1]), ['g', 'i'], 'two rows: the day\'s failures and the IP');
  assert.deepEqual([rows[1].fail_n, rows[1].requests, rows[0].requests], [10, 10, 10]);
  const before = changes(db);
  for (let i = 0; i < 25; i++) {
    const res = await throughMiddleware(env, req(i % 2 ? 'GET' : 'POST', i % 2 ? '/api/me' : '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), ...ip } }), NOW + 11);
    assert.equal(res.status, 429);
  }
  assert.equal(changes(db), before, 'a cut-off IP costs no write');
  // A header that is no token value, on a route outside the table, writes nothing either.
  for (let i = 0; i < 5; i++) assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: { Authorization: 'Basic eDp5', 'CF-Connecting-IP': '203.0.113.21' } }), NOW)).status, 403);
  assert.equal(changes(db), before);
});

test('a revoked or expired token\'s retries are 401 without counting against its IP, so they lock no one else out', async () => {
  const { db, env } = setup();
  const dead = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 'dead', revokedAt: NOW - 10 });
  const old = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 'old', expiresAt: NOW - 10 });
  const live = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 'live' });
  const ip = { 'CF-Connecting-IP': '192.0.2.50' };
  const before = changes(db);
  for (let i = 0; i < 15; i++) {
    assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(i % 2 ? dead : old), ...ip } }), NOW + i)).status, 401);
    assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: { ...bearer(dead), ...ip } }), NOW + i)).status, 403);
  }
  assert.equal(changes(db), before, 'nothing written');
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(live), ...ip } }), NOW + 20)).status, 200);
});

test('an IPv6 address counts by its /64', async () => {
  assert.equal(ipSubject('2001:db8:1:2:aaaa::1'), '2001:db8:1:2::/64');
  assert.equal(ipSubject('2001:0db8:0001:0002:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(ipSubject('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(ipSubject('::1'), '0:0:0:0::/64');
  assert.equal(ipSubject('192.0.2.1'), '192.0.2.1');
  assert.equal(ipSubject('::ffff:192.0.2.1'), '192.0.2.1');
  const { env } = setup();
  for (let i = 0; i < 10; i++) {
    await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': `2001:db8:1:2::${i.toString(16)}` } }), NOW + i);
  }
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': '2001:db8:1:2:ffff::9' } }), NOW + 11)).status, 429);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': '2001:db8:1:3::1' } }), NOW + 12)).status, 401);
});

test('a request without an Authorization header (a person in the panel) is never counted', async () => {
  const { db, env } = setup();
  spend(db, NOW, AGENT_BUDGET);
  const before = changes(db);
  let reached = false;
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request: req('POST', '/api/cms/drafts', { headers: { Cookie: 'rsg_session=s-ed' } }), env, params: {}, waitUntil() {},
    next: async () => { reached = true; return new Response('handler'); },
  });
  assert.equal(await res.text(), 'handler');
  assert.ok(reached);
  assert.equal(changes(db), before);
});

test('per IP: past 3000 bearer requests in a UTC day, 429 until 00:00 UTC, with no write', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  const ip = { 'CF-Connecting-IP': '203.0.113.30' };
  // IP rows count failures only: one made-up value makes the row, then it is set to the day's limit.
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), ...ip } }), DAY0 + 10)).status, 401);
  db.prepare('UPDATE agent_counters SET requests = ?, fail_n = 0 WHERE bucket LIKE ?').run(LIMITS.IP_PER_DAY, `${dayKey(DAY0)}:i:%`);
  const before = changes(db);
  const res = await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), ...ip } }), DAY0 + 3060);
  assert.equal(res.status, 429);
  assert.equal(Number(res.headers.get('Retry-After')), 86_400 - 3060);
  assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: { ...bearer(value), ...ip } }), DAY0 + 3061)).status, 429, 'a route outside the table too');
  assert.equal(changes(db), before);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), 'CF-Connecting-IP': '203.0.113.31' } }), DAY0 + 3062)).status, 200);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(value), ...ip } }), DAY0 + 86_400)).status, 200);
});

test('past 5,000 failures a day from all addresses, a made-up value is refused with no D1 write at all; valid tokens go on', async () => {
  const { db, env } = setup();
  assert.equal(LIMITS.FAILURES_PER_DAY, 5_000);
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:read'], { id: 't1' });
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(`${dayKey(NOW)}:g:failures`, LIMITS.FAILURES_PER_DAY - 1);
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': '192.0.2.70' } }), NOW)).status, 401, 'the last one counted');
  const before = changes(db);
  for (let i = 0; i < 20; i++) {
    const ip = { 'CF-Connecting-IP': `192.0.2.${100 + i}` };
    assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), ...ip } }), NOW + 1)).status, 401);
    assert.equal((await throughMiddleware(env, req('GET', '/api/me', { headers: { ...bearer(newTokenValue()), ...ip } }), NOW + 1)).status, 403);
    assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { Authorization: 'Basic eDp5', ...ip } }), NOW + 1)).status, 401);
  }
  assert.equal(changes(db), before, 'no write');
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(value) }), env, NOW + 2)), 200);
  // The next UTC day counts again.
  assert.equal((await throughMiddleware(env, req('GET', '/api/cms/drafts', { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': '192.0.2.71' } }), NOW + 86_400)).status, 401);
  assert.ok(changes(db) > before);
});

test('a burst of failures judged by a stale snapshot still cannot pass 5,000 a day or an IP\'s window limit (the writer enforces the cap)', async () => {
  const { db, DB } = setup();
  const stale = { ip: null, failures: 0, tokens: [] };
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(`${dayKey(NOW)}:g:failures`, LIMITS.FAILURES_PER_DAY);
  const before = changes(db);
  for (let i = 0; i < 5; i++) await countFailedAuth(DB, 'ip-a', stale, NOW, false);
  assert.equal((db.prepare('SELECT requests FROM agent_counters WHERE bucket = ?').get(`${dayKey(NOW)}:g:failures`) as { requests: number }).requests, LIMITS.FAILURES_PER_DAY);
  assert.equal(changes(db), before, 'no write at the cap');
  // One short of the cap: exactly one of a concurrent pair gets in.
  db.prepare('UPDATE agent_counters SET requests = ? WHERE bucket LIKE ?').run(LIMITS.FAILURES_PER_DAY - 1, `${dayKey(NOW)}:g:failures`);
  for (let i = 0; i < 2; i++) await countFailedAuth(DB, 'ip-a', stale, NOW, false); // each read the same stale count
  assert.equal((db.prepare('SELECT requests FROM agent_counters WHERE bucket = ?').get(`${dayKey(NOW)}:g:failures`) as { requests: number }).requests, LIMITS.FAILURES_PER_DAY);
  // The IP's own failure count stops at its window limit too.
  const ipKeyOf = () => (db.prepare(`SELECT bucket FROM agent_counters WHERE bucket LIKE ?`).get(`${dayKey(NOW)}:i:%`) as { bucket: string }).bucket;
  db.prepare('UPDATE agent_counters SET requests = 0 WHERE bucket LIKE ?').run(`${dayKey(NOW)}:g:failures`);
  await countFailedAuth(DB, 'ip-b', stale, NOW, true);
  const bucket = ipKeyOf();
  db.prepare('UPDATE agent_counters SET fail_n = ? WHERE bucket = ?').run(LIMITS.IP_FAILED_AUTH, bucket);
  await countFailedAuth(DB, 'ip-b', stale, NOW, true);
  assert.equal((db.prepare('SELECT fail_n FROM agent_counters WHERE bucket = ?').get(bucket) as { fail_n: number }).fail_n, LIMITS.IP_FAILED_AUTH);
});

test('the agents\' write budget: 1,600 writes, submits and uploads a day, then 400 for social work only; 429 agent_budget with no write', async () => {
  const { db, env } = setup();
  assert.deepEqual([LIMITS.AGENT_WRITES_GENERAL_PER_DAY, LIMITS.AGENT_WRITES_RESERVE_PER_DAY, AGENT_WRITE_BUDGET], [1_600, 400, 2_000]);
  await grantRole(env.DB as never, { userId: 'ed', role: 'social', expiresAt: null, by: null }, NOW - 100);
  const cms = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const social = await mintToken(db, 'ed', ['social:draft'], { id: 't2' });
  db.prepare('INSERT INTO agent_counters (bucket, user_id, writes, submits, uploads) VALUES (?, ?, ?, ?, ?)').run(`${dayKey(NOW)}:t:someone-else`, 'other', 1_500, 80, 19);
  assert.equal(status(await authenticateAgent(req('POST', '/api/cms/drafts', { headers: bearer(cms), body: '{}' }), env, NOW)), 200, 'the last general write');
  const before = changes(db);
  const over = await authenticateAgent(req('PATCH', `/api/cms/drafts/${UUID}`, { headers: bearer(cms), body: '{}' }), env, NOW + 1);
  const res = (over as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 429);
  assert.equal(((await res.json()) as { code: string }).code, 'agent_budget');
  assert.equal(changes(db), before, 'refused with no write');
  // Reads go on; social writes come from the reserve.
  assert.equal(status(await authenticateAgent(req('GET', '/api/cms/drafts', { headers: bearer(cms) }), env, NOW + 2)), 200);
  assert.equal(status(await authenticateAgent(req('POST', '/api/social/posts', { headers: bearer(social), body: '{}' }), env, NOW + 3)), 200);
  const mine = counters(db).find((r) => r.bucket === `${dayKey(NOW)}:t:t2`)!;
  assert.deepEqual([mine.writes, mine.quota_reserve], [1, 1]);
  db.prepare('UPDATE agent_counters SET quota_reserve = ?, writes = writes + ? WHERE bucket = ?').run(LIMITS.AGENT_WRITES_RESERVE_PER_DAY, LIMITS.AGENT_WRITES_RESERVE_PER_DAY, `${dayKey(NOW)}:t:someone-else`);
  const spent = await authenticateAgent(req('POST', `/api/social/posts/${UUID}/submit`, { headers: bearer(social), body: '{}' }), env, NOW + 4);
  assert.equal(((await (spent as Extract<AgentAuth, { kind: 'refused' }>).response.json()) as { code: string }).code, 'agent_budget');
  assert.equal(status(await authenticateAgent(req('POST', '/api/social/posts', { headers: bearer(social), body: '{}' }), env, NOW + 86_400)), 200, 'the next UTC day');
});

test('an upload holding rsg_pat_ as UTF-16 (either byte order), split across chunks, is leaked; an upper-case &#X reference in text is too', async () => {
  const { db, env } = setup();
  for (const [order, id] of [['le', 't-le'], ['be', 't-be']] as const) {
    const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id });
    const u16 = new Uint8Array([...`XPComment ${value}`].flatMap((c) => (order === 'le' ? [c.charCodeAt(0), 0] : [0, c.charCodeAt(0)])));
    const cut = 2 * 'XPComment rsg_p'.length + 1; // inside the prefix, mid code unit
    const parts = [u16.slice(0, cut), u16.slice(cut)];
    const stream = new ReadableStream<Uint8Array>({ pull(c) { const next = parts.shift(); if (next) c.enqueue(next); else c.close(); } });
    assert.equal(status(await authenticateAgent(req('POST', '/api/blog-submissions/upload-image', { headers: bearer(value), body: stream }), env, NOW)), 400, order);
    assert.equal(tokenRow(db, id).revoke_reason, 'leaked', order);
  }
  const value = newTokenValue();
  assert.equal(holdsValue(`&#X72;${value.slice(1)}`, value), true);
  assert.equal(holdsValue(`&#x72;${value.slice(1, 7)}&#X5F;${value.slice(8)}`, value), true);
});
