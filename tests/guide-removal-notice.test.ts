import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { stubMail } from './lib/social';
import * as suggestions from '../functions/api/guide/suggestions';
import { importRows, GUIDE_MAPPING } from '../functions/_lib/sheet-import';
import { upsertProfessor, type ProfessorRow } from '../functions/_lib/guide-db';
import { REMOVAL_NOTICE_DAILY } from '../functions/_lib/guide-removal-notice';
import { appendAudit } from '../functions/_lib/audit';

/** Removing someone from the guide on request, and the notice a person sends them in the same click. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
const NOW = Math.floor(Date.now() / 1000);
const PID = 'p_00000000000a';
const ADDRESS = 'deneme.hoca@ornek.edu.tr';

async function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  raw.prepare("INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('approver', 'g', 'approver@example.org', 0, 1, 1)").run();
  raw.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s-approver', 'approver', 4000000000, 1)").run();
  raw.prepare("INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('g2', 'approver', 'content.rehber.approve', NULL, NULL, 1)").run();
  const env = {
    DB: d1(raw) as unknown as D1Database, BLOG_IMAGES: fakeR2() as unknown as R2Bucket, ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    RSG_MAIL_FROM: 'turkey.rsg@gmail.com', GMAIL_REFRESH_TOKEN: 'r', GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's',
  };
  const prof: ProfessorRow = {
    id: PID, title: 'Doç. Dr.', name: 'Deneme Hoca', universityId: 'ornek', department: '', labId: null, profileUrl: '', openalexId: null,
    handTopics: [], hiddenTopics: [], openalexTopics: [], topicsRefreshedAt: null, topicsFailures: 0, programmeIds: [], source: '', checkedAt: NOW,
  };
  await upsertProfessor(env.DB, prof, 'approver', NOW);
  await importRows(env.DB, [['03.11.2026 10:00:00', 'Rehberden çıkarılma / Remove me from the guide', PID, 'beni çıkarın', '']], GUIDE_MAPPING, NOW);
  const rowId = (raw.prepare("SELECT id FROM intake_rows WHERE kind = 'removal'").get() as { id: number }).id;
  return { raw, env, rowId };
}

type Handler = (c: unknown) => Promise<Response>;
const apply = (env: unknown, body: unknown) => (suggestions.onRequestPost as Handler)({
  request: new Request(`${ORIGIN}/api/guide/suggestions`, {
    method: 'POST', headers: { Cookie: 'rsg_session=s-approver', Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  env,
});
const profCount = (raw: DatabaseSync) => (raw.prepare('SELECT COUNT(*) AS n FROM guide_professors').get() as { n: number }).n;
const notice = { to: ADDRESS, subject: 'Rehber kaydınız kaldırıldı', text: 'Sayın Doç. Dr. Deneme Hoca, kaydınızı kaldırdık.' };

test('one click removes the person and sends the notice the approver wrote', async () => {
  const { raw, env, rowId } = await setup();
  const mail = stubMail();
  try {
    const res = await apply(env, { id: rowId, action: 'applyRemoval', notice });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { notice: string }).notice, 'sent');
    assert.deepEqual(mail.sent, [{ to: ADDRESS, subject: notice.subject }]);
  } finally { mail.restore(); }
  assert.equal(profCount(raw), 0);
  const audit = raw.prepare("SELECT details FROM audit_log WHERE action = 'guide.removal.notice'").get() as { details: string };
  assert.deepEqual(JSON.parse(audit.details), { sent: true });
});

test('the address is used once and stored nowhere', async () => {
  const { raw, env, rowId } = await setup();
  const mail = stubMail();
  try { await apply(env, { id: rowId, action: 'applyRemoval', notice }); } finally { mail.restore(); }
  const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
  for (const t of tables) {
    const dump = JSON.stringify(raw.prepare(`SELECT * FROM "${t}"`).all());
    assert.ok(!dump.includes(ADDRESS), `${t} keeps the address`);
    assert.ok(!dump.includes('Deneme Hoca'), `${t} keeps the name`);
  }
});

test('a bad address is refused before anything is deleted or sent', async () => {
  const { raw, env, rowId } = await setup();
  const mail = stubMail();
  try {
    for (const to of ['', 'not-an-address', 'a@b.c, d@e.f']) {
      const res = await apply(env, { id: rowId, action: 'applyRemoval', notice: { ...notice, to } });
      assert.equal(res.status, 400, JSON.stringify(to));
    }
    assert.equal((await apply(env, { id: rowId, action: 'applyRemoval', notice: { ...notice, text: '' } })).status, 400, 'empty text');
    assert.equal(mail.sent.length, 0);
  } finally { mail.restore(); }
  assert.equal(profCount(raw), 1);
});

test('if Gmail fails the removal still stands, and the answer says the notice did not go', async () => {
  const { raw, env, rowId } = await setup();
  const mail = stubMail();
  mail.fail();
  try {
    const res = await apply(env, { id: rowId, action: 'applyRemoval', notice });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { notice: string }).notice, 'failed');
  } finally { mail.restore(); }
  assert.equal(profCount(raw), 0);
});

test('removing without a notice still works (no address found)', async () => {
  const { raw, env, rowId } = await setup();
  const mail = stubMail();
  try {
    const res = await apply(env, { id: rowId, action: 'applyRemoval' });
    assert.equal((await res.json() as { notice: string }).notice, 'none');
    assert.equal(mail.sent.length, 0);
  } finally { mail.restore(); }
  assert.equal(profCount(raw), 0);
});

test('at most REMOVAL_NOTICE_DAILY notices a day; past that nothing is deleted or sent', async () => {
  const { raw, env, rowId } = await setup();
  assert.equal(REMOVAL_NOTICE_DAILY, 20);
  for (let i = 0; i < REMOVAL_NOTICE_DAILY; i++) await appendAudit(env.DB, { userId: 'approver', action: 'guide.removal.notice', details: { sent: true } }, NOW - 60);
  const mail = stubMail();
  try {
    const res = await apply(env, { id: rowId, action: 'applyRemoval', notice });
    assert.equal(res.status, 429);
    assert.equal(mail.sent.length, 0);
  } finally { mail.restore(); }
  assert.equal(profCount(raw), 1);
});
