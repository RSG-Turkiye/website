import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

/**
 * Every inline script on the site parses.
 *
 * `astro check` type-checks the frontmatter and the bundled `<script>` blocks.
 * It does not look inside `is:inline` scripts at all -- they are copied to the
 * output as text. Nothing else looks either, so a stray brace in one ships,
 * the browser refuses the whole script, and the page renders with a piece of
 * itself missing and no error anybody sees.
 *
 * That is not hypothetical. Editing the header's auth block left one extra
 * `})` in the promise chain; the build passed, `astro check` reported zero
 * errors, and the result was a site where signing in did nothing at all --
 * no account box, no Members link, no join button. It was caught by a browser,
 * which is a slow way to find a missing brace.
 *
 * Parsing is all this does. A script that parses can still be wrong; a script
 * that does not parse is always wrong.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;

function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** `<script>` bodies with no src and no non-JS type. */
function inlineScripts(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const attrs = match[1];
    if (/\ssrc=/.test(attrs)) continue;
    const type = /\stype="([^"]*)"/.exec(attrs)?.[1];
    if (type && !/^(module|text\/javascript|application\/javascript)$/.test(type)) continue;
    const body = match[2].trim();
    if (body) found.push(body);
  }
  return found;
}

test('every inline script in the built site parses', { skip: !existsSync(DIST) && 'no build in dist/' }, () => {
  const all = pages(DIST);
  assert.ok(all.length >= 200, `expected the built pages, found ${all.length}`);

  // One page per distinct script: the header's is on all 254 and reporting it
  // 254 times would bury anything else.
  const seen = new Set<string>();
  const broken: string[] = [];

  for (const page of all) {
    for (const source of inlineScripts(readFileSync(page, 'utf8'))) {
      if (seen.has(source)) continue;
      seen.add(source);
      try {
        // Compiled, not run: this asks whether it parses, nothing more.
        new vm.Script(source);
      } catch (error) {
        const where = page.slice(DIST.length);
        const message = error instanceof Error ? error.message : String(error);
        broken.push(`${where}: ${message}\n        ${source.slice(0, 120).replace(/\s+/g, ' ')}`);
      }
    }
  }

  assert.ok(seen.size >= 5, `expected the site's inline scripts, found ${seen.size}`);
  assert.deepEqual(broken, [], `a script the browser will refuse to run:\n    ${broken.join('\n    ')}\n  `);
});
