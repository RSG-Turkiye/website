// Admin list/create for the three list-shaped overlay tables: speakers,
// sessions, and committee. All three share this file (and [id].ts, for
// edit/delete) because they share a shape -- a year-scoped list ordered by
// sort. The edition's single settings row is edition.ts's (Task 5)
// territory; this file never touches that table.
//
// `kind` comes straight from the URL, so it is untrusted: an unknown value
// is a 404, not a 500 from a query against a table name we made up.
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, canManageSymposium } from '../../../_lib/auth';
import { KIND_TABLES, rowFromInput, rowToInput, triggerRebuild, conflictingSlug } from '../../../_lib/symposium';
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
} from '../../../_lib/symposium';

function isKnownKind(value: string): value is SymposiumKind {
  return Object.prototype.hasOwnProperty.call(KIND_TABLES, value);
}

// The edition these lists belong to: the highest year not yet archived,
// mirroring edition.ts's own choice of row -- an admin editing speakers is
// editing the same edition the settings form and the public endpoint agree
// on. No row yet: the current calendar year, so there is something to add to.
async function resolveYear(env: Env): Promise<number> {
  const edition = await env.DB.prepare(
    `SELECT year FROM symposium_edition WHERE archived_pr_url IS NULL ORDER BY year DESC LIMIT 1`
  ).first<{ year: number }>();
  return edition?.year ?? new Date().getFullYear();
}

const LIST_COLUMNS: Record<SymposiumKind, string> = {
  speakers: 'id, slug, year, name, position, company, bio, photo, linkedin, sort',
  sessions: 'id, slug, year, title, type, time, end_time, description, speaker_slugs, sort',
  committee: 'id, year, name, role, role_tr, affiliation, photo, linkedin, sort',
};

function insertStatement(
  kind: SymposiumKind,
  row: SymposiumRowInput,
  id: string,
  sort: number,
): { sql: string; values: unknown[] } {
  switch (kind) {
    case 'speakers': {
      const r = row as Omit<SpeakerRow, 'id' | 'sort'>;
      return {
        sql: `INSERT INTO symposium_speakers (id, slug, year, name, position, company, bio, photo, linkedin, sort)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [id, r.slug, r.year, r.name, r.position, r.company, r.bio, r.photo, r.linkedin, sort],
      };
    }
    case 'sessions': {
      const r = row as Omit<SessionRow, 'id' | 'sort'>;
      return {
        sql: `INSERT INTO symposium_sessions (id, slug, year, title, type, time, end_time, description, speaker_slugs, sort)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [id, r.slug, r.year, r.title, r.type, r.time, r.end_time, r.description, r.speaker_slugs, sort],
      };
    }
    case 'committee': {
      const r = row as Omit<CommitteeRow, 'id' | 'sort'>;
      return {
        sql: `INSERT INTO symposium_committee (id, year, name, role, role_tr, affiliation, photo, linkedin, sort)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        values: [id, r.year, r.name, r.role, r.role_tr, r.affiliation, r.photo, r.linkedin, sort],
      };
    }
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const kind = String(params.kind);
  if (!isKnownKind(kind)) return jsonResponse({ error: 'Not found' }, 404);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const year = await resolveYear(env);
  const table = KIND_TABLES[kind];
  const result = await env.DB.prepare(
    `SELECT ${LIST_COLUMNS[kind]} FROM ${table} WHERE year = ? ORDER BY sort, id`
  ).bind(year).all<SpeakerRow | SessionRow | CommitteeRow>();

  // Exactly the shape POST/PUT accept back, plus id and sort -- a form can
  // load a row from this list, change nothing, and save it as a no-op. Each
  // row came from the query above, which already scoped it to this kind's
  // own table, so casting it to that kind's row shape here just names what
  // the SQL already guarantees.
  const items = result.results.map((row) => {
    switch (kind) {
      case 'speakers': return rowToInput('speakers', row as SpeakerRow);
      case 'sessions': return rowToInput('sessions', row as SessionRow);
      case 'committee': return rowToInput('committee', row as CommitteeRow);
    }
  });
  return jsonResponse({ year, items });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const kind = String(params.kind);
  if (!isKnownKind(kind)) return jsonResponse({ error: 'Not found' }, 404);

  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<SymposiumInput>();
  const year = await resolveYear(env);

  // Dispatched per kind rather than through the catch-all overload: `kind`
  // narrows to its literal in each branch, so `rowFromInput` is called with
  // exactly the input type it validates -- no bypass of the overload's own
  // checking.
  let row: SymposiumRowInput;
  try {
    switch (kind) {
      case 'speakers':
        row = rowFromInput(kind, body as SpeakerInput, year);
        break;
      case 'sessions':
        row = rowFromInput(kind, body as SessionInput, year);
        break;
      case 'committee':
        row = rowFromInput(kind, body as CommitteeInput, year);
        break;
    }
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 400);
  }

  const table = KIND_TABLES[kind];

  if (kind === 'speakers' || kind === 'sessions') {
    // Safe: the branch above only ever builds this row shape for these two
    // kinds, both of which have a `slug` column.
    const slug = (row as { slug: string }).slug;
    const conflict = await conflictingSlug(env, table, year, slug);
    if (conflict) {
      const noun = kind === 'speakers' ? 'speaker' : 'session';
      return jsonResponse({ error: `slug "${conflict}" is already used by another ${noun} this year` }, 409);
    }
  }

  const maxSort = await env.DB.prepare(
    `SELECT MAX(sort) AS m FROM ${table} WHERE year = ?`
  ).bind(year).first<{ m: number | null }>();
  const sort = (maxSort?.m ?? -1) + 1;
  const id = generateId();

  const { sql, values } = insertStatement(kind, row, id, sort);
  await env.DB.prepare(sql).bind(...values).run();

  // The write is already committed at this point. A dead or misconfigured
  // hook must not turn a saved edit into a failed request -- see
  // triggerRebuild's own doc comment.
  const rebuild = await triggerRebuild(env);

  return jsonResponse({ ok: true, id, rebuild });
};
