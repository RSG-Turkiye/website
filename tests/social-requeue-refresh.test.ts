import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail } from './lib/social';
import { stubGraph } from './lib/instagram';
import { stubHttp } from './lib/http';
import { onRequestPost as requeue } from '../functions/api/social/posts/[id]/requeue';
import { onRequestPost as refresh } from '../functions/api/admin/social/refresh-tokens';
import { onRequestGet as list } from '../functions/api/social/posts/index';
import { connectionUpsert, getConnection, readAccessToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world(postStatus: string, targetStatus: string) {
  const s = setupSocial();
  s.db.prepare(`INSERT INTO social_posts (id, type, caption, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
                VALUES ('p1','image','x','["instagram"]', 100, ?, 4, 'ed', 1, 1)`).run(postStatus);
  s.db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, attempts, first_tried_at, last_error, container_id) VALUES ('p1','instagram',?, 3, 50, 'x', 'c9')`).run(targetStatus);
  return { ...s, env: { ...(s.env as object), TOKEN_ENC_KEY: KEY } as never };
}
const t = (db: import('node:sqlite').DatabaseSync) => ({ ...db.prepare(`SELECT status, confirmed_at, attempts, first_tried_at, last_error, container_id FROM social_post_targets`).get() as object }) as Record<string, unknown>;

test('publish anyway: a late target goes back to the queue, confirmed', async () => {
  const { env, db } = world('scheduled', 'needs_confirmation');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.equal(res.status, 200);
  const r = t(db);
  assert.equal(r.status, 'queued');
  assert.ok(r.confirmed_at);
  assert.equal(r.container_id, 'c9', 'a late target never had a container; nothing to clear');
});

test('retry: a failed post and its failed target start clean, the container is kept', async () => {
  const { env, db } = world('failed', 'failed');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 5, status: 'scheduled' });
  assert.deepEqual([t(db).status, t(db).attempts, t(db).first_tried_at, t(db).last_error, t(db).container_id], ['queued', 0, null, null, 'c9']);
  assert.equal((db.prepare(`SELECT status FROM social_posts`).get() as { status: string }).status, 'scheduled');
});

test('editors cannot requeue; nothing to requeue is a 409', async () => {
  const { env } = world('failed', 'failed');
  assert.equal((await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'ed', params: { id: 'p1' }, body: { revision: 4 } })).status, 403);
  const other = world('scheduled', 'queued');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env: other.env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.equal((await res.json() as { code: string }).code, 'not_requeueable');
});

test('the done list shows settled posts only', async () => {
  const { env, db } = world('published', 'published');
  db.prepare(`UPDATE social_posts SET scheduled_at = ?`).run(Math.floor(Date.now() / 1000) - 86400);
  const res = await call(list, 'GET', '/api/social/posts?done=1', { env, as: 'ed' });
  const posts = (await res.json() as { posts: { id: string }[] }).posts;
  assert.deepEqual(posts.map((p) => p.id), ['p1']);
});

async function connected(env: unknown, connectedAt: number, expiresAt: number) {
  await (await connectionUpsert(env as never, 'instagram', { accountId: '1', accountName: 'rsg', accessToken: 'old', refreshToken: null, scopes: 'x', expiresAt, refreshExpiresAt: null }, 'admin', connectedAt)).run();
}
const cron = (env: unknown, secret = 'cron-secret') =>
  (refresh as (c: unknown) => Promise<Response>)({ request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/social/refresh-tokens', { method: 'POST', headers: { 'X-Archive-Secret': secret } }), env });

test('the daily job refreshes a token close to expiry and stores the new one sealed', async () => {
  const { env } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  const g = stubGraph((c) => (c.path === '/refresh_access_token' ? Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 5184000 }) : undefined));
  try { assert.deepEqual(await (await cron(env)).json(), { ok: true, refreshed: true, linkedin: 'none', x: 'none', buffer: 'none' }); } finally { g.restore(); }
  const row = (await getConnection((env as { DB: D1Database }).DB, 'instagram'))!;
  assert.equal(await readAccessToken(env as never, row), 'new');
  assert.ok(row.expires_at! > now + 59 * 86400);
});

test('a refused refresh marks the connection broken and tells admins; a wrong secret is refused', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  assert.equal((await cron(env, 'nope')).status, 403);
  const g = stubGraph(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
  try { assert.deepEqual(await (await cron(env)).json(), { ok: true, refreshed: false, linkedin: 'none', x: 'none', buffer: 'none' }); } finally { g.restore(); }
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections`).get() as { last_error_at: number | null }).last_error_at);
  assert.ok(mail.sent.some((m) => /bağlantısı koptu/.test(m.subject)));
});

const audits = (db: import('node:sqlite').DatabaseSync, action: string) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = ?`).get(action) as { n: number }).n;

test('a transient refresh failure with time left leaves the connection alone', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  const g = stubGraph(() => new Response('down', { status: 503 }));
  try { assert.deepEqual(await (await cron(env)).json(), { ok: true, refreshed: false, linkedin: 'none', x: 'none', buffer: 'none' }); } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT last_error_at FROM platform_connections`).get() as { last_error_at: number | null }).last_error_at, null);
  assert.equal(mail.sent.length, 0);
  assert.equal(audits(db, 'connection.refresh_failed'), 1);
});

test('a transient refresh failure with under 3 days left marks broken and tells admins', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 58 * 86400, now + 2 * 86400);
  const g = stubGraph(() => new Response('down', { status: 503 }));
  try { await cron(env); } finally { g.restore(); }
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections`).get() as { last_error_at: number | null }).last_error_at);
  assert.ok(mail.sent.some((m) => /bağlantısı koptu/.test(m.subject)));
});

test('a successful refresh re-queues targets waiting on the connection, with a clean clock and no confirmation', async () => {
  const { env, db } = world('scheduled', 'waiting_connection');
  db.prepare(`UPDATE social_post_targets SET confirmed_at = 7`).run();
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  const g = stubGraph((c) => (c.path === '/refresh_access_token' ? Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 5184000 }) : undefined));
  try { await cron(env); } finally { g.restore(); }
  assert.deepEqual([t(db).status, t(db).confirmed_at, t(db).attempts, t(db).first_tried_at, t(db).last_error, t(db).container_id], ['queued', null, 0, null, null, 'c9']);
});

test('daily: a LinkedIn token with a refresh token is renewed inside 20 days; without one, admins are reminded at 14, 7, 3 and 1 days', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  const li = await connectionUpsert(env as never, 'linkedin', {
    accountId: '424242', accountName: 'RSG', accessToken: 'old', refreshToken: 'li-refresh', scopes: 'x', expiresAt: now + 10 * 86400, refreshExpiresAt: now + 300 * 86400,
  }, 'admin', now - 50 * 86400);
  await li.run();
  const g = stubHttp(['www.linkedin.com'], (c) => (c.url.pathname === '/oauth/v2/accessToken' ? Response.json({ access_token: 'new', expires_in: 5184000, refresh_token: 'li-refresh', refresh_token_expires_in: 25920000 }) : undefined));
  let body: Record<string, unknown>;
  try { body = await (await cron(env)).json(); } finally { g.restore(); }
  assert.equal(body!.linkedin, 'refreshed');
  assert.equal(await readAccessToken(env as never, (await getConnection((env as { DB: D1Database }).DB, 'linkedin'))!), 'new');

  db.prepare(`UPDATE platform_connections SET refresh_token_enc = NULL, refresh_expires_at = NULL, expires_at = ? WHERE platform = 'linkedin'`).run(now + 7 * 86400 - 60);
  const sentBefore = mail.sent.length;
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).linkedin, 'reminded');
  assert.ok(mail.sent.length > sentBefore, 'admins were mailed');
  db.prepare(`UPDATE platform_connections SET expires_at = ? WHERE platform = 'linkedin'`).run(now + 9 * 86400);
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).linkedin, 'none', 'no mail on other days');
});

// LinkedIn failure paths and reminders
const D = 86400;
async function liConnected(env: unknown, expiresIn: number, refreshEndsIn: number | null) {
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env as never, 'linkedin', {
    accountId: '424242', accountName: 'RSG', accessToken: 'old', refreshToken: refreshEndsIn === null ? null : 'li-refresh', scopes: 'x',
    expiresAt: now + expiresIn, refreshExpiresAt: refreshEndsIn === null ? null : now + refreshEndsIn,
  }, 'admin', now - 50 * D)).run();
}
const liStub = (status: number) => stubHttp(['www.linkedin.com'], (c) => (c.url.pathname === '/oauth/v2/accessToken'
  ? (status === 200 ? Response.json({ access_token: 'new', expires_in: 5184000, refresh_token: 'li-refresh', refresh_token_expires_in: 25920000 }) : new Response('no', { status }))
  : undefined));
const liRow = (db: import('node:sqlite').DatabaseSync) => db.prepare(`SELECT last_error_at FROM platform_connections WHERE platform = 'linkedin'`).get() as { last_error_at: number | null };
const body = async (env: unknown) => await (await cron(env)).json() as Record<string, unknown>;
const liMails = (re: RegExp) => mail.sent.filter((m) => /LinkedIn/.test(m.subject) && re.test(m.subject)).length;

test('LinkedIn: a refused refresh marks it broken and mails admins once, not again while still broken', async () => {
  const { env, db } = world('scheduled', 'queued');
  await liConnected(env, 10 * D, 300 * D);
  const g = liStub(400);
  try {
    assert.equal((await body(env)).linkedin, 'none');
    assert.ok(liRow(db).last_error_at);
    const broken = liMails(/koptu/);
    assert.ok(broken >= 1);
    await body(env);
    assert.equal(liMails(/koptu/), broken, 'no second mail');
  } finally { g.restore(); }
});

test('LinkedIn: a transient failure with time left leaves it alone; with under 3 days left it marks broken', async () => {
  const a = world('scheduled', 'queued');
  await liConnected(a.env, 10 * D, 300 * D);
  let g = liStub(503);
  try { await body(a.env); } finally { g.restore(); }
  assert.equal(liRow(a.db).last_error_at, null);
  assert.equal(mail.sent.length, 0);
  const b = world('scheduled', 'queued');
  await liConnected(b.env, 2 * D, 300 * D);
  g = liStub(503);
  try { await body(b.env); } finally { g.restore(); }
  assert.ok(liRow(b.db).last_error_at);
  assert.ok(liMails(/koptu/) >= 1);
});

test('LinkedIn: an unreadable stored refresh token is treated as a refusal', async () => {
  const { env, db } = world('scheduled', 'queued');
  await liConnected(env, 10 * D, 300 * D);
  db.prepare(`UPDATE platform_connections SET refresh_token_enc = 'garbage' WHERE platform = 'linkedin'`).run();
  assert.equal((await body(env)).linkedin, 'none');
  assert.ok(liRow(db).last_error_at);
  assert.ok(liMails(/koptu/) >= 1);
});

test('LinkedIn: a successful refresh re-queues LinkedIn targets waiting on the connection', async () => {
  const { env, db } = world('scheduled', 'queued');
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, attempts, first_tried_at, last_error) VALUES ('p1','linkedin','waiting_connection', 3, 50, 'x')`).run();
  await liConnected(env, 10 * D, 300 * D);
  const g = liStub(200);
  try { assert.equal((await body(env)).linkedin, 'refreshed'); } finally { g.restore(); }
  const r = db.prepare(`SELECT status, attempts, first_tried_at, last_error FROM social_post_targets WHERE platform = 'linkedin'`).get() as Record<string, unknown>;
  assert.deepEqual({ ...r }, { status: 'queued', attempts: 0, first_tried_at: null, last_error: null });
});

test('LinkedIn: without a refresh token, reminders go out on days 14, 7, 3 and 1 only', async () => {
  for (const [days, mailed] of [[14, true], [7, true], [3, true], [1, true], [10, false], [2, false]] as const) {
    const { env } = world('scheduled', 'queued');
    mail.sent.length = 0;
    await liConnected(env, days * D - 60, null);
    assert.equal((await body(env)).linkedin, mailed ? 'reminded' : 'none', `day ${days}`);
    assert.equal(mail.sent.some((m) => /LinkedIn/.test(m.subject)), mailed, `mail on day ${days}`);
  }
});

test('LinkedIn: a refresh-token reminder day that coincides with an access-token refresh still mails', async () => {
  const { env } = world('scheduled', 'queued');
  await liConnected(env, 10 * D, 7 * D - 60);
  // the provider keeps the old refresh-token lifetime (no new refresh_token_expires_in)
  const g = stubHttp(['www.linkedin.com'], (c) => (c.url.pathname === '/oauth/v2/accessToken' ? Response.json({ access_token: 'new', expires_in: 5184000 }) : undefined));
  try { assert.equal((await body(env)).linkedin, 'refreshed'); } finally { g.restore(); }
  assert.ok(liMails(/doluyor/) >= 1, 'the reminder was mailed');
});

test('one platform throwing does not hide the other: LinkedIn lookup fails, Instagram result still reported', async () => {
  const { env } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  const real = (env as { DB: D1Database }).DB;
  const failing = {
    ...real,
    prepare: (sql: string) => {
      const st = real.prepare(sql);
      return sql.startsWith('SELECT * FROM platform_connections WHERE platform')
        ? { ...st, bind: (...a: unknown[]) => { if (a[0] === 'linkedin') throw new Error('d1 down'); return st.bind(...a); } }
        : st;
    },
    batch: real.batch.bind(real),
  };
  const g = stubGraph((c) => (c.path === '/refresh_access_token' ? Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 5184000 }) : undefined));
  const quiet = console.error; console.error = () => {};
  try {
    const res = await cron({ ...(env as object), DB: failing });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, refreshed: true, linkedin: 'none', x: 'none', buffer: 'none' });
  } finally { g.restore(); console.error = quiet; }
});

test('daily: a connected X account is renewed so its refresh token never goes idle', async () => {
  const { env } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'a', refreshToken: 'r', scopes: 'x', expiresAt: now - 60, refreshExpiresAt: null }, 'admin', now - 86400)).run();
  const g = stubHttp(['api.x.com'], () => Response.json({ access_token: 'a2', refresh_token: 'r2', expires_in: 7200 }));
  try { assert.equal((await (await cron(env)).json() as Record<string, unknown>).x, 'refreshed'); } finally { g.restore(); }
});

test('daily: no X connection reports none, and a throwing X renewal does not fail the call', async () => {
  const { env } = world('scheduled', 'queued');
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).x, 'none');
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'a', refreshToken: 'r', scopes: 'x', expiresAt: now - 60, refreshExpiresAt: null }, 'admin', now - 86400)).run();
  const g = stubHttp(['api.x.com'], () => { throw new Error('boom'); });
  const log = console.error; console.error = () => {};
  try { const res = await cron(env); assert.equal(res.status, 200); assert.equal((await res.json() as Record<string, unknown>).x, 'none'); } finally { g.restore(); console.error = log; }
});

test('daily: an unreadable stored X token marks X broken and mails admins once', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'a', refreshToken: 'r', scopes: 'x', expiresAt: now + 3600, refreshExpiresAt: null }, 'admin', now - 86400)).run();
  db.prepare(`UPDATE platform_connections SET refresh_token_enc = 'garbage' WHERE platform = 'x'`).run();
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).x, 'none');
  const row = db.prepare(`SELECT last_error, last_error_at FROM platform_connections WHERE platform = 'x'`).get() as { last_error: string; last_error_at: number | null };
  assert.ok(row.last_error_at);
  assert.match(row.last_error, /unreadable/);
  const xMails = () => mail.sent.filter((m) => /koptu/.test(m.subject) && /X/.test(m.subject)).length;
  assert.ok(xMails() >= 1);
  const first = xMails();
  await cron(env);
  assert.equal(xMails(), first, 'no second mail while still broken');
});
