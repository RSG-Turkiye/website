/**
 * What every /api/cms endpoint does first: who is asking, what they may do,
 * and the shapes they answer in. Errors are `{ error, code }` and never carry
 * draft content or GitHub's own text.
 */

import { checkCsrf, getSessionUser, jsonResponse, type Env, type User } from './auth';
import { groupRights, type CmsGroup, type GroupRights } from './cms-access';
import { mergedTooLong, newEntryId, newPaths, type DraftRow, type PairData } from './cms-drafts';
import { fileShasOnBase } from './github';
import { cmsType, type CmsType } from '../../src/lib/cms/types';
import type { CmsIndex, CmsIndexEntry } from '../../src/lib/cms/cms-index';
import { jsonPath } from '../../src/lib/cms/serialize';
import { lpErrors, type LpDraftData } from './cms-lp';

export const fail = (status: number, code: string, error: string, extra: Record<string, unknown> = {}) =>
  jsonResponse({ error, code, ...extra }, status);

export const forbidden = () => fail(403, 'forbidden', 'Forbidden');

export type Gate =
  | { ok: true; user: User; rights: GroupRights; now: number }
  | { ok: false; response: Response };

/**
 * Signed in, with edit rights in at least one content group. Anyone else is
 * turned away here, before any draft is read, so a refusal can never carry
 * one. `mutating` adds the CSRF check.
 */
export async function cmsGate(request: Request, env: Env, mutating: boolean): Promise<Gate> {
  if (mutating && !checkCsrf(request)) return { ok: false, response: fail(403, 'csrf', 'Forbidden') };
  const user = await getSessionUser(request, env);
  if (!user) return { ok: false, response: fail(401, 'unauthenticated', 'Not signed in') };
  const now = Math.floor(Date.now() / 1000);
  const rights = await groupRights(env.DB, user, now);
  if (!Object.values(rights).some((r) => r.edit)) return { ok: false, response: forbidden() };
  return { ok: true, user, rights, now };
}

export const rightsIn = (rights: GroupRights, group: CmsGroup) => rights[group] ?? { edit: false, approve: false };

/** An approver of the group may act on any draft in it; an editor on their own. */
export function mayEdit(gate: { user: User; rights: GroupRights }, row: Pick<DraftRow, 'type' | 'author_id'>): boolean {
  const type = cmsType(row.type);
  if (!type) return false;
  const r = rightsIn(gate.rights, type.group);
  return r.approve || (r.edit && row.author_id === gate.user.id);
}

/**
 * Whether this person approves drafts of `type`: the group's approvers, or,
 * for an `approve: 'admin'` type (the privacy notice), admins only.
 */
export function approvesType(gate: { user: Pick<User, 'is_admin'>; rights: GroupRights }, type: CmsType): boolean {
  return rightsIn(gate.rights, type.group).approve && (type.approve !== 'admin' || gate.user.is_admin === 1);
}

export function mayApprove(gate: { user: Pick<User, 'is_admin'>; rights: GroupRights }, row: Pick<DraftRow, 'type'>): boolean {
  const type = cmsType(row.type);
  return !!type && approvesType(gate, type);
}

/** 400 for an action the type does not allow in the panel (noCreate, noDelete). */
export const actionRefused = (action: string) =>
  fail(400, 'bad_action', action === 'create' ? 'New entries of this type cannot be made in the panel' : 'Entries of this type cannot be deleted in the panel');

/** The draft and its type, or the response to send instead. */
export async function loadDraft(env: Env, id: unknown): Promise<{ ok: true; row: DraftRow; type: CmsType } | { ok: false; response: Response }> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) return { ok: false, response: fail(404, 'not_found', 'Not found') };
  const row = await env.DB.prepare('SELECT * FROM content_drafts WHERE id = ?').bind(id).first<DraftRow>();
  const type = row ? cmsType(row.type) : null;
  if (!row || !type) return { ok: false, response: fail(404, 'not_found', 'Not found') };
  return { ok: true, row, type };
}

/** A draft as the API returns it. The author is an id, never an address. */
export function draftJson(row: DraftRow, withData: boolean) {
  return {
    id: row.id,
    type: row.type,
    entry_id: row.entry_id,
    action: row.action,
    status: row.status,
    author_id: row.author_id,
    /** The author's display name, or null (the panel then says "an editor"). */
    author_name: row.author_name ?? null,
    reviewer_id: row.reviewer_id,
    review_note: row.review_note,
    pr_url: row.pr_url,
    pr_number: row.pr_number,
    failure: row.failure,
    /** Merged longer than MERGED_STALE_SECONDS and still not on the site. */
    stale_merge: mergedTooLong(row, Math.floor(Date.now() / 1000)),
    created_at: row.created_at,
    updated_at: row.updated_at,
    /** The version this answer describes: a save sends it back, and a save
     * made on an older version is refused (draft_changed). */
    write_nonce: row.write_nonce,
    ...(withData ? { data: JSON.parse(row.data) as unknown, base_shas: JSON.parse(row.base_shas) as Record<string, string | null> } : {}),
  };
}

/** The JSON body, or null when it is missing, not JSON, or larger than `max` characters. */
export async function readJson(request: Request, max = 256 * 1024): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > max) return null;
  try {
    const body = JSON.parse(text) as unknown;
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// ── The build-time index ──────────────────────────────────────────────────────

type IndexLoader = (request: Request) => Promise<CmsIndex>;
let fallbackLoader: IndexLoader | null = null;

/** Where the index comes from when there is no ASSETS binding (node tests). */
export function setCmsIndexLoader(loader: IndexLoader | null): void {
  fallbackLoader = loader;
}

/** /cms-index.json as this deployment built it (src/pages/cms-index.json.ts), or null. */
export async function loadCmsIndex(request: Request, env: Env): Promise<CmsIndex | null> {
  try {
    if (env.ASSETS) {
      const res = await env.ASSETS.fetch(new Request(new URL('/cms-index.json', request.url)));
      return res.ok ? await res.json<CmsIndex>() : null;
    }
    return fallbackLoader ? await fallbackLoader(request) : null;
  } catch (e) {
    console.error('cms: reading /cms-index.json failed', e);
    return null;
  }
}

export const indexUnavailable = () => fail(503, 'index_unavailable', 'The list of entries is not available');

/** The files of a published entry. A webinar's come from the index, because a
 * pair's two names can differ; a JSON entry's from its id. */
export function entryPaths(type: CmsType, id: string, index: CmsIndex | null): string[] | 'no_index' | null {
  if (type.format === 'json') return type.fixedId && id !== type.fixedId ? null : [jsonPath(type, id)];
  if (!index) return 'no_index';
  const found: CmsIndexEntry | undefined = index[type.key]?.find((e) => e.id === id);
  if (!found?.paths) return null;
  // A side the pair lacks is written under the entry's own name.
  return [found.paths.en ?? `${type.dir}/en/${id}.md`, found.paths.tr ?? `${type.dir}/tr/${id}.md`];
}

export function githubFailed(e: unknown): Response {
  console.error('cms: GitHub request failed', e);
  return fail(502, 'github_failed', 'GitHub did not answer; try again in a minute');
}

export const invalid = (errors: Record<string, string>) => fail(422, 'invalid', 'Some fields are not valid', { errors });
export const badState = () => fail(409, 'bad_state', 'This draft cannot do that in its current state');
export const changed = () => fail(409, 'draft_changed', 'Someone changed this draft in the meantime; reload it');

export const newNonce = () => crypto.randomUUID();

/** The AuditProof for a guarded content_drafts write that stored `nonce`. */
export const nonceProof = (id: string, nonce: string) => ({
  condition: 'EXISTS (SELECT 1 FROM content_drafts WHERE id = ? AND write_nonce = ?)',
  binds: [id, nonce],
});

/**
 * A webinar pair is found by translationKey, else by file name
 * (src/lib/translations.ts). A draft whose key (either side) is another
 * published pair's, or a new pair whose name is a published pair's, would
 * tie its files to that pair. Its own pair (an update's entry) does not count.
 */
export function pairClash(type: CmsType, index: CmsIndex, entryId: string, action: string, data: PairData): CmsIndexEntry | null {
  const keys = [data.en?.frontmatter?.translationKey, data.tr?.frontmatter?.translationKey]
    .map((k) => String(k ?? '').trim())
    .filter((k) => k !== '');
  const slug = (p: string | null | undefined) => (p ? p.slice(p.lastIndexOf('/') + 1, -'.md'.length) : null);
  return (index[type.key] ?? []).find((e) => {
    if (action !== 'create' && e.id === entryId) return false;
    if (e.key && keys.includes(e.key)) return true;
    return action === 'create' && (e.id === entryId || slug(e.paths?.en) === entryId || slug(e.paths?.tr) === entryId);
  }) ?? null;
}

/** pairClash as a response: 409 exists, 503 without the index, or null when clear (or not a pair). */
export async function refusePairClash(request: Request, env: Env, type: CmsType, entryId: string, action: string, data: unknown, loaded: CmsIndex | null = null): Promise<Response | null> {
  if (type.format !== 'markdown-pair' || action === 'delete') return null;
  // An index this request already read (pickEntryId) is not read again.
  const index = loaded ?? await loadCmsIndex(request, env);
  if (!index) return indexUnavailable();
  const clash = pairClash(type, index, entryId, action, data as PairData);
  return clash ? fail(409, 'exists', 'A published webinar already has this name or translationKey', { entry_id: clash.id }) : null;
}

/** How many names after the first one a new entry may try, and how many of them may cost a GitHub read. */
const NAME_TRIES = 20;
const NAME_READS = 3;

/**
 * The file names a new entry may get, best first: its own (idFrom); for a
 * type that takes the next free name, `<id>-<idSuffix>` and then -2, -3, ...
 */
export function idCandidates(type: CmsType, id: string, data: unknown): string[] {
  if (type.whenTaken === 'refuse') return [id];
  const out = [id];
  const suffix = String(type.idSuffix?.(data) ?? '');
  if (/^[a-z0-9][a-z0-9-]*$/.test(suffix) && !id.endsWith(`-${suffix}`)) out.push(`${id}-${suffix}`);
  for (let n = 2; n <= NAME_TRIES; n++) out.push(`${id}-${n}`);
  return out;
}

/** The file names the deployed index says are in use: for a pair, each side's. */
function namesInUse(type: CmsType, index: CmsIndex | null): Set<string> {
  const slug = (p: string | null | undefined) => (p ? p.slice(p.lastIndexOf('/') + 1).replace(/\.(json|md)$/, '') : null);
  const out = new Set<string>();
  for (const e of index?.[type.key] ?? []) for (const n of [e.id, slug(e.paths?.en), slug(e.paths?.tr)]) if (n) out.add(n);
  return out;
}

export type Picked =
  | { ok: true; id: string; index: CmsIndex | null }
  | { ok: false; response: Response; taken?: string[] };

/**
 * The file name of a new entry, decided by the server. `keep` (a saved
 * create draft's current name) is kept while the data still allows it, with
 * no read (and no index: `index` is then null). Otherwise the first candidate the index does not list is checked
 * on main; a type that takes the next free name moves on when that file is
 * there (an index a deploy behind), up to NAME_READS reads. Approval checks
 * again that the files are still absent, so two drafts racing for one name
 * cannot both land.
 */
export async function pickEntryId(request: Request, env: Env, type: CmsType, data: unknown, keep: string | null): Promise<Picked> {
  const id = newEntryId(type, data);
  if (!id.ok) return { ok: false, response: invalid(id.errors) };
  const candidates = idCandidates(type, id.data, data);
  if (keep && candidates.includes(keep)) return { ok: true, id: keep, index: null };
  const index = type.whenTaken === 'next' || type.indexSection ? await loadCmsIndex(request, env) : null;
  const used = type.whenTaken === 'next' ? namesInUse(type, index) : new Set<string>();
  let reads = 0;
  for (const name of candidates) {
    if (used.has(name)) continue;
    const paths = newPaths(type, name);
    let onMain: Record<string, string | null>;
    try {
      onMain = await fileShasOnBase(paths, env);
    } catch (e) {
      return { ok: false, response: githubFailed(e) };
    }
    const taken = paths.filter((p) => onMain[p] !== null);
    if (taken.length === 0) return { ok: true, id: name, index };
    if (type.whenTaken === 'refuse' || ++reads >= NAME_READS) {
      return { ok: false, taken, response: fail(409, 'exists', 'An entry with this id is already published; open it instead', { paths: taken }) };
    }
  }
  return { ok: false, taken: [], response: fail(409, 'exists', 'No free file name for this title; change it a little', { paths: [] }) };
}

/**
 * A published entry with the same title in the same place (a resource
 * link already in that section): a soft warning on create, never a refusal.
 */
export function duplicateOf(type: CmsType, index: CmsIndex | null, data: unknown): string | undefined {
  if (!type.indexSection || !index) return undefined;
  const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();
  let title: string | undefined;
  let section: string | undefined;
  try {
    title = type.indexTitle(data, 'en');
    section = type.indexSection(data);
  } catch {
    return undefined;
  }
  if (!norm(title) || !section) return undefined;
  return (index[type.key] ?? []).find((e) => norm(e.title) === norm(title) && e.section === section)?.id;
}

/**
 * Rule 8 (CLAUDE.md) and a learning path's locked keys, at submit and at
 * approval: a 422 naming the fields, 503 without the index a level's domain
 * is checked against, or null. `raw` is the stored draft data: its sides'
 * `source` and its `_assigned` are the server's own record.
 */
export async function refuseLp(request: Request, env: Env, type: CmsType, raw: unknown): Promise<Response | null> {
  if (type.format !== 'markdown-pair' || (!type.resourceIds && type.lockedKeys.length === 0)) return null;
  const data = raw as LpDraftData;
  let domains: string[] | null = null;
  if (type.lockedKeys.includes('domain')) {
    const index = await loadCmsIndex(request, env);
    if (!index) return indexUnavailable();
    domains = (index['lp-domains'] ?? []).map((e) => e.id);
  }
  const assigned = Array.isArray(data._assigned) ? data._assigned.filter((x): x is string => typeof x === 'string') : [];
  const errors = lpErrors(type, data, assigned, domains);
  return Object.keys(errors).length ? invalid(errors) : null;
}
