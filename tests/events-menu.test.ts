import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The symposium, workshops and hackathons sit under one "Events" menu item.
 * Reads dist/, so it needs a build.
 */
const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(`${DIST}index.html`);

test('the Events menu holds all events, the symposium, and workshops & hackathons, in each language', { skip: !built && 'no build in dist/' }, () => {
  for (const [page, prefix, symposium] of [
    ['index.html', '', 'https://symposium.rsg-turkiye.iscbsc.org/'],
    ['tr/index.html', '/tr', 'https://symposium.rsg-turkiye.iscbsc.org/tr/'],
  ] as const) {
    const html = readFileSync(`${DIST}${page}`, 'utf8');
    // The dropdown that follows the top-level Events link, up to its closing tag.
    const top = html.indexOf(`href="${prefix}/events/" class="nav-link"`);
    assert.ok(top !== -1, `${page}: no top-level Events link`);
    const open = html.indexOf('class="dropdown-menu', top);
    const menu = html.slice(open, html.indexOf('</div>', open));
    for (const href of [`${prefix}/events/`, symposium, `${prefix}/workshops/`]) {
      assert.ok(menu.includes(`href="${href}"`), `${page}: Events menu lacks ${href}`);
    }
  }
});

test('the signed-in-only members link stays hidden on phones until shown', () => {
  // .mobile-link's display:block used to outrank the hidden utility.
  const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url).pathname, 'utf8');
  assert.match(header, /\.mobile-link\.hidden\s*\{\s*display:\s*none;/);
  assert.match(header, /id="membersMobileLink"[^>]*class="mobile-link hidden"/);
});
