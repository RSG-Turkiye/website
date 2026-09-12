import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { feedItems } from '../lib/feed';

/**
 * The English blog feed.
 *
 * Every link it emitted used to 404. `post.id` already carries the language
 * folder -- `en/a-post` -- and the route pasted it after the language prefix
 * as well, so subscribers were sent to /blog/en/a-post/ and /tr/blog/tr/…,
 * all seventy of them, for as long as the feed has existed.
 *
 * It also routed on `data.lang`, a legacy frontmatter field, while the
 * directory is what decides the URL. Three posts in blog/en/ are stamped
 * lang: "tr", so those were wrong on both counts. The folder is the source of
 * truth here, as it is in every other route.
 */
export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return rss({
    title: 'RSG-Türkiye Blog',
    description: 'Latest blog posts from RSG-Türkiye: ISCB Student Council Regional Student Group',
    site: context.site!,
    items: feedItems(posts, 'en'),
    // One feed per language rather than one mixed feed claiming en-us, which
    // is what it did while carrying 36 Turkish posts.
    customData: '<language>en</language>',
  });
}
