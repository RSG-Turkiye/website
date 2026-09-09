import { getCollection } from "astro:content";
import { getCurrentEdition } from "./editions-content";
import { fetchOverlay, mergeOverlay, repoCanStandAlone, type RepoContent } from "./overlay";
import type { EditionLike } from "./editions";

export type SessionType =
  | "opening" | "keynote" | "workshop" | "panel" | "talk"
  | "company" | "poster" | "networking" | "break" | "closing";

export interface Speaker {
  slug: string; name: string; position: string; company: string;
  bio: string; photo: string;
  linkedin?: string; twitter?: string; website?: string;
}

export interface Session {
  slug: string; title: string; type: SessionType; speakerSlugs: string[];
  description: string; time: string; endTime?: string; order: number;
}

/** A team label in both languages; `tr` empty means "no Turkish name given",
 * and the English one is shown on both sites. Mirrors the shape
 * functions/_lib/symposium.ts serves. */
export interface Team { en: string; tr: string }

export interface CommitteeMember {
  name: string; role: string; roleTr: string;
  affiliation: string; photo: string; linkedin?: string;
  /** Optional because the overlay is validated with `.passthrough()` and an
   * older payload has no `teams` at all. Read it through `groupByTeam`,
   * never directly, so there is one place that copes with its absence. */
  teams?: Team[];
}

async function forYear<T>(collection: "speakers" | "sessions" | "committee", year: number, key: "people" | "items"): Promise<T[]> {
  const entries = await getCollection(collection);
  const entry = entries.find((e: { data: { year: number } }) => e.data.year === year);
  return entry ? ((entry.data as Record<string, unknown>)[key] as T[]) : [];
}

export const getSpeakers = (year: number) => forYear<Speaker>("speakers", year, "people");
export const getCommittee = (year: number) => forYear<CommitteeMember>("committee", year, "people");

export async function getSessions(year: number): Promise<Session[]> {
  const items = await forYear<Session>("sessions", year, "items");
  return [...items].sort((a, b) => a.order - b.order);
}

export async function getSpeakerBySlug(year: number, slug: string): Promise<Speaker | undefined> {
  return (await getSpeakers(year)).find((s) => s.slug === slug);
}

/**
 * The repo's content for the current edition -- the one still ahead, or the
 * one that just finished -- merged with whatever the CMS overlay has to say.
 * Null only when no dated edition exists at all.
 *
 * A finished edition is still asked for: its overlay keeps serving until the
 * archive run folds it into the repo, and `fetchOverlay` refuses a payload
 * for a different year, so the fallback is always the repo's own content.
 *
 * A failed or mismatched overlay fetch is not an error here: `fetchOverlay`
 * already logged it, and `mergeOverlay` falls back to the repo's own data.
 */
let currentContentPromise: Promise<RepoContent | null> | null = null;

/** One overlay fetch per build, not one per page. Every page's layout asks for
 * this to decide which nav items exist, and six routes ask again for their own
 * content; without memoising, a build makes dozens of identical requests, each
 * carrying its own 5s timeout against a host that might be hanging rather than
 * refusing. */
export function getCurrentContent(): Promise<RepoContent | null> {
  currentContentPromise ??= loadCurrentContent();
  return currentContentPromise;
}

async function loadCurrentContent(): Promise<RepoContent | null> {
  const { entry } = await getCurrentEdition();
  if (!entry) return null;
  const edition = entry;

  const year = edition.data.year;
  const [speakers, sessions, committee] = await Promise.all([
    getSpeakers(year),
    getSessions(year),
    getCommittee(year),
  ]);

  const repo: RepoContent = {
    registrationUrl: edition.data.registrationUrl,
    abstractUrl: edition.data.abstractUrl,
    registrationDeadline: edition.data.registrationDeadline,
    abstractDeadline: edition.data.abstractDeadline,
    venuePublic: edition.data.venuePublic,
    cityPublic: edition.data.cityPublic,
    speakers,
    sessions,
    committee,
    // The repo has none: an announcement is a CMS-only thing, so this is the
    // starting point the overlay replaces.
    announcements: [],
  };

  const apiBase = import.meta.env.PUBLIC_API_BASE ?? "https://rsg-turkiye.iscbsc.org";
  const result = await fetchOverlay(year, apiBase);

  if (result.kind === "unavailable") {
    // Failing is the careful option, not the dramatic one. Cloudflare Pages
    // keeps the last successful deploy when a build fails, so a build that
    // stops here leaves whatever is published exactly where it is. A build
    // that carries on replaces a live programme -- speakers, schedule,
    // committee, the registration link -- with "announced soon", from a
    // nightly rebuild nobody is watching, because an API was down for five
    // seconds.
    //
    // Only when the repo cannot fill the page itself. With content committed,
    // the overlay is what it was always described as -- a layer on top -- and
    // its absence is worth a line in the log and nothing more.
    // process.env, not import.meta.env: Astro only exposes PUBLIC_-prefixed
    // variables through the latter, and this is a build-time escape hatch that
    // has no business being shipped to a browser. Checked the way it is
    // because this module also loads under plain `node --test`.
    const allowEmpty =
      typeof process !== "undefined" && process.env?.SYMPOSIUM_ALLOW_EMPTY_BUILD === "1";

    if (!repoCanStandAlone(repo) && !allowEmpty) {
      throw new Error(
        `[overlay] ${result.reason}, and the repo has no speakers, sessions, ` +
          `committee or links for ${year}. Refusing to publish an empty programme ` +
          `over whatever is live. Set SYMPOSIUM_ALLOW_EMPTY_BUILD=1 to build anyway ` +
          `-- do that when the site is genuinely meant to say "announced soon" and ` +
          `the API is down at the same time.`,
      );
    }
    console.error(`[overlay] ${result.reason} -- building from the repo alone`);
  } else if (result.kind === "empty") {
    // The ordinary state of a symposium nobody has programmed yet.
    console.info(`[overlay] ${result.reason} -- building from the repo alone`);
  }

  return mergeOverlay(repo, result.kind === "ok" ? result.overlay : null);
}

/**
 * The edition-shaped object to hand to `locationFor`/`ctasFor`/`EventJsonLd`:
 * the markdown edition's own `venue`/`venueCity` untouched, with the six
 * overlay-eligible fields (the registration/abstract links and deadlines,
 * and the two publicity flags) layered on from the merged content.
 *
 * `content` is `null` when there is no upcoming edition, in which case the
 * edition is returned as-is -- `venue`/`venueCity` are never assigned here,
 * so the overlay has no path to introduce them.
 */
export function withOverlayContent<T extends EditionLike>(edition: T, content: RepoContent | null): T {
  if (!content) return edition;
  return {
    ...edition,
    registrationUrl: content.registrationUrl,
    abstractUrl: content.abstractUrl,
    registrationDeadline: content.registrationDeadline,
    abstractDeadline: content.abstractDeadline,
    venuePublic: content.venuePublic,
    cityPublic: content.cityPublic,
  };
}
