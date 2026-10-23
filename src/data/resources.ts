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

const bilingual = z.object({ en: z.string(), tr: z.string() });

export const resourceSections = ["learning", "md-drug", "databases", "tools", "community"] as const;

export const resourceSchema = z.object({
  section: z.enum(resourceSections),
  /** Position within the section, from 0. */
  order: z.number().int().nonnegative(),
  title: bilingual,
  description: bilingual,
  url: z.string(),
  tags: z.object({ en: z.array(z.string()), tr: z.array(z.string()) }),
  opensource: z.boolean(),
});

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
