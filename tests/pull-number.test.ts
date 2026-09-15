import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullNumberFromUrl } from '../functions/_lib/github';

test('a pull request URL yields its number', () => {
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/226'), 226);
});

test('a trailing slash is not a different pull request', () => {
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/226/'), 226);
});

test('an issue is not a pull request', () => {
  // notifyNewSubmission opens issues against the same repository, so an
  // issue URL landing in this column is a mistake worth refusing rather
  // than reading a number out of.
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/issues/226'), null);
});

test('anything else is refused rather than guessed at', () => {
  assert.equal(pullNumberFromUrl(''), null);
  assert.equal(pullNumberFromUrl('not a url'), null);
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/abc'), null);
});
