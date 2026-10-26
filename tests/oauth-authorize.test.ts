import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubHttp } from './lib/http';
import { mintConnection } from './lib/agent';
import { grantRole } from '../functions/_lib/role-grants';
import { safeNext } from '../functions/_lib/next-path';
import { MAX_CONNECTIONS } from '../functions/_lib/oauth-config';
import { onRequestGet, onRequestPost } from '../functions/oauth/authorize';

// The authorize endpoint and the consent page. The CIMD document of
// claude.example is served by a stub; nothing here leaves the machine.

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const ISS = 'https://rsg-turkiye.iscbsc.org';
const CLIENT = 'https://claude.example/oauth/client.json';
const CB = 'https://claude.example/cb';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const now = () => Math.floor(Date.now() / 1000);

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of ['ed', 'none']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  const DB = d1(db) as never;
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: now() + 86400 * 30, by: null }, now());
  return { db, DB, env: { DB } as never };
}

function cimd(over: Record<string, unknown> = {}, redirects: string[] = [CB]) {
  return stubHttp(['claude.example'], () => new Response(
    JSON.stringify({ client_id: CLIENT, client_name: 'Claude', redirect_uris: redirects, token_endpoint_auth_method: 'none', ...over }),
    { headers: { 'Content-Type': 'application/json' } },
  ));
}

const params = (over: Record<string, string | null> = {}) => {
  const p: Record<string, string> = {
    response_type: 'code', client_id: CLIENT, redirect_uri: CB, code_challenge: CHALLENGE, code_challenge_method: 'S256',
    state: 'xyz', scope: 'cms.etkinlikler:draft',
  };
  for (const [k, v] of Object.entries(over)) { if (v === null) delete p[k]; else p[k] = v; }
  return new URLSearchParams(p);
};
const cookie = (who: string | null) => (who ? { Cookie: `rsg_session=s-${who}` } : {});

async function get(env: never, who: string | null, p = params(), headers: Record<string, string> = {}) {
  return onRequestGet({ request: new Request(`${BASE}/oauth/authorize?${p}`, { headers: { ...cookie(who), ...headers } }), env } as never);
}
async function post(env: never, who: string | null, fields: URLSearchParams, headers: Record<string, string> = {}) {
  return onRequestPost({
    request: new Request(`${BASE}/oauth/authorize`, {
      method: 'POST', body: fields, headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...cookie(who), ...headers },
    }), env,
  } as never);
}
const allow = (over: Record<string, string | null> = {}, extra: [string, string][] = [['area', 'cms.etkinlikler'], ['level_cms.etkinlikler', 'draft']]) => {
  const p = params(over);
  p.set('action', 'allow'); p.set('days', '30');
  for (const [k, v] of extra) p.append(k, v);
  return p;
};
const rows = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const loc = (res: Response) => new URL(res.headers.get('Location')!);

test('unknown client or unregistered redirect shows the error page and never redirects', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    for (const p of [
      params({ redirect_uri: 'https://evil.example/steal?x=1' }),
      params({ redirect_uri: null }),
      params({ client_id: 'nonsense' }),
      params({ client_id: 'rsg_oc_unknown' }),
    ]) {
      const res = await get(env, 'ed', p);
      assert.equal(res.status, 400);
      assert.equal(res.headers.get('Location'), null);
      const body = await res.text();
      assert.ok(!body.includes('evil.example') && !body.includes('steal'), 'the asked redirect is not echoed');
    }
    const res = await post(env, 'ed', allow({ redirect_uri: 'https://evil.example/cb' }));
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('Location'), null);
  } finally { http.restore(); }
});

test('signed out, a CIMD client_id is never fetched', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    assert.equal((await get(env, null)).status, 302);
    assert.equal((await post(env, null, allow())).status, 400);
    assert.equal(http.calls.length, 0);
  } finally { http.restore(); }
});

test('a bad code_challenge_method redirects 303 with error, state and iss', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    for (const p of [
      params({ code_challenge_method: 'plain' }), params({ code_challenge_method: null }), params({ code_challenge: 'short' }),
      params({ code_challenge: null }), params({ response_type: 'token' }), params({ state: 'x'.repeat(513) }),
    ]) {
      const res = await get(env, 'ed', p);
      assert.equal(res.status, 303);
      const l = loc(res);
      assert.equal(l.origin + l.pathname, CB);
      assert.equal(l.searchParams.get('error'), 'invalid_request');
      assert.equal(l.searchParams.get('iss'), ISS);
      if ((p.get('state') ?? '').length <= 512) assert.equal(l.searchParams.get('state'), p.get('state'));
    }
    assert.equal(loc(await get(env, 'ed', params({ code_challenge_method: 'plain' }))).searchParams.get('state'), 'xyz');
  } finally { http.restore(); }
});

test('a resource other than the MCP URL is invalid_target', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    const res = await get(env, 'ed', params({ resource: 'https://rsg-turkiye.iscbsc.org/api/other' }));
    assert.equal(res.status, 303);
    assert.equal(loc(res).searchParams.get('error'), 'invalid_target');
    assert.equal((await get(env, 'ed', params({ resource: `${ISS}/api/mcp` }))).status, 200);
    assert.equal((await get(env, 'ed', params())).status, 200, 'resource may be absent');
  } finally { http.restore(); }
});

test('signed out, GET redirects to Google sign-in carrying the whole request', async () => {
  const { db, env } = await setup();
  const before = ['sessions', 'oauth_codes', 'agent_tokens', 'oauth_clients'].map((t) => rows(db, t));
  const res = await get(env, null);
  assert.equal(res.status, 302);
  const l = res.headers.get('Location')!;
  assert.ok(l.startsWith('/auth/login?next=%2Foauth%2Fauthorize%3F'), l);
  const next = decodeURIComponent(l.slice('/auth/login?next='.length));
  assert.equal(safeNext(next), next);
  assert.equal(next, `/oauth/authorize?${params()}`);
  assert.deepEqual(['sessions', 'oauth_codes', 'agent_tokens', 'oauth_clients'].map((t) => rows(db, t)), before);

  const long = await get(env, null, params({ state: 'x'.repeat(2100) }));
  assert.equal(long.status, 400);
});

test('signed in, GET shows only the areas the member holds, pre-ticked from the requested scope', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    const res = await get(env, 'ed', params({ scope: 'cms.etkinlikler:draft social:draft cms.yazilar:read' }), { 'Accept-Language': 'en' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('X-Frame-Options'), 'DENY');
    assert.equal(res.headers.get('Cache-Control'), 'no-store');
    assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
    assert.match(res.headers.get('Content-Security-Policy') ?? '', /frame-ancestors 'none'/);
    assert.ok(!/form-action/.test(res.headers.get('Content-Security-Policy') ?? ''));
    const body = await res.text();
    const areas = [...body.matchAll(/<input[^>]*name="area"[^>]*>/g)].map((m) => m[0]);
    assert.equal(areas.length, 1);
    assert.match(areas[0], /value="cms\.etkinlikler"/);
    assert.match(areas[0], /checked/);
    assert.match(body, /<option value="draft" selected>/);
    assert.ok(!body.includes('social'), 'no social area: ' + body.slice(Math.max(0, body.indexOf('social') - 80), body.indexOf('social') + 40));
    assert.ok(body.includes('claude.example'));
    assert.ok(body.includes('Claude'));
    // "approve" appears only in the fixed "can never" sentence.
    const stripped = body.replace(/It can never approve, publish, schedule or send\./g, '');
    assert.ok(!/approve/i.test(stripped));
    assert.ok(body.includes('Where you choose Read, it can only read.'));
    assert.ok(body.includes('Where you choose Read and write drafts, it can also write drafts in your name.'));
    assert.ok(!body.includes('It can read and write drafts'), 'no blanket claim that holds for a read-only pick');
    assert.match(body, /<option value="30" selected>/);
    assert.match(body, /name="state" value="xyz"/);
    assert.match(body, /name="code_challenge" value="E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"/);
    assert.ok(!/<script/i.test(body));
    assert.ok(!body.includes('—'), 'no em dash');
  } finally { http.restore(); }
});

test('nothing requested means nothing pre-ticked', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    const body = await (await get(env, 'ed', params({ scope: null }))).text();
    const area = body.match(/<input[^>]*name="area"[^>]*>/)![0];
    assert.ok(!/checked/.test(area));
  } finally { http.restore(); }
});

test('Turkish when Accept-Language is tr, English otherwise, and rsg_lang overrides', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    const text = async (p: URLSearchParams, h: Record<string, string>) => (await get(env, 'ed', p, h)).text();
    assert.match(await text(params(), { 'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8' }), /<html lang="tr">/);
    assert.match(await text(params(), { 'Accept-Language': 'en-US,en;q=0.9' }), /<html lang="en">/);
    assert.match(await text(params(), {}), /<html lang="en">/);
    assert.match(await text(params({ rsg_lang: 'en' }), { 'Accept-Language': 'tr' }), /<html lang="en">/);
    const tr = await text(params({ rsg_lang: 'tr' }), { 'Accept-Language': 'en' });
    assert.match(tr, /<html lang="tr">/);
    assert.match(tr, /Onaylayamaz, yayımlayamaz, zamanlayamaz ve gönderemez/);
    assert.match(tr, /rsg_lang=en/, 'link to the other language');
    assert.match(tr, /name="rsg_lang" value="tr"/, 'kept through the form');
  } finally { http.restore(); }
});

test('a loopback or custom-scheme redirect shows the warning and the whole URI', async () => {
  const { env } = await setup();
  const http = cimd({}, [CB, 'http://127.0.0.1:33418/callback', 'cursor://anysphere.cursor-mcp/oauth/callback']);
  try {
    const plain = await (await get(env, 'ed')).text();
    assert.ok(!/class="warn"/.test(plain));
    for (const uri of ['http://127.0.0.1:5555/callback', 'cursor://anysphere.cursor-mcp/oauth/callback']) {
      const res = await get(env, 'ed', params({ redirect_uri: uri }));
      assert.equal(res.status, 200, uri);
      const body = await res.text();
      assert.match(body, /class="warn"/);
      assert.ok(body.includes(uri));
    }
  } finally { http.restore(); }
});

test('Allow answers 303 (never 307) with code, state and iss, and stores one code row', async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    const res = await post(env, 'ed', allow());
    assert.equal(res.status, 303);
    const l = loc(res);
    assert.equal(l.origin + l.pathname, CB);
    assert.match(l.searchParams.get('code') ?? '', /^rsg_oac_/);
    assert.equal(l.searchParams.get('state'), 'xyz');
    assert.equal(l.searchParams.get('iss'), ISS);
    assert.equal(rows(db, 'oauth_codes'), 1);
    const row = db.prepare('SELECT * FROM oauth_codes').get() as Record<string, unknown>;
    assert.equal(row.scopes, JSON.stringify(['cms.etkinlikler:draft']));
    assert.equal(row.days, 30);
    assert.equal(row.user_id, 'ed');
    assert.equal(row.client_id, CLIENT);
    assert.equal(row.redirect_uri, CB);
    assert.equal(row.code_challenge, CHALLENGE);
    assert.equal(row.label, 'Claude (claude.example)');
    // No state sent: none returned.
    const bare = await post(env, 'ed', allow({ state: null }));
    assert.equal(loc(bare).searchParams.has('state'), false);
  } finally { http.restore(); }
});

test('Allow redirects to a loopback URI exactly as asked, port included', async () => {
  const { env } = await setup();
  const http = cimd({}, ['http://127.0.0.1/callback']);
  try {
    const res = await post(env, 'ed', allow({ redirect_uri: 'http://127.0.0.1:40123/callback?x=1' }));
    assert.equal(res.status, 400, 'a query added to a loopback URI does not match');
    const ok = await post(env, 'ed', allow({ redirect_uri: 'http://127.0.0.1:40123/callback' }));
    assert.equal(ok.status, 303);
    assert.ok(ok.headers.get('Location')!.startsWith('http://127.0.0.1:40123/callback?code='));
  } finally { http.restore(); }
});

test('Deny answers 303 access_denied and writes nothing', async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    const p = allow(); p.set('action', 'deny');
    const res = await post(env, 'ed', p);
    assert.equal(res.status, 303);
    const l = loc(res);
    assert.equal(l.searchParams.get('error'), 'access_denied');
    assert.equal(l.searchParams.get('state'), 'xyz');
    assert.equal(l.searchParams.get('iss'), ISS);
    assert.equal(rows(db, 'oauth_codes'), 0);
  } finally { http.restore(); }
});

test('a forged POST asking for an area the member does not hold is a 400 page and writes nothing', async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    for (const extra of [
      [['area', 'social'], ['level_social', 'draft']],
      [['area', 'cms.yazilar'], ['level_cms.yazilar', 'read']],
      [['area', 'cms.etkinlikler'], ['level_cms.etkinlikler', 'approve']],
      [['area', 'cms.etkinlikler'], ['level_cms.etkinlikler', 'draft'], ['area', 'cms.etkinlikler']],
      [],
    ] as [string, string][][]) {
      const res = await post(env, 'ed', allow({}, extra));
      assert.equal(res.status, 400);
      assert.equal(res.headers.get('Location'), null);
    }
    const noRoles = await post(env, 'none', allow());
    assert.equal(noRoles.status, 400);
    for (const days of ['1', '365', '', 'abc']) {
      const p = allow(); p.set('days', days);
      assert.equal((await post(env, 'ed', p)).status, 400, `days=${days}`);
    }
    assert.equal(rows(db, 'oauth_codes'), 0);
  } finally { http.restore(); }
});

test('a POST from another origin is refused (checkCsrf)', async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    const res = await post(env, 'ed', allow(), { Origin: 'https://evil.example' });
    assert.equal(res.status, 400);
    assert.equal(rows(db, 'oauth_codes'), 0);
    assert.equal((await post(env, 'ed', allow(), { Origin: BASE })).status, 303);
  } finally { http.restore(); }
});

test('too many pending codes is a 400 page', async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await post(env, 'ed', allow())).status, 303);
    const res = await post(env, 'ed', allow());
    assert.equal(res.status, 400);
    assert.equal(res.headers.get('Location'), null);
    assert.equal(rows(db, 'oauth_codes'), 5);
  } finally { http.restore(); }
});

test('a member who holds no area sees a page that says so, with Deny only', async () => {
  const { env } = await setup();
  const http = cimd();
  try {
    const res = await get(env, 'none');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(!/name="area"/.test(body));
    assert.ok(!/value="allow"/.test(body));
    assert.match(body, /value="deny"/);
  } finally { http.restore(); }
});

test("the 6th live connection's GET shows the disconnect-one page", async () => {
  const { db, env } = await setup();
  const http = cimd();
  try {
    for (let i = 0; i < MAX_CONNECTIONS - 1; i++) await mintConnection(db, 'ed', ['cms.etkinlikler:draft']);
    await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { revokedAt: 5 });
    await mintConnection(db, 'ed', ['cms.etkinlikler:draft'], { expiresAt: 5 });
    assert.match(await (await get(env, 'ed')).text(), /name="area"/, 'dead connections do not count');
    await mintConnection(db, 'ed', ['cms.etkinlikler:draft']);
    const res = await get(env, 'ed');
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes('/admin#anahtarlar'));
    assert.ok(!/name="area"/.test(body));
    assert.ok(!/value="allow"/.test(body));
    assert.match(body, /value="deny"/);
    assert.equal((await post(env, 'ed', allow())).status, 400, 'POST refuses too');
    assert.equal(rows(db, 'oauth_codes'), 0);
  } finally { http.restore(); }
});

test('every member-supplied or client-supplied string is escaped', async () => {
  const { env } = await setup();
  const evil = '<img src=x onerror=alert(1)>';
  const http = cimd({ client_name: evil });
  try {
    const body = await (await get(env, 'ed', params({ state: '"><b>x</b>' }))).text();
    assert.ok(!body.includes(evil));
    assert.ok(body.includes('&lt;img src=x onerror=alert(1)&gt;'));
    assert.ok(!body.includes('"><b>x</b>'));
    assert.ok(body.includes('&quot;&gt;&lt;b&gt;x&lt;/b&gt;'));
  } finally { http.restore(); }
  const odd = cimd({}, ['http://127.0.0.1:1/cb', 'cursor://a&b.c/cb']);
  try {
    const body = await (await get(env, 'ed', params({ redirect_uri: 'cursor://a&b.c/cb' }))).text();
    assert.ok(body.includes('cursor://a&amp;b.c/cb'));
  } finally { odd.restore(); }
});
