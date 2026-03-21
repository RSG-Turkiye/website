import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: z.object({
    title: z.string(),
    pubDate: z.coerce.date(),
    description: z.string(),
    author: z.string(),
    category: z.string(),
    tags: z.array(z.string()).default([]),
    image: z.string().default(""),
    lang: z.enum(["en", "tr"]).default("tr"),
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

const webinars = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/webinars" }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    speaker: z.string(),
    speakerAffiliation: z.string().default(""),
    description: z.string(),
    youtubeUrl: z.string().default(""),
    slidesUrl: z.string().default(""),
    lang: z.enum(["en", "tr"]).default("tr"),
    year: z.number(),
    type: z.enum(["bioinfonet", "student"]),
  }),
});

export const collections = { blog, webinars };
