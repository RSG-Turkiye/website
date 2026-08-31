import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMime, encodeAttachmentBody } from '../functions/_lib/gmail';

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
  const originalBytes = new Uint8Array([1, 2, 3, 4]);
  const mime = decode(buildMime({
    ...base,
    attachments: [{
      filename: 'sponsorluk.pdf',
      contentType: 'application/pdf',
      base64Body: encodeAttachmentBody(originalBytes),
    }],
  }));
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  assert.match(mime, /^Content-Type: multipart\/mixed; boundary="/m);
  assert.match(mime, /^Content-Type: application\/pdf$/m);
  assert.match(mime, /^Content-Disposition: attachment; filename="sponsorluk\.pdf"$/m);
  assert.ok(mime.includes(`--${boundary}--`), 'missing closing boundary');
  assert.equal(mime.split(`--${boundary}`).length - 1, 3, 'expected two parts plus the closing boundary');

  // Byte-level round trip: the attachment part's base64 payload must decode
  // back to exactly the original bytes, not merely "look like base64".
  const attachmentPart = mime.split(`--${boundary}`)[2];
  const payloadB64 = attachmentPart.split('\r\n\r\n')[1].trim();
  assert.deepEqual(new Uint8Array(Buffer.from(payloadB64, 'base64')), originalBytes);
});

test('encodeAttachmentBody round-trips arbitrary bytes and wraps at 76 columns', () => {
  const original = new Uint8Array(200);
  for (let i = 0; i < original.length; i++) original[i] = i % 256;
  const encoded = encodeAttachmentBody(original);
  for (const line of encoded.split('\r\n')) {
    assert.ok(line.length <= 76, `line of ${line.length} chars exceeds 76`);
  }
  assert.deepEqual(
    new Uint8Array(Buffer.from(encoded.replace(/\r\n/g, ''), 'base64')),
    original,
  );
});

test('an attachment is encoded once and the same encoded string can be reused across recipients', () => {
  // This is the shape send.ts relies on: encode once, build MIME per
  // recipient with the same MimeAttachment object, and the payload must be
  // identical (and still valid) each time -- buildMime must not mutate or
  // re-derive it.
  const bytes = new Uint8Array([9, 8, 7, 6, 5]);
  const attachment = {
    filename: 'x.pdf',
    contentType: 'application/pdf',
    base64Body: encodeAttachmentBody(bytes),
  };
  const mimeA = decode(buildMime({ ...base, to: 'a@x.com', attachments: [attachment] }));
  const mimeB = decode(buildMime({ ...base, to: 'b@x.com', attachments: [attachment] }));
  const extractPayload = (mime: string) => {
    const boundary = mime.match(/boundary="([^"]+)"/)![1];
    const part = mime.split(`--${boundary}`)[2];
    return part.split('\r\n\r\n')[1].trim();
  };
  assert.equal(extractPayload(mimeA), extractPayload(mimeB));
  assert.deepEqual(new Uint8Array(Buffer.from(extractPayload(mimeA), 'base64')), bytes);
});

test('From header: an ASCII display name with quote and angle-bracket characters is quoted and escaped, not injected', () => {
  const evil = 'Foo" <evil@example.com>, Bar';
  const mime = decode(buildMime({ ...base, fromName: evil }));
  const fromLine = mime.split(/\r\n/).find(l => l.startsWith('From: '))!;
  // The display name must come out as a single backslash-escaped quoted
  // token immediately followed by the real address in angle brackets --
  // never as a bare, unescaped string that a header parser could read as
  // introducing a second address.
  assert.equal(fromLine, 'From: "Foo\\" <evil@example.com>, Bar" <turkey.rsg@gmail.com>');
  // Only one real address appears in the header: the sending account's own.
  assert.equal((fromLine.match(/@/g) ?? []).length, 2); // one inside the escaped quote, one for the real address
  assert.ok(fromLine.endsWith('<turkey.rsg@gmail.com>'), 'the real address must be the one outside the quotes');
});

test('From header: a non-ASCII display name is emitted as an atomic RFC 2047 encoded-word', () => {
  const evil = 'Fatîma" <evil@example.com>, Bar';
  const mime = decode(buildMime({ ...base, fromName: evil }));
  const fromLine = mime.split(/\r\n/).find(l => l.startsWith('From: '))!;
  assert.match(fromLine, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <turkey\.rsg@gmail\.com>$/);
  const encoded = fromLine.slice('From: =?UTF-8?B?'.length, fromLine.indexOf('?= <'));
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), evil);
});

test('produces base64url output with no padding or unsafe characters', () => {
  assert.doesNotMatch(buildMime(base), /[+\/=]/);
});
