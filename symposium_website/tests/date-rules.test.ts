import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  locationFor,
  ctasFor,
  openCtas,
  ctaState,
  hasHappened,
  nextEditionHint,
  endOfSeason,
  type EditionLike,
} from '../src/lib/editions';

/**
 * Four statements the site made that were true on the day they were written.
 *
 * Simulated against the real frontmatter, the site said all of these:
 *
 *  - "10 October 2026 - Ankara - Venue to be announced", in June 2028,
 *    directly above "thanks to everyone who came".
 *  - "Speakers will be announced soon" for the seven days after the
 *    symposium, above the previous edition's speaker list.
 *  - "Register" and, to Google, `availability: InStock`, the day after the
 *    registration deadline.
 *  - "expected in autumn 2027" on 15 December 2027.
 *
 * None of them needs a fact anybody has to remember. Each needs a clock.
 */

const edition = (over: Partial<EditionLike>): EditionLike =>
  ({
    year: 2026,
    title: '13th RSG-Türkiye Student Symposium',
    venue: 'A hall whose name is not public',
    venueCity: 'Ankara',
    venuePublic: false,
    cityPublic: true,
    ...over,
  }) as EditionLike;

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

// --- "to be announced" is a promise about the future -------------------------

test('a withheld hall is still withheld while the event is ahead', () => {
  const e = edition({ startDate: new Date('2026-10-10T00:00:00Z') });
  assert.deepEqual(locationFor(e, at('2026-09-01')), { kind: 'withheld', city: 'Ankara' });
});

test('a withheld hall becomes city-only once the event is over', () => {
  // The hall is not going to be announced now. Saying it will be is a promise
  // the site cannot keep, and it sat above "thanks to everyone who came".
  const e = edition({ startDate: new Date('2026-10-10T00:00:00Z') });
  assert.deepEqual(locationFor(e, at('2026-10-12')), { kind: 'city-only', city: 'Ankara' });
  assert.deepEqual(locationFor(e, at('2028-06-01')), { kind: 'city-only', city: 'Ankara' });
});

test('the hall never leaks on either side of the event', () => {
  const e = edition({ venue: 'ODTU U3 Amfi', startDate: new Date('2026-10-10T00:00:00Z') });
  for (const when of ['2026-09-01', '2026-10-12', '2030-01-01']) {
    assert.ok(!JSON.stringify(locationFor(e, at(when))).includes('U3'), when);
  }
});

test('an undated edition is never treated as over', () => {
  // 2018-2023 record only a year. They must keep whatever they show today.
  const e = edition({ startDate: undefined });
  assert.deepEqual(locationFor(e, at('2030-01-01')), { kind: 'withheld', city: 'Ankara' });
});

test('a published hall is published whenever you ask', () => {
  const e = edition({ venuePublic: true, venue: 'METU Informatics Institute', startDate: new Date('2023-10-10T00:00:00Z') });
  assert.deepEqual(locationFor(e, at('2030-01-01')),
    { kind: 'full', venue: 'METU Informatics Institute', city: 'Ankara' });
});

// --- a deadline is the end of the thing ---------------------------------------

const forms = { registrationUrl: 'https://forms.gle/reg', abstractUrl: 'https://forms.gle/abs' };

test('a call to action with no deadline stays open', () => {
  assert.deepEqual(openCtas(forms as EditionLike, at('2030-01-01')).map((c) => c.kind),
    ['registration', 'abstract']);
});

test('a call to action closes the day after its deadline, and the whole day counts', () => {
  const e = { ...forms, registrationDeadline: new Date('2026-09-30T00:00:00Z') } as EditionLike;
  assert.deepEqual(openCtas(e, at('2026-09-30')).map((c) => c.kind), ['registration', 'abstract']);
  assert.deepEqual(openCtas(e, at('2026-10-02')).map((c) => c.kind), ['abstract']);
});

test('the two deadlines close independently', () => {
  const e = {
    ...forms,
    registrationDeadline: new Date('2026-09-30T00:00:00Z'),
    abstractDeadline: new Date('2026-08-15T00:00:00Z'),
  } as EditionLike;
  assert.deepEqual(openCtas(e, at('2026-09-01')).map((c) => c.kind), ['registration']);
  assert.deepEqual(openCtas(e, at('2026-10-05')), []);
});

test('a closed form is not the same as a form that does not exist yet', () => {
  // The hero has two sentences: "opens soon" and "has closed". They are told
  // apart by whether the URL exists, so a closed call to action has to stay
  // in the list -- dropping it made the day after the deadline look like the
  // weeks before the forms went up.
  const closed = ctasFor(
    { ...forms, registrationDeadline: new Date('2026-08-01T00:00:00Z'), abstractDeadline: new Date('2026-08-01T00:00:00Z') } as EditionLike,
    at('2026-09-01'),
  );
  assert.deepEqual(closed.map((c) => c.state), ['closed', 'closed'], 'still listed');
  assert.equal(openCtas({ ...forms, registrationDeadline: new Date('2026-08-01T00:00:00Z'), abstractDeadline: new Date('2026-08-01T00:00:00Z') } as EditionLike, at('2026-09-01')).length, 0);

  const notYet = ctasFor({ registrationUrl: '', abstractUrl: '' } as EditionLike, at('2026-09-01'));
  assert.deepEqual(notYet, [], 'nothing to close');
});

// --- one answer to "has it happened?" ------------------------------------------

test('just-held counts as happened, which is what two pages denied', () => {
  assert.equal(hasHappened('just-held'), true);
  assert.equal(hasHappened('finished'), true);
  assert.equal(hasHappened('upcoming'), false);
  assert.equal(hasHappened('none'), false);
});

// --- a season, not a year --------------------------------------------------------

test('a season ends when it ends, and winter crosses the new year', () => {
  assert.equal(endOfSeason('spring', 2027), Date.UTC(2027, 5, 1));
  assert.equal(endOfSeason('summer', 2027), Date.UTC(2027, 8, 1));
  assert.equal(endOfSeason('autumn', 2027), Date.UTC(2027, 11, 1));
  assert.equal(endOfSeason('winter', 2027), Date.UTC(2028, 2, 1));
});

test('"expected in autumn 2027" stops being said when autumn 2027 ends', () => {
  // It used to be said until New Year's Eve: the check compared years, and a
  // year is two months coarser than the sentence it was guarding.
  const all = [edition({ startDate: new Date('2026-10-10T00:00:00Z'), venuePublic: true })];
  const hint = (when: string) => nextEditionHint(all, at(when));

  assert.deepEqual(
    { year: hint('2027-10-01')!.year, season: hint('2027-10-01')!.season, expired: hint('2027-10-01')!.expired },
    { year: 2027, season: 'autumn', expired: false },
  );
  assert.equal(hint('2027-11-30')!.expired, false, 'still autumn');
  assert.equal(hint('2027-12-01')!.expired, true, 'autumn is over');
  assert.equal(hint('2027-12-15')!.expired, true, 'and stays over, rather than waiting for January');
});

test('a December edition predicts the following winter, which runs into March', () => {
  const all = [edition({ year: 2026, startDate: new Date('2026-12-05T00:00:00Z'), venuePublic: true })];
  assert.equal(nextEditionHint(all, at('2028-01-15'))!.expired, false, 'still winter 2027');
  assert.equal(nextEditionHint(all, at('2028-03-02'))!.expired, true);
});

test('the hero does not announce that a closed registration is about to open', () => {
  // The regression this pair exists for. "Opens soon" fired on an empty CTA
  // list, and until deadlines were enforced an empty list could only mean
  // "no URL yet". The day after registration closed it would have meant
  // something else entirely, and said the same sentence.
  const closed = {
    ...forms,
    registrationDeadline: new Date('2026-08-01T00:00:00Z'),
    abstractDeadline: new Date('2026-08-01T00:00:00Z'),
  } as EditionLike;
  assert.equal(ctaState(closed, at('2026-09-01')), 'closed');
  assert.equal(ctaState(closed, at('2026-07-01')), 'open');
  assert.equal(ctaState({ registrationUrl: '', abstractUrl: '' } as EditionLike, at('2026-09-01')), 'soon');
});

test('one form still open keeps the buttons up', () => {
  const half = { ...forms, abstractDeadline: new Date('2026-08-01T00:00:00Z') } as EditionLike;
  assert.equal(ctaState(half, at('2026-09-01')), 'open');
  assert.deepEqual(openCtas(half, at('2026-09-01')).map((c) => c.kind), ['registration']);
});
