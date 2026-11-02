import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubHttp } from './lib/http';
import { getGoogleToken, clearGoogleTokenCache } from '../functions/_lib/google-sa';
import { importRows, readSheetRows, maskEmails, GUIDE_MAPPING } from '../functions/_lib/sheet-import';

/** Google Form responses → the panel's intake queue. Every name and address here is invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  return { raw, db: d1(raw) as unknown as D1Database };
}
const rows = (raw: DatabaseSync) => raw.prepare('SELECT row_key, record_id, kind, payload, status, count FROM intake_rows ORDER BY id').all() as { row_key: string; record_id: string; kind: string; payload: string; status: string; count: number }[];

// Timestamp, Kind, Record id, What should change, Source link
const R1 = ['01.11.2026 10:00:00', 'Düzeltme', 'p_000000000001', 'Lab sitesi değişti', 'https://lab.example.org'];
const R2 = ['01.11.2026 10:05:00', 'Listeden çıkmak istiyorum', 'p_000000000002', 'Lütfen beni çıkarın', ''];
const R3 = ['01.11.2026 10:09:00', 'Program ekle', '', 'Yeni bir YL programı açıldı', 'https://example.edu.tr/ilan'];

test('importing the same rows twice adds them once', async () => {
  const { raw, db } = setup();
  assert.deepEqual(await importRows(db, [R1, R2, R3], GUIDE_MAPPING, NOW), { added: 3, removals: 1 });
  assert.deepEqual(await importRows(db, [R1, R2, R3], GUIDE_MAPPING, NOW + 60), { added: 0, removals: 0 });
  assert.equal(rows(raw).length, 3);
  assert.deepEqual(rows(raw).map((r) => r.kind), ['correction', 'removal', 'programme']);
});

test('deleting a middle Sheet row between imports adds nothing', async () => {
  const { raw, db } = setup();
  await importRows(db, [R1, R2, R3], GUIDE_MAPPING, NOW);
  assert.deepEqual(await importRows(db, [R1, R3], GUIDE_MAPPING, NOW + 60), { added: 0, removals: 0 });
  assert.equal(rows(raw).length, 3);
});

test('an e-mail address in free text is masked', async () => {
  const { raw, db } = setup();
  await importRows(db, [['01.11.2026 11:00:00', 'Düzeltme', 'p_000000000001', 'Bana a.b@example.org adresinden yazın', '']], GUIDE_MAPPING, NOW);
  const payload = JSON.parse(rows(raw)[0].payload);
  assert.equal(payload.text, 'Bana [e-posta] adresinden yazın');
  assert.equal(maskEmails('x hoca@uni.edu.tr y'), 'x [e-posta] y');
});

test('identical suggestions collapse with count 2', async () => {
  const { raw, db } = setup();
  await importRows(db, [R1, ['02.11.2026 09:00:00', 'Düzeltme', 'p_000000000001', '  lab sitesi DEĞİŞTİ ', 'https://other.example.org']], GUIDE_MAPPING, NOW);
  const r = rows(raw);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 2);
});

test('a row with no text and no record is ignored', async () => {
  const { raw, db } = setup();
  assert.deepEqual(await importRows(db, [['01.11.2026 12:00:00', 'Düzeltme', '', '', '']], GUIDE_MAPPING, NOW), { added: 0, removals: 0 });
  assert.equal(rows(raw).length, 0);
});

test('a record id that is not an id is dropped, never stored as text', async () => {
  const { raw, db } = setup();
  await importRows(db, [['01.11.2026 12:00:00', 'Düzeltme', 'Örnek Hoca A', 'x', '']], GUIDE_MAPPING, NOW);
  assert.equal(rows(raw)[0].record_id, '');
});

test('readSheetRows reads values without the header row', async () => {
  const http = stubHttp(['sheets.googleapis.com'], (c) => {
    assert.match(c.url.pathname, /\/v4\/spreadsheets\/SHEET\/values\//);
    assert.equal(c.headers.get('Authorization'), 'Bearer tok');
    return Response.json({ values: [['Timestamp', 'Kind'], R1, R2] });
  });
  try {
    assert.deepEqual(await readSheetRows('tok', 'SHEET', 'A:E'), [R1, R2]);
  } finally { http.restore(); }
});

test('getGoogleToken signs an RS256 JWT for the service account and caches the token', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey('pkcs8', pair.privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`;
  const key = JSON.stringify({ client_email: 'sa@example.iam.gserviceaccount.com', private_key: pem, token_uri: 'https://oauth2.googleapis.com/token' });
  let calls = 0;
  let assertion = '';
  clearGoogleTokenCache();
  const http = stubHttp(['oauth2.googleapis.com'], (c) => {
    calls++;
    assertion = (c.body as URLSearchParams).get('assertion')!;
    return Response.json({ access_token: 'ya29.x', expires_in: 3600 });
  });
  try {
    assert.equal(await getGoogleToken(key, ['https://www.googleapis.com/auth/spreadsheets.readonly'], NOW), 'ya29.x');
    assert.equal(await getGoogleToken(key, ['https://www.googleapis.com/auth/spreadsheets.readonly'], NOW + 60), 'ya29.x');
    assert.equal(calls, 1, 'cached until near expiry');
  } finally { http.restore(); }
  const [h, p, s] = assertion.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.equal(claims.iss, 'sa@example.iam.gserviceaccount.com');
  assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets.readonly');
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', pair.publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${p}`));
  assert.ok(valid, 'the signature verifies with the public key');
});
