import { isNoindexPath } from './noindex-routes';

/**
 * Works out the EN/TR pair for a page, for the `hreflang` link tags.
 *
 * Nearly every page is mirrored across the /tr prefix -- /about and
 * /tr/about, /webinars and /tr/webinars -- which is the same rule the
 * language switcher in Header.astro already applies, so the pair can be
 * derived from the path instead of being threaded through all 43 pages.
 *
 * Dynamic routes are the exception: a blog post is only translated if a
 * matching entry exists in the other language's collection. Those pages
 * pass `translationExists={false}` to BaseLayout to opt out. Note this is
 * NOT the same thing as the existing `translationUrl` prop, which falls
 * back to the listing page (/tr/blog) when a post has no translation --
 * fine for a language switcher, wrong for hreflang, where claiming the
 * listing as a post's Turkish version would be a false pairing.
 */

/**
 * Pages built in one language only. Pointing hreflang at a URL that 404s
 * is worse than emitting nothing, so these are skipped.
 *
 * The sign-in-gated pages are absent on purpose: isNoindexPath already
 * excludes them, and /members/profile is among them.
 */
const UNPAIRED_PATHS: readonly string[] = [
  '/404',
  '/tags',                      // the tag index; individual /tags/x pages are mirrored
  '/learning-paths/grad',       // redirect stubs, not real pages -- see astro.config.mjs
  '/learning-paths/undergrad',
];

export interface Alternates {
  /** Path of the English version, e.g. '/about/'. */
  en: string;
  /** Path of the Turkish version, e.g. '/tr/about/'. */
  tr: string;
}

/** Drop a trailing slash so paths compare equal however they arrive. */
function bare(pathname: string): string {
  return pathname.replace(/\/$/, '') || '/';
}

/** Astro serves directory-style URLs, and canonical carries the trailing
 *  slash -- hreflang has to match it or the two tags disagree. */
function withSlash(path: string): string {
  return path === '/' ? '/' : path + '/';
}

export function alternatesFor(pathname: string): Alternates | null {
  const path = bare(pathname);
  if (isNoindexPath(path)) return null;

  const en = path.replace(/^\/tr(?=\/|$)/, '') || '/';
  if (UNPAIRED_PATHS.includes(en)) return null;

  return {
    en: withSlash(en),
    tr: withSlash(en === '/' ? '/tr' : '/tr' + en),
  };
}
