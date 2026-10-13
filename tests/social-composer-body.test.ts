import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDraftBody, type ComposerState } from '../src/scripts/social/composer';

const base: ComposerState = {
  id: null, revision: 0, status: 'draft', planId: null, planTitle: null, type: 'image', platforms: ['instagram'],
  media: [{ key: 'k.jpg', alt: ' Afiş ', url: 'u', width: 1080, height: 1350 }],
  caption: 'Merhaba', overrides: { linkedin: '', instagram: 'IG' }, link: '  ', date: '2026-10-14', time: '18:00',
};

test('the body sends trimmed alt text, no blank link, and only non-empty overrides in a fixed order', () => {
  const b = toDraftBody(base);
  assert.deepEqual(b.media, [{ key: 'k.jpg', alt: 'Afiş' }]);
  assert.equal(b.link, null);
  assert.deepEqual(Object.keys(b.captionOverrides), ['instagram']);
  assert.equal(b.scheduledAt, Date.UTC(2026, 9, 14, 15, 0) / 1000);
  assert.equal('planId' in b, false, 'planId only on create');
});

test('a cropped image carries its original and crop area to the server, and nothing else', () => {
  const source = { key: 'orig.jpg', mode: 'crop' as const, x: 0, y: 495, w: 1080, h: 1350 };
  const b = toDraftBody({ ...base, media: [{ key: 'k.jpg', alt: 'Afiş', url: 'u', sourceUrl: 'su', width: 1080, height: 1350, source }] });
  assert.deepEqual(b.media, [{ key: 'k.jpg', alt: 'Afiş', source }]);
});

test('overrides keep instagram before linkedin whatever order they were typed in', () => {
  const b = toDraftBody({ ...base, overrides: { linkedin: 'LI', instagram: 'IG' } });
  assert.deepEqual(Object.keys(b.captionOverrides), ['instagram', 'linkedin']);
});

test('a new post from a plan carries the plan id and the plan type; a bad date is null', () => {
  const b = toDraftBody({ ...base, planId: 'pl', type: 'carousel', date: '' }, true);
  assert.equal(b.planId, 'pl');
  assert.equal(b.type, 'carousel');
  assert.equal(b.scheduledAt, null);
});
