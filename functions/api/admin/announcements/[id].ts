import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageAnnouncements } from '../../../_lib/auth';
import {
  announcementText,
  announcementExpiry,
  announcementUrl,
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_BUTTON_TEXT,
} from '../../../_lib/announcement';

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  const body = await request.json<Partial<{
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: boolean;
    expires_at: number;
  }>>();

  const fields: string[] = [];
  const bindings: (string | number)[] = [];

  // Validated before binding, by the same rules the create path uses. This
  // used to call .length on whatever arrived -- so a numeric title passed the
  // check and was stored as a number -- and never looked at expires_at or
  // button_url at all.
  const checks: [string, string, { ok: boolean; value?: unknown; error?: string }][] = [];
  if (body.title !== undefined) checks.push(['title', 'title = ?', announcementText(body.title, MAX_TITLE, 'Title', true)]);
  if (body.description !== undefined) checks.push(['description', 'description = ?', announcementText(body.description, MAX_DESCRIPTION, 'Description', true)]);
  if (body.button_text !== undefined) checks.push(['button_text', 'button_text = ?', announcementText(body.button_text, MAX_BUTTON_TEXT, 'Button text', true)]);
  if (body.button_url !== undefined) checks.push(['button_url', 'button_url = ?', announcementUrl(body.button_url, true)]);
  if (body.expires_at !== undefined) checks.push(['expires_at', 'expires_at = ?', announcementExpiry(body.expires_at)]);

  for (const [, clause, result] of checks) {
    if (!result.ok) return jsonResponse({ error: result.error }, 400);
    fields.push(clause);
    bindings.push(result.value as string | number);
  }

  if (body.show_as_popup !== undefined) { fields.push('show_as_popup = ?'); bindings.push(body.show_as_popup ? 1 : 0); }

  if (fields.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  bindings.push(id);
  await env.DB.prepare(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`).bind(...bindings).run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();

  return jsonResponse({ ok: true });
};
