/**
 * The events the /events page lists, in one place and with real dates.
 *
 * There used to be two copies of this list -- one inside `pages/events.astro`
 * and a translated one inside `pages/tr/events.astro` -- and each event
 * carried a literal `status: "upcoming" | "completed"`. A hand-written status
 * cannot expire, so in September 2026 the page was still advertising "Annual
 * Symposium 2025 - TBD 2025" as upcoming, with a Register button, alongside a
 * symposium list that stopped at 2024.
 *
 * So: one list, both languages side by side in each entry, and a status
 * derived from the date. An event whose last day has passed is completed, and
 * nothing has to be remembered on the day it happens.
 *
 * The events themselves are in src/content/events, one JSON file per event,
 * named by its id; src/lib/get-events.ts loads them. This file holds what
 * they mean (the schema) and what is derived from them, and has no
 * astro:content import so node tests can use it.
 *
 * Symposiums are listed for the last few years only; the full archive, back
 * to the first in Cappadocia in 2012, lives on the symposium site, which the
 * page links to. Workshops are the ones the organisation's own records
 * document.
 */

import { z } from "astro/zod";
import { imageUrl } from "./image-url";

const bilingual = z.object({ en: z.string(), tr: z.string() }).strict();

/** A calendar day as YYYY-MM-DD, nothing else: not a timestamp, not a number,
 * not 2026-02-30. Read as UTC midnight, the instant `new Date("2026-10-10")`
 * gives. */
const isoDay = z.iso.date().transform((s) => new Date(s));

export const eventSchema = z
  .object({
    /** Also the file name: src/content/events/<id>.json. */
    id: z.string(),
    type: z.enum(["symposium", "workshop", "hackathon", "meetup"]),
    /** First day, as YYYY-MM-DD, read as UTC midnight -- the same instant
     * `new Date("2026-10-10")` gives. Used only for ordering and the status. */
    start: isoDay,
    /** Last day, when the event runs longer than one. Defaults to `start`. */
    end: isoDay.optional(),
    /** Why a date or detail is what it is, for the next maintainer: JSON has no
     * comments. Never rendered. */
    note: z.string().optional(),
    title: bilingual,
    /** The date as a reader should see it. `start`/`end` drive the logic; this
     * drives the page, so "3 – 4 October 2023" does not have to be derived. */
    when: bilingual,
    location: bilingual,
    description: bilingual,
    /** Public pages that show the event or what came out of it: the nf-core
     * local-site page, a merged pull request, the materials repository
     * (github.com/RSG-Turkiye/<repo>, labelled "Workshop materials"). */
    links: z.array(z.object({ label: bilingual, url: z.string() }).strict()).optional(),
    /** Part of RSG-Türkiye's nf-core / Nextflow work, which /workshops groups. */
    nfcore: z.boolean().optional(),
    /** A photo or poster, served from R2 through /api/images (r2.dev is blocked
     * in Türkiye). `thumb` is about 720px for the card, `full` up to 1600px for
     * a click. Posters use fit "contain" so the card does not crop their text. */
    image: z
      .object({ thumb: imageUrl, full: imageUrl, alt: bilingual, fit: z.enum(["cover", "contain"]).optional() })
      .strict()
      .optional(),
  })
  .strict()
  // Zod still runs this when a date itself failed (it then holds the raw
  // input), so it only compares two real dates.
  .refine((e) => !(e.start instanceof Date && e.end instanceof Date) || e.end.getTime() >= e.start.getTime(), {
    message: "end is before start",
    path: ["end"],
  });

export type CommunityEvent = z.infer<typeof eventSchema>;
export type EventType = CommunityEvent["type"];
export type EventStatus = "upcoming" | "completed";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether an event is still ahead of us.
 *
 * Midnight after the last day, not the first moment of it: an event should not
 * flip to "completed" while people are still in the room. Same rule as the
 * symposium site's `endOfEvent`.
 *
 * `now` is required rather than defaulted so a caller has to decide, instead
 * of inheriting a wrong answer from a default argument.
 */
export function statusOf(event: CommunityEvent, now: Date): EventStatus {
  const last = event.end ?? event.start;
  return last.getTime() + ONE_DAY_MS > now.getTime() ? "upcoming" : "completed";
}

/** Newest first, which is the order a reader expects an archive in. */
function byDateDesc(a: CommunityEvent, b: CommunityEvent) {
  return b.start.getTime() - a.start.getTime();
}

/**
 * The sections the page renders: what is still ahead, then the symposiums
 * that have happened, then the hackathons and the workshops.
 *
 * `upcoming` is returned even when empty so the caller decides whether to
 * render a heading over nothing -- it should not, and does not.
 */
export function groupEvents(all: CommunityEvent[], now: Date) {
  const upcoming = all.filter((e) => statusOf(e, now) === "upcoming");
  const past = all.filter((e) => statusOf(e, now) === "completed");
  return {
    upcoming: [...upcoming].sort((a, b) => a.start.getTime() - b.start.getTime()),
    symposiums: past.filter((e) => e.type === "symposium").sort(byDateDesc),
    workshops: past.filter((e) => e.type === "workshop").sort(byDateDesc),
    hackathons: past.filter((e) => e.type === "hackathon").sort(byDateDesc),
    meetups: past.filter((e) => e.type === "meetup").sort(byDateDesc),
  };
}

/**
 * Newest start first, ties by id. Explicit, so the order never depends on how
 * the file system lists the collection.
 */
export const sortEvents = (list: CommunityEvent[]) =>
  [...list].sort((a, b) => b.start.getTime() - a.start.getTime() || a.id.localeCompare(b.id, "en"));

/**
 * The year RSG-Türkiye was founded, per the "Glorious History of RSG Turkey"
 * slide its founders showed at the 2017 and 2018 symposiums: "Founded by
 * Billur Engin, Nurcan Tunçbağ and Emre Güney, 2011". The first student
 * symposium followed in 2012, which is a different and also true number --
 * "since 2012" elsewhere on the site refers to the symposiums, not the group.
 */
export const FOUNDED_YEAR = 2011;

/** Whole years since founding, for the counter on the homepage. It read a
 * hard-coded "10+" for years; the group turned ten in 2021. */
export function yearsSinceFounding(now: Date): number {
  return now.getFullYear() - FOUNDED_YEAR;
}
