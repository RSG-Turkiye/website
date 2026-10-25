/**
 * The hand-written text of a page, one JSON file per page in
 * src/content/pages (about.json, join.json). Each key maps to the text in
 * both languages, `{ en, tr }`; both pages of a pair read the same file.
 * Only text the reader sees lives here. Markup, classes and links stay in
 * the page, so a value is plain text, never HTML: a sentence with a link in
 * it is split into keys around the link.
 *
 * No astro:content import here, so node tests can use it; the loader is
 * src/lib/page-text.ts.
 */

import { z } from "astro/zod";

export type Lang = "en" | "tr";

export const pageTextSchema = z.record(
  z.string(),
  // Whitespace only is empty: the page would show nothing.
  z.object({ en: z.string().trim().min(1), tr: z.string().trim().min(1) }).strict(),
);

export type PageText = z.infer<typeof pageTextSchema>;

/**
 * A lookup over one page's text in one language. An unknown key throws, so a
 * typo fails the build instead of rendering an empty string.
 */
export const textLookup =
  (page: string, record: PageText, lang: Lang) =>
  (key: string): string => {
    const entry = Object.hasOwn(record, key) ? record[key] : undefined;
    if (!entry) throw new Error(`src/content/pages/${page}.json has no text "${key}"`);
    return entry[lang];
  };
