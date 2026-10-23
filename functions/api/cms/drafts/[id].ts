import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runGuardedWithAudit } from '../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, fail, forbidden, invalid, loadDraft, mayEdit, newNonce, nonceProof, readJson } from '../../../_lib/cms-api';
import { deleteBranch } from '../../../_lib/github';
import { canTransition, checkSameId, newEntryId, newPaths, validateDraft, type PairData } from '../../../_lib/cms-drafts';

/** One draft, with its data: for its author while they can edit, and for the group's approvers. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  if (!mayEdit(gate, found.row)) return forbidden();
  return jsonResponse({ draft: draftJson(found.row, true) });
};

/**
 * Save `{ data }`. Only while the draft is with its author (TRANSITIONS.save);
 * the status does not change. A new entry's id follows its data, so its file
 * name follows a changed event id or webinar title; an update keeps its files.
 */
export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row, type } = found;
  if (!mayEdit(gate, row)) return forbidden();
  if (row.action === 'delete') return fail(409, 'bad_action', 'A delete has nothing to edit');
  if (!canTransition('save', row.status)) return badState();
  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'Send a JSON object of at most 256 KB');

  const v = validateDraft(type, body.data);
  if (!v.ok) return invalid(v.errors);
  let entryId = row.entry_id;
  let baseShas = row.base_shas;
  if (row.action === 'create') {
    const id = newEntryId(type, v.data);
    if (!id.ok) return invalid(id.errors);
    entryId = id.data;
    // Checked against main at approval, as every path is.
    baseShas = JSON.stringify(Object.fromEntries(newPaths(type, entryId).map((p) => [p, null])));
  } else {
    const renamed = checkSameId(type, entryId, v.data);
    if (renamed) return invalid(renamed);
    if (type.format === 'markdown-pair') {
      const stored = JSON.parse(row.data) as PairData;
      const next = v.data as PairData;
      for (const lang of ['en', 'tr'] as const) if (stored[lang]?.source !== undefined) next[lang].source = stored[lang].source;
    }
  }
  const data = JSON.stringify(v.data);
  const nonce = newNonce();

  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE content_drafts SET data = ?, entry_id = ?, base_shas = ?, updated_at = ?, write_nonce = ? WHERE id = ? AND status = ? AND write_nonce IS ?')
      .bind(data, entryId, baseShas, gate.now, nonce, row.id, row.status, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.update', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: entryId } },
    gate.now,
  );
  if (!done) return changed();
  return jsonResponse({ draft: draftJson({ ...row, data, entry_id: entryId, base_shas: baseShas, updated_at: gate.now, write_nonce: nonce }, true) });
};

/** Discard. The row stays, as `discarded`, so the log's target still exists. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row } = found;
  if (!mayEdit(gate, row)) return forbidden();
  if (!canTransition('discard', row.status)) return badState();
  // A failed attempt may have left cms/<id> (and an open pull request on
  // it). Removing it is best effort: a failure is logged, noted in the log
  // row, and never blocks the discard.
  let branch: 'deleted' | 'absent' | 'failed' | undefined;
  if (row.status === 'pr_failed') {
    try {
      branch = await deleteBranch(`cms/${row.id}`, env);
    } catch (e) {
      console.error('cms: deleting the branch of a discarded draft failed', row.id, e);
      branch = 'failed';
    }
  }
  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'discarded', updated_at = ?, write_nonce = ? WHERE id = ? AND status = ? AND write_nonce IS ?`)
      .bind(gate.now, nonce, row.id, row.status, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.discard', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, from: row.status, ...(branch ? { branch } : {}) } },
    gate.now,
  );
  if (!done) return changed();
  return jsonResponse({ ok: true });
};
