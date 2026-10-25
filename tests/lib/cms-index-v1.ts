// The index builder as plan 3 shipped it (src/lib/cms/cms-index.ts at
// 8c9d44b), frozen: tests/cms-index.test.ts checks that the generic builder
// gives byte-identical output for the Etkinlikler types. Do not edit.
import { counterpartSlug, type TranslatableEntry } from "../../src/lib/translations";
import { parseMarkdown } from "../../src/lib/cms/serialize";
import { cmsType, type CmsTypeKey } from "../../src/lib/cms/types";

interface CmsIndexEntry {
  /** The file name without extension; for webinars the English one. */
  id: string;
  title: string;
  /** What the list sorts by, shown under the title: an event's first day
   * and a webinar's date (YYYY-MM-DD), a workshop's year. */
  date?: string;
  /** Webinars only: the two files of the pair (null when a side is missing). */
  paths?: { en: string | null; tr: string | null };
  /** Webinars only, when set: the translationKey that ties the pair. */
  key?: string;
  /** Each of the entry's files (path → git blob sha) as this build saw it.
   * The PR shepherd compares them with a merged draft's files to tell when
   * the deployed site shows the change. Set when the caller passes shas. */
  shas?: Record<string, string>;
}

type CmsIndex = Record<CmsTypeKey, CmsIndexEntry[]>;

/** A frontmatter date as YYYY-MM-DD, whether YAML gave a string or a Date. */
const dayOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

const base = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(json|md)$/, "");

/**
 * `files`: repository-relative path → file text, for every file under the
 * three types' folders. `shas`: path → git blob sha (src/lib/cms/blob-sha.ts),
 * passed by the build so each entry carries its files' shas; left out, the
 * entries have none.
 */
export function buildCmsIndexV1(files: Record<string, string>, shas?: Record<string, string>): CmsIndex {
  const under = (dir: string, ext: string) =>
    Object.keys(files).filter((p) => p.startsWith(`${dir}/`) && p.endsWith(ext)).sort();

  const events = under(cmsType("events")!.dir, ".json").map((p) => {
    const d = JSON.parse(files[p]) as { title: { en: string }; start: string };
    return { entry: { id: base(p), title: d.title.en, date: d.start }, sort: d.start };
  });
  const workshops = under(cmsType("workshops")!.dir, ".json").map((p) => {
    const d = JSON.parse(files[p]) as { title: string; year: number };
    return { entry: { id: base(p), title: d.title, date: String(d.year) }, sort: String(d.year) };
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
  const webinars: { entry: CmsIndexEntry; sort: string }[] = parsed.filter((w) => w.lang === "en").map((w) => {
    const tr = pathOf("tr", counterpartSlug(asEntries, `en/${w.slug}`, "tr"));
    if (tr) claimed.add(tr);
    const key = w.fm.translationKey?.trim();
    return { entry: { id: w.slug, title: String(w.fm.title ?? w.slug), date: dayOf(w.fm.date), paths: { en: w.path, tr }, ...(key ? { key } : {}) }, sort: String(w.fm.date ?? "") };
  });
  // A Turkish file with no English twin is still an entry, under its own name.
  const ids = new Set(webinars.map((w) => w.entry.id));
  for (const w of parsed) {
    if (w.lang !== "tr" || claimed.has(w.path) || ids.has(w.slug)) continue;
    const key = w.fm.translationKey?.trim();
    webinars.push({ entry: { id: w.slug, title: String(w.fm.title ?? w.slug), date: dayOf(w.fm.date), paths: { en: null, tr: w.path }, ...(key ? { key } : {}) }, sort: String(w.fm.date ?? "") });
  }

  const withShas = (entry: CmsIndexEntry, paths: (string | null | undefined)[]): CmsIndexEntry => {
    if (!shas) return entry;
    const own = paths.filter((p): p is string => !!p && shas[p] !== undefined).map((p) => [p, shas[p]] as const);
    return { ...entry, shas: Object.fromEntries(own) };
  };
  // The file the entry was read from (its id is that file's name).
  const jsonPathOf = (key: CmsTypeKey, id: string) => `${cmsType(key)!.dir}/${id}.json`;
  const newestFirst = <T extends { sort: string; entry: CmsIndexEntry }>(list: T[], paths: (e: CmsIndexEntry) => (string | null | undefined)[]) =>
    list.sort((a, b) => b.sort.localeCompare(a.sort) || a.entry.id.localeCompare(b.entry.id)).map((x) => withShas(x.entry, paths(x.entry)));
  return {
    events: newestFirst(events, (e) => [jsonPathOf("events", e.id)]),
    workshops: newestFirst(workshops, (e) => [jsonPathOf("workshops", e.id)]),
    webinars: newestFirst(webinars, (e) => [e.paths?.en, e.paths?.tr]),
  };
}
