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

// One bad row's speaker_slugs must not fail the whole build. Exported so the
// admin routes can reuse the exact same parsing when they hand a session
// back to its edit form -- one definition of "how speaker_slugs decodes",
// not a second one that can drift.
export function parseSpeakerSlugs(raw: string): string[] {
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

// What the admin edit form both submits and is loaded with -- GET and PUT on
// functions/api/admin/symposium/edition.ts speak this exact shape, so a form
// that loads a value, changes nothing, and saves is a no-op rather than a
// corruption. registrationDeadline/abstractDeadline are plain YYYY-MM-DD
// strings from an <input type="date">, or null; an empty string, null, or an
// absent field all mean "no deadline". venuePublic/cityPublic are the same
// tri-state as the column they land in: absent or null means "no opinion,
// use the repo's flag" and is left untouched by the editor -- only an
// explicit true/false (including false) overrides it. A tri-state <select>
// with "No opinion" / "Show" / "Hide" options, not a checkbox, is what lets
// the form express all three states; a checkbox can only ever send true/false.
export interface EditionInput {
  registrationUrl?: string;
  registrationDeadline?: string | null;
  abstractUrl?: string;
  abstractDeadline?: string | null;
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

// Empty/null/absent -> null (no deadline), never 0 -- epoch 0 is 1970, a
// real timestamp, not "unset".
function parseDeadline(value: string | null | undefined, field: string): number | null {
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

// The inverse of parseDeadline: an epoch timestamp becomes the YYYY-MM-DD an
// <input type="date"> expects; null stays null, never "1970-01-01".
function deadlineToDateString(value: number | null): string | null {
  if (value === null) return null;
  const d = new Date(value * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Validates and shapes an admin edit into the row `symposium_edition`
 * stores. Throws on a non-http(s) URL or a malformed date rather than
 * silently coercing them. `year` is threaded through separately -- it names
 * which row is being edited, not a field of the edit itself.
 */
export function editionRowFromInput(input: EditionInput, year: number): EditionRow {
  return {
    year,
    registration_url: parseHttpUrl(input.registrationUrl, 'registration URL'),
    registration_deadline: parseDeadline(input.registrationDeadline, 'registration deadline'),
    abstract_url: parseHttpUrl(input.abstractUrl, 'abstract URL'),
    abstract_deadline: parseDeadline(input.abstractDeadline, 'abstract deadline'),
    venue_public: parseTriState(input.venuePublic),
    city_public: parseTriState(input.cityPublic),
  };
}

/**
 * The other direction: what GET hands the form, in exactly the shape PUT
 * accepts back. Reuses toTriBoolean -- the same null/0/1 -> null/false/true
 * rule the public overlay applies -- so there is one definition of that rule,
 * not two that can drift apart.
 */
export function rowToEditionInput(row: EditionRow): EditionInput {
  return {
    registrationUrl: row.registration_url,
    registrationDeadline: deadlineToDateString(row.registration_deadline),
    abstractUrl: row.abstract_url,
    abstractDeadline: deadlineToDateString(row.abstract_deadline),
    venuePublic: toTriBoolean(row.venue_public),
    cityPublic: toTriBoolean(row.city_public),
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

// ---------------------------------------------------------------------------
// Admin CRUD for the three list-shaped overlay tables: speakers, sessions,
// and committee. The edition's single settings row above is Task 5's
// territory; this part of the file is Task 6's.

export type SymposiumKind = 'speakers' | 'sessions' | 'committee';

/** The only place a symposium kind names its D1 table. */
export const KIND_TABLES: Record<SymposiumKind, string> = {
  speakers: 'symposium_speakers',
  sessions: 'symposium_sessions',
  committee: 'symposium_committee',
};

// The session types the symposium site's content schema accepts (see
// symposium_website's sessions collection schema). An unknown type must be
// rejected before it reaches D1 -- the build would otherwise either choke on
// it or silently drop the session, neither of which is what "save" means.
const SESSION_TYPES = new Set([
  'opening', 'keynote', 'workshop', 'panel', 'talk', 'company', 'poster',
  'networking', 'break', 'closing',
]);

// Turkish letters a plain toLowerCase()/normalize() gets wrong. 'İ' (U+0130,
// dotted capital I) lowercases under the Unicode default (non-Turkish) rules
// to 'i' plus a combining dot above (U+0307), not plain 'i' -- so a session's
// speakerSlugs would silently stop matching a slug generated this way. Each
// of these is mapped to its ASCII equivalent explicitly, before any case
// folding runs, so toLowerCase() never sees the character that trips it up.
const TURKISH_TRANSLITERATION: Record<string, string> = {
  'İ': 'i', 'I': 'i', 'ı': 'i',
  'Ğ': 'g', 'ğ': 'g',
  'Ü': 'u', 'ü': 'u',
  'Ş': 's', 'ş': 's',
  'Ö': 'o', 'ö': 'o',
  'Ç': 'c', 'ç': 'c',
};

/**
 * A stable, URL-safe slug. Idempotent: slugifying an already-slugged string,
 * or the same name twice, always returns the same value -- so a hand-typed
 * slug that gets re-saved untouched never drifts, and re-slugging a
 * speakerSlugs entry to match is always a no-op.
 */
function slugify(value: string): string {
  let transliterated = '';
  for (const ch of value) {
    transliterated += TURKISH_TRANSLITERATION[ch] ?? ch;
  }
  return transliterated
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // any other language's accents NFKD split out
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// What the admin edit form for each kind submits and is loaded with -- see
// EditionInput's doc comment above for the shape rule this follows: GET
// returns exactly what POST/PUT accept, so a form that loads a row, changes
// nothing, and saves is a no-op. `slug` is optional on input: omitted, it is
// derived from the name/title; given, it is still run through slugify so a
// hand-typed slug can't sneak in a character that breaks a speakerSlugs
// match or a URL.
export interface SpeakerInput {
  slug?: string;
  name: string;
  position?: string;
  company?: string;
  bio?: string;
  photo?: string;
  linkedin?: string;
}

export interface SessionInput {
  slug?: string;
  title: string;
  type: string;
  time?: string;
  endTime?: string;
  description?: string;
  speakerSlugs?: string[];
}

export interface CommitteeInput {
  name: string;
  role?: string;
  roleTr?: string;
  affiliation?: string;
  photo?: string;
  linkedin?: string;
}

export type SymposiumInput = SpeakerInput | SessionInput | CommitteeInput;
export type SymposiumRow = SpeakerRow | SessionRow | CommitteeRow;

// The union rowFromInput actually returns, named so a route's own per-kind
// switch (building its INSERT/UPDATE) can type its `row` parameter as this
// instead of `ReturnType<typeof rowFromInput>` -- which collapses to just
// the first overload's return type and makes every other kind's branch a
// type error.
export type SymposiumRowInput =
  | Omit<SpeakerRow, 'id' | 'sort'>
  | Omit<SessionRow, 'id' | 'sort'>
  | Omit<CommitteeRow, 'id' | 'sort'>;

/**
 * Validates and shapes an admin edit into the row its table stores. Throws
 * on an unknown kind, a missing required field, an unrecognised session
 * type, or a non-http(s) photo/LinkedIn URL, rather than storing any of
 * them. `id` and `sort` are not this function's concern: `id` is assigned
 * once at creation and never changes, and `sort` is managed by the route
 * (default on create, preserved on edit) rather than by the editor.
 */
export function rowFromInput(kind: 'speakers', input: SpeakerInput, year: number): Omit<SpeakerRow, 'id' | 'sort'>;
export function rowFromInput(kind: 'sessions', input: SessionInput, year: number): Omit<SessionRow, 'id' | 'sort'>;
export function rowFromInput(kind: 'committee', input: CommitteeInput, year: number): Omit<CommitteeRow, 'id' | 'sort'>;
export function rowFromInput(
  kind: SymposiumKind,
  input: SymposiumInput,
  year: number,
): Omit<SpeakerRow, 'id' | 'sort'> | Omit<SessionRow, 'id' | 'sort'> | Omit<CommitteeRow, 'id' | 'sort'> {
  switch (kind) {
    case 'speakers': {
      const speaker = input as SpeakerInput;
      if (!speaker.name) throw new Error('speaker name is required');
      return {
        slug: slugify(speaker.slug || speaker.name),
        year,
        name: speaker.name,
        position: speaker.position ?? '',
        company: speaker.company ?? '',
        bio: speaker.bio ?? '',
        photo: parseHttpUrl(speaker.photo, 'speaker photo URL'),
        linkedin: parseHttpUrl(speaker.linkedin, 'speaker LinkedIn URL'),
      };
    }
    case 'sessions': {
      const session = input as SessionInput;
      if (!session.title) throw new Error('session title is required');
      if (!SESSION_TYPES.has(session.type)) {
        throw new Error(`session type must be one of ${[...SESSION_TYPES].join(', ')}, got: ${session.type}`);
      }
      return {
        slug: slugify(session.slug || session.title),
        year,
        title: session.title,
        type: session.type,
        time: session.time ?? '',
        end_time: session.endTime ?? '',
        description: session.description ?? '',
        speaker_slugs: JSON.stringify((session.speakerSlugs ?? []).map((s) => slugify(s))),
      };
    }
    case 'committee': {
      const committee = input as CommitteeInput;
      if (!committee.name) throw new Error('committee member name is required');
      return {
        year,
        name: committee.name,
        role: committee.role ?? '',
        role_tr: committee.roleTr ?? '',
        affiliation: committee.affiliation ?? '',
        photo: parseHttpUrl(committee.photo, 'committee member photo URL'),
        linkedin: parseHttpUrl(committee.linkedin, 'committee member LinkedIn URL'),
      };
    }
    default:
      throw new Error(`Unknown symposium kind: ${kind}`);
  }
}

/**
 * The other direction: what GET hands the list's edit forms, in exactly the
 * shape POST/PUT accept back, plus the `id` and `sort` a form needs to know
 * which row it is editing and where it sits. Reuses parseSpeakerSlugs so a
 * session's speaker_slugs JSON decodes exactly one way everywhere.
 */
export function rowToInput(kind: 'speakers', row: SpeakerRow): SpeakerInput & { id: string; sort: number };
export function rowToInput(kind: 'sessions', row: SessionRow): SessionInput & { id: string; sort: number };
export function rowToInput(kind: 'committee', row: CommitteeRow): CommitteeInput & { id: string; sort: number };
export function rowToInput(
  kind: SymposiumKind,
  row: SymposiumRow,
): (SymposiumInput) & { id: string; sort: number } {
  switch (kind) {
    case 'speakers': {
      const r = row as SpeakerRow;
      return {
        id: r.id, sort: r.sort, slug: r.slug, name: r.name, position: r.position,
        company: r.company, bio: r.bio, photo: r.photo, linkedin: r.linkedin,
      };
    }
    case 'sessions': {
      const r = row as SessionRow;
      return {
        id: r.id, sort: r.sort, slug: r.slug, title: r.title, type: r.type,
        time: r.time, endTime: r.end_time, description: r.description,
        speakerSlugs: parseSpeakerSlugs(r.speaker_slugs),
      };
    }
    case 'committee': {
      const r = row as CommitteeRow;
      return {
        id: r.id, sort: r.sort, name: r.name, role: r.role, roleTr: r.role_tr,
        affiliation: r.affiliation, photo: r.photo, linkedin: r.linkedin,
      };
    }
    default:
      throw new Error(`Unknown symposium kind: ${kind}`);
  }
}
