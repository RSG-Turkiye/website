import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { matches, stateFromUrl, applyStateToUrl, type WebinarFacts } from '../src/lib/webinar-filter';

const w = (over: Partial<WebinarFacts> = {}): WebinarFacts => ({
  title: 'Single-cell RNA-seq', speaker: 'Ayşe Yılmaz', description: 'Clustering methods', year: '2025', hasVideo: true, ...over,
});

test('search, recording and year narrow the list together', () => {
  const s = { term: 'single', year: '2025', videoOnly: true };
  assert.equal(matches(w(), s), true);
  assert.equal(matches(w({ hasVideo: false }), s), false, 'no recording');
  assert.equal(matches(w({ year: '2024' }), s), false, 'other year');
  assert.equal(matches(w({ title: 'Proteomics' }), s), false, 'search misses');
});

test('an empty filter shows everything; search reads title, speaker and description, any case', () => {
  const all = { term: '', year: null, videoOnly: false };
  assert.equal(matches(w({ hasVideo: false, year: '2014' }), all), true);
  assert.equal(matches(w(), { ...all, term: 'AYŞE' }), true);
  assert.equal(matches(w(), { ...all, term: 'clustering' }), true);
});

test('the state comes from the address, and old #2025 links still pick a year', () => {
  assert.deepEqual(stateFromUrl(new URL('https://example.org/webinars/?video=1&year=2023')), { term: '', year: '2023', videoOnly: true });
  assert.deepEqual(stateFromUrl(new URL('https://example.org/webinars/#2021')), { term: '', year: '2021', videoOnly: false });
  assert.deepEqual(stateFromUrl(new URL('https://example.org/webinars/?year=abc&video=yes')), { term: '', year: null, videoOnly: false });
});

test('the address records the filter and keeps other parameters', () => {
  const u = new URL('https://example.org/webinars/?page=2#2021');
  applyStateToUrl(u, { term: 'x', year: '2025', videoOnly: true });
  assert.equal(u.searchParams.get('video'), '1');
  assert.equal(u.searchParams.get('year'), '2025');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.hash, '', 'the old hash is dropped once the query carries the year');
  applyStateToUrl(u, { term: '', year: null, videoOnly: false });
  assert.equal(u.searchParams.has('video'), false);
  assert.equal(u.searchParams.has('year'), false);
});

test('a webinar and its translation agree on whether there is a recording', () => {
  // The filter's count differed between the two languages because one twin had lost its link.
  const dir = (lang: string) => new URL(`../src/content/webinars/${lang}/`, import.meta.url);
  const read = (lang: string) => new Map(readdirSync(dir(lang)).filter((f) => f.endsWith('.md')).map((f) => {
    const src = readFileSync(new URL(f, dir(lang)), 'utf8');
    const field = (k: string) => (src.match(new RegExp(`^${k}:\\s*"?([^"\\n#]*)"?`, 'm'))?.[1] ?? '').trim();
    return [field('translationKey') || f.slice(0, -3), field('youtubeUrl')] as const;
  }));
  const en = read('en');
  const tr = read('tr');
  for (const [key, url] of en) {
    if (tr.has(key)) assert.equal(tr.get(key), url, key);
  }
});

test('both webinar pages use the shared filter and mark each card with its recording and year', () => {
  for (const page of ['../src/pages/webinars.astro', '../src/pages/tr/webinars.astro']) {
    const src = readFileSync(new URL(page, import.meta.url), 'utf8');
    assert.match(src, /from '(\.\.\/)+lib\/webinar-filter'/, page);
    assert.match(src, /data-video=/, page);
    assert.match(src, /id="videoOnly"/, page);
    assert.match(src, /id="yearFilter"/, page);
  }
});
