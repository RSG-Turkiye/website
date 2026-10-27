import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { workshopSchema } from "./data/workshops";
import { eventSchema } from "./data/events";
import { resourceSchema as linkSchema } from "./data/resources";
import { committeeSchema } from "./data/committees";
import { pageTextSchema } from "./data/page-text";
import { webinarSchema } from "./data/webinars";
import { blogSchema } from "./data/blog";
import { helpSchema } from "./data/help";
import { lpDomainSchema, lpLevelSchema, lpRoadmapSchema } from "./data/learning-paths";

// blog -- posts in en/ and tr/ (see the schema in src/data/blog.ts for the
// layout and how translations are tied).
const blog = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/blog" }),
  schema: blogSchema,
});

// Webinars are organized by language:
//   src/content/webinars/en/<slug>.md  → /webinars/<slug>
//   src/content/webinars/tr/<slug>.md  → /tr/webinars/<slug>
// To add a translation: create a file with the SAME filename in the other lang
// folder -- or, when the two want different slugs, give both files the same
// `translationKey`. Six talks were unreachable in one language because the
// Turkish file had a Turkish name and nothing tied the two together.
const webinars = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/webinars" }),
  // The frontmatter schema lives in src/data/webinars.ts so node and the
  // Pages Functions can use it without astro:content.
  schema: webinarSchema,
});

// ── Learning Paths ────────────────────────────────────────────────────────────
//
// Three collections: lp-domains, lp-levels and lp-roadmap. How they fit
// together, and how to add a resource, a webinar or a domain, is written
// next to their schemas in src/data/learning-paths.ts.

// lp-domains — one file per domain, contains metadata and "go deeper" links
// File name becomes the domain ID (e.g. genomics.md → id "genomics")
const lpDomains = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-domains" }),
  schema: lpDomainSchema,
});

// lp-levels — one file per domain × level combination
// File name convention: <domainId>-<levelId>.md  (e.g. genomics-researcher.md)
// Valid levelIds: explorer, practitioner, researcher, specialist
const lpLevels = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-levels" }),
  schema: lpLevelSchema,
});

// lp-roadmap — one file per stage of the sequential beginner roadmap (/learning-paths/roadmap)
// File name convention: <number>-<slug>.md  (e.g. 01-discover.md)
// Number controls the display order.
const lpRoadmap = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/lp-roadmap" }),
  schema: lpRoadmapSchema,
});

// workshops — one JSON file per workshop, named after its repo (see the
// schema in src/data/workshops.ts for what the fields mean).
const workshops = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/workshops" }),
  schema: workshopSchema,
});

// events — one JSON file per event, named by its id (see the schema in
// src/data/events.ts for what the fields mean; src/lib/get-events.ts loads
// and sorts them).
const events = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/events" }),
  schema: eventSchema,
});

// resources — one JSON file per link on /resources, named after its title
// (see src/data/resources.ts; src/lib/get-resources.ts loads and sorts them).
const resources = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/resources" }),
  schema: linkSchema,
});

// committees -- one JSON file per committee on /about, published with each
// member's consent and without e-mail addresses (see src/data/committees.ts;
// src/lib/get-committees.ts loads them).
const committees = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/committees" }),
  schema: committeeSchema,
});

// pages -- the hand-written text of a page, one JSON file per page (about,
// join), each key mapping to { en, tr } (see src/data/page-text.ts;
// src/lib/page-text.ts reads it and throws on an unknown key).
const pages = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/pages" }),
  schema: pageTextSchema,
});

// help -- the role guides of the admin panel's Help section, one file per
// guide in tr/ and en/ with the same name (see src/data/help.ts).
const help = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/help" }),
  schema: helpSchema,
});

export const collections = { blog, webinars, lpDomains, lpLevels, lpRoadmap, workshops, events, resources, committees, pages, help };
