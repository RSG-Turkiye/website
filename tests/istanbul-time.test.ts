import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  epochToIstanbulInput,
  istanbulInputToEpoch,
  formatIstanbul,
} from '../src/lib/istanbul-time';

// Every expected value below is built with Date.UTC (never with the bare
// `Date` constructor, and never by formatting with the machine's own
// timezone) so these assertions hold no matter what TZ the test runner
// happens to be in. Turkey has kept a fixed +03:00 offset since abolishing
// DST in 2016, so "three hours" recurs throughout.

// 2026-06-15T12:00:00Z is 2026-06-15T15:00 in Istanbul.
const JUNE_UTC_NOON = Date.UTC(2026, 5, 15, 12, 0, 0) / 1000;

test('epochToIstanbulInput renders the epoch in Istanbul time, three hours ahead of UTC', () => {
  assert.equal(epochToIstanbulInput(JUNE_UTC_NOON), '2026-06-15T15:00');
});

test('round trip: epochToIstanbulInput then istanbulInputToEpoch returns the original epoch', () => {
  const rendered = epochToIstanbulInput(JUNE_UTC_NOON);
  assert.equal(istanbulInputToEpoch(rendered), JUNE_UTC_NOON);
});

test('09:00 Istanbul is the epoch three hours earlier than 09:00 UTC on the same date', () => {
  const nineAmUtc = Date.UTC(2026, 5, 15, 9, 0, 0) / 1000;
  const nineAmIstanbul = istanbulInputToEpoch('2026-06-15T09:00');
  assert.equal(nineAmIstanbul, nineAmUtc - 3 * 3600);
});

test('midnight in Istanbul falls on the previous UTC date, 21:00', () => {
  // 2026-01-01T00:00 Istanbul == 2025-12-31T21:00Z.
  const expected = Date.UTC(2025, 11, 31, 21, 0, 0) / 1000;
  assert.equal(istanbulInputToEpoch('2026-01-01T00:00'), expected);
  assert.equal(epochToIstanbulInput(expected), '2026-01-01T00:00');
});

test('a date near a month boundary converts correctly in both directions', () => {
  // 2026-03-01T01:30 Istanbul == 2026-02-28T22:30Z (2026 is not a leap year,
  // so February ends on the 28th -- a real month-boundary case, not just a
  // day-boundary one).
  const expected = Date.UTC(2026, 1, 28, 22, 30, 0) / 1000;
  assert.equal(istanbulInputToEpoch('2026-03-01T01:30'), expected);
  assert.equal(epochToIstanbulInput(expected), '2026-03-01T01:30');
});

test('an empty string yields undefined', () => {
  assert.equal(istanbulInputToEpoch(''), undefined);
});

test('a malformed string yields undefined', () => {
  for (const bad of ['not-a-date', '2026-06-15', '15/06/2026 09:00', '2026-06-15 09:00', 'T09:00']) {
    assert.equal(istanbulInputToEpoch(bad), undefined, `${bad} should be rejected`);
  }
});

test('an out-of-range but pattern-matching string yields undefined rather than silently rolling over', () => {
  // Date.UTC would otherwise roll month 13 into the following January and
  // hour 25 into the next day, turning a typo into some unrelated valid date.
  for (const bad of ['2026-13-01T09:00', '2026-06-32T09:00', '2026-06-15T25:00', '2026-06-15T09:61']) {
    assert.equal(istanbulInputToEpoch(bad), undefined, `${bad} should be rejected`);
  }
});

test('formatIstanbul renders in Istanbul time for both locales used by the site', () => {
  assert.equal(formatIstanbul(JUNE_UTC_NOON, 'en-GB'), '15/06/2026, 15:00:00');
  assert.equal(formatIstanbul(JUNE_UTC_NOON, 'tr-TR'), '15.06.2026 15:00:00');
});
