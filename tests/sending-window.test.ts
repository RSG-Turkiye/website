import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinSendingWindow, SEND_WINDOW } from '../functions/_lib/schedule';

// Türkiye is UTC+3, so the window is 05:00-19:00 UTC.
const at = (utc: string) => withinSendingWindow(new Date(utc));

test('the hours this was written for', () => {
  // Both real deliveries from 2026-09-05, in Türkiye time 04:10 and 07:38.
  assert.equal(at('2026-09-05T01:10:00Z'), false, '04:10 in Türkiye');
  assert.equal(at('2026-09-05T04:38:00Z'), false, '07:38 in Türkiye');
});

test('the working day is open', () => {
  assert.equal(at('2026-09-05T06:00:00Z'), true, '09:00');
  assert.equal(at('2026-09-05T11:00:00Z'), true, '14:00');
  assert.equal(at('2026-09-05T15:00:00Z'), true, '18:00');
});

test('the boundaries, which are where an off-by-one would hide', () => {
  assert.equal(at('2026-09-05T04:59:59Z'), false, '07:59:59 -- still closed');
  assert.equal(at('2026-09-05T05:00:00Z'), true, '08:00:00 -- open');
  assert.equal(at('2026-09-05T18:59:59Z'), true, '21:59:59 -- still open');
  assert.equal(at('2026-09-05T19:00:00Z'), false, '22:00:00 -- closed');
});

test('the small hours are closed all the way through', () => {
  for (const h of [19, 20, 21, 22, 23, 0, 1, 2, 3, 4]) {
    const utc = `2026-09-05T${String(h).padStart(2, '0')}:30:00Z`;
    assert.equal(at(utc), false, utc);
  }
});

test('crossing midnight UTC does not reopen it', () => {
  // 21:30 UTC is 00:30 in Türkiye -- the wrap is where a modulo bug shows.
  assert.equal(at('2026-09-05T21:30:00Z'), false);
  assert.equal(at('2026-09-05T22:30:00Z'), false);
});

test('the window is stated once and the code reads it', () => {
  assert.equal(SEND_WINDOW.startHour, 8);
  assert.equal(SEND_WINDOW.endHour, 22);
});
