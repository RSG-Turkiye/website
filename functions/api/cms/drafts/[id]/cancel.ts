import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, forbidden, githubFailed, loadDraft, mayApprove, newNonce, nonceProof } from '../../../../_lib/cms-api';
import { canTransition, FAILURE } from '../../../../_lib/cms-drafts';
import { closePr } from '../../../../_lib/github';

/**
 * Take a draft out of `pr_open` on purpose: close its pull request and mark
 * it pr_failed with the reason 'cancelled'. The author can then edit it and
 * send it again, or discard it. Approvers (and admins) only.
 *
 * The pull request is closed first. If GitHub refuses, nothing changes, so
 * the panel never shows a draft as cancelled while its pull request could
 * still be merged. Nothing can move a pr_open draft back into review in
 * between, so the branch cannot become another attempt's meanwhile; if the
 * PR shepherd sees the closed pull request first, it marks the draft
 * pr_failed ("closed on GitHub") and this answers 409.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row } = found;
  if (!mayApprove(gate, row)) return forbidden();
  if (!canTransition('cancel', row.status) || row.pr_number === null) return badState();

  try {
    await closePr(row.pr_number, env);
  } catch (e) {
    return githubFailed(e);
  }

  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'pr_failed', failure = ?, updated_at = ?, write_nonce = ?
                    WHERE id = ? AND status = 'pr_open' AND write_nonce IS ?`)
      .bind(FAILURE.cancelled, gate.now, nonce, row.id, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.pr.cancel', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, pr_number: row.pr_number } },
    gate.now,
  );
  if (!done) return changed();
  return jsonResponse({ draft: draftJson({ ...row, status: 'pr_failed', failure: FAILURE.cancelled, updated_at: gate.now }, false) });
};
