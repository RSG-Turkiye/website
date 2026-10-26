import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { mintConnection } from './lib/agent';
import {
  LIMITS, chargeConnection, readSnapshot, registrationBumps, registrationRefusal, scanUpload,
} from '../functions/_lib/agent-limits';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
/** A minute boundary inside a UTC day. */
const NOW = 1_800_000_000;
const IP = 'a'.repeat(64);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('ed', 'g-ed', 'ed@example.org', 1, 1)`).run();
  return { db, DB: d1(db) as never as D1Database };
}
const dayKey = (now: number) => String(Math.floor(now / 86_400)).padStart(6, '0');
const counters = (db: DatabaseSync) => JSON.stringify(db.prepare('SELECT * FROM agent_counters ORDER BY bucket').all());
const changes = (db: DatabaseSync) => (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
function spend(db: DatabaseSync, general: number, reserve = 0, userId = 'other') {
  db.prepare('INSERT INTO agent_counters (bucket, user_id, general, reserve) VALUES (?, ?, ?, ?)').run(`${dayKey(NOW)}:t:spent-${userId}`, userId, general, reserve);
}

// --- chargeConnection (Call 7) -------------------------------------------------

test('chargeConnection writes exactly one counter row when allowed', async () => {
  const { db, DB } = setup();
  const c = await mintConnection(db, 'ed', ['mcp:read']);
  const before = changes(db);
  assert.equal(await chargeConnection(DB, { tokenId: c.id, userId: 'ed', social: false }, IP, NOW), null);
  assert.equal(changes(db) - before, 1);
  const row = db.prepare('SELECT * FROM agent_counters').get() as Record<string, unknown>;
  assert.equal(row.bucket, `${dayKey(NOW)}:t:${c.id}`);
  assert.equal(row.user_id, 'ed');
  assert.equal(row.general, 1);
  assert.equal(row.minute_n, 1);
  assert.equal(await chargeConnection(DB, { tokenId: c.id, userId: 'ed', social: false }, IP, NOW + 1), null);
  assert.equal((db.prepare('SELECT general FROM agent_counters').get() as { general: number }).general, 2, 'the same row');
});

test('chargeConnection refuses with no write when the member has used their day', async () => {
  const { db, DB } = setup();
  spend(db, LIMITS.MEMBER_PER_DAY, 0, 'ed');
  const before = counters(db);
  const res = await chargeConnection(DB, { tokenId: 'conn', userId: 'ed', social: false }, IP, NOW);
  assert.ok(res);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: 'rate_limited' });
  assert.ok(Number(res.headers.get('Retry-After')) > 0);
  assert.equal(counters(db), before);
});

test('chargeConnection: a spent general pool refuses plain work and serves social work from the reserve', async () => {
  const { db, DB } = setup();
  spend(db, LIMITS.AGENT_GENERAL_PER_DAY);
  const before = counters(db);
  const refused = await chargeConnection(DB, { tokenId: 'conn', userId: 'ed', social: false }, IP, NOW);
  assert.ok(refused);
  assert.equal(refused.status, 429);
  assert.equal(((await refused.json()) as { code: string }).code, 'agent_budget');
  assert.equal(counters(db), before, 'refused: no write');

  assert.equal(await chargeConnection(DB, { tokenId: 'conn', userId: 'ed', social: true }, IP, NOW), null);
  const row = db.prepare(`SELECT general, reserve FROM agent_counters WHERE bucket = ?`).get(`${dayKey(NOW)}:t:conn`) as { general: number; reserve: number };
  assert.deepEqual({ ...row }, { general: 0, reserve: 1 });

  spend(db, 0, LIMITS.AGENT_RESERVE_PER_DAY, 'third');
  const all = await chargeConnection(DB, { tokenId: 'conn', userId: 'ed', social: true }, IP, NOW);
  assert.equal(all?.status, 429, 'both pools spent');
});

test('chargeConnection does not look at the IP: hosted connectors share addresses', async () => {
  const { db, DB } = setup();
  db.prepare('INSERT INTO agent_counters (bucket, fail_window, fail_n) VALUES (?, ?, ?)')
    .run(`${dayKey(NOW)}:i:${IP}`, Math.floor(NOW / LIMITS.IP_FAILED_AUTH_WINDOW), LIMITS.IP_FAILED_AUTH);
  assert.equal(await chargeConnection(DB, { tokenId: 'conn', userId: 'ed', social: false }, IP, NOW), null);
});

test('chargeConnection: past the minute limit it counts the minute only, and a flood revokes the connection', async () => {
  const { db, DB } = setup();
  const c = await mintConnection(db, 'ed', ['mcp:read']);
  const who = { tokenId: c.id, userId: 'ed', social: false };
  for (let i = 0; i < LIMITS.TOKEN_PER_MINUTE; i++) assert.equal(await chargeConnection(DB, who, IP, NOW), null, `${i + 1}`);
  const over = await chargeConnection(DB, who, IP, NOW);
  assert.equal(over?.status, 429);
  assert.deepEqual(await over?.json(), { error: 'rate_limited' });
  const row = () => db.prepare('SELECT general, minute_n FROM agent_counters WHERE bucket = ?').get(`${dayKey(NOW)}:t:${c.id}`) as { general: number; minute_n: number };
  assert.deepEqual({ ...row() }, { general: LIMITS.TOKEN_PER_MINUTE, minute_n: LIMITS.TOKEN_PER_MINUTE + 1 });
  for (let i = LIMITS.TOKEN_PER_MINUTE + 1; i < LIMITS.FLOOD_PER_MINUTE; i++) await chargeConnection(DB, who, IP, NOW);
  const t = db.prepare('SELECT revoked_at, revoke_reason FROM agent_tokens WHERE id = ?').get(c.id) as { revoked_at: number | null; revoke_reason: string };
  assert.equal(t.revoked_at, NOW);
  assert.equal(t.revoke_reason, 'flood');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'agent_token.auto_revoke'`).get() as { n: number }).n, 1);
  // The next minute counts again from one.
  assert.equal(await chargeConnection(DB, who, IP, NOW + 60), null);
});

// --- registration caps ----------------------------------------------------------

test('registrationRefusal: the 11th from one IP is 429 and writes nothing', async () => {
  const { db, DB } = setup();
  for (let i = 0; i < 10; i++) {
    assert.equal(await registrationRefusal(DB, IP, NOW), null, `${i + 1}`);
    await DB.batch(registrationBumps(DB, IP, NOW));
  }
  const before = counters(db);
  const res = await registrationRefusal(DB, IP, NOW);
  assert.equal(res?.status, 429);
  assert.deepEqual(await res?.json(), { error: 'rate_limited' });
  assert.ok(Number(res?.headers.get('Retry-After')) > 0);
  assert.equal(counters(db), before, 'byte for byte');
  assert.equal(await registrationRefusal(DB, 'b'.repeat(64), NOW), null, 'another IP is not affected');
  assert.equal(await registrationRefusal(DB, IP, NOW + 86_400), null, 'the next UTC day starts over');
});

test('registrationRefusal: the 201st of the day from anywhere is 429 and writes nothing', async () => {
  const { db, DB } = setup();
  for (let i = 0; i < 200; i++) {
    const ip = `ip-${i}`;
    assert.equal(await registrationRefusal(DB, ip, NOW), null, `${i + 1}`);
    await DB.batch(registrationBumps(DB, ip, NOW));
  }
  const before = counters(db);
  const res = await registrationRefusal(DB, 'fresh-ip', NOW);
  assert.equal(res?.status, 429);
  assert.equal(counters(db), before, 'byte for byte');
});

test('registrationBumps are two upserts on day-prefixed keys outside the token range', async () => {
  const { db, DB } = setup();
  const stmts = registrationBumps(DB, IP, NOW);
  assert.equal(stmts.length, 2);
  await DB.batch(stmts);
  const keys = (db.prepare('SELECT bucket, requests FROM agent_counters ORDER BY bucket').all() as { bucket: string; requests: number }[]).map((r) => ({ ...r }));
  assert.deepEqual(keys, [
    { bucket: `${dayKey(NOW)}:g:registrations`, requests: 1 },
    { bucket: `${dayKey(NOW)}:r:${IP}`, requests: 1 },
  ]);
  // The agents' pools and IP checks never see them.
  const snap = await readSnapshot(DB, IP, NOW);
  assert.deepEqual(snap, { ip: null, failures: 0, tokens: [] });
});

// --- the upload leak check knows the OAuth prefixes ------------------------------------

test('an upload holding an OAuth access or refresh value is leaked, as ASCII or UTF-16', async () => {
  const utf16 = (s: string, le: boolean) => new Uint8Array([...s].flatMap((ch) => (le ? [ch.charCodeAt(0), 0] : [0, ch.charCodeAt(0)])));
  for (const prefix of ['rsg_oat_', 'rsg_ort_']) {
    for (const bytes of [new TextEncoder().encode(`xx${prefix}abc`), utf16(`xx${prefix}abc`, true), utf16(`xx${prefix}abc`, false)]) {
      const body = new Response(bytes).body;
      assert.equal(await scanUpload({ body }, 1024), 'leaked', prefix);
    }
  }
  assert.equal(await scanUpload({ body: new Response('rsg_xyz_ nothing').body }, 1024), 'ok');
});
