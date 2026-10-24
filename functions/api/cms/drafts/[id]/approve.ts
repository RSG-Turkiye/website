import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import {
  actionRefused, badState, cmsGate, draftJson, fail, forbidden, githubFailed, invalid, loadDraft, mayApprove, newNonce, nonceProof, refuseLp, refusePairClash,
} from '../../../../_lib/cms-api';
import { actionAllowed, canTransition, filesFor, prBody, prTitle, STALE_APPROVAL_SECONDS, validateDraft, type DraftRow } from '../../../../_lib/cms-drafts';
import { fileShasOnBase, mainHeadSha, openContentPR, prForBranch, pullNumberFromUrl } from '../../../../_lib/github';

/**
 * Approve: check the files are still what the draft started from, then open
 * the pull request on branch cms/<draft id>. Approvers only; approving one's
 * own draft is allowed.
 *
 * Main's head is read once. The draft's base shas are checked at that commit
 * and the branch is created (or reset) from that same commit, so a merge
 * landing in between makes the pull request behind or conflicting, never
 * overwritten.
 *
 * Two steps, each with its own log row: the claim (→ approved,
 * cms.draft.approve), so two approvers cannot both open a pull request, and
 * then the outcome, which lands only on that claim (pr_open, cms.pr.open;
 * merged when main already has the content, cms.pr.merged with noop; or
 * pr_failed, cms.pr.failed). A merged draft is published by the PR shepherd
 * (functions/_lib/cms-shepherd.ts) once the deployed site shows it.
 *
 * A draft left in `approved` by a crash may be approved again after
 * STALE_APPROVAL_SECONDS. If the first attempt got as far as a pull request,
 * that one is adopted (open → pr_open, merged → merged) and its branch is
 * left alone; otherwise the normal path runs.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row, type } = found;
  if (!mayApprove(gate, row)) return forbidden();
  // Refused at POST already; checked again so no path writes one.
  if (!actionAllowed(type, row.action)) return actionRefused(row.action);
  const staleBefore = gate.now - STALE_APPROVAL_SECONDS;
  const retry = row.status === 'approved' && row.updated_at < staleBefore;
  if (!canTransition('approve', row.status) && !retry) return badState();
  const branch = `cms/${row.id}`;
  const details = { type: row.type, entry_id: row.entry_id };

  // The claim names the row as read (its nonce), so an approval decided on
  // a row that changed meanwhile does not land.
  const claim = newNonce();
  const takeClaim = () => runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'approved', reviewer_id = ?, updated_at = ?, write_nonce = ?
                    WHERE id = ? AND write_nonce IS ? AND (status = 'submitted' OR (status = 'approved' AND updated_at < ?))`)
      .bind(gate.user.id, gate.now, claim, row.id, row.write_nonce, staleBefore),
    nonceProof(row.id, claim),
    [],
    { userId: gate.user.id, action: 'cms.draft.approve', targetType: 'content_draft', targetId: row.id, details: { ...details, draft_action: row.action } },
    gate.now,
  );
  // The outcome lands only on this attempt's claim. If a later attempt
  // re-claimed the draft meanwhile, that attempt owns the outcome.
  const settle = (set: string, binds: unknown[], entry: { action: string; details: Record<string, unknown> }) => {
    const nonce = newNonce();
    const now = Math.floor(Date.now() / 1000);
    return runGuardedWithAudit(
      env.DB,
      env.DB.prepare(`UPDATE content_drafts SET ${set}, updated_at = ?, write_nonce = ? WHERE id = ? AND status = 'approved' AND write_nonce = ?`)
        .bind(...binds, now, nonce, row.id, claim),
      nonceProof(row.id, nonce),
      [],
      { userId: gate.user.id, targetType: 'content_draft', targetId: row.id, ...entry },
      now,
    );
  };
  const superseded = () => fail(409, 'superseded', 'Another approval of this draft took over; reload it');
  const answer = async (extra: Record<string, unknown> = {}) => {
    const after = await env.DB.prepare('SELECT * FROM content_drafts WHERE id = ?').bind(row.id).first<DraftRow>();
    return jsonResponse({ draft: draftJson(after!, false), ...extra });
  };

  if (retry) {
    let existing;
    try {
      existing = await prForBranch(branch, env);
    } catch (e) {
      return githubFailed(e);
    }
    const number = existing ? pullNumberFromUrl(existing.url) : null;
    if (existing && number !== null && (existing.state === 'merged' || existing.state === 'open')) {
      if (!(await takeClaim())) return badState();
      const done = existing.state === 'merged'
        ? await settle(`status = 'merged', pr_url = ?, pr_number = ?, failure = NULL`, [existing.url, number],
          { action: 'cms.pr.merged', details: { ...details, pr_number: number, recovered: true } })
        : await settle(`status = 'pr_open', pr_url = ?, pr_number = ?, failure = NULL`, [existing.url, number],
          { action: 'cms.pr.open', details: { ...details, pr_number: number, recovered: true } });
      return done ? answer({ recovered: true }) : superseded();
    }
  }

  // No silent overwrite: every file must still be what the draft started
  // from, at the commit the branch will start from.
  const base = JSON.parse(row.base_shas) as Record<string, string | null>;
  const paths = Object.keys(base).sort();
  let head: string;
  let atHead: Record<string, string | null>;
  try {
    head = await mainHeadSha(env);
    atHead = await fileShasOnBase(paths, env, head);
  } catch (e) {
    return githubFailed(e);
  }
  const moved = paths.filter((p) => atHead[p] !== base[p]);
  if (moved.length) return fail(409, 'changed_since', 'The entry changed on the site since this draft was started', { paths: moved });

  if (row.action !== 'delete') {
    const data = JSON.parse(row.data) as unknown;
    const v = validateDraft(type, data);
    if (!v.ok) return invalid(v.errors);
    const clash = await refusePairClash(request, env, type, row.entry_id, row.action, data);
    if (clash) return clash;
    // Rule 8 again, on the files main has at the head the branch starts from
    // (the shas above): the ids the draft started from are main's there.
    const lp = await refuseLp(request, env, type, data);
    if (lp) return lp;
  }
  let files: ReturnType<typeof filesFor>;
  try {
    files = filesFor(row);
  } catch (e) {
    console.error('cms: draft could not be written out', row.id, e);
    return fail(422, 'unwritable', 'This draft could not be turned into files');
  }

  if (!(await takeClaim())) return badState();

  const result = await openContentPR(
    { branchPrefix: 'cms', branchSlug: row.id, files, title: prTitle(row), prBody: prBody(row), retitle: false, resetBranch: true, baseSha: head },
    env,
  );
  const failed = async () => {
    const done = await settle(`status = 'pr_failed', failure = 'github_failed'`, [], { action: 'cms.pr.failed', details: { ...details, code: 'github_failed' } });
    if (!done) return superseded();
    return fail(502, 'github_failed', 'GitHub refused the pull request. The draft is marked as failed; send it for approval again to retry.');
  };

  if (result.success) {
    const prNumber = pullNumberFromUrl(result.prUrl);
    if (prNumber === null) {
      // Never pr_open without a number: the shepherd follows the number.
      console.error('cms: pull request URL has no number', row.id, result.prUrl);
      return failed();
    }
    const done = await settle(`status = 'pr_open', pr_url = ?, pr_number = ?, failure = NULL`, [result.prUrl, prNumber],
      { action: 'cms.pr.open', details: { ...details, pr_number: prNumber } });
    return done ? answer() : superseded();
  }
  if ('reason' in result) {
    // GitHub found nothing to propose: main already has exactly this content.
    // `merged`, not `published`: the PR shepherd publishes it once the
    // deployed site shows these files.
    const done = await settle(`status = 'merged', failure = NULL`, [], { action: 'cms.pr.merged', details: { ...details, noop: true } });
    return done ? answer({ noop: true }) : superseded();
  }
  // GitHub's text stays in the server log; the draft and the log get a code.
  console.error('cms: opening the pull request failed', row.id, result.error);
  return failed();
};
