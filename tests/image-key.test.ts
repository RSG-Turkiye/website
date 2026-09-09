import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IMAGE_KEY } from '../functions/api/images/[key]';

/**
 * The image route's key pattern is the whole of its input validation.
 *
 * /api/images/<key> reads straight from the R2 bucket, and `key` is the only
 * value a caller controls. R2 keys are a flat namespace, so there is no
 * directory to escape -- but the bucket also holds nothing this route should
 * refuse to serve today, and that is a property of today's bucket rather
 * than of this route. Pinning the shape to exactly what upload-image.ts
 * mints means a key that names anything else never reaches R2 at all.
 */

const uuid = '0d5e2a71-4b3c-4d8e-9f10-2a3b4c5d6e7f';

test('exactly what the uploader mints is accepted', () => {
  for (const ext of ['jpg', 'png', 'webp', 'gif']) {
    assert.ok(IMAGE_KEY.test(`${uuid}.${ext}`), `${ext} was refused`);
  }
});

test('anything else is refused', () => {
  const bad = [
    '', 'x.jpg', `${uuid}`, `${uuid}.jpeg`, `${uuid}.svg`, `${uuid}.html`,
    `${uuid}.jpg.svg`, `${uuid}.JPG`, `${uuid.toUpperCase()}.jpg`,
    `../${uuid}.jpg`, `a/${uuid}.jpg`, `${uuid}.jpg/`, ` ${uuid}.jpg`,
    `${uuid}.jpg `, `${uuid}.jpg?x=1`, `${uuid}.jpg#a`, `${uuid}.jpg%00`,
    // A newline must not let a second line satisfy an unanchored match --
    // JavaScript's $ matches before a trailing newline unless the regex is
    // anchored the way this one is, which is the point of the case.
    `${uuid}.jpg\n`, `evil\n${uuid}.jpg`,
  ];
  for (const key of bad) assert.ok(!IMAGE_KEY.test(key), `${JSON.stringify(key)} was accepted`);
});

test('a mail attachment key shape is refused', () => {
  // A different bucket, but the route must not become a general file server
  // if the two ever share one.
  assert.ok(!IMAGE_KEY.test('attachments/report.pdf'));
  assert.ok(!IMAGE_KEY.test(`${uuid}.pdf`));
});
