import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, canManageAnnouncements } from '../../_lib/auth';
import {
  announcementText,
  announcementExpiry,
  announcementUrl,
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_BUTTON_TEXT,
} from '../../_lib/announcement';

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

  // Every field, by the same rules the PATCH uses. See _lib/announcement.ts:
  // a text expires_at makes the announcement permanent, silently, because
  // SQLite compares every TEXT value as greater than every INTEGER.
  const title = announcementText(body.title, MAX_TITLE, 'Title', true);
  if (!title.ok) return jsonResponse({ error: title.error }, 400);
  const description = announcementText(body.description, MAX_DESCRIPTION, 'Description', true);
  if (!description.ok) return jsonResponse({ error: description.error }, 400);
  const buttonText = announcementText(body.button_text, MAX_BUTTON_TEXT, 'Button text', true);
  if (!buttonText.ok) return jsonResponse({ error: buttonText.error }, 400);
  const buttonUrl = announcementUrl(body.button_url, true);
  if (!buttonUrl.ok) return jsonResponse({ error: buttonUrl.error }, 400);
  const expiresAt = announcementExpiry(body.expires_at);
  if (!expiresAt.ok) return jsonResponse({ error: expiresAt.error }, 400);

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO announcements
      (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    // The validated values, not the raw body: binding body.expires_at here
    // would put the string straight into the column the validation exists to
    // protect.
    title.value,
    description.value,
    buttonText.value,
    buttonUrl.value,
    body.show_as_popup ? 1 : 0,
    expiresAt.value,
    user.id,
    now
  ).run();

  return jsonResponse({ ok: true, id });
};
