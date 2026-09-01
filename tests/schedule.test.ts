import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScheduledAt,
  shouldGiveUp,
  MAX_SCHEDULE_AHEAD_SECONDS,
  RETRY_WINDOW_SECONDS,
} from '../functions/_lib/schedule';

const NOW = 1_800_000_000;

test('accepts a time in the future and returns it', () => {
  assert.deepEqual(validateScheduledAt(NOW + 3600, NOW), { ok: true, scheduledAt: NOW + 3600 });
});

test('rejects a non-integer or absent value', () => {
  for (const bad of [undefined, null, 'tomorrow', 1.5, NaN, {}, []]) {
    assert.deepEqual(
      validateScheduledAt(bad, NOW),
      { ok: false, code: 'invalid_schedule_time' },
      String(bad) + ' must be rejected',
    );
  }
});

test('rejects a time in the past', () => {
  assert.deepEqual(validateScheduledAt(NOW - 1, NOW), { ok: false, code: 'schedule_in_past' });
});

test('accepts exactly now, and exactly the far limit', () => {
  assert.equal(validateScheduledAt(NOW, NOW).ok, true);
  assert.equal(validateScheduledAt(NOW + MAX_SCHEDULE_AHEAD_SECONDS, NOW).ok, true);
});

test('rejects one second beyond the far limit', () => {
  assert.deepEqual(
    validateScheduledAt(NOW + MAX_SCHEDULE_AHEAD_SECONDS + 1, NOW),
    { ok: false, code: 'schedule_too_far' },
  );
});

test('the far limit is 60 days and the retry window is 6 hours', () => {
  assert.equal(MAX_SCHEDULE_AHEAD_SECONDS, 60 * 24 * 3600);
  assert.equal(RETRY_WINDOW_SECONDS, 6 * 3600);
});

test('a row that has never been tried is never given up on', () => {
  assert.equal(shouldGiveUp(null, NOW), false);
});

test('gives up only after the retry window has fully elapsed', () => {
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS + 1, NOW), false);
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS, NOW), false);
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS - 1, NOW), true);
});
