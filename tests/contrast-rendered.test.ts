import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, type HTMLElement } from 'node-html-parser';
import {
  colorOf,
  composite,
  contrast,
  required,
  TOKENS,
  GREY,
  REQUIRED_NORMAL,
  isLargeText,
} from '../src/lib/contrast';

/**
 * Every piece of text on both sites, measured against what is behind it.
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
 * It reports one line per distinct colour-on-background combination rather
 * than per element, because 290 pages share one footer and the fix is the
 * same everywhere.
 */

const DIST = [
  new URL('../dist/', import.meta.url).pathname,
  new URL('../symposium_website/dist/', import.meta.url).pathname,
];

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

interface Failure {
  combination: string;
  ratio: number;
  need: number;
  sample: string;
  page: string;
}

function scan(roots: string[]): Failure[] {
  const worst = new Map<string, Failure>();

  for (const root of roots) {
    for (const page of pages(root)) {
      const body = parse(readFileSync(page, 'utf8')).querySelector('body');
      if (!body) continue;

      const walk = (el: HTMLElement, background: string) => {
        const classes = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

        const bg = classes.map((c) => colorOf(c, 'bg')).find(Boolean);
        const here = bg ? (bg.alpha < 1 ? composite(bg.hex, bg.alpha, background) : bg.hex) : background;

        const fg = classes.map((c) => colorOf(c, 'text')).find(Boolean);
        if (fg) {
          // Only text this element owns; a child with its own colour is
          // measured when the walk reaches it.
          const own = el.childNodes
            .filter((n) => n.nodeType === 3)
            .map((n) => n.rawText.trim())
            .join(' ')
            .trim();
          if (own) {
            const colour = fg.alpha < 1 ? composite(fg.hex, fg.alpha, here) : fg.hex;
            const ratio = contrast(colour, here);
            const need = required(classes);
            if (ratio < need) {
              const name = classes.find((c) => colorOf(c, 'text'))!;
              const key = `${name} on #${here}`;
              const existing = worst.get(key);
              if (!existing || ratio < existing.ratio) {
                worst.set(key, {
                  combination: key,
                  ratio,
                  need,
                  sample: own.replace(/\s+/g, ' ').slice(0, 45),
                  page: page.slice(page.lastIndexOf('/dist/') + 5),
                });
              }
            }
          }
        }

        for (const child of el.childNodes) {
          if ((child as HTMLElement).tagName) walk(child as HTMLElement, here);
        }
      };

      walk(body, TOKENS.neutral);
    }
  }
  return [...worst.values()].sort((a, b) => a.ratio - b.ratio);
}

test('no text on either site falls below its WCAG AA contrast ratio', { skip: !DIST.every(existsSync) && 'no build in dist/' }, () => {
  const failures = scan(DIST);
  const report = failures
    .map((f) => `${f.ratio.toFixed(2)}:1 (needs ${f.need})  ${f.combination}\n        "${f.sample}"  ${f.page}`)
    .join('\n    ');
  assert.deepEqual(failures, [], `text a reader cannot read:\n    ${report}\n  `);
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
