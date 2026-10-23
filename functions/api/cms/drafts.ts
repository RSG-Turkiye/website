import type { Env } from '../../_lib/auth';
import { generateId, jsonResponse } from '../../_lib/auth';
import { runWithAudit } from '../../_lib/audit';
import {
  cmsGate, draftJson, entryPaths, fail, forbidden, githubFailed, indexUnavailable, invalid, loadCmsIndex, readJson, rightsIn,
} from '../../_lib/cms-api';
import { checkSameId, DRAFT_ACTIONS, langOf, newEntryId, newPaths, validateDraft, type DraftAction, type DraftRow, type PairData } from '../../_lib/cms-drafts';
import { fileShasOnBase, filesOnBase } from '../../_lib/github';
import { CMS_TYPES, checkId, cmsType } from '../../../src/lib/cms/types';
import { parseMarkdown } from '../../../src/lib/cms/serialize';

const LIST_COLUMNS = 'id, type, entry_id, action, status, author_id, reviewer_id, review_note, pr_url, pr_number, failure, created_at, updated_at';

/** My drafts, newest first, and for approvers the drafts waiting for approval, oldest first. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, false);
  if (!gate.ok) return gate.response;
  const editable = new Set(CMS_TYPES.filter((t) => rightsIn(gate.rights, t.group).edit).map((t) => t.key as string));
  const approvable = CMS_TYPES.filter((t) => rightsIn(gate.rights, t.group).approve).map((t) => t.key as string);

  const mine = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS}, '' AS data, '{}' AS base_shas FROM content_drafts
     WHERE author_id = ? AND status != 'discarded' ORDER BY updated_at DESC LIMIT 200`,
  ).bind(gate.user.id).all<DraftRow>();
  const queue = approvable.length === 0 ? { results: [] as DraftRow[] } : await env.DB.prepare(
    `SELECT ${LIST_COLUMNS}, '' AS data, '{}' AS base_shas FROM content_drafts
     WHERE status = 'submitted' AND type IN (${approvable.map(() => '?').join(', ')}) ORDER BY updated_at LIMIT 200`,
  ).bind(...approvable).all<DraftRow>();

  return jsonResponse({
    mine: mine.results.filter((r) => editable.has(r.type)).map((r) => draftJson(r, false)),
    queue: queue.results.map((r) => draftJson(r, false)),
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

  // Validated before anything reads an id out of it (idFrom, jsonPath).
  let data: unknown = {};
  if (action !== 'delete') {
    const v = validateDraft(type, body.data);
    if (!v.ok) return invalid(v.errors);
    data = v.data;
  }

  let entryId: string;
  let baseShas: Record<string, string | null>;
  if (action === 'create') {
    const id = newEntryId(type, data);
    if (!id.ok) return invalid(id.errors);
    entryId = id.data;
    const paths = newPaths(type, entryId);
    let onMain: Record<string, string | null>;
    try {
      onMain = await fileShasOnBase(paths, env);
    } catch (e) {
      return githubFailed(e);
    }
    const taken = paths.filter((p) => onMain[p] !== null);
    if (taken.length) return fail(409, 'exists', 'An entry with this id is already published; open it instead', { paths: taken });
    baseShas = Object.fromEntries(paths.map((p) => [p, null]));
  } else {
    try {
      entryId = checkId(body.entry_id as string);
    } catch {
      return fail(400, 'bad_id', 'Not a valid entry id');
    }
    if (action === 'update') {
      const renamed = checkSameId(type, entryId, data);
      if (renamed) return invalid(renamed);
    }
    let paths = entryPaths(type, entryId, type.format === 'json' ? null : await loadCmsIndex(request, env));
    if (paths === 'no_index') return indexUnavailable();
    if (!paths) return fail(404, 'not_found', 'No such entry');
    let files: Awaited<ReturnType<typeof filesOnBase>>;
    try {
      files = await filesOnBase(paths, env);
    } catch (e) {
      return githubFailed(e);
    }
    if (paths.every((p) => files[p] === null)) return fail(404, 'not_found', 'No such entry');
    // A delete removes what is there; an update also writes a missing side.
    if (action === 'delete') paths = paths.filter((p) => files[p] !== null);
    baseShas = Object.fromEntries(paths.map((p) => [p, files[p]?.sha ?? null]));

    if (body.base_shas !== undefined) {
      const sent = body.base_shas as Record<string, unknown> | null;
      if (typeof sent !== 'object' || sent === null || Array.isArray(sent)) return fail(400, 'bad_request', 'base_shas is an object of path to sha');
      const stale = paths.filter((p) => (sent[p] ?? null) !== baseShas[p]);
      if (stale.length) return fail(409, 'changed_since', 'The entry changed on the site since you opened it', { paths: stale });
    }

    if (action === 'update' && type.format === 'markdown-pair') {
      // Keep each file's frontmatter text, so keys the draft does not change
      // are written back byte for byte. Taken from main, never from the client.
      const pair = data as PairData;
      try {
        for (const p of paths) {
          const side = pair[langOf(type, p)];
          const file = files[p];
          if (file) side.source = parseMarkdown(type, file.content).source;
        }
      } catch (e) {
        console.error('cms: an entry on main could not be parsed', entryId, e);
        return fail(500, 'unreadable', 'The file on main could not be read');
      }
    }
  }

  const row: DraftRow = {
    id: generateId(), type: type.key, entry_id: entryId, action, data: JSON.stringify(data), base_shas: JSON.stringify(baseShas),
    status: 'draft', author_id: gate.user.id, reviewer_id: null, review_note: null, pr_url: null, pr_number: null, failure: null,
    created_at: gate.now, updated_at: gate.now,
  };
  await runWithAudit(env.DB, [env.DB.prepare(
    `INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
  ).bind(row.id, row.type, row.entry_id, row.action, row.data, row.base_shas, row.author_id, row.created_at, row.updated_at)],
  { userId: gate.user.id, action: 'cms.draft.create', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, draft_action: row.action } },
  gate.now);
  return jsonResponse({ draft: draftJson(row, true) }, 201);
};
