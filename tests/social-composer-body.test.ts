import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDraftBody, withOverlays, type ComposerState } from '../src/scripts/social/composer';

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

const o = { text: 'Kayıt açık', x: 0.5, y: 0.8, size: 0.06, color: 'white' as const, box: 'shade' as const, align: 'center' as const };

test('adding text keeps the image without text as the base and sends both', () => {
  const m = { key: 'crop.jpg', url: 'u/crop.jpg', alt: 'Afiş', width: 1080, height: 1920 };
  const n = withOverlays(m, [o], { key: 'text.jpg', url: 'u/text.jpg', width: 1080, height: 1920 });
  assert.deepEqual([n.key, n.base, n.baseUrl, n.overlays], ['text.jpg', 'crop.jpg', 'u/crop.jpg', [o]]);
  const again = withOverlays(n, [{ ...o, text: 'Son gün' }], { key: 'text2.jpg', url: 'u/text2.jpg', width: 1080, height: 1920 });
  assert.equal(again.base, 'crop.jpg', 'editing text again starts from the same base');
  const b = toDraftBody({ ...base, media: [n] });
  assert.deepEqual(b.media, [{ key: 'text.jpg', alt: 'Afiş', base: 'crop.jpg', overlays: [o] }]);
});

test('removing all text returns to the base image and drops the text fields', () => {
  const m = { key: 'text.jpg', url: 'u/text.jpg', alt: 'Afiş', base: 'crop.jpg', baseUrl: 'u/crop.jpg', overlays: [o] };
  const n = withOverlays(m, [], null);
  assert.deepEqual([n.key, n.url, 'base' in n, 'overlays' in n, 'baseUrl' in n], ['crop.jpg', 'u/crop.jpg', false, false, false]);
});
