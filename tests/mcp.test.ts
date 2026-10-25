// The MCP endpoint (plan 5, Task 7): a stateless JSON-RPC wrapper around the
// same REST handlers, called in-process. What a tool may do is what the REST
// route lets the token do; tools/list shows only what the token may do now;
// one MCP POST is one request against the token's limits.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { setupSocial, settle, KEYS, BASE } from './lib/social';
import { mintToken, bearer } from './lib/agent';
import { grantRole } from '../functions/_lib/role-grants';
import { authenticateAgent, markInternal } from '../functions/_lib/agent-tokens';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { AGENT_INSTRUCTIONS } from '../functions/_lib/agent-instructions';
import { MCP_TOOLS } from '../functions/_lib/mcp-tools';
import * as mcp from '../functions/api/mcp';

const NOW = Math.floor(Date.now() / 1000);

// GitHub holding only FILES (every other name is free); Google answering
// the publisher notice a social submit sends. Anything else fails the test.
const EVENT_ID = 'fixture-meetup-2026';
const FILES: Record<string, string> = {
  [`src/content/events/${EVENT_ID}.json`]: `${JSON.stringify({ id: EVENT_ID, type: 'meetup', start: '2026-03-06', title: { en: 'Fixture meetup', tr: 'Örnek buluşma' }, when: { en: '6 March 2026', tr: '6 Mart 2026' }, location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'A meetup.', tr: 'Bir buluşma.' } }, null, 2)}\n`,
};
const INDEX = buildCmsIndex(FILES);
const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  if (url.hostname.endsWith('googleapis.com')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600, id: 'm', threadId: 't' }));
  if (method === 'GET' && url.pathname.includes('/contents/')) {
    const content = FILES[decodeURIComponent(url.pathname.split('/contents/')[1])];
    if (content === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    return new Response(JSON.stringify({ sha: blobSha(content), content: Buffer.from(content).toString('base64'), encoding: 'base64' }));
  }
  throw new Error(`unexpected fetch in tests: ${method} ${url}`);
}) as never;

const waits: Promise<unknown>[] = [];
afterEach(async () => { await settle(waits.splice(0)); });

/** setupSocial (users admin, pub, ed, ed2, mem) with live grants for social and the Etkinlikler group, and the CMS index. */
async function setup() {
  const s = setupSocial();
  const DB = (s.env as { DB: D1Database }).DB;
  await grantRole(DB, { userId: 'pub', role: 'social_publisher', expiresAt: null, by: null }, NOW - 100);
  await grantRole(DB, { userId: 'ed', role: 'social', expiresAt: null, by: null }, NOW - 100);
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: null, by: null }, NOW - 100);
  const assets = { fetch: async (r: Request) => new URL(r.url).pathname === '/cms-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 }) };
  const env = { ...(s.env as object), GITHUB_PAT: 'unused', ASSETS: assets } as never;
  return { db: s.db, env };
}

type Opts = { token?: string; headers?: Record<string, string>; raw?: string };
async function post(env: unknown, message: unknown, o: Opts = {}): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(o.token ? bearer(o.token) : {}), ...(o.headers ?? {}) };
  const request = new Request(`${BASE}/api/mcp`, { method: 'POST', headers, body: o.raw ?? JSON.stringify(message) });
  return (mcp.onRequestPost as (c: unknown) => Promise<Response>)({ request, env, params: {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); }, data: {} });
}
let nextId = 1;
async function rpc(env: unknown, token: string, method: string, params?: unknown, headers?: Record<string, string>) {
  const res = await post(env, { jsonrpc: '2.0', id: nextId++, method, ...(params === undefined ? {} : { params }) }, { token, headers });
  return { status: res.status, body: await res.json() as any };
}
async function callTool(env: unknown, token: string, name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc(env, token, 'tools/call', { name, arguments: args });
  return body;
}
/** The answer of a successful tool call, parsed. */
async function toolResult(env: unknown, token: string, name: string, args: Record<string, unknown> = {}) {
  const body = await callTool(env, token, name, args);
  assert.ok(body.result, `${name}: ${JSON.stringify(body)}`);
  assert.equal(body.result.isError, undefined, `${name}: ${JSON.stringify(body.result)}`);
  return JSON.parse(body.result.content[0].text);
}
const toolNames = async (env: unknown, token: string) =>
  ((await rpc(env, token, 'tools/list')).body.result.tools as { name: string }[]).map((t) => t.name).sort();

const bucketSum = (db: DatabaseSync, tokenId: string, kind: string) =>
  (db.prepare('SELECT COALESCE(SUM(n), 0) AS n FROM agent_rate WHERE bucket LIKE ?').get(`t:${tokenId}:${kind}:%`) as { n: number }).n;

const newEvent = () => ({
  id: 'meetup-ankara-2027', type: 'meetup', start: '2027-03-06',
  title: { en: 'Ankara meetup', tr: 'Ankara buluşması' }, when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'An evening meetup.', tr: 'Bir akşam buluşması.' },
});
const draftPost = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram', 'linkedin'], scheduledAt: NOW + 3600 };

// --- protocol -------------------------------------------------------------

test('initialize echoes a supported version, answers 2025-06-18 to any other, and sends the instructions', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:read']);
  for (const [asked, answered] of [['2025-06-18', '2025-06-18'], ['2025-03-26', '2025-03-26'], ['2099-01-01', '2025-06-18']]) {
    const { status, body } = await rpc(env, token, 'initialize', { protocolVersion: asked, capabilities: {}, clientInfo: { name: 't', version: '1' } });
    assert.equal(status, 200);
    assert.equal(body.jsonrpc, '2.0');
    assert.equal(body.result.protocolVersion, answered);
    assert.deepEqual(body.result.capabilities, { tools: { listChanged: false } });
    assert.deepEqual(body.result.serverInfo, { name: 'rsg-turkiye', version: '1' });
    assert.equal(body.result.instructions, AGENT_INSTRUCTIONS);
  }
});

test('the instructions: short, no em dash or spaced double hyphen, and the rules that matter', () => {
  assert.ok(AGENT_INSTRUCTIONS.length <= 2500, `${AGENT_INSTRUCTIONS.length} characters`);
  assert.ok(!AGENT_INSTRUCTIONS.includes('—'));
  assert.ok(!AGENT_INSTRUCTIONS.includes(' -- '));
  for (const phrase of ['never invent', 'cms_list_types', 'cms_get_entry', 'base_shas', 'write_nonce', 'revision', 'person', 'data', '429', 'Turkish and English', 'even when']) {
    assert.ok(AGENT_INSTRUCTIONS.toLowerCase().includes(phrase.toLowerCase()), phrase);
  }
});

test('transport: notification 202 with no body, GET 405, foreign Origin 403, bad version header 400, batch -32600, bad JSON -32700, unknown method -32601, ping', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:read']);

  const note = await post(env, { jsonrpc: '2.0', method: 'notifications/initialized' }, { token });
  assert.equal(note.status, 202);
  assert.equal(await note.text(), '');
  assert.equal(note.headers.get('Mcp-Session-Id'), null);

  const get = await (mcp.onRequestGet as (c: unknown) => Promise<Response>)({ request: new Request(`${BASE}/api/mcp`, { headers: bearer(token) }), env, params: {}, waitUntil: () => {}, data: {} });
  assert.equal(get.status, 405);

  const evil = await post(env, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token, headers: { Origin: 'https://evil.example' } });
  assert.equal(evil.status, 403);
  const ours = await post(env, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token, headers: { Origin: 'https://rsg-turkiye.iscbsc.org' } });
  assert.equal(ours.status, 200);

  assert.equal((await rpc(env, token, 'tools/list', undefined, { 'MCP-Protocol-Version': '1999-01-01' })).status, 400);
  assert.equal((await rpc(env, token, 'tools/list', undefined, { 'MCP-Protocol-Version': '2025-06-18' })).status, 200);

  const batch = await post(env, [{ jsonrpc: '2.0', id: 1, method: 'ping' }], { token });
  assert.equal((await batch.json() as any).error.code, -32600);
  const notObject = await post(env, 'ping', { token });
  assert.equal((await notObject.json() as any).error.code, -32600);
  const bad = await post(env, null, { token, raw: '{"jsonrpc": "2.0", "id": 1,' });
  assert.equal((await bad.json() as any).error.code, -32700);

  const unknown = await rpc(env, token, 'resources/list');
  assert.equal(unknown.body.error.code, -32601);
  assert.equal(unknown.body.id, nextId - 1);
  assert.deepEqual((await rpc(env, token, 'ping')).body.result, {});
});

test('without a token or with a bad one: 401 from the token check', async () => {
  const { env } = await setup();
  const none = await post(env, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(none.status, 401);
  const bad = await post(env, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { token: `rsg_pat_${'A'.repeat(43)}` });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { error: 'Unauthorized', code: 'unauthorized' });
});

// --- tools/list -------------------------------------------------------------

test('tools/list: a cms read token sees only the cms list and get tools', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:read']);
  const names = await toolNames(env, token);
  assert.ok(names.length > 0);
  for (const n of names) assert.match(n, /^cms_(list|get)_/);
  assert.deepEqual(names, ['cms_get_draft', 'cms_get_entry', 'cms_list_entries', 'cms_list_my_drafts', 'cms_list_types']);
  const { body } = await rpc(env, token, 'tools/list');
  for (const t of body.result.tools) {
    assert.equal(typeof t.description, 'string');
    assert.equal(t.inputSchema.type, 'object');
  }
});

test('tools/list: a social draft token sees the social tools and no cms tool; when the grant ends, none', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft']);
  const names = await toolNames(env, token);
  assert.deepEqual(names, MCP_TOOLS.map((t) => t.name).filter((n) => n.startsWith('social_')).sort());
  assert.ok(names.includes('social_create_plan') && names.includes('social_submit_post'));

  db.prepare(`UPDATE role_grants SET expires_at = ? WHERE user_id = 'ed' AND role = 'social'`).run(NOW - 1);
  assert.deepEqual(await toolNames(env, token), []);
});

test('tools/list: the podcast pull is listed only where the member edits its group', async () => {
  const { db, env } = await setup();
  const ed = await mintToken(db, 'ed', ['cms.etkinlikler:draft', 'cms.topluluk:draft']);
  const names = await toolNames(env, ed);
  assert.ok(names.includes('cms_create_draft'));
  assert.ok(!names.includes('cms_pull_podcast'), 'ed holds no Topluluk grant');
  const admin = await mintToken(db, 'admin', ['cms.topluluk:draft']);
  await grantRole((env as { DB: D1Database }).DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, NOW - 100);
  assert.ok((await toolNames(env, admin)).includes('cms_pull_podcast'));
});

test('no tool approves, rejects, publishes, schedules, cancels, requeues, sends or grants; calling one is -32602', async () => {
  for (const t of MCP_TOOLS) assert.doesNotMatch(t.name, /approve|reject|publish|schedule|cancel|requeue|send|grant|upload/, t.name);
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft', 'social:draft']);
  for (const name of ['cms_approve_draft', 'social_approve_post', 'nope']) {
    const body = await callTool(env, token, name);
    assert.equal(body.error.code, -32602, name);
  }
  // Listed for someone else, not for this token: also -32602, and nothing runs.
  const reader = await mintToken(db, 'ed', ['cms.etkinlikler:read']);
  const body = await callTool(env, reader, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(body.error.code, -32602);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_drafts').get() as { n: number }).n, 0);
});

test('tools/call with arguments that do not fit the tool is -32602', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  assert.equal((await callTool(env, token, 'cms_get_draft', {})).error.code, -32602);
  assert.equal((await callTool(env, token, 'cms_get_draft', { id: 42 })).error.code, -32602);
  assert.equal((await callTool(env, token, 'cms_get_draft', { id: '../../admin/users' })).error.code, -32602);
  const { body } = await rpc(env, token, 'tools/call', { name: 'cms_list_types', arguments: [] });
  assert.equal(body.error.code, -32602);
});

// --- tools/call -------------------------------------------------------------

test('cms_create_draft then cms_submit_draft: a submitted draft by an agent, audited as the agent', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 'tok-ed' });
  const types = await toolResult(env, token, 'cms_list_types');
  assert.deepEqual(types.types.map((t: { key: string }) => t.key).sort(), ['events', 'webinars', 'workshops']);

  const made = await toolResult(env, token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(made.draft.by_agent, true);
  const id = made.draft.id as string;
  const read = await toolResult(env, token, 'cms_get_draft', { id });
  const saved = await toolResult(env, token, 'cms_save_draft', { id, data: { ...newEvent(), location: { en: 'Izmir', tr: 'İzmir' } }, write_nonce: read.draft.write_nonce });
  assert.equal(saved.draft.status, 'draft');
  const sent = await toolResult(env, token, 'cms_submit_draft', { id });
  assert.equal(sent.draft.status, 'submitted');

  const row = db.prepare('SELECT status, author_id, agent_token_id FROM content_drafts WHERE id = ?').get(id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'submitted', author_id: 'ed', agent_token_id: 'tok-ed' });
  const audit = db.prepare(`SELECT user_id, action, details FROM audit_log WHERE action LIKE 'cms.draft.%' ORDER BY seq`).all() as { user_id: string; action: string; details: string }[];
  assert.deepEqual(audit.map((a) => a.action), ['cms.draft.create', 'cms.draft.update', 'cms.draft.submit']);
  for (const a of audit) {
    assert.equal(a.user_id, 'ed');
    assert.equal(JSON.parse(a.details).via, 'agent');
    assert.equal(JSON.parse(a.details).agent_token, 'tok-ed');
  }
});

test('a save without write_nonce is refused as the API refuses it', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  const made = await toolResult(env, token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  // The schema marks it required, so the call is refused before the API.
  const body = await callTool(env, token, 'cms_save_draft', { id: made.draft.id, data: newEvent() });
  assert.equal(body.error.code, -32602);
});

test('one MCP POST is one request against the token limits; a write or submit spends its quota exactly once', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 'tok-q' });
  await rpc(env, token, 'tools/list');
  assert.equal(bucketSum(db, 'tok-q', 'm'), 1);
  const made = await toolResult(env, token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(bucketSum(db, 'tok-q', 'm'), 2);
  assert.equal(bucketSum(db, 'tok-q', 'w'), 1);
  assert.equal(bucketSum(db, 'tok-q', 's'), 0);
  await toolResult(env, token, 'cms_submit_draft', { id: made.draft.id });
  assert.equal(bucketSum(db, 'tok-q', 'm'), 3);
  assert.equal(bucketSum(db, 'tok-q', 'd'), 3);
  assert.equal(bucketSum(db, 'tok-q', 'w'), 1);
  assert.equal(bucketSum(db, 'tok-q', 's'), 1);
  // A read tool spends no write quota.
  await toolResult(env, token, 'cms_get_draft', { id: made.draft.id });
  assert.equal(bucketSum(db, 'tok-q', 'm'), 4);
  assert.equal(bucketSum(db, 'tok-q', 'w'), 1);
  // A refused write still spends it, as over REST.
  const refused = await callTool(env, token, 'cms_create_draft', { type: 'events', action: 'update', entry_id: EVENT_ID, data: newEvent() });
  assert.equal(refused.result.isError, true);
  assert.equal(JSON.parse(refused.result.content[0].text).code, 'base_shas_required');
  assert.equal(bucketSum(db, 'tok-q', 'w'), 2);
});

test('the write quota holds through MCP: past it, the tool answers 429 rate_limited and nothing is written', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 'tok-full' });
  db.prepare('INSERT INTO agent_rate (bucket, n, expires_at) VALUES (?, 200, ?)').run(`t:tok-full:w:${Math.floor(NOW / 86400)}`, NOW + 86400);
  const body = await callTool(env, token, 'cms_create_draft', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(body.result.isError, true);
  assert.equal(JSON.parse(body.result.content[0].text).code, 'rate_limited');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_drafts').get() as { n: number }).n, 0);
});

test('social_submit_post from a publisher\'s token leaves the post pending_approval', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'pub', ['social:draft'], { id: 'tok-pub' });
  const made = await toolResult(env, token, 'social_create_post', draftPost);
  const sent = await toolResult(env, token, 'social_submit_post', { id: made.id, revision: made.revision });
  assert.equal(sent.status, 'pending_approval');
  const row = db.prepare('SELECT status, approved_by, agent_token_id FROM social_posts WHERE id = ?').get(made.id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { status: 'pending_approval', approved_by: null, agent_token_id: 'tok-pub' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 0);
  const mine = await toolResult(env, token, 'social_get_post', { id: made.id });
  assert.equal(mine.status, 'pending_approval');
});

test('social plans: create, save and delete one\'s own empty plan through MCP', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['social:draft']);
  const plan = { title: 'Konuşmacı tanıtımı', scheduledAt: NOW + 86400, platforms: ['instagram'], postType: 'image' };
  const made = await toolResult(env, token, 'social_create_plan', plan);
  await toolResult(env, token, 'social_save_plan', { id: made.id, title: 'Konuşmacı 2 tanıtımı' });
  const listed = await toolResult(env, token, 'social_list_plans', { from: NOW, to: NOW + 2 * 86400 });
  assert.deepEqual(listed.plans.map((p: { title: string }) => p.title), ['Konuşmacı 2 tanıtımı']);
  await toolResult(env, token, 'social_delete_plan', { id: made.id });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_plans').get() as { n: number }).n, 0);
});

test('an inner 403 comes back as isError with the API\'s { error, code } and nothing else', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:read']);
  // Listed (the token reads Etkinlikler), but blog is in Yazılar.
  const body = await callTool(env, token, 'cms_list_entries', { type: 'blog' });
  assert.deepEqual(body.result, { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'Forbidden', code: 'forbidden' }) }] });
  // A success has the API's answer as its text.
  const ok = await callTool(env, token, 'cms_list_entries', { type: 'events' });
  assert.equal(ok.result.isError, undefined);
  assert.deepEqual(JSON.parse(ok.result.content[0].text), { type: 'events', entries: INDEX.events });
});

test('a marked inner request: the inner route, no token lookup, and human_only off the table', async () => {
  const { db, env } = await setup();
  const token = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 'tok-in' });
  const outer = await authenticateAgent(new Request(`${BASE}/api/mcp`, { method: 'POST', headers: bearer(token) }), env, NOW);
  assert.equal(outer.kind, 'agent');
  if (outer.kind !== 'agent') return;
  // Revoked after the outer check: the inner request is not looked up again.
  db.prepare('UPDATE agent_tokens SET revoked_at = ? WHERE id = ?').run(NOW, 'tok-in');
  const inner = new Request(`${BASE}/api/cms/drafts`, { method: 'POST' });
  markInternal(inner, { user: outer.user, agent: outer.agent });
  const got = await authenticateAgent(inner, env, NOW);
  assert.equal(got.kind, 'agent');
  if (got.kind === 'agent') assert.deepEqual([got.agent.route.method, got.agent.route.quota], ['POST', 'write']);
  for (const [method, path] of [['GET', '/api/admin/users'], ['POST', '/api/cms/drafts/00000000-0000-4000-8000-000000000000/approve']]) {
    const off = new Request(`${BASE}${path}`, { method });
    markInternal(off, { user: outer.user, agent: outer.agent });
    const refused = await authenticateAgent(off, env, NOW);
    assert.equal(refused.kind, 'refused');
    if (refused.kind === 'refused') assert.equal((await refused.response.json() as { code: string }).code, 'human_only');
  }
  // An unmarked request with the same token is looked up, and refused now.
  assert.equal((await authenticateAgent(new Request(`${BASE}/api/cms/drafts`, { headers: bearer(token) }), env, NOW)).kind, 'refused');
});
