import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEditions, currentEditionOf, ordinalOf, symposiumsHeld, nextEditionHint, seasonOf, ordinalLabel, type EditionLike, locationFor, ctasFor, titleFor, subtitleFor } from '../src/lib/editions';

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

test('titleFor: english language always gets the english title', () => {
  const e = { title: 'English Title', titleTr: 'Türkçe Başlık' } as EditionLike;
  assert.equal(titleFor(e, 'en'), 'English Title');
});

test('titleFor: turkish language gets the turkish title when present', () => {
  const e = { title: 'English Title', titleTr: 'Türkçe Başlık' } as EditionLike;
  assert.equal(titleFor(e, 'tr'), 'Türkçe Başlık');
});

test('titleFor: turkish language falls back to english when titleTr is empty', () => {
  // Most archived editions have no titleTr at all -- this is the common
  // path, not the edge case.
  const e = { title: 'English Title', titleTr: '' } as EditionLike;
  assert.equal(titleFor(e, 'tr'), 'English Title');
});

test('titleFor: turkish language falls back to english when titleTr is absent', () => {
  const e = { title: 'English Title' } as EditionLike;
  assert.equal(titleFor(e, 'tr'), 'English Title');
});

test('subtitleFor: english language always gets the english subtitle', () => {
  const e = { subtitle: 'English Subtitle', subtitleTr: 'Türkçe Alt Başlık' } as EditionLike;
  assert.equal(subtitleFor(e, 'en'), 'English Subtitle');
});

test('subtitleFor: turkish language gets the turkish subtitle when present', () => {
  const e = { subtitle: 'English Subtitle', subtitleTr: 'Türkçe Alt Başlık' } as EditionLike;
  assert.equal(subtitleFor(e, 'tr'), 'Türkçe Alt Başlık');
});

test('subtitleFor: turkish language falls back to english when subtitleTr is empty', () => {
  const e = { subtitle: 'English Subtitle', subtitleTr: '' } as EditionLike;
  assert.equal(subtitleFor(e, 'tr'), 'English Subtitle');
});

test('subtitleFor: turkish language falls back to english when subtitleTr is absent', () => {
  const e = { subtitle: 'English Subtitle' } as EditionLike;
  assert.equal(subtitleFor(e, 'tr'), 'English Subtitle');
});

test('subtitleFor: no subtitle at all is undefined, not a crash', () => {
  const e = {} as EditionLike;
  assert.equal(subtitleFor(e, 'tr'), undefined);
  assert.equal(subtitleFor(e, 'en'), undefined);
});

// --- the third state: an edition that has finished -------------------------
// The morning after the symposium, the pages that render its programme must
// keep rendering it as a record. Before this, they fell back to "will be
// announced soon" about an event that had already happened.

test('while an edition is still ahead, it is the current one and it is upcoming', () => {
  const c = currentEditionOf(ALL, new Date('2026-09-03'));
  assert.equal(c.state, 'upcoming');
  assert.equal(c.edition?.year, 2026);
});

test('the morning after, the same edition is still the current one', () => {
  // 2026 starts 10 Oct and has no endDate, so it is over at midnight on the
  // 11th -- the exact boundary the nightly rebuild crosses. It stops being
  // upcoming there, but stays the edition the pages present.
  const c = currentEditionOf(ALL, new Date('2026-10-11T06:00:00Z'));
  assert.notEqual(c.state, 'upcoming');
  assert.equal(c.edition?.year, 2026);
});

test('a finished edition gives way to the next one once that is announced', () => {
  const withNext = [...ALL, edition(2027, '2027-10-09')];
  const c = currentEditionOf(withNext, new Date('2026-10-11T06:00:00Z'));
  assert.equal(c.state, 'upcoming');
  assert.equal(c.edition?.year, 2027);
});

test('the most recently finished edition wins, not the oldest', () => {
  const c = currentEditionOf(ALL, new Date('2026-10-11T06:00:00Z'));
  assert.equal(c.edition?.year, 2026);
  const earlier = currentEditionOf(ALL, new Date('2026-01-01'));
  assert.equal(earlier.state, 'upcoming');
  assert.equal(earlier.edition?.year, 2026);
});

test('an undated archive entry is never the current edition', () => {
  // 2023 and 2024 have no dates; with nothing dated at all there is no
  // current edition to present, rather than an arbitrary one.
  const c = currentEditionOf([edition(2024), edition(2023)], new Date('2026-10-11'));
  assert.equal(c.state, 'none');
  assert.equal(c.edition, null);
});

test('no editions at all is the none state, not a crash', () => {
  const c = currentEditionOf([], new Date('2026-10-11'));
  assert.equal(c.state, 'none');
  assert.equal(c.edition, null);
});

// --- how many symposiums have been held ------------------------------------
// The homepage said 12+ and /about said 11+, and the collection holds nine
// files -- three numbers for one fact. The titles carry the real one: they
// are numbered 5th through 13th, so editions 1-4 happened without getting a
// markdown entry, and counting files would publish a smaller, wrong number.

test('an edition knows its own number from its title', () => {
  assert.equal(ordinalOf({ year: 2026, title: '13th RSG-Türkiye Student Symposium' }), 13);
  assert.equal(ordinalOf({ year: 2019, title: '1st RSG-Türkiye Student Symposium' }), 1);
  assert.equal(ordinalOf({ year: 2019, title: '2nd Symposium' }), 2);
  assert.equal(ordinalOf({ year: 2019, title: '3rd Symposium' }), 3);
});

test('a title with no number in front yields nothing rather than a guess', () => {
  assert.equal(ordinalOf({ year: 2019, title: 'RSG-Türkiye Student Symposium' }), null);
  assert.equal(ordinalOf({ year: 2019, title: 'Symposium 12' }), null);
});

test('the count is the highest number, minus the one that has not happened yet', () => {
  // 2026 is the 13th and is still ahead, so twelve have been held.
  const all = [
    { year: 2025, title: '12th Symposium', startDate: new Date('2025-10-30') },
    { year: 2026, title: '13th Symposium', startDate: new Date('2026-10-10') },
  ];
  assert.equal(symposiumsHeld(all, new Date('2026-09-03')), 12);
});

test('the morning after, the count includes it', () => {
  const all = [
    { year: 2025, title: '12th Symposium', startDate: new Date('2025-10-30') },
    { year: 2026, title: '13th Symposium', startDate: new Date('2026-10-10') },
  ];
  assert.equal(symposiumsHeld(all, new Date('2026-10-11T06:00:00Z')), 13);
});

test('the count never falls below the editions actually on file', () => {
  // Guards the failure the old hardcoded numbers had: a value that drifts
  // below reality and nothing notices.
  const all = [
    { year: 2024, title: 'Symposium' },
    { year: 2025, title: 'Symposium' },
    { year: 2026, title: 'Symposium' },
  ];
  assert.equal(symposiumsHeld(all, new Date('2026-09-03')), 3);
});

// --- the week after ---------------------------------------------------------
// Demoting the symposium to an archive entry the morning after throws away the
// only week anyone was going to read it: that is when people look for the
// talks. It stays the headline for a week, then becomes archive.

test('the morning after, it is just-held rather than finished', () => {
  const c = currentEditionOf(ALL, new Date('2026-10-11T06:00:00Z'));
  assert.equal(c.state, 'just-held');
  assert.equal(c.edition?.year, 2026);
});

test('six days later it is still the headline', () => {
  assert.equal(currentEditionOf(ALL, new Date('2026-10-17T00:00:00Z')).state, 'just-held');
});

test('after the week it becomes archive', () => {
  assert.equal(currentEditionOf(ALL, new Date('2026-10-19T00:00:00Z')).state, 'finished');
});

test('the cooldown runs from the end of the event, not its start', () => {
  // 2025 ran 30 Oct to 2 Nov, so the week starts on the 3rd and not the 31st.
  const only2025 = [edition(2025, '2025-10-30', '2025-11-02')];
  assert.equal(currentEditionOf(only2025, new Date('2025-11-06')).state, 'just-held');
  assert.equal(currentEditionOf(only2025, new Date('2025-11-11')).state, 'finished');
});

// --- what to say about the edition nobody has announced ---------------------

test('nothing is claimed while an edition is still ahead', () => {
  assert.equal(nextEditionHint(ALL, new Date('2026-09-03')), null);
});

test('the next edition is derived, never written down', () => {
  const h = nextEditionHint(ALL, new Date('2026-10-19'));
  assert.deepEqual(h, { ordinal: null, year: 2027, season: 'autumn', expired: false });
});

test('the number comes from the last one, when the title carries it', () => {
  const numbered = [{ year: 2026, title: '13th Symposium', startDate: new Date('2026-10-10') }];
  assert.equal(nextEditionHint(numbered, new Date('2026-10-19'))?.ordinal, 14);
});

test('the season follows the symposium, so moving it moves the sentence', () => {
  const spring = [{ year: 2026, title: '13th Symposium', startDate: new Date('2026-04-18') }];
  assert.equal(nextEditionHint(spring, new Date('2026-06-01'))?.season, 'spring');
  assert.equal(seasonOf(new Date('2026-01-15')), 'winter');
  assert.equal(seasonOf(new Date('2026-07-01')), 'summer');
});

test('English ordinals, including the exceptions a translation string cannot hold', () => {
  assert.equal(ordinalLabel(14, 'en'), '14th');
  assert.equal(ordinalLabel(21, 'en'), '21st');
  assert.equal(ordinalLabel(22, 'en'), '22nd');
  assert.equal(ordinalLabel(23, 'en'), '23rd');
  assert.equal(ordinalLabel(11, 'en'), '11th');   // not 11st
  assert.equal(ordinalLabel(13, 'en'), '13th');   // not 13rd
  assert.equal(ordinalLabel(14, 'tr'), '14.');
});

test('a prediction that has already gone by stops claiming a date', () => {
  // If nobody adds the next edition's file, the derived year eventually falls
  // behind us and the sentence would be advertising a date in the past.
  const all = [{ year: 2026, title: '13th Symposium', startDate: new Date('2026-10-10') }];
  const fresh = nextEditionHint(all, new Date('2026-10-20'));
  assert.equal(fresh?.expired, false);
  assert.equal(fresh?.year, 2027);

  const stale = nextEditionHint(all, new Date('2028-06-01'));
  assert.equal(stale?.expired, true);
  assert.equal(stale?.ordinal, 14, 'the number is still known, only the date is not');
});
