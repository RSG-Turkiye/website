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
import { cmsTypes, type CmsType, type CmsTypeKey } from "./types";

export interface CmsIndexEntry {
  /** The file name without extension; for a pair the English one. */
  id: string;
  title: string;
  /** What the list sorts by, shown under the title (the type's
   * indexDate): an event's first day and a webinar's date (YYYY-MM-DD), a
   * workshop's year. */
  date?: string;
  /** The type's indexSection, when it has one: a resource's section. */
  section?: string;
  /** Markdown pairs only: the two files (null when a side is missing). */
  paths?: { en: string | null; tr: string | null };
  /** Markdown pairs only, when set: the translationKey that ties the pair. */
  key?: string;
  /** Each of the entry's files (path → git blob sha) as this build saw it.
   * The PR shepherd compares them with a merged draft's files to tell when
   * the deployed site shows the change. Set when the caller passes shas. */
  shas?: Record<string, string>;
}

export type CmsIndex = Record<CmsTypeKey, CmsIndexEntry[]>;

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(json|md)$/, "");

type Listed = { entry: CmsIndexEntry; sort: string; paths: (string | null)[] };

/** Title and date of one entry, from the type's extractors. */
function describe(type: CmsType, id: string, data: unknown, lang: "en" | "tr"): Pick<CmsIndexEntry, "id" | "title" | "date" | "section"> {
  const date = type.indexDate?.(data);
  const section = type.indexSection?.(data);
  return { id, title: type.indexTitle(data, lang) ?? id, ...(date !== undefined ? { date } : {}), ...(section !== undefined ? { section } : {}) };
}

/** A JSON type: one entry per <dir>/<id>.json. */
function jsonEntries(type: CmsType, paths: string[], files: Record<string, string>): Listed[] {
  return paths.map((p) => {
    const entry = describe(type, base(p), JSON.parse(files[p]) as unknown, "en");
    return { entry, sort: entry.date ?? "", paths: [p] };
  });
}

/**
 * A Markdown pair type: <dir>/en/<id>.md and <dir>/tr/<id>.md, tied by
 * translationKey when the names differ (src/lib/translations.ts). An entry
 * is named after its English file; a Turkish file with no English twin is
 * an entry under its own name.
 */
function pairEntries(type: CmsType, paths: string[], files: Record<string, string>): Listed[] {
  const parsed = paths
    .filter((p) => /\/(en|tr)\/[^/]+\.md$/.test(p) && p.split("/").length === type.dir.split("/").length + 2)
    .map((p) => {
      const lang = p.slice(type.dir.length + 1, type.dir.length + 3) as "en" | "tr";
      const fm = parseMarkdown(type, files[p]).frontmatter as { translationKey?: string };
      return { path: p, lang, slug: base(p), fm };
    });
  const asEntries: TranslatableEntry[] = parsed.map((w) => ({ id: `${w.lang}/${w.slug}`, data: { translationKey: w.fm.translationKey } }));
  const pathOf = (lang: string, slug: string | null) => (slug === null ? null : `${type.dir}/${lang}/${slug}.md`);
  const listed = (w: (typeof parsed)[number], en: string | null, tr: string | null): Listed => {
    const key = w.fm.translationKey?.trim();
    const entry: CmsIndexEntry = { ...describe(type, w.slug, w.fm, w.lang), paths: { en, tr }, ...(key ? { key } : {}) };
    return { entry, sort: entry.date ?? "", paths: [en, tr] };
  };
  const claimed = new Set<string>();
  const out = parsed.filter((w) => w.lang === "en").map((w) => {
    const tr = pathOf("tr", counterpartSlug(asEntries, `en/${w.slug}`, "tr"));
    if (tr) claimed.add(tr);
    return listed(w, w.path, tr);
  });
  const ids = new Set(out.map((w) => w.entry.id));
  for (const w of parsed) {
    if (w.lang !== "tr" || claimed.has(w.path) || ids.has(w.slug)) continue;
    out.push(listed(w, null, w.path));
  }
  return out;
}

/**
 * `files`: repository-relative path → file text, for every file under the
 * types' folders. `shas`: path → git blob sha (src/lib/cms/blob-sha.ts),
 * passed by the build so each entry carries its files' shas; left out, the
 * entries have none. `types`: which types to list, every one by default,
 * each under its key in registry order.
 */
export function buildCmsIndex(files: Record<string, string>, shas?: Record<string, string>, types: readonly CmsType[] = cmsTypes()): CmsIndex {
  const withShas = (entry: CmsIndexEntry, paths: (string | null)[]): CmsIndexEntry => {
    if (!shas) return entry;
    const own = paths.filter((p): p is string => !!p && shas[p] !== undefined).map((p) => [p, shas[p]] as const);
    return { ...entry, shas: Object.fromEntries(own) };
  };
  const index = {} as CmsIndex;
  for (const type of types) {
    const ext = type.format === "json" ? ".json" : ".md";
    // A JSON type's files sit directly in its folder; a pair's one level down.
    const paths = Object.keys(files)
      .filter((p) => p.startsWith(`${type.dir}/`) && p.endsWith(ext) && (type.format !== "json" || !p.slice(type.dir.length + 1).includes("/")))
      // A one-file type (fixedId) shares its folder with other files.
      .filter((p) => !type.fixedId || p === `${type.dir}/${type.fixedId}.json`)
      .sort();
    const list = type.format === "json" ? jsonEntries(type, paths, files) : pairEntries(type, paths, files);
    index[type.key] = list
      .sort((a, b) => b.sort.localeCompare(a.sort) || a.entry.id.localeCompare(b.entry.id))
      .map((x) => withShas(x.entry, x.paths));
  }
  return index;
}
