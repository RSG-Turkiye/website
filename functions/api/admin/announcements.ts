import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, canManageAnnouncements } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT id, title, description, button_text, button_url, show_as_popup, expires_at, created_at
     FROM announcements
     ORDER BY created_at DESC`
  ).all<{
    id: string;
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: number;
    expires_at: number;
    created_at: number;
  }>();

  return jsonResponse({
    announcements: result.results.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      button_text: a.button_text,
      button_url: a.button_url,
      show_as_popup: a.show_as_popup === 1,
      expires_at: a.expires_at,
      created_at: a.created_at,
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: boolean;
    expires_at: number;
  }>();

  if (!body.title || !body.description || !body.button_text || !body.button_url || !body.expires_at) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  if (body.title.length > 80 || body.description.length > 200 || body.button_text.length > 30) {
    return jsonResponse({ error: 'Field too long' }, 400);
  }

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO announcements
      (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    body.title,
    body.description,
    body.button_text,
    body.button_url,
    body.show_as_popup ? 1 : 0,
    body.expires_at,
    user.id,
    now
  ).run();

  return jsonResponse({ ok: true, id });
};
