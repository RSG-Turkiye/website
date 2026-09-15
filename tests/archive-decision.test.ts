import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveDecision } from '../functions/_lib/symposium';

test('a row nobody has archived yet needs a pull request', () => {
  assert.deepEqual(
    archiveDecision({ archived_pr_url: null, archived_at: null }),
    { action: 'open-pr' },
  );
});

test('a row with a pull request and no merge is the case this phase exists for', () => {
  // The old code treated this as done and retired the edition. It is not
  // done: the content is in a branch nobody has merged.
  assert.deepEqual(
    archiveDecision({ archived_pr_url: 'https://github.com/o/r/pull/7', archived_at: null }),
    { action: 'check-merge' },
  );
});

test('a merged row is finished', () => {
  assert.deepEqual(
    archiveDecision({ archived_pr_url: 'https://github.com/o/r/pull/7', archived_at: 1789000000 }),
    { action: 'skip' },
  );
});

test('a merge stamp with no pull request is still finished', () => {
  // Not reachable through the routes, but a hand-run backfill can produce
  // it, and "merged" must win over "no URL on file" rather than reopening a
  // pull request for an edition that is already in the repository.
  assert.deepEqual(
    archiveDecision({ archived_pr_url: null, archived_at: 1789000000 }),
    { action: 'skip' },
  );
});
