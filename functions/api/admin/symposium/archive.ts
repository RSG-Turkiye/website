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
import { renderArchive } from '../../../_lib/archive';
import { openContentPR } from '../../../_lib/github';

// What the SELECT below reads: EditionRow's own columns, plus end_of_event --
// the one column that names *when* to archive rather than *what* to publish,
// so it has no place in EditionRow/EditionOverlay (rowsToOverlay never needs
// it) and stays local to this file instead.
type DueEditionRow = EditionRow & { end_of_event: number };

/**
 * One archive attempt's outcome, returned per edition so a run that finds
 * several overdue editions (a Worker that missed a few nights) reports each
 * rather than stopping at the first.
 */
type ArchiveResult =
  | { year: number; status: 'archived'; prUrl: string }
  | { year: number; status: 'no-overlay-content' }
  | { year: number; status: 'error'; error: string };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Archive-Secret');
  if (!env.SYMPOSIUM_ARCHIVE_SECRET || secret !== env.SYMPOSIUM_ARCHIVE_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  // The guard that makes two runs open one PR: once a row's archived_pr_url
  // is set, this SELECT never sees it again. end_of_event IS NOT NULL
  // excludes every edition nobody has dated yet (see schema.sql note 8a) --
  // those are left alone rather than guessed at.
  const due = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline,
            venue_public, city_public, end_of_event
     FROM symposium_edition
     WHERE archived_pr_url IS NULL AND end_of_event IS NOT NULL AND end_of_event < ?
     ORDER BY year ASC`
  ).bind(now).all<DueEditionRow>();

  const results: ArchiveResult[] = [];

  for (const edition of due.results) {
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
      // all things a retry on the next scheduled run can recover from, and
      // archived_pr_url must stay null for that retry to find this row
      // again. The caller (the cron Worker) is told this run failed; env's
      // GITHUB_PAT itself is never part of `pr.error` -- openContentPR's own
      // errors are GitHub's response bodies, not the request that produced
      // them.
      results.push({ year: edition.year, status: 'error', error: pr.error });
      continue;
    }

    // Written in the same statement that the next invocation's SELECT
    // guards on, so a Worker that runs this endpoint twice in a row -- or
    // twice in one night after a retry -- opens exactly one pull request
    // per edition.
    await env.DB.prepare(
      `UPDATE symposium_edition SET archived_pr_url = ? WHERE year = ?`
    ).bind(pr.prUrl, edition.year).run();

    results.push({ year: edition.year, status: 'archived', prUrl: pr.prUrl });
  }

  const anyError = results.some((r) => r.status === 'error');
  return jsonResponse({ ok: !anyError, results }, anyError ? 502 : 200);
};
