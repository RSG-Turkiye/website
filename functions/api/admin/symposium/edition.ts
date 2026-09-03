// Admin read/write for the symposium's editable settings: registration and
// abstract links and deadlines, and the two venue-visibility overrides. This
// is the only write path onto `symposium_edition` -- everything else about
// an edition (speakers, sessions, committee) is future tasks' territory.
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageSymposium } from '../../../_lib/auth';
import { editionRowFromInput, rowToEditionInput, triggerRebuild } from '../../../_lib/symposium';
import type { EditionRow, EditionInput } from '../../../_lib/symposium';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  // The edition being prepared: highest year not yet archived. Mirrors the
  // public endpoint's choice of row (functions/api/symposium.ts) -- this
  // panel edits exactly the row that endpoint would serve.
  const edition = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public
     FROM symposium_edition
     WHERE archived_pr_url IS NULL
     ORDER BY year DESC
     LIMIT 1`
  ).first<EditionRow>();

  // No row yet: hand back defaults for the current year rather than a 404,
  // so the form has something sane to start from.
  const row: EditionRow = edition ?? {
    year: new Date().getFullYear(),
    registration_url: '',
    registration_deadline: null,
    abstract_url: '',
    abstract_deadline: null,
    venue_public: null,
    city_public: null,
  };

  // Exactly the shape PUT accepts back, plus the year that names the row --
  // a client can GET, edit one field, and PUT the whole object untouched.
  return jsonResponse({ year: row.year, ...rowToEditionInput(row) });
};

export const onRequestPut: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<EditionInput & { year: number }>();

  if (!Number.isInteger(body.year) || body.year < 2000) {
    return jsonResponse({ error: 'A valid year is required' }, 400);
  }

  let row: EditionRow;
  try {
    row = editionRowFromInput(body, body.year);
  } catch (err) {
    return jsonResponse({ error: String(err instanceof Error ? err.message : err) }, 400);
  }

  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO symposium_edition
      (year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(year) DO UPDATE SET
       registration_url = excluded.registration_url,
       registration_deadline = excluded.registration_deadline,
       abstract_url = excluded.abstract_url,
       abstract_deadline = excluded.abstract_deadline,
       venue_public = excluded.venue_public,
       city_public = excluded.city_public,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`
  ).bind(
    row.year,
    row.registration_url,
    row.registration_deadline,
    row.abstract_url,
    row.abstract_deadline,
    row.venue_public,
    row.city_public,
    user.id,
    now
  ).run();

  // The write is already committed at this point. A dead or misconfigured
  // hook must not turn a saved edit into a failed request -- see
  // triggerRebuild's own doc comment.
  const rebuild = await triggerRebuild(env);

  return jsonResponse({ ok: true, rebuild });
};
