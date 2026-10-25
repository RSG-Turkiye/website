/**
 * The links on /resources and /tr/resources, one JSON file each in
 * src/content/resources. The two pages used to carry a literal array apiece;
 * titles and tags differ between the languages as well as descriptions
 * ("EMBL-EBI Training" / "EMBL-EBI Eğitim"), so all three are `{ en, tr }`.
 *
 * `section` uses the same ids as the page's section list. A link that sits in
 * two sections (TeachOpenCADD) is two files, one per placement.
 *
 * No astro:content import here, so node tests can use it; the loader is
 * src/lib/get-resources.ts.
 */

import { z } from "astro/zod";

/** A text the card shows: both languages written, as
 * tests/content-resources.test.ts requires, so the panel refuses an empty one
 * at submit instead of CI after the merge. */
const said = z.string().min(1).regex(/\S/, "Write something, not only spaces");
const filled = z.object({ en: said, tr: said }).strict();

/** Tags: at least one, and as many in Turkish as in English (the content
 * test's rule). A missing translation is work in progress (`incomplete`): a
 * save keeps it, submit refuses it. */
export const TAGS_MISSING_MESSAGE = "Add at least one tag";
export const TAGS_PARITY_MESSAGE = "Give as many Turkish tags as English ones";
const tagsSchema = z
  .object({ en: z.array(said).min(1, TAGS_MISSING_MESSAGE), tr: z.array(said) })
  .strict()
  .refine((t) => t.en.length === t.tr.length, { message: TAGS_PARITY_MESSAGE, path: ["tr"], params: { incomplete: true } });

export const resourceSections = ["learning", "md-drug", "databases", "tools", "community"] as const;

export const resourceSchema = z.object({
  section: z.enum(resourceSections),
  /** Position within the section, from 0. */
  order: z.number().int().nonnegative(),
  title: filled,
  description: filled,
  url: said,
  tags: tagsSchema,
  opensource: z.boolean(),
}).strict();

export type ResourceEntry = z.infer<typeof resourceSchema>;
export type ResourceSection = (typeof resourceSections)[number];

/** Section order as the page lists them, then position within the section. */
export const sortResources = (list: ResourceEntry[]) =>
  [...list].sort(
    (a, b) =>
      resourceSections.indexOf(a.section) - resourceSections.indexOf(b.section) ||
      a.order - b.order ||
      a.title.en.localeCompare(b.title.en, "en"),
  );

/** One section's resources in one language, in the shape the cards render. */
export function resourcesFor(list: ResourceEntry[], section: ResourceSection, lang: "en" | "tr") {
  return sortResources(list)
    .filter((r) => r.section === section)
    .map((r) => ({
      title: r.title[lang],
      description: r.description[lang],
      url: r.url,
      tags: r.tags[lang],
      opensource: r.opensource,
    }));
}
