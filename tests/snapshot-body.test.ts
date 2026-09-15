import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotPrTitle, snapshotPrBody, archivePrTitle, archivePrBody } from '../functions/_lib/archive';

test('a snapshot does not tell the reader the symposium has ended', () => {
  // The same branch carries both, for a year. The archive body says "merge
  // this promptly" because the programme is missing from the live site; a
  // snapshot opened ten months early must not say that, or it trains everyone
  // to ignore the one that means it.
  const body = snapshotPrBody(2026);
  assert.ok(!/has ended/i.test(body), 'a snapshot must not claim the edition is over');
  assert.ok(!/promptly/i.test(body), 'a snapshot is not urgent');
  assert.ok(/2026/.test(body));
});

test('a snapshot says merging is optional and what merging buys', () => {
  assert.ok(/optional/i.test(snapshotPrBody(2026)));
});

test('a snapshot tells its merger not to squash it', () => {
  // The branch is long lived and written again the next day. A squash leaves
  // it permanently ahead of main, so every following run reopens a pull
  // request proposing a file main already has. This is the only place that
  // rule is written down where the person merging will see it.
  const body = snapshotPrBody(2026);
  assert.ok(/merge commit/i.test(body));
  assert.ok(/not a squash/i.test(body));
});

test('the archive body still says the edition has ended', () => {
  assert.ok(/has ended/i.test(archivePrBody(2026)));
});

test('the two titles are distinguishable at a glance in a pull request list', () => {
  assert.notEqual(snapshotPrTitle(2026), archivePrTitle(2026));
  assert.ok(snapshotPrTitle(2026).includes('2026'));
  assert.ok(archivePrTitle(2026).includes('2026'));
});
