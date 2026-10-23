import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit, runWithAudit } from '../../../../_lib/audit';
import { badState, cmsGate, draftJson, fail, forbidden, githubFailed, invalid, loadDraft, mayApprove } from '../../../../_lib/cms-api';
import { canTransition, filesFor, prBody, prTitle, STALE_APPROVAL_SECONDS, validateDraft, type DraftRow } from '../../../../_lib/cms-drafts';
import { fileShasOnBase, openContentPR, pullNumberFromUrl } from '../../../../_lib/github';

/**
 * Approve: check the files are still what the draft started from, then open
 * the pull request on branch cms/<draft id>. Approvers only; approving one's
 * own draft is allowed.
 *
 * Two steps, each with its own log row: the claim (submitted → approved,
 * cms.draft.approve), so two approvers cannot both open a pull request, and
 * then the outcome (pr_open, cms.pr.open; or published when main already has
 * the content, cms.pr.merged with noop; or pr_failed, cms.pr.failed). A
 * draft left in `approved` by a crash between the two may be approved again
 * after STALE_APPROVAL_SECONDS; openContentPR then finds the branch and pull
 * request the first attempt made.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row, type } = found;
  if (!mayApprove(gate, row)) return forbidden();
  const staleBefore = gate.now - STALE_APPROVAL_SECONDS;
  if (!canTransition('approve', row.status) && !(row.status === 'approved' && row.updated_at < staleBefore)) return badState();

  // No silent overwrite: every file must still be what the draft started from.
  const base = JSON.parse(row.base_shas) as Record<string, string | null>;
  const paths = Object.keys(base).sort();
  let onMain: Record<string, string | null>;
  try {
    onMain = await fileShasOnBase(paths, env);
  } catch (e) {
    return githubFailed(e);
  }
  const moved = paths.filter((p) => onMain[p] !== base[p]);
  if (moved.length) return fail(409, 'changed_since', 'The entry changed on the site since this draft was started', { paths: moved });

  if (row.action !== 'delete') {
    const v = validateDraft(type, JSON.parse(row.data));
    if (!v.ok) return invalid(v.errors);
  }
  let files: ReturnType<typeof filesFor>;
  try {
    files = filesFor(row);
  } catch (e) {
    console.error('cms: draft could not be written out', row.id, e);
    return fail(422, 'unwritable', 'This draft could not be turned into files');
  }

  const claimed = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'approved', reviewer_id = ?, updated_at = ?
                    WHERE id = ? AND (status = 'submitted' OR (status = 'approved' AND updated_at < ?))`)
      .bind(gate.user.id, gate.now, row.id, staleBefore),
    { condition: `EXISTS (SELECT 1 FROM content_drafts WHERE id = ? AND status = 'approved' AND reviewer_id = ? AND updated_at = ?)`, binds: [row.id, gate.user.id, gate.now] },
    [],
    { userId: gate.user.id, action: 'cms.draft.approve', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, draft_action: row.action } },
    gate.now,
  );
  if (!claimed) return badState();

  const result = await openContentPR({ branchPrefix: 'cms', branchSlug: row.id, files, title: prTitle(row), prBody: prBody(row), retitle: false }, env);
  const now = Math.floor(Date.now() / 1000);
  const settle = (sql: string, binds: unknown[]) => env.DB.prepare(`UPDATE content_drafts SET ${sql}, updated_at = ? WHERE id = ? AND status = 'approved'`).bind(...binds, now, row.id);
  const details = { type: row.type, entry_id: row.entry_id };

  if (result.success) {
    const prNumber = pullNumberFromUrl(result.prUrl);
    await runWithAudit(env.DB, [settle(`status = 'pr_open', pr_url = ?, pr_number = ?, failure = NULL`, [result.prUrl, prNumber])],
      { userId: gate.user.id, action: 'cms.pr.open', targetType: 'content_draft', targetId: row.id, details: { ...details, pr_number: prNumber } }, now);
  } else if ('reason' in result) {
    // GitHub found nothing to propose: main already has exactly this content.
    await runWithAudit(env.DB, [settle(`status = 'published', failure = NULL`, [])],
      { userId: gate.user.id, action: 'cms.pr.merged', targetType: 'content_draft', targetId: row.id, details: { ...details, noop: true } }, now);
  } else {
    // GitHub's text stays in the server log; the draft and the log get a code.
    console.error('cms: opening the pull request failed', row.id, result.error);
    await runWithAudit(env.DB, [settle(`status = 'pr_failed', failure = 'github_failed'`, [])],
      { userId: gate.user.id, action: 'cms.pr.failed', targetType: 'content_draft', targetId: row.id, details: { ...details, code: 'github_failed' } }, now);
    return fail(502, 'github_failed', 'The pull request could not be opened; the draft is marked failed and can be sent again');
  }
  const after = await env.DB.prepare('SELECT * FROM content_drafts WHERE id = ?').bind(row.id).first<DraftRow>();
  return jsonResponse({ draft: draftJson(after!, false), ...('reason' in result ? { noop: true } : {}) });
};
