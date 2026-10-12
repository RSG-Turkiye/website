import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import { parsePlanInput, isSocialEditor, type PlanInput } from '../../../_lib/social-plans';
import { runWithAudit, runGuardedWithAudit } from '../../../_lib/audit';

type Row = { id: string; title: string; scheduled_at: number; platforms: string; post_type: string; assignee_id: string | null; note: string; post_id: string | null };

const COLUMN: Record<keyof PlanInput, string> = {
  title: 'title', scheduledAt: 'scheduled_at', platforms: 'platforms', postType: 'post_type', assigneeId: 'assignee_id', note: 'note',
};

function current(row: Row): Required<PlanInput> {
  let platforms: PlanInput['platforms'] = [];
  try { platforms = JSON.parse(row.platforms); } catch { platforms = []; }
  return {
    title: row.title, scheduledAt: row.scheduled_at, platforms: platforms ?? [], postType: row.post_type as Required<PlanInput>['postType'],
    assigneeId: row.assignee_id, note: row.note,
  };
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT * FROM social_plans WHERE id = ?').bind(id).first<Row>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const parsed = await parsePlanInput(body, true, now, (uid) => isSocialEditor(env.DB, uid));
  if (!parsed.ok) return jsonResponse({ error: 'Invalid plan', code: parsed.code }, 400);

  const before = current(row);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of Object.keys(parsed.value) as (keyof PlanInput)[]) {
    const to = parsed.value[key];
    if (JSON.stringify(to) === JSON.stringify(before[key])) continue;
    changed[key] = { from: before[key], to };
    sets.push(`${COLUMN[key]} = ?`);
    binds.push(key === 'platforms' ? JSON.stringify(to) : to ?? null);
  }
  if (sets.length === 0) return jsonResponse({ ok: true });
  // A new date deserves a new reminder.
  if (Object.hasOwn(changed, 'scheduledAt')) sets.push('reminded_at = NULL');

  await runWithAudit(env.DB, [
    env.DB.prepare(`UPDATE social_plans SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, now, id),
  ], { userId: gate.user.id, action: 'social.plan.update', targetType: 'social_plan', targetId: id, details: { changed } }, now);
  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT * FROM social_plans WHERE id = ?').bind(id).first<Row>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  if (row.post_id) return jsonResponse({ error: 'This plan already has a post', code: 'plan_has_post' }, 409);
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('DELETE FROM social_plans WHERE id = ? AND post_id IS NULL').bind(id),
    { condition: 'NOT EXISTS (SELECT 1 FROM social_plans WHERE id = ?)', binds: [id] },
    [],
    { userId: gate.user.id, action: 'social.plan.delete', targetType: 'social_plan', targetId: id, details: { title: row.title, scheduledAt: row.scheduled_at } },
  );
  if (!done) return jsonResponse({ error: 'This plan already has a post', code: 'plan_has_post' }, 409);
  return jsonResponse({ ok: true });
};
