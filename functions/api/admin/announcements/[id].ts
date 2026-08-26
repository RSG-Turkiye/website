import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageAnnouncements } from '../../../_lib/auth';

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

  if (body.title !== undefined) { fields.push('title = ?'); bindings.push(body.title); }
  if (body.description !== undefined) { fields.push('description = ?'); bindings.push(body.description); }
  if (body.button_text !== undefined) { fields.push('button_text = ?'); bindings.push(body.button_text); }
  if (body.button_url !== undefined) { fields.push('button_url = ?'); bindings.push(body.button_url); }
  if (body.show_as_popup !== undefined) { fields.push('show_as_popup = ?'); bindings.push(body.show_as_popup ? 1 : 0); }
  if (body.expires_at !== undefined) { fields.push('expires_at = ?'); bindings.push(body.expires_at); }

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
