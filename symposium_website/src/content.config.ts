import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// The editions schema below is mirrored by hand as `EditionLike` in
// src/lib/editions.ts, which is where the date, location and CTA rules live
// so they can be tested without Astro. Add a field here that those rules
// should see and add it there too -- nothing enforces the pairing.

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

const speakers = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/speakers" }),
  schema: z.object({
    year: z.number(),
    people: z.array(z.object({
      slug: z.string(),
      name: z.string(),
      position: z.string().default(""),
      company: z.string().default(""),
      bio: z.string().default(""),
      photo: z.string().default(""),
      linkedin: z.string().optional(),
      twitter: z.string().optional(),
      website: z.string().optional(),
    })),
  }),
});

const sessions = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/sessions" }),
  schema: z.object({
    year: z.number(),
    items: z.array(z.object({
      slug: z.string(),
      title: z.string(),
      type: z.enum(["opening","keynote","workshop","panel","talk","company","poster","networking","break","closing"]),
      speakerSlugs: z.array(z.string()).default([]),
      description: z.string().default(""),
      time: z.string().default(""),
      endTime: z.string().optional(),
      order: z.number(),
    })),
  }),
});

const committee = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/committee" }),
  schema: z.object({
    year: z.number(),
    people: z.array(z.object({
      name: z.string(),
      role: z.string().default(""),
      roleTr: z.string().default(""),
      affiliation: z.string().default(""),
      photo: z.string().default(""),
      linkedin: z.string().optional(),
    })),
  }),
});

/**
 * Turkish bodies for the edition pages, keyed by year.
 *
 * Deliberately a second collection rather than a `tr/` folder inside
 * `editions`: that glob is `**\/*.md`, so a translation living under it would
 * load as a second edition for the same year and every date rule -- which
 * edition is upcoming, which have finished -- would start seeing two of them.
 * Here the translation carries prose and nothing else; the dates, venue and
 * flags stay in one place.
 *
 * A year with no file here falls back to the English body, so a missing
 * translation degrades to what the page showed before rather than to nothing.
 */
const editionsTr = defineCollection({
  loader: glob({ pattern: "*.md", base: "./src/content/editions-tr" }),
  schema: z.object({ year: z.number() }),
});

export const collections = { editions, speakers, sessions, committee, editionsTr };
