/**
 * Which posts a tag page is built from.
 *
 * The index and the tag route each spelled this out for themselves, and they
 * disagreed: the index collected tags from every post in both languages while
 * the route built pages only from English, non-draft, non-webinar ones.
 * Eighteen of the thirty-four links the index offered led to a 404, and the
 * page sits in the sitemap, so search engines were being handed the dead ones
 * to crawl.
 *
 * Neither spelling was wrong on its own. Having two was.
 */
export interface TaggedEntry {
  id: string;
  data: { draft?: boolean; type?: string; tags?: string[] };
}

/**
 * Webinars carry tags but have their own listing, so a tag page that mixed
 * them in would answer a question nobody asked; drafts are not published at
 * all; and the two languages have separate tag pages under separate prefixes.
 */
export function tagged(lang: "en" | "tr") {
  return (entry: TaggedEntry): boolean =>
    entry.id.startsWith(`${lang}/`) && !entry.data.draft && entry.data.type !== "webinar";
}

/** Every tag in `posts`, with how many carry it, sorted for a stable page. */
export function tagCounts(posts: TaggedEntry[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
}
