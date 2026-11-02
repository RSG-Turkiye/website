import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { appendAudit } from '../../_lib/audit';
import { listProfessors, listLabs, upsertProfessor, deleteProfessor, staleRecords, newProfessorId, type ProfessorRow } from '../../_lib/guide-db';
import { guideGate, fail, readBody, republish, str, strList, isUrlOrEmpty, isGuideId, isSlug } from '../../_lib/guide-api';

/**
 * The panel's professor records (graduate guide). GET for Rehber editors;
 * POST (create/update, or ?republish=1) and DELETE for approvers. Each write
 * republishes the search index and returns the result, so a failed publish
 * is never silent. guide-db.ts writes the guide.* audit rows.
 */

const KEYS = new Set(['id', 'title', 'name', 'universityId', 'department', 'labId', 'profileUrl', 'openalexId', 'handTopics', 'hiddenTopics', 'programmeIds', 'source', 'checkedAt']);

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, false);
  if (!gate.ok) return gate.response;
  const [professors, labs, stale, state] = await Promise.all([
    listProfessors(env.DB), listLabs(env.DB), staleRecords(env.DB, gate.now),
    env.DB.prepare('SELECT published_at, count, unresolved, error FROM guide_index_state WHERE id = 1').first(),
  ]);
  return jsonResponse({ professors, labs, stale, state, canWrite: gate.canWrite });
};

/** The professor a request describes, merged over the stored row, or a 400 reason. */
function parse(input: Record<string, unknown>, existing: ProfessorRow | null, now: number): ProfessorRow | string {
  for (const k of Object.keys(input)) if (!KEYS.has(k)) return `unknown field ${k}`;
  const name = str(input.name, 200, true);
  const universityId = str(input.universityId, 80, true);
  const title = str(input.title, 60, false);
  const department = str(input.department, 200, false);
  const profileUrl = str(input.profileUrl, 500, false);
  const source = str(input.source, 500, false);
  const openalexId = str(input.openalexId, 40, false);
  const handTopics = strList(input.handTopics, 40, 120);
  const hiddenTopics = strList(input.hiddenTopics, 60, 200);
  const programmeIds = strList(input.programmeIds, 20, 80);
  if (name === null) return 'name is required';
  if (universityId === null || !isSlug(universityId)) return 'universityId must be a university id';
  if (title === null || department === null || profileUrl === null || source === null || openalexId === null) return 'a text field is too long';
  if (!isUrlOrEmpty(profileUrl) || !isUrlOrEmpty(source)) return 'links must start with http(s)://';
  if (openalexId && !/^A\d+$/.test(openalexId)) return 'openalexId looks like A5012345678';
  if (!handTopics || !hiddenTopics || !programmeIds) return 'a list is malformed or too long';
  if (programmeIds.some((p) => !isSlug(p))) return 'programmeIds must be programme ids';
  const labId = input.labId === null || input.labId === undefined || input.labId === '' ? null : input.labId;
  if (labId !== null && !isGuideId(labId, 'l')) return 'labId must be a lab id';
  const checkedAt = input.checkedAt === undefined ? now : Number(input.checkedAt);
  if (!Number.isInteger(checkedAt) || checkedAt <= 0 || checkedAt > now + 86400) return 'checkedAt must be a time';
  return {
    id: existing?.id ?? newProfessorId(), title, name, universityId, department, labId: labId as string | null, profileUrl,
    openalexId: openalexId || null, handTopics, hiddenTopics,
    // Written by the nightly refresh only; an edit keeps them.
    openalexTopics: existing?.openalexTopics ?? [], topicsRefreshedAt: existing?.topicsRefreshedAt ?? null, topicsFailures: existing?.topicsFailures ?? 0,
    programmeIds, source, checkedAt,
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return fail(400, 'bad_request', 'Expected a JSON object');
  if (new URL(request.url).searchParams.get('republish') === '1') {
    const publish = await republish(env, gate.now);
    await appendAudit(env.DB, { userId: gate.user.id, action: 'guide.republish', details: publish.ok ? { count: publish.count } : { failed: true } }, gate.now);
    return jsonResponse({ publish });
  }
  const input = body.professor;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'bad_request', 'Expected { professor }');
  const raw = input as Record<string, unknown>;
  let existing: ProfessorRow | null = null;
  if (raw.id !== undefined) {
    if (!isGuideId(raw.id, 'p')) return fail(400, 'bad_request', 'id must be a professor id');
    existing = (await listProfessors(env.DB)).find((p) => p.id === raw.id) ?? null;
    if (!existing) return fail(404, 'not_found', 'No such professor');
  }
  const parsed = parse(raw, existing, gate.now);
  if (typeof parsed === 'string') return fail(400, 'invalid', parsed);
  await upsertProfessor(env.DB, parsed, gate.user.id, gate.now);
  return jsonResponse({ id: parsed.id, publish: await republish(env, gate.now) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!isGuideId(id, 'p')) return fail(400, 'bad_request', 'id must be a professor id');
  await deleteProfessor(env.DB, id as string, gate.user.id, gate.now);
  return jsonResponse({ ok: true, publish: await republish(env, gate.now) });
};
