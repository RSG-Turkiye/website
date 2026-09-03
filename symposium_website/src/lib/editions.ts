/**
 * The shape the edition rules need.
 *
 * Declared structurally rather than as CollectionEntry<"editions">["data"] so
 * this module stays importable from a plain node:test run: anything that
 * reaches astro:content cannot be unit tested, because that module only
 * exists inside an Astro build.
 */
/**
 * The shape the date, location and CTA rules work against.
 *
 * Deliberately a hand-written mirror of the editions schema in
 * `src/content.config.ts`, not derived from it: keeping it separate is what
 * lets these rules be unit-tested outside Astro, since `astro:content` cannot
 * be imported from a plain node:test run. The cost is that the two can drift
 * -- add a field to the schema and forget it here and the rules simply cannot
 * see it. If you change one, check the other.
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
  recordingsUrl?: string;
  date?: string;
  dateTr?: string;
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
  | { state: "just-held"; edition: EditionLike }
  | { state: "finished"; edition: EditionLike }
  | { state: "none"; edition: null };

/**
 * How long a finished edition stays the headline before becoming archive.
 *
 * The week after is when people come looking for the talks, so demoting the
 * symposium to an archive entry the morning after throws away the only week
 * anyone was going to read it.
 */
export const COOLDOWN_DAYS = 7;

export function currentEditionOf(all: EditionLike[], now: Date): CurrentEdition {
  const { upcoming, past } = splitEditions(all, now);
  if (upcoming) return { state: "upcoming", edition: upcoming };

  // `past` is already newest-first; the first dated entry is the one that
  // just finished.
  const lastFinished = past.find((e) => e.startDate);
  if (lastFinished) {
    const cooling = now.getTime() < endOfEvent(lastFinished) + COOLDOWN_DAYS * ONE_DAY_MS;
    return { state: cooling ? "just-held" : "finished", edition: lastFinished };
  }

  return { state: "none", edition: null };
}

/**
 * The edition's own number, read from the front of its title ("13th RSG-Türkiye
 * Student Symposium" -> 13). Null when the title does not start with one, so a
 * caller can fall back rather than publish a guess.
 */
export function ordinalOf(edition: EditionLike): number | null {
  const m = /^(\d+)(st|nd|rd|th)\b/.exec(edition.title.trim());
  return m ? Number(m[1]) : null;
}

/**
 * How many symposiums have been held, for the counters on the homepage and
 * /about -- which said 12+ and 11+ respectively, disagreeing with each other.
 *
 * Not the number of files: the collection documents editions 5 through 13, so
 * counting entries would publish 9 and quietly deny that the first four
 * happened. The titles carry the real count, and the highest of them is the
 * edition currently in play -- so subtract it while it is still ahead of us.
 *
 * Falls back to the number of entries when no title is numbered, and never
 * returns less than that, so the figure cannot drift below what the site
 * itself lists.
 */
export function symposiumsHeld(all: EditionLike[], now: Date): number {
  const highest = all.reduce((max, e) => Math.max(max, ordinalOf(e) ?? 0), 0);
  const { upcoming } = splitEditions(all, now);
  const upcomingOrdinal = upcoming ? ordinalOf(upcoming) : null;
  const held = upcomingOrdinal === highest && highest > 0 ? highest - 1 : highest;
  return Math.max(held, all.length);
}


/** The human-written date string in `lang`, falling back to the English one
 * when no translation exists -- the same shape as titleFor and subtitleFor. */
export function dateFor(edition: EditionLike, lang: "en" | "tr"): string {
  return (lang === "tr" && edition.dateTr) || edition.date || "";
}


export type Season = "winter" | "spring" | "summer" | "autumn";

/** The season a date falls in, by month. Used to say when the next edition is
 * likely to be, from when the last one actually was. */
export function seasonOf(date: Date): Season {
  const m = date.getUTCMonth();
  if (m <= 1 || m === 11) return "winter";
  if (m <= 4) return "spring";
  if (m <= 7) return "summer";
  return "autumn";
}

/**
 * What to say about the edition that has not been announced yet, once the
 * finished one has stopped being news.
 *
 * Everything here is derived from the last edition: its number plus one, its
 * year plus one, and the season it was actually held in. Nothing is
 * hand-maintained, so nobody has to remember to update it -- and if the
 * symposium ever moves to spring, the sentence moves with it.
 *
 * Deliberately not a countdown. A counter to a date nobody has set would be
 * telling visitors something untrue, and it would make the real countdown
 * mean less when there is one.
 *
 * Null while an edition is still ahead of us, or when there is nothing to
 * count from.
 */
export function nextEditionHint(
  all: EditionLike[],
  now: Date
): { ordinal: number | null; year: number; season: Season } | null {
  const current = currentEditionOf(all, now);
  if (current.state === "upcoming" || current.state === "none") return null;
  const last = current.edition;
  if (!last.startDate) return null;
  const ordinal = ordinalOf(last);
  return {
    ordinal: ordinal === null ? null : ordinal + 1,
    year: last.year + 1,
    season: seasonOf(last.startDate),
  };
}


/** "14" -> "14th" in English, "14." in Turkish. Written out rather than kept
 * as a translation string, because it is a rule: 1st, 2nd, 3rd and the teens
 * are all exceptions and a string cannot express them. */
export function ordinalLabel(n: number, lang: "en" | "tr"): string {
  if (lang === "tr") return `${n}.`;
  const teen = n % 100;
  if (teen >= 11 && teen <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
