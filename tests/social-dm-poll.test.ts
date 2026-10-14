import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { stubGraph, type GraphCall } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
import { runDmNotifications, dmDigestText } from '../functions/_lib/social-dm-notify';
import { pollDms } from '../functions/_lib/social-dm-poll';
import { onRequestPost as tick } from '../functions/api/social/dispatch';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const T0 = Date.UTC(2026, 9, 15, 9, 0) / 1000; // 12:00 Istanbul
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', '+0000');

let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never;
  return { ...s, env };
}
async function connect(env: unknown, scopes = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages') {
  await (await connectionUpsert(env as never, 'instagram', {
    accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null, scopes, expiresAt: T0 + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', T0 - 86400)).run();
}
const threads = (db: import('node:sqlite').DatabaseSync) => db.prepare(`SELECT * FROM social_dm_threads ORDER BY conversation_id`).all() as Record<string, unknown>[];

/** conversations: id -> list of [from id, username, at]. */
function graphWith(convs: Record<string, [string, string | null, number][]>) {
  return (c: GraphCall) => {
    if (c.path === '/me/conversations') {
      return Response.json({ data: Object.entries(convs).map(([id, ms]) => ({ id, updated_time: iso(Math.max(...ms.map((m) => m[2]))) })) });
    }
    const id = c.path.slice(1);
    if (convs[id]) return Response.json({ messages: { data: convs[id].map(([from, username, at], i) => ({ id: `${id}-${i}`, created_time: iso(at), from: { id: from, username }, message: 'gizli metin' })) } });
    return undefined;
  };
}

test('a first poll records each conversation without its text', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]], cB: [['777', null, T0 - 7200], [IG, 'rsg_test', T0 - 3600]] }));
  try { await pollDms(env, T0, ORIGIN); } finally { g.restore(); }
  const rows = threads(db);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].conversation_id, rows[0].peer_id, rows[0].peer_username, rows[0].last_inbound_at, rows[0].last_outbound_at], ['cA', '555', 'ayse', T0 - 600, null]);
  assert.deepEqual([rows[1].peer_id, rows[1].peer_username, rows[1].last_inbound_at, rows[1].last_outbound_at], ['777', null, T0 - 7200, T0 - 3600]);
  assert.ok(!JSON.stringify(rows).includes('gizli'), 'no message text in D1');
  assert.match(String(rows[0].id), /^[0-9a-f-]{36}$/);
});

test('paced: a second poll within five minutes does nothing; force waits 30 seconds', async () => {
  const { env } = world();
  await connect(env);
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]] }));
  try {
    await pollDms(env, T0, ORIGIN);
    assert.equal((await pollDms(env, T0 + 120, ORIGIN)).skipped, 'paced');
    assert.equal((await pollDms(env, T0 + 20, ORIGIN, { force: true })).skipped, 'paced');
    assert.equal((await pollDms(env, T0 + 31, ORIGIN, { force: true })).skipped, undefined);
    assert.equal((await pollDms(env, T0 + 331, ORIGIN)).skipped, undefined);
  } finally { g.restore(); }
});

test('an unchanged conversation is not fetched again; a changed one is', async () => {
  const { env, db } = world();
  await connect(env);
  const convs: Record<string, [string, string | null, number][]> = { cA: [['555', 'ayse', T0 - 600]] };
  const g = stubGraph(graphWith(convs));
  try {
    await pollDms(env, T0, ORIGIN);
    const before = g.calls.length;
    await pollDms(env, T0 + 300, ORIGIN);
    assert.equal(g.calls.length - before, 1, 'list only');
    convs.cA.push([IG, 'rsg_test', T0 + 400]);
    await pollDms(env, T0 + 600, ORIGIN);
  } finally { g.restore(); }
  assert.equal(threads(db)[0].last_outbound_at, T0 + 400, 'answered in the Instagram app is seen');
});

test('at most ten conversation fetches per poll; the rest wait', async () => {
  const { env, db } = world();
  await connect(env);
  const convs: Record<string, [string, string | null, number][]> = {};
  for (let i = 0; i < 13; i++) convs[`c${String(i).padStart(2, '0')}`] = [[`p${i}`, `u${i}`, T0 - 1000 + i]];
  const g = stubGraph(graphWith(convs));
  try {
    const first = await pollDms(env, T0, ORIGIN);
    assert.equal(first.fetched, 10);
    assert.equal(threads(db).length, 10);
    await pollDms(env, T0 + 300, ORIGIN);
  } finally { g.restore(); }
  assert.equal(threads(db).length, 13);
});

test('not connected, or connected without the messaging scope: skipped quietly', async () => {
  const a = world();
  assert.equal((await pollDms(a.env, T0, ORIGIN)).skipped, 'not_connected');
  const b = world();
  await connect(b.env, 'instagram_business_basic,instagram_business_content_publish');
  assert.equal((await pollDms(b.env, T0, ORIGIN)).skipped, 'needs_scope');
});

test('an auth error marks Instagram broken; a transient one does not', async () => {
  const { env, db } = world();
  await connect(env);
  let g = stubGraph(() => Response.json({ error: { code: 4, message: 'busy' } }, { status: 400 }));
  try { await pollDms(env, T0, ORIGIN); } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as { last_error: string | null }).last_error, null);
  g = stubGraph(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
  try { await pollDms(env, T0 + 300, ORIGIN); } finally { g.restore(); }
  assert.ok((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as { last_error: string | null }).last_error);
});

test('the social tick still answers 200 when the DM poll throws', async () => {
  const { env, db } = world();
  await connect(env);
  db.exec('DROP TABLE social_dm_threads');
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]] }));
  try {
    const res = await tick({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'tick' } }), env } as never);
    assert.equal(res.status, 200);
  } finally { g.restore(); }
});

function seedThread(db: import('node:sqlite').DatabaseSync, o: { id: string; inbound: number; outbound?: number | null; user?: string | null; digested?: number | null; warned?: number | null }) {
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, digested_at, final_warned_at, updated_at)
              VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, `conv-${o.id}`, `peer-${o.id}`, o.user === undefined ? 'ayse' : o.user, o.inbound, o.outbound ?? null, o.digested ?? null, o.warned ?? null, o.inbound);
}

test('digest: one mail per publisher, nothing to admins when a publisher exists, then paced', async () => {
  const { env, db } = world();
  seedThread(db, { id: 'a', inbound: T0 - 600 });
  const r1 = await runDmNotifications(env, T0, ORIGIN);
  assert.equal(r1.digests, 1);
  assert.deepEqual(mail.sent.map((m) => m.to), ['pub@example.org']);
  assert.match(mail.sent[0].subject, /Instagram/);
  assert.equal((db.prepare(`SELECT digested_at FROM social_dm_threads WHERE id='a'`).get() as { digested_at: number }).digested_at, T0 - 600);
  seedThread(db, { id: 'b', inbound: T0 + 60 });
  assert.equal((await runDmNotifications(env, T0 + 120, ORIGIN)).digests, 0, 'an hour apart');
  assert.equal((await runDmNotifications(env, T0 + 3600, ORIGIN)).digests, 1);
  assert.equal((await runDmNotifications(env, T0 + 7300, ORIGIN)).digests, 0, 'nothing new');
});

test('digest goes to admins when there is no publisher', async () => {
  const { env, db } = world();
  db.prepare(`UPDATE users SET is_social_publisher = 0`).run();
  seedThread(db, { id: 'a', inbound: T0 - 600 });
  await runDmNotifications(env, T0, ORIGIN);
  assert.deepEqual(mail.sent.map((m) => m.to), ['admin@example.org']);
});

test('quiet hours: no digest at 23:30, and the DM is still fresh at 08:00 (R5)', async () => {
  const { env, db } = world();
  const night = Date.UTC(2026, 9, 15, 20, 30) / 1000; // 23:30 Istanbul
  seedThread(db, { id: 'a', inbound: night - 60 });
  assert.equal((await runDmNotifications(env, night, ORIGIN)).digests, 0);
  assert.equal(mail.sent.length, 0);
  const morning = Date.UTC(2026, 9, 16, 5, 0) / 1000; // 08:00
  assert.equal((await runDmNotifications(env, morning, ORIGIN)).digests, 1);
});

test('answered or expired threads never send anything', async () => {
  const { env, db } = world();
  seedThread(db, { id: 'a', inbound: T0 - 600, outbound: T0 - 60 });
  seedThread(db, { id: 'b', inbound: T0 - 30 * 3600 });
  const r = await runDmNotifications(env, T0, ORIGIN);
  assert.deepEqual(r, { lastCalls: 0, digests: 0 });
  assert.equal(mail.sent.length, 0);
});

test('last call: at 20 hours to publishers and admins, at night too, once per message', async () => {
  const { env, db } = world();
  const night = Date.UTC(2026, 9, 15, 21, 0) / 1000; // 00:00 Istanbul
  seedThread(db, { id: 'a', inbound: night - 20 * 3600, digested: night - 20 * 3600 });
  const r = await runDmNotifications(env, night, ORIGIN);
  assert.equal(r.lastCalls, 1);
  assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'pub@example.org']);
  assert.equal((await runDmNotifications(env, night + 300, ORIGIN)).lastCalls, 0);
});

test('digest text: usernames, time left and a link per thread, never message text; unknown sender has a name', () => {
  const at = T0 - 3600;
  const text = dmDigestText([
    { id: 'id-1', platform: 'instagram', conversation_id: 'c', peer_id: 'p', peer_username: 'ayse', last_inbound_at: at, last_outbound_at: null, read_at: null, read_by: null, digested_at: null, final_warned_at: null, updated_at: at },
    { id: 'id-2', platform: 'instagram', conversation_id: 'c2', peer_id: 'p2', peer_username: null, last_inbound_at: at, last_outbound_at: null, read_at: null, read_by: null, digested_at: null, final_warned_at: null, updated_at: at },
  ], T0, ORIGIN);
  assert.match(text.text, /@ayse/);
  assert.match(text.text, /Instagram kullanıcısı/);
  assert.match(text.text, /Instagram user/);
  assert.ok(!text.text.includes('@null'));
  assert.match(text.text, /\/tr\/admin#sosyal\/dm\/id-1/);
  assert.match(text.text, /23 saat/);
  assert.match(text.subject, /2/);
});

test('the digest log keeps two days', async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES ('pub', ?), ('pub', ?)`).run(T0 - 3 * 86400, T0 - 3600);
  await runDmNotifications(env, T0, ORIGIN);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM social_dm_digest_log`).get() as { n: number }).n, 1);
});

test('R7: when the run log cannot be written, the poll does not call Meta', async () => {
  const { env, db } = world();
  await connect(env);
  db.exec(`CREATE TRIGGER no_dm_runs BEFORE INSERT ON dispatch_runs WHEN NEW.kind = 'social_dm' BEGIN SELECT RAISE(ABORT, 'log down'); END`);
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]] }));
  try {
    const r = await pollDms(env, T0, ORIGIN);
    assert.equal(r.error, 'run log unavailable');
    assert.equal(g.calls.length, 0, 'no graph call');
  } finally { g.restore(); }
});
