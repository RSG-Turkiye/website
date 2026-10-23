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
   * English side. Existing entries keep their file name. */
  idFrom: (data: any) => string;
  label: { en: string; tr: string };
}

const TR_ASCII: Record<string, string> = { ç: "c", ğ: "g", ı: "i", İ: "i", ö: "o", ş: "s", ü: "u" };

/** A file-name slug: Turkish letters transliterated, everything else not a
 * letter or digit collapsed to single hyphens. */
export function slugify(text: string): string {
  return text
    .replace(/[çğıİöşü]/gi, (c) => TR_ASCII[c] ?? TR_ASCII[c.toLowerCase()] ?? c)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export const CMS_TYPES: readonly CmsType[] = [
  {
    key: "events",
    group: "etkinlikler",
    dir: "src/content/events",
    format: "json",
    schema: eventSchema,
    // src/data/events.ts: "Also the file name: src/content/events/<id>.json."
    idFrom: (data: { id: string }) => data.id,
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
    idFrom: (data: { repo: string }) => slugify(data.repo),
    label: { en: "Workshops", tr: "Atölyeler" },
  },
  {
    key: "webinars",
    group: "etkinlikler",
    dir: "src/content/webinars",
    format: "markdown-pair",
    schema: webinarSchema,
    // Existing files are named by hand; a new one gets the English title.
    idFrom: (data: { frontmatter: { title: string } }) => slugify(data.frontmatter.title),
    label: { en: "Webinars", tr: "Webinarlar" },
  },
];

const BY_KEY = new Map<string, CmsType>(CMS_TYPES.map((t) => [t.key, t]));

/** A Map, not an object lookup, so 'constructor' is not a type. */
export function cmsType(key: string): CmsType | null {
  return BY_KEY.get(key) ?? null;
}
