import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  normaliseEmail, isKind, certKey, isPdf, downloadFilename, corsHeaders,
  ipHash, rateLimited, CERT_FILE, LOOKUP_LIMIT, KINDS,
} from '../functions/_lib/certificates';
import { d1 } from './lib/d1-sqlite';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const enc = (s: string) => new TextEncoder().encode(s).buffer;

test('emails are trimmed and lowercased, including a Turkish dotted capital', () => {
  assert.equal(normaliseEmail('  Ayse@Example.ORG '), 'ayse@example.org');
  assert.equal(normaliseEmail('İLKER@example.org'), normaliseEmail('ilker@example.org'));
  assert.equal(normaliseEmail('İLKER@example.org'), 'ilker@example.org');
});

test('malformed emails are refused', () => {
  for (const bad of ['', 'no-at', 'a@b', 'a b@example.org', 'a@@example.org', `${'x'.repeat(250)}@example.org`]) {
    assert.equal(normaliseEmail(bad), null, bad);
  }
});

test('kinds are exactly the four', () => {
  assert.deepEqual([...KINDS], ['participation', 'workshop', 'presentation', 'appreciation']);
  assert.ok(isKind('workshop'));
  assert.ok(!isKind('katılım'));
  assert.ok(!isKind('toString'));
});

test('keys and file names', () => {
  const id = '3f1c2b4a-1111-4222-8333-444455556666';
  assert.equal(certKey(id), `certificates/${id}.pdf`);
  assert.ok(CERT_FILE.test(`${id}.pdf`));
  assert.ok(!CERT_FILE.test(`${id}.png`));
  assert.ok(!CERT_FILE.test(`../${id}.pdf`));
});

test('only bytes starting %PDF- are a PDF', () => {
  assert.ok(isPdf(enc('%PDF-1.7\n...')));
  assert.ok(!isPdf(enc('<html>')));
  assert.ok(!isPdf(new ArrayBuffer(0)));
});

test('download filename is ASCII and readable', () => {
  assert.equal(downloadFilename(2026, 'participation', 'Ayşe Çağlar Öztürk'), 'RSG-2026-participation-Ayse-Caglar-Ozturk.pdf');
  assert.equal(downloadFilename(2026, 'workshop', '   '), 'RSG-2026-workshop.pdf');
});

test('CORS allows the symposium origin and localhost only', () => {
  const req = (origin: string) => new Request('https://rsg-turkiye.iscbsc.org/api/certificates/lookup', { headers: { Origin: origin } });
  assert.equal(corsHeaders(req('https://symposium.rsg-turkiye.iscbsc.org')).get('Access-Control-Allow-Origin'), 'https://symposium.rsg-turkiye.iscbsc.org');
  assert.equal(corsHeaders(req('http://localhost:4321')).get('Access-Control-Allow-Origin'), 'http://localhost:4321');
  assert.equal(corsHeaders(req('https://evil.example')).get('Access-Control-Allow-Origin'), null);
  assert.equal(corsHeaders(req('https://symposium.rsg-turkiye.iscbsc.org.evil.example')).get('Access-Control-Allow-Origin'), null);
});

test('ipHash is a stable hex digest and never the raw IP', async () => {
  const r = new Request('https://x/', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  const h = await ipHash(r);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await ipHash(r));
  assert.ok(!h.includes('203'));
});

test(`the ${LOOKUP_LIMIT + 1}th lookup inside ten minutes is limited, and the window slides`, async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const D1 = d1(db) as unknown as D1Database;
  const now = 1_800_000_000;
  for (let i = 0; i < LOOKUP_LIMIT; i++) assert.equal(await rateLimited(D1, 'h', now + i), false);
  assert.equal(await rateLimited(D1, 'h', now + LOOKUP_LIMIT), true);
  assert.equal(await rateLimited(D1, 'other', now + LOOKUP_LIMIT), false, 'per hash');
  assert.equal(await rateLimited(D1, 'h', now + 601 + LOOKUP_LIMIT), false, 'after the window');
});
