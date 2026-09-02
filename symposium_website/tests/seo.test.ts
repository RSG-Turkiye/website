import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HOST = 'https://symposium.rsg-turkiye.iscbsc.org';

// Read as text, not imported. Importing astro.config.mjs under node:test pulls
// in Astro's config machinery and dies with ERR_PACKAGE_PATH_NOT_EXPORTED from
// a transitive dependency.
const config = readFileSync('astro.config.mjs', 'utf8');

test('the canonical host is the live symposium domain', () => {
  // Astro derives every canonical tag, og:url and sitemap entry from `site`.
  // Pointing it at the parked rsgturkey.com would hand Google a sitemap of
  // dead URLs.
  assert.ok(config.includes(`site: '${HOST}'`), 'site must be the live host');
});

test('no dead domain survives in the config', () => {
  assert.ok(!config.includes('rsgturkey.com'), 'rsgturkey.com is parked');
});
