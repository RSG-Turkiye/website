// Pure shaping: an Overlay in, symposium content-collection files out. No
// D1, no fetch, no Env -- this module is imported directly by
// tests/archive-render.test.ts, mirroring functions/_lib/symposium.ts's own
// purity rule. Talking to GitHub is functions/_lib/github.ts's job; deciding
// which edition is due and writing archived_pr_url is
// functions/api/admin/symposium/archive.ts's job. Neither belongs here.
import type { Overlay, OverlaySpeaker, OverlaySession, OverlayCommittee } from './symposium';

const CONTENT_ROOT = 'symposium_website/src/content';

/** Where a given year's edition markdown lives in the repo -- the one file
 * this module reads rather than writes (see `endOfEventFromMarkdown`). */
export function editionMarkdownPath(year: number): string {
  return `${CONTENT_ROOT}/editions/${year}.md`;
}

const ONE_DAY_SECONDS = 24 * 60 * 60;

/** The YAML frontmatter between a markdown file's opening `---` fences, or
 * `null` if it has none. */
function extractFrontmatter(markdown: string): string | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  return match ? match[1] : null;
}

/** A `key: YYYY-MM-DD` (optionally quoted) line's value, as epoch seconds at
 * UTC midnight, or `null` if the frontmatter has no such line. Matches how
 * `content.config.ts`'s `z.coerce.date()` reads the same field: a plain
 * ISO date, not a full YAML value parser -- editions/<year>.md has never
 * needed one for these two fields. */
function extractDateField(frontmatter: string, key: string): number | null {
  const match = new RegExp(`^${key}:\\s*"?(\\d{4})-(\\d{2})-(\\d{2})"?\\s*$`, 'm').exec(frontmatter);
  if (!match) return null;
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d)) / 1000;
}

/**
 * The epoch-second moment an edition's own event is over, read straight out
 * of its `editions/<year>.md` frontmatter. Applies exactly the rule
 * `symposium_website/src/lib/editions.ts`'s own `endOfEvent()` applies (an
 * unrelated function of the same name, not a dependency of this one): the
 * midnight after the last day, `endDate` if the frontmatter carries one,
 * `startDate` otherwise. Matching that rule exactly is the point -- this
 * endpoint and the live site must never be able to disagree about whether
 * an edition has finished, since the repo's markdown is the one place either
 * of them reads the date from.
 *
 * Returns `null` when the frontmatter has neither field: an edition with no
 * announced dates at all, most commonly a brand-new one still being set up.
 * `null` must never be read as "the event is over" -- the caller
 * distinguishes "undated" from "date is in the future" from "date has
 * passed", and only the last of those means archive.
 */
export function endOfEventFromMarkdown(markdown: string): number | null {
  const frontmatter = extractFrontmatter(markdown);
  if (!frontmatter) return null;
  const start = extractDateField(frontmatter, 'startDate');
  const end = extractDateField(frontmatter, 'endDate');
  const last = end ?? start;
  if (last == null) return null;
  return last + ONE_DAY_SECONDS;
}

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
    teams: c.teams,
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
 * `{ people: [] }`. This is NOT because the live site falls back to the
 * repo's list when the overlay is empty -- it does not: see
 * symposium_website/src/lib/overlay.ts's `mergeOverlay`, which assigns a
 * reachable overlay's speakers/sessions/committee entire, empty list
 * included, so on the live site an empty overlay empties the page. The
 * reason `renderArchive` still writes no file here is different: doing so
 * would overwrite whatever the repo already holds for that year (nothing,
 * for a brand-new edition; a hand-written roster, for one entered before the
 * CMS existed) with an empty list, for an edition the CMS currently has
 * nothing to say about. Skipping the file is what keeps the pull request
 * from proposing to delete content nothing in this request has any opinion
 * about.
 *
 * Known gap, not yet handled: if every row of a kind is deleted through the
 * panel (as opposed to never having been entered), this function still
 * writes no file, so the repository goes on holding the old one and a
 * retired edition's page can render a roster that was actually deleted.
 * Distinguishing "emptied" from "never populated" needs more than this
 * comment -- recorded in this branch's pull request as a known gap rather
 * than guessed at here.
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

/**
 * The pull request text for an edition that has not happened yet.
 *
 * Deliberately not the archive's wording. The same branch carries both for as
 * long as a year, and the archive body tells a reviewer the live site's
 * programme is missing and to merge promptly. A snapshot opened ten months
 * before the symposium that said the same thing would train everyone to
 * ignore the one that means it.
 */
export function snapshotPrTitle(year: number): string {
  return `Snapshot the ${year} symposium CMS content`;
}

export function snapshotPrBody(year: number): string {
  return (
    `A daily copy of what the CMS holds for the ${year} symposium, so its ` +
    `content exists somewhere other than the database while the edition is ` +
    `still being prepared.\n\n` +
    `**Merging is optional and nothing breaks if this sits here.** The live ` +
    `site reads the CMS directly, so merging changes nothing a visitor sees ` +
    `today. What it buys is the fallback: with this merged, an unreachable ` +
    `CMS leaves the site rendering the last known programme instead of ` +
    `"announced soon".\n\n` +
    `This pull request is refreshed every day. Merging it does not stop that; ` +
    `a new one opens with the next day's changes.\n\n` +
    `**Merge this with a merge commit, not a squash.** The branch is long lived ` +
    `and the next day's run writes to it again. A squash copies the content into ` +
    `a new commit that the branch never sees, so the branch stays permanently ` +
    `ahead of main and every following run reopens a pull request proposing the ` +
    `same file. Measured on 2026-09-16: squashed, the next run reopened a ` +
    `+222/-0 pull request for a file main already had; merged, the branch went ` +
    `to zero commits ahead and the run went quiet.`
  );
}

export function archivePrTitle(year: number): string {
  return `Archive the ${year} symposium`;
}

export function archivePrBody(year: number): string {
  return (
    `The ${year} symposium has ended. This folds its CMS overlay ` +
    `into the content collection permanently.\n\n` +
    `**Merge this promptly.** The site decides an edition is over from its dates ` +
    `alone, so ${year} stopped being the upcoming edition the moment it ` +
    `ended, and the pages that render its programme have gone back to reading the ` +
    `repo -- which does not have this content until you merge. Until then ` +
    `/schedule, /speakers and /committee are empty for ${year}.\n\n` +
    `Also worth doing in the same pass: editions/${year}.md still has an ` +
    `empty \`speakers:\` list, so that edition's own page shows no speaker grid.`
  );
}
