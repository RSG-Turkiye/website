import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countFor, captionProblems, ENABLED_PLATFORMS, ALL_PLATFORMS, X_MAX_IMAGES } from '../functions/_lib/social-limits';
import { readinessProblems } from '../functions/_lib/social-posts';
import { PUBLISH_REASON_KEYS } from '../functions/_lib/social/reasons';
import { PUBLISH_REASON_KEYS as FROM_INSTAGRAM } from '../functions/_lib/social/instagram-errors';

const KEY = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111.jpg`;
const dims = (n: number) => new Map(Array.from({ length: n }, (_, i) => [KEY(i), { width: 1080, height: 1350 }]));
const post = (platforms: ('instagram' | 'linkedin' | 'x')[], images: number, caption = 'Merhaba') => ({
  type: (images > 1 ? 'carousel' : 'image') as 'carousel' | 'image',
  caption, captionOverrides: {}, link: null, platforms,
  media: Array.from({ length: images }, (_, i) => ({ key: KEY(i), alt: `Alt ${i}` })),
  scheduledAt: 2_000_000_000,
});

test('X is offered like the others', () => {
  assert.deepEqual(ENABLED_PLATFORMS, ALL_PLATFORMS);
});

test('X counts every link as 23 characters, whatever its length', () => {
  const long = `https://rsg-turkiye.iscbsc.org/${'a'.repeat(200)}`;
  assert.equal(countFor('x', `Kayıt açık ${long}`), 'Kayıt açık '.length + 23);
  assert.equal(countFor('x', 'http://a.co'), 23);
  assert.equal(countFor('linkedin', `x ${long}`), 2 + long.length, 'other platforms count the link as written');
});

test('a caption that fits X once its link is weighted is not refused', () => {
  const link = `https://rsg-turkiye.iscbsc.org/${'a'.repeat(300)}`;
  const src = { caption: 'a'.repeat(250), captionOverrides: {}, link };
  assert.deepEqual(captionProblems(src, ['x'], 'image'), [], '250 + 2 newlines + 23 = 275');
  const over = { caption: 'a'.repeat(260), captionOverrides: {}, link };
  assert.equal(captionProblems(over, ['x'], 'image')[0]?.code, 'caption_too_long');
});

test('X takes at most four images; the other platforms are not limited by it', () => {
  const p = readinessProblems(post(['instagram', 'x'], 5), dims(5), 1_900_000_000);
  assert.deepEqual(p.filter((x) => x.code === 'x_too_many_images'), [{ code: 'x_too_many_images', platform: 'x', limit: X_MAX_IMAGES, actual: 5 }]);
  assert.equal(readinessProblems(post(['x'], 4), dims(4), 1_900_000_000).some((x) => x.code === 'x_too_many_images'), false);
  assert.equal(readinessProblems(post(['instagram', 'linkedin'], 5), dims(5), 1_900_000_000).some((x) => x.code === 'x_too_many_images'), false);
});

test('one list of publish reasons, shared by every adapter', () => {
  assert.equal(FROM_INSTAGRAM, PUBLISH_REASON_KEYS);
  for (const k of ['duplicate', 'uncertain', 'no_api_access', 'not_connected']) assert.ok((PUBLISH_REASON_KEYS as readonly string[]).includes(k), k);
});
