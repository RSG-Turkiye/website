import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEditions, type EditionLike } from '../src/lib/editions';

function edition(year: number, startDate?: string, endDate?: string): EditionLike {
  return {
    year,
    title: `${year} symposium`,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  } as EditionLike;
}

const ALL = [
  edition(2024),
  edition(2023),
  edition(2025, '2025-10-30', '2025-11-02'),
  edition(2026, '2026-10-10'),
];

test('the nearest future edition is the upcoming one', () => {
  const { upcoming } = splitEditions(ALL, new Date('2026-09-02T09:00:00Z'));
  assert.equal(upcoming?.year, 2026);
});

test('editions with no startDate are archive entries, never upcoming', () => {
  // 2018-2023 only ever recorded a year. Inventing a day for them so a
  // required field validates would put made-up data in the repo.
  const { upcoming, past } = splitEditions([edition(2024), edition(2023)], new Date('2020-01-01'));
  assert.equal(upcoming, null);
  assert.deepEqual(past.map(e => e.year), [2024, 2023]);
});

test('an edition stays current for the whole of its last day', () => {
  // The single most important case: on the afternoon of the symposium the
  // site must not have already archived it.
  const duringTheEvent = new Date('2026-10-10T14:00:00Z');
  assert.equal(splitEditions(ALL, duringTheEvent).upcoming?.year, 2026);
});

test('a multi-day edition stays current through its endDate', () => {
  const duringDayThree = new Date('2025-11-01T12:00:00Z');
  assert.equal(splitEditions(ALL, duringDayThree).upcoming?.year, 2025);
});

test('the morning after the last day, it has moved to the archive', () => {
  const { upcoming, past } = splitEditions(ALL, new Date('2026-10-11T09:00:00Z'));
  assert.equal(upcoming, null);
  assert.equal(past[0].year, 2026, 'the just-finished edition leads the archive');
});

test('past editions are newest first', () => {
  const { past } = splitEditions(ALL, new Date('2027-01-01'));
  assert.deepEqual(past.map(e => e.year), [2026, 2025, 2024, 2023]);
});

test('nothing is both upcoming, future, and past', () => {
  for (const now of ['2026-09-02', '2026-10-10T14:00:00Z', '2026-10-11T09:00:00Z']) {
    const { upcoming, future, past } = splitEditions(ALL, new Date(now));
    if (upcoming) {
      assert.ok(!past.some(e => e.year === upcoming.year), `${upcoming.year} duplicated in past at ${now}`);
      assert.ok(!future.some(e => e.year === upcoming.year), `${upcoming.year} duplicated in future at ${now}`);
    }
    future.forEach(f => {
      assert.ok(!past.some(e => e.year === f.year), `${f.year} duplicated in past at ${now}`);
    });
    assert.equal(past.length + future.length + (upcoming ? 1 : 0), ALL.length, `an edition vanished at ${now}`);
  }
});

test('future editions not yet current are held separately from archive', () => {
  // When multiple dated editions are ahead of now, only the nearest is upcoming.
  // The others must land in future, not past.
  const twoFutureDated = [
    edition(2024),  // no date: archive
    edition(2023),  // no date: archive
    edition(2026, '2026-10-10'),
    edition(2027, '2027-10-15'),
  ];
  const { upcoming, future, past } = splitEditions(twoFutureDated, new Date('2026-01-01'));
  assert.equal(upcoming?.year, 2026, 'nearest future edition is upcoming');
  assert.deepEqual(future.map(e => e.year), [2027], 'further future edition is in future list');
  assert.deepEqual(past.map(e => e.year), [2024, 2023], 'undated editions are in past');
});
