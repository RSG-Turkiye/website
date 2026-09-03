// Folds a finished symposium edition's D1 overlay into the repo, permanently,
// by opening a pull request a human reviews and merges.
//
// Called by the symposium-cron Worker with a shared secret, the same way
// GitHub Actions calls /api/mail/dispatch with MAIL_SYNC_SECRET -- this is
// server-to-server, not a session a browser holds, so it is gated on that
// secret rather than getSessionUser/canManageSymposium. No admin ever calls
// this directly.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { rowsToOverlay } from '../../../_lib/symposium';
import type {
  EditionRow,
  SpeakerRow,
  SessionRow,
  CommitteeRow,
} from '../../../_lib/symposium';
import { renderArchive, endOfEventFromMarkdown, editionMarkdownPath } from '../../../_lib/archive';
import { openContentPR, getFileOnBaseBranch } from '../../../_lib/github';

// What the SELECT below reads: EditionRow's own columns, plus archived_pr_url
// itself -- every other query in this codebase filters that column out of
// its own SELECT before it's ever read (it's the guard, not the payload);
// this is the one place that needs its *value*, to tell an
// already-archived edition apart from one nobody has touched yet.
type EditionCandidateRow = EditionRow & { archived_pr_url: string | null };

/**
 * One archive attempt's outcome, returned per edition so a run that finds
 * several editions in D1 (a Worker that missed a few nights, or several
 * editions edited through the CMS before any of them finished) reports each
 * rather than stopping at the first.
 */
type ArchiveResult =
  | { year: number; status: 'archived'; prUrl: string }
  | { year: number; status: 'already-archived'; prUrl: string }
  | { year: number; status: 'not-yet-over' }
  | { year: number; status: 'undated' }
  | { year: number; status: 'missing-edition-markdown' }
  | { year: number; status: 'no-overlay-content' }
  | { year: number; status: 'error'; error: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Archive-Secret');
  if (!env.SYMPOSIUM_ARCHIVE_SECRET || secret !== env.SYMPOSIUM_ARCHIVE_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  // Every row, not just the unarchived ones: a caller asking "did this run
  // already?" must see 'already-archived' with the existing PR URL, not
  // silence indistinguishable from "nothing was due". There is no D1 row at
  // all unless an organizer edited that edition through the CMS, so this
  // set stays small on its own.
  const editions = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline,
            venue_public, city_public, archived_pr_url
     FROM symposium_edition
     ORDER BY year ASC`
  ).all<EditionCandidateRow>();

  const results: ArchiveResult[] = [];

  for (const edition of editions.results) {
    if (edition.archived_pr_url) {
      results.push({ year: edition.year, status: 'already-archived', prUrl: edition.archived_pr_url });
      continue;
    }

    // The symposium's own date lives only in the repo's editions/<year>.md
    // frontmatter -- D1 never records it, so the repo is asked directly
    // rather than duplicating that date into a second column that could
    // drift from it. A read failure here (not a 404, an actual GitHub
    // error) is reported like any other GitHub failure below, since it
    // leaves this edition in exactly the same "try again next run" state.
    let markdown: string | null;
    try {
      markdown = await getFileOnBaseBranch(editionMarkdownPath(edition.year), env);
    } catch (err) {
      results.push({ year: edition.year, status: 'error', error: err instanceof Error ? err.message : String(err) });
      continue;
    }

    if (markdown === null) {
      // No editions/<year>.md at all -- an edition entered into the CMS
      // ahead of its own markdown existing, or a year that never had one.
      // Never treated as "finished": there is nothing to compare a date
      // against.
      results.push({ year: edition.year, status: 'missing-edition-markdown' });
      continue;
    }

    const endOfEvent = endOfEventFromMarkdown(markdown);
    if (endOfEvent === null) {
      // The markdown exists but names no startDate/endDate -- most likely a
      // brand-new edition still being set up. Undated is not the same as
      // over; this is left alone rather than guessed at.
      results.push({ year: edition.year, status: 'undated' });
      continue;
    }

    if (endOfEvent > now) {
      results.push({ year: edition.year, status: 'not-yet-over' });
      continue;
    }

    const [speakers, sessions, committee] = await Promise.all([
      env.DB.prepare(
        `SELECT id, slug, year, name, position, company, bio, photo, linkedin, sort
         FROM symposium_speakers WHERE year = ? ORDER BY sort, id`
      ).bind(edition.year).all<SpeakerRow>(),
      env.DB.prepare(
        `SELECT id, slug, year, title, type, time, end_time, description, speaker_slugs, sort
         FROM symposium_sessions WHERE year = ? ORDER BY sort, id`
      ).bind(edition.year).all<SessionRow>(),
      env.DB.prepare(
        `SELECT id, year, name, role, role_tr, affiliation, photo, linkedin, sort
         FROM symposium_committee WHERE year = ? ORDER BY sort, id`
      ).bind(edition.year).all<CommitteeRow>(),
    ]);

    // Announcements are never archived -- renderArchive has no file for
    // them, they are a live-site popup mechanism, not content-collection
    // data -- so rowsToOverlay is given an empty list rather than querying a
    // table whose result would be thrown away.
    const overlay = rowsToOverlay(edition, speakers.results, sessions.results, committee.results, []);
    const files = renderArchive(overlay);

    if (files.length === 0) {
      // Nothing was ever entered into the CMS for this edition -- there is
      // no content to fold in, and no diff GitHub would accept as a PR.
      // archived_pr_url is left null on purpose: this is not "done", just
      // "nothing to do yet", and a later edit to any of this year's overlay
      // rows should make the next run pick it up rather than staying
      // permanently skipped.
      results.push({ year: edition.year, status: 'no-overlay-content' });
      continue;
    }

    const pr = await openContentPR(
      {
        branchPrefix: 'symposium-archive',
        branchSlug: String(edition.year),
        files,
        title: `Archive the ${edition.year} symposium`,
        prBody: `The ${edition.year} symposium has ended. This folds its CMS overlay ` +
          `into the content collection permanently -- merging it changes nothing a ` +
          `visitor already sees, since it matches what the live overlay has been serving.`,
      },
      env
    );

    if (!pr.success) {
      // Left unarchived: a bad token, a rate limit, or GitHub being down are
      // all things a retry on the next scheduled run can recover from --
      // and openContentPR itself is now safely retryable end to end (it
      // reuses the branch, updates files in place, and recovers an
      // already-opened PR's URL), so a retry converges rather than
      // colliding. The caller (the cron Worker) is told this run failed;
      // env's GITHUB_PAT itself is never part of `pr.error` --
      // openContentPR's own errors are GitHub's response bodies, not the
      // request that produced them.
      results.push({ year: edition.year, status: 'error', error: pr.error });
      continue;
    }

    // Written in the same statement that the next invocation's read of
    // archived_pr_url guards on, so a Worker that runs this endpoint twice
    // in a row -- or twice in one night after a retry -- opens exactly one
    // pull request per edition. If the process dies between openContentPR
    // resolving and this UPDATE running, the *next* run's openContentPR call
    // converges on the same PR (see its own doc comment) and this UPDATE
    // simply runs then instead -- no separate locking needed on top of that.
    await env.DB.prepare(
      `UPDATE symposium_edition SET archived_pr_url = ? WHERE year = ?`
    ).bind(pr.prUrl, edition.year).run();

    results.push({ year: edition.year, status: 'archived', prUrl: pr.prUrl });
  }

  const anyError = results.some((r) => r.status === 'error');
  return jsonResponse({ ok: !anyError, results }, anyError ? 502 : 200);
};
