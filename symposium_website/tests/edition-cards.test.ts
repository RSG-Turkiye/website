import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * An edition card does not say its own title twice.
 *
 * The poster's alt text was the edition title, and the heading beside it is
 * the same string. A screen reader read every card's title twice, and
 * anyone copying the page got "12. RSG-Türkiye Öğrenci Sempozyumu / 2025 /
 * 12. RSG-Türkiye Öğrenci Sempozyumu". It was invisible on screen, which is
 * why it survived: the only card that looked different was 2023, the one
 * edition with no poster.
 *
 * Reads dist/, so it needs a build, and skips itself without one.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(DIST + 'index.html');

/** Every <img> inside an edition card, with the card's heading. */
function cards(page: string): { alt: string; heading: string }[] {
  const html = readFileSync(DIST + page, 'utf8');
  const out: { alt: string; heading: string }[] = [];
  for (const [, card] of html.matchAll(/<a[^>]+href="[^"]*\/editions\/20\d\d"[\s\S]*?<\/a>/g).map((m) => [null, m[0]] as const)) {
    const img = /<img[^>]*>/.exec(card);
    if (!img) continue; // the one edition with no poster
    const alt = /\salt="([^"]*)"/.exec(img[0])?.[1] ?? '__missing__';
    const heading = /<h2[^>]*>(.*?)<\/h2>/.exec(card)?.[1] ?? '';
    out.push({ alt, heading });
  }
  return out;
}

for (const page of ['editions/index.html', 'tr/editions/index.html']) {
  test(`${page}: a poster never repeats the heading beside it`, { skip: !built && 'no build in dist/' }, () => {
    const found = cards(page);
    assert.ok(found.length >= 5, `expected the edition cards, found ${found.length}`);
    for (const { alt, heading } of found) {
      assert.notEqual(alt, '__missing__', `a poster has no alt attribute at all (heading: ${heading})`);
      assert.equal(alt, '',
        `a poster's alt is "${alt}" while the card's heading says the same thing; ` +
        `decorative images beside their own caption take alt=""`);
    }
  });
}
