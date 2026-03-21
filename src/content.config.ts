import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Blog posts are organized by language:
//   src/content/blog/en/<slug>.md  → /blog/<slug>
//   src/content/blog/tr/<slug>.md  → /tr/blog/<slug>
// To add a translation: create a file with the SAME filename in the other lang folder.
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
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
  }),
});

// Webinars are organized by language:
//   src/content/webinars/en/<slug>.md  → /webinars/<slug>
//   src/content/webinars/tr/<slug>.md  → /tr/webinars/<slug>
// To add a translation: create a file with the SAME filename in the other lang folder.
const webinars = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/webinars" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    speaker: z.string(),
    speakerAffiliation: z.string().default(""),
    speakerTitle: z.string().default(""),
    description: z.string(),
    youtubeUrl: z.string().default(""),
    slidesUrl: z.string().default(""),
    lang: z.enum(["en", "tr"]).optional(), // kept for legacy frontmatter; language now inferred from directory
    year: z.number(),
    type: z.enum(["bioinfonet", "student"]),
    image: z.string().default(""),
    topic: z.string().default(""),
    keyTakeaways: z.array(z.string()).default([]),
  }),
});

export const collections = { blog, webinars };
