import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No internal link may point at a URL that redirects.
 *
 * The site is built in directory format, so every page lives at
 * `<path>/index.html` and Cloudflare Pages answers `/editions/2025` with a 308
 * to `/editions/2025/`. The canonical tags and the sitemap used the slash; the
 * links did not. 697 internal links across the built site -- every item in the
 * header navigation, on every page -- cost a redirect before they reached
 * anything.
 *
 * For a reader that is a shrug. For a crawler it doubles the requests needed
 * to walk the site, and Search Console was reporting 233 URLs as "Discovered
 * - currently not indexed" with "last crawled: N/A": found in the sitemap,
 * never fetched. Halving the cost of a crawl is the one lever we control.
 *
 * This reads `dist/`, so it only runs after a build. It is skipped otherwise
 * rather than passing vacuously, which would be worse than not having it.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;

/** Every path that a directory-format build actually serves. */
function pageRoutes(): Set<string> {
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'index.html') {
        const rel = relative(DIST, dir).split('\\').join('/');
        routes.add(rel === '' ? '/' : `/${rel}/`);
      }
    }
  };
  walk(DIST);
  return routes;
}

function htmlFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) htmlFiles(full, out);
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

test('no internal link points at a URL that redirects', { skip: !existsSync(DIST) && 'run `npm run build` first' }, () => {
  const routes = pageRoutes();
  assert.ok(routes.size > 20, `expected the built site, found ${routes.size} pages`);

  const offenders: string[] = [];
  for (const file of htmlFiles(DIST)) {
    const html = readFileSync(file, 'utf8');
    for (const [, href] of html.matchAll(/href="(\/[^"#?]*)"/g)) {
      if (href.endsWith('/')) continue;
      // A file, not a page: /rss.xml, /logo/x.png, /manifest.webmanifest.
      if (/\.[A-Za-z0-9]{2,5}$/.test(href)) continue;
      // Only a redirect if the slashed form is a page we actually serve.
      if (routes.has(`${href}/`)) {
        offenders.push(`${relative(DIST, file)} -> ${href}`);
      }
    }
  }

  const shown = offenders.slice(0, 15);
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} internal link(s) point at a path that 308s to its ` +
      `trailing-slash form. Add the slash at the source:\n    ${shown.join('\n    ')}` +
      `${offenders.length > shown.length ? `\n    ... and ${offenders.length - shown.length} more` : ''}\n  `,
  );
});

test('the built site is a directory-format build, which is why the above matters', () => {
  if (!existsSync(DIST)) return;
  // If this ever becomes a file-format build (/about.html), the rule above
  // inverts and this test is the thing that says so.
  assert.ok(
    existsSync(join(DIST, 'editions', 'index.html')),
    'expected dist/editions/index.html -- a directory-format build',
  );
  assert.ok(
    !existsSync(join(DIST, 'editions.html')),
    'found dist/editions.html: this is now a file-format build, and internal ' +
      'links should NOT carry a trailing slash. Revisit the rule above.',
  );
});
