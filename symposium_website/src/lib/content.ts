import { getCollection } from "astro:content";
import { getUpcomingEdition } from "./editions-content";
import { fetchOverlay, mergeOverlay, type RepoContent } from "./overlay";
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

export interface CommitteeMember {
  name: string; role: string; roleTr: string;
  affiliation: string; photo: string; linkedin?: string;
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
 * The repo's content for the upcoming edition, merged with whatever the CMS
 * overlay currently has to say. Returns null when there is no upcoming
 * edition at all -- archive pages never call this, since an archived
 * edition has no overlay and asking for one would be a pointless request
 * per page.
 *
 * A failed or mismatched overlay fetch is not an error here: `fetchOverlay`
 * already logged it, and `mergeOverlay` falls back to the repo's own data.
 */
let upcomingContentPromise: Promise<RepoContent | null> | null = null;

/** One overlay fetch per build, not one per page. Every page's layout asks for
 * this to decide which nav items exist, and six routes ask again for their own
 * content; without memoising, a build makes dozens of identical requests, each
 * carrying its own 5s timeout against a host that might be hanging rather than
 * refusing. */
export function getUpcomingContent(): Promise<RepoContent | null> {
  upcomingContentPromise ??= loadUpcomingContent();
  return upcomingContentPromise;
}

async function loadUpcomingContent(): Promise<RepoContent | null> {
  const edition = await getUpcomingEdition();
  if (!edition) return null;

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
  };

  const apiBase = import.meta.env.PUBLIC_API_BASE ?? "https://rsg-turkiye.iscbsc.org";
  const overlay = await fetchOverlay(year, apiBase);
  return mergeOverlay(repo, overlay);
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
