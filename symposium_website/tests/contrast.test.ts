import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pages, report, scan } from '../../tests/lib/contrast-scan';

/**
 * The symposium half of the contrast scan.
 *
 * CI runs the two sites as separate jobs with separate working directories,
 * so the main site's test only ever sees its own build over there. A check
 * that silently skips in the one place it needs to run is not a check -- this
 * one runs inside the symposium job.
 *
 * It imports the measuring code across the package boundary rather than
 * keeping a second copy: the two sites share a palette and a set of mistakes,
 * and a rule written down twice is the bug this repository keeps finding.
 * They are one repository and node-html-parser is a devDependency of both.
 *
 * The class-name check for this source tree lives in the main site's
 * tests/contrast.test.ts, which reads both source directories.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(DIST);

test('no text on the symposium site falls below its WCAG AA contrast ratio', { skip: !built && 'no build in dist/' }, () => {
  const failures = scan([DIST]);
  assert.deepEqual(failures, [], `text a reader cannot read:\n    ${report(failures)}\n  `);
});

test('the scan actually looked at the pages', { skip: !built && 'no build in dist/' }, () => {
  // A scan that finds no pages finds no failures. This is the difference
  // between "clean" and "did not run".
  const found = pages(DIST);
  assert.ok(found.length >= 30, `expected the symposium's pages, found ${found.length}`);
  assert.ok(
    found.some((p) => readFileSync(p, 'utf8').includes('text-gray-')),
    'and pages that actually carry the classes being measured',
  );
});
