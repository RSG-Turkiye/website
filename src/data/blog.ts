import { z } from "astro/zod";

/**
 * The frontmatter of a blog post. Posts are Markdown, organized by language:
 *   src/content/blog/en/<slug>.md  → /blog/<slug>
 *   src/content/blog/tr/<slug>.md  → /tr/blog/<slug>
 * To add a translation: create a file with the SAME filename in the other lang
 * folder -- or, when the two want different slugs, give both files the same
 * `translationKey`. Six talks were unreachable in one language because the
 * Turkish file had a Turkish name and nothing tied the two together.
 *
 * Here rather than in src/content.config.ts so node scripts and the Pages
 * Functions (the panel CMS) can use it without astro:content.
 */
export const blogSchema = z.object({
  title: z.string(),
  /** Ties this entry to its other-language twin when the slugs differ. */
  translationKey: z.string().default(""),
  pubDate: z.coerce.date(),
  description: z.string(),
  author: z.string().default(""),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  image: z.string().default(""),
  lang: z.enum(["en", "tr"]).optional(), // kept for legacy frontmatter; language now inferred from directory
  draft: z.boolean().default(false),
  type: z.enum(["post", "webinar"]).default("post"),
  youtubeUrl: z.string().default(""),
  speaker: z.string().default(""),
  speakerAffiliation: z.string().default(""),
  speakerTitle: z.string().default(""),
  topic: z.string().default(""),
  keyTakeaways: z.array(z.string()).default([]),
  slidesUrl: z.string().default(""),
});
