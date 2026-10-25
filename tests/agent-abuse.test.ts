// Adversarial regression tests for agent access (plan 5). Each test probes a
// defence from the attacker's side: a token reaching past its scope, its
// member's live grants or the route table; a token reading or changing a
// colleague's work; malformed MCP; every budget at and just past its limit;
// the auto-revoke triggers; and hostile labels in notification mail.
//
// Everything runs in-process on the node:sqlite D1 shim, with fetch stubbed:
// no request leaves the machine.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { setupSocial, call, settle, KEYS, BASE } from './lib/social';
import { mintToken, bearer } from './lib/agent';
import { fakeR2 } from './lib/fake-r2';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { grantRole, revokeRole } from '../functions/_lib/role-grants';
import { routeFor, AGENT_ROUTES } from '../functions/_lib/agent-routes';
import { authenticateAgent, markInternal, newTokenValue, type AgentAuth } from '../functions/_lib/agent-tokens';
import { LIMITS } from '../functions/_lib/agent-limits';
import { notificationText } from '../functions/_lib/social-notify';
import { onRequest as middleware } from '../functions/api/_middleware';
import * as mcp from '../functions/api/mcp';
import * as cmsTypes from '../functions/api/cms/types';
import * as cmsEntries from '../functions/api/cms/entries';
import * as cmsEntry from '../functions/api/cms/entry';
import * as cmsDrafts from '../functions/api/cms/drafts';
import * as cmsDraft from '../functions/api/cms/drafts/[id]';
import * as cmsSubmit from '../functions/api/cms/drafts/[id]/submit';
import * as cmsApprove from '../functions/api/cms/drafts/[id]/approve';
import * as cmsReject from '../functions/api/cms/drafts/[id]/reject';
import * as cmsCancel from '../functions/api/cms/drafts/[id]/cancel';
import * as cmsPodcast from '../functions/api/cms/podcast/pull';
import * as socialPosts from '../functions/api/social/posts/index';
import * as socialPost from '../functions/api/social/posts/[id]';
import * as socialSubmit from '../functions/api/social/posts/[id]/submit';
import * as socialApprove from '../functions/api/social/posts/[id]/approve';
import * as socialReject from '../functions/api/social/posts/[id]/reject';
import * as socialCancel from '../functions/api/social/posts/[id]/cancel';
import * as socialRequeue from '../functions/api/social/posts/[id]/requeue';
import * as socialPlans from '../functions/api/social/plans/index';
import * as socialPlan from '../functions/api/social/plans/[id]';
import * as socialDispatch from '../functions/api/social/dispatch';
import * as eventModes from '../functions/api/social/event-modes/index';
import * as upload from '../functions/api/blog-submissions/upload-image';
import * as adminUsers from '../functions/api/admin/users';
import * as mailSend from '../functions/api/mail/send';
import * as dmReply from '../functions/api/admin/social/dm/[id]/reply';
import * as tokensIndex from '../functions/api/agent-tokens/index';
import * as tokensOne from '../functions/api/agent-tokens/[id]';
import * as announcements from '../functions/api/admin/announcements';

const ROOT = new URL('..', import.meta.url).pathname;
const UUID = '0b6f4a52-3c1d-4e8f-9a2b-7c6d5e4f3a21';
/** Wall-clock now: handlers read Date.now(), so grants and windows in handler tests are set against it. */
const WALL = Math.floor(Date.now() / 1000);
/** A UTC day boundary, for the authenticateAgent-level tests that pass `now` themselves. */
const DAY0 = 20_834 * 86_400;

// --- no network: GitHub holds only FILES; Google's mail API is captured ----

const EVENT_ID = 'fixture-meetup-2026';
const FILES: Record<string, string> = {
  'src/data/podcast.json': '{"episodes":[]}\n',
  [`src/content/events/${EVENT_ID}.json`]: `${JSON.stringify({ id: EVENT_ID, type: 'meetup', start: '2026-03-06', title: { en: 'Fixture meetup', tr: 'Örnek buluşma' }, when: { en: '6 March 2026', tr: '6 Mart 2026' }, location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'A meetup.', tr: 'Bir buluşma.' } }, null, 2)}\n`,
};
const INDEX = buildCmsIndex(FILES);
const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
/** Every raw MIME message the code tried to send, decoded. */
const sentMail: string[] = [];
const unexpected: string[] = [];
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  if (url.hostname === 'oauth2.googleapis.com') return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }));
  if (url.hostname.endsWith('googleapis.com')) {
    const { raw } = JSON.parse(String(init?.body)) as { raw: string };
    sentMail.push(Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    return new Response(JSON.stringify({ id: 'm', threadId: 't' }));
  }
  if (url.hostname === 'api.github.com' && method === 'GET' && url.pathname.includes('/contents/')) {
    const content = FILES[decodeURIComponent(url.pathname.split('/contents/')[1])];
    if (content === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ sha: blobSha(content), content: Buffer.from(content).toString('base64'), encoding: 'base64' }));
  }
  unexpected.push(`${method} ${url.href}`);
  throw new Error(`no network in tests: ${method} ${url.href}`);
}) as never;

const waits: Promise<unknown>[] = [];
afterEach(async () => {
  await settle(waits.splice(0));
  assert.deepEqual(unexpected.splice(0), [], 'no request may leave the process');
});

// --- the world: members, live grants, the CMS index, R2 --------------------

/**
 * setupSocial's users (admin, pub, ed, ed2, mem) with live grants, plus
 * `lap`, whose grants ended a second ago, and `rev`, whose grants a person
 * revoked. Each of those two holds a token made while the grants were live.
 */
async function world() {
  const s = setupSocial();
  const db = s.db;
  const DB = (s.env as { DB: D1Database }).DB;
  for (const id of ['lap', 'rev']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  await grantRole(DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, WALL - 100);
  await grantRole(DB, { userId: 'pub', role: 'social_publisher', expiresAt: null, by: null }, WALL - 100);
  for (const id of ['ed', 'ed2', 'rev']) {
    await grantRole(DB, { userId: id, role: 'social', expiresAt: null, by: null }, WALL - 100);
    await grantRole(DB, { userId: id, role: 'content.etkinlikler.edit', expiresAt: null, by: null }, WALL - 100);
  }
  // Ended one second ago, in wall time: the handlers' own clock.
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, NULL, ?)');
  grant.run('lap-1', 'lap', 'social', WALL - 1, WALL - 1000);
  grant.run('lap-2', 'lap', 'content.etkinlikler.edit', WALL - 1, WALL - 1000);
  await revokeRole(DB, { userId: 'rev', role: 'social', by: 'admin' }, WALL - 10);
  await revokeRole(DB, { userId: 'rev', role: 'content.etkinlikler.edit', by: 'admin' }, WALL - 10);
  const assets = { fetch: async (r: Request) => new URL(r.url).pathname === '/cms-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 }) };
  const bucket = fakeR2();
  const env = { ...(s.env as object), GITHUB_PAT: 'unused', ASSETS: assets, BLOG_IMAGES: bucket } as never;
  return { db, env, bucket };
}
type World = Awaited<ReturnType<typeof world>>;

type Hit = { token?: string; body?: unknown; params?: Record<string, string>; headers?: Record<string, string>; cookie?: string };
const hit = (w: World, handler: unknown, method: string, path: string, o: Hit = {}) =>
  call(handler, method, path, { env: w.env, as: o.cookie, body: o.body, params: o.params, waits, headers: { ...(o.token ? bearer(o.token) : {}), ...(o.headers ?? {}) } });
const json = async (res: Response) => { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } };

const count = (db: DatabaseSync, sql: string, ...args: unknown[]) => (db.prepare(sql).get(...(args as never[])) as { n: number }).n;
const rows = (db: DatabaseSync, table: string) => count(db, `SELECT COUNT(*) AS n FROM ${table}`);
/** Rows changed on this connection so far: a request that writes nothing leaves it unchanged. */
const changes = (db: DatabaseSync) => count(db, 'SELECT total_changes() AS n');
/** Everything a person or an agent can make: a refusal must leave all of it as it was. */
const contentState = (w: World) => JSON.stringify({
  drafts: w.db.prepare('SELECT id, status, author_id, data, write_nonce, updated_at FROM content_drafts ORDER BY id').all(),
  posts: w.db.prepare('SELECT id, status, revision, caption, created_by, approved_by FROM social_posts ORDER BY id').all(),
  plans: w.db.prepare('SELECT id, title, note, scheduled_at, post_id, created_by FROM social_plans ORDER BY id').all(),
  media: rows(w.db, 'social_media'), r2: w.bucket.store.size,
  audits: w.db.prepare(`SELECT action FROM audit_log WHERE action NOT LIKE 'agent_token.%' ORDER BY seq`).all(),
  grants: w.db.prepare('SELECT id, revoked_at FROM role_grants ORDER BY id').all(),
});

const newEvent = (title = 'Ankara meetup') => ({
  id: 'meetup-ankara-2027', type: 'meetup', start: '2027-03-06',
  title: { en: title, tr: 'Ankara buluşması' }, when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'An evening meetup.', tr: 'Bir akşam buluşması.' },
});
const postBody = (extra: Record<string, unknown> = {}) => ({ type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: WALL + 7200, ...extra });
const planBody = (extra: Record<string, unknown> = {}) => ({ title: 'Konuşmacı tanıtımı', scheduledAt: WALL + 86_400, platforms: ['instagram'], postType: 'image', ...extra });

/** A CMS draft by `author`, made through the panel's own path (a session), then handed to `author`. */
async function cmsDraftOf(w: World, author: string, status = 'draft'): Promise<{ id: string; nonce: string }> {
  const res = await hit(w, cmsDrafts.onRequestPost, 'POST', '/api/cms/drafts', { cookie: 'ed', headers: { Origin: BASE }, body: { type: 'events', action: 'create', data: newEvent(`by ${author} ${Math.random()}`) } });
  assert.equal(res.status, 201, `fixture draft: ${JSON.stringify(await res.clone().json())}`);
  const { draft } = await res.json() as { draft: { id: string } };
  w.db.prepare('UPDATE content_drafts SET author_id = ?, status = ? WHERE id = ?').run(author, status, draft.id);
  const nonce = (w.db.prepare('SELECT write_nonce FROM content_drafts WHERE id = ?').get(draft.id) as { write_nonce: string }).write_nonce;
  return { id: draft.id, nonce };
}
function postOf(w: World, author: string, status = 'draft', extra: { review_note?: string; scheduled_at?: number | null } = {}): string {
  const id = crypto.randomUUID();
  w.db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, review_note, created_at, updated_at)
    VALUES (?, 'image', ?, ?, '["instagram"]', ?, ?, 0, ?, ?, 1, 1)`).run(
    id, `secret caption of ${author}`, JSON.stringify([{ key: KEYS.feed, alt: 'x' }]),
    extra.scheduled_at === undefined ? WALL + 3600 : extra.scheduled_at, status, author, extra.review_note ?? null);
  return id;
}
function planOf(w: World, author: string, note = `private note of ${author}`): string {
  const id = crypto.randomUUID();
  w.db.prepare(`INSERT INTO social_plans (id, title, scheduled_at, platforms, post_type, assignee_id, note, created_by, created_at, updated_at)
    VALUES (?, ?, ?, '["instagram"]', 'image', ?, ?, ?, 1, 1)`).run(id, `plan of ${author}`, WALL + 86_400, author, note, author);
  return id;
}

const jpeg = (w: number, h: number, tail: Uint8Array = new Uint8Array(0)) => {
  const head = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0, 0, 0, 0, 0, 0, 0, 0]);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head);
  out.set(tail, head.length);
  return out;
};
const uploadReq = (w: World, token: string, bytes: Uint8Array) =>
  (upload.onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...bearer(token) }, body: bytes }),
    env: w.env, params: {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });

let rpcId = 1;
async function mcpPost(w: World, token: string | null, raw: string, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE}/api/mcp`, {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(token ? bearer(token) : {}), ...headers },
  });
  const res = await (mcp.onRequestPost as (c: unknown) => Promise<Response>)({ request, env: w.env, params: {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, data: {} });
  return { status: res.status, body: await json(res) };
}
const rpc = (w: World, token: string, method: string, params?: unknown, headers?: Record<string, string>) =>
  mcpPost(w, token, JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, ...(params === undefined ? {} : { params }) }), headers);

// =========================================================================
// 1. Authorisation: the route table, the middleware, path and method variants
// =========================================================================

/** An env whose database throws: the middleware must decide without it. */
const noDb = { DB: new Proxy({}, { get() { throw new Error('D1 touched'); } }) };

async function throughMiddleware(request: Request, env: unknown = noDb) {
  let called = 0;
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request, env, params: {}, waitUntil() {}, next: async () => { called++; return new Response('handler ran'); },
  });
  return { res, called };
}
const bearerReq = (method: string, path: string, value: string, extra: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, headers: { ...bearer(value), ...extra } });

/** Every file under functions/api as the path Pages serves it at, each [param] filled with a UUID. */
function apiPaths(): { file: string; path: string }[] {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : n.endsWith('.ts') && !n.startsWith('_') ? [p] : [];
  });
  return walk(join(ROOT, 'functions/api')).map((p) => {
    const file = relative(join(ROOT, 'functions'), p);
    const path = '/' + file.replace(/\.ts$/, '').replace(/\/index$/, '').replace(/\[\w+\]/g, UUID);
    return { file, path };
  });
}
const METHODS = ['GET', 'POST', 'PATCH', 'DELETE', 'PUT', 'HEAD', 'OPTIONS'];

test('sweep: every file under functions/api and every method; outside the table a bearer request is 403 human_only and no handler runs', async () => {
  const paths = apiPaths();
  assert.ok(paths.length > 80, `the walk sees the API (${paths.length} files)`);
  let refused = 0;
  let passed = 0;
  for (const { file, path } of paths) {
    for (const method of METHODS) {
      const route = routeFor(method, path);
      const { res, called } = await throughMiddleware(bearerReq(method, path, newTokenValue(), { Cookie: 'rsg_session=s-admin' }));
      if (route) {
        assert.equal(called, 1, `${method} ${path} (${file}) is in the table and must reach its handler`);
        passed++;
      } else {
        assert.equal(called, 0, `${method} ${path} (${file})`);
        assert.equal(res.status, 403, `${method} ${path} (${file})`);
        assert.deepEqual(await res.json(), { error: 'This is done by a person in the panel', code: 'human_only' });
        refused++;
      }
    }
  }
  assert.equal(passed, AGENT_ROUTES.length, 'each table row is served by exactly one file and method');
  assert.ok(refused > 400);
});

test('no route in the table approves, rejects, cancels, requeues, publishes, schedules, dispatches, sends, grants or touches tokens, users, mail, connections, symposium, certificates, announcements, stats or audit', () => {
  const human = /approve|reject|cancel|requeue|publish|schedule|dispatch|send|reply|users|roles?\b|grant|mail|agent-tokens|connections|symposium|certificates|announcements|stats|audit|event-modes|editors|counts|members|profile|me$/;
  const reachable: string[] = [];
  for (const { path } of apiPaths()) {
    if (!human.test(path)) continue;
    for (const method of METHODS) if (routeFor(method, path)) reachable.push(`${method} ${path}`);
  }
  assert.deepEqual(reachable, []);
  // And the table's own patterns name none of these words.
  for (const r of AGENT_ROUTES) assert.doesNotMatch(r.pattern.source, /approve|reject|cancel|requeue|publish|dispatch|send|agent-tokens/, r.pattern.source);
});

test('path variants: encoded dots and slashes, case, trailing and double slashes, NUL, look-alikes are refused, by the middleware and again by authenticateAgent', async () => {
  const w = await world();
  const REFUSED: [string, string][] = [
    ['POST', `/api/social/posts/x/%2e%2e/x/approve`], // the URL parser resolves this to /api/social/posts/x/approve
    ['POST', `/api/social/posts/${UUID}/%2E%2E/${UUID}/approve`],
    ['POST', `/api/cms/drafts/${UUID}%2Fapprove`],
    ['POST', `/api/cms/drafts/${UUID}%2fsubmit`],
    ['POST', `/api/cms/drafts/${UUID}/%73ubmit`],
    ['POST', `/api/cms/drafts/${UUID}/submit/`],
    ['POST', `/api/cms/drafts/${UUID}/approve/`],
    ['POST', `/api/cms/drafts/${UUID}/submit/..%2fapprove`],
    ['POST', `/api/cms/drafts/${UUID}/submit;approve`],
    ['GET', `/api/cms/drafts/${UUID.toUpperCase()}`],
    ['GET', `/api/cms/drafts/${UUID}%00`],
    ['GET', `/API/cms/types`],
    ['GET', `/api/CMS/types`],
    ['GET', `/api/cms/Types`],
    ['GET', `//api/cms/types`],
    ['GET', `/api//cms/types`],
    ['GET', `/api/cms/types/`],
    ['GET', `/api/cms/types.json`],
    ['GET', `/api/social/posts/a.b`],
    ['GET', `/api/social/posts/a%2Fb`],
    ['GET', `/api/social/posts/${'a'.repeat(65)}`],
    ['PATCH', `/api/social/posts/${UUID}/approve`],
    ['POST', `/api/social/posts/${UUID}/ѕubmit`], // Cyrillic s, percent-encoded by the URL parser
    ['POST', `/api/social/plans/${UUID}/submit`],
    ['GET', `/api/mcp/`],
    ['GET', `/api/mcp/../admin/users`],
    ['GET', `/api/cms/drafts/%2e%2e/%2e%2e/admin/users`],
    ['HEAD', '/api/cms/types'], ['OPTIONS', '/api/mcp'], ['PUT', `/api/cms/drafts/${UUID}`], ['PUT', '/api/social/posts'],
    ['DELETE', '/api/social/posts'], ['DELETE', '/api/cms/drafts'], ['PATCH', '/api/social/plans'],
    ['POST', '/api/agent-tokens'], ['DELETE', `/api/agent-tokens/${UUID}`],
  ];
  for (const [method, path] of REFUSED) {
    const { res, called } = await throughMiddleware(bearerReq(method, path, newTokenValue()));
    assert.equal(called, 0, `${method} ${path} -> ${new URL(BASE + path).pathname}`);
    assert.equal(res.status, 403, `${method} ${path}`);
    // The second gate refuses the same request with a live admin token.
    const token = await mintToken(w.db, 'admin', ['cms.etkinlikler:draft', 'social:draft']);
    const auth = await authenticateAgent(bearerReq(method, path, token), w.env, WALL);
    assert.equal(auth.kind, 'refused', `authenticateAgent: ${method} ${path}`);
    assert.equal(((await (auth as Extract<AgentAuth, { kind: 'refused' }>).response.json()) as { code: string }).code, 'human_only', `${method} ${path}`);
  }
});

test('path variants that the URL parser resolves onto a table route are matched as that route, and only as it', async () => {
  // What Pages serves is the resolved path, so these are the table route itself, not a bypass.
  for (const [method, path, resolved] of [
    ['GET', '/api/social/posts/%2e%2e/plans', '/api/social/plans'],
    ['GET', '/api/admin/%2e%2e/cms/types', '/api/cms/types'],
    ['GET', '/api/cms/./types', '/api/cms/types'],
  ] as const) {
    assert.equal(new URL(BASE + path).pathname, resolved);
    const { called } = await throughMiddleware(bearerReq(method, path, newTokenValue()));
    assert.equal(called, 1, `${path} is ${resolved}`);
    assert.equal(routeFor(method, new URL(BASE + path).pathname), routeFor(method, resolved));
  }
});

test('method case: GET/post/delete are normalised by the platform and matched; a lower-case patch is not a method of the table and is refused', async () => {
  for (const method of ['get', 'Get']) assert.equal((await throughMiddleware(bearerReq(method, '/api/cms/types', newTokenValue()))).called, 1, method);
  for (const method of ['post', 'Post']) assert.equal((await throughMiddleware(bearerReq(method, '/api/social/posts', newTokenValue()))).called, 1, method);
  assert.equal((await throughMiddleware(bearerReq('delete', `/api/cms/drafts/${UUID}`, newTokenValue()))).called, 1);
  // PATCH is not in fetch's normalise list: "patch" stays lower case and matches no row.
  const lower = await throughMiddleware(bearerReq('patch', `/api/cms/drafts/${UUID}`, newTokenValue()));
  assert.equal(lower.called, 0);
  assert.equal(lower.res.status, 403);
  // Methods the table never lists.
  for (const method of ['TRACE', 'CONNECT', 'PROPFIND', 'X-APPROVE']) {
    let request: Request;
    try { request = bearerReq(method, '/api/cms/types', newTokenValue()); } catch { continue; } // forbidden by fetch itself
    const r = await throughMiddleware(request);
    assert.equal(r.called, 0, method);
    assert.equal(r.res.status, 403, method);
  }
});

test('any Authorization header decides: lower-case scheme, Basic, empty, two values, a cookie beside it; never served as the session', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'ed', ['social:draft']);
  const headers: Record<string, string>[] = [
    { Authorization: `bearer ${value}` },
    { Authorization: `Bearer  ${value}` },
    { Authorization: `Bearer ${value} ` + 'x' },
    { Authorization: `Basic ${Buffer.from(`ed:${value}`).toString('base64')}` },
    { Authorization: '' },
    { Authorization: `Bearer ${value}, Bearer ${value}` },
    { Authorization: `Bearer ${value.toUpperCase()}` },
  ];
  for (const h of headers) {
    const before = contentState(w);
    const res = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { cookie: 'pub', headers: { Origin: BASE, 'CF-Connecting-IP': `198.51.100.${headers.indexOf(h) + 1}`, ...h }, body: postBody() });
    assert.equal(res.status, 401, JSON.stringify(h).slice(0, 40));
    assert.equal(contentState(w), before);
  }
});

test('a live token on routes outside the table: each refusal writes one counter row and nothing else; the 20th revokes it once; then nothing is written', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'admin', ['cms.etkinlikler:draft', 'social:draft'], { id: 'tok-adm' });
  const outside: [string, string][] = [
    ['POST', `/api/social/posts/${UUID}/approve`], ['POST', `/api/cms/drafts/${UUID}/approve`], ['PATCH', '/api/admin/users'],
    ['POST', '/api/mail/send'], ['POST', '/api/agent-tokens'], ['POST', '/api/social/dispatch'], ['POST', '/api/social/event-modes'],
    ['POST', `/api/admin/social/dm/${UUID}/reply`], ['POST', '/api/admin/announcements'], ['GET', '/api/admin/stats'],
  ];
  const audits = () => rows(w.db, 'audit_log');
  const auditsBefore = audits();
  for (let i = 0; i < LIMITS.REFUSALS_PER_DAY - 1; i++) {
    const [method, path] = outside[i % outside.length];
    const before = changes(w.db);
    const { res, called } = await throughMiddleware(bearerReq(method, path, value), w.env);
    assert.equal(called, 0);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal(changes(w.db) - before, 1, `${method} ${path}: one counter upsert`);
  }
  assert.equal(audits(), auditsBefore, 'a refusal is not an audited action');
  assert.equal((w.db.prepare('SELECT revoked_at FROM agent_tokens WHERE id = ?').get('tok-adm') as { revoked_at: number | null }).revoked_at, null);
  await throughMiddleware(bearerReq('POST', `/api/social/posts/${UUID}/approve`, value), w.env);
  const row = w.db.prepare('SELECT revoked_at, revoke_reason FROM agent_tokens WHERE id = ?').get('tok-adm') as { revoked_at: number | null; revoke_reason: string };
  assert.ok(row.revoked_at);
  assert.equal(row.revoke_reason, 'refusals');
  assert.equal(count(w.db, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent_token.auto_revoke' AND target_id = 'tok-adm'`), 1);
  // A revoked token's further refusals write nothing, and on a table route it is 401.
  const before = changes(w.db);
  for (let i = 0; i < 5; i++) assert.equal((await throughMiddleware(bearerReq('PATCH', '/api/admin/users', value), w.env)).res.status, 403);
  assert.equal(changes(w.db), before);
  assert.equal((await hit(w, socialPosts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { token: value })).status, 401);
});

test('person-only handlers, called directly with a live admin token and no cookie (no middleware in front): refused, nothing changes', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'admin', ['cms.etkinlikler:draft', 'social:draft']);
  const pending = postOf(w, 'ed', 'pending_approval');
  const scheduled = postOf(w, 'ed', 'scheduled');
  const { id: submitted } = await cmsDraftOf(w, 'ed', 'submitted');
  const before = contentState(w);
  const probes: [unknown, string, string, Record<string, string>?, unknown?][] = [
    [cmsApprove.onRequestPost, 'POST', `/api/cms/drafts/${submitted}/approve`, { id: submitted }],
    [cmsReject.onRequestPost, 'POST', `/api/cms/drafts/${submitted}/reject`, { id: submitted }, { note: 'x' }],
    [cmsCancel.onRequestPost, 'POST', `/api/cms/drafts/${submitted}/cancel`, { id: submitted }],
    [socialApprove.onRequestPost, 'POST', `/api/social/posts/${pending}/approve`, { id: pending }, { revision: 0 }],
    [socialReject.onRequestPost, 'POST', `/api/social/posts/${pending}/reject`, { id: pending }, { revision: 0, note: 'x' }],
    [socialCancel.onRequestPost, 'POST', `/api/social/posts/${scheduled}/cancel`, { id: scheduled }, { revision: 0 }],
    [socialRequeue.onRequestPost, 'POST', `/api/social/posts/${scheduled}/requeue`, { id: scheduled }, { revision: 0 }],
    [socialDispatch.onRequestPost, 'POST', '/api/social/dispatch', {}, {}],
    [eventModes.onRequestPost, 'POST', '/api/social/event-modes', {}, { title: 'x' }],
    [adminUsers.onRequestPatch, 'PATCH', '/api/admin/users', {}, { userId: 'ed', role: 'admin', grant: true }],
    [mailSend.onRequestPost, 'POST', '/api/mail/send', {}, { to: ['x@example.org'], subject: 's', body: 'b' }],
    [dmReply.onRequestPost, 'POST', `/api/admin/social/dm/${UUID}/reply`, { id: UUID }, { text: 'hi' }],
    [tokensIndex.onRequestPost, 'POST', '/api/agent-tokens', {}, { label: 'x', scopes: ['social:draft'], days: 30 }],
    [tokensIndex.onRequestGet, 'GET', '/api/agent-tokens', {}],
    [tokensOne.onRequestDelete, 'DELETE', `/api/agent-tokens/${UUID}`, { id: UUID }],
    [announcements.onRequestPost, 'POST', '/api/admin/announcements', {}, { title: 'x', body: 'y' }],
  ];
  for (const [handler, method, path, params, body] of probes) {
    const res = await hit(w, handler, method, path, { token: value, params, body });
    assert.ok([401, 403].includes(res.status), `${method} ${path}: ${res.status}`);
    const b = await json(res);
    assert.ok(!(typeof b === 'object' && b && 'token' in b), `${method} ${path} must not mint`);
  }
  assert.equal(contentState(w), before);
  assert.equal(rows(w.db, 'agent_tokens'), 1, 'no token minted, none revoked');
});

// --- the scope x grant matrix through the real handlers --------------------

type Kind = { name: string; user: string; scopes: string[] };
const KINDS: Kind[] = [
  { name: 'cms read', user: 'ed', scopes: ['cms.etkinlikler:read'] },
  { name: 'cms draft', user: 'ed', scopes: ['cms.etkinlikler:draft'] },
  { name: 'cms draft, a group not held', user: 'ed', scopes: ['cms.yazilar:draft'] },
  { name: 'social read', user: 'ed', scopes: ['social:read'] },
  { name: 'social draft', user: 'ed', scopes: ['social:draft'] },
  { name: 'admin, cms read only', user: 'admin', scopes: ['cms.etkinlikler:read'] },
  { name: 'grants expired', user: 'lap', scopes: ['cms.etkinlikler:draft', 'social:draft'] },
  { name: 'grants revoked', user: 'rev', scopes: ['cms.etkinlikler:draft', 'social:draft'] },
  { name: 'member, no role', user: 'mem', scopes: ['cms.etkinlikler:draft', 'social:draft'] },
];
/** Whether the token reaches this area at this level now: its scope and its member's live grants. */
function reaches(k: Kind, area: string, level: 'read' | 'draft', podcast = false): boolean {
  const live = ['ed', 'ed2', 'admin'].includes(k.user);
  const held = (a: string) => k.scopes.some((s) => s.startsWith(`${a}:`) && (level === 'read' || s.endsWith(':draft')));
  if (!live) return false;
  if (area === 'cms') return held('cms.etkinlikler') && !podcast;
  if (area === 'social') return k.user !== 'admin' ? held('social') : held('social');
  if (area === 'media') return k.scopes.some((s) => s.endsWith(':draft') && (s.startsWith('social') || s === 'cms.etkinlikler:draft'));
  return true;
}

type Probe = { method: string; path: (ids: Ids) => string; handler: unknown; params?: (ids: Ids) => Record<string, string>; body?: (ids: Ids) => unknown };
type Ids = { draft: string; nonce: string; post: string; plan: string };
const PROBES: Probe[] = [
  { method: 'GET', path: () => '/api/cms/types', handler: cmsTypes.onRequestGet },
  { method: 'GET', path: () => '/api/cms/entries?type=events', handler: cmsEntries.onRequestGet },
  { method: 'GET', path: () => `/api/cms/entry?type=events&id=${EVENT_ID}`, handler: cmsEntry.onRequestGet },
  { method: 'GET', path: () => '/api/cms/drafts', handler: cmsDrafts.onRequestGet },
  { method: 'POST', path: () => '/api/cms/drafts', handler: cmsDrafts.onRequestPost, body: () => ({ type: 'events', action: 'create', data: newEvent('From the matrix') }) },
  { method: 'GET', path: (i) => `/api/cms/drafts/${i.draft}`, handler: cmsDraft.onRequestGet, params: (i) => ({ id: i.draft }) },
  { method: 'PATCH', path: (i) => `/api/cms/drafts/${i.draft}`, handler: cmsDraft.onRequestPatch, params: (i) => ({ id: i.draft }), body: (i) => ({ data: newEvent('Changed'), write_nonce: i.nonce }) },
  { method: 'DELETE', path: (i) => `/api/cms/drafts/${i.draft}`, handler: cmsDraft.onRequestDelete, params: (i) => ({ id: i.draft }) },
  { method: 'POST', path: (i) => `/api/cms/drafts/${i.draft}/submit`, handler: cmsSubmit.onRequestPost, params: (i) => ({ id: i.draft }) },
  { method: 'POST', path: () => '/api/cms/podcast/pull', handler: cmsPodcast.onRequestPost },
  { method: 'GET', path: () => '/api/social/posts?drafts=1', handler: socialPosts.onRequestGet },
  { method: 'POST', path: () => '/api/social/posts', handler: socialPosts.onRequestPost, body: () => postBody() },
  { method: 'GET', path: (i) => `/api/social/posts/${i.post}`, handler: socialPost.onRequestGet, params: (i) => ({ id: i.post }) },
  { method: 'PATCH', path: (i) => `/api/social/posts/${i.post}`, handler: socialPost.onRequestPatch, params: (i) => ({ id: i.post }), body: () => ({ revision: 0, ...postBody({ caption: 'changed' }) }) },
  { method: 'DELETE', path: (i) => `/api/social/posts/${i.post}`, handler: socialPost.onRequestDelete, params: (i) => ({ id: i.post }), body: () => ({ revision: 0 }) },
  { method: 'POST', path: (i) => `/api/social/posts/${i.post}/submit`, handler: socialSubmit.onRequestPost, params: (i) => ({ id: i.post }), body: () => ({ revision: 0 }) },
  { method: 'GET', path: () => `/api/social/plans?from=${WALL}&to=${WALL + 30 * 86_400}`, handler: socialPlans.onRequestGet },
  { method: 'POST', path: () => '/api/social/plans', handler: socialPlans.onRequestPost, body: () => planBody() },
  { method: 'PATCH', path: (i) => `/api/social/plans/${i.plan}`, handler: socialPlan.onRequestPatch, params: (i) => ({ id: i.plan }), body: () => ({ title: 'changed' }) },
  { method: 'DELETE', path: (i) => `/api/social/plans/${i.plan}`, handler: socialPlan.onRequestDelete, params: (i) => ({ id: i.plan }) },
  { method: 'POST', path: () => '/api/blog-submissions/upload-image', handler: upload.onRequestPost },
  { method: 'GET', path: () => '/api/mcp', handler: mcp.onRequestGet },
  { method: 'POST', path: () => '/api/mcp', handler: mcp.onRequestPost, body: () => ({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) },
];

test('matrix: every table route x every scope level, live, expired and revoked grants; only a reaching token gets past the gate, and the rest change nothing', async () => {
  assert.equal(PROBES.length, AGENT_ROUTES.length, 'one probe per table row');
  for (const p of PROBES) assert.ok(routeFor(p.method, p.path({ draft: UUID, nonce: 'n', post: UUID, plan: UUID }).split('?')[0]), `${p.method} ${p.path({ draft: UUID, nonce: 'n', post: UUID, plan: UUID })}`);
  const seen: string[] = [];
  for (const k of KINDS) {
    for (const p of PROBES) {
      const w = await world();
      const token = await mintToken(w.db, k.user, k.scopes);
      const { id: draft, nonce } = await cmsDraftOf(w, k.user);
      const ids: Ids = { draft, nonce, post: postOf(w, k.user, 'draft', { scheduled_at: null }), plan: planOf(w, k.user) };
      const path = p.path(ids);
      const route = routeFor(p.method, path.split('?')[0])!;
      // The podcast pull is Topluluk's, a group no kind here holds.
      const allowed = reaches(k, route.area, route.level, path === '/api/cms/podcast/pull');
      const before = contentState(w);
      let res: Response;
      if (route.area === 'media') res = await uploadReq(w, token, jpeg(1080, 1350));
      else res = await hit(w, p.handler, p.method, path, { token, params: p.params?.(ids), body: p.body?.(ids) });
      const body = await json(res);
      const label = `${k.name}: ${p.method} ${path.split('?')[0]} -> ${res.status} ${JSON.stringify(body).slice(0, 80)}`;
      seen.push(label);
      assert.notEqual(res.status, 401, label);
      assert.ok(res.status < 500, label);
      if (route.area === 'mcp') {
        if (p.method === 'POST') {
          const tools = (body as any).result.tools.map((t: { name: string }) => t.name);
          if (!['ed', 'admin'].includes(k.user)) assert.deepEqual(tools, [], `${label}: a token without live grants lists no tool`);
          for (const t of tools) {
            const area = t.startsWith('cms_') ? 'cms' : 'social';
            const level = /list|get/.test(t) ? 'read' : 'draft';
            assert.ok(reaches(k, area, level), `${label}: ${t} listed`);
          }
        }
        continue;
      }
      if (allowed) {
        // The submit fixture has no date, so a reaching token gets the handler's own 422 not_ready.
        assert.ok(res.ok || (body as { code?: string }).code === 'not_ready', label);
        continue;
      }
      assert.equal(res.status, 403, label);
      assert.equal(contentState(w), before, `${label}: nothing changed`);
      assert.doesNotMatch(JSON.stringify(body), /secret caption|private note|by (ed|lap|rev|mem|admin) /, `${label}: no content leaks`);
    }
  }
  assert.equal(seen.length, KINDS.length * PROBES.length);
});

test('stored scopes the API would never write: an approve level, a duplicate area, a wildcard, an empty list, not JSON: 401 everywhere', async () => {
  const w = await world();
  const bad = [['cms.etkinlikler:approve'], ['social:draft', 'social:read'], ['*'], [], ['social'], ['social:draft', 'admin'], ['__proto__'], ['cms.*:draft']];
  for (const scopes of bad) {
    const token = await mintToken(w.db, 'admin', scopes);
    for (const [handler, method, path] of [[socialPosts.onRequestGet, 'GET', '/api/social/posts?drafts=1'], [cmsDrafts.onRequestGet, 'GET', '/api/cms/drafts']] as const) {
      assert.equal((await hit(w, handler, method, path, { token })).status, 401, `${JSON.stringify(scopes)} ${path}`);
    }
  }
  // Expired, revoked, or a member who is gone: the same 401, and no row written (a stale client, not a guess).
  const expired = await mintToken(w.db, 'ed', ['social:draft'], { expiresAt: WALL - 1 });
  const revoked = await mintToken(w.db, 'ed', ['social:draft'], { revokedAt: WALL - 60 });
  w.db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('gone', 'g-gone', 'gone@example.org', 1, 1)`).run();
  const orphan = await mintToken(w.db, 'gone', ['social:draft']);
  w.db.exec('PRAGMA foreign_keys = OFF');
  w.db.prepare(`DELETE FROM users WHERE id = 'gone'`).run();
  for (const token of [expired, revoked, orphan]) {
    const before = changes(w.db);
    const res = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token, body: postBody() });
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), { error: 'Unauthorized', code: 'unauthorized' });
    assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer');
    if (token !== orphan) assert.equal(changes(w.db), before, 'a dead token writes nothing');
  }
  assert.equal(rows(w.db, 'social_posts'), 0);
  const raw = await mintToken(w.db, 'admin', ['social:draft']);
  w.db.prepare(`UPDATE agent_tokens SET scopes = '{"social":"draft"}' WHERE scopes = '["social:draft"]'`).run();
  assert.equal((await hit(w, socialPosts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { token: raw })).status, 401);
});

// =========================================================================
// 2. Data isolation
// =========================================================================

test('a token never reads or changes a colleague\'s CMS draft: GET, PATCH, DELETE, submit are 404 and the row is unchanged', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['cms.etkinlikler:draft']);
  for (const status of ['draft', 'rejected', 'submitted']) {
    const { id, nonce } = await cmsDraftOf(w, 'ed2', status);
    const before = contentState(w);
    for (const [handler, method, suffix, body] of [
      [cmsDraft.onRequestGet, 'GET', '', undefined], [cmsDraft.onRequestPatch, 'PATCH', '', { data: newEvent('hijack'), write_nonce: nonce }],
      [cmsDraft.onRequestDelete, 'DELETE', '', undefined], [cmsSubmit.onRequestPost, 'POST', '/submit', undefined],
    ] as const) {
      const res = await hit(w, handler, method, `/api/cms/drafts/${id}${suffix}`, { token, params: { id }, body });
      assert.equal(res.status, 404, `${status}: ${method} ${suffix}`);
      assert.deepEqual(await res.json(), { error: 'Not found', code: 'not_found' });
    }
    assert.equal(contentState(w), before);
  }
  const list = await json(await hit(w, cmsDrafts.onRequestGet, 'GET', '/api/cms/drafts', { token }));
  assert.doesNotMatch(JSON.stringify(list), /by ed2 /);
  assert.deepEqual([list.queue, list.inflight], [[], []]);
});

test('a token never reads or changes a colleague\'s unpublished post or plan (404, unchanged), and sees no one\'s e-mail or a colleague\'s note', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'pub', ['social:draft']); // a publisher's token, the widest social reach
  const theirs = ['draft', 'pending_approval', 'scheduled', 'rejected', 'failed', 'cancelled'].map((s) => postOf(w, 'ed2', s, { review_note: 'reviewer said: secret note' }));
  const plan = planOf(w, 'ed2');
  const before = contentState(w);
  for (const id of theirs) {
    // A fresh token per post keeps every request under the 30-a-minute limit (all run in one wall-clock minute).
    const token = await mintToken(w.db, 'pub', ['social:draft']);
    for (const [handler, method, suffix, body] of [
      [socialPost.onRequestGet, 'GET', '', undefined], [socialPost.onRequestPatch, 'PATCH', '', { revision: 0, ...postBody({ caption: 'hijack' }) }],
      [socialPost.onRequestDelete, 'DELETE', '', { revision: 0 }], [socialSubmit.onRequestPost, 'POST', '/submit', { revision: 0 }],
      [socialPost.onRequestPatch, 'PATCH', '', { revision: 99, ...postBody() }], [socialSubmit.onRequestPost, 'POST', '/submit', { revision: 99 }],
    ] as const) {
      const res = await hit(w, handler, method, `/api/social/posts/${id}${suffix}`, { token, params: { id }, body });
      assert.equal(res.status, 404, `${method} ${suffix} rev ${(body as any)?.revision}`);
    }
  }
  for (const [handler, method, body] of [[socialPlan.onRequestPatch, 'PATCH', { title: 'hijack', note: 'x' }], [socialPlan.onRequestDelete, 'DELETE', undefined]] as const) {
    assert.equal((await hit(w, handler, method, `/api/social/plans/${plan}`, { token, params: { id: plan }, body })).status, 404);
  }
  // A post on a colleague's plan is refused as a missing plan.
  assert.equal((await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token, body: postBody({ planId: plan }) })).status, 400);
  assert.equal(contentState(w), before);

  // Every list a token can ask for: no colleague's unpublished post, no e-mail, no colleague's note.
  postOf(w, 'ed2', 'published', { review_note: 'reviewer said: secret note' });
  const from = WALL - 86_400, to = WALL + 30 * 86_400;
  const lists = [
    '/api/social/posts?drafts=1', '/api/social/posts?status=pending_approval', '/api/social/posts?status=scheduled',
    '/api/social/posts?done=1', `/api/social/posts?from=${from}&to=${to}`,
  ];
  for (const path of lists) {
    const body = await json(await hit(w, socialPosts.onRequestGet, 'GET', path, { token }));
    const text = JSON.stringify(body);
    assert.doesNotMatch(text, /@/, `${path}: no e-mail address`);
    assert.doesNotMatch(text, /secret note/, `${path}: no colleague's review note`);
    for (const p of (body as { posts: { id: string; status: string }[] }).posts) {
      assert.ok(!theirs.includes(p.id), `${path}: ${p.status} post of a colleague listed`);
    }
  }
  const plans = await json(await hit(w, socialPlans.onRequestGet, 'GET', `/api/social/plans?from=${from}&to=${to}`, { token }));
  assert.doesNotMatch(JSON.stringify(plans), /@|private note/);
  const theirPlan = plans.plans.find((p: { id: string }) => p.id === plan);
  assert.equal(theirPlan.note, null);
  assert.equal(theirPlan.assigneeEmail, null);
});

test('a token\'s every successful answer, REST and MCP, carries no e-mail address', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft', 'cms.etkinlikler:draft']);
  const own = postOf(w, 'ed', 'draft');
  const plan = planOf(w, 'ed');
  const created = await json(await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token, body: postBody() }));
  const answers = [
    created,
    await json(await hit(w, socialPost.onRequestGet, 'GET', `/api/social/posts/${own}`, { token, params: { id: own } })),
    await json(await hit(w, socialPlan.onRequestPatch, 'PATCH', `/api/social/plans/${plan}`, { token, params: { id: plan }, body: { title: 'x2' } })),
    await json(await hit(w, socialPlans.onRequestPost, 'POST', '/api/social/plans', { token, body: planBody({ assigneeId: 'ed2' }) })),
    await json(await hit(w, cmsDrafts.onRequestGet, 'GET', '/api/cms/drafts', { token })),
    await json(await hit(w, cmsTypes.onRequestGet, 'GET', '/api/cms/types', { token })),
    (await rpc(w, token, 'tools/call', { name: 'social_list_my_drafts', arguments: {} })).body,
    (await rpc(w, token, 'tools/call', { name: 'social_list_plans', arguments: { from: WALL - 10, to: WALL + 40 * 86_400 } })).body,
  ];
  for (const a of answers) assert.doesNotMatch(JSON.stringify(a), /@example\.org/, JSON.stringify(a).slice(0, 120));
});

test('mass assignment: status, author, approver, revision or agent mark in a token\'s body are ignored; a draft stays a draft', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'pub', ['social:draft', 'cms.etkinlikler:draft'], { id: 'tok-pub' });
  await grantRole((w.env as any).DB, { userId: 'pub', role: 'content.etkinlikler.edit', expiresAt: null, by: null }, WALL - 100);
  const extra = { status: 'scheduled', approvedBy: 'pub', approved_by: 'pub', createdBy: 'ed2', created_by: 'ed2', revision: 7, agentTokenId: null, agent_token_id: null, byAgent: false, eventModeId: 'x' };
  const res = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token, body: postBody(extra) });
  assert.equal(res.status, 201, 'unknown fields are ignored');
  {
    const { id } = await res.json() as { id: string };
    const row = w.db.prepare('SELECT status, created_by, approved_by, revision, agent_token_id FROM social_posts WHERE id = ?').get(id) as Record<string, unknown>;
    assert.deepEqual({ ...row }, { status: 'draft', created_by: 'pub', approved_by: null, revision: 0, agent_token_id: 'tok-pub' });
    // A save of its own draft that asks for scheduled stays a draft too.
    const save = await hit(w, socialPost.onRequestPatch, 'PATCH', `/api/social/posts/${id}`, { token, params: { id }, body: { revision: 0, ...postBody(extra) } });
    assert.ok(save.status < 500);
    assert.equal((w.db.prepare('SELECT status, approved_by FROM social_posts WHERE id = ?').get(id) as { status: string }).status, 'draft');
  }
  const cms = await hit(w, cmsDrafts.onRequestPost, 'POST', '/api/cms/drafts', { token, body: { type: 'events', action: 'create', data: newEvent(), status: 'approved', author_id: 'ed2', reviewer_id: 'pub' } });
  assert.equal(cms.status, 201);
  const { draft } = await cms.json() as { draft: { id: string } };
  const row = w.db.prepare('SELECT status, author_id, reviewer_id FROM content_drafts WHERE id = ?').get(draft.id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'draft', author_id: 'pub', reviewer_id: null });
});

// =========================================================================
// 3. MCP
// =========================================================================

test('MCP: inner calls never exceed the token\'s level; a read principal handed a draft route by markInternal is refused by the handler and writes nothing', async () => {
  const w = await world();
  for (const [scopes, handler, path, body] of [
    [['social:read'], socialPosts.onRequestPost, '/api/social/posts', postBody()],
    [['social:read'], socialPlans.onRequestPost, '/api/social/plans', planBody()],
    [['cms.etkinlikler:read'], cmsDrafts.onRequestPost, '/api/cms/drafts', { type: 'events', action: 'create', data: newEvent() }],
    [['cms.etkinlikler:draft'], socialPosts.onRequestPost, '/api/social/posts', postBody()],
    [['social:draft'], cmsDrafts.onRequestPost, '/api/cms/drafts', { type: 'events', action: 'create', data: newEvent() }],
  ] as const) {
    const token = await mintToken(w.db, 'ed', [...scopes]);
    const outer = await authenticateAgent(bearerReq('POST', '/api/mcp', token), w.env, WALL);
    assert.equal(outer.kind, 'agent');
    const before = contentState(w);
    const inner = new Request(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(token) }, body: JSON.stringify(body) });
    markInternal(inner, outer as Extract<AgentAuth, { kind: 'agent' }>);
    const res = await (handler as (c: unknown) => Promise<Response>)({ request: inner, env: w.env, params: {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    // Refused before the handler: a marked request its message did not pay a quota for is
    // agent_budget (checkQuota), and the handler would refuse the level anyway.
    assert.equal(res.status, 429, `${scopes} -> ${path}`);
    assert.equal(((await res.json()) as { code: string }).code, 'agent_budget');
    assert.equal(contentState(w), before);
  }
  // A marked inner request off the table is human_only, whatever the outer principal.
  const token = await mintToken(w.db, 'admin', ['social:draft', 'cms.etkinlikler:draft']);
  const outer = await authenticateAgent(bearerReq('POST', '/api/mcp', token), w.env, WALL) as Extract<AgentAuth, { kind: 'agent' }>;
  const pending = postOf(w, 'ed', 'pending_approval');
  const inner = new Request(`${BASE}/api/social/posts/${pending}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"revision":0}' });
  markInternal(inner, outer);
  const res = await (socialApprove.onRequestPost as (c: unknown) => Promise<Response>)({ request: inner, env: w.env, params: { id: pending }, waitUntil() {} });
  assert.equal(res.status, 403);
  assert.equal((w.db.prepare('SELECT status FROM social_posts WHERE id = ?').get(pending) as { status: string }).status, 'pending_approval');
});

test('MCP: a token whose grants ended lists no tools and every tool is unknown to it', async () => {
  const w = await world();
  for (const user of ['lap', 'rev', 'mem']) {
    const token = await mintToken(w.db, user, ['cms.etkinlikler:draft', 'social:draft']);
    assert.deepEqual((await rpc(w, token, 'tools/list')).body.result.tools, [], user);
    const before = contentState(w);
    for (const name of ['social_create_post', 'social_create_plan', 'cms_create_draft', 'social_list_my_drafts', 'cms_list_types']) {
      const { body } = await rpc(w, token, 'tools/call', { name, arguments: {} });
      assert.equal(body.error?.code, -32602, `${user} ${name}`);
    }
    assert.equal(contentState(w), before);
  }
});

test('MCP: malformed JSON-RPC: parse errors, batches, bad ids, bad params, unknown methods; never a 5xx, never a write', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft']);
  const before = contentState(w);
  const cases: [string, number, number][] = [
    ['{', 400, -32700], ['', 400, -32700], ['null', 400, -32600], ['42', 400, -32600], ['"x"', 400, -32600],
    ['[]', 400, -32600], [JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]), 400, -32600],
    [JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'social_create_post', arguments: postBody() } }]), 400, -32600],
    [JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'ping' }), 400, -32600],
    [JSON.stringify({ id: 1, method: 'ping' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: 1.5, method: 'ping' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: null, method: 'ping' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: { a: 1 }, method: 'ping' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: true, method: 'ping' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 7 }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: [] }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: 'x' }), 400, -32600],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/approve' }), 200, -32601],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call ' }), 200, -32601],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/list' }), 200, -32601],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sampling/createMessage' }), 200, -32601],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: '__proto__' }), 200, -32601],
    [JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'constructor' }), 200, -32601],
  ];
  for (const [raw, status, code] of cases) {
    const r = await mcpPost(w, token, raw);
    assert.equal(r.status, status, raw.slice(0, 60));
    assert.equal(r.body.error.code, code, raw.slice(0, 60));
  }
  assert.equal(contentState(w), before);
});

test('MCP: unknown and person-only tools, names that are not strings, arguments that are not objects, prototype keys: -32602, nothing runs, no prototype is polluted', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft', 'cms.etkinlikler:draft']);
  const before = contentState(w);
  const calls: unknown[] = [
    { name: 'social_approve_post', arguments: {} }, { name: 'cms_approve_draft', arguments: {} }, { name: 'upload_image', arguments: {} },
    { name: 'toString', arguments: {} }, { name: '__proto__', arguments: {} }, { name: 'constructor', arguments: {} },
    { name: ['social_create_post'], arguments: postBody() }, { name: { toString: 'social_create_post' }, arguments: postBody() }, { name: 7 },
    { name: 'social_create_post', arguments: [postBody()] }, { name: 'social_create_post', arguments: 'type=image' },
    JSON.parse('{"name": "social_create_post", "arguments": {"__proto__": {"type": "image"}, "type": "image"}}'),
    JSON.parse('{"name": "social_create_post", "__proto__": {"name": "social_create_post"}}'),
    { name: 'social_create_post', arguments: { type: 'image', constructor: { prototype: { polluted: 1 } } } },
    { name: 'social_create_post', arguments: { type: 'image', toString: 'x' } },
    { name: 'social_create_post', arguments: { type: 'image', hasOwnProperty: 'x' } },
    { name: 'social_create_post', arguments: { type: 'image', status: 'scheduled' } },
    { name: 'social_create_post', arguments: { type: 'video' } },
    { name: 'social_get_post', arguments: { id: '../../admin/users' } },
    { name: 'social_get_post', arguments: { id: `${UUID}/approve` } },
    { name: 'social_submit_post', arguments: { id: '..', revision: 0 } },
    { name: 'cms_get_draft', arguments: { id: UUID.toUpperCase() } },
    { name: 'cms_submit_draft', arguments: { id: `${UUID}/../${UUID}` } },
    { name: 'social_get_post', arguments: { id: 5 } },
  ];
  for (const params of calls) {
    // Sent as raw JSON, so a __proto__ key arrives as an own property, as it would on the wire.
    const proto = `{"jsonrpc":"2.0","id":${rpcId++},"method":"tools/call","params":${JSON.stringify(params)}}`;
    const r = await mcpPost(w, token, proto);
    assert.equal(r.status, 200, proto.slice(0, 100));
    assert.equal(r.body.error?.code, -32602, `${proto.slice(0, 100)} -> ${JSON.stringify(r.body).slice(0, 100)}`);
  }
  assert.equal(({} as any).polluted, undefined);
  assert.equal(({} as any).type, undefined);
  assert.equal(contentState(w), before);
});

test('MCP: foreign, look-alike and null Origins are 403 before the token is read, and write nothing', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft']);
  for (const origin of ['https://evil.example', 'null', 'https://rsg-turkiye.iscbsc.org.evil.example', 'http://rsg-turkiye.iscbsc.org',
    'https://rsg-turkiye.iscbsc.org:443', 'https://rsg-turkiye.iscbsc.org/', 'https://sub.rsg-turkiye.iscbsc.org', 'http://localhost:4321', 'https://preview.example', '']) {
    const before = changes(w.db);
    const r = await mcpPost(w, token, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'social_create_post', arguments: postBody() } }), { Origin: origin });
    assert.equal(r.status, 403, `Origin ${JSON.stringify(origin)}`);
    assert.equal(changes(w.db), before, `Origin ${JSON.stringify(origin)} wrote`);
  }
  assert.equal(rows(w.db, 'social_posts'), 0);
  // The site's own origin is served.
  assert.equal((await rpc(w, token, 'ping', undefined, { Origin: 'https://rsg-turkiye.iscbsc.org' })).status, 200);
});

test('MCP: protocol versions: an unsupported MCP-Protocol-Version header is 400 on every method but initialize; initialize answers a supported one', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft']);
  for (const version of ['2024-11-05', '2099-01-01', 'garbage', '2025-06-18,2025-03-26', '2025-03-26;q=1']) {
    for (const method of ['ping', 'tools/list', 'tools/call']) {
      const r = await rpc(w, token, method, method === 'tools/call' ? { name: 'social_create_post', arguments: postBody() } : undefined, { 'MCP-Protocol-Version': version });
      assert.equal(r.status, 400, `${version} ${method}`);
    }
    const init = await rpc(w, token, 'initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 't', version: '1' } }, { 'MCP-Protocol-Version': version });
    assert.equal(init.status, 200);
    assert.ok(['2025-06-18', '2025-03-26'].includes(init.body.result.protocolVersion));
  }
  assert.equal(rows(w.db, 'social_posts'), 0);
});

test('MCP: oversized messages are 413 and run nothing; a large argument within the cap is refused by the handler, not stored', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft']);
  const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'social_create_post', arguments: postBody({ caption: 'x'.repeat(LIMITS.BODY_BYTES) }) } });
  const r = await mcpPost(w, token, big);
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'too_large');
  const large = await rpc(w, token, 'tools/call', { name: 'social_create_post', arguments: postBody({ caption: 'x'.repeat(200_000) }) });
  assert.equal(large.body.result?.isError, true, JSON.stringify(large.body).slice(0, 200));
  // Deeply nested arguments: parsed, refused, no stack trouble.
  const deep = `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"social_create_post","arguments":{"type":"image","captionOverrides":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}}}}`;
  const d = await mcpPost(w, token, deep);
  assert.ok(d.status < 500, String(d.status));
  assert.equal(rows(w.db, 'social_posts'), 0);
});

test('MCP: a tools/call sent as a notification (no id) runs nothing and answers 202; it is counted as a request and its tool\'s quota is spent (counts even when refused)', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft'], { id: 'tok-n' });
  const r = await mcpPost(w, token, JSON.stringify({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'social_create_post', arguments: postBody() } }));
  assert.equal(r.status, 202);
  assert.equal(rows(w.db, 'social_posts'), 0);
  const c = w.db.prepare(`SELECT general + reserve AS req, writes FROM agent_counters WHERE bucket LIKE '%:t:tok-n'`).get() as { req: number; writes: number };
  // Recorded behaviour (final-fix call 6): the quota is spent with the message.
  assert.deepEqual({ ...c }, { req: 1, writes: 1 });
});

// =========================================================================
// 4. Budgets, at and just past each limit, and at UTC day boundaries
// =========================================================================

/** A database for the authenticateAgent-level tests, each with its own clock. */
async function limitsWorld() {
  const w = await world();
  return { ...w, DB: (w.env as any).DB };
}
const authAt = (w: World, method: string, path: string, token: string, now: number, init: { body?: BodyInit; ip?: string; headers?: Record<string, string> } = {}) =>
  authenticateAgent(new Request(`${BASE}${path}`, {
    method, body: init.body, duplex: 'half',
    headers: { ...bearer(token), ...(init.ip ? { 'CF-Connecting-IP': init.ip } : {}), ...(init.headers ?? {}) },
  } as RequestInit), w.env, now);
const statusOf = (a: AgentAuth) => (a.kind === 'refused' ? a.response.status : a.kind === 'agent' ? 200 : 0);
const codeOf = async (a: AgentAuth) => (a.kind === 'refused' ? ((await a.response.clone().json()) as { code: string }).code : 'ok');
const dayKey = (now: number) => String(Math.floor(now / 86_400)).padStart(6, '0');
/** Another member's token row today holding these counts: the shared pools, spent. */
function spend(db: DatabaseSync, now: number, c: { general?: number; reserve?: number; writes?: number; quota_reserve?: number }) {
  db.prepare('INSERT INTO agent_counters (bucket, user_id, general, reserve, writes, quota_reserve) VALUES (?, ?, ?, ?, ?, ?)')
    .run(`${dayKey(now)}:t:someone-else-${Math.random()}`, 'other', c.general ?? 0, c.reserve ?? 0, c.writes ?? 0, c.quota_reserve ?? 0);
}

test('budget: the token minute: the 30th passes, the 31st is 429 and writes exactly its minute count (the flood signal), the next minute passes', async () => {
  const w = await limitsWorld();
  const t = await mintToken(w.db, 'ed', ['social:read']);
  const at = DAY0 + 600; // a minute boundary
  for (let i = 0; i < LIMITS.TOKEN_PER_MINUTE; i++) assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', t, at + i)), 200, `#${i + 1}`);
  const before = changes(w.db);
  const over = await authAt(w, 'GET', '/api/social/posts', t, at + 59);
  assert.equal(statusOf(over), 429);
  assert.equal(changes(w.db) - before, 1, 'by design: the minute refusal is counted for the flood signal');
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', t, at + 60)), 200);
});

test('budget: the member day: request 300 passes, 301 is 429 with zero rows written, at 23:59:59 UTC still refused, at 00:00:00 UTC served', async () => {
  const w = await limitsWorld();
  const tokens = await Promise.all([0, 1, 2, 3, 4].map(() => mintToken(w.db, 'ed', ['social:read'])));
  for (let i = 0; i < LIMITS.MEMBER_PER_DAY; i++) {
    assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', tokens[i % 5], DAY0 + Math.floor(i / 5) * 60 + (i % 5))), 200, `#${i + 1}`);
  }
  for (const at of [DAY0 + 80_000, DAY0 + 86_399]) {
    const before = changes(w.db);
    const a = await authAt(w, 'GET', '/api/social/posts', tokens[0], at);
    assert.equal(statusOf(a), 429);
    assert.equal(Number((a as any).response.headers.get('Retry-After')), DAY0 + 86_400 - at);
    assert.equal(changes(w.db), before, `${at - DAY0}: a refusal for the day writes nothing`);
  }
  // A new token for the same member changes nothing.
  const fresh = await mintToken(w.db, 'ed', ['social:read']);
  const before = changes(w.db);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', fresh, DAY0 + 86_399)), 429);
  assert.equal(changes(w.db), before);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', tokens[0], DAY0 + 86_400)), 200);
});

test('budget: the general pool and the social reserve at their edges; past each, 429 agent_budget with zero rows; the next UTC day is free again', async () => {
  const w = await limitsWorld();
  const cms = await mintToken(w.db, 'ed', ['cms.etkinlikler:read']);
  const social = await mintToken(w.db, 'ed2', ['social:read']);
  const noSocialNow = await mintToken(w.db, 'lap', ['social:read']);
  const at = DAY0 + 3600;
  spend(w.db, at, { general: LIMITS.AGENT_GENERAL_PER_DAY - 1 });
  assert.equal(statusOf(await authAt(w, 'GET', '/api/cms/types', cms, at)), 200, 'the 12,000th');
  for (const [token, path, who] of [[cms, '/api/cms/types', 'cms'], [noSocialNow, '/api/social/posts', 'a social token without a live grant'], [cms, '/api/mcp', 'a cms token on MCP']] as const) {
    const before = changes(w.db);
    const a = await authAt(w, path === '/api/mcp' ? 'POST' : 'GET', path, token, at + 1, path === '/api/mcp' ? { body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' } : {});
    assert.equal(statusOf(a), 429, who);
    assert.equal(await codeOf(a), 'agent_budget', who);
    assert.equal(changes(w.db), before, `${who}: zero rows`);
  }
  // Social work draws on the reserve, up to its last request.
  spend(w.db, at, { reserve: LIMITS.AGENT_RESERVE_PER_DAY - 1 });
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', social, at + 2)), 200, 'the last reserve request');
  const before = changes(w.db);
  const a = await authAt(w, 'GET', '/api/social/posts', social, at + 3);
  assert.equal(await codeOf(a), 'agent_budget');
  assert.equal(changes(w.db), before);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', social, DAY0 + 86_399)), 429);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/cms/types', cms, DAY0 + 86_400)), 200);
});

test('budget: the agents\' write pools: write 1,600 passes, 1,601 is agent_budget with zero rows (reads still pass); social writes use the 400 reserve to its end', async () => {
  const w = await limitsWorld();
  const cms = await mintToken(w.db, 'ed', ['cms.etkinlikler:draft']);
  const social = await mintToken(w.db, 'ed2', ['social:draft']);
  const at = DAY0 + 7200;
  spend(w.db, at, { writes: LIMITS.AGENT_WRITES_GENERAL_PER_DAY - 1 });
  assert.equal(statusOf(await authAt(w, 'POST', '/api/cms/drafts', cms, at, { body: '{}' })), 200, 'the 1,600th write');
  for (const [method, path, body] of [['POST', '/api/cms/drafts', '{}'], ['PATCH', `/api/cms/drafts/${UUID}`, '{}'], ['DELETE', `/api/cms/drafts/${UUID}`, undefined], ['POST', `/api/cms/drafts/${UUID}/submit`, undefined], ['POST', '/api/blog-submissions/upload-image', 'x']] as const) {
    const before = changes(w.db);
    const a = await authAt(w, method, path, cms, at + 1, { body });
    assert.equal(await codeOf(a), 'agent_budget', `${method} ${path}`);
    assert.equal(changes(w.db), before, `${method} ${path}: zero rows`);
  }
  assert.equal(statusOf(await authAt(w, 'GET', '/api/cms/drafts', cms, at + 2)), 200, 'reads go on');
  spend(w.db, at, { writes: LIMITS.AGENT_WRITES_RESERVE_PER_DAY - 1, quota_reserve: LIMITS.AGENT_WRITES_RESERVE_PER_DAY - 1 });
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', social, at + 3, { body: '{}' })), 200, 'the last reserve write');
  const before = changes(w.db);
  assert.equal(await codeOf(await authAt(w, 'POST', '/api/social/plans', social, at + 4, { body: '{}' })), 'agent_budget');
  assert.equal(changes(w.db), before);
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', social, DAY0 + 86_400, { body: '{}' })), 200, 'the next day');
});

test('budget: per-token quotas: write 200, submit 20, upload 20 each pass; one more is 429 with zero rows; the next UTC day each is free again', async () => {
  const w = await limitsWorld();
  for (const [quota, limit, method, path, body] of [
    ['writes', LIMITS.WRITES_PER_DAY, 'POST', '/api/social/plans', '{}'],
    ['submits', LIMITS.SUBMITS_PER_DAY, 'POST', `/api/social/posts/${UUID}/submit`, '{}'],
    ['uploads', LIMITS.UPLOADS_PER_DAY, 'POST', '/api/blog-submissions/upload-image', 'img'],
  ] as const) {
    const token = await mintToken(w.db, 'ed', ['social:draft'], { id: `tok-${quota}` });
    // Preloaded to one short of the limit, as earlier requests today would have left it.
    w.db.prepare(`INSERT INTO agent_counters (bucket, user_id, ${quota}) VALUES (?, 'x-preload', ?)`).run(`${dayKey(DAY0)}:t:tok-${quota}`, limit - 1);
    assert.equal(statusOf(await authAt(w, method, path, token, DAY0 + 100, { body })), 200, `${quota} #${limit}`);
    const before = changes(w.db);
    const a = await authAt(w, method, path, token, DAY0 + 101, { body });
    assert.equal(statusOf(a), 429, `${quota} #${limit + 1}`);
    assert.equal(await codeOf(a), 'rate_limited');
    assert.equal(changes(w.db), before, `${quota}: zero rows`);
    assert.equal(statusOf(await authAt(w, method, path, token, DAY0 + 86_400, { body })), 200, `${quota}: next day`);
  }
});

test('budget: failed authentications: an IP\'s 10th counts, its 11th and even a valid token from it are 429 with zero rows, until the 10-minute window ends', async () => {
  const w = await limitsWorld();
  const valid = await mintToken(w.db, 'ed', ['social:read']);
  const ip = '203.0.113.7';
  const at = DAY0 + 1200; // a 10-minute boundary
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH; i++) assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', newTokenValue(), at + i, { ip })), 401, `#${i + 1}`);
  for (const token of [newTokenValue(), valid]) {
    const before = changes(w.db);
    assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', token, at + 599, { ip })), 429);
    assert.equal(changes(w.db), before);
  }
  // Same /64, another address: still the same subject.
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', valid, at + 30, { ip: '2001:db8:1:2::1' })), 200);
  for (let i = 0; i < LIMITS.IP_FAILED_AUTH; i++) await authAt(w, 'GET', '/api/social/posts', newTokenValue(), at + 40 + i, { ip: `2001:db8:1:2::${i + 10}` });
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', valid, at + 100, { ip: '2001:db8:1:2:ffff:ffff:ffff:ffff' })), 429);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', valid, at + 600, { ip })), 200, 'the next window');
});

test('budget: the day\'s failure cap: the 5,000th failure is counted, the 5,001st writes zero rows and is still 401; the next UTC day counts again', async () => {
  const w = await limitsWorld();
  const at = DAY0 + 500;
  w.db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(`${dayKey(at)}:g:failures`, LIMITS.FAILURES_PER_DAY - 1);
  let before = changes(w.db);
  assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', newTokenValue(), at, { ip: '198.51.100.1' })), 401);
  assert.equal(changes(w.db) - before, 2, 'the 5,000th: the IP row and the day row');
  for (const [i, path] of ['/api/social/posts', '/api/cms/drafts', '/api/mcp'].entries()) {
    before = changes(w.db);
    assert.equal(statusOf(await authAt(w, 'GET', path, newTokenValue(), at + 1 + i, { ip: `198.51.100.${2 + i}` })), 401);
    assert.equal(changes(w.db), before, `${path}: past the cap, zero rows`);
  }
  // Outside the table, through the middleware (which reads the wall clock): 403 and zero rows.
  w.db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, ?)').run(`${dayKey(WALL)}:g:failures`, LIMITS.FAILURES_PER_DAY);
  before = changes(w.db);
  const { res } = await throughMiddleware(new Request(`${BASE}/api/admin/users`, { headers: { ...bearer(newTokenValue()), 'CF-Connecting-IP': '198.51.100.9' } }), w.env);
  assert.equal(res.status, 403);
  assert.equal(changes(w.db), before);
  before = changes(w.db);
  await authAt(w, 'GET', '/api/social/posts', newTokenValue(), DAY0 + 86_400, { ip: '198.51.100.10' });
  assert.equal(changes(w.db) - before, 2, 'the next day counts again');
});

test('budget: size caps: exactly 256 KB passes and 256 KB + 1 is 413, by Content-Length, by a chunked stream and by a lying Content-Length; uploads at 5 MB the same', async () => {
  const w = await limitsWorld();
  let n = 0;
  const fresh = () => mintToken(w.db, 'ed', ['social:draft'], { id: `tok-size-${n++}` });
  const fill = (bytes: number) => new Uint8Array(bytes).fill(0x61);
  const stream = (bytes: number) => {
    let left = bytes;
    return new ReadableStream<Uint8Array>({ pull(c) { if (left <= 0) { c.close(); return; } const k = Math.min(left, 65_536); left -= k; c.enqueue(fill(k)); } });
  };
  const at = DAY0 + 40;
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: fill(LIMITS.BODY_BYTES) })), 200, 'exactly the cap');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: fill(LIMITS.BODY_BYTES + 1) })), 413, 'one byte over');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: stream(LIMITS.BODY_BYTES) })), 200, 'a stream of exactly the cap');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: stream(LIMITS.BODY_BYTES + 1) })), 413, 'a stream one byte over');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: 'x', headers: { 'Content-Length': String(LIMITS.BODY_BYTES + 1) } }).catch(() => ({ kind: 'refused', response: new Response(null, { status: 413 }) }) as AgentAuth)), 413, 'a declared length over the cap');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', await fresh(), at, { body: stream(LIMITS.BODY_BYTES * 4), headers: { 'Content-Length': '10' } }).catch(() => ({ kind: 'refused', response: new Response(null, { status: 413 }) }) as AgentAuth)), 413, 'a lying small length');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/blog-submissions/upload-image', await fresh(), at, { body: fill(LIMITS.UPLOAD_BODY_BYTES) })), 200, 'upload: exactly 5 MB');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/blog-submissions/upload-image', await fresh(), at, { body: fill(LIMITS.UPLOAD_BODY_BYTES + 1) })), 413, 'upload: one byte over');
  assert.equal(statusOf(await authAt(w, 'POST', '/api/blog-submissions/upload-image', await fresh(), at, { body: stream(LIMITS.UPLOAD_BODY_BYTES + 1) })), 413, 'upload: a stream one byte over');
  // An over-cap body is counted as a request and a write (final-fix item 6): one counter row, nothing else.
  const t = await fresh();
  const before = changes(w.db);
  assert.equal(statusOf(await authAt(w, 'POST', '/api/social/posts', t, at, { body: fill(LIMITS.BODY_BYTES + 1) })), 413);
  assert.ok(changes(w.db) - before <= 2, 'the counter row, and last_used_at at most');
});

// =========================================================================
// 5. Auto-revoke
// =========================================================================

test('auto-revoke: flood: 49 attempts in a minute (refused ones too) keep the token; the 50th revokes it with one audit row; then 401 and nothing written', async () => {
  const w = await limitsWorld();
  const t = await mintToken(w.db, 'ed', ['social:read'], { id: 'tok-flood' });
  const at = DAY0 + 6000;
  for (let i = 0; i < LIMITS.FLOOD_PER_MINUTE - 1; i++) await authAt(w, 'GET', '/api/social/posts', t, at + (i % 60));
  assert.equal((w.db.prepare('SELECT revoked_at FROM agent_tokens WHERE id = ?').get('tok-flood') as { revoked_at: number | null }).revoked_at, null, '49 do not revoke');
  await authAt(w, 'GET', '/api/social/posts', t, at + 59);
  assert.equal((w.db.prepare('SELECT revoke_reason FROM agent_tokens WHERE id = ?').get('tok-flood') as { revoke_reason: string }).revoke_reason, 'flood');
  assert.equal(count(w.db, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent_token.auto_revoke' AND target_id = 'tok-flood'`), 1);
  const before = changes(w.db);
  for (let i = 0; i < 10; i++) assert.equal(statusOf(await authAt(w, 'GET', '/api/social/posts', t, at + 60 + i)), 401);
  assert.equal(changes(w.db), before);
});

/** The value written in each way a store or a page would turn back into it. */
function encodings(value: string): [string, (unused: string) => string][] {
  const pct = (s: string) => [...s].map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join('');
  const dec = (s: string) => [...s].map((c) => `&#${c.charCodeAt(0)};`).join('');
  const hex = (s: string) => [...s].map((c) => `&#x${c.charCodeAt(0).toString(16)};`).join('');
  const half = Math.floor(value.length / 2);
  const caption = (v: string) => JSON.stringify(postBody({ caption: `my key ${v} ok` }));
  return [
    ['plain', () => caption(value)],
    ['JSON \\u escape of every character', () => JSON.stringify(postBody({ caption: 'K' })).replace('"K"', `"${[...value].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('')}"`)],
    ['JSON \\u escape of one character', () => JSON.stringify(postBody({ caption: 'K' })).replace('"K"', `"\\u0072${value.slice(1)}"`)],
    ['percent-encoded, whole', () => caption(pct(value))],
    ['percent-encoded, first letter', () => caption(`%72${value.slice(1)}`)],
    ['percent-encoded, upper-case hex', () => caption(pct(value).toUpperCase())],
    ['HTML decimal references', () => caption(dec(value))],
    ['HTML hex references', () => caption(hex(value))],
    ['HTML references without semicolons', () => caption([...value].map((c) => `&#${c.charCodeAt(0)}`).join(''))],
    ['HTML &lowbar; for the underscore', () => caption(value.replace(/_/g, '&lowbar;'))],
    ['split across two adjacent fields', () => JSON.stringify({ type: 'image', caption: value.slice(0, half), captionOverrides: { x: value.slice(half) }, media: [{ key: KEYS.feed, alt: 'A' }], platforms: ['instagram'] })],
    ['as an object key', () => JSON.stringify(postBody({ captionOverrides: { [value]: 'x' } }))],
    ['percent inside a JSON escape', () => JSON.stringify(postBody({ caption: 'K' })).replace('"K"', `"\\u0025\\u0037\\u0032${value.slice(1)}"`)],
  ];
}

test('auto-revoke: the token\'s value in a body, plain, JSON-escaped, percent-encoded or as HTML references, through the real handler: 400 leaked, revoked once, nothing stored', async () => {
  const w = await world();
  for (let i = 0; i < encodings('x').length; i++) {
    const id = `tok-enc-${i}`;
    const value = await mintToken(w.db, 'ed', ['social:draft'], { id });
    const [name, build] = encodings(value)[i];
    const sent = build('');
    const request = new Request(`${BASE}/api/social/posts`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...bearer(value), 'CF-Connecting-IP': '192.0.2.50' }, body: sent });
    const res = await (socialPosts.onRequestPost as (c: unknown) => Promise<Response>)({ request, env: w.env, params: {}, waitUntil() {} });
    assert.equal(res.status, 400, name);
    assert.equal(((await res.json()) as { code: string }).code, 'leaked', name);
    assert.equal((w.db.prepare('SELECT revoke_reason FROM agent_tokens WHERE id = ?').get(id) as { revoke_reason: string }).revoke_reason, 'leaked', name);
    assert.equal(count(w.db, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent_token.auto_revoke' AND target_id = ?`, id), 1, name);
  }
  assert.equal(rows(w.db, 'social_posts'), 0);
});

test('auto-revoke: the value as an upper-case HTML hex reference (&#X72;) is a leak too', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'ed', ['social:draft'], { id: 'tok-X' });
  const res = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token: value, body: postBody({ caption: `&#X72;${value.slice(1)}` }) });
  assert.equal(res.status, 400);
  assert.equal((w.db.prepare('SELECT revoked_at FROM agent_tokens WHERE id = ?').get('tok-X') as { revoked_at: number | null }).revoked_at !== null, true);
  assert.equal(rows(w.db, 'social_posts'), 0);
});

test('auto-revoke: through MCP, each encoding in a tool argument revokes the token and stores nothing', async () => {
  const w = await world();
  for (const [name, wrap] of [
    ['plain', (v: string) => v], ['percent', (v: string) => `%72${v.slice(1)}`], ['entity', (v: string) => `&#114;${v.slice(1)}`],
  ] as const) {
    const id = `tok-mcp-${name}`;
    const value = await mintToken(w.db, 'ed', ['social:draft'], { id });
    const r = await rpc(w, value, 'tools/call', { name: 'social_create_plan', arguments: { ...planBody(), note: `the key: ${wrap(value)}` } });
    assert.equal(r.status, 400, `${name}: ${JSON.stringify(r.body).slice(0, 100)}`);
    assert.equal((w.db.prepare('SELECT revoke_reason FROM agent_tokens WHERE id = ?').get(id) as { revoke_reason: string | null }).revoke_reason, 'leaked', name);
  }
  assert.equal(rows(w.db, 'social_plans'), 0);
});

test('auto-revoke: an upload holding a token value (at the start, the end, split across chunks) is 400 leaked, revoked, and nothing reaches R2, social_media or the log', async () => {
  const w = await world();
  const enc = new TextEncoder();
  for (const where of ['tail', 'head-after-marker', 'chunked']) {
    const id = `tok-up-${where}`;
    const value = await mintToken(w.db, 'ed', ['social:draft'], { id });
    let request: Request;
    const bytes = jpeg(1080, 1350, enc.encode(`exif comment: ${value}`));
    if (where === 'chunked') {
      const cut = bytes.length - value.length + 3; // inside "rsg_pat_"
      const parts = [bytes.slice(0, cut), bytes.slice(cut)];
      const body = new ReadableStream<Uint8Array>({ pull(c) { const p = parts.shift(); if (p) c.enqueue(p); else c.close(); } });
      request = new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...bearer(value) }, body, duplex: 'half' } as RequestInit);
    } else {
      request = new Request(`${BASE}/api/blog-submissions/upload-image`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...bearer(value) }, body: bytes });
    }
    const res = await (upload.onRequestPost as (c: unknown) => Promise<Response>)({ request, env: w.env, params: {}, waitUntil() {} });
    assert.equal(res.status, 400, where);
    assert.equal(((await res.json()) as { code: string }).code, 'leaked');
    assert.equal((w.db.prepare('SELECT revoke_reason FROM agent_tokens WHERE id = ?').get(id) as { revoke_reason: string }).revoke_reason, 'leaked');
  }
  assert.equal(w.bucket.store.size, 0);
  assert.equal(rows(w.db, 'social_media'), 3, 'only the three fixtures');
  assert.equal(count(w.db, `SELECT COUNT(*) AS n FROM audit_log WHERE action = 'media.upload'`), 0);
});

test('auto-revoke: an upload holding the value as UTF-16 text (as Windows XP* EXIF tags store it) is a leak too', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'ed', ['social:draft'], { id: 'tok-u16' });
  const u16 = new Uint8Array([...value].flatMap((c) => [c.charCodeAt(0), 0]));
  const res = await uploadReq(w, value, jpeg(1080, 1350, u16));
  assert.equal(res.status, 400);
  assert.equal(w.bucket.store.size, 0);
});

test('auto-revoke: another token\'s value, a near miss of this one, or the prefix alone in a JSON body is text, not a leak', async () => {
  const w = await world();
  const value = await mintToken(w.db, 'ed', ['social:draft'], { id: 'tok-near' });
  for (const caption of [newTokenValue(), value.slice(0, -1), `${value.slice(0, -1)}${value.endsWith('A') ? 'B' : 'A'}`, 'rsg_pat_', value.toLowerCase() === value ? 'x' : value.toLowerCase()]) {
    const res = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token: value, body: postBody({ caption }) });
    assert.equal(res.status, 201, caption.slice(0, 12));
  }
  assert.equal((w.db.prepare('SELECT revoked_at FROM agent_tokens WHERE id = ?').get('tok-near') as { revoked_at: number | null }).revoked_at, null);
});

// =========================================================================
// 6. Notification mail: hostile labels stay inert
// =========================================================================

const HOSTILE = [
  '[Reset your password](https://evil.example/reset)',
  'Visit https://evil.example/login now',
  'HTTPS://EVIL.EXAMPLE/LOGIN',
  'see www.evil.example',
  'evil.example/x',
  'login at evil.co.uk',
  '<https://evil.example>',
  '<a href="https://evil.example">click</a>',
  '[click][1]\n\n[1]: https://evil.example',
  '![x](https://evil.example/pixel.png)',
  'mailto:help@evil.example',
  'http://192.0.2.1/login',
  '\u{E000}2\u{E001} injected slot',
  'line one\r\nBcc: victim@example.org',
];

/** URL-ish runs a mail client could linkify: a scheme, www. or a dotted host, with no zero-width break inside. */
function links(text: string): string[] {
  return [...text.matchAll(/(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"\u200B]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi)].map((m) => m[0]);
}
/** The targets of real anchors in an HTML part. */
const hrefs = (html: string) => [...html.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);

test('notification mail: every hostile label renders inert in HTML and text: the only link is the panel\'s, no evil host survives unbroken', () => {
  const panelUrl = `${BASE}/admin`;
  for (const label of HOSTILE) {
    for (const kind of ['submitted', 'approved', 'rejected', 'plan_due'] as const) {
      const m = notificationText(kind, { label, when: WALL, panelUrl, actor: '[me](https://evil.example)', note: 'see https://evil.example' });
      const targets = hrefs(m.body.html);
      assert.ok(targets.length >= 1 && targets.every((h) => h === panelUrl), `${kind} ${JSON.stringify(label)}: ${targets}`);
      for (const part of [m.body.html, m.body.text]) {
        const hostile = links(part).filter((l) => /evil|192\.0\.2\.1/i.test(l));
        assert.deepEqual(hostile, [], `${kind} ${JSON.stringify(label)}`);
        // A label carrying a slot's own delimiters pulls in no other value: the actor appears only where the template puts it.
        const actorSlots = kind === 'submitted' ? 2 : 0;
        assert.equal(part.split('[me]').length - 1, actorSlots, `${kind} ${JSON.stringify(label)}: actor count`);
      }
      assert.doesNotMatch(m.body.html, /<img|<script|<a\s(?![^>]*href="https:\/\/rsg-turkiye\.iscbsc\.org\/admin")/i, `${kind}: no markup from a label`);
      assert.doesNotMatch(m.subject, /[\r\n]/, 'one subject line');
      assert.ok(m.subject.length < 200);
    }
  }
});

test('notification mail: a hostile label does not reach the subject as a whole URL either', () => {
  for (const label of ['Reset at https://evil.example/x', 'see www.evil.example', 'go to evil.example']) {
    const m = notificationText('submitted', { label, when: WALL, panelUrl: `${BASE}/admin`, actor: 'ed' });
    assert.deepEqual(links(m.subject).filter((l) => /evil/i.test(l)), [], m.subject);
  }
});

test('notification mail, end to end: a token\'s hostile plan title and caption, submitted for approval, reach the publishers\' mail inert', async () => {
  const w = await world();
  const token = await mintToken(w.db, 'ed', ['social:draft']);
  const plan = await json(await hit(w, socialPlans.onRequestPost, 'POST', '/api/social/plans', { token, body: planBody({ title: '[Reset your password](https://evil.example/r) www.evil.example' }) }));
  const created = await hit(w, socialPosts.onRequestPost, 'POST', '/api/social/posts', { token, body: postBody({ planId: plan.plan?.id ?? plan.id, caption: 'https://evil.example/caption' }) });
  assert.equal(created.status, 201);
  const { id } = await created.json() as { id: string };
  sentMail.splice(0);
  assert.equal((await hit(w, socialSubmit.onRequestPost, 'POST', `/api/social/posts/${id}/submit`, { token, params: { id }, body: { revision: 0 } })).status, 200);
  await settle(waits.splice(0));
  assert.ok(sentMail.length >= 1, 'the publishers were told');
  for (const raw of sentMail) {
    const parts = [...raw.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n(?:\r\n|--)/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ''), 'base64').toString('utf8'));
    assert.ok(parts.length >= 2, 'text and HTML parts');
    for (const part of parts) {
      for (const h of hrefs(part)) assert.equal(h, `${BASE}/admin`);
      assert.deepEqual(links(part).filter((l) => /evil/i.test(l)), [], part.slice(0, 300));
    }
  }
  assert.equal((w.db.prepare('SELECT status FROM social_posts WHERE id = ?').get(id) as { status: string }).status, 'pending_approval');
});
