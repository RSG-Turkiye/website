// Folds a finished symposium edition's D1 overlay into the repo, permanently,
// by opening a pull request a human reviews and merges -- and, for an
// edition that has not finished yet, copies its current overlay into a
// daily-refreshed pull request too, so its content is never only in D1.
//
// Called by the symposium-cron Worker with a shared secret, the same way
// GitHub Actions calls /api/mail/dispatch with MAIL_SYNC_SECRET -- this is
// server-to-server, not a session a browser holds, so it is gated on that
// secret rather than getSessionUser/canManageSymposium. No admin ever calls
// this directly.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { rowsToOverlay, archiveDecision } from '../../../_lib/symposium';
import type {
  EditionRow,
  SpeakerRow,
  SessionRow,
  CommitteeRow,
} from '../../../_lib/symposium';
import {
  renderArchive,
  endOfEventFromMarkdown,
  editionMarkdownPath,
  snapshotPrTitle,
  snapshotPrBody,
  archivePrTitle,
  archivePrBody,
} from '../../../_lib/archive';
import { openContentPR, getFileOnBaseBranch, notifyNewSubmission, prState } from '../../../_lib/github';

// What the SELECT below reads: EditionRow's own columns, plus archived_pr_url
// and archived_at themselves. The public endpoint and the admin edition
// route both filter archived_at out of their own WHERE clause without ever
// reading its value (it's the guard, not the payload); the admin edition
// route does now also return archived_pr_url, to display it, but this
// remains the one place that reads *both* columns together, because
// archiveDecision needs the pair to tell apart the three states a row can be
// in: untouched, pull request open, and actually merged.
export type EditionCandidateRow = EditionRow & { archived_pr_url: string | null; archived_at: number | null };

/**
 * One archive attempt's outcome, returned per edition so a run that finds
 * several editions in D1 (a Worker that missed a few nights, or several
 * editions edited through the CMS before any of them finished) reports each
 * rather than stopping at the first.
 */
export type ArchiveResult =
  | { year: number; status: 'archived'; prUrl: string }
  | { year: number; status: 'already-archived'; prUrl: string }
  | { year: number; status: 'pr-open'; prUrl: string }
  | { year: number; status: 'pr-closed-unmerged'; prUrl: string }
  | { year: number; status: 'merge-check-failed'; prUrl: string; error: string; permanent: boolean }
  | { year: number; status: 'snapshotted'; prUrl: string }
  | { year: number; status: 'snapshot-no-changes' }
  | { year: number; status: 'snapshot-failed'; error: string }
  | { year: number; status: 'archived-no-pr' }
  | { year: number; status: 'undated' }
  | { year: number; status: 'missing-edition-markdown' }
  | { year: number; status: 'no-overlay-content' }
  | { year: number; status: 'error'; error: string };

/**
 * The three SELECTs an edition's overlay is built from, gathered once so the
 * finished path and the snapshot path below share a single copy of each --
 * tests/symposium-columns.test.ts reads these statements by name and exists
 * precisely so the same fact is never written twice here and left to drift.
 */
async function fetchOverlayRows(year: number, env: Env) {
  const [speakers, sessions, committee] = await Promise.all([
    env.DB.prepare(
      `SELECT id, slug, year, name, position, company, bio, photo, linkedin, sort
       FROM symposium_speakers WHERE year = ? ORDER BY sort, id`
    ).bind(year).all<SpeakerRow>(),
    env.DB.prepare(
      `SELECT id, slug, year, title, type, time, end_time, description, speaker_slugs, sort
       FROM symposium_sessions WHERE year = ? ORDER BY sort, id`
    ).bind(year).all<SessionRow>(),
    env.DB.prepare(
      `SELECT id, year, name, role, role_tr, affiliation, photo, linkedin, teams, sort
       FROM symposium_committee WHERE year = ? ORDER BY sort, id`
    ).bind(year).all<CommitteeRow>(),
  ]);
  return { speakers: speakers.results, sessions: sessions.results, committee: committee.results };
}

/**
 * Renders an edition's current CMS overlay and opens (or refreshes) its pull
 * request with the snapshot wording, for an edition that has not finished
 * yet. Deliberately stamps nothing: archived_pr_url means the archive pull
 * request exists and archived_at means it merged and the edition is retired,
 * and this edition is neither of those things. Called from the loop below,
 * and exported so the admin edition route can trigger the same snapshot on
 * demand.
 */
export async function snapshotEdition(edition: EditionCandidateRow, env: Env): Promise<ArchiveResult> {
  try {
    const { speakers, sessions, committee } = await fetchOverlayRows(edition.year, env);

    // Announcements are never archived -- renderArchive has no file for them,
    // they are a live-site popup mechanism, not content-collection data -- so
    // rowsToOverlay is given an empty list rather than querying a table whose
    // result would be thrown away.
    const overlay = rowsToOverlay(edition, speakers, sessions, committee, []);
    const files = renderArchive(overlay);

    if (files.length === 0) {
      return { year: edition.year, status: 'no-overlay-content' };
    }

    const pr = await openContentPR(
      {
        branchPrefix: 'symposium-archive',
        branchSlug: String(edition.year),
        files,
        title: snapshotPrTitle(edition.year),
        prBody: snapshotPrBody(edition.year),
        // A snapshot never retitles a recovered pull request: its own
        // wording is already what a refreshed copy should say, and this is
        // what stops it clobbering the archive's wording on the same branch
        // when a FINISHED edition's archive PR is still open and unmerged
        // (see the doc comment on OpenPrParams.retitle).
        retitle: false,
      },
      env
    );

    if (!pr.success) {
      if ('reason' in pr) {
        // The branch has nothing new to propose because its content already
        // matches main -- the ordinary state of a day with no CMS changes
        // since a prior snapshot merged. Not an error, and no new pull
        // request to report: just move on.
        return { year: edition.year, status: 'snapshot-no-changes' };
      }
      // Best effort: a failed snapshot is retried by tomorrow's run, and must
      // not raise the alarm the way a failed archive does (see anyError below).
      return { year: edition.year, status: 'snapshot-failed', error: pr.error };
    }

    return { year: edition.year, status: 'snapshotted', prUrl: pr.prUrl };
  } catch (err) {
    // A D1 error out of fetchOverlayRows, or a throw out of rowsToOverlay /
    // renderArchive, must land here rather than propagate out of
    // onRequestPost: an uncaught throw would become a 500 that raises the
    // cron's alarm, and a snapshot is best effort by contract the same way a
    // returned pr.success === false is, above.
    return { year: edition.year, status: 'snapshot-failed', error: err instanceof Error ? err.message : String(err) };
  }
}

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
            venue_public, city_public, archived_pr_url, archived_at
     FROM symposium_edition
     ORDER BY year ASC`
  ).all<EditionCandidateRow>();

  const results: ArchiveResult[] = [];

  for (const edition of editions.results) {
    const decision = archiveDecision(edition);

    if (decision.action === 'skip') {
      results.push({ year: edition.year, status: 'already-archived', prUrl: edition.archived_pr_url ?? '' });
      continue;
    }

    if (decision.action === 'check-merge') {
      // The pull request exists. Whether the edition is finished is now
      // GitHub's answer, not ours: until it merges, the content is in a
      // branch and the public endpoint must go on serving this edition from
      // D1.
      const prUrl = edition.archived_pr_url!;
      const state = await prState(prUrl, env);
      if (state.kind === 'merged') {
        await env.DB.prepare(
          `UPDATE symposium_edition SET archived_at = ? WHERE year = ?`
        ).bind(state.mergedAt, edition.year).run();
        results.push({ year: edition.year, status: 'already-archived', prUrl });
      } else if (state.kind === 'unmerged') {
        results.push({ year: edition.year, status: 'pr-open', prUrl });
      } else if (state.kind === 'closed-unmerged') {
        // Closed without merging: the edition's content is sitting in a
        // branch nobody is going to merge, and nothing here reopens a pull
        // request automatically. This needs a human, so it joins the run's
        // error condition below rather than being left for a retry that
        // would never change anything.
        results.push({ year: edition.year, status: 'pr-closed-unmerged', prUrl });
      } else {
        // state.kind === 'unknown'. A transient cause (permanent: false) is
        // left exactly as it was, for the next run to retry: a rate limit
        // is not a failed archive, and making the whole run report failure
        // for one would make the cron's only failure signal fire on a
        // condition that fixes itself. A permanent cause (a revoked token,
        // lost permission, a deleted pull request, or a URL that never
        // named one) will not fix itself, so `permanent` is carried on the
        // result and joins the run's error condition below.
        results.push({
          year: edition.year,
          status: 'merge-check-failed',
          prUrl,
          error: state.error,
          permanent: state.permanent,
        });
      }
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
      //
      // Snapshotted anyway, and this is the point of taking a copy at all.
      // The first days of a new edition are when its content is most exposed
      // -- it exists only in D1 and nobody has committed a stub yet -- and
      // gating the copy on a file somebody has to remember to add left
      // exactly that window uncovered, silently: the reason appeared only in
      // this run's log. A copy needs no date. The date decides whether an
      // edition is over, which is the archive's question, not this one.
      results.push({ year: edition.year, status: 'missing-edition-markdown' });
      results.push(await snapshotEdition(edition, env));
      continue;
    }

    const endOfEvent = endOfEventFromMarkdown(markdown);
    if (endOfEvent === null) {
      // The markdown exists but names no startDate/endDate -- most likely a
      // brand-new edition still being set up. Undated is not the same as
      // over; this is left alone rather than guessed at.
      //
      // Copied for the same reason as the branch above: not knowing whether
      // an edition has finished is a reason not to archive it, never a
      // reason to leave its content in one place.
      results.push({ year: edition.year, status: 'undated' });
      results.push(await snapshotEdition(edition, env));
      continue;
    }

    if (endOfEvent > now) {
      // Still ahead of us. Its content lives only in D1 until the day it
      // ends, which is the whole window this snapshot exists to cover: a
      // pull request refreshed daily means the CMS is never the only copy.
      //
      // Nothing is stamped. archived_pr_url means "the archive pull request
      // exists" and archived_at means "it merged and this edition is
      // retired"; a snapshot is neither, and writing either one here would
      // retire an edition that has not happened.
      const snapshot = await snapshotEdition(edition, env);
      results.push(snapshot);
      continue;
    }

    const { speakers, sessions, committee } = await fetchOverlayRows(edition.year, env);

    // Announcements are never archived -- renderArchive has no file for
    // them, they are a live-site popup mechanism, not content-collection
    // data -- so rowsToOverlay is given an empty list rather than querying a
    // table whose result would be thrown away.
    const overlay = rowsToOverlay(edition, speakers, sessions, committee, []);
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
        title: archivePrTitle(edition.year),
        prBody: archivePrBody(edition.year),
        // Replacing a snapshot's wording with the archive's own is exactly
        // what this path is for: a recovered pull request here was most
        // likely still carrying the daily snapshot's "Snapshot the ... CMS
        // content" title, and a reviewer must see the archive's wording, not
        // the snapshot's, once the edition is finished.
        retitle: true,
      },
      env
    );

    if (!pr.success) {
      if ('reason' in pr) {
        // The branch has no commits to propose against main because this
        // edition's content is already there -- an earlier day's snapshot
        // (or a previous archive attempt) was already merged, and nothing in
        // the CMS overlay has changed since. That is success, not failure:
        // the edition's content is on main right now, which is exactly what
        // an archive is for. Stamped directly rather than by looking up a
        // merged PR for this head, because there may be no such PR to find
        // -- a snapshot PR never stamps archived_pr_url (see snapshotEdition
        // above), so this may be the first time this edition's row is ever
        // touched by this endpoint. `archived_at` is the one fact this
        // endpoint actually needs to record: the edition is retired and the
        // next run's archiveDecision must return 'skip' for it, rather than
        // trying the same no-op PR again forever.
        await env.DB.prepare(
          `UPDATE symposium_edition SET archived_at = ? WHERE year = ?`
        ).bind(now, edition.year).run();
        results.push({ year: edition.year, status: 'archived-no-pr' });
        continue;
      }
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

    // Tell a human, the way the blog flow does. The admin pane now shows
    // this PR too (functions/api/admin/symposium/edition.ts returns
    // archived_pr_url and SymposiumPane.astro renders it as a banner), but
    // only to someone who happens to open that panel -- without a real
    // notification the branch's one required manual step is still something
    // nobody is told about, while the programme is missing from the live
    // site. Never throws, and deliberately awaited after the PR exists but
    // before the UPDATE, so a notification failure cannot cost us the URL.
    await notifyNewSubmission(
      `Merge the ${edition.year} symposium archive`,
      `${pr.prUrl}\n\nThe ${edition.year} symposium has ended and its CMS content is ` +
        `not in the repo yet. Until this merges, /schedule, /speakers and /committee ` +
        `show nothing for ${edition.year}.`,
      env
    );

    // Written in the same statement the next run's archiveDecision reads, so
    // a Worker that runs this endpoint twice opens exactly one pull request
    // per edition. This stamps only that a pull request exists -- the
    // edition is not retired until archived_at, which the check-merge branch
    // above writes once GitHub says it merged. If the process dies between
    // openContentPR resolving and this UPDATE running, the *next* run's
    // openContentPR call converges on the same PR (see its own doc comment)
    // and this UPDATE simply runs then instead -- no separate locking needed
    // on top of that.
    await env.DB.prepare(
      `UPDATE symposium_edition SET archived_pr_url = ? WHERE year = ?`
    ).bind(pr.prUrl, edition.year).run();

    results.push({ year: edition.year, status: 'archived', prUrl: pr.prUrl });
  }

  // A permanent merge-check failure and a closed-unmerged pull request both
  // need a human and will never resolve on their own, so both join `error`
  // here even though neither is the 'error' status itself -- that status is
  // reserved for the GitHub/D1 failures above it. A transient
  // merge-check-failed does not: see the branch above for why.
  //
  // 'snapshot-failed' is deliberately absent. A snapshot is best effort --
  // the cron's alarm exists for the archive, not for a daily copy of an
  // edition that has not happened yet -- so a failed one must not make the
  // whole run report failure; tomorrow's run tries again on its own.
  //
  // 'snapshot-no-changes' and 'archived-no-pr' are deliberately absent too:
  // both mean openContentPR's underlying GitHub call reported "no commits
  // between main and this branch", i.e. the content is already on main.
  // For a snapshot that is the ordinary state of a day with nothing new to
  // copy; for a finished edition it is success -- archived_at is stamped
  // above in the same branch that produces this status, so the edition is
  // retired rather than retried forever.
  const anyError = results.some(
    (r) =>
      r.status === 'error' ||
      r.status === 'pr-closed-unmerged' ||
      (r.status === 'merge-check-failed' && r.permanent)
  );
  return jsonResponse({ ok: !anyError, results }, anyError ? 502 : 200);
};
