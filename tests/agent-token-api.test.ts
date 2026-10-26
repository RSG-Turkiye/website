import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { bearer } from './lib/agent';
import { authenticateAgent } from '../functions/_lib/agent-tokens';
import { grantRole, revokeRole } from '../functions/_lib/role-grants';
import { onRequestGet, onRequestPost } from '../functions/api/agent-tokens/index';
import { onRequestDelete } from '../functions/api/agent-tokens/[id]';

// The panel's token endpoints: session only, the value shown once, every
// create and revoke in the log without the value.

const ROOT = new URL('..', import.meta.url).pathname;
const SCHEMA = readFileSync(join(ROOT, 'db/schema.sql'), 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86400;

async function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  for (const id of ['ed', 'ed2', 'soc', 'admin', 'boss', 'ann']) {
    db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, 1, 1)`).run(id, `g-${id}`, `${id}@example.org`);
    db.prepare(`INSERT INTO profiles (user_id, username, display_name, updated_at) VALUES (?, ?, ?, 1)`).run(id, `u-${id}`, `Name ${id}`);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  const DB = d1(db) as never;
  const t = now();
  await grantRole(DB, { userId: 'ed', role: 'content.etkinlikler.edit', expiresAt: t + 30 * DAY, by: null }, t);
  await grantRole(DB, { userId: 'ed2', role: 'content.etkinlikler.edit', expiresAt: t + 30 * DAY, by: null }, t);
  await grantRole(DB, { userId: 'soc', role: 'social', expiresAt: t + 30 * DAY, by: null }, t);
  await grantRole(DB, { userId: 'admin', role: 'admin', expiresAt: null, by: null }, t);
  await grantRole(DB, { userId: 'ann', role: 'announcer', expiresAt: null, by: null }, t);
  // An is_admin column with no live admin grant behind it: not an admin here.
  db.prepare(`UPDATE users SET is_admin = 1 WHERE id = 'boss'`).run();
  return { db, DB, env: { DB } as never };
}

const session = (who: string) => ({ Cookie: `rsg_session=s-${who}` });

async function get(env: never, who: string | null, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE}/api/agent-tokens`, { headers: { ...(who ? session(who) : {}), ...headers } });
  return onRequestGet({ request, env } as never);
}

async function post(env: never, who: string | null, body: unknown, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE}/api/agent-tokens`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(who ? session(who) : {}), ...headers }, body: JSON.stringify(body),
  });
  return onRequestPost({ request, env } as never);
}

async function del(env: never, who: string | null, id: string, headers: Record<string, string> = {}) {
  const request = new Request(`${BASE}/api/agent-tokens/${id}`, { method: 'DELETE', headers: { ...(who ? session(who) : {}), ...headers } });
  return onRequestDelete({ request, env, params: { id } } as never);
}

type TokenJson = Record<string, unknown> & { id: string; hint: string; status: string; scopes: string[] };

async function create(env: never, who: string, body: unknown = { label: 'My agent', scopes: ['cms.etkinlikler:draft'], days: 30 }) {
  const res = await post(env, who, body);
  assert.equal(res.status, 201, await res.clone().text());
  return await res.json() as { token: TokenJson; value: string };
}

const auditRows = (db: DatabaseSync, action: string) =>
  db.prepare('SELECT * FROM audit_log WHERE action = ? ORDER BY seq').all(action) as { user_id: string; target_id: string; details: string }[];

/** A token request on a route the table allows, as the agent would send it. */
const asAgent = (env: never, value: string) =>
  authenticateAgent(new Request(`${BASE}/api/cms/types`, { headers: bearer(value) }), env, now());

test('an Etkinlikler editor creates a draft token for 30 days; the value comes back once, and never again', async () => {
  const { db, env } = await setup();
  const before = now();
  const { token, value } = await create(env, 'ed');
  assert.match(value, /^rsg_pat_[A-Za-z0-9_-]{43}$/);
  assert.equal(token.hint, value.slice(-4));
  assert.deepEqual(token.scopes, ['cms.etkinlikler:draft']);
  assert.equal(token.label, 'My agent');
  assert.equal(token.status, 'live');
  assert.ok(Math.abs((token.expires_at as number) - (before + 30 * DAY)) <= 2);
  assert.deepEqual(Object.keys(token).sort(),
    ['created_at', 'expires_at', 'hint', 'id', 'kind', 'label', 'last_used_at', 'revoke_reason', 'revoked_at', 'scopes', 'status']);

  const row = db.prepare('SELECT token_hash, scopes FROM agent_tokens WHERE id = ?').get(token.id) as { token_hash: string; scopes: string };
  assert.deepEqual(JSON.parse(row.scopes), ['cms.etkinlikler:draft'], 'stored as authenticateAgent reads it');

  // The token works.
  assert.equal((await asAgent(env, value)).kind, 'agent');

  const list = await get(env, 'ed');
  assert.equal(list.status, 200);
  const text = await list.text();
  assert.ok(!text.includes(value), 'GET never carries the value');
  assert.ok(!text.includes(value.slice(8, -4)), 'nor any long part of it');
  assert.ok(!text.includes(row.token_hash), 'GET never carries the hash');
  assert.ok(!/token_hash|"value"/.test(text));
  const body = JSON.parse(text) as { mine: TokenJson[]; areas: string[]; all?: unknown };
  assert.deepEqual(body.mine.map((t) => t.id), [token.id]);
  assert.deepEqual(body.areas, ['cms.etkinlikler']);
  assert.equal(body.all, undefined, 'not an admin');

  const audit = auditRows(db, 'agent_token.create');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, 'ed');
  assert.equal(audit[0].target_id, token.id);
  const details = JSON.parse(audit[0].details) as Record<string, unknown>;
  assert.deepEqual(details, { scopes: ['cms.etkinlikler:draft'], expires_at: token.expires_at });
  for (const r of db.prepare('SELECT * FROM audit_log').all()) {
    const s = JSON.stringify(r);
    assert.ok(!s.includes(value) && !s.includes(row.token_hash), 'no log row carries the value or the hash');
  }
});

test('days 7 and 90 are offered; a missing days is 30', async () => {
  const { env } = await setup();
  const t = now();
  for (const [days, want] of [[7, 7], [90, 90], [undefined, 30]] as const) {
    const { token } = await create(env, 'ed', { label: `d${days}`, scopes: ['cms.etkinlikler:read'], days });
    assert.ok(Math.abs((token.expires_at as number) - (t + want * DAY)) <= 2, String(days));
  }
});

test('Review Focus 2: a scope outside the areas one holds now is 403 scope_not_held', async () => {
  const { db, DB, env } = await setup();
  for (const scopes of [['cms.yazilar:draft'], ['social:read'], ['cms.etkinlikler:draft', 'social:read']]) {
    const res = await post(env, 'ed', { label: 'x', scopes, days: 30 });
    assert.equal(res.status, 403, JSON.stringify(scopes));
    assert.equal((await res.json() as { code: string }).code, 'scope_not_held');
  }
  // A role that has ended: nothing to scope a new token to.
  await revokeRole(DB, { userId: 'soc', role: 'social', by: 'admin' }, now());
  const res = await post(env, 'soc', { label: 'x', scopes: ['social:read'], days: 30 });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as { code: string }).code, 'scope_not_held');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tokens').get()!.n, 0);
  assert.equal(auditRows(db, 'agent_token.create').length, 0);
});

test('a social editor may scope a token to social; an announcer holds no area', async () => {
  const { env } = await setup();
  const { token } = await create(env, 'soc', { label: 'Social agent', scopes: ['social:draft'], days: 7 });
  assert.deepEqual(token.scopes, ['social:draft']);
  const ann = await (await get(env, 'ann')).json() as { areas: string[] };
  assert.deepEqual(ann.areas, []);
  assert.equal((await post(env, 'ann', { label: 'x', scopes: ['social:read'], days: 30 })).status, 403);
});

test('bad bodies are 422 and write nothing', async () => {
  const { db, env } = await setup();
  const bad: unknown[] = [
    { label: 'x', scopes: ['cms.etkinlikler:draft'], days: 365 },
    { label: 'x', scopes: ['cms.etkinlikler:draft'], days: '30' },
    { label: 'x', scopes: ['cms.etkinlikler:draft'], days: 0 },
    { label: '', scopes: ['cms.etkinlikler:draft'], days: 30 },
    { label: '   ', scopes: ['cms.etkinlikler:draft'], days: 30 },
    { label: 'a'.repeat(61), scopes: ['cms.etkinlikler:draft'], days: 30 },
    { label: 42, scopes: ['cms.etkinlikler:draft'], days: 30 },
    { label: 'x', scopes: [], days: 30 },
    { label: 'x', scopes: ['cms.etkinlikler:approve'], days: 30 },
    { label: 'x', scopes: ['cms.etkinlikler:read', 'cms.etkinlikler:draft'], days: 30 },
    { label: 'x', days: 30 },
  ];
  for (const body of bad) {
    const res = await post(env, 'ed', body);
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal((await res.json() as { code: string }).code, 'invalid');
  }
  // 60 characters is the most; the label is trimmed.
  const { token } = await create(env, 'ed', { label: `  ${'a'.repeat(60)}  `, scopes: ['cms.etkinlikler:read'], days: 30 });
  assert.equal(token.label, 'a'.repeat(60));
  // Not JSON, or bigger than 4 KB.
  const notJson = await onRequestPost({ request: new Request(`${BASE}/api/agent-tokens`, { method: 'POST', headers: session('ed'), body: 'nope' }), env } as never);
  assert.equal(notJson.status, 400);
  const big = await post(env, 'ed', { label: 'x', scopes: ['cms.etkinlikler:read'], days: 30, pad: 'p'.repeat(5000) });
  assert.equal(big.status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tokens').get()!.n, 1);
});

test('five live tokens at most: the sixth is 409; revoked and expired ones do not count', async () => {
  const { db, env } = await setup();
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) ids.push((await create(env, 'ed', { label: `t${i}`, scopes: ['cms.etkinlikler:read'], days: 7 })).token.id);
  const sixth = await post(env, 'ed', { label: 't5', scopes: ['cms.etkinlikler:read'], days: 7 });
  assert.equal(sixth.status, 409);
  assert.equal((await sixth.json() as { code: string }).code, 'too_many_tokens');
  assert.equal(auditRows(db, 'agent_token.create').length, 5);

  assert.equal((await del(env, 'ed', ids[0])).status, 200);
  await create(env, 'ed', { label: 'after revoke', scopes: ['cms.etkinlikler:read'], days: 7 });
  db.prepare('UPDATE agent_tokens SET expires_at = ? WHERE id = ?').run(now() - 1, ids[1]);
  await create(env, 'ed', { label: 'after expiry', scopes: ['cms.etkinlikler:read'], days: 7 });
  assert.equal((await post(env, 'ed', { label: 'one more', scopes: ['cms.etkinlikler:read'], days: 7 })).status, 409);

  // Another member's count is their own.
  await create(env, 'ed2');

  const mine = (await (await get(env, 'ed')).json() as { mine: TokenJson[] }).mine;
  const status = Object.fromEntries(mine.map((t) => [t.id, t.status]));
  assert.equal(status[ids[0]], 'revoked');
  assert.equal(status[ids[1]], 'expired');
  assert.equal(mine.filter((t) => t.status === 'live').length, 5);
});

test('the owner revokes: the token is refused from then on, and the log says so', async () => {
  const { db, env } = await setup();
  const { token, value } = await create(env, 'ed');
  const res = await del(env, 'ed', token.id);
  assert.equal(res.status, 200);
  const body = await res.json() as { token: TokenJson };
  assert.equal(body.token.status, 'revoked');
  assert.equal(body.token.revoke_reason, 'member');

  const row = db.prepare('SELECT revoked_at, revoked_by, revoke_reason FROM agent_tokens WHERE id = ?').get(token.id) as Record<string, unknown>;
  assert.equal(row.revoked_by, 'ed');
  assert.equal(row.revoke_reason, 'member');
  assert.ok(typeof row.revoked_at === 'number');

  const auth = await asAgent(env, value);
  assert.equal(auth.kind, 'refused');
  assert.equal((auth as { response: Response }).response.status, 401);

  const audit = auditRows(db, 'agent_token.revoke');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, 'ed');
  assert.equal(audit[0].target_id, token.id);
  assert.deepEqual(JSON.parse(audit[0].details), { reason: 'member' });

  // Twice is 409, and logs nothing more.
  const again = await del(env, 'ed', token.id);
  assert.equal(again.status, 409);
  assert.equal((await again.json() as { code: string }).code, 'already_revoked');
  assert.equal(auditRows(db, 'agent_token.revoke').length, 1);
});

test('another member may not revoke it; an admin may, and the reason says admin', async () => {
  const { db, env } = await setup();
  const { token, value } = await create(env, 'ed');
  for (const who of ['ed2', 'soc', 'boss']) {
    const res = await del(env, who, token.id);
    assert.equal(res.status, 403, who);
  }
  assert.equal((await asAgent(env, value)).kind, 'agent', 'still live');
  assert.equal(auditRows(db, 'agent_token.revoke').length, 0);

  const res = await del(env, 'admin', token.id);
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { token: TokenJson }).token.revoke_reason, 'admin');
  const row = db.prepare('SELECT revoked_by, revoke_reason FROM agent_tokens WHERE id = ?').get(token.id) as Record<string, unknown>;
  assert.deepEqual({ ...row }, { revoked_by: 'admin', revoke_reason: 'admin' });
  assert.deepEqual(JSON.parse(auditRows(db, 'agent_token.revoke')[0].details), { reason: 'admin' });
  assert.equal((await asAgent(env, value)).kind, 'refused');

  assert.equal((await del(env, 'admin', 'no-such-token')).status, 404);
});

test('a member whose role has ended still lists and revokes their own token', async () => {
  const { DB, env } = await setup();
  const { token } = await create(env, 'soc', { label: 's', scopes: ['social:read'], days: 30 });
  await revokeRole(DB, { userId: 'soc', role: 'social', by: 'admin' }, now());
  const list = await (await get(env, 'soc')).json() as { mine: TokenJson[]; areas: string[] };
  assert.deepEqual(list.mine.map((t) => t.id), [token.id]);
  assert.deepEqual(list.areas, []);
  assert.equal((await del(env, 'soc', token.id)).status, 200);
});

test('the all list is for a live admin grant only, and names people without their e-mail', async () => {
  const { DB, env } = await setup();
  await create(env, 'ed');
  await create(env, 'soc', { label: 's', scopes: ['social:read'], days: 30 });

  for (const who of ['ed', 'soc', 'boss']) {
    const body = await (await get(env, who)).json() as Record<string, unknown>;
    assert.equal(body.all, undefined, who);
  }
  const res = await get(env, 'admin');
  const text = await res.text();
  assert.ok(!text.includes('@example.org'), 'no e-mail anywhere');
  const body = JSON.parse(text) as { all: TokenJson[]; areas: string[] };
  assert.equal(body.all.length, 2);
  assert.deepEqual(body.all.map((t) => [t.user_id, t.display_name]).sort(), [['ed', 'Name ed'], ['soc', 'Name soc']]);
  assert.ok(!text.includes('token_hash'));
  assert.ok(body.areas.includes('social') && body.areas.includes('cms.etkinlikler'), 'an admin holds every area');

  // The admin grant ends: so does the view of everyone's.
  await revokeRole(DB, { userId: 'admin', role: 'admin', by: 'boss' }, now());
  assert.equal((await (await get(env, 'admin')).json() as Record<string, unknown>).all, undefined);
});

test('session only: no session is 401, a bearer header is not a session, and a foreign origin is refused', async () => {
  const { db, env } = await setup();
  const { token, value } = await create(env, 'ed');

  for (const res of [
    await get(env, null),
    await get(env, null, bearer(value)),
    await post(env, null, { label: 'x', scopes: ['cms.etkinlikler:read'], days: 30 }, bearer(value)),
    await del(env, null, token.id, bearer(value)),
  ]) assert.equal(res.status, 401);

  const evil = { Origin: 'https://evil.example.org' };
  assert.equal((await post(env, 'ed', { label: 'x', scopes: ['cms.etkinlikler:read'], days: 30 }, evil)).status, 403);
  assert.equal((await del(env, 'ed', token.id, evil)).status, 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM agent_tokens').get()!.n, 1);
  assert.equal(db.prepare('SELECT revoked_at FROM agent_tokens').get()!.revoked_at, null);
});

test('a revoke that loses a race answers 409 and writes no log row (changes() = 1 proof)', async () => {
  const { db, DB, env } = await setup();
  const { token } = await create(env, 'ed');
  // Someone else revokes it between this request's read and its write.
  const racing = {
    ...(DB as object),
    prepare: (sql: string) => {
      const stmt = (DB as { prepare(s: string): { bind(...a: unknown[]): { first(): Promise<unknown> } } }).prepare(sql);
      if (!/^SELECT .* FROM agent_tokens WHERE id = \?$/.test(sql)) return stmt;
      return { ...stmt, bind: (...a: unknown[]) => {
        const bound = stmt.bind(...a);
        return { ...bound, first: async () => {
          const row = await bound.first();
          db.prepare(`UPDATE agent_tokens SET revoked_at = 1, revoked_by = 'admin', revoke_reason = 'admin' WHERE id = ?`).run(token.id);
          return row;
        } };
      } };
    },
  };
  const res = await del({ DB: racing } as never, 'ed', token.id);
  assert.equal(res.status, 409);
  assert.equal(auditRows(db, 'agent_token.revoke').length, 0, 'no row for a revoke that did not happen');
  assert.equal((db.prepare('SELECT revoked_by FROM agent_tokens WHERE id = ?').get(token.id) as { revoked_by: string }).revoked_by, 'admin');
});

test('two revokes at once: one 200, one 409, one log row', async () => {
  const { db, env } = await setup();
  const { token } = await create(env, 'ed');
  const statuses = (await Promise.all([del(env, 'ed', token.id), del(env, 'ed', token.id)])).map((r) => r.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  assert.equal(auditRows(db, 'agent_token.revoke').length, 1);
});
