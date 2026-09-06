import { slugOf } from './translations';

/**
 * Blog posts as feed items, for one language.
 *
 * Pure and shared, so the two feeds cannot disagree about what a post's URL
 * is -- which is the mistake this replaces, in the one place there was.
 */
export interface FeedEntry {
  id: string;
  data: {
    title: string;
    pubDate: Date;
    description: string;
    author?: string;
    tags?: string[];
    draft?: boolean;
  };
}

export interface FeedItem {
  title: string;
  pubDate: Date;
  description: string;
  author?: string;
  link: string;
  categories: string[];
}

export function feedItems(posts: FeedEntry[], lang: 'en' | 'tr'): FeedItem[] {
  const prefix = `${lang}/`;
  return posts
    // The folder decides the language and the URL. `data.lang` is a legacy
    // field and three posts in blog/en/ carry the wrong one.
    .filter((post) => post.id.startsWith(prefix))
    .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
    .map((post) => ({
      title: post.data.title,
      pubDate: post.data.pubDate,
      description: post.data.description,
      author: post.data.author,
      link: lang === 'tr' ? `/tr/blog/${slugOf(post.id)}/` : `/blog/${slugOf(post.id)}/`,
      categories: post.data.tags ?? [],
    }));
}
