import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { episodes, latest, show, formatDuration, formatDate, summarise } from '../src/lib/podcast';

/**
 * The podcast data, and the two things the page cannot do without.
 *
 * src/data/podcast.json is written by scripts/sync-podcast.ts from the show's
 * RSS feed and committed, so a nightly build never depends on anchor.fm being
 * up. The cost of that choice is that the file can be edited by hand or
 * committed half-written, and neither the type system nor the build would
 * notice: an episode with no audioUrl renders a play button that does nothing.
 */

test('the show has episodes, and every one of them has audio', () => {
  assert.ok(episodes.length >= 1, 'no episodes at all');
  for (const episode of episodes) {
    assert.match(episode.audioUrl, /^https:\/\//, `${episode.title} has no audio`);
    assert.ok(episode.title.trim().length > 0, 'an episode with no title');
    assert.ok(episode.guid.trim().length > 0, `${episode.title} has no guid`);
    assert.ok(Number.isFinite(Date.parse(episode.pubDate)), `${episode.title} has an unparseable date`);
  }
});

test('episodes are newest first, which is what both the page and the strip assume', () => {
  const dates = episodes.map((e) => Date.parse(e.pubDate));
  assert.deepEqual(dates, [...dates].sort((a, b) => b - a));
  assert.equal(latest, episodes[0]);
});

test('two episodes never share a guid', () => {
  // The play buttons are keyed by audio URL and the list by guid; a duplicate
  // would make one episode unreachable.
  const guids = episodes.map((e) => e.guid);
  assert.equal(new Set(guids).size, guids.length);
  const urls = episodes.map((e) => e.audioUrl);
  assert.equal(new Set(urls).size, urls.length);
});

test('the show carries the artwork and the subscribe links the page renders', () => {
  assert.match(show.image, /^https:\/\//);
  for (const [name, url] of Object.entries(show.platforms)) {
    assert.match(url, /^https:\/\//, `${name} link`);
  }
});

test('there is one player on the site, and it starts empty', () => {
  // The three episodes total about 145 MB. Episodes are referenced only
  // through data attributes on the buttons; the single player gets a src on
  // the first press. Two players would also mean two episodes at once.
  //
  // Comments are stripped first. Astro ships HTML comments, so a comment that
  // mentions the tag would otherwise read as a second player -- which is
  // exactly what happened while this was being written.
  for (const page of ['../dist/podcast/index.html', '../dist/tr/podcast/index.html', '../dist/index.html']) {
    const path = new URL(page, import.meta.url).pathname;
    if (!existsSync(path)) continue; // CI builds before it tests; a fresh clone has none
    const html = readFileSync(path, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const audioTags = html.match(/<audio[^>]*>/g) ?? [];
    assert.equal(audioTags.length, 1, `${page}: one player, not one per episode`);
    assert.match(audioTags[0], /preload="none"/, page);
    assert.doesNotMatch(audioTags[0], /\ssrc=/, `${page}: the player starts empty`);
    assert.match(audioTags[0], /data-astro-transition-persist/, `${page}: the player must survive navigation`);
  }
});

// --- formatting -----------------------------------------------------------------

test('durations read as minutes, in the reader language', () => {
  assert.equal(formatDuration(3065, 'tr'), '51 dk');
  assert.equal(formatDuration(3065, 'en'), '51 min');
  assert.equal(formatDuration(2448, 'tr'), '41 dk');
});

test('a duration under a minute does not round to zero', () => {
  // No episode is that short today; a trailer would be, and "0 dk" is worse
  // than useless.
  assert.equal(formatDuration(45, 'tr'), '45 sn');
  assert.equal(formatDuration(45, 'en'), '45 sec');
  assert.equal(formatDuration(0, 'tr'), '', 'unknown length says nothing');
});

test('dates are formatted per language, not shipped as the feed wrote them', () => {
  // The feed gives RFC 822 with English month names. A Turkish reader should
  // not see "May".
  const iso = '2025-05-24T10:30:00.000Z';
  assert.match(formatDate(iso, 'tr'), /Mayıs/);
  assert.match(formatDate(iso, 'en'), /May/);
});

test('a long description is cut on a word, with an ellipsis', () => {
  const long = 'kelime '.repeat(100).trim();
  const cut = summarise(long, 50);
  assert.ok(cut.length <= 51, cut);
  assert.ok(cut.endsWith('…'));
  assert.ok(!cut.includes('keli…'), 'not mid-word');
});

test('a short description is returned untouched', () => {
  assert.equal(summarise('Kısa.', 260), 'Kısa.');
});
