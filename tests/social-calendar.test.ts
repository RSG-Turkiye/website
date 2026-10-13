import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, gridRange, dayKey, timeOf, epochAt, bucketByDay, shiftMonth, monthOf, planDue, PLAN_DUE_SECONDS } from '../src/lib/social-calendar';

test('October 2026 starts on a Thursday: the grid opens on Monday 28 September', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g.length, 42);
  assert.deepEqual([g[0].key, g[0].inMonth], ['2026-09-28', false]);
  assert.deepEqual([g[3].key, g[3].day, g[3].inMonth], ['2026-10-01', 1, true]);
  assert.equal(g[41].key, '2026-11-08');
});

test('a month starting on Monday has no leading days', () => {
  assert.equal(monthGrid(2026, 6)[0].key, '2026-06-01');
});

test('the range covers the whole grid in Türkiye time and fits the 62-day API cap', () => {
  const r = gridRange(monthGrid(2026, 10));
  assert.equal(r.from, Date.UTC(2026, 8, 27, 21, 0) / 1000);
  assert.equal(r.to, Date.UTC(2026, 10, 8, 20, 59, 59) / 1000);
  assert.ok(r.to - r.from <= 62 * 86400);
});

test('day keys and times are Türkiye time', () => {
  const lateUtc = Date.UTC(2026, 9, 12, 22, 30) / 1000;
  assert.equal(dayKey(lateUtc), '2026-10-13');
  assert.equal(timeOf(lateUtc), '01:30');
});

test('a new item defaults to 18:00 Türkiye time', () => {
  assert.equal(epochAt('2026-10-14'), Date.UTC(2026, 9, 14, 15, 0) / 1000);
  assert.equal(epochAt('2026-10-14', '09:30'), Date.UTC(2026, 9, 14, 6, 30) / 1000);
  assert.equal(epochAt('not a date'), null);
});

test('bucketByDay groups and sorts by time, skipping undated items', () => {
  const at = (h: number) => Date.UTC(2026, 9, 14, h) / 1000;
  const m = bucketByDay([{ t: at(15) }, { t: at(6) }, { t: null }], (x) => x.t);
  assert.deepEqual([...m.keys()], ['2026-10-14']);
  assert.deepEqual(m.get('2026-10-14')!.map((x) => x.t), [at(6), at(15)]);
});

test('month arithmetic and the month of an instant', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(monthOf(Date.UTC(2026, 9, 31, 22) / 1000), { year: 2026, month: 11 }, '01:00 on 1 November in Türkiye');
});

test('a plan is due when it has no post and is less than 48 hours away (or past)', () => {
  const now = 1_800_000_000;
  assert.equal(planDue({ scheduledAt: now + PLAN_DUE_SECONDS, postId: null }, now), true);
  assert.equal(planDue({ scheduledAt: now + PLAN_DUE_SECONDS + 1, postId: null }, now), false);
  assert.equal(planDue({ scheduledAt: now - 10, postId: null }, now), true);
  assert.equal(planDue({ scheduledAt: now + 10, postId: 'p' }, now), false);
});
