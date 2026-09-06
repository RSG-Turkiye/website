import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The type check has to be able to run.
 *
 * `astro check` exits 0 when @astrojs/check or typescript is missing. It
 * prints "The `@astrojs/check` and `typescript` packages are required for this
 * command to work" and then reports success, so a CI step that runs it looks
 * green while checking nothing. This site's step was in exactly that state
 * from the day it was added until 2026-09-06: every green tick was empty.
 *
 * It went unnoticed because it works locally -- npx fetches the missing
 * package on demand, and `npm ci` in CI does not.
 *
 * Nothing was hiding behind it, as it turned out: the first real run reported
 * 0 errors across 49 files. That is luck rather than a reason to leave it, and
 * this is the cheapest thing that turns the luck into a guarantee.
 */

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { devDependencies?: Record<string, string> };

for (const name of ['@astrojs/check', 'typescript']) {
  test(`${name} is a declared dependency, not one npx happens to fetch`, () => {
    assert.ok(
      pkg.devDependencies?.[name],
      `astro check reports success without ${name} installed, so CI would pass ` +
        `while checking nothing. npm ci installs only what package.json declares.`,
    );
  });
}
