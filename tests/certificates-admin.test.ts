import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import * as list from '../functions/api/admin/certificates';
import * as one from '../functions/api/admin/certificates/[id]';
import { RETENTION_SECONDS } from '../functions/_lib/certificates';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org/api/admin/certificates';
const PDF = new TextEncoder().encode('%PDF-1.7\nfake');

function setup(role: { is_admin?: number; is_symposium?: number } = { is_symposium: 1 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, is_symposium, created_at, last_login) VALUES ('u1','g1','org@example.org',?,?,1,1)`)
    .run(role.is_admin ?? 0, role.is_symposium ?? 0);
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',?,1)`).run(4_000_000_000);
  const r2 = fakeR2();
  const env = { DB: d1(db), MAIL_ATTACHMENTS: r2, SYMPOSIUM_DEPLOY_HOOK: '' } as never;
  return { db, r2, env };
}

const cookie = { Cookie: 'rsg_session=s1' };
const call = (h: unknown, request: Request, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request, env, params });

function upload(env: unknown, headers: Record<string, string>, body: Uint8Array = PDF) {
  return call(list.onRequestPost, new Request(BASE, {
    method: 'POST',
    headers: { ...cookie, 'Content-Type': 'application/pdf', 'X-Cert-Year': '2026', 'X-Cert-Email': 'Ayse@Example.org', 'X-Cert-Name': encodeURIComponent('Ayşe Yılmaz'), 'X-Cert-Type': 'participation', ...headers },
    body,
  }), env);
}

test('an organiser uploads a certificate; it is stored under certificates/ with a 30-day expiry', async () => {
  const { env, r2, db } = setup();
  const res = await upload(env, {});
  assert.equal(res.status, 200);
  const body = await res.json() as { id: string; replaced: boolean };
  assert.equal(body.replaced, false);
  assert.ok(r2.store.has(`certificates/${body.id}.pdf`));
  const row = db.prepare('SELECT * FROM symposium_certificates').get() as Record<string, unknown>;
  assert.equal(row.email, 'ayse@example.org');
  assert.equal(row.name, 'Ayşe Yılmaz');
  assert.equal(Number(row.expires_at) - Number(row.uploaded_at), RETENTION_SECONDS);
});

test('re-uploading the same person and kind replaces the file and the row', async () => {
  const { env, r2, db } = setup();
  const first = await (await upload(env, {})).json() as { id: string };
  const second = await (await upload(env, { 'X-Cert-Name': encodeURIComponent('Ayşe Yılmaz Kaya') })).json() as { id: string; replaced: boolean };
  assert.equal(second.replaced, true);
  assert.ok(!r2.store.has(`certificates/${first.id}.pdf`), 'old object deleted');
  assert.ok(r2.store.has(`certificates/${second.id}.pdf`));
  const rows = db.prepare('SELECT name FROM symposium_certificates').all() as { name: string }[];
  assert.deepEqual(rows.map((r) => r.name), ['Ayşe Yılmaz Kaya']);
});

test('a second kind for the same person is a second certificate', async () => {
  const { env, db } = setup();
  await upload(env, {});
  await upload(env, { 'X-Cert-Type': 'workshop' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 2);
});

test('bad input is refused with a code', async () => {
  const { env } = setup();
  const cases: [Record<string, string>, Uint8Array | undefined, string][] = [
    [{ 'X-Cert-Year': '26' }, undefined, 'invalid_year'],
    [{ 'X-Cert-Email': 'nope' }, undefined, 'invalid_email'],
    [{ 'X-Cert-Name': '%' }, undefined, 'invalid_name'],
    [{ 'X-Cert-Name': '' }, undefined, 'invalid_name'],
    // A Turkish label is mapped by the panel; the API takes only the four.
    // (Headers are Latin-1, so the panel could not send "katılım" anyway.)
    [{ 'X-Cert-Type': 'katilim' }, undefined, 'invalid_kind'],
    [{}, new TextEncoder().encode('<html>'), 'not_pdf'],
    [{}, new Uint8Array(0), 'empty_file'],
    [{}, (() => { const b = new Uint8Array(10 * 1024 * 1024 + 1); b.set(PDF); return b; })(), 'too_large'],
  ];
  for (const [headers, body, code] of cases) {
    const res = await upload(env, headers, body);
    assert.equal(res.status, 400, code);
    assert.equal(((await res.json()) as { code: string }).code, code);
  }
});

test('only symposium organisers and admins may upload, list or delete', async () => {
  const { env } = setup({});
  assert.equal((await upload(env, {})).status, 403);
  assert.equal((await call(list.onRequestGet, new Request(`${BASE}?year=2026`, { headers: cookie }), env)).status, 403);
  const anon = await call(list.onRequestGet, new Request(`${BASE}?year=2026`), env);
  assert.equal(anon.status, 401);
});

test('a cross-site upload is refused before anything else', async () => {
  const { env } = setup();
  const res = await upload(env, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('list returns the year sorted by name, with total size', async () => {
  const { env } = setup();
  await upload(env, { 'X-Cert-Email': 'b@example.org', 'X-Cert-Name': 'Zeynep' });
  await upload(env, { 'X-Cert-Email': 'a@example.org', 'X-Cert-Name': 'Ali' });
  const res = await call(list.onRequestGet, new Request(`${BASE}?year=2026`, { headers: cookie }), env);
  const body = await res.json() as { certificates: { name: string }[]; totalBytes: number };
  assert.deepEqual(body.certificates.map((c) => c.name), ['Ali', 'Zeynep']);
  assert.equal(body.totalBytes, PDF.length * 2);
});

test('delete one removes the object and the row; unknown id is 404', async () => {
  const { env, r2, db } = setup();
  const { id } = await (await upload(env, {})).json() as { id: string };
  const del = (x: string) => call(one.onRequestDelete, new Request(`${BASE}/${x}`, { method: 'DELETE', headers: cookie }), env, { id: x });
  assert.equal((await del(id)).status, 200);
  assert.equal(r2.store.size, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 0);
  assert.equal((await del(id)).status, 404);
});

test('delete all for a year leaves other years alone', async () => {
  const { env, r2 } = setup();
  await upload(env, {});
  await upload(env, { 'X-Cert-Year': '2025' });
  const res = await call(list.onRequestDelete, new Request(`${BASE}?year=2026`, { method: 'DELETE', headers: cookie }), env);
  assert.equal(((await res.json()) as { deleted: number }).deleted, 1);
  assert.equal(r2.store.size, 1);
});
