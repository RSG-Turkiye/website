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
import type {
  SymposiumKind,
  SpeakerRow,
  SessionRow,
  CommitteeRow,
  SpeakerInput,
  SessionInput,
  CommitteeInput,
  SymposiumInput,
  SymposiumRowInput,
} from '../../../../_lib/symposium';

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

// Sessions link to speakers *by slug*, so renaming one row's slug to match
// another's within the same year would silently repoint that link. Callers
// have already checked `kind === 'speakers' || 'sessions'`; committee has no
// slug column and never reaches this. `excludeId` is the row being edited --
// a row keeping its own slug is not a conflict with itself. Returns the
// conflicting slug (so the caller can name it in the error) or null if free.
async function conflictingSlug(
  env: Env,
  table: string,
  year: number,
  slug: string,
  excludeId: string,
): Promise<string | null> {
  const existing = await env.DB.prepare(
    `SELECT id FROM ${table} WHERE year = ? AND slug = ? AND id != ?`
  ).bind(year, slug, excludeId).first<{ id: string }>();
  return existing ? slug : null;
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

  // Dispatched per kind rather than through the catch-all overload: `kind`
  // narrows to its literal in each branch, so `rowFromInput` is called with
  // exactly the input type it validates -- no bypass of the overload's own
  // checking.
  let row: SymposiumRowInput;
  try {
    switch (kind) {
      case 'speakers':
        row = rowFromInput(kind, body as SpeakerInput, existing.year);
        break;
      case 'sessions':
        row = rowFromInput(kind, body as SessionInput, existing.year);
        break;
      case 'committee':
        row = rowFromInput(kind, body as CommitteeInput, existing.year);
        break;
    }
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 400);
  }

  if (kind === 'speakers' || kind === 'sessions') {
    // Safe: the branch above only ever builds this row shape for these two
    // kinds, both of which have a `slug` column.
    const slug = (row as { slug: string }).slug;
    const table = KIND_TABLES[kind];
    const conflict = await conflictingSlug(env, table, existing.year, slug, id);
    if (conflict) {
      const noun = kind === 'speakers' ? 'speaker' : 'session';
      return jsonResponse({ error: `slug "${conflict}" is already used by another ${noun} this year` }, 409);
    }
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
