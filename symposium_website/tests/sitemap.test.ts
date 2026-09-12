import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The sitemap offers crawlers pages that have something on them.
 *
 * /schedule covers the current edition only, so between one symposium and the
 * next it is a heading and "will be announced soon". Search Console had 233
 * URLs sitting at "Discovered - currently not indexed"; an empty page in the
 * sitemap is a request to spend a crawl on nothing.
 *
 * The decision is made in astro.config.mjs from the built page's own
 * `data-sessions` count, not from src/content/sessions/, because a programme
 * entered through the CMS never touches the content directory. That is the
 * part worth guarding: if the attribute goes, the build throws, and if the
 * filter goes, this fails.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const skip = !existsSync(DIST) && 'run `npm run build` first';

function sitemap(): string {
  return readFileSync(join(DIST, 'sitemap-0.xml'), 'utf8');
}

test('every page in the sitemap is a page that exists', { skip }, () => {
  const locs = [...sitemap().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length > 30, `expected the built sitemap, found ${locs.length} URLs`);
  for (const loc of locs) {
    const path = new URL(loc).pathname;
    const file = join(DIST, path, 'index.html');
    assert.ok(existsSync(file), `${path} is in the sitemap but did not build`);
  }
});

test('an empty schedule is not offered to crawlers', { skip }, () => {
  const built = readFileSync(join(DIST, 'schedule', 'index.html'), 'utf8');
  const match = built.match(/data-sessions="(\d+)"/);
  assert.ok(match, 'schedule/index.html should state how many sessions it rendered');

  const sessions = Number(match![1]);
  const listed = sitemap().includes('/schedule/');

  if (sessions === 0) {
    assert.equal(listed, false, 'schedule has no sessions and must stay out of the sitemap');
  } else {
    assert.equal(listed, true, `schedule has ${sessions} sessions and belongs in the sitemap`);
  }
});

test('the pages that do have content are all still listed', { skip }, () => {
  const xml = sitemap();
  for (const path of ['/', '/editions/', '/speakers/', '/committee/', '/venue/', '/sponsors/']) {
    assert.ok(xml.includes(`iscbsc.org${path}<`), `${path} should be in the sitemap`);
  }
});
