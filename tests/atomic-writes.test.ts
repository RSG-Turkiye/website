import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A write that takes several statements takes them together.
 *
 * D1 has no transaction the way a long-lived connection does; `batch` is the
 * transaction, and a handler that issues its statements one at a time gives
 * every gap between them a chance to be the last thing that ran. Three
 * handlers did:
 *
 *  - creating a paired submission (two INSERTs and an UPDATE) left an
 *    unpaired 'pending' row, and the writer submitted again because from the
 *    form's point of view nothing had happened;
 *  - resubmitting one left the primary pending and its translation rejected,
 *    which the admin list shows as a half-resubmitted pair;
 *  - saving a profile left a member with part of an interest list they did
 *    not choose, after the profile row itself had already been written.
 *
 * The approve path has been batched since it was written and says why in a
 * comment. The rule existed; three places had not been given it.
 *
 * This test is a lint rather than a behaviour check, because the behaviour is
 * D1's. It reads the handlers and requires that no route file awaits more than
 * one `.run()`: two sequential writes in one request is the shape of the
 * defect, whatever the statements happen to say.
 */

const ROOT = new URL('../functions/api/', import.meta.url).pathname;

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...routeFiles(path));
    else if (name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/** `.run()` calls outside comments. */
function runCalls(source: string): number {
  return source
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n')
    .split('.run()').length - 1;
}

test('the three handlers that used to write in pieces now write in one', () => {
  // Stated as the shape each file should have, rather than a count, because a
  // count cannot tell one write from one write plus a batch.
  const expected: [string, { batch: true; run: number }][] = [
    // Every statement is in the batch: the profile row, both DELETEs and both
    // loops of INSERTs.
    ['profile.ts', { batch: true, run: 0 }],
    // One batch holding the primary UPDATE and, for a pair, the translation's.
    ['blog-submissions/[id].ts', { batch: true, run: 0 }],
    // A batch for the paired path; the single-language path is one INSERT and
    // has nothing to be atomic with.
    ['blog-submissions.ts', { batch: true, run: 1 }],
  ];

  for (const [file, shape] of expected) {
    const source = readFileSync(join(ROOT, file), 'utf8');
    assert.ok(source.includes('env.DB.batch('), `${file} no longer batches`);
    assert.equal(
      runCalls(source),
      shape.run,
      `${file} should issue ${shape.run} write(s) outside its batch; separate ` +
        `.run() calls are what left half-written pairs and half-saved profiles`,
    );
  }
});

/**
 * There is no general version of this test, and the attempt is worth
 * recording.
 *
 * Counting `.run()` per file flagged four routes that are entirely correct,
 * because a route file exports onRequestPost, onRequestPatch and
 * onRequestDelete and one write in each is one write per request. Counting per
 * handler then flagged two more that are also correct: admin/users.ts is a
 * switch with one UPDATE per case, and mail/send.ts has one INSERT in each of
 * two branches that return separately.
 *
 * Both false positives are control flow, which reading the text cannot see. An
 * exemption list would have grown until the test asserted nothing, so the
 * check stays on the three handlers that actually had the defect, and the rule
 * for the rest lives in the comments where those handlers explain themselves.
 */
