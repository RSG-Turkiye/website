import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPublishError } from '../src/scripts/social/messages';

test('splitPublishError separates the key from the provider detail', () => {
  assert.deepEqual(splitPublishError('bad_ratio: ratio'), { key: 'bad_ratio', detail: 'ratio' });
  assert.deepEqual(splitPublishError('auth'), { key: 'auth', detail: '' });
  assert.deepEqual(splitPublishError('unknown: '), { key: 'unknown', detail: '' });
  assert.deepEqual(splitPublishError('a: b: c'), { key: 'a', detail: 'b: c' });
});
