import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { listLabs, upsertLab, deleteLab, newLabId, type LabRow } from '../../_lib/guide-db';
import { guideGate, fail, readBody, republish, str, isUrlOrEmpty, isGuideId, isSlug } from '../../_lib/guide-api';

/**
 * The panel's lab records (graduate guide). Listed with the professors
 * (GET /api/guide/professors). POST creates or updates, DELETE removes one no
 * professor uses; approvers only. guide-db.ts writes the guide.* audit rows.
 */

const KEYS = new Set(['id', 'name', 'universityId', 'url', 'checkedAt']);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  const input = body?.lab;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail(400, 'bad_request', 'Expected { lab }');
  const raw = input as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (!KEYS.has(k)) return fail(400, 'invalid', `unknown field ${k}`);
  let existing: LabRow | null = null;
  if (raw.id !== undefined) {
    if (!isGuideId(raw.id, 'l')) return fail(400, 'bad_request', 'id must be a lab id');
    existing = (await listLabs(env.DB)).find((l) => l.id === raw.id) ?? null;
    if (!existing) return fail(404, 'not_found', 'No such lab');
  }
  const name = str(raw.name, 200, true);
  const universityId = str(raw.universityId, 80, true);
  const url = str(raw.url, 500, false);
  if (name === null) return fail(400, 'invalid', 'name is required');
  if (universityId === null || !isSlug(universityId)) return fail(400, 'invalid', 'universityId must be a university id');
  if (url === null || !isUrlOrEmpty(url)) return fail(400, 'invalid', 'url must start with http(s)://');
  const checkedAt = raw.checkedAt === undefined ? gate.now : Number(raw.checkedAt);
  if (!Number.isInteger(checkedAt) || checkedAt <= 0 || checkedAt > gate.now + 86400) return fail(400, 'invalid', 'checkedAt must be a time');
  const lab: LabRow = { id: existing?.id ?? newLabId(), name, universityId, url, checkedAt };
  await upsertLab(env.DB, lab, gate.user.id, gate.now);
  return jsonResponse({ id: lab.id, publish: await republish(env, gate.now) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const id = new URL(request.url).searchParams.get('id');
  if (!isGuideId(id, 'l')) return fail(400, 'bad_request', 'id must be a lab id');
  const res = await deleteLab(env.DB, id as string, gate.user.id, gate.now);
  if (!res.ok) return fail(409, res.code, 'A professor still belongs to this lab');
  return jsonResponse({ ok: true, publish: await republish(env, gate.now) });
};
