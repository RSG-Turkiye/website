import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubHttp } from './lib/http';
import * as importNow from '../functions/api/guide/import';
import { clearGoogleTokenCache } from '../functions/_lib/google-sa';

/** The panel's "Import now" button: the nightly Sheet import, run by a Rehber approver. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const add = raw.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, 0, 1, 1)');
  const session = raw.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const id of ['editor', 'approver', 'nobody']) { add.run(id, `g-${id}`, `${id}@example.org`); session.run(`s-${id}`, id); }
  raw.prepare("INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('g1', 'editor', 'content.rehber.edit', NULL, NULL, 1)").run();
  raw.prepare("INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('g2', 'approver', 'content.rehber.approve', NULL, NULL, 1)").run();
  const env = { DB: d1(raw) as unknown as D1Database, SYMPOSIUM_ARCHIVE_SECRET: 's3cret', GOOGLE_SA_KEY: '', GUIDE_SHEET_ID: 'SHEET' };
  return { raw, env };
}

type Handler = (c: unknown) => Promise<Response>;
const post = (env: unknown, as: string | null, origin = ORIGIN) => (importNow.onRequestPost as Handler)({
  request: new Request(`${ORIGIN}/api/guide/import`, {
    method: 'POST', headers: { ...(as ? { Cookie: `rsg_session=s-${as}` } : {}), Origin: origin },
  }),
  env,
});

test('import now: only a Rehber approver may run it', async () => {
  const { env, raw } = setup();
  assert.equal((await post(env, null)).status, 401);
  assert.equal((await post(env, 'nobody')).status, 403);
  assert.equal((await post(env, 'editor')).status, 403, 'an editor reads the queue but does not run the import');
  assert.equal((await post(env, 'approver', 'https://evil.example')).status, 403, 'CSRF: other origins are refused');
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.import'").get() as { n: number }).n, 0);
});

test('import now: an approver runs the same import, and the audit row names them', async () => {
  const { env, raw } = setup();
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  env.GOOGLE_SA_KEY = JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pkcs8}\n-----END PRIVATE KEY-----` });
  clearGoogleTokenCache();
  const http = stubHttp(['oauth2.googleapis.com', 'sheets.googleapis.com'], (c) => c.url.host === 'oauth2.googleapis.com'
    ? Response.json({ access_token: 't', expires_in: 3600 })
    : Response.json({ values: [['h'], ['03.11.2026 10:00:00', 'Düzeltme / Correction', 'p_000000000009', 'test', '']] }));
  try {
    const res = await post(env, 'approver');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { sheet: 'ok', added: 1 });
  } finally { http.restore(); }
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM intake_rows').get() as { n: number }).n, 1);
  assert.equal((raw.prepare('SELECT result FROM intake_state').get() as { result: string }).result, 'ok');
  const audit = raw.prepare("SELECT user_id FROM audit_log WHERE action = 'guide.import'").get() as { user_id: string };
  assert.equal(audit.user_id, 'approver');
});
