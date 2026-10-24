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
import { checkId, slugify } from "./slug";

export type CmsTypeKey = "events" | "workshops" | "webinars";

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
}

/** A type with every option resolved. */
export type CmsType = Required<Omit<CmsTypeSpec, "indexDate">> & Pick<CmsTypeSpec, "indexDate">;

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
