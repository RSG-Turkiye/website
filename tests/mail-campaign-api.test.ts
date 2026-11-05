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

/** The panel names the campaign when the form is built; a retry reuses it. */
const post = (env: unknown, who: string, body: Record<string, unknown>) =>
  onRequestPost({ request: req('POST', who, { id: crypto.randomUUID(), ...body }), env } as never);

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
  for (const body of [{ table: 5, subject: 'S', body: 'B' }, { table: TABLE, subject: 'S', body: 'B', id: 'not-a-uuid' }]) {
    const res = await post(env, 'sender', body);
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as { code: string }).code, 'malformed_request');
  }
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

// --- review fixes -----------------------------------------------------------

test('sending the same campaign twice queues it once', async () => {
  const { db, env } = setup();
  const id = crypto.randomUUID();
  const first = await post(env, 'sender', { id, table: TABLE, subject: 'S', body: 'B' });
  assert.equal(first.status, 201);
  const again = await post(env, 'sender', { id, table: TABLE, subject: 'S', body: 'B' });
  assert.equal(again.status, 409);
  assert.equal(((await again.json()) as { code: string }).code, 'already_queued');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scheduled_emails').get() as { n: number }).n, 2);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM mail_campaigns').get() as { n: number }).n, 1);
});

test('a 500-person campaign is a handful of statements, not one per person', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_sender, created_at, last_login) VALUES ('sender','g1','s@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-sender','sender',4000000000,1)`).run();
  let statements = 0;
  const env = { DB: d1(db, () => { statements++; }) };
  const table = 'email\tad\n' + Array.from({ length: 500 }, (_, i) => `p${i}@example.org\tKişi ${i}`).join('\n');
  const res = await post(env, 'sender', { table, subject: 'S', body: 'Sayın [ad],\n\n' + 'Metin. '.repeat(300) });
  assert.equal(res.status, 201, await res.clone().text());
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scheduled_emails').get() as { n: number }).n, 500);
  const sample = db.prepare(`SELECT recipients, body FROM scheduled_emails WHERE recipients = '["p7@example.org"]'`).get() as { body: string };
  assert.match(sample.body, /^Sayın Kişi 7,/);
  // D1's free plan allows 50 queries per invocation; session and audit reads included.
  assert.ok(statements < 30, `${statements} statements`);
});

test('cancelling also drops a row whose claim has expired', async () => {
  const { db, env } = setup();
  const created = await (await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' })).json() as { id: string };
  // An invocation died mid-send an hour ago; the dispatcher would pick this up again.
  db.prepare(`UPDATE scheduled_emails SET claimed_at = ? WHERE recipients = ?`).run(Math.floor(Date.now() / 1000) - 3600, JSON.stringify(['ayse@uni.edu.tr']));
  const res = await onRequestDelete({ request: req('DELETE', 'sender', undefined, `/api/mail/campaigns/${created.id}`), env, params: { id: created.id } } as never);
  assert.deepEqual(await res.json(), { ok: true, dropped: 2 });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scheduled_emails').get() as { n: number }).n, 0);
});

test('the list gives the newest hold reason', async () => {
  const { db, env } = setup();
  await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' });
  db.prepare(`UPDATE scheduled_emails SET last_error = 'rate_limit_global', updated_at = 1 WHERE recipients = ?`).run(JSON.stringify(['ayse@uni.edu.tr']));
  db.prepare(`UPDATE scheduled_emails SET last_error = 'rate_limit_campaign_day', updated_at = 2 WHERE recipients = ?`).run(JSON.stringify(['mehmet@uni.edu.tr']));
  const { campaigns } = await (await onRequestGet({ request: req('GET', 'sender'), env } as never)).json() as { campaigns: { held: string }[] };
  assert.equal(campaigns[0].held, 'rate_limit_campaign_day');
});

test('a campaign row cannot be edited or deleted as ordinary scheduled mail', async () => {
  const { db, env } = setup();
  await post(env, 'sender', { table: TABLE, subject: 'S', body: 'B' });
  const row = db.prepare(`SELECT id FROM scheduled_emails LIMIT 1`).get() as { id: string };
  const { onRequestPatch, onRequestDelete: scheduledDelete } = await import('../functions/api/mail/scheduled');
  const patch = await onRequestPatch({ request: req('PATCH', 'sender', { id: row.id, to: 'x@example.org, y@example.org', subject: 'S', body: 'B', scheduled_at: Math.floor(Date.now() / 1000) + 86400 }, '/api/mail/scheduled'), env } as never);
  assert.notEqual(patch.status, 200);
  const del = await scheduledDelete({ request: req('DELETE', 'sender', { id: row.id }, '/api/mail/scheduled'), env } as never);
  assert.notEqual(del.status, 200);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM scheduled_emails').get() as { n: number }).n, 2);
});

test('the dispatcher\'s queries use indexes that skip the rows they do not want', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const plan = (sql: string) => (db.prepare('EXPLAIN QUERY PLAN ' + sql).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
  assert.match(plan(`SELECT COUNT(*) AS n FROM sent_emails WHERE campaign_id IS NOT NULL AND status = 'sent' AND sent_at > 1`), /idx_sent_emails_campaign_sent/);
  assert.match(plan(`SELECT id FROM scheduled_emails WHERE campaign_id IS NULL AND scheduled_at <= 1 AND (claimed_at IS NULL OR claimed_at <= 1) ORDER BY scheduled_at ASC LIMIT 60`), /idx_scheduled_emails_due_plain/);
  assert.match(plan(`SELECT id FROM scheduled_emails WHERE campaign_id IS NOT NULL AND scheduled_at <= 1 AND (claimed_at IS NULL OR claimed_at <= 1) ORDER BY scheduled_at ASC LIMIT 4`), /idx_scheduled_emails_due_campaign/);
});
