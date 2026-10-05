import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * When guidelines exist, the home page offers a route to them.
 *
 * The abstract button opens a submission form directly. Without a link beside
 * it, the only way to the word limit, the PDF requirements and the
 * one-submission rule is the nav, so somebody who came to submit reads none of
 * it and submits wrong. The page existing is not the same as it being
 * reachable from where people land.
 *
 * Reads the built pages rather than the component, because the failure this
 * guards against is a page that stops passing the prop, which a unit test of
 * the component cannot see.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const GUIDELINES = join(ROOT, 'src/content/guidelines');


/**
 * The part of the page holding the call-to-action buttons: after the
 * countdown, which sits inside the hero and below the header, and before the
 * about section. Slicing from the top of the document instead catches the
 * nav's own link and makes the assertion vacuous.
 */
function ctaArea(html: string): string {
  const start = html.indexOf('id="countdown"');
  const end = html.indexOf('id="about"');
  assert.ok(start > 0 && end > start, 'could not locate the hero call-to-action area');
  return html.slice(start, end);
}

const haveGuidelines = existsSync(GUIDELINES) && readdirSync(GUIDELINES).some((f) => f.endsWith('.md'));

test('the home page links to the guidelines', {
  skip: (!existsSync(DIST) && 'run `npm run build` first') || (!haveGuidelines && 'no guidelines written'),
}, () => {
  const en = readFileSync(join(DIST, 'index.html'), 'utf8');
  const tr = readFileSync(join(DIST, 'tr/index.html'), 'utf8');

  // Not merely present somewhere on the page: the nav carries it too, and the
  // nav is exactly the route people were not taking. It has to be beside the
  // buttons, so the slice starts AFTER the header. Written the obvious way
  // first, from the top of the document, this test passed with the link
  // removed -- it was reading the nav.
  const heroEn = ctaArea(en);
  const heroTr = ctaArea(tr);

  assert.ok(heroEn.includes('href="/abstracts/"'), 'the English hero offers no route to the guidelines');
  assert.ok(heroTr.includes('href="/tr/abstracts/"'), 'the Turkish hero offers no route to the guidelines');
});

test('each language links to its own guidelines page', {
  skip: (!existsSync(DIST) && 'run `npm run build` first') || (!haveGuidelines && 'no guidelines written'),
}, () => {
  const tr = readFileSync(join(DIST, 'tr/index.html'), 'utf8');
  const heroTr = ctaArea(tr);
  assert.ok(!heroTr.includes('href="/abstracts/"'), 'the Turkish hero links to the English page');
});
