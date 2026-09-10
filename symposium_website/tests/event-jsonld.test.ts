import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

/**
 * The Event markup Google reads, checked in the page it is actually shipped in.
 *
 * Two different things are guarded here, and only the rendered output can
 * guard either.
 *
 * The first is the hall. `withheld-venue.test.ts` keeps it out of the
 * repository; this keeps it out of the *page* -- structured data is a second
 * publishing surface, invisible to anyone reading the site, and a change to
 * `locationFor` or to this component could start emitting `location.name`
 * while every visible page still says "venue to be announced". Nobody would
 * see it. Google would.
 *
 * The second is the fields Search Console asks for. It reported five missing
 * optional fields on 2026-09-09; `image` and `endDate` are the two that are
 * always available, so their absence is a regression rather than a state.
 * `performer`, `offers` and `location.name` are deliberately conditional --
 * on announced speakers, an open registration and a public venue -- and are
 * not asserted present.
 *
 * Reads dist/, so it needs a build. Skips itself when there is none, which is
 * what CI does before the build step and what a fresh clone has.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;
const EDITIONS = new URL('../src/content/editions/', import.meta.url).pathname;

function eventOf(page: string): Record<string, any> | null {
  const html = readFileSync(DIST + page, 'utf8');
  for (const [, body] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    // The component escapes `<` as < on the way in; JSON.parse restores it.
    const data = JSON.parse(body);
    if (data['@type'] === 'Event') return data;
  }
  return null;
}

const PAGES = ['index.html', 'tr/index.html'];
const built = existsSync(DIST + 'index.html');

test('both home pages carry an Event', { skip: !built && 'no build in dist/' }, () => {
  for (const page of PAGES) assert.ok(eventOf(page), `${page} has no Event JSON-LD`);
});

test('the Event names no hall that the edition is not announcing', { skip: !built && 'no build in dist/' }, () => {
  // Every hall in the repository, announced or not -- if one is ever
  // committed again, this asks whether it reached the markup.
  const halls: string[] = [];
  for (const file of readdirSync(EDITIONS).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(EDITIONS + file, 'utf8');
    const match = /^venue:\s*(.+)$/m.exec(text);
    const venue = match?.[1].trim().replace(/^["']|["']$/g, '');
    // Withheld means the flag is explicitly false. An absent venuePublic is
    // the schema's default of *true*, and reading it as withheld -- which
    // this did until 2026-09-10 -- called four announced halls secret. It
    // passed anyway, because none of them happened to appear in the
    // upcoming edition's Event, so the mistake was invisible until 2026
    // announced its own hall and the check turned on it.
    const withheld = /^venuePublic:\s*false\s*$/m.test(text);
    if (venue && withheld) halls.push(venue);
  }

  for (const page of PAGES) {
    const event = eventOf(page)!;
    const serialised = JSON.stringify(event);
    for (const hall of halls) {
      assert.ok(!serialised.includes(hall), `${page}: the Event names a withheld hall`);
    }
    if (event.location && halls.length > 0) {
      assert.equal(event.location.name, undefined,
        `${page}: location.name is set while a hall is being withheld`);
    }
  }
});

test('the Event publishes the hall the edition announces, in that language', () => {
  // The other half of the rule above, and the half that has teeth today:
  // since 2026 announced its hall the withheld list is empty, so a check
  // that only looked for leaks would pass while emitting nothing at all.
  // This asks the opposite question -- that an announced hall reaches the
  // markup, and reaches it translated.
  const upcoming = readFileSync(EDITIONS + '2026.md', 'utf8');
  const name = (field: string) =>
    new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(upcoming)?.[1].trim().replace(/^["']|["']$/g, '') ?? '';
  const venue = name('venue');
  const venueTr = name('venueTr');
  const announced = /^venuePublic:\s*true\s*$/m.test(upcoming);
  assert.ok(announced && venue, 'this test assumes 2026 announces a hall; update it when that changes');

  assert.equal(eventOf('index.html')!.location?.name, venue);
  assert.equal(eventOf('tr/index.html')!.location?.name, venueTr || venue);
  assert.notEqual(venueTr, '', 'the Turkish page would otherwise publish the English name');
});

test('the Event carries the fields that are always available', { skip: !built && 'no build in dist/' }, () => {
  for (const page of PAGES) {
    const event = eventOf(page)!;
    assert.ok(event.image, `${page}: no image`);
    assert.match(event.startDate ?? '', /^\d{4}-\d{2}-\d{2}$/, `${page}: no startDate`);
    assert.match(event.endDate ?? '', /^\d{4}-\d{2}-\d{2}$/, `${page}: no endDate`);
    assert.ok(event.name, `${page}: no name`);
  }
});

test('each language publishes its own language', { skip: !built && 'no build in dist/' }, () => {
  assert.equal(eventOf('index.html')!.inLanguage, 'en');
  assert.equal(eventOf('tr/index.html')!.inLanguage, 'tr');
  assert.notEqual(eventOf('index.html')!.name, eventOf('tr/index.html')!.name);
});
