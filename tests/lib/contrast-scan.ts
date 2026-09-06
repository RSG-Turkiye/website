import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { colorOf, composite, contrast, required, TOKENS } from '../../src/lib/contrast';

/**
 * Measuring text against what is actually behind it.
 *
 * Not a test file -- `npm test` globs tests/*.test.ts, so this sits one level
 * down and is imported by the two that are: the main site's
 * tests/contrast-rendered.test.ts and symposium_website/tests/contrast.test.ts.
 *
 * It lives in one place because the two sites share a palette and a set of
 * mistakes, and because a rule written down twice is the bug this repository
 * keeps finding. CI runs the sites as separate jobs with separate working
 * directories, so each job scans its own build and neither can silently skip.
 *
 * The HTML parser is passed in rather than imported. This file sits in the
 * root package, so a bare `node-html-parser` import here resolves against the
 * root's node_modules -- which the symposium job does not install, and the
 * first attempt died there with ERR_MODULE_NOT_FOUND. Both packages have the
 * dependency; each caller hands in its own copy, and this file has no
 * third-party import to resolve.
 */

/** The shape of node-html-parser's element, reduced to what the walk uses. */
export interface ParsedElement {
  tagName?: string;
  getAttribute(name: string): string | undefined;
  childNodes: { nodeType: number; rawText: string }[];
  querySelector(selector: string): ParsedElement | null;
}

/** node-html-parser's `parse`, supplied by the caller. */
export type Parse = (html: string) => ParsedElement;

export interface Failure {
  combination: string;
  ratio: number;
  need: number;
  sample: string;
  page: string;
}

/** Every rendered page under `dir`. */
export function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

/**
 * Walks the given builds, carrying the nearest ancestor background down the
 * tree, and returns the worst example of each distinct colour-on-background
 * combination that falls below its required ratio.
 *
 * One line per combination rather than per element: 290 pages share one
 * footer, and the fix is the same everywhere.
 */
export function scan(roots: string[], parse: Parse): Failure[] {
  const worst = new Map<string, Failure>();

  for (const root of roots) {
    for (const page of pages(root)) {
      const body = parse(readFileSync(page, 'utf8')).querySelector('body');
      if (!body) continue;

      const walk = (el: ParsedElement, background: string) => {
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
          const asElement = child as unknown as ParsedElement;
          if (asElement.tagName) walk(asElement, here);
        }
      };

      walk(body, TOKENS.neutral);
    }
  }
  return [...worst.values()].sort((a, b) => a.ratio - b.ratio);
}

/** The report string a failing assertion prints. */
export function report(failures: Failure[]): string {
  return failures
    .map((f) => `${f.ratio.toFixed(2)}:1 (needs ${f.need})  ${f.combination}\n        "${f.sample}"  ${f.page}`)
    .join('\n    ');
}
