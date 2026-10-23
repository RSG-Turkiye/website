/**
 * The list of published entries the panel CMS offers to open: id and title
 * per type, newest first. Built at build time into /cms-index.json
 * (src/pages/cms-index.json.ts) so the Functions never list the repository
 * through GitHub. Everything in it is on the public site already.
 *
 * Webinars carry both files' paths, because a pair is tied by
 * `translationKey` when the two file names differ (src/lib/translations.ts),
 * and a Function cannot work that out without reading every file.
 *
 * Pure: takes repository-relative paths and their text, so node tests build
 * the same index from the checkout.
 */

import { counterpartSlug, type TranslatableEntry } from "../translations";
import { parseMarkdown } from "./serialize";
import { cmsType, type CmsTypeKey } from "./types";

export interface CmsIndexEntry {
  /** The file name without extension; for webinars the English one. */
  id: string;
  title: string;
  /** Webinars only: the two files of the pair (null when a side is missing). */
  paths?: { en: string | null; tr: string | null };
}

export type CmsIndex = Record<CmsTypeKey, CmsIndexEntry[]>;

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(json|md)$/, "");

/** `files`: repository-relative path → file text, for every file under the three types' folders. */
export function buildCmsIndex(files: Record<string, string>): CmsIndex {
  const under = (dir: string, ext: string) =>
    Object.keys(files).filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext)).sort();

  const events = under(cmsType("events")!.dir, ".json").map((p) => {
    const d = JSON.parse(files[p]) as { title: { en: string }; start: string };
    return { entry: { id: base(p), title: d.title.en }, key: d.start };
  });
  const workshops = under(cmsType("workshops")!.dir, ".json").map((p) => {
    const d = JSON.parse(files[p]) as { title: string; year: number };
    return { entry: { id: base(p), title: d.title }, key: String(d.year) };
  });

  const webinarType = cmsType("webinars")!;
  const parsed = under(webinarType.dir, ".md")
    .filter((p) => /\/(en|tr)\/[^/]+\.md$/.test(p))
    .map((p) => {
      const lang = p.slice(webinarType.dir.length + 1, webinarType.dir.length + 3);
      const fm = parseMarkdown(webinarType, files[p]).frontmatter as { title?: string; date?: unknown; translationKey?: string };
      return { path: p, lang, slug: base(p), fm };
    });
  const asEntries: TranslatableEntry[] = parsed.map((w) => ({ id: `${w.lang}/${w.slug}`, data: { translationKey: w.fm.translationKey } }));
  const pathOf = (lang: string, slug: string | null) => (slug === null ? null : `${webinarType.dir}/${lang}/${slug}.md`);
  const claimed = new Set<string>();
  const webinars: { entry: CmsIndexEntry; key: string }[] = parsed.filter((w) => w.lang === "en").map((w) => {
    const tr = pathOf("tr", counterpartSlug(asEntries, `en/${w.slug}`, "tr"));
    if (tr) claimed.add(tr);
    return { entry: { id: w.slug, title: String(w.fm.title ?? w.slug), paths: { en: w.path, tr } }, key: String(w.fm.date ?? "") };
  });
  // A Turkish file with no English twin is still an entry, under its own name.
  const ids = new Set(webinars.map((w) => w.entry.id));
  for (const w of parsed) {
    if (w.lang !== "tr" || claimed.has(w.path) || ids.has(w.slug)) continue;
    webinars.push({ entry: { id: w.slug, title: String(w.fm.title ?? w.slug), paths: { en: null, tr: w.path } }, key: String(w.fm.date ?? "") });
  }

  const newestFirst = <T extends { key: string; entry: CmsIndexEntry }>(list: T[]) =>
    list.sort((a, b) => b.key.localeCompare(a.key) || a.entry.id.localeCompare(b.entry.id)).map((x) => x.entry);
  return { events: newestFirst(events), workshops: newestFirst(workshops), webinars: newestFirst(webinars) };
}
