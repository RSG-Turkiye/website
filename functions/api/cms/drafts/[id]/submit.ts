import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { runGuardedWithAudit } from '../../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, fail, forbidden, invalid, loadDraft, mayEdit, newNonce, nonceProof, refuseLp, refusePairClash } from '../../../../_lib/cms-api';
import { canTransition, LIVE_STATUSES, validateDraft } from '../../../../_lib/cms-drafts';
import { prunedAssigned, type LpDraftData } from '../../../../_lib/cms-lp';

const LIVE = LIVE_STATUSES.map((s) => `'${s}'`).join(', ');

/** Another draft of the same entry that is in review or on its way to the site. */
const BUSY = `SELECT id FROM content_drafts WHERE type = ? AND entry_id = ? AND id != ? AND status IN (${LIVE}) LIMIT 1`;

// Which draft holds the entry is not said: it may be someone else's.
const entryBusy = () =>
  fail(409, 'entry_busy', 'Another draft of this entry is waiting for approval or going live; wait for it to finish');

/**
 * Send for approval. Clears an earlier send-back note and failure reason.
 *
 * Refused with entry_busy while another draft of the same entry is live
 * (LIVE_STATUSES): each draft rewrites whole files, so two in flight could
 * let the later one undo the earlier. The check is part of the guarded
 * UPDATE, so two drafts sent at the same moment cannot both pass it.
 */
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
    const lp = await refuseLp(request, env, type, row, JSON.parse(row.data));
    if (lp) return lp;
  }
  // The ids the server gave cards since deleted are dropped from its record.
  let data = row.data;
  if (type.resourceIds && row.action !== 'delete') {
    const stored = JSON.parse(row.data) as LpDraftData;
    data = JSON.stringify({ ...stored, _assigned: prunedAssigned(stored) });
  }
  const busy = () => env.DB.prepare(BUSY).bind(row.type, row.entry_id, row.id).first<{ id: string }>();
  if (await busy()) return entryBusy();
  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'submitted', data = ?, reviewer_id = NULL, review_note = NULL, failure = NULL, updated_at = ?, write_nonce = ?
                    WHERE id = ? AND status = ? AND write_nonce IS ?
                      AND NOT EXISTS (SELECT 1 FROM content_drafts o WHERE o.type = ? AND o.entry_id = ? AND o.id != ? AND o.status IN (${LIVE}))`)
      .bind(data, gate.now, nonce, row.id, row.status, row.write_nonce, row.type, row.entry_id, row.id),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.submit', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id }, agent: gate.agent?.tokenId ?? null },
    gate.now,
  );
  if (!done) {
    return (await busy()) ? entryBusy() : changed();
  }
  return jsonResponse({ draft: draftJson({ ...row, status: 'submitted', reviewer_id: null, review_note: null, failure: null, updated_at: gate.now }, false) });
};
