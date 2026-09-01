/**
 * Pages that must never turn up in a Google search for us.
 *
 * These are all sign-in-gated shells: the markup Astro builds is a spinner,
 * and the real content arrives from /api/* after an auth check, so a crawler
 * only ever sees the empty template. Advertising ~13 near-empty URLs in a
 * 250-URL sitemap wastes crawl budget and drags down how a young domain is
 * judged. /members is here for a second reason: whether member names are
 * searchable on Google should be a deliberate decision, not a side effect of
 * the sitemap defaults.
 *
 * Used in two places, which is why it lives in its own module: the sitemap
 * `filter` in astro.config.mjs (what we advertise) and the robots meta tag in
 * BaseLayout.astro (what actually keeps a URL out once Google finds it some
 * other way). Those two must never drift apart.
 */
const NOINDEX_PREFIXES = ['/account', '/admin', '/login', '/members'] as const;

/** Strip the /tr language prefix so both copies of a page share one rule. */
function withoutLangPrefix(pathname: string): string {
  return pathname.replace(/^\/tr(?=\/|$)/, '') || '/';
}

export function isNoindexPath(pathname: string): boolean {
  const path = withoutLangPrefix(pathname).replace(/\/$/, '') || '/';
  // Compare whole segments, so /accounts is not caught by the /account rule.
  return NOINDEX_PREFIXES.some((p) => path === p || path.startsWith(p + '/'));
}
