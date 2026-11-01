/**
 * The graduate guide's git content: universities, their MSc programmes and
 * the related-term groups that widen a search ("protein structure" also
 * finds "docking"). Spec: docs/superpowers/specs/2026-11-01-grad-lab-guide-design.md.
 *
 * Professors and labs are NOT here. They are personal data, and git history
 * cannot be deleted (CLAUDE.md rule 4), so they live in D1 and reach the
 * browser through the published search index.
 *
 * University and programme ids are keys that professors' records point at
 * from D1: like learning-path ids, they never change and are never reused.
 *
 * Schemas only, no astro:content import, so node tests can use this file.
 */

import { z } from "astro/zod";

const filled = z.object({ en: z.string().min(1), tr: z.string().min(1) }).strict();
const slug = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "a lowercase slug");
const day = z.iso.date();

/** Names the guide's own routes take under /guide/: a university by one of
 * these names would be shadowed by the static page. */
export const RESERVED_UNIVERSITY_IDS = ["universities", "catalog", "index"];

export const universitySchema = z
  .object({
    /** Also the file name and the page: /guide/<id>. */
    id: slug.refine((s) => !RESERVED_UNIVERSITY_IDS.includes(s), "a reserved route name"),
    name: filled,
    /** In Turkish, as the city filter shows it ("İstanbul"). */
    city: z.string().min(1),
    url: z.url(),
  })
  .strict();

export const MONTHS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;

export const programmeSchema = z
  .object({
    id: slug,
    universityId: slug,
    /** MSc only in the first version; PhD comes later as a second value. */
    type: z.literal("msc"),
    name: filled,
    institute: filled,
    /** The months applications usually open ("6" is June), from past
     * announcements. Written as text because the panel edits them as a list
     * of strings. The guide shows these, not maintained exact dates (spec,
     * "No maintained exact dates"). Empty when nobody knows yet: the card
     * then points to the announcement page. */
    usualMonths: z.array(z.enum(MONTHS)),
    /** An exact window, only when someone reported it; both ends or neither.
     * The pages hide it once it has closed. */
    windowOpens: day.optional(),
    windowCloses: day.optional(),
    announcementUrl: z.url().optional(),
    calendarUrl: z.url().optional(),
    sourceUrl: z.url(),
    checkedAt: day,
    /** Why something is what it is, for the next maintainer. Never rendered. */
    note: z.string().optional(),
  })
  .strict()
  .refine((p) => (p.windowOpens === undefined) === (p.windowCloses === undefined), "a window needs both ends")
  .refine((p) => p.windowOpens === undefined || p.windowCloses === undefined || p.windowOpens <= p.windowCloses, "the window opens after it closes");

export const relatedTermSchema = z
  .object({
    id: slug,
    /** Spellings of one concept, Turkish and English. */
    terms: z.array(z.string().min(1)).min(2),
    /** Ids of other groups a search should also try. */
    related: z.array(slug),
  })
  .strict();

export type University = z.infer<typeof universitySchema>;
export type Programme = z.infer<typeof programmeSchema>;
export type RelatedTerm = z.infer<typeof relatedTermSchema>;

/** Cross-references the schemas cannot see. Returns one message per broken
 * reference; empty means clean. */
export function checkGuideContent(
  universities: Pick<University, "id">[],
  programmes: Pick<Programme, "id" | "universityId">[],
  terms: Pick<RelatedTerm, "id" | "related">[],
): string[] {
  const errors: string[] = [];
  const uni = new Set(universities.map((u) => u.id));
  const termIds = new Set(terms.map((t) => t.id));
  for (const p of programmes) if (!uni.has(p.universityId)) errors.push(`programme ${p.id}: no university ${p.universityId}`);
  for (const t of terms) for (const r of t.related) if (!termIds.has(r)) errors.push(`term ${t.id}: no term group ${r}`);
  return errors;
}
