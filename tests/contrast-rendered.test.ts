import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  colorOf,
  composite,
  contrast,
  isLargeText,
  GREY,
  TOKENS,
  REQUIRED_NORMAL,
} from '../src/lib/contrast';
import { report, scan } from './lib/contrast-scan';

/**
 * Every piece of text on this site, measured against what is behind it.
 *
 * The class-list test next door forbids two greys by name. That caught the
 * worst of it and cannot catch the rest, because whether text is readable
 * depends on the background, and the background comes from an ancestor: the
 * same `text-gray-500` is 4.83:1 on white, 4.51:1 on the page's own off-white
 * and 4.28:1 inside a navy-light card -- passing, passing, failing. Reading
 * that off a source file is guesswork.
 *
 * So this walks the rendered pages, carries the nearest ancestor background
 * down the tree, composites any alpha (`text-white/40` is a real colour once
 * you know what it sits on), and reports anything under the WCAG AA ratio for
 * its size.
 *
 * The measuring lives in tests/lib/contrast-scan.ts because the symposium
 * site runs the same scan over its own build, in its own CI job. It reports
 * one line per distinct colour-on-background combination rather than per
 * element, because 290 pages share one footer and the fix is the same
 * everywhere.
 */

/**
 * The main site's build is always there when this runs; the symposium's is
 * there locally and not in CI, where the two sites are separate jobs with
 * separate working directories. So this scans whichever exist and says which,
 * and symposium_website/tests/contrast.test.ts covers the other half inside
 * that job -- both import the same measuring code.
 */
const MAIN = new URL('../dist/', import.meta.url).pathname;

test('no text on the main site falls below its WCAG AA contrast ratio', { skip: !existsSync(MAIN) && 'no build in dist/' }, () => {
  const failures = scan([MAIN]);
  assert.deepEqual(failures, [], `text a reader cannot read:\n    ${report(failures)}\n  `);
});

// --- the numbers the fixes were chosen from -----------------------------------

test('the greys, on every background this site puts them on', () => {
  // Quoted in the commit that changed them; checked here so the quote stays
  // true if the palette moves.
  const on = (grey: string, bg: string) => Number(contrast(GREY[grey], bg).toFixed(2));
  assert.equal(on('400', TOKENS.white), 2.54, 'gray-400 fails on white');
  assert.equal(on('400', TOKENS['navy-light']), 2.25);
  assert.equal(on('500', TOKENS.white), 4.83, 'gray-500 passes on white');
  assert.equal(on('500', TOKENS.neutral), 4.51, 'and just passes on the page background');
  assert.equal(on('500', TOKENS['navy-light']), 4.28, 'and fails inside a navy-light card');
  assert.equal(on('600', TOKENS['navy-light']), 6.68, 'which is why those became gray-600');
});

test('white at 40 per cent on navy is not readable, and at 50 it is', () => {
  const onNavy = (pct: number) => contrast(composite(TOKENS.white, pct / 100, TOKENS.navy), TOKENS.navy);
  assert.ok(onNavy(40) < REQUIRED_NORMAL, `${onNavy(40).toFixed(2)}:1`);
  assert.equal(onNavy(40).toFixed(2), '3.60', 'both footers used this for the copyright line');
  assert.ok(onNavy(50) >= REQUIRED_NORMAL, `${onNavy(50).toFixed(2)}:1`);
});

test('large text is held to 3:1, and only when it really is large', () => {
  assert.equal(isLargeText(['text-3xl']), true);
  assert.equal(isLargeText(['text-2xl']), true);
  assert.equal(isLargeText(['text-xl', 'font-bold']), true);
  assert.equal(isLargeText(['text-xl']), false, '20px on its own is not large');
  assert.equal(isLargeText(['text-lg', 'font-bold']), false, '18px is under 18.66');
  assert.equal(isLargeText([]), false, 'no size class means body text, the stricter guess');
});

test('a colour class the palette does not define is ignored rather than guessed at', () => {
  assert.equal(colorOf('text-[#123456]', 'text')?.hex, '123456');
  assert.deepEqual(colorOf('text-white/40', 'text'), { hex: 'ffffff', alpha: 0.4 });
  assert.equal(colorOf('text-emerald-500', 'text'), null);
  assert.equal(colorOf('text-gray-500', 'bg'), null);
});
