/**
 * Which entry is the other language's version of this one.
 *
 * The rule used to be filename equality, spelled out identically in four route
 * files, and it had two costs. Six webinar translations were unreachable
 * because the Turkish file had a Turkish name -- the language toggle dropped
 * the reader on the listing page, the "read in Turkish" chip was suppressed,
 * and no hreflang was emitted, so search engines never learned the two pages
 * were the same talk. And the only way to fix one was to rename the Turkish
 * file to its English slug, which trades a readable Turkish URL for a pairing
 * and breaks whatever already links to it.
 *
 * So filename equality stays as the default -- it is what almost every pair
 * uses and it needs no ceremony -- and an explicit `translationKey` in both
 * files overrides it. A Turkish post keeps its Turkish slug and says, in one
 * line, which English post it belongs to.
 */

export interface TranslatableEntry {
  /** Collection id, always `<lang>/<slug>`. */
  id: string;
  data: { translationKey?: string };
}

export type Lang = "en" | "tr";

/** The slug of `id`, with its language folder removed. */
export function slugOf(id: string): string {
  return id.replace(/^(en|tr)\//, "");
}

/**
 * The counterpart's slug in `target`, or null when there is no translation.
 *
 * Returns the slug rather than the id because that is what every caller needs:
 * the URL is `/webinars/<slug>` or `/tr/webinars/<slug>`.
 */
export function counterpartSlug(
  entries: TranslatableEntry[],
  id: string,
  target: Lang,
): string | null {
  const self = entries.find((e) => e.id === id);
  const key = self?.data.translationKey?.trim() ?? "";
  const prefix = `${target}/`;

  if (key !== "") {
    // Sorted so that a duplicated key resolves to the same entry on every
    // build rather than to whichever the loader happened to return first.
    const matches = entries
      .filter((e) => e.id.startsWith(prefix) && e.data.translationKey?.trim() === key)
      .map((e) => slugOf(e.id))
      .sort();
    return matches[0] ?? null;
  }

  const slug = slugOf(id);
  return entries.some((e) => e.id === `${prefix}${slug}`) ? slug : null;
}
