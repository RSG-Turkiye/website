import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import * as lookup from '../functions/api/certificates/lookup';
import * as file from '../functions/api/certificates/[file]';
import * as status from '../functions/api/certificates/status';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const API = 'https://rsg-turkiye.iscbsc.org/api/certificates';
const NOW = Math.floor(Date.now() / 1000);
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare(`INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  add.run(ID1, 2026, 'ayse@example.org', 'Ayşe Yılmaz', 'participation', 9, 'u1', NOW, NOW + 1000);
  add.run(ID2, 2025, 'ayse@example.org', 'Ayşe Yılmaz', 'workshop', 9, 'u1', NOW, NOW + 1000);
  add.run(ID3, 2026, 'ayse@example.org', 'Ayşe Yılmaz', 'workshop', 9, 'u1', NOW - 5000, NOW - 1);
  const r2 = fakeR2();
  for (const id of [ID1, ID2, ID3]) r2.store.set(`certificates/${id}.pdf`, { body: new TextEncoder().encode('%PDF-1.7 x'), contentType: 'application/pdf' });
  return { db, r2, env: { DB: d1(db), MAIL_ATTACHMENTS: r2 } as never };
}
const call = (h: unknown, request: Request, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request, env, params });
const post = (env: unknown, body: string, ip = '203.0.113.1') =>
  call(lookup.onRequestPost, new Request(`${API}/lookup`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body,
  }), env);

test('lookup finds unexpired certificates, newest year first, whatever the case of the email', async () => {
  const { env } = setup();
  const res = await post(env, JSON.stringify({ email: ' AYSE@example.org ' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const { certificates } = await res.json() as { certificates: { id: string; year: number; url: string }[] };
  assert.deepEqual(certificates.map((c) => c.id), [ID1, ID2], 'expired one left out');
  assert.equal(certificates[0].url, `${API}/${ID1}.pdf`);
});

test('no match is an empty list, not an error', async () => {
  const { env } = setup();
  const res = await post(env, JSON.stringify({ email: 'nobody@example.org' }));
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { certificates: unknown[] }).certificates, []);
});

test('malformed body or email is 400', async () => {
  const { env } = setup();
  for (const body of ['not json', '{}', JSON.stringify({ email: 'x' }), JSON.stringify({ email: 5 })]) {
    const res = await post(env, body);
    assert.equal(res.status, 400, body);
    assert.equal(((await res.json()) as { code: string }).code, 'invalid_email');
  }
});

test('the 21st lookup from one IP in ten minutes is 429 and carries CORS', async () => {
  const { env } = setup();
  for (let i = 0; i < 20; i++) assert.equal((await post(env, JSON.stringify({ email: 'a@example.org' }))).status, 200);
  const res = await post(env, JSON.stringify({ email: 'a@example.org' }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await post(env, JSON.stringify({ email: 'a@example.org' }), '198.51.100.9')).status, 200);
});

test('OPTIONS preflight answers 204 with CORS', async () => {
  const res = await call(lookup.onRequestOptions, new Request(`${API}/lookup`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('file route serves an unexpired PDF inline, framable only by the symposium site', async () => {
  const { env } = setup();
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf`), env, { file: `${ID1}.pdf` });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.match(res.headers.get('Content-Disposition')!, /^inline; filename="RSG-2026-participation-Ayse-Yilmaz\.pdf"/);
  assert.equal(res.headers.get('Content-Security-Policy'), `frame-ancestors ${ORIGIN}`);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(await res.text(), '%PDF-1.7 x');
});

test('?download=1 makes it an attachment', async () => {
  const { env } = setup();
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf?download=1`), env, { file: `${ID1}.pdf` });
  assert.match(res.headers.get('Content-Disposition')!, /^attachment;/);
});

test('expired, unknown and malformed file names are 404 without touching R2', async () => {
  const { env } = setup();
  for (const name of [`${ID3}.pdf`, '44444444-4444-4444-8444-444444444444.pdf', 'x.pdf', `${ID1}.png`]) {
    const res = await call(file.onRequestGet, new Request(`${API}/${name}`), env, { file: name });
    assert.equal(res.status, 404, name);
  }
});

test('a row whose object is already gone (lifecycle rule) is 404, not 500', async () => {
  const { env, r2 } = setup();
  r2.store.delete(`certificates/${ID1}.pdf`);
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf`), env, { file: `${ID1}.pdf` });
  assert.equal(res.status, 404);
});

test('status lists unexpired years with counts and no personal data', async () => {
  const { env } = setup();
  const res = await call(status.onRequestGet, new Request(`${API}/status`), env);
  const text = await res.text();
  assert.ok(!text.includes('@') && !text.includes('Ayşe'));
  assert.deepEqual(JSON.parse(text), { years: [{ year: 2026, count: 1, expiresAt: NOW + 1000 }, { year: 2025, count: 1, expiresAt: NOW + 1000 }] });
});
