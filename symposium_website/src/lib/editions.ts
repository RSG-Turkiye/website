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
  /** Presentation-only, never used by the date logic: the poster image and the
   * human-written date string an edition card renders. */
  posterImage?: string;
  date?: string;
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
  | { kind: "withheld"; city: string }
  | { kind: "city-only"; city: string }
  | { kind: "hidden" };

/**
 * What a page may say about where the symposium is.
 *
 * Four kinds distinguish venue recorded-but-withheld from never-recorded:
 * - full: hall is public; city rides along regardless of cityPublic
 *         (naming the hall discloses the city anyway)
 * - withheld: hall recorded but not announced; city must be public
 * - city-only: no hall on record; city is public
 * - hidden: nothing may be said
 *
 * Two independent flags because they answer different questions: the city
 * can be announced so people can plan travel while the hall is still
 * unannounced. Every page and the JSON-LD go through this one function, so
 * there is a single place the hall can leak from -- and one place to test.
 */
export function locationFor(e: EditionLike): LocationDisplay {
  const venue = e.venue?.trim() ?? "";
  const city = e.venueCity?.trim() ?? "";
  const cityPublishable = e.cityPublic && city;

  if (e.venuePublic && venue) {
    return { kind: "full", venue, city };
  }
  if (venue && cityPublishable) {
    return { kind: "withheld", city };
  }
  if (cityPublishable) {
    return { kind: "city-only", city };
  }
  return { kind: "hidden" };
}

/**
 * The title to render for a given language.
 *
 * Falls back to the English title whenever the Turkish one is absent or
 * empty -- which is the common case: most archived editions have no
 * `titleTr` at all, so this is the well-trodden path, not an edge case.
 */
export function titleFor(e: EditionLike, lang: "en" | "tr"): string {
  if (lang === "tr" && e.titleTr) return e.titleTr;
  return e.title;
}

/**
 * The subtitle to render for a given language, with the same English
 * fallback as {@link titleFor}.
 */
export function subtitleFor(e: EditionLike, lang: "en" | "tr"): string | undefined {
  if (lang === "tr" && e.subtitleTr) return e.subtitleTr;
  return e.subtitle;
}

export interface Cta {
  kind: "registration" | "abstract";
  url: string;
  deadline?: Date;
}

/**
 * The calls to action an edition can currently offer.
 *
 * A CTA exists only when its URL does. For the weeks between announcing
 * the symposium and opening the forms, the hero shows a single "opens
 * soon" line instead of disabled buttons -- and the day the URL lands, the
 * button appears with no template change.
 */
export function ctasFor(e: EditionLike): Cta[] {
  const ctas: Cta[] = [];
  const reg = e.registrationUrl?.trim();
  const abs = e.abstractUrl?.trim();
  if (reg) ctas.push({ kind: "registration", url: reg, deadline: e.registrationDeadline });
  if (abs) ctas.push({ kind: "abstract", url: abs, deadline: e.abstractDeadline });
  return ctas;
}

/**
 * Which edition the programme pages should present, and how.
 *
 * "upcoming" and "past" were only ever given one presentation each, so the
 * morning after a symposium every programme surface fell back to "will be
 * announced soon" about an event that had already happened. A finished
 * edition needs its own state: the same content, kept as a record, with the
 * calls to action gone.
 *
 * `finished` is the most recently finished *dated* edition. An undated entry
 * is archive material with no programme to present, so it is never current.
 */
export type CurrentEdition =
  | { state: "upcoming"; edition: EditionLike }
  | { state: "finished"; edition: EditionLike }
  | { state: "none"; edition: null };

export function currentEditionOf(all: EditionLike[], now: Date): CurrentEdition {
  const { upcoming, past } = splitEditions(all, now);
  if (upcoming) return { state: "upcoming", edition: upcoming };

  // `past` is already newest-first; the first dated entry is the one that
  // just finished.
  const lastFinished = past.find((e) => e.startDate);
  if (lastFinished) return { state: "finished", edition: lastFinished };

  return { state: "none", edition: null };
}
