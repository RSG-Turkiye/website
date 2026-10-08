import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ui } from '../src/i18n/ui';

/**
 * The opportunity board's two pages. The list itself is filled in by the
 * browser from /api/opportunities, so what the build can promise is the
 * shell: the list element, the no-JavaScript fallback, the hreflang pair
 * (the slugs differ, so it cannot be derived), and the Slack line.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;
const SRC = new URL('../src/', import.meta.url).pathname;
const skip = !existsSync(DIST) && 'no build in dist/';

const PAGES = [
  { lang: 'en' as const, file: 'opportunities/index.html', twin: '/tr/firsatlar/', join: '/join/' },
  { lang: 'tr' as const, file: 'tr/firsatlar/index.html', twin: '/opportunities/', join: '/tr/join/' },
];

for (const p of PAGES) {
  test(`${p.file} has the list, the RSS fallback, the hreflang twin and the Slack line`, { skip }, () => {
    const html = readFileSync(join(DIST, p.file), 'utf8');
    assert.match(html, /id="opportunityList"/);
    assert.match(html, /<noscript>[\s\S]*?href="\/api\/opportunities\/rss\.xml"[\s\S]*?<\/noscript>/);
    assert.match(
      html,
      new RegExp(`<link rel="alternate" hreflang="${p.lang === 'en' ? 'tr' : 'en'}" href="https://[^"]+${p.twin.replace(/\//g, '\\/')}"`),
    );
    assert.ok(html.includes(ui[p.lang]['opps.slack']), 'Slack line missing');
    assert.ok(html.includes(`href="${p.join}"`), `Slack line should link ${p.join}`);
    for (const g of ['funding', 'positions', 'learning', 'events']) {
      assert.ok(html.includes(`data-group="${g}"`), `filter ${g} missing`);
    }
  });
}

test('both languages define every opps key', () => {
  const keys = (l: 'en' | 'tr') => Object.keys(ui[l]).filter((k) => k.startsWith('opps.')).sort();
  assert.ok(keys('en').length >= 11);
  assert.deepEqual(keys('tr'), keys('en'));
});

test('the page script never uses innerHTML, because titles come from other sites', () => {
  for (const f of ['pages/opportunities.astro', 'pages/tr/firsatlar.astro']) {
    assert.ok(!/innerHTML|insertAdjacentHTML|set:html/.test(readFileSync(join(SRC, f), 'utf8')), f);
  }
});
