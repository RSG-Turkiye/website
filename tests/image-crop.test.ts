import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ratiosFor, nearestRatio, centerCrop, clampRect, zoomCrop, zoomOf, panCrop, fitFrame, outputSize } from '../src/lib/image-crop';
import { ratioOk } from '../functions/_lib/social-limits';

test('every preset shape passes the server\'s ratio rule', () => {
  for (const type of ['image', 'carousel', 'story'] as const) {
    for (const r of ratiosFor(type)) {
      const c = centerCrop(3000, 3000, r.value);
      assert.ok(ratioOk(type, c.w, c.h), `${type} ${r.id}`);
    }
  }
});

test('a phone screenshot gets the closest allowed shape, centred', () => {
  assert.equal(nearestRatio(1080, 2340, 'image').id, '4:5');
  assert.equal(nearestRatio(1920, 1080, 'image').id, '1.91:1');
  assert.equal(nearestRatio(1000, 1000, 'carousel').id, '1:1');
  assert.equal(nearestRatio(1080, 1080, 'story').id, '9:16');
  assert.deepEqual(centerCrop(1080, 2340, 0.8), { x: 0, y: 495, w: 1080, h: 1350 });
});

test('a wide image is cropped on its sides', () => {
  assert.deepEqual(centerCrop(2000, 1000, 1), { x: 500, y: 0, w: 1000, h: 1000 });
});

test('clamp, pan and zoom never leave the image', () => {
  assert.deepEqual(clampRect({ x: -50, y: 900, w: 500, h: 500 }, 1000, 1000), { x: 0, y: 500, w: 500, h: 500 });
  const r = centerCrop(1000, 1000, 1);
  assert.deepEqual(panCrop(r, 100, 0, 500, 1000, 1000), r, 'already full width: nowhere to go');
  const z = zoomCrop(r, 1000, 1000, 1, 2);
  assert.deepEqual(z, { x: 250, y: 250, w: 500, h: 500 });
  assert.deepEqual(panCrop(z, 100, -50, 500, 1000, 1000), { x: 150, y: 300, w: 500, h: 500 }, 'drag right shows more of the left');
  assert.deepEqual(panCrop(z, 10000, 10000, 500, 1000, 1000), { x: 0, y: 0, w: 500, h: 500 });
  assert.deepEqual(zoomCrop({ x: 0, y: 0, w: 500, h: 500 }, 1000, 1000, 1, 1), { x: 0, y: 0, w: 1000, h: 1000 });
  assert.equal(zoomOf(z, 1000, 1000, 1), 2);
  assert.equal(zoomCrop(r, 1000, 1000, 1, 99).w, 250, 'zoom is capped at 4');
});

test('fit pads to the target shape around the whole image', () => {
  assert.deepEqual(fitFrame(1080, 2340, 0.8), { w: 1872, h: 2340, ox: 396, oy: 0 });
  assert.deepEqual(fitFrame(2000, 1000, 1), { w: 2000, h: 2000, ox: 0, oy: 500 });
  const f = fitFrame(1080, 2340, 0.8);
  assert.ok(ratioOk('image', f.w, f.h));
});

test('output is at most 2000px and never upscaled', () => {
  assert.deepEqual(outputSize(1872, 2340), { w: 1600, h: 2000 });
  assert.deepEqual(outputSize(800, 1000), { w: 800, h: 1000 });
  const o = outputSize(1872, 2340);
  assert.ok(ratioOk('image', o.w, o.h));
});
