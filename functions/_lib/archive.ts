// Pure shaping: an Overlay in, symposium content-collection files out. No
// D1, no fetch, no Env -- this module is imported directly by
// tests/archive-render.test.ts, mirroring functions/_lib/symposium.ts's own
// purity rule. Talking to GitHub is functions/_lib/github.ts's job; deciding
// which edition is due and writing archived_pr_url is
// functions/api/admin/symposium/archive.ts's job. Neither belongs here.
import type { Overlay, OverlaySpeaker, OverlaySession, OverlayCommittee } from './symposium';

const CONTENT_ROOT = 'symposium_website/src/content';

/**
 * `JSON.stringify` drops a key entirely when its value is `undefined` -- so
 * turning an empty optional field into `undefined` here is what keeps an
 * absent LinkedIn/end time out of the archived JSON, matching how the repo's
 * own hand-written files look today (see speakers/2023.json: most entries
 * simply have no `linkedin` key rather than an empty one).
 */
function orAbsent(value: string | undefined): string | undefined {
  return value ? value : undefined;
}

function speakerToJson(s: OverlaySpeaker) {
  return {
    slug: s.slug,
    name: s.name,
    position: s.position,
    company: s.company,
    bio: s.bio,
    photo: s.photo,
    linkedin: orAbsent(s.linkedin),
  };
}

function sessionToJson(s: OverlaySession) {
  return {
    slug: s.slug,
    title: s.title,
    type: s.type,
    speakerSlugs: s.speakerSlugs,
    description: s.description,
    time: s.time,
    endTime: orAbsent(s.endTime),
    order: s.order,
  };
}

function committeeToJson(c: OverlayCommittee) {
  return {
    name: c.name,
    role: c.role,
    roleTr: c.roleTr,
    affiliation: c.affiliation,
    photo: c.photo,
    linkedin: orAbsent(c.linkedin),
  };
}

/** Indented and trailing-newlined, so the diff GitHub renders in the pull
 * request review is one line per field rather than one giant line -- see
 * content.config.ts's schema for the shape this must satisfy. */
function toFile(value: unknown): string {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * Renders the CMS overlay for one edition into the files the symposium
 * site's content collections expect.
 *
 * A kind with no overlay rows produces no file at all, rather than an empty
 * `{ people: [] }` -- the overlay is additive, not authoritative: an empty
 * list here means the CMS was never used for that kind, not that the kind
 * should be emptied. Whatever the repo already holds for that year (nothing,
 * for a brand-new edition; a hand-written roster, for one entered before the
 * CMS existed) is exactly what a merged build already shows -- see
 * symposium_website/src/lib/overlay.ts's `mergeOverlay`, which leaves the
 * repo's list standing whenever the overlay's own list is empty. Skipping
 * the file here is what keeps the pull request from ever proposing to
 * delete content nothing in this request has any opinion about.
 *
 * When a kind's overlay rows are non-empty, they wholesale replace whatever
 * file already exists for that year -- again mirroring `mergeOverlay`, which
 * swaps in the overlay's list entire rather than merging item by item. The
 * archived file is only ever a snapshot of what `mergeOverlay` is already
 * serving live, so merging this PR changes nothing about what a visitor
 * sees.
 *
 * The edition's own settings (`overlay.edition`: registration/abstract
 * links, deadlines, the two visibility flags) are deliberately never
 * rendered to `editions/<year>.md` here: that file also carries title,
 * subtitle, venue and gallery fields the overlay does not carry, and a
 * finished edition has no further use for a registration link or an
 * abstract deadline. A human editor updates that file directly if the
 * archive should say anything different (for example, revealing a venue
 * that was withheld while the event was upcoming).
 *
 * `overlay.year === null` (the "no edition configured" shape the public
 * endpoint serves when there's no row at all) has no year to name a file
 * after, so it always renders nothing.
 */
export function renderArchive(overlay: Overlay): { path: string; content: string }[] {
  if (overlay.year == null) return [];
  const year = overlay.year;
  const files: { path: string; content: string }[] = [];

  if (overlay.speakers.length > 0) {
    files.push({
      path: `${CONTENT_ROOT}/speakers/${year}.json`,
      content: toFile({ year, people: overlay.speakers.map(speakerToJson) }),
    });
  }

  if (overlay.sessions.length > 0) {
    files.push({
      path: `${CONTENT_ROOT}/sessions/${year}.json`,
      content: toFile({ year, items: overlay.sessions.map(sessionToJson) }),
    });
  }

  if (overlay.committee.length > 0) {
    files.push({
      path: `${CONTENT_ROOT}/committee/${year}.json`,
      content: toFile({ year, people: overlay.committee.map(committeeToJson) }),
    });
  }

  return files;
}
