import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import { MAX_EVENT_SECONDS, type EventModeRow } from '../../../_lib/social-events';
import { runWithAudit } from '../../../_lib/audit';
import { isSocialEditor } from '../../../_lib/social-plans';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const now = nowSeconds();
  const rows = (await env.DB.prepare('SELECT * FROM social_event_modes WHERE ends_at > ? ORDER BY starts_at DESC')
    .bind(now - 7 * 86400).all<EventModeRow>()).results;
  const emails = new Map((await env.DB.prepare('SELECT id, email FROM users WHERE is_admin = 1 OR is_social = 1 OR is_social_publisher = 1')
    .all<{ id: string; email: string }>()).results.map((u) => [u.id, u.email]));
  const modes = rows.map((m) => {
    let editorIds: string[] = [];
    try { editorIds = JSON.parse(m.editor_ids); } catch { editorIds = []; }
    return {
      id: m.id, name: m.name, startsAt: m.starts_at, endsAt: m.ends_at, editorIds,
      editorEmails: editorIds.map((i) => emails.get(i) ?? i), openedBy: m.opened_by, closedAt: m.closed_at,
      active: m.closed_at === null && m.starts_at <= now && now < m.ends_at,
    };
  });
  return jsonResponse({ modes });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'publish', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const bad = (code: string) => jsonResponse({ error: 'Invalid event window', code }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 80) return bad('invalid_name');
  const { startsAt, endsAt } = body;
  if (typeof startsAt !== 'number' || typeof endsAt !== 'number' || !Number.isInteger(startsAt) || !Number.isInteger(endsAt)
    || endsAt <= startsAt || endsAt <= now) return bad('invalid_window');
  if (endsAt - startsAt > MAX_EVENT_SECONDS) return bad('window_too_long');
  const ids = body.editorIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || new Set(ids).size !== ids.length || !ids.every((i) => typeof i === 'string')) return bad('invalid_editors');
  for (const i of ids as string[]) if (!(await isSocialEditor(env.DB, i))) return bad('invalid_editors');

  const id = generateId();
  await runWithAudit(env.DB, [
    env.DB.prepare('INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, startsAt, endsAt, JSON.stringify(ids), gate.user.id, now),
  ], { userId: gate.user.id, action: 'social.event.open', targetType: 'social_event_mode', targetId: id, details: { name, startsAt, endsAt, editorIds: ids } }, now);
  return jsonResponse({ id }, 201);
};
