import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMime } from '../functions/_lib/gmail';

function decode(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

const base = {
  fromAddress: 'turkey.rsg@gmail.com',
  fromName: 'RSG Türkiye (Emre Çevik)',
  to: 'hoca@uni.edu.tr',
  replyTo: 'emre@example.com',
  subject: 'RSG Türkiye sempozyum daveti',
  body: 'Sayın Hocam,\n\nSizi davet etmek isteriz.\n',
  attachments: [],
};

test('emits the required headers with a single recipient', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^To: hoca@uni\.edu\.tr$/m);
  assert.match(mime, /^Reply-To: emre@example\.com$/m);
  assert.match(mime, /^MIME-Version: 1\.0$/m);
  assert.doesNotMatch(mime, /^(Cc|Bcc):/m);
});

test('RFC 2047 encodes non-ASCII display name and subject, never the address', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <turkey\.rsg@gmail\.com>$/m);
  assert.match(mime, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);

  const subjectLine = mime.split(/\r\n/).find(l => l.startsWith('Subject: '))!;
  const encoded = subjectLine.slice('Subject: =?UTF-8?B?'.length, -'?='.length);
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'RSG Türkiye sempozyum daveti');
});

test('leaves a pure-ASCII subject unencoded', () => {
  const mime = decode(buildMime({ ...base, subject: 'Invitation' }));
  assert.match(mime, /^Subject: Invitation$/m);
});

test('round-trips a UTF-8 body through base64 without corruption', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^Content-Transfer-Encoding: base64$/m);
  const payload = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), base.body);
});

test('wraps base64 payload lines at 76 characters', () => {
  const mime = decode(buildMime({ ...base, body: 'x'.repeat(5000) }));
  const payload = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  for (const line of payload.split('\r\n')) {
    assert.ok(line.length <= 76, `line of ${line.length} chars exceeds 76`);
  }
});

test('builds multipart/mixed with an attachment part', () => {
  const mime = decode(buildMime({
    ...base,
    attachments: [{
      filename: 'sponsorluk.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
    }],
  }));
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  assert.match(mime, /^Content-Type: multipart\/mixed; boundary="/m);
  assert.match(mime, /^Content-Type: application\/pdf$/m);
  assert.match(mime, /^Content-Disposition: attachment; filename="sponsorluk\.pdf"$/m);
  assert.ok(mime.includes(`--${boundary}--`), 'missing closing boundary');
  assert.equal(mime.split(`--${boundary}`).length - 1, 3, 'expected two parts plus the closing boundary');
});

test('produces base64url output with no padding or unsafe characters', () => {
  assert.doesNotMatch(buildMime(base), /[+\/=]/);
});
