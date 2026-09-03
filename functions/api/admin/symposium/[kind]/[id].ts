// Admin edit/delete for a single speaker, session, or committee row. GET
// (list) and POST (create) on the collection live in ../[kind].ts; this file
// only ever touches the one row an admin has already selected from that
// list, named by `id` in the URL.
//
// `kind` is untrusted (it's a URL segment): an unknown value is a 404, not a
// 500 from a query against a table name we made up.
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageSymposium } from '../../../../_lib/auth';
import { KIND_TABLES, rowFromInput, triggerRebuild } from '../../../../_lib/symposium';
import type { SymposiumKind, SpeakerRow, SessionRow, CommitteeRow, SymposiumInput, SymposiumRowInput } from '../../../../_lib/symposium';

function isKnownKind(value: string): value is SymposiumKind {
  return Object.prototype.hasOwnProperty.call(KIND_TABLES, value);
}

const ROW_COLUMNS: Record<SymposiumKind, string> = {
  speakers: 'id, slug, year, name, position, company, bio, photo, linkedin, sort',
  sessions: 'id, slug, year, title, type, time, end_time, description, speaker_slugs, sort',
  committee: 'id, year, name, role, role_tr, affiliation, photo, linkedin, sort',
};

async function findRow(
  env: Env,
  kind: SymposiumKind,
  id: string,
): Promise<SpeakerRow | SessionRow | CommitteeRow | null> {
  const table = KIND_TABLES[kind];
  const row = await env.DB.prepare(
    `SELECT ${ROW_COLUMNS[kind]} FROM ${table} WHERE id = ?`
  ).bind(id).first<SpeakerRow | SessionRow | CommitteeRow>();
  return row ?? null;
}

function updateStatement(
  kind: SymposiumKind,
  row: SymposiumRowInput,
  id: string,
): { sql: string; values: unknown[] } {
  switch (kind) {
    case 'speakers': {
      const r = row as Omit<SpeakerRow, 'id' | 'sort'>;
      return {
        sql: `UPDATE symposium_speakers
              SET slug = ?, name = ?, position = ?, company = ?, bio = ?, photo = ?, linkedin = ?
              WHERE id = ?`,
        values: [r.slug, r.name, r.position, r.company, r.bio, r.photo, r.linkedin, id],
      };
    }
    case 'sessions': {
      const r = row as Omit<SessionRow, 'id' | 'sort'>;
      return {
        sql: `UPDATE symposium_sessions
              SET slug = ?, title = ?, type = ?, time = ?, end_time = ?, description = ?, speaker_slugs = ?
              WHERE id = ?`,
        values: [r.slug, r.title, r.type, r.time, r.end_time, r.description, r.speaker_slugs, id],
      };
    }
    case 'committee': {
      const r = row as Omit<CommitteeRow, 'id' | 'sort'>;
      return {
        sql: `UPDATE symposium_committee
              SET name = ?, role = ?, role_tr = ?, affiliation = ?, photo = ?, linkedin = ?
              WHERE id = ?`,
        values: [r.name, r.role, r.role_tr, r.affiliation, r.photo, r.linkedin, id],
      };
    }
  }
}

export const onRequestPut: PagesFunction<Env> = async ({ request, env, params }) => {
  const kind = String(params.kind);
  if (!isKnownKind(kind)) return jsonResponse({ error: 'Not found' }, 404);
  const id = String(params.id);

  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  // The row's year is not editable here -- moving a speaker to a different
  // edition is not this endpoint's job -- so it is read from the existing
  // row rather than taken from the request body.
  const existing = await findRow(env, kind, id);
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json<SymposiumInput>();

  let row;
  try {
    row = rowFromInput(kind as never, body as never, existing.year);
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 400);
  }

  const { sql, values } = updateStatement(kind, row, id);
  await env.DB.prepare(sql).bind(...values).run();

  const rebuild = await triggerRebuild(env);
  return jsonResponse({ ok: true, rebuild });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const kind = String(params.kind);
  if (!isKnownKind(kind)) return jsonResponse({ error: 'Not found' }, 404);
  const id = String(params.id);

  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const existing = await findRow(env, kind, id);
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const table = KIND_TABLES[kind];
  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();

  const rebuild = await triggerRebuild(env);
  return jsonResponse({ ok: true, rebuild });
};
