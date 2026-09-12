import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { lastmodFor, gitHistoryAvailable, __sourceFor as sourceFor } from '../src/lib/lastmod';

/**
 * The sitemap's <lastmod> must be a real date or absent.
 *
 * It was absent for all 324 URLs, which throws away the only freshness signal
 * a sitemap carries — a crawler could not tell the thirty pages written this
 * week from the ones untouched since 2019, on a site whose problem is that
 * Google has discovered 233 URLs and crawled none of them.
 *
 * The failure mode to guard against is the opposite one: dating every page
 * with the build time, or with a webinar's own `date` so a page written
 * yesterday claims 2014. Google discounts lastmod it finds unreliable, so a
 * wrong date costs more than no date.
 */

const SITEMAP = new URL('../dist/sitemap-0.xml', import.meta.url).pathname;
const built = existsSync(SITEMAP);

test('a URL maps to the file that actually builds it', () => {
  assert.equal(sourceFor('/webinars/molecular-simulations/'), 'src/content/webinars/en/molecular-simulations.md');
  assert.equal(sourceFor('/tr/webinars/molekuler-simulasyonlar/'), 'src/content/webinars/tr/molekuler-simulasyonlar.md');
  assert.equal(sourceFor('/blog/welcome-to-rsg-turkey/'), 'src/content/blog/en/welcome-to-rsg-turkey.md');
  assert.equal(sourceFor('/events/'), 'src/pages/events.astro');
  assert.equal(sourceFor('/tr/events/'), 'src/pages/tr/events.astro');
  assert.equal(sourceFor('/'), 'src/pages/index.astro');
  assert.equal(sourceFor('/tr/'), 'src/pages/tr/index.astro');

  // A tag page is a list of posts; the template is not what changes about it,
  // so it is deliberately left without a date rather than given a wrong one.
  assert.equal(sourceFor('/tags/genomics/'), null);

  // A URL with no matching file borrows nothing.
  assert.equal(sourceFor('/webinars/this-does-not-exist/'), null);
});

test('no lastmod is ever the build time', { skip: !built && 'run `npm run build` first' }, () => {
  const xml = readFileSync(SITEMAP, 'utf8');
  const stamps = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
  assert.ok(stamps.length > 50, `expected dated URLs, found ${stamps.length}`);

  for (const s of stamps) {
    assert.ok(!Number.isNaN(Date.parse(s)), `unparseable lastmod: ${s}`);
    assert.ok(Date.parse(s) <= Date.now() + 60_000, `lastmod in the future: ${s}`);
  }

  // The tell for build-time stamping: every page changed at the same instant.
  // Real history is spread out.
  const distinct = new Set(stamps.map((s) => s.slice(0, 10)));
  assert.ok(
    distinct.size >= 3,
    `every dated URL shares ${distinct.size} date(s): ${[...distinct].join(', ')}. ` +
      `That is what stamping the build time looks like, and Google discounts ` +
      `a lastmod it finds unreliable. It should come from git history.`,
  );
});

test('a webinar page is dated when it was written, not when the talk was given', { skip: !gitHistoryAvailable && 'no git history' }, () => {
  // The 2014 and 2015 webinars were added to this repository in 2026. Dating
  // them by their `date` field would announce them as eleven years stale --
  // exactly backwards, since they are the newest pages on the site.
  const old = lastmodFor('https://rsg-turkiye.iscbsc.org/webinars/testis-evolution-in-primates/');
  if (!old) return; // shallow clone: no date is the safe answer, not a wrong one
  assert.ok(
    Date.parse(old) > Date.parse('2020-01-01'),
    `an entry added this year is dated ${old}; that is the talk's date, not the page's`,
  );
});

test('an unknown source yields no date rather than a borrowed one', () => {
  assert.equal(lastmodFor('https://rsg-turkiye.iscbsc.org/tags/genomics/'), undefined);
  assert.equal(lastmodFor('not a url'), undefined);
});
