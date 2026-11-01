import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { stubHttp } from './lib/http';
import * as suggestions from '../functions/api/guide/suggestions';
import { onRequestPost as importPost } from '../functions/api/admin/guide/import';
import { importRows, pruneIntake, GUIDE_MAPPING, INTAKE_RETENTION_DAYS } from '../functions/_lib/sheet-import';
import { upsertProfessor, type ProfessorRow } from '../functions/_lib/guide-db';
import { publishGuideIndex, INDEX_KEY } from '../functions/_lib/guide-index';
import { clearGoogleTokenCache } from '../functions/_lib/google-sa';

/** The guide's suggestion queue in the panel, and the nightly import. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
const NOW = Math.floor(Date.now() / 1000);

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const add = raw.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1)');
  const grant = raw.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  const session = raw.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, admin] of [['admin', 1], ['editor', 0], ['approver', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, admin);
    session.run(`s-${id}`, id);
  }
  grant.run('g1', 'editor', 'content.rehber.edit');
  grant.run('g2', 'approver', 'content.rehber.approve');
  const r2 = fakeR2();
  const env = {
    DB: d1(raw) as unknown as D1Database, BLOG_IMAGES: r2 as unknown as R2Bucket, ASSETS: { fetch: async () => new Response('', { status: 404 }) },
    SYMPOSIUM_ARCHIVE_SECRET: 's3cret', GOOGLE_SA_KEY: '', GUIDE_SHEET_ID: 'SHEET',
  };
  return { raw, r2, env, db: env.DB };
}

const prof = (id: string, name: string): ProfessorRow => ({
  id, title: 'Doç. Dr.', name, universityId: 'ornek', department: '', labId: null, profileUrl: '', openalexId: null,
  handTopics: [], hiddenTopics: [], openalexTopics: [], topicsRefreshedAt: null, topicsFailures: 0, programmeIds: [], source: '', checkedAt: NOW,
});

type Handler = (c: unknown) => Promise<Response>;
const call = (h: unknown, env: unknown, as: string, method: string, body?: unknown) => (h as Handler)({
  request: new Request(`${ORIGIN}/api/guide/suggestions`, {
    method, headers: { Cookie: `rsg_session=s-${as}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  env,
});

const R = (t: string, kind: string, id: string, text: string) => [t, kind, id, text, ''];

test('removal rows sort first, and editors may read the queue', async () => {
  const { env, db } = setup();
  await importRows(db, [R('01.11.2026 10:00:00', 'Düzeltme', 'p_000000000001', 'a'), R('01.11.2026 11:00:00', 'Listeden çıkmak istiyorum', 'p_000000000002', 'b')], GUIDE_MAPPING, NOW);
  const res = await call(suggestions.onRequestGet, env, 'editor', 'GET');
  assert.equal(res.status, 200);
  const body = await res.json() as { rows: { kind: string }[] };
  assert.deepEqual(body.rows.map((r) => r.kind), ['removal', 'correction']);
});

test('only an approver acts on a suggestion', async () => {
  const { env, db, raw } = setup();
  await importRows(db, [R('01.11.2026 10:00:00', 'Düzeltme', 'p_000000000001', 'a')], GUIDE_MAPPING, NOW);
  const id = (raw.prepare('SELECT id FROM intake_rows').get() as { id: number }).id;
  assert.equal((await call(suggestions.onRequestPost, env, 'editor', 'POST', { id, action: 'done' })).status, 403);
  assert.equal((await call(suggestions.onRequestPost, env, 'approver', 'POST', { id, action: 'done' })).status, 200);
  assert.equal((raw.prepare('SELECT status FROM intake_rows WHERE id = ?').get(id) as { status: string }).status, 'done');
});

test('discard blanks the payload', async () => {
  const { env, db, raw } = setup();
  await importRows(db, [R('01.11.2026 10:00:00', 'Düzeltme', '', 'spam spam')], GUIDE_MAPPING, NOW);
  const id = (raw.prepare('SELECT id FROM intake_rows').get() as { id: number }).id;
  await call(suggestions.onRequestPost, env, 'approver', 'POST', { id, action: 'discard' });
  const row = raw.prepare('SELECT status, payload FROM intake_rows WHERE id = ?').get(id) as { status: string; payload: string };
  assert.deepEqual({ ...row }, { status: 'discarded', payload: '{}' });
});

test('applyRemoval deletes the professor, republishes and leaves no row with that record_id', async () => {
  const { env, db, raw, r2 } = setup();
  await upsertProfessor(db, prof('p_000000000002', 'Örnek Hoca B'), 'admin', NOW);
  await publishGuideIndex(env as never, NOW);
  await importRows(db, [
    R('01.11.2026 10:00:00', 'Düzeltme', 'p_000000000002', 'Örnek Hoca B labı değişti'),
    R('01.11.2026 11:00:00', 'Listeden çıkmak istiyorum', 'p_000000000002', 'Ben Örnek Hoca B, çıkarın'),
  ], GUIDE_MAPPING, NOW);
  const id = (raw.prepare("SELECT id FROM intake_rows WHERE kind = 'removal'").get() as { id: number }).id;
  const res = await call(suggestions.onRequestPost, env, 'approver', 'POST', { id, action: 'applyRemoval' });
  assert.equal(res.status, 200);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM guide_professors').get() as { n: number }).n, 0);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM intake_rows WHERE record_id = 'p_000000000002'").get() as { n: number }).n, 0);
  assert.ok(!new TextDecoder().decode(r2.store.get(INDEX_KEY)!.body).includes('Örnek Hoca B'));
  const audit = JSON.stringify(raw.prepare('SELECT details, target_id FROM audit_log').all());
  assert.ok(!audit.includes('Örnek'), 'no name in the audit log');
});

test('applyRemoval refuses a row that is not a removal of a professor', async () => {
  const { env, db, raw } = setup();
  await importRows(db, [R('01.11.2026 10:00:00', 'Düzeltme', 'p_000000000001', 'x')], GUIDE_MAPPING, NOW);
  const id = (raw.prepare('SELECT id FROM intake_rows').get() as { id: number }).id;
  assert.equal((await call(suggestions.onRequestPost, env, 'approver', 'POST', { id, action: 'applyRemoval' })).status, 400);
});

test('prune deletes handled rows after 90 days', async () => {
  const { db, raw } = setup();
  assert.equal(INTAKE_RETENTION_DAYS, 90);
  await importRows(db, [R('01.11.2026 10:00:00', 'Düzeltme', '', 'a'), R('01.11.2026 10:01:00', 'Düzeltme', '', 'b')], GUIDE_MAPPING, NOW);
  raw.prepare("UPDATE intake_rows SET status = 'done', handled_at = ? WHERE payload LIKE '%\"a\"%'").run(NOW - 91 * 86400);
  assert.equal(await pruneIntake(db, NOW), 1);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM intake_rows').get() as { n: number }).n, 1, 'the open one stays');
});

test('import endpoint 403 without secret', async () => {
  const { env } = setup();
  const res = await (importPost as Handler)({ request: new Request(`${ORIGIN}/api/admin/guide/import`, { method: 'POST' }), env });
  assert.equal(res.status, 403);
});

test('import endpoint without a key reports not_configured and changes nothing', async () => {
  const { env, raw } = setup();
  const res = await (importPost as Handler)({ request: new Request(`${ORIGIN}/api/admin/guide/import`, { method: 'POST', headers: { 'X-Archive-Secret': 's3cret' } }), env });
  assert.deepEqual(await res.json(), { sheet: 'not_configured', added: 0 });
  assert.equal((raw.prepare('SELECT result FROM intake_state').get() as { result: string }).result, 'not_configured');
});

test('import endpoint reads the Sheet, queues rows, and reports no_access on a 403', async () => {
  const { env, raw } = setup();
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  env.GOOGLE_SA_KEY = JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----` });
  clearGoogleTokenCache();
  let sheetStatus = 200;
  const http = stubHttp(['oauth2.googleapis.com', 'sheets.googleapis.com'], (c) => {
    if (c.url.host === 'oauth2.googleapis.com') return Response.json({ access_token: 't', expires_in: 3600 });
    if (sheetStatus !== 200) return new Response('no', { status: sheetStatus });
    return Response.json({ values: [['h'], R('01.11.2026 10:00:00', 'Listeden çıkmak istiyorum', 'p_000000000009', 'x')] });
  });
  try {
    const post = () => (importPost as Handler)({ request: new Request(`${ORIGIN}/api/admin/guide/import`, { method: 'POST', headers: { 'X-Archive-Secret': 's3cret' } }), env });
    assert.deepEqual(await (await post()).json(), { sheet: 'ok', added: 1 });
    sheetStatus = 403;
    assert.deepEqual(await (await post()).json(), { sheet: 'no_access', added: 0 });
  } finally { http.restore(); }
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.import'").get() as { n: number }).n, 2);
});
