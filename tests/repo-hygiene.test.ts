import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

/**
 * Things that must not be committed to a public repository.
 *
 * This is public, and on 2026-09-06 it held a 1.8 MB WordPress export
 * carrying the email addresses of 76 authors and commenters -- other people's
 * personal data, published for months by nobody's decision. The .gitignore
 * rule that was meant to stop it named one specific filename, and the export
 * that landed had a different date.
 *
 * A rule nothing enforces is a rule that gets forgotten by the next volunteer,
 * and this team turns over every year. So the test asks git what is actually
 * tracked, rather than trusting the ignore file.
 */

const tracked = (): string[] =>
  execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    .split('\0')
    .filter(Boolean);

test('no WordPress export is committed', () => {
  const exports_ = tracked().filter((f) => /wordpress.*\.xml$/i.test(f));
  assert.deepEqual(
    exports_,
    [],
    'A WordPress export carries every author and commenter email. It is a ' +
      'migration input; keep it on the machine doing the migration.',
  );
});

test('no tracked file is a bulk list of email addresses', () => {
  // The filename is the obvious tell and the weakest one -- an export renamed
  // to anything at all would pass the test above. Content is what matters.
  const suspicious: string[] = [];
  for (const file of tracked()) {
    if (!/\.(xml|csv|json|txt|sql)$/i.test(file)) continue;
    let size: number;
    try {
      size = statSync(file).size;
    } catch {
      continue; // deleted in the index, nothing to read
    }
    if (size > 8 * 1024 * 1024) continue; // package-lock and friends
    const text = readFileSync(file, 'utf8');
    const addresses = new Set(
      (text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []).map((a) => a.toLowerCase()),
    );
    if (addresses.size >= 10) suspicious.push(`${file} (${addresses.size} addresses)`);
  }
  assert.deepEqual(suspicious, [], 'These look like bulk personal data in a public repository');
});
