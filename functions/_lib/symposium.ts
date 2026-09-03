// Pure shaping for the public symposium overlay. No D1, no fetch, no Env --
// this module is imported directly by tests, so anything with a load-time
// side effect belongs in the route (functions/api/symposium.ts), not here.
// triggerRebuild is the one exception: it uses fetch and takes an Env, but
// only inside a function body that a route calls -- nothing here runs it at
// import time.
import type { Env } from './auth';

// The D1 row shapes, mirroring Task 2's CREATE TABLE statements exactly.
export interface SpeakerRow { id: string; slug: string; year: number; name: string; position: string; company: string; bio: string; photo: string; linkedin: string; sort: number }
export interface SessionRow { id: string; slug: string; year: number; title: string; type: string; time: string; end_time: string; description: string; speaker_slugs: string; sort: number }
export interface CommitteeRow { id: string; year: number; name: string; role: string; role_tr: string; affiliation: string; photo: string; linkedin: string; sort: number }
export interface AnnouncementRow { id: string; title: string; description: string; button_text: string; button_url: string; show_as_popup: number; expires_at: number }
export interface EditionRow { year: number; registration_url: string; registration_deadline: number | null; abstract_url: string; abstract_deadline: number | null; venue_public: number | null; city_public: number | null }

// What the public endpoint serves and the build consumes. Booleans, not 0/1.
export interface EditionOverlay { registrationUrl: string; registrationDeadline: number | null; abstractUrl: string; abstractDeadline: number | null; venuePublic: boolean | null; cityPublic: boolean | null }
export interface OverlaySpeaker { slug: string; name: string; position: string; company: string; bio: string; photo: string; linkedin?: string }
export interface OverlaySession { slug: string; title: string; type: string; speakerSlugs: string[]; description: string; time: string; endTime?: string; order: number }
export interface OverlayCommittee { name: string; role: string; roleTr: string; affiliation: string; photo: string; linkedin?: string }
export interface Overlay {
  year: number | null;
  edition: EditionOverlay;
  speakers: OverlaySpeaker[];
  sessions: OverlaySession[];
  committee: OverlayCommittee[];
  announcements: AnnouncementRow[];
}

// null/undefined -> null; 0 -> false; anything else -> true. Never 0/1 in the
// output -- the consumer is JSON, and 0 is not the same as "no opinion".
function toTriBoolean(value: number | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  return value !== 0;
}

// One bad row's speaker_slugs must not fail the whole build.
function parseSpeakerSlugs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((slug): slug is string => typeof slug === 'string');
  } catch {
    return [];
  }
}

function bySortThenId<T extends { sort: number; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
}

export function rowsToOverlay(
  edition: EditionRow,
  speakers: SpeakerRow[],
  sessions: SessionRow[],
  committee: CommitteeRow[],
  announcements: AnnouncementRow[],
): Overlay {
  const editionOverlay: EditionOverlay = {
    registrationUrl: edition.registration_url,
    registrationDeadline: edition.registration_deadline,
    abstractUrl: edition.abstract_url,
    abstractDeadline: edition.abstract_deadline,
    venuePublic: toTriBoolean(edition.venue_public),
    cityPublic: toTriBoolean(edition.city_public),
  };

  return {
    year: edition.year,
    edition: editionOverlay,
    speakers: bySortThenId(speakers).map((s) => ({
      slug: s.slug,
      name: s.name,
      position: s.position,
      company: s.company,
      bio: s.bio,
      photo: s.photo,
      linkedin: s.linkedin,
    })),
    sessions: bySortThenId(sessions).map((s) => ({
      slug: s.slug,
      title: s.title,
      type: s.type,
      speakerSlugs: parseSpeakerSlugs(s.speaker_slugs),
      description: s.description,
      time: s.time,
      endTime: s.end_time,
      order: s.sort,
    })),
    committee: bySortThenId(committee).map((c) => ({
      name: c.name,
      role: c.role,
      roleTr: c.role_tr,
      affiliation: c.affiliation,
      photo: c.photo,
      linkedin: c.linkedin,
    })),
    announcements,
  };
}

// What the admin edit form submits. registrationDeadline/abstractDeadline are
// plain YYYY-MM-DD strings from an <input type="date">; an empty string (or
// an absent field) means "no deadline". venuePublic/cityPublic are the same
// tri-state as the column they land in: absent or null means "no opinion,
// use the repo's flag" and is left untouched by the editor -- only an
// explicit true/false (including false) overrides it. A tri-state <select>
// with "No opinion" / "Show" / "Hide" options, not a checkbox, is what lets
// the form express all three states; a checkbox can only ever send true/false.
export interface EditionInput {
  registrationUrl?: string;
  registrationDeadline?: string;
  abstractUrl?: string;
  abstractDeadline?: string;
  venuePublic?: boolean | null;
  cityPublic?: boolean | null;
}

// Empty/absent -> '' (the column's own "unset" value, per its NOT NULL
// DEFAULT ''). Anything else must be http(s) -- these values are rendered
// into hrefs on a public site, so a javascript: URL must never reach D1.
function parseHttpUrl(value: string | undefined, field: string): string {
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${field} must be an http(s) URL, got: ${value}`);
  }
  return value;
}

// Empty/absent -> null (no deadline), never 0 -- epoch 0 is 1970, a real
// timestamp, not "unset".
function parseDeadline(value: string | undefined, field: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error(`${field} must be an ISO date (YYYY-MM-DD), got: ${value}`);
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000;
}

// null/undefined -> null ("no opinion"); a boolean is stored as 0 or 1 even
// when it's false, so "hide it" is never dropped as falsy.
function parseTriState(value: boolean | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value ? 1 : 0;
}

/**
 * Validates and shapes an admin edit into the columns `symposium_edition`
 * stores (everything but `year`, which the route upserts by). Throws on a
 * non-http(s) URL or a malformed date rather than silently coercing them.
 */
export function editionRowFromInput(
  input: EditionInput,
): Omit<EditionRow, 'year'> {
  return {
    registration_url: parseHttpUrl(input.registrationUrl, 'registration URL'),
    registration_deadline: parseDeadline(input.registrationDeadline, 'registration deadline'),
    abstract_url: parseHttpUrl(input.abstractUrl, 'abstract URL'),
    abstract_deadline: parseDeadline(input.abstractDeadline, 'abstract deadline'),
    venue_public: parseTriState(input.venuePublic),
    city_public: parseTriState(input.cityPublic),
  };
}

/**
 * Fires the symposium site's deploy hook after a write commits.
 *
 * Never throws and never fails the request: the edit is saved either way,
 * and the nightly rebuild picks it up regardless. The result is returned so
 * the panel can tell the editor whether the site is rebuilding -- a hook
 * that has quietly stopped working is the failure this reports on.
 */
export async function triggerRebuild(env: Env): Promise<{ triggered: boolean; detail: string }> {
  if (!env.SYMPOSIUM_DEPLOY_HOOK) return { triggered: false, detail: 'no hook configured' };
  try {
    const res = await fetch(env.SYMPOSIUM_DEPLOY_HOOK, { method: 'POST' });
    const body = await res.text();
    if (!res.ok) console.error(`rebuild hook ${res.status}: ${body.slice(0, 200)}`);
    return { triggered: res.ok, detail: res.ok ? 'rebuild started' : `hook ${res.status}` };
  } catch (err) {
    console.error(`rebuild hook threw: ${String(err).slice(0, 200)}`);
    return { triggered: false, detail: 'hook unreachable' };
  }
}
