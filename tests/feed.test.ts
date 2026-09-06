import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedItems, type FeedEntry } from '../src/lib/feed';

/**
 * Every link in the blog feed used to 404.
 *
 * `post.id` already carries the language folder -- `en/a-post` -- and the
 * route pasted the language prefix on as well, so subscribers were sent to
 * /blog/en/a-post/ and /tr/blog/tr/…. All seventy items, for as long as the
 * feed has existed, and nothing would ever have said so: a feed reader shows
 * a title and a date whether or not the link works.
 */

const entry = (id: string, over: Partial<FeedEntry['data']> = {}): FeedEntry => ({
  id,
  data: {
    title: 'A post',
    pubDate: new Date('2026-01-01'),
    description: 'About something',
    tags: [],
    ...over,
  },
});

test('a link is the language prefix plus the slug, and the slug only once', () => {
  const items = feedItems([entry('en/a-post')], 'en');
  assert.equal(items[0].link, '/blog/a-post/');
});

test('the Turkish feed points at the Turkish page', () => {
  const items = feedItems([entry('tr/bir-yazi')], 'tr');
  assert.equal(items[0].link, '/tr/blog/bir-yazi/');
});

test('no link ever contains the folder twice', () => {
  // The exact shape of the defect: /blog/en/… and /tr/blog/tr/….
  const posts = [entry('en/a'), entry('tr/b')];
  for (const lang of ['en', 'tr'] as const) {
    for (const item of feedItems(posts, lang)) {
      assert.ok(!item.link.includes('/blog/en/'), item.link);
      assert.ok(!item.link.includes('/blog/tr/'), item.link);
    }
  }
});

test('each feed carries only its own language', () => {
  const posts = [entry('en/a'), entry('en/b'), entry('tr/c')];
  assert.equal(feedItems(posts, 'en').length, 2);
  assert.equal(feedItems(posts, 'tr').length, 1);
});

test('the folder decides the language, not the frontmatter field', () => {
  // Three posts in blog/en/ are stamped lang: "tr". Routing on that field sent
  // them to /tr/blog/en/…, which is wrong on both counts. The directory is
  // what every other route uses.
  const mislabelled = entry('en/a-post', { lang: 'tr' } as never);
  assert.equal(feedItems([mislabelled], 'en')[0].link, '/blog/a-post/');
  assert.equal(feedItems([mislabelled], 'tr').length, 0);
});

test('newest first', () => {
  const items = feedItems(
    [
      entry('en/old', { pubDate: new Date('2020-01-01') }),
      entry('en/new', { pubDate: new Date('2026-01-01') }),
    ],
    'en',
  );
  assert.deepEqual(items.map((i) => i.link), ['/blog/new/', '/blog/old/']);
});
