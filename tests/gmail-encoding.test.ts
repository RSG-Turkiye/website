import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAttachmentBody } from '../functions/_lib/gmail';

/**
 * The chunked encoder must agree with the obvious one byte for byte. A 9 MB
 * attachment encoded slightly wrong is a corrupt PDF in someone's inbox, and
 * nothing in the send path would notice.
 */
const reference = (bytes: Uint8Array): string => {
  const b64 = Buffer.from(bytes).toString('base64');
  return (b64.match(/.{1,76}/g) ?? []).join('\r\n');
};

const bytes = (n: number, seed = 1): Uint8Array => {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = x & 0xff; }
  return out;
};

test('empty input', () => {
  assert.equal(encodeAttachmentBody(new Uint8Array(0)), reference(new Uint8Array(0)));
});

test('every length around the 3-byte padding boundary', () => {
  // 1 and 2 bytes pad; 3 does not. Getting this wrong mid-stream is exactly
  // how a chunked encoder corrupts a file.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 56, 57, 58]) {
    assert.equal(encodeAttachmentBody(bytes(n)), reference(bytes(n)), `length ${n}`);
  }
});

test('every length around the line boundary', () => {
  for (const n of [56, 57, 58, 113, 114, 115]) {
    assert.equal(encodeAttachmentBody(bytes(n)), reference(bytes(n)), `length ${n}`);
  }
});

test('exactly one chunk, and one byte either side of it', () => {
  const chunk = 57 * 1024;
  for (const n of [chunk - 1, chunk, chunk + 1]) {
    assert.equal(encodeAttachmentBody(bytes(n)), reference(bytes(n)), `length ${n}`);
  }
});

test('several chunks, the case that was breaking', () => {
  const n = 57 * 1024 * 3 + 999;
  assert.equal(encodeAttachmentBody(bytes(n)), reference(bytes(n)));
});

test('lines are 76 characters, and only the last may be short', () => {
  const lines = encodeAttachmentBody(bytes(57 * 1024 * 2 + 40)).split('\r\n');
  for (const line of lines.slice(0, -1)) assert.equal(line.length, 76);
  assert.ok(lines[lines.length - 1].length <= 76);
});

test('all 256 byte values survive', () => {
  const all = new Uint8Array(256);
  for (let i = 0; i < 256; i++) all[i] = i;
  assert.equal(encodeAttachmentBody(all), reference(all));
});

test('a nine-megabyte attachment encodes correctly', () => {
  // The real one is 9.36 MB. This is the size that killed the isolate.
  const big = bytes(9_360_000);
  assert.equal(encodeAttachmentBody(big), reference(big));
});
