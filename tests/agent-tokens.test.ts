import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { bearer, mintToken } from './lib/agent';
import {
  agentGroupRights, agentMaySocial, areasHeld, authenticateAgent, formatScope, hashToken, newTokenValue, parseScopes,
  type AgentAuth, type AgentPrincipal,
} from '../functions/_lib/agent-tokens';
import { AGENT_ROUTES, routeFor } from '../functions/_lib/agent-routes';
import { onRequest as middleware } from '../functions/api/_middleware';
import { grantRole, revokeRole } from '../functions/_lib/role-grants';
import { CMS_GROUPS } from '../functions/_lib/roles';

const ROOT = new URL('..', import.meta.url).pathname;
const SCHEMA = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const UUID = '0b6f4a52-3c1d-4e8f-9a2b-7c6d5e4f3a21';
const NOW = 1_800_000_000;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of ['ed', 'admin', 'soc', 'mem']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  const DB = d1(db) as never;
  return { db, DB, env: { DB } as never };
}

const req = (method: string, path: string, headers: Record<string, string> = {}) =>
  new Request(`${BASE}${path}`, { method, headers });

function agentOf(auth: AgentAuth): AgentPrincipal {
  assert.equal(auth.kind, 'agent');
  return (auth as Extract<AgentAuth, { kind: 'agent' }>).agent;
}

/** Every row of every table, to prove a request wrote nothing. */
function snapshot(db: DatabaseSync): string {
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
  return JSON.stringify(tables.map((t) => [t, db.prepare(`SELECT * FROM "${t}"`).all()]));
}

// --- values and scopes ---------------------------------------------------

test('a token value is rsg_pat_ plus 43 base64url characters, fresh each time, stored only as its hash', async () => {
  const a = newTokenValue();
  const b = newTokenValue();
  assert.match(a, /^rsg_pat_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.match(await hashToken(a), /^[0-9a-f]{64}$/);

  const { db } = setup();
  const value = await mintToken(db, 'ed', ['social:read'], { id: 't1' });
  const row = db.prepare('SELECT * FROM agent_tokens WHERE id = ?').get('t1') as Record<string, unknown>;
  assert.equal(row.token_hash, await hashToken(value));
  for (const v of Object.values(row)) assert.ok(!String(v).includes(value.slice(8)), 'the value is nowhere in the row');
});

test('parseScopes accepts known area:level strings, one per area, and nothing else', () => {
  const ok = parseScopes(['cms.etkinlikler:draft', 'social:read']);
  assert.deepEqual(ok, [{ area: 'cms.etkinlikler', level: 'draft' }, { area: 'social', level: 'read' }]);
  assert.deepEqual(ok!.map(formatScope), ['cms.etkinlikler:draft', 'social:read']);
  for (const bad of [['cms.nope:draft'], ['social:approve'], ['social:read', 'social:draft'], ['cms.yazilar:read', 'cms.yazilar:read'],
    [], 'social:read', null, [1], ['constructor:read'], ['cms.yazilar:draft '], undefined]) {
    assert.equal(parseScopes(bad), null, JSON.stringify(bad));
  }
});

// --- the route table and the middleware (Review Focus 3) -----------------

/** One sample request per route; each must be matched by its own route only. */
const SAMPLES: [string, string][] = [
  ['GET', '/api/cms/types'], ['GET', '/api/cms/entries'], ['GET', '/api/cms/entry'], ['GET', '/api/cms/drafts'],
  ['POST', '/api/cms/drafts'], ['GET', `/api/cms/drafts/${UUID}`], ['PATCH', `/api/cms/drafts/${UUID}`],
  ['DELETE', `/api/cms/drafts/${UUID}`], ['POST', `/api/cms/drafts/${UUID}/submit`], ['POST', '/api/cms/podcast/pull'],
  ['GET', '/api/social/posts'], ['POST', '/api/social/posts'], ['GET', `/api/social/posts/${UUID}`],
  ['PATCH', `/api/social/posts/${UUID}`], ['DELETE', `/api/social/posts/${UUID}`], ['POST', `/api/social/posts/${UUID}/submit`],
  ['GET', '/api/social/plans'], ['POST', '/api/social/plans'], ['PATCH', `/api/social/plans/${UUID}`],
  ['DELETE', `/api/social/plans/${UUID}`], ['POST', '/api/blog-submissions/upload-image'], ['GET', '/api/mcp'], ['POST', '/api/mcp'],
];

test('each route in the table is matched by exactly one sample, and every sample by a route', () => {
  assert.equal(AGENT_ROUTES.length, SAMPLES.length);
  const hit = SAMPLES.map(([m, p]) => routeFor(m, p));
  assert.ok(hit.every(Boolean));
  assert.equal(new Set(hit).size, AGENT_ROUTES.length);
});

const REFUSED: [string, string][] = [
  ['POST', `/api/cms/drafts/${UUID}/approve`], ['POST', `/api/cms/drafts/${UUID}/reject`], ['POST', `/api/cms/drafts/${UUID}/cancel`],
  ['POST', '/api/social/posts/x/approve'], ['POST', '/api/social/posts/x/requeue'], ['PATCH', '/api/admin/users'],
  ['POST', '/api/admin/social/dm/x/reply'], ['POST', '/api/mail/send'], ['GET', '/api/social/editors'],
  ['POST', '/api/social/event-modes'], ['POST', '/api/agent-tokens'], ['GET', '/api/me'],
  // Near misses: the shape of an allowed route with something more or different.
  ['GET', '/api/cms/drafts/'], ['GET', '/api/cms/drafts/not-a-uuid'], ['GET', `/api/cms/drafts/${UUID.toUpperCase()}`],
  ['GET', '/api/social/posts/a%2Fb'], ['GET', '/api/mcp/'], ['HEAD', '/api/cms/types'], ['PUT', '/api/cms/drafts'],
  ['GET', '/api/social/plans/x'], ['POST', '/api/social/dispatch'], ['GET', '/api/agent-tokens'],
];

/** An env whose database throws: the middleware must answer without it. */
const noDb = { DB: new Proxy({}, { get() { throw new Error('D1 touched'); } }) };

async function throughMiddleware(request: Request) {
  let called = 0;
  const res = await (middleware as unknown as (c: unknown) => Promise<Response>)({
    request, env: noDb, params: {}, waitUntil() {}, next: async () => { called++; return new Response('handler'); },
  });
  return { res, called };
}

test('a bearer request to any route outside the table is 403 human_only and the handler never runs', async () => {
  for (const [method, path] of REFUSED) {
    const { res, called } = await throughMiddleware(req(method, path, { ...bearer(newTokenValue()), Cookie: 'rsg_session=s-admin' }));
    assert.equal(called, 0, `${method} ${path}`);
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: 'This is done by a person in the panel', code: 'human_only' });
  }
  // Any Authorization header counts, not only a Bearer one.
  const basic = await throughMiddleware(req('GET', '/api/me', { Authorization: 'Basic eDp5' }));
  assert.equal(basic.called, 0);
  assert.equal(basic.res.status, 403);
});

test('without an Authorization header, or on a table route, the middleware hands over', async () => {
  for (const [method, path] of REFUSED) assert.equal((await throughMiddleware(req(method, path))).called, 1);
  for (const [method, path] of SAMPLES) assert.equal((await throughMiddleware(req(method, path, bearer('x')))).called, 1);
});

test('every route in the table is served by a file under functions/api that exports its method', () => {
  // functions/api/mcp.ts is added by the MCP task; it removes this entry then.
  const AWAITING_FILE = new Set(['/api/mcp']);
  for (const [method, path] of SAMPLES) {
    const route = routeFor(method, path)!;
    // Pages' own resolution: a literal name first, then a [param] file or directory.
    let dir = join(ROOT, 'functions');
    let file: string | null = null;
    const segments = path.slice(1).split('/');
    for (let i = 0; i < segments.length; i++) {
      const names = existsSync(dir) ? readdirSync(dir) : [];
      const params = names.filter((n) => /^\[\w+\]/.test(n));
      if (i < segments.length - 1) {
        const next = names.includes(segments[i]) ? segments[i] : params.find((n) => statSync(join(dir, n)).isDirectory());
        dir = join(dir, next ?? segments[i]);
        continue;
      }
      const candidates = [`${segments[i]}.ts`, `${segments[i]}/index.ts`, ...params.filter((n) => n.endsWith('.ts')), ...params.map((n) => `${n}/index.ts`)];
      file = candidates.map((c) => join(dir, c)).find((c) => existsSync(c)) ?? null;
    }
    if (AWAITING_FILE.has(path)) {
      assert.equal(file, null, `${path} has its file now: remove it from AWAITING_FILE`);
      continue;
    }
    assert.ok(file, `${method} ${path}: no file`);
    const handler = `onRequest${route.method[0]}${route.method.slice(1).toLowerCase()}`;
    assert.match(readFileSync(file!, 'utf8'), new RegExp(`export (const|async function|function) ${handler}\\b`), `${relative(ROOT, file!)} lacks ${handler}`);
  }
});

test('only the listed files import agent-tokens', () => {
  const ALLOWED = new Set([
    'functions/api/_middleware.ts', 'functions/_lib/cms-api.ts', 'functions/_lib/social-api.ts',
    'functions/api/blog-submissions/upload-image.ts', 'functions/api/mcp.ts', 'functions/_lib/mcp-tools.ts',
    'functions/api/agent-tokens/index.ts', 'functions/api/agent-tokens/[id].ts', 'functions/api/admin/audit/prune.ts',
  ]);
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === 'node_modules') return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|mjs|astro)$/.test(n) ? [p] : [];
  });
  const importers = ['functions', 'src', 'workers'].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /from\s+['"][^'"]*\/agent-tokens(\.ts)?['"]|import\(\s*['"][^'"]*\/agent-tokens/.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p))
    .filter((p) => p !== 'functions/_lib/agent-tokens.ts');
  assert.deepEqual(importers.filter((p) => !ALLOWED.has(p)), []);
});

// --- authenticateAgent ---------------------------------------------------

test('no Authorization header is none; a cookie alone is not the token path', async () => {
  const { env } = setup();
  assert.deepEqual(await authenticateAgent(req('GET', '/api/cms/types', { Cookie: 'rsg_session=s-ed' }), env, NOW), { kind: 'none' });
});

test('every authentication failure is the same 401', async () => {
  const { db, env } = setup();
  const revoked = await mintToken(db, 'ed', ['social:read'], { revokedAt: NOW - 10 });
  const expired = await mintToken(db, 'ed', ['social:read'], { expiresAt: NOW });
  const orphan = await mintToken(db, 'ed', ['social:read']);
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare(`UPDATE agent_tokens SET user_id = 'gone' WHERE token_hash = ?`).run(await hashToken(orphan));
  const cases: Record<string, string>[] = [
    bearer(newTokenValue()), bearer(revoked), bearer(expired), bearer(orphan), { Authorization: 'Bearer abc' },
    { Authorization: '' }, { Authorization: `bearer ${newTokenValue()}` }, { Authorization: `Bearer  ${revoked}` },
    { ...bearer(newTokenValue()), Cookie: 'rsg_session=s-ed' },
  ];
  const bodies = new Set<string>();
  for (const headers of cases) {
    const auth = await authenticateAgent(req('GET', '/api/social/posts', headers), env, NOW);
    assert.equal(auth.kind, 'refused', JSON.stringify(headers));
    const res = (auth as Extract<AgentAuth, { kind: 'refused' }>).response;
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('WWW-Authenticate'), 'Bearer');
    bodies.add(await res.text());
  }
  assert.deepEqual([...bodies], [JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' })]);
});

test('a valid token on a route outside the table is 403 human_only', async () => {
  const { db, env } = setup();
  const value = await mintToken(db, 'ed', ['social:draft']);
  const auth = await authenticateAgent(req('POST', '/api/social/posts/x/approve', bearer(value)), env, NOW);
  assert.equal(auth.kind, 'refused');
  const res = (auth as Extract<AgentAuth, { kind: 'refused' }>).response;
  assert.equal(res.status, 403);
  assert.equal(((await res.json()) as { code: string }).code, 'human_only');
});

test('a valid token gives the member, its scopes, the route and the live roles; last_used_at moves at most every 5 minutes', async () => {
  const { db, DB, env } = setup();
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: NOW + 1000, by: null }, NOW - 100);
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft'], { id: 't1' });
  const a = agentOf(await authenticateAgent(req('POST', '/api/cms/drafts', bearer(value)), env, NOW));
  assert.equal(a.tokenId, 't1');
  assert.equal(a.userId, 'ed');
  assert.deepEqual(a.scopes, [{ area: 'cms.etkinlikler', level: 'draft' }]);
  assert.equal(a.route, routeFor('POST', '/api/cms/drafts'));
  assert.deepEqual(a.liveRoles, ['content.etkinlikler.edit']);
  assert.equal(a.value, value);
  const lastUsed = () => (db.prepare(`SELECT last_used_at FROM agent_tokens WHERE id = 't1'`).get() as { last_used_at: number | null }).last_used_at;
  assert.equal(lastUsed(), NOW);
  await authenticateAgent(req('GET', '/api/cms/types', bearer(value)), env, NOW + 300);
  assert.equal(lastUsed(), NOW);
  await authenticateAgent(req('GET', '/api/cms/types', bearer(value)), env, NOW + 301);
  assert.equal(lastUsed(), NOW + 301);
});

// --- effective rights (Review Focus 2) ----------------------------------

test('an editor token edits while the grant is live and not a second after it ends, with nothing written', async () => {
  const { db, DB, env } = setup();
  const ends = NOW + 1;
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: ends, by: null }, NOW - 100);
  const value = await mintToken(db, 'ed', ['cms.etkinlikler:draft']);
  const during = agentOf(await authenticateAgent(req('GET', '/api/cms/drafts', bearer(value)), env, NOW));
  assert.equal(agentGroupRights(during, 'draft').etkinlikler.edit, true);
  assert.equal(agentGroupRights(during, 'draft').etkinlikler.approve, false);

  const before = snapshot(db);
  const after = agentOf(await authenticateAgent(req('GET', '/api/cms/drafts', bearer(value)), env, ends + 1));
  assert.equal(agentGroupRights(after, 'draft').etkinlikler.edit, false);
  assert.equal(agentGroupRights(after, 'read').etkinlikler.edit, false);
  assert.equal(snapshot(db), before, 'no table changed');
});

test('a social token stops working for social when the role is revoked', async () => {
  const { db, DB, env } = setup();
  await grantRole(DB, { userId: 'soc', role: 'social', expiresAt: NOW + 86400, by: null }, NOW - 100);
  const value = await mintToken(db, 'soc', ['social:draft']);
  const live = agentOf(await authenticateAgent(req('GET', '/api/social/posts', bearer(value)), env, NOW));
  assert.equal(agentMaySocial(live, 'draft'), true);
  assert.equal(agentMaySocial(live, 'read'), true);
  await revokeRole(DB, { userId: 'soc', role: 'social', by: 'admin' }, NOW + 1);
  const gone = agentOf(await authenticateAgent(req('GET', '/api/social/posts', bearer(value)), env, NOW + 2));
  assert.equal(agentMaySocial(gone, 'read'), false);
});

test('an admin token reaches only its scope, at its level, and never approves', async () => {
  const { db, DB, env } = setup();
  await grantRole(DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, NOW - 100);
  const value = await mintToken(db, 'admin', ['cms.yazilar:read']);
  const a = agentOf(await authenticateAgent(req('GET', '/api/cms/drafts', bearer(value)), env, NOW));
  const read = agentGroupRights(a, 'read');
  for (const g of CMS_GROUPS) {
    assert.equal(read[g].edit, g === 'yazilar', g);
    assert.equal(read[g].approve, false, g);
    assert.equal(agentGroupRights(a, 'draft')[g].edit, false, g);
  }
  assert.equal(agentMaySocial(a, 'read'), false, 'no social scope');
});

test('an admin is a live admin grant, not the is_admin column', async () => {
  const { db, env } = setup();
  db.prepare(`UPDATE users SET is_admin = 1 WHERE id = 'mem'`).run();
  const value = await mintToken(db, 'mem', ['cms.yazilar:draft', 'social:draft']);
  const a = agentOf(await authenticateAgent(req('GET', '/api/cms/drafts', bearer(value)), env, NOW));
  assert.equal(agentGroupRights(a, 'read').yazilar.edit, false);
  assert.equal(agentMaySocial(a, 'read'), false);
});

test('areasHeld lists the areas the live roles allow', () => {
  assert.deepEqual(areasHeld([]), []);
  assert.deepEqual(areasHeld(['content.ogrenme.edit', 'sender']), ['cms.ogrenme']);
  assert.deepEqual(areasHeld(['content.topluluk.approve', 'social_publisher']), ['cms.topluluk', 'social']);
  assert.deepEqual(areasHeld(['admin']), [...CMS_GROUPS.map((g) => `cms.${g}`), 'social']);
});
