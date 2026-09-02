import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternatesFor } from '../src/lib/hreflang';

test('every mirrored page is paired with its counterpart', () => {
  assert.deepEqual(alternatesFor('/venue/'), { en: '/venue/', tr: '/tr/venue/' });
  assert.deepEqual(alternatesFor('/schedule/'), { en: '/schedule/', tr: '/tr/schedule/' });
  assert.deepEqual(alternatesFor('/committee/'), { en: '/committee/', tr: '/tr/committee/' });
  assert.deepEqual(alternatesFor('/editions/2024/'), { en: '/editions/2024/', tr: '/tr/editions/2024/' });
});

test('the pairing is reciprocal, or Google ignores it', () => {
  for (const [en, tr] of [['/', '/tr/'], ['/venue/', '/tr/venue/'], ['/sponsors/', '/tr/sponsors/']]) {
    assert.deepEqual(alternatesFor(en), alternatesFor(tr), `${en} and ${tr} must agree`);
  }
});

test('the home pages pair with each other', () => {
  assert.deepEqual(alternatesFor('/'), { en: '/', tr: '/tr/' });
  assert.deepEqual(alternatesFor('/tr'), { en: '/', tr: '/tr/' });
});

test('404 has no counterpart', () => {
  assert.equal(alternatesFor('/404'), null);
});

test('trailing slashes do not change the answer', () => {
  assert.deepEqual(alternatesFor('/venue'), alternatesFor('/venue/'));
});

test('a path merely starting with tr is not the turkish prefix', () => {
  assert.deepEqual(alternatesFor('/transcriptomics/'), { en: '/transcriptomics/', tr: '/tr/transcriptomics/' });
});
