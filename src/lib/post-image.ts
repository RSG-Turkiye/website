/**
 * Which picture belongs to a post, and which is its author's face.
 *
 * `image` in a post's frontmatter is not one thing. For most posts it is a
 * Gravatar URL -- the author's avatar, written there by the submission form --
 * and for a few it is a real hero image. The listing already knew this: its
 * thumbnail helper skips gravatar.com and digs the first picture out of the
 * body instead. The post page did not, so every article's JSON-LD went to
 * Google with `"image"` pointing at a 60-pixel avatar, and search results that
 * would have shown the article's figure showed a face or nothing.
 *
 * So the rule lives here once. `heroImage` is the article's picture, for cards
 * and for structured data; `avatarUrl` is the byline face, which is what the
 * frontmatter field usually holds.
 */

export const LOGO = 'https://rsg-turkiye.iscbsc.org/logo/rsgturkey_logo.png';

interface PostLike {
  data: { image?: string };
  body?: string;
}

const isAvatar = (url: string): boolean => url.includes('gravatar.com');

/** The first picture in the body, markdown or HTML, or null. */
function firstBodyImage(body: string | undefined): string | null {
  if (!body) return null;
  return (
    body.match(/!\[.*?\]\((https:\/\/[^\s)]+)\)/)?.[1] ||
    body.match(/<img[^>]+src=["'](https:\/\/[^\s"']+)["']/)?.[1] ||
    null
  );
}

/**
 * The article's own picture: the frontmatter image when it is one, otherwise
 * the first image in the body. Null when the post has no picture at all --
 * callers that need something render a placeholder or fall back to the logo.
 */
export function heroImage(post: PostLike): string | null {
  const declared = post.data.image;
  if (declared && declared.startsWith('http') && !isAvatar(declared)) return declared;
  return firstBodyImage(post.body);
}

/** The author's face, which is what `image` holds on most posts. */
export function avatarUrl(post: PostLike): string | null {
  const declared = post.data.image;
  return declared && declared.startsWith('http') ? declared : null;
}
