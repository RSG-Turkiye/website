/**
 * The shape the edition rules need.
 *
 * Declared structurally rather than as CollectionEntry<"editions">["data"] so
 * this module stays importable from a plain node:test run: anything that
 * reaches astro:content cannot be unit tested, because that module only
 * exists inside an Astro build.
 */
export interface EditionLike {
  year: number;
  title: string;
  titleTr?: string;
  subtitle?: string;
  subtitleTr?: string;
  startDate?: Date;
  endDate?: Date;
  venue?: string;
  venueCity?: string;
  venuePublic?: boolean;
  cityPublic?: boolean;
  registrationUrl?: string;
  abstractUrl?: string;
  registrationDeadline?: Date;
  abstractDeadline?: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment an edition stops being current: midnight after its last day.
 *
 * Comparing `startDate` against the clock directly would archive the
 * symposium at one minute past midnight on the morning it happens, so the
 * site would advertise it as over while people were still in the room.
 */
function endOfEvent(e: EditionLike): number {
  const last = e.endDate ?? e.startDate!;
  return last.getTime() + ONE_DAY_MS;
}

/**
 * Splits editions into the one we are currently announcing, future editions not yet announced, and the archive.
 *
 * Pure and `now`-injected so the transition can be tested without touching
 * the system clock. An edition with no `startDate` is always archive: only
 * the year is recorded for 2018-2023.
 */
export function splitEditions(
  all: EditionLike[],
  now: Date
): { upcoming: EditionLike | null; future: EditionLike[]; past: EditionLike[] } {
  const current = all
    .filter((e) => e.startDate && endOfEvent(e) > now.getTime())
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime());

  const upcoming = current[0] ?? null;

  const future = current.slice(1);

  const past = all
    .filter((e) => e !== upcoming && !future.includes(e))
    .sort((a, b) => b.year - a.year);

  return { upcoming, future, past };
}

export type LocationDisplay =
  | { kind: "full"; venue: string; city: string }
  | { kind: "city-only"; city: string }
  | { kind: "hidden" };

/**
 * What a page may say about where the symposium is.
 *
 * Two independent flags because they answer different questions: the city
 * can be announced so people can plan travel while the hall is still
 * unannounced. Every page and the JSON-LD go through this one function, so
 * there is a single place the hall can leak from -- and one place to test.
 */
export function locationFor(e: EditionLike): LocationDisplay {
  const venue = e.venue?.trim() ?? "";
  const city = e.venueCity?.trim() ?? "";

  if (e.venuePublic && venue) {
    return { kind: "full", venue, city };
  }
  if (e.cityPublic && city) {
    return { kind: "city-only", city };
  }
  return { kind: "hidden" };
}
