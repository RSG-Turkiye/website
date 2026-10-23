import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { call } from './lib/social';
import { resolveExpiry, roleDef } from '../functions/_lib/roles';
import * as users from '../functions/api/admin/users';
import * as senders from '../functions/api/admin/senders';
import { expireGrants } from '../functions/_lib/role-grants';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = { Origin: 'https://rsg-turkiye.iscbsc.org' };
const nowS = () => Math.floor(Date.now() / 1000);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const bindLog: { sql: string; count: number }[] = [];
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1)');
  add.run('admin', 'g-admin', 'admin@example.org', 1);
  add.run('u2', 'g-u2', 'two@example.org', 0);
  add.run('u3', 'g-u3', 'three@example.org', 0);
  // The acting admin holds a real grant, as after the 8i backfill.
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('g0', 'admin', 'admin', NULL, NULL, 1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-admin', 'admin', 4000000000, 1)`).run();
  const env = { DB: d1(db, (sql, count) => bindLog.push({ sql, count })) } as never;
  return { db, env, bindLog };
}

const patch = (env: unknown, body: unknown) =>
  call(users.onRequestPatch, 'PATCH', '/api/admin/users', { env, as: 'admin', body, headers: ORIGIN });

type Grant = { role: string; expires_at: number | null; revoked_at: number | null };
const liveGrants = (db: DatabaseSync, userId: string) =>
  db.prepare(`SELECT role, expires_at, revoked_at FROM role_grants WHERE user_id = ? AND revoked_at IS NULL ORDER BY role`)
    .all(userId) as unknown as Grant[];
const col = (db: DatabaseSync, userId: string, column: string) =>
  (db.prepare(`SELECT ${column} AS v FROM users WHERE id = ?`).get(userId) as { v: number }).v;

/** The end resolveExpiry gives for `months` at some second inside [before, after]. */
function endsWithin(actual: number | null, months: 1, before: number, after: number) {
  const def = roleDef('writer')!;
  const granter = { isAdmin: true, activeRoles: ['admin'] };
  const lo = resolveExpiry(def, { months }, before, granter);
  const hi = resolveExpiry(def, { months }, after, granter);
  assert.ok(lo.ok && hi.ok);
  assert.ok(actual !== null && actual >= lo.expiresAt! && actual <= hi.expiresAt!, `ends ${actual}, expected ${lo.expiresAt}..${hi.expiresAt}`);
}

test('make_writer with no duration gives a grant ending in one month', async () => {
  const { db, env } = setup();
  const before = nowS();
  const res = await patch(env, { user_id: 'u2', action: 'make_writer' });
  const after = nowS();
  assert.equal(res.status, 200);
  const g = liveGrants(db, 'u2');
  assert.deepEqual(g.map((r) => r.role), ['writer']);
  endsWithin(g[0].expires_at, 1, before, after);
  assert.equal(col(db, 'u2', 'is_writer'), 1);
  const log = db.prepare(`SELECT action, target_id FROM audit_log`).all().map((r) => ({ ...r }));
  assert.deepEqual(log, [{ action: 'role.grant', target_id: 'u2' }]);
});

test('make_admin with no duration gives a permanent grant', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_admin' })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2').map((r) => ({ ...r })), [{ role: 'admin', expires_at: null, revoked_at: null }]);
  assert.equal(col(db, 'u2', 'is_admin'), 1);
});

test('make_writer for three months is 400 too_long and changes nothing', async () => {
  const { db, env } = setup();
  const res = await patch(env, { user_id: 'u2', action: 'make_writer', duration: { months: 3 } });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, 'too_long');
  assert.deepEqual(liveGrants(db, 'u2'), []);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('a leader role may be given an explicit length', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_announcer', duration: { months: 6 } })).status, 200);
  const g = liveGrants(db, 'u2');
  assert.equal(g[0].role, 'announcer');
  assert.ok(g[0].expires_at! > nowS() + 150 * 86400);
});

test('a malformed duration is 400 malformed_request', async () => {
  const { env } = setup();
  for (const duration of ['1m', 3, null, [], {}, { months: '1' }, { permanent: 1 }, { until: 'soon' }, { months: 1, permanent: true }]) {
    const res = await patch(env, { user_id: 'u2', action: 'make_writer', duration });
    assert.equal(res.status, 400, JSON.stringify(duration));
    assert.equal(((await res.json()) as { code: string }).code, 'malformed_request', JSON.stringify(duration));
  }
});

test('removing your own admin role is still 400', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'admin', action: 'remove_admin' })).status, 400);
  assert.equal(col(db, 'admin', 'is_admin'), 1);
  assert.equal(liveGrants(db, 'admin').length, 1);
});

test('remove_* ends the grant and clears the column, whatever duration says', async () => {
  const { db, env } = setup();
  await patch(env, { user_id: 'u2', action: 'make_symposium' });
  assert.equal((await patch(env, { user_id: 'u2', action: 'remove_symposium', duration: { months: 1 } })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2'), []);
  assert.equal(col(db, 'u2', 'is_symposium'), 0);
  const actions = db.prepare(`SELECT action FROM audit_log ORDER BY seq`).all().map((r) => (r as { action: string }).action);
  assert.deepEqual(actions, ['role.grant', 'role.revoke']);
});

test('verify and unverify still set membership, not a grant', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'verify' })).status, 200);
  assert.equal(col(db, 'u2', 'is_member'), 1);
  assert.deepEqual(liveGrants(db, 'u2'), []);
});

test('make_sender from the user panel writes a sender grant and a sender_grants row', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_sender', value: ' outreach ' })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2').map((r) => r.role), ['sender']);
  assert.equal(col(db, 'u2', 'is_sender'), 1);
  const rec = db.prepare(`SELECT team, revoked_at FROM sender_grants WHERE user_id = 'u2'`).all().map((r) => ({ ...r }));
  assert.deepEqual(rec, [{ team: 'outreach', revoked_at: null }]);
  assert.equal((await patch(env, { user_id: 'u2', action: 'remove_sender' })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2'), []);
  assert.equal(col(db, 'u2', 'is_sender'), 0);
  assert.ok((db.prepare(`SELECT revoked_at FROM sender_grants WHERE user_id = 'u2'`).get() as { revoked_at: number }).revoked_at);
});

test('the bulk sender grant gives sender grants and sender_grants rows, one month by default', async () => {
  const { db, env } = setup();
  const before = nowS();
  const res = await call(senders.onRequestPost, 'POST', '/api/admin/senders', {
    env, as: 'admin', headers: ORIGIN, body: { emails: 'two@example.org, three@example.org, ghost@example.org', team: 'Mail' },
  });
  const after = nowS();
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, granted: ['two@example.org', 'three@example.org'], unknown: ['ghost@example.org'] });
  for (const id of ['u2', 'u3']) {
    const g = liveGrants(db, id);
    assert.deepEqual(g.map((r) => r.role), ['sender'], id);
    endsWithin(g[0].expires_at, 1, before, after);
    assert.equal(col(db, id, 'is_sender'), 1);
  }
  const rec = db.prepare(`SELECT user_id, team FROM sender_grants ORDER BY user_id`).all().map((r) => ({ ...r }));
  assert.deepEqual(rec, [{ user_id: 'u2', team: 'Mail' }, { user_id: 'u3', team: 'Mail' }]);
  const actions = db.prepare(`SELECT action FROM audit_log`).all().map((r) => (r as { action: string }).action);
  assert.deepEqual(actions, ['role.grant', 'role.grant']);
});

test('the bulk sender grant takes a duration and rejects one too long', async () => {
  const { db, env } = setup();
  const post = (body: unknown) => call(senders.onRequestPost, 'POST', '/api/admin/senders', { env, as: 'admin', headers: ORIGIN, body });
  const bad = await post({ emails: 'two@example.org', duration: { months: 2 } });
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as { code: string }).code, 'too_long');
  assert.equal((await post({ emails: 'two@example.org', duration: 'forever' })).status, 400);
  assert.deepEqual(liveGrants(db, 'u2'), []);
  const until = nowS() + 10 * 86400;
  assert.equal((await post({ emails: 'two@example.org', duration: { until } })).status, 200);
  assert.equal(liveGrants(db, 'u2')[0].expires_at, until);
});

test('revoking a sender ends the grant and the sender_grants row', async () => {
  const { db, env } = setup();
  await call(senders.onRequestPost, 'POST', '/api/admin/senders', { env, as: 'admin', headers: ORIGIN, body: { emails: 'two@example.org' } });
  const res = await call(senders.onRequestPatch, 'PATCH', '/api/admin/senders', { env, as: 'admin', headers: ORIGIN, body: { user_id: 'u2', action: 'revoke' } });
  assert.equal(res.status, 200);
  assert.deepEqual(liveGrants(db, 'u2'), []);
  assert.equal(col(db, 'u2', 'is_sender'), 0);
  assert.ok((db.prepare(`SELECT revoked_at FROM sender_grants WHERE user_id = 'u2'`).get() as { revoked_at: number }).revoked_at);
  const actions = db.prepare(`SELECT action FROM audit_log ORDER BY seq`).all().map((r) => (r as { action: string }).action);
  assert.deepEqual(actions, ['role.grant', 'role.revoke']);
});

test('a sender grant that runs out closes its record, so the next grant records the new team', async () => {
  const { db, env } = setup();
  const post = (body: unknown) => call(senders.onRequestPost, 'POST', '/api/admin/senders', { env, as: 'admin', headers: ORIGIN, body });
  const end = nowS() + 60;
  assert.equal((await post({ emails: 'two@example.org', team: 'Team A', duration: { until: end } })).status, 200);
  assert.equal(await expireGrants((env as { DB: D1Database }).DB, end + 1), 1);
  assert.equal(col(db, 'u2', 'is_sender'), 0);
  assert.equal((await post({ emails: 'two@example.org', team: 'Team B' })).status, 200);
  const rec = db.prepare(`SELECT team, revoked_at, revoked_by FROM sender_grants WHERE user_id = 'u2' ORDER BY granted_at, rowid`).all().map((r) => ({ ...r }));
  assert.deepEqual(rec, [
    { team: 'Team A', revoked_at: end, revoked_by: null },
    { team: 'Team B', revoked_at: null, revoked_by: null },
  ]);
  const res = await call(senders.onRequestGet, 'GET', '/api/admin/senders', { env, as: 'admin' });
  const body = (await res.json()) as { senders: { user_id: string; team: string | null }[] };
  assert.deepEqual(body.senders.filter((s) => s.user_id === 'u2').map((s) => s.team), ['Team B']);
});

test('a sender who also holds a permanent sender grant keeps the record open when the timed one runs out', async () => {
  const { db, env } = setup();
  const post = (body: unknown) => call(senders.onRequestPost, 'POST', '/api/admin/senders', { env, as: 'admin', headers: ORIGIN, body });
  const end = nowS() + 60;
  assert.equal((await post({ emails: 'two@example.org', team: 'Team A', duration: { until: end } })).status, 200);
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('perm', 'u2', 'sender', NULL, NULL, 1)`).run();
  assert.equal(await expireGrants((env as { DB: D1Database }).DB, end + 1), 1);
  assert.equal(col(db, 'u2', 'is_sender'), 1);
  assert.deepEqual(db.prepare(`SELECT team, revoked_at FROM sender_grants WHERE user_id = 'u2'`).all().map((r) => ({ ...r })),
    [{ team: 'Team A', revoked_at: null }]);
});

test('GET filter=roles carries each user\'s live grants, staying under the 100-bind cap for 150 users', async () => {
  const { db, env, bindLog } = setup();
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_writer, created_at, last_login) VALUES (?, ?, ?, 1, ?, 1)');
  const grant = db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, revoked_at) VALUES (?, ?, ?, ?, 'admin', 1, ?)`);
  const end = nowS() + 86400;
  for (let i = 0; i < 150; i++) {
    const id = `w${i}`;
    add.run(id, `g-${id}`, `${id}@example.org`, 1000 + i);
    grant.run(`gw${i}`, id, 'writer', end, null);
    grant.run(`gx${i}`, id, 'sender', end, 5); // revoked: not listed
  }
  bindLog.length = 0;
  const res = await call(users.onRequestGet, 'GET', '/api/admin/users?filter=roles', { env, as: 'admin' });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { users: { id: string; grants: { role: string; expires_at: number | null }[] }[] };
  assert.ok(body.users.length > 0);
  for (const u of body.users) {
    assert.ok(Array.isArray(u.grants), u.id);
    if (u.id === 'admin') assert.deepEqual(u.grants, [{ role: 'admin', expires_at: null }]);
    else assert.deepEqual(u.grants, [{ role: 'writer', expires_at: end }], u.id);
  }
  const over = bindLog.filter((b) => b.count > 100);
  assert.deepEqual(over, [], 'no statement binds more than 100 parameters');
  const grantQueries = bindLog.filter((b) => /FROM role_grants WHERE user_id IN/.test(b.sql));
  assert.ok(grantQueries.length >= 1 && grantQueries.length <= Math.ceil(body.users.length / 90) + 1, `${grantQueries.length} grant queries`);
});

/** u3 approves Etkinlikler; u4 is a former approver whose grant has ended. */
function setupApprover() {
  const s = setup();
  const add = s.db.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, 0, 1, 1)');
  add.run('u4', 'g-u4', 'four@example.org');
  const grant = s.db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, ?, NULL, 1)');
  grant.run('ga3', 'u3', 'content.etkinlikler.approve', null);
  grant.run('ga4', 'u4', 'content.etkinlikler.approve', nowS() - 10);
  for (const id of ['u2', 'u3', 'u4']) s.db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  return s;
}
const patchAs = (env: unknown, as: string, body: unknown) =>
  call(users.onRequestPatch, 'PATCH', '/api/admin/users', { env, as, body, headers: ORIGIN });

test('an admin grants the Etkinlikler roles: approve by default for good, edit for a month', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_content.etkinlikler.approve' })).status, 200);
  assert.equal((await patch(env, { user_id: 'u3', action: 'make_content.etkinlikler.edit' })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2').map((r) => ({ ...r })), [{ role: 'content.etkinlikler.approve', expires_at: null, revoked_at: null }]);
  const g = liveGrants(db, 'u3');
  assert.equal(g[0].role, 'content.etkinlikler.edit');
  assert.ok(g[0].expires_at! <= nowS() + 31 * 86400);
});

test('an approver grants Etkinlikler edit for a month; longer is too_long; the approve role is not_allowed', async () => {
  const { db, env } = setupApprover();
  const before = nowS();
  const res = await patchAs(env, 'u3', { user_id: 'u2', action: 'make_content.etkinlikler.edit', duration: { months: 1 } });
  const after = nowS();
  assert.equal(res.status, 200);
  const g = liveGrants(db, 'u2');
  assert.deepEqual(g.map((r) => r.role), ['content.etkinlikler.edit']);
  endsWithin(g[0].expires_at, 1, before, after);
  const log = db.prepare(`SELECT user_id, action, target_id FROM audit_log`).all().map((r) => ({ ...r }));
  assert.deepEqual(log, [{ user_id: 'u3', action: 'role.grant', target_id: 'u2' }]);

  const long = await patchAs(env, 'u3', { user_id: 'u4', action: 'make_content.etkinlikler.edit', duration: { months: 2 } });
  assert.equal(long.status, 400);
  assert.equal(((await long.json()) as { code: string }).code, 'too_long');
  const perm = await patchAs(env, 'u3', { user_id: 'u4', action: 'make_content.etkinlikler.edit', duration: { permanent: true } });
  assert.equal(((await perm.json()) as { code: string }).code, 'permanent_not_allowed');
  const up = await patchAs(env, 'u3', { user_id: 'u4', action: 'make_content.etkinlikler.approve', duration: { months: 1 } });
  assert.equal(up.status, 403);
  assert.equal(((await up.json()) as { code: string }).code, 'not_allowed');
  // u4's only row is the approve grant that ended before the test.
  assert.deepEqual(liveGrants(db, 'u4').map((r) => r.expires_at! < nowS()), [true]);
});

test('an approver removes Etkinlikler edit, but not the approve role', async () => {
  const { db, env } = setupApprover();
  await patch(env, { user_id: 'u2', action: 'make_content.etkinlikler.edit' });
  assert.equal((await patchAs(env, 'u3', { user_id: 'u2', action: 'remove_content.etkinlikler.edit' })).status, 200);
  assert.deepEqual(liveGrants(db, 'u2'), []);
  await patch(env, { user_id: 'u2', action: 'make_content.etkinlikler.approve' });
  assert.equal((await patchAs(env, 'u3', { user_id: 'u2', action: 'remove_content.etkinlikler.approve' })).status, 403);
  assert.deepEqual(liveGrants(db, 'u2').map((r) => r.role), ['content.etkinlikler.approve']);
});

test('everything else stays admin-only for an approver; a lapsed approver and a plain user get nothing', async () => {
  const { db, env } = setupApprover();
  for (const action of ['make_writer', 'remove_admin', 'make_admin', 'verify', 'unverify', 'make_private', 'clear_bio', 'set_rank', 'award_badge', 'nonsense']) {
    const res = await patchAs(env, 'u3', { user_id: 'u2', action, value: 'seed' });
    assert.equal(res.status, 403, action);
  }
  for (const as of ['u4', 'u2']) {
    const res = await patchAs(env, as, { user_id: 'u2', action: 'make_content.etkinlikler.edit', duration: { months: 1 } });
    assert.equal(res.status, 403, as);
  }
  assert.deepEqual(liveGrants(db, 'u2'), []);
  assert.equal(col(db, 'u2', 'is_member'), 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('GET filter=roles lists content-role holders, who have no is_* column', async () => {
  const { env } = setupApprover();
  const res = await call(users.onRequestGet, 'GET', '/api/admin/users?filter=roles', { env, as: 'admin' });
  const body = (await res.json()) as { users: { id: string; grants: { role: string }[] }[] };
  const u3 = body.users.find((u) => u.id === 'u3');
  assert.ok(u3, 'the approver is listed');
  assert.deepEqual(u3!.grants.map((g) => g.role), ['content.etkinlikler.approve']);
  assert.ok(!body.users.some((u) => u.id === 'u4'), 'an ended grant is not a role');
});

test('GET for an approver: holders of the roles they grant, and a search, trimmed to what the Roles view needs', async () => {
  const { env } = setupApprover();
  await patch(env, { user_id: 'u2', action: 'make_content.etkinlikler.edit' });
  await patch(env, { user_id: 'u2', action: 'make_writer' });
  const get = (as: string, qs: string) => call(users.onRequestGet, 'GET', `/api/admin/users?${qs}`, { env, as });

  const roles = await get('u3', 'filter=roles');
  assert.equal(roles.status, 200);
  const rb = (await roles.json()) as { users: Record<string, unknown>[]; badge_catalog: unknown[] };
  assert.deepEqual(rb.users.map((u) => u.id), ['u2']);
  assert.deepEqual(Object.keys(rb.users[0]).sort(), ['display_name', 'email', 'grants', 'id']);
  assert.deepEqual(rb.users[0].grants, [{ role: 'content.etkinlikler.edit', expires_at: (rb.users[0].grants as { expires_at: number }[])[0].expires_at }]);
  assert.deepEqual(rb.badge_catalog, []);

  const found = await get('u3', 'filter=all&search=four');
  assert.equal(found.status, 200);
  const fb = (await found.json()) as { users: Record<string, unknown>[] };
  assert.deepEqual(fb.users.map((u) => u.id), ['u4']);
  assert.deepEqual(Object.keys(fb.users[0]).sort(), ['display_name', 'email', 'grants', 'id']);

  // No browsing the whole directory, and nothing for someone without an approver role.
  assert.equal((await get('u3', 'filter=all')).status, 403);
  assert.equal((await get('u3', 'filter=members&search=four')).status, 403);
  assert.equal((await get('u4', 'filter=roles')).status, 403);
  assert.equal((await get('u2', 'filter=roles')).status, 403);
});

test('an approver\'s search is literal, at least three characters, and ten people at most', async () => {
  const { db, env } = setupApprover();
  const add = db.prepare('INSERT INTO users (id, google_id, email, created_at, last_login) VALUES (?, ?, ?, ?, 1)');
  add.run('lit', 'g-lit', 'a_b@example.org', 50);
  add.run('wild', 'g-wild', 'axb@example.org', 51);
  for (let i = 0; i < 15; i++) add.run(`bulk${i}`, `g-bulk${i}`, `bulk${i}@example.org`, 100 + i);
  const search = async (q: string) => {
    const res = await call(users.onRequestGet, 'GET', `/api/admin/users?${new URLSearchParams({ filter: 'all', search: q })}`, { env, as: 'u3' });
    return { status: res.status, body: (await res.json()) as { users?: { id: string }[]; code?: string } };
  };
  for (const q of ['%%%', '___', '\\\\\\', '%_%']) {
    const r = await search(q);
    assert.equal(r.status, 200, q);
    assert.deepEqual(r.body.users, [], `${q} is not a wildcard`);
  }
  assert.deepEqual((await search('a_b')).body.users!.map((u) => u.id), ['lit'], '_ matches only itself');
  for (const q of ['@', '%', '_', 'fo', ' fo ']) {
    const r = await search(q);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.code, 'search_too_short', q);
  }
  assert.deepEqual((await search('fou')).body.users!.map((u) => u.id), ['u4']);
  const bulk = await search('bulk');
  assert.equal(bulk.body.users!.length, 10);
  // An admin's search is unchanged.
  const res = await call(users.onRequestGet, 'GET', '/api/admin/users?filter=all&search=bulk', { env, as: 'admin' });
  assert.equal(((await res.json()) as { users: unknown[] }).users.length, 15);
});
