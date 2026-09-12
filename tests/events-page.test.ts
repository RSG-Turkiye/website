import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { events, groupEvents, statusOf, type CommunityEvent } from '../src/data/events';

/**
 * The events page cannot advertise something that has already happened.
 *
 * It used to. Each event carried a literal `status: "upcoming"`, written by
 * hand, which meant the label could only ever change if somebody remembered
 * to change it -- and in September 2026 the page still read "Annual Symposium
 * 2025 - TBD 2025", flagged Upcoming, with a Register button next to it, over
 * a symposium list whose most recent entry was 2024.
 *
 * Now the status is derived from the date, so these tests are about the two
 * ways that can still go wrong: a date that lies, and a second copy of the
 * list drifting from the first.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

test('an event is upcoming until midnight after its last day, and then is not', () => {
  const oneDay: CommunityEvent = {
    id: 'x', type: 'workshop', start: new Date('2026-05-10'),
    title: { en: '', tr: '' }, when: { en: '', tr: '' },
    location: { en: '', tr: '' }, description: { en: '', tr: '' },
  };
  // The morning of, and the evening of: still upcoming. An event must not
  // flip to "completed" while people are still in the room.
  assert.equal(statusOf(oneDay, new Date('2026-05-10T08:00:00Z')), 'upcoming');
  assert.equal(statusOf(oneDay, new Date('2026-05-10T22:00:00Z')), 'upcoming');
  assert.equal(statusOf(oneDay, new Date('2026-05-11T12:00:00Z')), 'completed');

  // A multi-day event runs to its last day, not its first.
  const twoDay: CommunityEvent = { ...oneDay, end: new Date('2026-05-12') };
  assert.equal(statusOf(twoDay, new Date('2026-05-11T12:00:00Z')), 'upcoming');
  assert.equal(statusOf(twoDay, new Date('2026-05-13T12:00:00Z')), 'completed');
});

test('the events page has not fallen behind the symposium site', () => {
  // The list going stale is the whole point of this file, and with a derived
  // status the only way left for it to go stale is downward: the symposium
  // site gains an edition and nobody adds it here. So compare against the
  // editions themselves, which live in the same repository.
  const EDITIONS = new URL('../symposium_website/src/content/editions/', import.meta.url).pathname;
  const years = globSync('*.md', { cwd: EDITIONS })
    .map((f) => Number(f.replace('.md', '')))
    .filter((y) => Number.isFinite(y));
  assert.ok(years.length >= 10, `expected the edition files, found ${years.length}`);

  const newestEdition = Math.max(...years);
  const newestListed = Math.max(
    ...events.filter((e) => e.type === 'symposium').map((e) => e.start.getFullYear()),
  );

  assert.ok(
    newestListed >= newestEdition,
    `The symposium site lists a ${newestEdition} edition and /events stops at ` +
      `${newestListed}. Add it to src/data/events.ts -- a visitor who lands on ` +
      `/events should not be told the most recent symposium is an older one.`,
  );
});

test('every event has a real date and both languages', () => {
  assert.ok(events.length >= 5, `expected the event list, found ${events.length}`);
  for (const e of events) {
    assert.ok(!Number.isNaN(e.start.getTime()), `${e.id} has an unparseable start`);
    if (e.end) {
      assert.ok(!Number.isNaN(e.end.getTime()), `${e.id} has an unparseable end`);
      assert.ok(e.end >= e.start, `${e.id} ends before it starts`);
    }
    for (const field of ['title', 'when', 'location', 'description'] as const) {
      for (const lang of ['en', 'tr'] as const) {
        assert.ok(e[field][lang].trim(), `${e.id} has no ${field}.${lang}`);
      }
    }
  }
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'duplicate event id');
});

test('the two events pages read the one list rather than carrying their own', () => {
  // The original bug was two hand-maintained copies. A page that declares its
  // own array of events has reintroduced it.
  for (const page of ['pages/events.astro', 'pages/tr/events.astro']) {
    const text = readFileSync(join(SRC, page), 'utf8');
    assert.ok(
      /<EventList\b/.test(text),
      `${page} should render <EventList>, which reads src/data/events.ts`,
    );
    assert.ok(
      !/status:\s*["'](upcoming|completed)["']/.test(text),
      `${page} hard-codes an event status; status is derived from the date`,
    );
  }
});

test('no page anywhere hard-codes an event status', () => {
  const offenders = globSync('**/*.astro', { cwd: SRC })
    .filter((f) => /status:\s*["'](upcoming|completed)["']/.test(readFileSync(join(SRC, f), 'utf8')));
  assert.deepEqual(offenders, [], `hard-coded event status in: ${offenders.join(', ')}`);
});
