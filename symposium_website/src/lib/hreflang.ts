/**
 * The EN/TR pair for a page, for hreflang link tags.
 *
 * BaseLayout previously emitted <meta name="translation-url">, which is
 * not a standard and which Google ignores entirely -- so the two language
 * versions were never linked as alternates and were candidates to be read
 * as duplicates of each other.
 */
const UNPAIRED_PATHS: readonly string[] = ["/404"];

export interface Alternates {
  en: string;
  tr: string;
}

function bare(pathname: string): string {
  return pathname.replace(/\/$/, "") || "/";
}

function withSlash(path: string): string {
  return path === "/" ? "/" : path + "/";
}

export function alternatesFor(pathname: string): Alternates | null {
  const path = bare(pathname);
  const en = path.replace(/^\/tr(?=\/|$)/, "") || "/";
  if (UNPAIRED_PATHS.includes(en)) return null;
  return { en: withSlash(en), tr: withSlash(en === "/" ? "/tr" : "/tr" + en) };
}
