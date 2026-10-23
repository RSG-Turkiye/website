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

export interface CmsType {
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
   * English side. Existing entries keep their file name. Always a valid id
   * (checkId); throws otherwise. */
  idFrom: (data: any) => string;
  label: { en: string; tr: string };
}

export { checkId, slugify };

/** An id from free text, for a new entry. */
function idFromText(text: unknown, what: string): string {
  // A draft is saved incomplete, so the field may still be missing.
  const id = slugify(typeof text === "string" ? text : "");
  if (id === "") throw new Error(`The ${what} has no letters or digits to make an id from`);
  return checkId(id);
}

export const CMS_TYPES: readonly CmsType[] = [
  {
    key: "events",
    group: "etkinlikler",
    dir: "src/content/events",
    format: "json",
    schema: eventSchema,
    // src/data/events.ts: "Also the file name: src/content/events/<id>.json."
    idFrom: (data: { id: string }) => checkId(data.id),
    label: { en: "Events", tr: "Etkinlikler" },
  },
  {
    key: "workshops",
    group: "etkinlikler",
    dir: "src/content/workshops",
    format: "json",
    schema: workshopSchema,
    // The repo name as a lower-case slug: Computational_Structural_Biology_Workshop
    // is computational-structural-biology-workshop.json.
    idFrom: (data: { repo: string }) => idFromText(data.repo, "repo name"),
    label: { en: "Workshops", tr: "Atölyeler" },
  },
  {
    key: "webinars",
    group: "etkinlikler",
    dir: "src/content/webinars",
    format: "markdown-pair",
    schema: webinarSchema,
    // Existing files are named by hand; a new one gets the English title.
    idFrom: (data: { frontmatter: { title: string } }) => idFromText(data.frontmatter.title, "title"),
    label: { en: "Webinars", tr: "Webinarlar" },
  },
];

const BY_KEY = new Map<string, CmsType>(CMS_TYPES.map((t) => [t.key, t]));

/** A Map, not an object lookup, so 'constructor' is not a type. */
export function cmsType(key: string): CmsType | null {
  return BY_KEY.get(key) ?? null;
}
