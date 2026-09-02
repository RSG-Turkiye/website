import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEditions, type EditionLike, locationFor, ctasFor } from '../src/lib/editions';

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

const withVenue = (venuePublic: boolean, cityPublic: boolean) =>
  ({ venue: 'METU U3 Amphitheatre', venueCity: 'Ankara', venuePublic, cityPublic }) as EditionLike;

test('both public: hall and city are shown', () => {
  assert.deepEqual(locationFor(withVenue(true, true)),
    { kind: 'full', venue: 'METU U3 Amphitheatre', city: 'Ankara' });
});

test('venue recorded, hall withheld, city public: renders as withheld (2026 case)', () => {
  // People need "Ankara" to book travel weeks before we name the hall.
  assert.deepEqual(locationFor(withVenue(false, true)), { kind: 'withheld', city: 'Ankara' });
});

test('neither announced: nothing at all', () => {
  assert.deepEqual(locationFor(withVenue(false, false)), { kind: 'hidden' });
});

test('the hall never leaks through the city-only branch', () => {
  const shown = locationFor(withVenue(false, true));
  assert.ok(!JSON.stringify(shown).includes('U3'), 'the hall must not appear');
});

test('an edition with no venue recorded is hidden even when public', () => {
  assert.deepEqual(locationFor({ venue: '', venueCity: '', venuePublic: true, cityPublic: true } as EditionLike),
    { kind: 'hidden' });
});

test('no venue on record, city public: city-only, never withheld (regression guard for 2018/2022 bug)', () => {
  const shown = locationFor({ venue: '', venueCity: 'Ankara', venuePublic: true, cityPublic: true } as EditionLike);
  assert.deepEqual(shown, { kind: 'city-only', city: 'Ankara' });
  assert.notEqual(shown.kind, 'withheld', 'archived editions with no recorded venue must not show TBA');
});

test('venue recorded, hall withheld, city not public: hidden', () => {
  assert.deepEqual(locationFor(withVenue(false, false)), { kind: 'hidden' });
});

test('the hall never leaks through the withheld branch either', () => {
  const shown = locationFor(withVenue(false, true));
  assert.ok(!JSON.stringify(shown).includes('U3'), 'the hall must not appear in withheld state');
});

test('no CTA is offered while no form exists', () => {
  // A greyed-out "Register (soon)" button sitting there for five weeks
  // reads as broken, so the button is absent until the URL is real.
  assert.deepEqual(ctasFor({ registrationUrl: '', abstractUrl: '' } as EditionLike), []);
});

test('each CTA appears independently as its URL is filled in', () => {
  const only = ctasFor({ registrationUrl: '', abstractUrl: 'https://forms.gle/abs' } as EditionLike);
  assert.equal(only.length, 1);
  assert.equal(only[0].kind, 'abstract');
  assert.equal(only[0].url, 'https://forms.gle/abs');
});

test('registration is listed before abstracts when both are open', () => {
  const both = ctasFor({
    registrationUrl: 'https://forms.gle/reg',
    abstractUrl: 'https://forms.gle/abs',
  } as EditionLike);
  assert.deepEqual(both.map(c => c.kind), ['registration', 'abstract']);
});

test('a deadline rides along with its CTA', () => {
  const [cta] = ctasFor({
    registrationUrl: 'https://forms.gle/reg',
    registrationDeadline: new Date('2026-10-01'),
    abstractUrl: '',
  } as EditionLike);
  assert.equal(cta.deadline?.toISOString().slice(0, 10), '2026-10-01');
});

test('whitespace is not a URL', () => {
  assert.deepEqual(ctasFor({ registrationUrl: '   ', abstractUrl: '' } as EditionLike), []);
});
