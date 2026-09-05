import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMime,
  mimeLines,
  mimeChunks,
  mimeByteLength,
  encodedLength,
  encodeAttachmentBody,
  type MimeMessage,
} from '../functions/_lib/gmail';

/**
 * The streaming sender and buildMime must produce the same message. Not
 * similar -- identical, byte for byte. Two functions that each know the
 * message format is exactly the drift this repo keeps paying for, so the
 * format lives in mimeLines and these tests prove both readers of it agree.
 */

const base = (attachments: MimeMessage['attachments'] = []): MimeMessage => ({
  fromName: 'RSG-Türkiye',
  fromAddress: 'turkey.rsg@gmail.com',
  to: 'professor@example.org',
  replyTo: 'turkey.rsg@gmail.com',
  subject: 'Sponsorluk Daveti',
  body: { text: 'Merhaba,\n\nEkte dosya var.\n', html: '<p>Merhaba</p>' },
  attachments,
});

/** R2 hands over chunks of whatever size it likes; so does this. */
function chunkedStream(bytes: Uint8Array, chunk: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
}

async function collect(
  lines: ReturnType<typeof mimeLines>,
  bytesFor: Uint8Array,
  chunk: number,
): Promise<Uint8Array> {
  const pieces: Uint8Array[] = [];
  for await (const piece of mimeChunks(lines, async () => chunkedStream(bytesFor, chunk))) {
    pieces.push(piece);
  }
  const total = pieces.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of pieces) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const decodeMime = (msg: MimeMessage): Uint8Array =>
  new Uint8Array(Buffer.from(buildMime(msg), 'base64url'));

/**
 * Boundaries come from crypto.randomUUID, so two calls to mimeLines produce
 * two different messages and nothing can be compared. Fixing them is what
 * lets these tests check the thing that matters: that buildMime and the
 * streaming encoder, reading the same rules, emit the same bytes.
 */
async function withFixedBoundaries<T>(run: () => Promise<T>): Promise<T> {
  const real = crypto.randomUUID;
  // One constant, not a counter: buildMime calls mimeLines again internally,
  // and a counter would hand the second call a different message. The two
  // boundaries stay distinct regardless, because their prefixes differ.
  (crypto as { randomUUID: () => string }).randomUUID = () =>
    '00000000-0000-4000-8000-000000000000';
  try {
    return await run();
  } finally {
    (crypto as { randomUUID: typeof real }).randomUUID = real;
  }
}

const bytes = (n: number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 8)) & 0xff);

// --- the two paths agree ----------------------------------------------------

test('streamed and assembled messages are byte-identical, with no attachment', async () => {
  await withFixedBoundaries(async () => {
    const msg = base();
    const streamed = await collect(mimeLines(msg), new Uint8Array(0), 1);
    assert.deepEqual(streamed, decodeMime(msg));
  });
});

test('streamed and assembled messages are byte-identical, with an attachment', async () => {
  await withFixedBoundaries(async () => {
    const raw = bytes(200_000);
    const msg = base([
      { filename: 'Sponsorluk Dosyası.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) },
    ]);
    const streamed = await collect(mimeLines(msg), raw, 64 * 1024);
    assert.deepEqual(streamed, decodeMime(msg));
  });
});

test('a nine-megabyte attachment survives the round trip unchanged', async () => {
  // The size that started all of this. The point is not the message but the
  // payload: what comes back out of the base64 must be the file that went in.
  await withFixedBoundaries(async () => {
    const raw = bytes(9_814_671);
    const msg = base([
      { filename: 'Sponsorluk.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) },
    ]);
    const lines = mimeLines(msg);
    const streamed = await collect(lines, raw, 65_536);
    assert.equal(streamed.length, mimeByteLength(lines, () => raw.length));

    const text = Buffer.from(streamed).toString('utf8');
    const body = text.slice(text.lastIndexOf('\r\n\r\n') + 4, text.lastIndexOf('\r\n--'));
    assert.deepEqual(new Uint8Array(Buffer.from(body.replace(/\r\n/g, ''), 'base64')), raw);
  });
});

test('the chunk sizes R2 chooses do not change a byte', async () => {
  const raw = bytes(100_003); // not a multiple of 57, nor of any chunk below
  const msg = base([{ filename: 'a.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) }]);
  const lines = mimeLines(msg);
  const reference = await collect(lines, raw, 57 * 1024);
  for (const chunk of [1, 2, 3, 56, 57, 58, 1000, 65_536, 200_000]) {
    assert.deepEqual(await collect(lines, raw, chunk), reference, `chunk size ${chunk}`);
  }
});

test('two attachments are both streamed, in order', async () => {
  const raw = bytes(60_000);
  const msg = base([
    { filename: 'bir.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) },
    { filename: 'iki.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) },
  ]);
  const lines = mimeLines(msg);
  const opened: string[] = [];
  const pieces: Uint8Array[] = [];
  for await (const piece of mimeChunks(lines, async (a) => {
    opened.push(a.filename);
    return chunkedStream(raw, 4096);
  })) {
    pieces.push(piece);
  }
  assert.deepEqual(opened, ['bir.pdf', 'iki.pdf']);
  const text = Buffer.concat(pieces.map((p) => Buffer.from(p))).toString('utf8');
  assert.equal(text.split(encodeAttachmentBody(raw)).length - 1, 2, 'both bodies present');
});

// --- the declared length is exact -------------------------------------------

test('encodedLength agrees with encodeAttachmentBody for every awkward size', () => {
  // 57 bytes is one line; the boundaries either side of it, either side of a
  // whole chunk, and the empty case are where an off-by-one would live.
  for (const n of [0, 1, 2, 3, 4, 56, 57, 58, 113, 114, 115, 171, 4096, 58_367, 58_368, 58_369, 100_003]) {
    assert.equal(encodedLength(n), encodeAttachmentBody(bytes(n)).length, `n=${n}`);
  }
});

test('mimeByteLength predicts the streamed length exactly', async () => {
  // FixedLengthStream errors if the body is one byte off, so this is not a
  // nicety: a wrong prediction is a failed send.
  for (const n of [0, 1, 57, 58, 100_003]) {
    const raw = bytes(n);
    const msg = base([{ filename: 'a.pdf', contentType: 'application/pdf', base64Body: encodeAttachmentBody(raw) }]);
    const lines = mimeLines(msg);
    const streamed = await collect(lines, raw, 4096);
    assert.equal(mimeByteLength(lines, () => n), streamed.length, `n=${n}`);
  }
});

test('mimeByteLength counts a message with no attachment', () => {
  const lines = mimeLines(base());
  assert.equal(mimeByteLength(lines, () => 0), Buffer.byteLength(lines.join('\r\n'), 'utf8'));
});

test('a non-ASCII subject is counted in bytes, not characters', () => {
  // The subject is RFC 2047 encoded, but the display name and body are where
  // a UTF-8 character would otherwise be counted as one byte instead of two.
  const msg = base();
  const lines = mimeLines(msg);
  const utf8 = Buffer.byteLength(lines.join('\r\n'), 'utf8');
  assert.ok(utf8 >= lines.join('\r\n').length, 'the message contains multi-byte characters');
  assert.equal(mimeByteLength(lines, () => 0), utf8);
});
