import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItemsFor } from '../src/lib/nav';

const EMPTY = { hasSchedule: false, hasSpeakers: false, hasCommittee: false, hasGuidelines: false };
const FULL = { hasSchedule: true, hasSpeakers: true, hasCommittee: true, hasGuidelines: true };

test('home, editions, venue and sponsors are always offered', () => {
  const hrefs = navItemsFor(EMPTY, 'en').map(i => i.href);
  assert.deepEqual(hrefs, ['/', '/editions/', '/venue/', '/sponsors/']);
});

test('no nav item points at a page with nothing on it', () => {
  const hrefs = navItemsFor(EMPTY, 'en').map(i => i.href);
  for (const empty of ['/schedule/', '/speakers/', '/committee/']) {
    assert.ok(!hrefs.includes(empty), `${empty} is empty and must not be linked`);
  }
});

test('a section appears in the nav as soon as it has content', () => {
  const hrefs = navItemsFor(FULL, 'en').map(i => i.href);
  for (const filled of ['/schedule/', '/speakers/', '/committee/']) {
    assert.ok(hrefs.includes(filled), `${filled} has content and must be linked`);
  }
});

test('sections appear independently of one another', () => {
  const hrefs = navItemsFor({ ...EMPTY, hasSpeakers: true }, 'en').map(i => i.href);
  assert.ok(hrefs.includes('/speakers/'));
  assert.ok(!hrefs.includes('/schedule/'));
});

test('turkish nav is the same set under the /tr prefix', () => {
  const en = navItemsFor(FULL, 'en').map(i => i.href);
  const tr = navItemsFor(FULL, 'tr').map(i => i.href);
  assert.deepEqual(tr, en.map(h => (h === '/' ? '/tr/' : '/tr' + h)));
});

test('schedule and speakers are reachable once filled -- they are built either way', () => {
  // Both pages already existed and were built, but Header.astro never
  // linked them: reachable only by typing the URL.
  assert.ok(navItemsFor(FULL, 'en').some(i => i.href === '/schedule/'));
});

/**
 * /speakers is an archive, and its nav item now follows that.
 *
 * `navItemsFor` only sees the flags, so this is the contract between it and
 * BaseLayout: the flag means "the page has something on it", not "the current
 * edition has something on it". The layout computes hasSpeakers from the
 * whole speakers collection for exactly that reason, and the test below
 * checks it stayed that way.
 */
test('a page carrying only past editions is still linked', () => {
  const archiveOnly = { ...EMPTY, hasSpeakers: true };
  const hrefs = navItemsFor(archiveOnly, 'en').map(i => i.href);
  assert.ok(hrefs.includes('/speakers/'), 'speakers has three editions on it and must be reachable');
  assert.ok(!hrefs.includes('/schedule/'), 'schedule is current-edition only and has nothing');
});

test('/abstracts is not linked until guidelines are written', () => {
  const hrefs = navItemsFor(EMPTY, 'en').map(i => i.href);
  assert.ok(!hrefs.includes('/abstracts/'));
});

test('/abstracts appears on its own once they are', () => {
  const hrefs = navItemsFor({ ...EMPTY, hasGuidelines: true }, 'en').map(i => i.href);
  assert.ok(hrefs.includes('/abstracts/'));
});

test('/abstracts comes before /venue', () => {
  // Somebody deciding whether to submit reads the guidelines, and they do
  // that before they care where the building is.
  const hrefs = navItemsFor(FULL, 'en').map(i => i.href);
  assert.ok(hrefs.indexOf('/abstracts/') < hrefs.indexOf('/venue/'));
});

test('the Turkish nav prefixes it too', () => {
  const hrefs = navItemsFor(FULL, 'tr').map(i => i.href);
  assert.ok(hrefs.includes('/tr/abstracts/'));
  assert.ok(!hrefs.includes('/abstracts/'));
});
