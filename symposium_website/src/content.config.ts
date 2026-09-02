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
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    titleTr: z.string().default(""),
    subtitleTr: z.string().default(""),
    venuePublic: z.boolean().default(true),
    cityPublic: z.boolean().default(true),
    registrationUrl: z.string().default(""),
    abstractUrl: z.string().default(""),
    registrationDeadline: z.coerce.date().optional(),
    abstractDeadline: z.coerce.date().optional(),
  }),
});

export const collections = { editions };
