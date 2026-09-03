// Pure shaping for the public symposium overlay. No D1, no fetch, no Env --
// this module is imported directly by tests, so anything with a load-time
// side effect belongs in the route (functions/api/symposium.ts), not here.

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
