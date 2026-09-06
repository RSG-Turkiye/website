import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Text a reader can actually read.
 *
 * `text-gray-400` is #9ca3af, which measures 2.54:1 on white against the 4.5:1
 * WCAG asks for normal text -- and it carried the dates on the blog and
 * webinar listings, 147 uses across the site. `text-gray-300` is 1.47:1 and
 * carried a speaker count and a "no profile" placeholder.
 *
 * The ratios are computed here rather than quoted, so the numbers in the
 * comment above can be checked and a future palette change is measured
 * against the requirement rather than against a memory of it.
 */

const SRC = new URL('../src/', import.meta.url).pathname;

function relativeLuminance(hex: string): number {
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [x, y] = [relativeLuminance(a), relativeLuminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Tailwind's greys, and the two backgrounds this site puts text on. */
const GREY = { 300: 'd1d5db', 400: '9ca3af', 500: '6b7280', 600: '4b5563' };
const BACKGROUND = { white: 'ffffff', page: 'f7f7f6' };
const REQUIRED = 4.5;

test('the greys this site now uses pass on the backgrounds it uses', () => {
  for (const [name, bg] of Object.entries(BACKGROUND)) {
    assert.ok(
      contrast(GREY[500], bg) >= REQUIRED,
      `gray-500 on ${name} is ${contrast(GREY[500], bg).toFixed(2)}:1`,
    );
  }
});

test('the greys it stopped using are the reason', () => {
  // The premise, measured: without this the replacement looks arbitrary.
  assert.ok(contrast(GREY[400], BACKGROUND.white) < REQUIRED);
  assert.ok(contrast(GREY[300], BACKGROUND.white) < REQUIRED);
  assert.equal(contrast(GREY[400], BACKGROUND.white).toFixed(2), '2.54');
  assert.equal(contrast(GREY[300], BACKGROUND.white).toFixed(2), '1.47');
});

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(astro|ts)$/.test(name)) out.push(path);
  }
  return out;
}

test('no text carries a grey that fails', () => {
  // text-gray-400 stays available for borders and hover states, where the
  // requirement is different; what this forbids is putting it on text. The
  // check is deliberately blunt -- it looks for the class at all -- because
  // telling text from decoration by reading a class list is guesswork, and
  // 147 of the 147 uses turned out to be text or as good as.
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/class="[^"]*\b(text-gray-(?:300|400))\b[^"]*"/g)) {
      offenders.push(`${file.slice(SRC.length)} (${match[1]})`);
    }
  }
  assert.deepEqual(offenders, [], 'these fail 4.5:1; use text-gray-500 or darker');
});
