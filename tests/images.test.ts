import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageSize } from '../functions/_lib/images';

const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;
const be32 = (n: number) => [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, (n >> 8) & 255];

test('PNG', () => {
  const png = buf(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...be32(13), 0x49, 0x48, 0x44, 0x52, ...be32(6720), ...be32(4480));
  assert.deepEqual(imageSize(png), { width: 6720, height: 4480 });
});

test('GIF', () => {
  const gif = buf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...le16(800), ...le16(600), 0, 0, 0, 0, 0, 0, 0, 0);
  assert.deepEqual(imageSize(gif), { width: 800, height: 600 });
});

test('JPEG, with segments before the frame header', () => {
  // A real photograph carries EXIF and quantisation tables first; walking to
  // the frame header rather than assuming an offset is the whole point.
  const exif = [0xff, 0xe1, 0x00, 0x08, 1, 2, 3, 4, 5, 6];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, ...be32(4480).slice(2), ...be32(6720).slice(2)];
  assert.deepEqual(imageSize(buf(0xff, 0xd8, ...exif, ...sof0, 0, 0, 0, 0)), { width: 6720, height: 4480 });
});

test('JPEG progressive, which uses a different frame marker', () => {
  const sof2 = [0xff, 0xc2, 0x00, 0x11, 0x08, ...be32(1200).slice(2), ...be32(1600).slice(2)];
  assert.deepEqual(imageSize(buf(0xff, 0xd8, ...sof2, 0, 0, 0, 0, 0, 0, 0, 0)), { width: 1600, height: 1200 });
});

test('WebP lossy', () => {
  const w = buf(0x52,0x49,0x46,0x46, 0,0,0,0, 0x57,0x45,0x42,0x50, 0x56,0x50,0x38,0x20,
    0,0,0,0, 0,0,0,0, 0,0, ...le16(1024), ...le16(768));
  assert.deepEqual(imageSize(w), { width: 1024, height: 768 });
});

test('a truncated file is refused, not guessed at', () => {
  assert.equal(imageSize(buf(0x89, 0x50, 0x4e, 0x47)), null);
  assert.equal(imageSize(new ArrayBuffer(0)), null);
});

test('something that is not an image at all', () => {
  assert.equal(imageSize(buf(...'<!doctype html><html><head>'.split('').map((c) => c.charCodeAt(0)))), null);
});

test('a JPEG whose segment length is nonsense does not spin', () => {
  // A malformed length used to be a way to hang the parser; it must give up.
  assert.equal(imageSize(buf(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)), null);
});
