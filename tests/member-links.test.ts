import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Member profiles are served through a placeholder rule in public/_redirects
 * (/members/:username, and the /tr twin). Cloudflare matches it only without a
 * trailing slash: /members/ayse is the profile, /members/ayse/ is a 404. The
 * directory cards gained a slash in #194 and every card was a dead link.
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url).pathname, 'utf8');

test('links to a member profile carry no trailing slash', () => {
  for (const file of ['src/pages/members.astro', 'src/pages/tr/members.astro', 'src/pages/search.astro', 'src/pages/tr/search.astro']) {
    const text = read(file);
    const links = [...text.matchAll(/(?:href="|url: `)(\/(?:tr\/)?members\/\$\{[^`"]*?)["`]/g)].map((m) => m[1]);
    assert.ok(links.length > 0 || file.includes('search'), `${file}: no member link found; has the markup changed?`);
    for (const link of links) assert.ok(!link.endsWith('/'), `${file}: ${link} ends in a slash`);
  }
});

test('both languages have the profile rewrite', () => {
  const rules = read('public/_redirects');
  assert.match(rules, /^\/members\/:username\s+\/members\/profile\/\?u=:username\s+200$/m);
  assert.match(rules, /^\/tr\/members\/:username\s+\/tr\/members\/profile\/\?u=:username\s+200$/m);
});
