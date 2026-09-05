import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tagged, tagCounts, type TaggedEntry } from '../src/lib/tags';

/**
 * Which posts a tag page is built from.
 *
 * The index and the route each decided this for themselves and disagreed:
 * eighteen of the thirty-four links the index offered led to a 404, and the
 * page is in the sitemap, so those were links a search engine was invited to
 * follow. One predicate now, which is what actually fixes it -- these tests
 * pin what it means.
 */

const entry = (id: string, over: Partial<TaggedEntry['data']> = {}): TaggedEntry => ({
  id,
  data: { tags: [], ...over },
});

test('a tag page is built from its own language only', () => {
  assert.equal(tagged('en')(entry('en/post')), true);
  assert.equal(tagged('en')(entry('tr/post')), false);
  assert.equal(tagged('tr')(entry('tr/post')), true);
  assert.equal(tagged('tr')(entry('en/post')), false);
});

test('drafts and webinars are excluded, and this is the disagreement that caused the 404s', () => {
  assert.equal(tagged('en')(entry('en/post', { draft: true })), false);
  assert.equal(tagged('en')(entry('en/post', { type: 'webinar' })), false);
  assert.equal(tagged('en')(entry('en/post', { type: 'post' })), true);
  // The default: most posts declare no type at all.
  assert.equal(tagged('en')(entry('en/post', {})), true);
});

test('the index and the route ask the same question', () => {
  // Both call this; a tag the index lists is a tag the route builds, by
  // construction rather than by two people remembering the same three
  // conditions.
  const posts = [
    entry('en/a', { tags: ['genomics'] }),
    entry('en/b', { tags: ['genomics', 'rna'] }),
    entry('en/draft', { tags: ['secret'], draft: true }),
    entry('en/talk', { tags: ['webinar-only'], type: 'webinar' }),
    entry('tr/c', { tags: ['gen-ifadesi'] }),
  ];
  const forIndex = posts.filter(tagged('en'));
  const listed = tagCounts(forIndex).map(([tag]) => tag);
  const built = [...new Set(posts.filter(tagged('en')).flatMap((p) => p.data.tags ?? []))].sort();
  assert.deepEqual(listed, built);
  assert.deepEqual(listed, ['genomics', 'rna'], 'no draft, no webinar, no Turkish tag');
});

test('counts are per tag and the order does not depend on the loader', () => {
  const posts = [
    entry('en/a', { tags: ['zeta', 'alpha'] }),
    entry('en/b', { tags: ['alpha'] }),
  ];
  assert.deepEqual(tagCounts(posts.filter(tagged('en'))), [['alpha', 2], ['zeta', 1]]);
});

test('a post with no tags contributes nothing', () => {
  assert.deepEqual(tagCounts([entry('en/a'), entry('en/b', { tags: [] })]), []);
});
