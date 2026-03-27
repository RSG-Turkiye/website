import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const editions = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/editions" }),
  schema: z.object({
    year: z.number(),
    title: z.string(),
    subtitle: z.string().default(""),
    date: z.string(),
    venue: z.string().default(""),
    venueCity: z.string().default(""),
    posterImage: z.string().default(""),
    galleryImages: z.array(z.string()).default([]),
    speakers: z.array(z.string()).default([]),  // speaker slugs
  }),
});

export const collections = { editions };
