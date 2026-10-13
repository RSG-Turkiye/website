import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wrapLines, layoutBox, clampCenter, hitTest, pinchSize, boxFill } from '../src/lib/text-overlay';

const mono: (t: string) => number = (t) => t.length * 10; // every character 10 px wide

test('wrapLines keeps words whole, honours newlines, and splits a word longer than the line', () => {
  assert.deepEqual(wrapLines('kısa', 100, mono), ['kısa']);
  assert.deepEqual(wrapLines('bir iki üç dört', 70, mono), ['bir iki', 'üç dört']);
  assert.deepEqual(wrapLines('üst\nalt', 1000, mono), ['üst', 'alt']);
  assert.deepEqual(wrapLines('abcdefghijkl', 50, mono), ['abcde', 'fghij', 'kl']);
  assert.deepEqual(wrapLines('  ', 100, mono), []);
});

test('layoutBox sizes the box around the lines with padding, centred on the point', () => {
  const W = 1000, H = 1000;
  const l = layoutBox({ x: 0.5, y: 0.5, size: 0.05 }, ['abc', 'abcdef'], mono, W, H);
  assert.equal(l.lineHeight, 60);           // 1.2 x font size (50 px)
  assert.equal(l.pad, 15);                  // 0.3 x font size
  assert.equal(l.box.w, 60 + 30);           // widest line + 2 pad
  assert.equal(l.box.h, 120 + 30);          // two lines + 2 pad
  assert.deepEqual([l.box.x, l.box.y], [500 - 45, 500 - 75]);
});

test('clampCenter keeps a box fully inside the image', () => {
  assert.deepEqual(clampCenter(0, 0, 200, 100, 1000, 1000), { x: 0.1, y: 0.05 });
  assert.deepEqual(clampCenter(1000, 1000, 200, 100, 1000, 1000), { x: 0.9, y: 0.95 });
  assert.deepEqual(clampCenter(500, 500, 200, 100, 1000, 1000), { x: 0.5, y: 0.5 });
  assert.deepEqual(clampCenter(10, 10, 2000, 100, 1000, 1000), { x: 0.5, y: 0.05 }, 'wider than the image: centred');
});

test('hitTest picks the topmost box under the point', () => {
  const boxes = [{ x: 0, y: 0, w: 100, h: 100 }, { x: 50, y: 50, w: 100, h: 100 }];
  assert.equal(hitTest(boxes, 75, 75), 1);
  assert.equal(hitTest(boxes, 10, 10), 0);
  assert.equal(hitTest(boxes, 500, 500), -1);
});

test('pinch scales the size and clamps it', () => {
  assert.equal(pinchSize(0.05, 100, 200), 0.1);
  assert.equal(pinchSize(0.05, 100, 10), 0.02);
  assert.equal(pinchSize(0.15, 100, 300), 0.2);
});

test('a solid box contrasts with its text; shade is translucent; none has no box', () => {
  assert.equal(boxFill({ color: 'white', box: 'solid' }), '#1B2A4A');
  assert.equal(boxFill({ color: 'navy', box: 'solid' }), '#ffffff');
  assert.equal(boxFill({ color: 'red', box: 'shade' }), 'rgba(0,0,0,0.45)');
  assert.equal(boxFill({ color: 'black', box: 'none' }), null);
});
