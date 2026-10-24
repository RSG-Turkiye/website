import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, fail, forbidden, githubFailed, loadDraft, mayApprove, newNonce, nonceProof } from '../../../../_lib/cms-api';
import { canTransition, FAILURE, type DraftRow } from '../../../../_lib/cms-drafts';
import { settle } from '../../../../_lib/cms-shepherd';
import { closePr, readPull } from '../../../../_lib/github';

/**
 * Take a draft out of `pr_open` on purpose: close its pull request and mark
 * it pr_failed with the reason 'cancelled'. The author can then edit it and
 * send it again, or discard it. Approvers (and admins) only.
 *
 * The pull request may merge while this runs (the PR shepherd merges green
 * ones every minute), so it is read before and after closing it. Merged →
 * the draft becomes `merged` (as the shepherd would record it) and the
 * answer is 409 already_merged with the draft: a merged change cannot be
 * cancelled. If GitHub refuses to close it, it is read again: closed means
 * the cancel goes ahead, merged as above, open is a 502 and nothing changes.
 * So the panel never shows a draft as cancelled while its pull request
 * could still be merged.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row } = found;
  if (!mayApprove(gate, row)) return forbidden();
  if (!canTransition('cancel', row.status) || row.pr_number === null) return badState();
  const n = row.pr_number;

  const alreadyMerged = async () => {
    await settle(env, row, 'pr_open', 'merged', null, 'cms.pr.merged', { via: 'cancel' }, gate.now, gate.user.id);
    const now = await env.DB.prepare('SELECT * FROM content_drafts WHERE id = ?').bind(row.id).first<DraftRow>();
    return fail(409, 'already_merged', 'The pull request was merged already; it cannot be cancelled', { draft: draftJson(now!, false) });
  };

  type PullState = 'open' | 'merged' | 'closed';
  let state: PullState;
  try {
    state = (await readPull(n, env)).state;
  } catch (e) {
    return githubFailed(e);
  }
  if (state === 'merged') return alreadyMerged();
  if (state === 'open') {
    try {
      await closePr(n, env);
    } catch (e) {
      let again: PullState;
      try {
        again = (await readPull(n, env)).state;
      } catch {
        return githubFailed(e);
      }
      if (again === 'merged') return alreadyMerged();
      if (again === 'open') return githubFailed(e);
    }
    // Closing races a merge that was already under way.
    try {
      if ((await readPull(n, env)).state === 'merged') return alreadyMerged();
    } catch (e) {
      console.error('cms: re-reading a cancelled pull request failed', row.id, e);
    }
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
