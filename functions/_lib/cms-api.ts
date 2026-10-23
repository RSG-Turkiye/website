/**
 * What every /api/cms endpoint does first: who is asking, what they may do,
 * and the shapes they answer in. Errors are `{ error, code }` and never carry
 * draft content or GitHub's own text.
 */

import { checkCsrf, getSessionUser, jsonResponse, type Env, type User } from './auth';
import { groupRights, type CmsGroup, type GroupRights } from './cms-access';
import type { DraftRow } from './cms-drafts';
import { cmsType, type CmsType } from '../../src/lib/cms/types';
import type { CmsIndex, CmsIndexEntry } from '../../src/lib/cms/cms-index';
import { jsonPath } from '../../src/lib/cms/serialize';

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

export function mayApprove(gate: { rights: GroupRights }, row: Pick<DraftRow, 'type'>): boolean {
  const type = cmsType(row.type);
  return !!type && rightsIn(gate.rights, type.group).approve;
}

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
    reviewer_id: row.reviewer_id,
    review_note: row.review_note,
    pr_url: row.pr_url,
    pr_number: row.pr_number,
    failure: row.failure,
    created_at: row.created_at,
    updated_at: row.updated_at,
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
  if (type.format === 'json') return [jsonPath(type, id)];
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
