/**
 * The content types the panel CMS edits, and where each lives in git.
 *
 * Shared by the admin panel and the Pages Functions, so nothing here may
 * import astro:content, D1 code or browser-only APIs. CmsGroup is a type-only
 * import: roles.ts pulls in nothing at runtime.
 */

import type { ZodType } from "astro/zod";
import type { CmsGroup } from "../../../functions/_lib/roles";
import { eventSchema } from "../../data/events";
import { workshopSchema } from "../../data/workshops";
import { webinarSchema } from "../../data/webinars";
import { committeeSchema } from "../../data/committees";
import { podcastSchema } from "../../data/podcast";
import { resourceSchema } from "../../data/resources";
import { lpDomainSchema, lpLevelSchema, lpRoadmapSchema } from "../../data/learning-paths";
import { checkId, slugify, stageId } from "./slug";

export type CmsTypeKey = "events" | "workshops" | "webinars" | "committees" | "podcast" | "resources" | "lp-domains" | "lp-levels" | "lp-roadmap";

/** What a type declares. The options after `label` have defaults (see defineType). */
export interface CmsTypeSpec {
  key: CmsTypeKey;
  group: CmsGroup;
  /** The collection's folder, relative to the repository root. */
  dir: string;
  /** `json`: one file per entry, <dir>/<id>.json. `markdown-pair`:
   * <dir>/en/<id>.md and <dir>/tr/<id>.md, frontmatter plus body. */
  format: "json" | "markdown-pair";
  /** For JSON types the whole entry; for Markdown types the frontmatter. */
  schema: ZodType;
  /** The id (file name without extension) a new entry is saved under. JSON
   * types take the entry; Markdown types take `{ frontmatter }` of the
   * English side. Runs only when an entry is created: an update keeps its
   * file name whatever the data says. Always a valid id (checkId); throws
   * otherwise. */
  idFrom: (data: any) => string;
  /** The form field (dotted path into the draft data) the id comes from:
   * errors about the id are reported on it. */
  idField: string;
  /** The title the panel lists a published entry under. JSON types get the
   * entry; Markdown types one side's frontmatter, `lang` saying which.
   * Undefined falls back to the file name. */
  indexTitle: (data: any, lang: "en" | "tr") => string | undefined;
  /** What the list sorts by (newest first) and shows under the title, from
   * the same data as indexTitle. Absent: no date, sorted by id. */
  indexDate?: (data: any) => string | undefined;
  /** Where on its page the entry sits (a resource's section), from the same
   * data as indexTitle: the list shows it, and the live link lands on it.
   * Absent: none. */
  indexSection?: (data: any) => string | undefined;
  label: { en: string; tr: string };
  /** The id is itself a field of the data (events' `id`), so an update's
   * data must still give the entry's file name. Default false. */
  idInData?: boolean;
  /** markdown-pair only: whether every entry has both languages ('both') or
   * may have just one ('either'). Default 'both'. */
  sides?: "both" | "either";
  /** A draft may change values only: its top-level keys must be those of
   * the file it started from. Default false. */
  fixedKeys?: boolean;
  /** A new entry whose name is already a file on main: refused ('refuse'),
   * or given the next free name ('next': the idSuffix form, then -2, -3, ...).
   * Default 'refuse' when the id is the data itself (idInData), else 'next'. */
  whenTaken?: "refuse" | "next";
  /** whenTaken 'next': the first alternative name is `<id>-<idSuffix>`
   * (a resource's section, as teachopencadd-md-drug). */
  idSuffix?: (data: any) => string | undefined;
  /** No new entries through the panel. Default false. */
  noCreate?: boolean;
  /** No deleting entries through the panel. Default false. */
  noDelete?: boolean;
  /** Who approves: the group's approvers ('group'), or only an admin
   * ('admin'). Default 'group'. */
  approve?: "group" | "admin";
  /** The file is also written by a script (podcast:sync); the panel edits
   * it the same way. Default false. */
  generated?: boolean;
  /** Profiles of people: no @ anywhere in the file, so no e-mail address
   * (CLAUDE.md rule 4). Refused at submit. Default false. */
  noAt?: boolean;
  /** Top-level keys an update may not change (for a pair, each side's
   * frontmatter): the ones the file name or the page's address comes from
   * (a level's domain and level, a roadmap stage's number). Default []. */
  lockedKeys?: readonly string[];
  /** markdown-pair: a frontmatter key the server sets on a new entry, the
   * highest number its file names start with + 1 (a roadmap stage's
   * `number`, A11), and keeps for the draft's life. Default "". */
  appendKey?: string;
  /** Learning-path resources with progress ids (CLAUDE.md rule 8): the
   * server gives a new resource its id and checks every id at submit and
   * approval (functions/_lib/cms-lp.ts). Default false. */
  resourceIds?: boolean;
  /** JSON only: the type is one file, <dir>/<fixedId>.json, in a folder that
   * may hold others (src/data). The index lists only it, and no other id is
   * an entry of the type. Default '' (every file in dir). */
  fixedId?: string;
}

/** A type with every option resolved. */
export type CmsType = Required<Omit<CmsTypeSpec, "indexDate" | "indexSection" | "idSuffix">> & Pick<CmsTypeSpec, "indexDate" | "indexSection" | "idSuffix">;

/** A type with its defaults filled in, the one place they are decided. */
export function defineType(spec: CmsTypeSpec): CmsType {
  return {
    idInData: false,
    sides: "both",
    fixedKeys: false,
    noCreate: false,
    noDelete: false,
    approve: "group",
    generated: false,
    noAt: false,
    fixedId: "",
    lockedKeys: [],
    appendKey: "",
    resourceIds: false,
    whenTaken: spec.idInData ? "refuse" : "next",
    ...spec,
  };
}

export { checkId, slugify };

/** An id from free text, for a new entry. */
function idFromText(text: unknown, what: string): string {
  // A draft is saved incomplete, so the field may still be missing.
  const id = slugify(typeof text === "string" ? text : "");
  if (id === "") throw new Error(`The ${what} has no letters or digits to make an id from`);
  return checkId(id);
}

const dateOf = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? "").slice(0, 10));

export const CMS_TYPES: readonly CmsType[] = [
  defineType({
    key: "events",
    group: "etkinlikler",
    dir: "src/content/events",
    format: "json",
    schema: eventSchema,
    // src/data/events.ts: "Also the file name: src/content/events/<id>.json."
    idFrom: (data: { id: string }) => checkId(data.id),
    idField: "id",
    idInData: true,
    indexTitle: (d: { title: { en: string } }) => d.title.en,
    indexDate: (d: { start: string }) => d.start,
    label: { en: "Events", tr: "Etkinlikler" },
  }),
  defineType({
    key: "workshops",
    group: "etkinlikler",
    dir: "src/content/workshops",
    format: "json",
    schema: workshopSchema,
    // The repo name as a lower-case slug: Computational_Structural_Biology_Workshop
    // is computational-structural-biology-workshop.json.
    idFrom: (data: { repo: string }) => idFromText(data.repo, "repo name"),
    idField: "repo",
    indexTitle: (d: { title: string }) => d.title,
    indexDate: (d: { year: number }) => String(d.year),
    label: { en: "Workshops", tr: "Atölyeler" },
    // The file name must be the repo's (tests/content-workshops.test.ts): a
    // second file for one repo is refused, never renamed.
    whenTaken: "refuse",
  }),
  defineType({
    key: "webinars",
    group: "etkinlikler",
    dir: "src/content/webinars",
    format: "markdown-pair",
    schema: webinarSchema,
    // Existing files are named by hand; a new one gets the English title.
    idFrom: (data: { frontmatter: { title: string } }) => idFromText(data.frontmatter.title, "title"),
    idField: "en.frontmatter.title",
    indexTitle: (fm: { title?: unknown }) => (fm.title === undefined || fm.title === null ? undefined : String(fm.title)),
    // YAML may give a Date or a string; the list shows the day.
    indexDate: (fm: { date?: unknown }) => dateOf(fm.date),
    label: { en: "Webinars", tr: "Webinarlar" },
  }),
  defineType({
    key: "committees",
    group: "topluluk",
    dir: "src/content/committees",
    format: "json",
    schema: committeeSchema,
    // A new committee gets its English name; the existing files were named
    // by hand (website.json for "Website Committee") and keep their names (A1).
    idFrom: (data: { name?: { en?: string } }) => idFromText(data.name?.en, "English name"),
    idField: "name.en",
    indexTitle: (d: { name: { en: string } }) => d.name.en,
    label: { en: "Committees", tr: "Komiteler" },
    // Published profiles: no e-mail address in git (CLAUDE.md rule 4).
    noAt: true,
  }),
  defineType({
    key: "podcast",
    group: "topluluk",
    dir: "src/data",
    format: "json",
    schema: podcastSchema,
    // One file, written from the feed (functions/api/cms/podcast/pull.ts, or
    // npm run podcast:sync); never created or deleted in the panel.
    fixedId: "podcast",
    idFrom: () => "podcast",
    idField: "title",
    indexTitle: (d: { title?: string }) => d.title,
    // The newest episode's day: the list shows how current the show is.
    indexDate: (d: { episodes?: { pubDate?: string }[] }) => d.episodes?.[0]?.pubDate?.slice(0, 10),
    label: { en: "Podcast", tr: "Podcast" },
    generated: true,
    noCreate: true,
    noDelete: true,
  }),
  defineType({
    key: "resources",
    group: "ogrenme",
    dir: "src/content/resources",
    format: "json",
    schema: resourceSchema,
    // A new link gets its English title; a link placed in two sections is two
    // files named by hand (teachopencadd-learning, teachopencadd-md-drug), and
    // an update keeps its name (A1).
    idFrom: (data: { title?: { en?: string } }) => idFromText(data.title?.en, "English title"),
    idField: "title.en",
    indexTitle: (d: { title: { en: string } }) => d.title.en,
    indexSection: (d: { section?: string }) => d.section,
    // A title already used is most often the same link in another section.
    idSuffix: (d: { section?: string }) => d.section,
    label: { en: "Resources", tr: "Kaynaklar" },
  }),
  defineType({
    key: "lp-domains",
    group: "ogrenme",
    dir: "src/content/lp-domains",
    format: "markdown-pair",
    schema: lpDomainSchema,
    // The file name is the domain's id: its page's address and every level's
    // `domain`. A second domain of one name is refused, never renamed.
    idFrom: (data: { frontmatter: { name?: string } }) => idFromText(data.frontmatter.name, "English name"),
    idField: "en.frontmatter.name",
    indexTitle: (fm: { name?: unknown }) => (typeof fm.name === "string" ? fm.name : undefined),
    label: { en: "Learning-path domains", tr: "Öğrenme alanları" },
    whenTaken: "refuse",
  }),
  defineType({
    key: "lp-levels",
    group: "ogrenme",
    dir: "src/content/lp-levels",
    format: "markdown-pair",
    schema: lpLevelSchema,
    // <domain>-<level>.md: one file per domain and level. The page finds a
    // level by its frontmatter, so both stay as they were created.
    idFrom: (data: { frontmatter: { domain?: string; level?: string } }) => {
      const fm = data.frontmatter;
      if (!fm.domain || !fm.level) throw new Error("Choose the domain and the level: the file name comes from them");
      return checkId(`${fm.domain}-${fm.level}`);
    },
    idField: "en.frontmatter.domain",
    indexTitle: (fm: { domain?: unknown; level?: unknown }) => (fm.domain && fm.level ? `${String(fm.domain)} · ${String(fm.level)}` : undefined),
    label: { en: "Learning-path levels", tr: "Öğrenme seviyeleri" },
    whenTaken: "refuse",
    lockedKeys: ["domain", "level"],
    resourceIds: true,
  }),
  defineType({
    key: "lp-roadmap",
    group: "ogrenme",
    dir: "src/content/lp-roadmap",
    format: "markdown-pair",
    schema: lpRoadmapSchema,
    // NN-slug.md, NN the stage's number: a new stage is appended (the server
    // gives it the highest number + 1), and the number never changes (A11).
    idFrom: (data: { frontmatter: { number?: unknown; title?: string } }) => {
      const n = data.frontmatter.number;
      if (typeof n !== "number" || !Number.isInteger(n) || n < 1) throw new Error("The stage has no number yet");
      return stageId(n, idFromText(data.frontmatter.title, "title"));
    },
    idField: "en.frontmatter.title",
    indexTitle: (fm: { number?: unknown; title?: unknown }) => (typeof fm.title === "string" ? `${String(fm.number ?? "")}. ${fm.title}` : undefined),
    label: { en: "Roadmap stages", tr: "Yol haritası" },
    lockedKeys: ["number"],
    appendKey: "number",
    resourceIds: true,
  }),
];

let testTypes: readonly CmsType[] = [];

/**
 * Types added for node tests only, so a test can exercise an option (fixedKeys,
 * noCreate, approve: 'admin') before a real type uses it. Like
 * setCmsIndexLoader: never called by the site.
 */
export function setTestCmsTypes(types: readonly CmsType[]): void {
  testTypes = types;
}

/** Every type: the registry, plus any a node test added. */
export function cmsTypes(): readonly CmsType[] {
  return testTypes.length ? [...CMS_TYPES, ...testTypes] : CMS_TYPES;
}

const BY_KEY = new Map<string, CmsType>(CMS_TYPES.map((t) => [t.key, t]));

/** A Map, not an object lookup, so 'constructor' is not a type. */
export function cmsType(key: string): CmsType | null {
  return BY_KEY.get(key) ?? testTypes.find((t) => t.key === key) ?? null;
}
