import { z } from "astro/zod";

/**
 * The frontmatter of a webinar page. Webinars are Markdown, organized by
 * language:
 *   src/content/webinars/en/<slug>.md  → /webinars/<slug>
 *   src/content/webinars/tr/<slug>.md  → /tr/webinars/<slug>
 * To add a translation: create a file with the SAME filename in the other lang
 * folder -- or, when the two want different slugs, give both files the same
 * `translationKey` (src/lib/translations.ts).
 *
 * Here rather than in src/content.config.ts so node scripts and the Pages
 * Functions (the panel CMS) can use it without astro:content.
 */
export const webinarSchema = z.object({
  title: z.string().min(1),
  /** Ties this entry to its other-language twin when the slugs differ. */
  translationKey: z.string().default(""),
  date: z.coerce.date(),
  speaker: z.string().min(1),
  speakerAffiliation: z.string().default(""),
  speakerTitle: z.string().default(""),
  speakerPhoto: z.string().default(""),
  description: z.string().min(1),
  youtubeUrl: z.string().default(""),
  slidesUrl: z.string().default(""),
  lang: z.enum(["en", "tr"]).optional(), // kept for legacy frontmatter; language now inferred from directory
  year: z.number(),
  type: z.enum(["bioinfonet", "student"]),
  image: z.string().default(""),
  topic: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  // Tag this webinar to learning path domains so it can be cross-linked.
  // Valid values: genomics, ml, structural, metagenomics, popgen, systems
  // Example: domains: [genomics, ml]
  domains: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});

export type Webinar = z.infer<typeof webinarSchema>;
