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
    speakerPhoto: z.string().default(""),
    description: z.string(),
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
  }),
});

// ── Learning Paths ────────────────────────────────────────────────────────────
//
// HOW THIS WORKS
// ──────────────
// Learning paths are built from three content collections:
//
//   lp-domains   one file per domain  (genomics.md, ml.md, …)
//   lp-levels    one file per domain × level  (genomics-researcher.md, …)
//   lp-roadmap   one file per stage of the sequential beginner roadmap
//
// TO ADD A RESOURCE to an existing path:
//   Open the right lp-levels file and add an item to the correct section.
//
// TO ADD A WEBINAR reference:
//   Use webinarSlug if the webinar has a page on this site (/webinars/<slug>).
//   Use youtubeUrl if it's only on YouTube yet.
//   Leave both empty to show the webinar as "Recording not yet available."
//
// TO ADD A NEW DOMAIN:
//   1. Create src/content/lp-domains/<id>.md
//   2. Create src/content/lp-levels/<id>-explorer.md  (and other levels)
//   The pages pick them up automatically on the next build.

const resourceSchema = z.object({
  title: z.string(),
  // Explain WHY this resource — what does it give the reader that others don't?
  description: z.string(),
  tag: z.enum([
    "Reading", "Course", "Tutorial", "Tool", "Pipeline",
    "Videos", "Interactive", "Webinar", "Paper", "Dataset",
    "Book", "Platform", "Challenge", "Action",
  ]),
  // For non-webinar resources: the external URL (required unless it's a webinar)
  url: z.string().optional(),
  // For webinar resources — use ONE of these, or neither:
  webinarSlug: z.string().optional(), // slug of the /webinars/<slug> page on this site
  youtubeUrl: z.string().optional(),  // YouTube URL (fallback before the page exists)
  // Optional webinar metadata shown on the card
  speaker: z.string().optional(),
  year: z.number().optional(),
});

// lp-domains — one file per domain, contains metadata and "go deeper" links
// File name becomes the domain ID (e.g. genomics.md → id "genomics")
const lpDomains = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-domains" }),
  schema: z.object({
    name: z.string(),
    emoji: z.string(),
    // One sentence shown on the index page domain card
    tagline: z.string(),
    // Controls ordering on the index page
    order: z.number(),
    // Non-tracked "go further" links shown at the bottom of the domain page
    goDeeper: z.array(z.object({
      title: z.string(),
      description: z.string(),
      url: z.string(),
    })).default([]),
  }),
});

// lp-levels — one file per domain × level combination
// File name convention: <domainId>-<levelId>.md  (e.g. genomics-researcher.md)
// Valid levelIds: explorer, practitioner, researcher, specialist
const lpLevels = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-levels" }),
  schema: z.object({
    // Must match a domain ID in lp-domains (e.g. "genomics")
    domain: z.string(),
    level: z.enum(["explorer", "practitioner", "researcher", "specialist"]),
    // 1–2 sentence paragraph shown at the top of this level section
    orientation: z.string(),
    // Bullet points shown in the "what you should already know" callout
    prerequisites: z.array(z.string()).default([]),
    sections: z.array(z.object({
      // foundations = readings/courses, toolkit = tools, webinars = RSG Turkey, papers = landmark papers
      type: z.enum(["foundations", "toolkit", "webinars", "papers"]),
      resources: z.array(resourceSchema),
    })),
  }),
});

// lp-roadmap — one file per stage of the sequential beginner roadmap (/learning-paths/roadmap)
// File name convention: <number>-<slug>.md  (e.g. 01-discover.md)
// Number controls the display order.
const lpRoadmap = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-roadmap" }),
  schema: z.object({
    number: z.number(),
    emoji: z.string(),
    title: z.string(),
    subtitle: z.string(),
    // "red" for action/milestone stages, "navy" for knowledge-building stages
    color: z.enum(["red", "navy"]),
    resources: z.array(resourceSchema),
  }),
});

export const collections = { blog, webinars, lpDomains, lpLevels, lpRoadmap };
