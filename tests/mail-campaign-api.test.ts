import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestGet, onRequestPost } from '../functions/api/mail/campaigns';
import { onRequestDelete } from '../functions/api/mail/campaigns/[id]';
import { onRequestGet as scheduledGet } from '../functions/api/mail/scheduled';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
const TABLE = 'e-posta\tunvan\tad\nayse@uni.edu.tr\tProf. Dr.\tAyşe Yılmaz\nmehmet@uni.edu.tr\tDoç. Dr.\tMehmet Kaya\nbad\tDr.\tX\n';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const user = db.prepare(`INSERT INTO users (id, google_id, email, is_sender, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, ?, 1, 1)`);
  user.run('sender', 'g1', 'sender@example.org', 1, 0);
  user.run('admin', 'g2', 'admin@example.org', 0, 1);
  user.run('member', 'g3', 'member@example.org', 0, 0);
  user.run('other', 'g4', 'other@example.org', 1, 0);
  const session = db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`);
  for (const u of ['sender', 'admin', 'member', 'other']) session.run('s-' + u, u);
  return { db, env: { DB: d1(db) } };
}

const req = (method: string, who: string, body?: unknown, path = '/api/mail/campaigns') =>
  new Request(ORIGIN + path, {
    method,
    headers: { Cookie: `rsg_session=s-${who}`, 'Content-Type': 'application/json', Origin: ORIGIN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const post = (env: unknown, who: string, body: unknown) =>
  onRequestPost({ request: req('POST', who, body), env } as never);

test('a sender queues one personal letter per valid row, and is told which rows were refused', async () => {
  const { db, env } = setup();
  const res = await post(env, 'sender', { table: TABLE, subject: 'Rehber', body: 'Sayın [unvan] [ad],\n\nMetin.' });
  assert.equal(res.status, 201, await res.clone().text());
  const out = await res.json() as { id: string; total: number; refused: { line: number }[] };
  assert.equal(out.total, 2);
  assert.deepEqual(out.refused.map((r) => r.line), [4]);

  const rows = db.prepare(`SELECT recipients, subject, body, campaign_id FROM scheduled_emails ORDER BY recipients`).all() as Record<string, string>[];
  assert.equal(rows.length, 2);
  assert.equal(rows[0].recipients, JSON.stringify(['ayse@uni.edu.tr']));
  assert.equal(rows[0].body, 'Sayın Prof. Dr. Ayşe Yılmaz,\n\nMetin.');
  assert.ok(rows.every((r) => r.campaign_id === out.id));

  const camp = db.prepare(`SELECT sender_user_id, subject, total FROM mail_campaigns WHERE id = ?`).get(out.id) as Record<string, unknown>;
  assert.deepEqual({ ...camp }, { sender_user_id: 'sender', subject: 'Rehber', total: 2 });
});

test('creating a campaign is logged with its size and no addresses', async () => {
  const { db, env } = setup();
  await post(env, 'sender', { table: TABLE, subject: 'S', body: 'Sayın [ad]' });
  const row = db.prepare(`SELECT action, details FROM audit_log WHERE action = 'mail.campaign.create'`).get() as { details: string };
  assert.ok(row, 'audit row written');
  assert.doesNotMatch(row.details, /@/);
  assert.match(row.details, /"recipients":2/);
});

test('an admin may start a campaign; a member may not', async () => {
  const { env } = setup();
  assert.equal((await post(env, 'admin', { table: TABLE, subject: 'S', body: 'B' })).status, 201);
  assert.equal((await post(env, 'member', { table: TABLE, subject: 'S', body: 'B' })).status, 403);
});

test('a campaign that cannot go out queues nothing', async () => {
  const { db, env } = setup();
  const res = await post(env, 'sender', { table: TABLE, subject: 'S', body: 'Sayın [soyad]' });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'Invalid campaign', code: 'unknown_placeholder', unknown: ['soyad'] });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scheduled_emails').get() as { n: number }).n, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mail_campaigns').get() as { n: number }).n, 0);
});

test('a malformed body is a coded 400', async () => {
  const { env } = setup();
  const res = await post(env, 'sender', { table: 5, subject: 'S', body: 'B' });
  assert.equal(res.status, 400);
  assert.equal(((await res.json()) as { code: string }).code, 'malformed_request');
});

test('the list shows sent, failed and waiting counts per campaign', async () => {
  const { db, env } = setup();
  const created = await (await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' })).json() as { id: string };
  // One of the two has gone out.
  db.prepare(`DELETE FROM scheduled_emails WHERE recipients = ?`).run(JSON.stringify(['ayse@uni.edu.tr']));
  db.prepare(`INSERT INTO sent_emails (id, sender_user_id, recipient_email, subject, body_snapshot, status, sent_at, campaign_id)
              VALUES ('e1', 'sender', 'ayse@uni.edu.tr', 'S', 'B', 'sent', 1, ?)`).run(created.id);

  const res = await onRequestGet({ request: req('GET', 'sender'), env } as never);
  const { campaigns } = await res.json() as { campaigns: Record<string, unknown>[] };
  assert.equal(campaigns.length, 1);
  assert.equal(campaigns[0].total, 2);
  assert.equal(campaigns[0].sent, 1);
  assert.equal(campaigns[0].failed, 0);
  assert.equal(campaigns[0].waiting, 1);
});

test('a sender sees only their own campaigns; an admin sees everyone\'s', async () => {
  const { env } = setup();
  await post(env, 'sender', { table: TABLE, subject: 'Mine', body: 'B' });
  await post(env, 'other', { table: TABLE, subject: 'Theirs', body: 'B' });
  const list = async (who: string) =>
    ((await (await onRequestGet({ request: req('GET', who), env } as never)).json()) as { campaigns: { subject: string }[] })
      .campaigns.map((c) => c.subject).sort();
  assert.deepEqual(await list('sender'), ['Mine']);
  assert.deepEqual(await list('admin'), ['Mine', 'Theirs']);
});

test('cancelling drops what has not gone out, keeps what is in flight, and is logged', async () => {
  const { db, env } = setup();
  const created = await (await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' })).json() as { id: string };
  // One row is being sent right now.
  db.prepare(`UPDATE scheduled_emails SET claimed_at = ? WHERE recipients = ?`).run(Math.floor(Date.now() / 1000), JSON.stringify(['ayse@uni.edu.tr']));

  const res = await onRequestDelete({ request: req('DELETE', 'sender', undefined, `/api/mail/campaigns/${created.id}`), env, params: { id: created.id } } as never);
  assert.equal(res.status, 200, await res.clone().text());
  assert.deepEqual(await res.json(), { ok: true, dropped: 1 });
  const left = db.prepare(`SELECT recipients FROM scheduled_emails`).all() as { recipients: string }[];
  assert.deepEqual(left.map((r) => r.recipients), [JSON.stringify(['ayse@uni.edu.tr'])]);
  assert.ok((db.prepare(`SELECT cancelled_at FROM mail_campaigns WHERE id = ?`).get(created.id) as { cancelled_at: number }).cancelled_at > 0);
  assert.ok(db.prepare(`SELECT 1 FROM audit_log WHERE action = 'mail.campaign.cancel'`).get());
});

test('only the campaign\'s sender or an admin may cancel it', async () => {
  const { env } = setup();
  const created = await (await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' })).json() as { id: string };
  const cancel = (who: string) => onRequestDelete({ request: req('DELETE', who, undefined, `/api/mail/campaigns/${created.id}`), env, params: { id: created.id } } as never);
  assert.equal((await cancel('other')).status, 404);
  assert.equal((await cancel('admin')).status, 200);
});

test('campaign rows stay out of the ordinary scheduled list', async () => {
  const { env } = setup();
  await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' });
  const res = await scheduledGet({ request: req('GET', 'sender', undefined, '/api/mail/scheduled'), env } as never);
  const { scheduled } = await res.json() as { scheduled: unknown[] };
  assert.equal(scheduled.length, 0);
});
