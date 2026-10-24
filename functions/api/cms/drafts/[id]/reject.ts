import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, fail, forbidden, loadDraft, mayApprove, newNonce, nonceProof, readJson } from '../../../../_lib/cms-api';
import { canTransition } from '../../../../_lib/cms-drafts';

const MAX_NOTE = 2000;

/** Send back to the author with `{ note }`, the reason the panel shows them. Approvers only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row } = found;
  if (!mayApprove(gate, row)) return forbidden();
  if (!canTransition('reject', row.status)) return badState();
  const body = await readJson(request);
  const note = body?.note ?? '';
  if (typeof note !== 'string' || note.length > MAX_NOTE) return fail(400, 'bad_note', `The note is text of at most ${MAX_NOTE} characters`);
  const reviewNote = note.trim() || null;

  // The note is not logged: the log keeps ids and codes.
  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'rejected', reviewer_id = ?, review_note = ?, updated_at = ?, write_nonce = ?
                    WHERE id = ? AND status = 'submitted' AND write_nonce IS ?`)
      .bind(gate.user.id, reviewNote, gate.now, nonce, row.id, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.reject', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id } },
    gate.now,
  );
  if (!done) return changed();
  return jsonResponse({ draft: draftJson({ ...row, status: 'rejected', reviewer_id: gate.user.id, review_note: reviewNote, updated_at: gate.now }, false) });
};
