import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCertificateStatus, bandYear, formatExpiry, kindLabelKey } from '../src/lib/certificates';
import { ui } from '../src/i18n/ui';

test('status is read and the newest year with certificates gets the band', async () => {
  const fake = (async () => new Response(JSON.stringify({ years: [{ year: 2026, count: 3, expiresAt: 1 }, { year: 2025, count: 1, expiresAt: 1 }] }))) as typeof fetch;
  const s = await fetchCertificateStatus('https://api', fake);
  assert.equal(bandYear(s), 2026);
});

test('any failure means no band, never a failed build', async () => {
  const cases: (typeof fetch)[] = [
    (async () => { throw new Error('offline'); }) as typeof fetch,
    (async () => new Response('nope', { status: 500 })) as typeof fetch,
    (async () => new Response('not json')) as typeof fetch,
    (async () => new Response(JSON.stringify({ years: 'x' }))) as typeof fetch,
  ];
  for (const f of cases) assert.equal(bandYear(await fetchCertificateStatus('https://api', f)), null);
});

test('expiry dates read naturally in both languages, in Istanbul time', () => {
  const ts = Date.UTC(2026, 10, 11, 22, 30) / 1000; // 01:30 on 12 Nov in Istanbul
  assert.equal(formatExpiry(ts, 'en'), '12 November 2026');
  assert.equal(formatExpiry(ts, 'tr'), '12 Kasım 2026');
});

test('kind labels exist for the four kinds only', () => {
  for (const k of ['participation', 'workshop', 'presentation', 'appreciation']) {
    const key = kindLabelKey(k)!;
    assert.ok(ui.en[key] && ui.tr[key], k);
  }
  assert.equal(kindLabelKey('toString'), null);
});

test('every cert.* key exists in both languages', () => {
  const en = Object.keys(ui.en).filter((k) => k.startsWith('cert.'));
  const tr = Object.keys(ui.tr).filter((k) => k.startsWith('cert.'));
  assert.ok(en.length > 0, 'the cert.* keys exist at all');
  assert.deepEqual(en.sort(), tr.sort());
});
