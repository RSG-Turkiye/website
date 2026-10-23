import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, forbidden, invalid, loadDraft, mayEdit, newNonce, nonceProof, refusePairClash } from '../../../../_lib/cms-api';
import { canTransition, validateDraft } from '../../../../_lib/cms-drafts';

/** Send for approval. Clears an earlier send-back note and failure reason. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row, type } = found;
  if (!mayEdit(gate, row)) return forbidden();
  if (!canTransition('submit', row.status)) return badState();
  if (row.action !== 'delete') {
    const v = validateDraft(type, JSON.parse(row.data));
    if (!v.ok) return invalid(v.errors);
    const clash = await refusePairClash(request, env, type, row.entry_id, row.action, v.data);
    if (clash) return clash;
  }
  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'submitted', reviewer_id = NULL, review_note = NULL, failure = NULL, updated_at = ?, write_nonce = ?
                    WHERE id = ? AND status = ? AND write_nonce IS ?`)
      .bind(gate.now, nonce, row.id, row.status, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.submit', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id } },
    gate.now,
  );
  if (!done) return changed();
  return jsonResponse({ draft: draftJson({ ...row, status: 'submitted', reviewer_id: null, review_note: null, failure: null, updated_at: gate.now }, false) });
};
