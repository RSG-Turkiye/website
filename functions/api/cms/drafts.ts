import type { Env } from '../../_lib/auth';
import { generateId, jsonResponse } from '../../_lib/auth';
import { runWithAudit } from '../../_lib/audit';
import {
  actionRefused, approvesType, cmsGate, lpIdsElsewhere, refuseDomainDelete, draftJson, entryPaths, fail, forbidden, githubFailed, duplicateOf, indexUnavailable, invalid, loadCmsIndex, newNonce, pickEntryId, readJson, refusePairClash, rightsIn,
} from '../../_lib/cms-api';
import {
  actionAllowed, checkSameId, DRAFT_ACTIONS, droppedSides, fixedKeysErrors, inOrderOf, langOf, withServerKey, LIVE_STATUSES, newPaths, STALE_APPROVAL_SECONDS, validateDraft, type DraftAction, type DraftRow, type PairData,
} from '../../_lib/cms-drafts';
import { filesOnBase } from '../../_lib/github';
import { assignIds, lockedKeysErrors, type LpDraftData } from '../../_lib/cms-lp';
import { nextStageNumber } from '../../../src/lib/cms/slug';
import { checkId, cmsType, cmsTypes } from '../../../src/lib/cms/types';
import { parseJson, parseMarkdown } from '../../../src/lib/cms/serialize';
import type { CmsIndex } from '../../../src/lib/cms/cms-index';

const COLUMNS = ['id', 'type', 'entry_id', 'action', 'status', 'author_id', 'reviewer_id', 'review_note', 'pr_url', 'pr_number', 'failure', 'agent_token_id', 'created_at', 'updated_at']
  .map((c) => `d.${c}`).join(', ');
/** The author's display name, for the approver's "sent by". */
const AUTHOR = 'LEFT JOIN profiles p ON p.user_id = d.author_id';

const QUEUE_CAP = 200;

/** My drafts and, for approvers, the drafts waiting for approval, both newest
 * first. `more`: the queue holds more than QUEUE_CAP. The queue also holds
 * drafts left in `approved` longer than STALE_APPROVAL_SECONDS (an approval
 * that crashed), so an approver can approve them again; the approve
 * endpoint's retry adopts what the first attempt got done. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const editable = new Set(cmsTypes().filter((t) => rightsIn(gate.rights, t.group).edit).map((t) => t.key as string));
  const approvable = cmsTypes().filter((t) => approvesType(gate, t)).map((t) => t.key as string);

  const mine = await env.DB.prepare(
    `SELECT ${COLUMNS}, p.display_name AS author_name, '' AS data, '{}' AS base_shas FROM content_drafts d ${AUTHOR}
     WHERE d.author_id = ? AND d.status != 'discarded' ORDER BY d.updated_at DESC LIMIT 200`,
  ).bind(gate.user.id).all<DraftRow>();
  const queue = approvable.length === 0 ? { results: [] as DraftRow[] } : await env.DB.prepare(
    `SELECT ${COLUMNS}, p.display_name AS author_name, '' AS data, '{}' AS base_shas FROM content_drafts d ${AUTHOR}
     WHERE (d.status = 'submitted' OR (d.status = 'approved' AND d.updated_at < ?))
       AND d.type IN (${approvable.map(() => '?').join(', ')}) ORDER BY d.updated_at DESC LIMIT ${QUEUE_CAP + 1}`,
  ).bind(gate.now - STALE_APPROVAL_SECONDS, ...approvable).all<DraftRow>();
  // For approvers: what is on its way or stuck in their groups, each with
  // its way out (cancel a pull request; discard a merge the site never
  // showed, a failure, or an approval that never finished).
  const inflight = approvable.length === 0 ? { results: [] as DraftRow[] } : await env.DB.prepare(
    `SELECT ${COLUMNS}, p.display_name AS author_name, '' AS data, '{}' AS base_shas FROM content_drafts d ${AUTHOR}
     WHERE (d.status IN ('pr_open', 'merged', 'pr_failed') OR (d.status = 'approved' AND d.updated_at < ?))
       AND d.type IN (${approvable.map(() => '?').join(', ')}) ORDER BY d.updated_at DESC LIMIT ${QUEUE_CAP}`,
  ).bind(gate.now - STALE_APPROVAL_SECONDS, ...approvable).all<DraftRow>();
  // Which entries a live draft holds, so the panel offers no second draft
  // that submit would refuse (entry_busy). Not whose draft it is. Someone
  // else's new entry is not listed: it is not published, so it has no row.
  // A token sees only its member's own: a colleague's draft does not exist for it.
  const types = [...editable];
  const live = types.length === 0 ? { results: [] as { type: string; entry_id: string; status: string }[] } : await env.DB.prepare(
    `SELECT type, entry_id, status FROM content_drafts
     WHERE status IN (${LIVE_STATUSES.map(() => '?').join(', ')}) AND type IN (${types.map(() => '?').join(', ')})
       AND (action != 'create' OR author_id = ?)${gate.agent ? ' AND author_id = ?' : ''}
     ORDER BY type, entry_id LIMIT 500`,
  ).bind(...LIVE_STATUSES, ...types, gate.user.id, ...(gate.agent ? [gate.user.id] : [])).all<{ type: string; entry_id: string; status: string }>();

  return jsonResponse({
    mine: mine.results.filter((r) => editable.has(r.type)).map((r) => draftJson(r, false)),
    queue: queue.results.slice(0, QUEUE_CAP).map((r) => draftJson(r, false)),
    more: queue.results.length > QUEUE_CAP,
    inflight: inflight.results.map((r) => draftJson(r, false)),
    live: live.results.map((r) => ({ type: r.type, entry_id: r.entry_id, status: r.status })),
  });
};

/**
 * Start a draft. `{ type, action: 'create', data }` for a new entry;
 * `{ type, action: 'update', entry_id, data, base_shas? }` or
 * `{ type, action: 'delete', entry_id, base_shas? }` for a published one.
 * The server reads the entry's files on main itself and records their shas;
 * `base_shas`, when sent, are the shas the editor's copy came from (GET
 * /api/cms/entry), and a difference is refused at once as changed_since.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const body = await readJson(request);
  if (!body) return fail(400, 'bad_request', 'Send a JSON object of at most 256 KB');
  const type = cmsType(String(body.type ?? ''));
  if (!type) return fail(400, 'bad_type', 'Unknown content type');
  if (!rightsIn(gate.rights, type.group).edit) return forbidden();
  const action = body.action as DraftAction;
  if (!DRAFT_ACTIONS.includes(action)) return fail(400, 'bad_action', 'action is create, update or delete');
  if (!actionAllowed(type, action)) return actionRefused(action);

  // Validated before anything reads an id out of it (idFrom, jsonPath).
  // Leniently: a draft may start incomplete; submit checks it in full.
  let data: unknown = {};
  if (action !== 'delete') {
    const v = validateDraft(type, body.data, 'lenient');
    if (!v.ok) return invalid(v.errors);
    data = v.data;
  }

  let entryId: string;
  let baseShas: Record<string, string | null>;
  let duplicate: string | undefined;
  let index: CmsIndex | null = null;
  if (action === 'create') {
    if (type.appendKey) {
      // A new roadmap stage comes last: its number (and so its file name)
      // is the server's, from the published stages' file names (A11).
      index = await loadCmsIndex(request, env);
      if (!index) return indexUnavailable();
      const n = nextStageNumber((index[type.key] ?? []).map((e) => e.id));
      for (const lang of ['en', 'tr'] as const) (data as PairData)[lang].frontmatter[type.appendKey] = n;
    }
    const picked = await pickEntryId(request, env, type, data, null);
    if (!picked.ok) return picked.response;
    entryId = picked.id;
    index = picked.index;
    duplicate = duplicateOf(type, index, data);
    baseShas = Object.fromEntries(newPaths(type, entryId).map((p) => [p, null]));
  } else {
    try {
      entryId = checkId(body.entry_id as string);
    } catch {
      return fail(400, 'bad_id', 'Not a valid entry id');
    }
    // The shas of the copy the editor loaded (GET /api/cms/entry): the
    // draft is checked against those, not against whatever main has now.
    const sent = body.base_shas as Record<string, unknown> | undefined | null;
    if (sent === undefined || sent === null) return fail(400, 'base_shas_required', 'Send the base_shas GET /api/cms/entry returned');
    if (typeof sent !== 'object' || Array.isArray(sent)) return fail(400, 'bad_request', 'base_shas is an object of path to sha');
    if (action === 'update') {
      const renamed = checkSameId(type, entryId, data);
      if (renamed) return invalid(renamed);
    }
    const paths = entryPaths(type, entryId, type.format === 'json' ? null : await loadCmsIndex(request, env));
    if (paths === 'no_index') return indexUnavailable();
    if (!paths) return fail(404, 'not_found', 'No such entry');
    let files: Awaited<ReturnType<typeof filesOnBase>>;
    try {
      files = await filesOnBase(paths, env);
    } catch (e) {
      return githubFailed(e);
    }
    if (paths.every((p) => files[p] === null)) return fail(404, 'not_found', 'No such entry');
    // Both sides of a pair, always: a side missing on main is null, and
    // approval checks it is still missing (a delete then skips it).
    baseShas = Object.fromEntries(paths.map((p) => [p, files[p]?.sha ?? null]));
    const stale = paths.filter((p) => (sent[p] ?? null) !== baseShas[p]);
    if (stale.length) return fail(409, 'changed_since', 'The entry changed on the site since you opened it', { paths: stale });
    // A language the entry has on main stays (sides: 'either').
    const dropped = action === 'update' ? droppedSides(type, baseShas, data) : null;
    if (dropped) return invalid(dropped);

    if (action === 'update' && type.fixedKeys) {
      // The keys of the file on main are the ones the draft keeps; saves
      // then compare with the stored draft, without reading GitHub again.
      let before: unknown;
      try {
        before = type.format === 'json'
          ? parseJson(type, files[paths[0]]!.content)
          : Object.fromEntries(paths.map((p) => [langOf(type, p), files[p] ? parseMarkdown(type, files[p]!.content) : null]));
      } catch (e) {
        console.error('cms: an entry on main could not be parsed', entryId, e);
        return fail(500, 'unreadable', 'The file on main could not be read');
      }
      const keys = fixedKeysErrors(type, before, data);
      if (keys) return invalid(keys);
      // The draft keeps main's key order, whatever order the editor sent.
      if (type.format === 'json') data = inOrderOf(before, data);
    }

    if (action === 'update' && type.approvedOnKey) {
      // The date the approval sets stays main's until then (A8).
      try {
        data = withServerKey(type, parseJson(type, files[paths[0]]!.content), data);
      } catch (e) {
        console.error('cms: an entry on main could not be parsed', entryId, e);
        return fail(500, 'unreadable', 'The file on main could not be read');
      }
    }

    if (action === 'update' && type.lockedKeys.length) {
      // What the file name comes from stays as main has it (a level's
      // domain and level, a stage's number).
      let before: Record<string, unknown>;
      try {
        before = Object.fromEntries(paths.map((p) => [langOf(type, p), files[p] ? parseMarkdown(type, files[p]!.content) : null]));
      } catch (e) {
        console.error('cms: an entry on main could not be parsed', entryId, e);
        return fail(500, 'unreadable', 'The file on main could not be read');
      }
      const locked = lockedKeysErrors(type, entryId, before, data);
      if (locked) return invalid(locked);
    }

    if (action === 'update' && type.format === 'markdown-pair') {
      // Keep each file's frontmatter text, so keys the draft does not change
      // are written back byte for byte. Taken from main, never from the client.
      const pair = data as PairData;
      try {
        for (const p of paths) {
          const side = pair[langOf(type, p)];
          const file = files[p];
          // A side the entry does not have yet (sides: 'either') has no file to keep.
          if (file && side) side.source = parseMarkdown(type, file.content).source;
        }
      } catch (e) {
        console.error('cms: an entry on main could not be parsed', entryId, e);
        return fail(500, 'unreadable', 'The file on main could not be read');
      }
    }
  }

  const clash = await refusePairClash(request, env, type, entryId, action, data, index);
  if (clash) return clash;
  if (action === 'delete') {
    const levels = await refuseDomainDelete(env, type, entryId);
    if (levels) return levels;
  }
  // A new learning-path resource gets its id here, never from the client (A4),
  // and never one another file has.
  if (type.resourceIds && action !== 'delete') {
    const listed = index ?? await loadCmsIndex(request, env);
    (data as LpDraftData)._assigned = assignIds(data as PairData, lpIdsElsewhere(listed, type, '').keys());
  }

  const row: DraftRow = {
    id: generateId(), type: type.key, entry_id: entryId, action, data: JSON.stringify(data), base_shas: JSON.stringify(baseShas),
    status: 'draft', author_id: gate.user.id, reviewer_id: null, review_note: null, pr_url: null, pr_number: null, failure: null,
    write_nonce: newNonce(), last_checked_at: null, agent_token_id: gate.agent?.tokenId ?? null, created_at: gate.now, updated_at: gate.now,
  };
  await runWithAudit(env.DB, [env.DB.prepare(
    `INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, write_nonce, agent_token_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.type, row.entry_id, row.action, row.data, row.base_shas, row.author_id, row.write_nonce, row.agent_token_id, row.created_at, row.updated_at)],
  { userId: gate.user.id, action: 'cms.draft.create', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, draft_action: row.action }, agent: gate.agent?.tokenId ?? null },
  gate.now);
  return jsonResponse({ draft: draftJson(row, true), ...(duplicate ? { duplicate_of: duplicate } : {}) }, 201);
};
