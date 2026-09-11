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
  /** The Turkish name for the same hall. Never decides anything; only
   * what a Turkish page prints. */
  venueTr?: string;
  venueCity?: string;
  /** The Turkish name for the same city. Never decides anything; only
   * what a Turkish page prints. */
  venueCityTr?: string;
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
export function locationFor(e: EditionLike, now: Date, lang: "en" | "tr"): LocationDisplay {
  // Two different questions, deliberately answered by two different fields.
  // Whether there *is* a hall is `venue` alone, so both languages agree on
  // the kind -- a hall named only in Turkish must not make the Turkish page
  // say "full" while the English one says "city-only". Which name to print
  // is then the translation, exactly as titleFor does it.
  const hall = e.venue?.trim() ?? "";
  const venue = (lang === "tr" && e.venueTr?.trim()) || hall;
  // The same split as the hall above, and for the same reason: whether a
  // city may be shown is decided by `venueCity` alone, so both languages
  // agree on the kind; which name to print is then the translation.
  const place = e.venueCity?.trim() ?? "";
  const city = (lang === "tr" && e.venueCityTr?.trim()) || place;
  const cityPublishable = e.cityPublic && place;

  if (e.venuePublic && hall) {
    return { kind: "full", venue, city };
  }

  // "To be announced" is a promise about the future. Once the event has
  // happened the hall is not going to be announced, and the hero went on
  // saying "10 October 2026 - Ankara - Venue to be announced" directly above
  // "thanks to everyone who came" -- in simulation, still saying it in June
  // 2028. Past editions whose hall was never published show the city, which
  // is all the site ever knew.
  //
  // `now` is required rather than defaulted so that a new caller has to
  // decide, instead of inheriting a wrong answer from a default argument.
  // "Withheld" is decided by the flag, not by whether the hall's name happens
  // to be sitting in this repository.
  //
  // It used to require the name to be present, which meant the only way to
  // render "the city, and the hall later" was to commit the hall -- into a
  // public repository, where the whole point was that nobody should read it
  // yet. Now `venuePublic: false` says on its own that there is a hall and it
  // is not being announced, the name stays wherever the organisers keep it,
  // and it is typed in beside the flag on the day it becomes public.
  const stillAhead = !e.startDate || endOfEvent(e) > now.getTime();
  if (!e.venuePublic && cityPublishable && stillAhead) {
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
  if (lang !== "tr") return e.title;
  if (e.titleTr) return e.titleTr;

  // Only 2026 has a titleTr, so every Turkish archive page had an English
  // heading -- "12th RSG-Türkiye Student Symposium" with the Turkish body
  // beginning "12. RSG-Türkiye Öğrenci Sempozyumu" two lines below it.
  //
  // Eight hand-typed strings would fix it once. This is a rule instead,
  // because every edition title has the same shape and always will: the only
  // thing that differs is the number, which ordinalLabel already knows how to
  // write in Turkish. An edition whose title is not that shape -- a special
  // one, a renamed one -- falls back to English rather than being mangled,
  // and a titleTr in the file still wins over both.
  const standard = /^(\d+)(?:st|nd|rd|th) RSG-Türkiye Student Symposium$/.exec(e.title.trim());
  if (standard) return `${ordinalLabel(Number(standard[1]), "tr")} RSG-Türkiye Öğrenci Sempozyumu`;
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
  /**
   * "closed" once the deadline has passed. Kept in the list rather than
   * dropped, because the hero has two different things to say: a form that
   * does not exist yet opens soon, and a form whose deadline has passed does
   * not. Dropping closed ones made the second look like the first.
   */
  state: "open" | "closed";
}

/**
 * The calls to action an edition can currently offer.
 *
 * A CTA exists only when its URL does. For the weeks between announcing
 * the symposium and opening the forms, the hero shows a single "opens
 * soon" line instead of disabled buttons -- and the day the URL lands, the
 * button appears with no template change.
 */
export function ctasFor(e: EditionLike, now: Date): Cta[] {
  // A deadline was displayed and never enforced: the day after it passed, the
  // button still said "Register" and the JSON-LD still told Google the offer
  // was InStock. A deadline is the end of the thing it is a deadline for.
  //
  // The whole day of the deadline counts -- a deadline of the 30th means the
  // 30th is your last day, not that you had until midnight as it began.
  const stateOf = (deadline?: Date): Cta["state"] =>
    !deadline || deadline.getTime() + ONE_DAY_MS > now.getTime() ? "open" : "closed";

  const ctas: Cta[] = [];
  const reg = e.registrationUrl?.trim();
  const abs = e.abstractUrl?.trim();
  if (reg) ctas.push({ kind: "registration", url: reg, deadline: e.registrationDeadline, state: stateOf(e.registrationDeadline) });
  if (abs) ctas.push({ kind: "abstract", url: abs, deadline: e.abstractDeadline, state: stateOf(e.abstractDeadline) });
  return ctas;
}

/** The calls to action that can still be acted on. */
export function openCtas(e: EditionLike, now: Date): Cta[] {
  return ctasFor(e, now).filter((c) => c.state === "open");
}

/**
 * What the hero should say where the buttons go.
 *
 * "soon" -- no form exists yet, which is the weeks between announcing the
 * symposium and opening registration. "closed" -- forms existed and their
 * deadlines have passed. "open" -- render the buttons.
 *
 * A three-way choice rather than a template asking `ctas.length === 0`: with
 * deadlines now enforced, an empty list means both of the first two, and the
 * template would have announced that a closed registration was about to open.
 */
export function ctaState(e: EditionLike, now: Date): "soon" | "closed" | "open" {
  const ctas = ctasFor(e, now);
  if (ctas.length === 0) return "soon";
  return ctas.some((c) => c.state === "open") ? "open" : "closed";
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
 * Has the edition happened?
 *
 * Six pages asked this and two of them got it wrong. `schedule` and the two
 * home pages wrote `state === "finished" || state === "just-held"`;
 * `speakers` and `committee` wrote `state === "finished"` and stopped there.
 * So for the seven days after a symposium -- exactly the week people come
 * looking for it -- /speakers said "Speakers will be announced soon" about an
 * event that had finished, directly above the list of the previous edition's
 * speakers, with nothing to say which year either statement was about. The
 * page is out of the menu in that state but it is in the sitemap and its URL
 * still works.
 *
 * One function, so the two states cannot come apart again.
 */
export function hasHappened(state: CurrentEdition["state"]): boolean {
  return state === "finished" || state === "just-held";
}

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
 * Not the number of files: the collection documents editions 4 through 13, so
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
 * The moment a season stops being the present one, as a timestamp.
 *
 * Winter straddles the new year -- a December edition predicts the following
 * December -- so winter of year Y runs to the end of February of Y+1.
 */
export function endOfSeason(season: Season, year: number): number {
  // The one asymmetry: January is winter, so a January edition predicts the
  // following January but is not called stale until March of the year after
  // that -- fourteen months late. Every symposium so far has been in autumn,
  // and narrowing it would mean splitting winter into its two halves for a
  // case that has never occurred.
  switch (season) {
    case "winter": return Date.UTC(year + 1, 2, 1);
    case "spring": return Date.UTC(year, 5, 1);
    case "summer": return Date.UTC(year, 8, 1);
    case "autumn": return Date.UTC(year, 11, 1);
  }
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
): { ordinal: number | null; year: number; season: Season; expired: boolean } | null {
  const current = currentEditionOf(all, now);
  if (current.state === "upcoming" || current.state === "none") return null;
  const last = current.edition;
  if (!last.startDate) return null;
  const ordinal = ordinalOf(last);
  const year = last.year + 1;
  const season = seasonOf(last.startDate);
  return {
    ordinal: ordinal === null ? null : ordinal + 1,
    year,
    season,
    // The prediction assumes the next edition happens a year later, in the
    // same season. If that season has itself gone by -- nobody added the
    // file, the symposium paused -- the sentence advertises a date in the
    // past, so the caller drops the date and keeps the number.
    //
    // This used to compare years, which is two months too coarse: on
    // 15 December 2027 the site still said "expected in autumn 2027", a
    // fortnight after autumn ended, and kept saying it until New Year.
    expired: now.getTime() >= endOfSeason(season, year),
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
