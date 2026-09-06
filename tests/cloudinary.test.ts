import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atSize, SIZES } from '../src/lib/cloudinary';

/**
 * Asking for the size the page draws.
 *
 * Stored URLs carry the transformation the image was first needed at, and
 * every later use inherited it: a hero stored at w_1600 rendered in a 128x96
 * thumbnail, a speaker photo at w_600 in a 30-pixel circle.
 */

const BASE = 'https://res.cloudinary.com/dyuf14ra5/image/upload';

test('an existing transformation is replaced, not appended', () => {
  assert.equal(
    atSize(`${BASE}/f_auto,q_auto,c_limit,w_1600/v1774196556/rsgturkey/a.png`, SIZES.cardThumb),
    `${BASE}/${SIZES.cardThumb}/v1774196556/rsgturkey/a.png`,
  );
});

test('a URL with no transformation gets one', () => {
  assert.equal(
    atSize(`${BASE}/v1774196556/rsgturkey/a.png`, SIZES.cardThumb),
    `${BASE}/${SIZES.cardThumb}/v1774196556/rsgturkey/a.png`,
  );
});

test('the version and the path are never touched', () => {
  const out = atSize(`${BASE}/w_600/v123/rsgturkey/committee/a-b.jpg`, SIZES.portrait);
  assert.ok(out.endsWith('/v123/rsgturkey/committee/a-b.jpg'), out);
});

test('a folder name is not mistaken for a transformation', () => {
  // The real hazard, and the one a loose "contains an underscore" test walks
  // into: a folder called student_symposium would be replaced rather than
  // kept, and the image would 404 with nothing to explain it. A version
  // segment is safe either way -- v1774196556 has no underscore -- which is
  // why this is the case worth pinning.
  // The folder has to be the first segment for this to bite -- only that one
  // is examined -- which is exactly the URL shape an upload with no version
  // produces.
  const url = `${BASE}/student_symposium/a.png`;
  const out = atSize(url, SIZES.cardThumb);
  assert.ok(out.includes('/student_symposium/a.png'), out);
  assert.equal(out, `${BASE}/${SIZES.cardThumb}/student_symposium/a.png`);
});

test('anything that is not a Cloudinary upload comes back unchanged', () => {
  for (const url of [
    'https://example.org/a.png',
    'https://res.cloudinary.com/demo/video/upload/v1/a.mp4',
    '/images/local.png',
    '',
  ]) {
    assert.equal(atSize(url, SIZES.cardThumb), url);
  }
});

test('the sizes are the ones the pages actually draw', () => {
  // Named so a reader can check them against the CSS rather than decode a
  // transformation string at the call site.
  assert.match(SIZES.cardThumb, /w_320,h_224/);
  assert.match(SIZES.avatarTiny, /w_60,h_60/);
  assert.match(SIZES.portrait, /w_192,h_192/);
  for (const size of Object.values(SIZES)) assert.match(size, /^f_auto,q_auto,/);
});
