import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runGuardedWithAudit } from '../../../_lib/audit';
import { badState, changed, cmsGate, draftJson, fail, forbidden, githubFailed, invalid, loadDraft, mayApprove, mayEdit, newNonce, nonceProof, readJson, refusePairClash } from '../../../_lib/cms-api';
import { fileShasOnBase } from '../../../_lib/github';
import { closePr, deleteBranch, prForBranch, pullNumberFromUrl } from '../../../_lib/github';
import { canTransition, checkSameId, ID_FIELD, newEntryId, newPaths, STALE_APPROVAL_SECONDS, validateDraft, type PairData } from '../../../_lib/cms-drafts';

/** One draft, with its data: for its author while they can edit, and for the group's approvers. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  if (!mayEdit(gate, found.row)) return forbidden();
  const author = await env.DB.prepare('SELECT display_name FROM profiles WHERE user_id = ?').bind(found.row.author_id).first<{ display_name: string }>();
  return jsonResponse({ draft: draftJson({ ...found.row, author_name: author?.display_name ?? null }, true) });
};

/**
 * Save `{ data }`. Only while the draft is with its author (TRANSITIONS.save);
 * the status does not change. Checked leniently: what is missing or empty may
 * stay so until submit, which checks the whole entry. A new entry's id follows its data, so its file
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
  // A save made on an older version (another tab, another device) would
  // undo what was saved since: refused, and the panel says so.
  if (body.write_nonce !== undefined && body.write_nonce !== row.write_nonce) return changed();

  const v = validateDraft(type, body.data, 'lenient');
  if (!v.ok) return invalid(v.errors);
  let entryId = row.entry_id;
  let baseShas = row.base_shas;
  if (row.action === 'create') {
    const id = newEntryId(type, v.data);
    if (!id.ok) return invalid(id.errors);
    entryId = id.data;
    const taken = { [ID_FIELD[type.key]]: 'An entry with this name already exists' };
    if (entryId !== row.entry_id) {
      // A new name: the file must not be on main (as when the draft began).
      let onMain: Record<string, string | null>;
      try {
        onMain = await fileShasOnBase(newPaths(type, entryId), env);
      } catch (e) {
        return githubFailed(e);
      }
      if (Object.values(onMain).some((sha) => sha !== null)) return invalid(taken);
    }
    // A pair can clash by name or by translationKey: checked when either changed.
    const keyOf = (d: unknown) => ['en', 'tr'].map((l) => String((d as PairData | null)?.[l as 'en' | 'tr']?.frontmatter?.translationKey ?? '').trim()).join('\n');
    if (entryId !== row.entry_id || keyOf(v.data) !== keyOf(JSON.parse(row.data))) {
      const clash = await refusePairClash(request, env, type, entryId, 'create', v.data);
      if (clash) return clash.status === 409 ? invalid(taken) : clash;
    }
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

/**
 * Discard. The row stays, as `discarded`, so the log's target still exists.
 * A `merged` draft (its change on main, the site never showed it) may be
 * discarded by an approver only, with no GitHub call: it is the way out.
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const found = await loadDraft(env, params.id);
  if (!found.ok) return found.response;
  const { row } = found;
  if (!mayEdit(gate, row)) return forbidden();
  if (!canTransition('discard', row.status)) return badState();
  if (row.status === 'merged' && !mayApprove(gate, row)) return forbidden();
  if (row.status === 'approved') {
    if (!mayApprove(gate, row)) return forbidden();
    // Not while the approval may still be opening its pull request.
    if (row.updated_at >= gate.now - STALE_APPROVAL_SECONDS) return badState();
  }
  const nonce = newNonce();
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = 'discarded', updated_at = ?, write_nonce = ? WHERE id = ? AND status = ? AND write_nonce IS ?`)
      .bind(gate.now, nonce, row.id, row.status, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: gate.user.id, action: 'cms.draft.discard', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, from: row.status } },
    gate.now,
  );
  if (!done) return changed();
  // Only after the discard landed: before it, a resubmit and approval in
  // between would make cms/<id> a live pull request's branch. A failed
  // attempt may have left the branch (and an open pull request on it).
  // Best effort: the discard is the one log row; a failure goes to the
  // server log and the answer.
  let branch: 'deleted' | 'absent' | 'failed' | undefined;
  if (row.status === 'approved') {
    // The crashed approval may have opened a pull request: close it, so a
    // discarded draft cannot be merged by hand, then drop the branch.
    try {
      const pr = await prForBranch(`cms/${row.id}`, env);
      const n = pr && pr.state === 'open' ? pullNumberFromUrl(pr.url) : null;
      if (n !== null) await closePr(n, env);
    } catch (e) {
      console.error('cms: closing the pull request of a discarded approval failed', row.id, e);
    }
    try {
      branch = await deleteBranch(`cms/${row.id}`, env);
    } catch (e) {
      console.error('cms: deleting the branch of a discarded approval failed', row.id, e);
      branch = 'failed';
    }
  }
  if (row.status === 'pr_failed') {
    try {
      branch = await deleteBranch(`cms/${row.id}`, env);
    } catch (e) {
      console.error('cms: deleting the branch of a discarded draft failed', row.id, e);
      branch = 'failed';
    }
    // The branch may still be there, and a pull request open on it: close
    // that, so a discarded draft cannot be merged by hand. Best effort too.
    if (branch === 'failed' && row.pr_number !== null) {
      try {
        await closePr(row.pr_number, env);
      } catch (e) {
        console.error('cms: closing the pull request of a discarded draft failed', row.id, e);
      }
    }
  }
  return jsonResponse({ ok: true, ...(branch ? { branch } : {}) });
};
