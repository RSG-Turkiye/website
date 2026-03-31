import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse } from '../_lib/auth';

const RESOURCE_ID_RE = /^[a-z0-9_-]+$/i;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const rows = await env.DB.prepare(
    'SELECT resource_id FROM progress WHERE user_id = ? AND completed = 1'
  ).bind(user.id).all<{ resource_id: string }>();

  return jsonResponse({ completed: rows.results.map(r => r.resource_id) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  let body: {
    resource_id?: string;
    completed?: boolean;
    items?: Array<{ resource_id: string; completed: boolean }>;
  };
  try { body = await request.json(); } catch { return jsonResponse({ error: 'Invalid body' }, 400); }

  const items: Array<{ resource_id: string; completed: boolean }> =
    body.items ??
    (body.resource_id !== undefined
      ? [{ resource_id: body.resource_id, completed: body.completed ?? false }]
      : []);

  if (items.length === 0) return jsonResponse({ ok: true });
  if (items.length > 500) return jsonResponse({ error: 'Too many items' }, 400);

  const now = Math.floor(Date.now() / 1000);

  for (const item of items) {
    if (
      typeof item.resource_id !== 'string' ||
      item.resource_id.length > 120 ||
      !RESOURCE_ID_RE.test(item.resource_id)
    ) continue;

    const completed = item.completed ? 1 : 0;
    const completedAt = item.completed ? now : null;

    await env.DB.prepare(`
      INSERT INTO progress (user_id, resource_id, completed, completed_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT (user_id, resource_id) DO UPDATE SET
        completed = excluded.completed,
        completed_at = CASE WHEN excluded.completed = 1 THEN excluded.completed_at ELSE completed_at END
    `).bind(user.id, item.resource_id, completed, completedAt).run();
  }

  return jsonResponse({ ok: true });
};
