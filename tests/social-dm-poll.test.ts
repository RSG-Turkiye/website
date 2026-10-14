import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { stubGraph, type GraphCall } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
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
