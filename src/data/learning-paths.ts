import { z } from "astro/zod";

/**
 * The frontmatter of the learning-path collections. Here rather than in
 * src/content.config.ts so node scripts and the Pages Functions (the panel
 * CMS) can use them without astro:content.
 *
 * Learning paths are built from three collections, each a Markdown file per
 * entry under en/ and tr/ with the same file name:
 *
 *   lp-domains   one file per domain  (genomics.md, ml.md, …)
 *   lp-levels    one file per domain × level  (genomics-researcher.md, …)
 *   lp-roadmap   one file per stage of the sequential beginner roadmap
 *
 * TO ADD A RESOURCE to an existing path:
 *   Open the right lp-levels file and add an item to the correct section,
 *   starting with `- id:` and a new unique id. Add the same item, with the same
 *   id, tag and link, to the tr/ file too; only title and description are
 *   translated. tests/lp-resource-ids.test.ts checks both. Then run
 *   `npm run cms:normalize`, which rewrites the file in the form the panel
 *   writes (strings quoted, no blank lines), so the panel's later edits
 *   change only their own lines; tests/cms-serialize.test.ts checks it.
 *
 * TO FIX A DEAD LINK: change the url in place, in en/ and tr/ together, and
 *   keep the id. The weekly link check (scripts/check-lp-links.ts) reports
 *   dead links in the issue labelled `link-check`.
 *
 * TO ADD A WEBINAR reference:
 *   Use webinarSlug if the webinar has a page on this site (/webinars/<slug>).
 *   Use youtubeUrl if it's only on YouTube yet.
 *   Leave both empty to show the webinar as "Recording not yet available."
 *
 * TO ADD A NEW DOMAIN:
 *   1. Create src/content/lp-domains/<id>.md
 *   2. Create src/content/lp-levels/<id>-explorer.md  (and other levels)
 *   The pages pick them up automatically on the next build.
 */

export const lpResourceTags = [
  "Reading", "Course", "Tutorial", "Tool", "Pipeline",
  "Videos", "Interactive", "Webinar", "Paper", "Dataset",
  "Book", "Platform", "Challenge", "Action",
] as const;

/** One resource card. Strict: a misspelt key is refused rather than dropped. */
export const lpResourceSchema = z.object({
  // The key members' progress is saved under, so it must never change once
  // published: reorder, insert or delete freely, but leave every id alone.
  // A new resource gets any new unique id (letters, digits, - and _), the
  // same in en/ and tr/. Turkish pages store it with a "tr-" prefix.
  // Existing ids look positional because they were seeded from the old
  // position-based keys; they are not positions any more.
  id: z.string().regex(/^[a-z0-9_-]+$/i).max(110),
  title: z.string(),
  // Explain WHY this resource — what does it give the reader that others don't?
  description: z.string(),
  tag: z.enum(lpResourceTags),
  // For non-webinar resources: the external URL (required unless it's a webinar)
  url: z.string().optional(),
  // For webinar resources — use ONE of these, or neither:
  webinarSlug: z.string().optional(), // slug of the /webinars/<slug> page on this site
  youtubeUrl: z.string().optional(),  // YouTube URL (fallback before the page exists)
  // Optional webinar metadata shown on the card
  speaker: z.string().optional(),
  year: z.number().optional(),
}).strict();

// lp-domains — one file per domain, contains metadata and "go deeper" links
// File name becomes the domain ID (e.g. genomics.md → id "genomics")
export const lpDomainSchema = z.object({
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
});

// lp-levels — one file per domain × level combination
// File name convention: <domainId>-<levelId>.md  (e.g. genomics-researcher.md)
// Valid levelIds: explorer, practitioner, researcher, specialist
export const lpLevelSchema = z.object({
  // Must match a domain ID in lp-domains (e.g. "genomics")
  domain: z.string(),
  level: z.enum(["explorer", "practitioner", "researcher", "specialist"]),
  // 1–2 sentence paragraph shown at the top of this level section
  orientation: z.string(),
  // Bullet points shown in the "what you should already know" callout
  prerequisites: z.array(z.string()).default([]),
  sections: z.array(z.object({
    // foundations = readings/courses, toolkit = tools, webinars = RSG-Turkiye, papers = landmark papers
    type: z.enum(["foundations", "toolkit", "webinars", "papers"]),
    resources: z.array(lpResourceSchema),
  })),
});

// lp-roadmap — one file per stage of the sequential beginner roadmap (/learning-paths/roadmap)
// File name convention: <number>-<slug>.md  (e.g. 01-discover.md)
// Number controls the display order.
export const lpRoadmapSchema = z.object({
  number: z.number(),
  emoji: z.string(),
  title: z.string(),
  subtitle: z.string(),
  // "red" for action/milestone stages, "navy" for knowledge-building stages
  color: z.enum(["red", "navy"]),
  resources: z.array(lpResourceSchema),
});
