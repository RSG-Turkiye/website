import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Which requests wake the Worker.
 *
 * _routes.json said `include: ["/*"]`, which is Cloudflare Pages' default and
 * means every request invokes the Pages Function -- every page, every
 * stylesheet, every hashed asset in /_astro/, every logo. The Worker looks for
 * a handler, finds none, and hands the request back to static serving. The
 * response is the same either way; what it costs is an invocation and a few
 * milliseconds on every asset of every page view.
 *
 * There is no root _middleware.ts, and every function in this repository lives
 * under functions/api/ or functions/auth/, so those two prefixes are the whole
 * of it. That is an easy thing to break by adding functions/webhook.ts and not
 * thinking about this file, and the failure is silent in the worst direction:
 * the endpoint 404s in production while working perfectly in dev.
 *
 * So this reads the functions directory and requires every route it defines to
 * be covered by an include rule.
 */

const FUNCTIONS = new URL('../functions/', import.meta.url).pathname;
const ROUTES = new URL('../public/_routes.json', import.meta.url).pathname;

/** Every file under functions/ that Pages turns into a route. */
function routeFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    // A leading underscore is Pages' own convention for "not a route":
    // _lib/, _middleware.ts. Middleware is not a route but it does run, and
    // only on included paths -- if one ever appears at the root, this test
    // should be revisited rather than passed.
    if (name.startsWith('_') && name !== '_middleware.ts') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) routeFiles(path, out);
    else if (/\.(ts|js)$/.test(name)) out.push('/' + relative(FUNCTIONS, path).replace(/\.(ts|js)$/, ''));
  }
  return out;
}

/** Does an include rule cover this path? Pages matches a literal prefix and a trailing /*. */
const covers = (rule: string, path: string): boolean =>
  rule.endsWith('/*') ? path.startsWith(rule.slice(0, -1)) : rule === path;

test('every function this repo defines is on a route the Worker is asked about', () => {
  const routes = JSON.parse(readFileSync(ROUTES, 'utf8')) as { include: string[]; exclude: string[] };
  const files = routeFiles(FUNCTIONS);
  assert.ok(files.length >= 15, `expected the API surface, found ${files.length}`);

  const orphans = files.filter((f) => !routes.include.some((rule) => covers(rule, f))).sort();
  assert.deepEqual(
    orphans,
    [],
    `These functions exist and no include rule reaches them, so they would 404 ` +
      `in production while working in dev:\n    ${orphans.join('\n    ')}\n  ` +
      `Add the prefix to public/_routes.json.`,
  );
});

test('the Worker is not asked about static assets', () => {
  // The point of the file. `/*` here is the default and costs an invocation
  // per asset; if it ever comes back, the test above would still pass.
  const routes = JSON.parse(readFileSync(ROUTES, 'utf8')) as { include: string[] };
  assert.ok(!routes.include.includes('/*'), 'include: ["/*"] wakes the Worker for every request');
  for (const asset of ['/_astro/index.abc123.css', '/logo/rsgturkey_logo.png', '/blog/index.html', '/']) {
    assert.ok(
      !routes.include.some((rule) => covers(rule, asset)),
      `${asset} should be served statically`,
    );
  }
});

test('the routes the site actually calls are included', () => {
  // Named rather than derived, because these are what the pages fetch: if a
  // rewrite ever moved them, this is the list that has to move with them.
  const routes = JSON.parse(readFileSync(ROUTES, 'utf8')) as { include: string[] };
  for (const path of ['/api/me', '/api/members', '/api/announcements', '/auth/login', '/auth/callback', '/auth/logout']) {
    assert.ok(routes.include.some((rule) => covers(rule, path)), `${path} must reach the Worker`);
  }
});
