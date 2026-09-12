import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { feedItems } from '../../lib/feed';

/** The Turkish blog feed; see src/pages/rss.xml.ts for why there are two. */
export async function GET(context: APIContext) {
  const posts = await getCollection('blog', ({ data }) => !data.draft);
  return rss({
    title: 'RSG-Türkiye Blog',
    description: 'RSG-Türkiye blogundaki son yazılar: ISCB Student Council Bölgesel Öğrenci Grubu',
    site: context.site!,
    items: feedItems(posts, 'tr'),
    customData: '<language>tr</language>',
  });
}
