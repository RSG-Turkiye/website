import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, dayHeading, sessionText } from '../src/lib/schedule-days';

const start = new Date('2026-10-10T00:00:00Z');
const s = (order: number, day?: number) => ({ order, day, title: `s${order}`, description: '' });

test('a one-day programme has no headings', () => {
  const groups = groupByDay([s(0), s(1)], start, 'en');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].heading, null);
});

test('sessions with no day (an older payload) are day 1', () => {
  const groups = groupByDay([s(0), s(1, 2)], start, 'en');
  assert.deepEqual(groups.map((g) => g.day), [1, 2]);
  assert.deepEqual(groups[0].sessions.map((x) => x.order), [0]);
});

test('groups are ordered by day, then by order', () => {
  const groups = groupByDay([s(5, 2), s(1, 1), s(3, 2), s(0, 1)], start, 'en');
  assert.deepEqual(groups.map((g) => g.sessions.map((x) => x.order)), [[0, 1], [3, 5]]);
});

test('headings carry the date derived from the start date, in both languages', () => {
  assert.equal(dayHeading(1, start, 'en'), 'Day 1 · Saturday, 10 October');
  assert.equal(dayHeading(2, start, 'tr'), '2. Gün · 11 Ekim Pazar');
});

test('a gap in days keeps the date tied to the day number', () => {
  assert.equal(dayHeading(3, start, 'en'), 'Day 3 · Monday, 12 October');
});

test('no start date gives a heading without a date', () => {
  assert.equal(dayHeading(2, undefined, 'en'), 'Day 2');
  assert.equal(dayHeading(2, undefined, 'tr'), '2. Gün');
});

test('Turkish text falls back to English, English never shows Turkish', () => {
  const x = { title: 'Opening', titleTr: 'Açılış', description: 'Welcome', descriptionTr: '' };
  assert.deepEqual(sessionText(x, 'tr'), { title: 'Açılış', description: 'Welcome' });
  assert.deepEqual(sessionText(x, 'en'), { title: 'Opening', description: 'Welcome' });
});
