import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds, rangeParams } from '../../../_lib/social-api';
import { parsePlanInput, isSocialEditor } from '../../../_lib/social-plans';
import { runWithAudit } from '../../../_lib/audit';

type PlanRow = {
  id: string; title: string; scheduled_at: number; platforms: string; post_type: string; assignee_id: string | null;
  assignee_email: string | null; note: string; post_id: string | null; post_status: string | null; created_by: string; created_at: number;
};

/**
 * `forAgent` is the member a token acts for, or null for the panel. An
 * agent's answers carry no e-mail address (its model provider is a third
 * party), and the team's note and the linked post's status only on plans
 * its member made: on a colleague's plan they are null.
 */
function planResponse(r: PlanRow, forAgent: string | null) {
  let platforms: string[] = [];
  try { platforms = JSON.parse(r.platforms); } catch { platforms = []; }
  const own = forAgent === null || r.created_by === forAgent;
  return {
    id: r.id, title: r.title, scheduledAt: r.scheduled_at, platforms, postType: r.post_type,
    assigneeId: r.assignee_id, assigneeEmail: forAgent !== null ? null : r.assignee_email,
    note: own ? r.note : null, postId: r.post_id, postStatus: own ? r.post_status : null,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const range = rangeParams(new URL(request.url));
  if (!range) return jsonResponse({ error: 'from and to are required, at most 62 days apart', code: 'invalid_range' }, 400);
  const rows = (await env.DB.prepare(
    `SELECT pl.*, u.email AS assignee_email, p.status AS post_status
       FROM social_plans pl
       LEFT JOIN users u ON u.id = pl.assignee_id
       LEFT JOIN social_posts p ON p.id = pl.post_id
      WHERE pl.scheduled_at BETWEEN ? AND ?
      ORDER BY pl.scheduled_at`,
  ).bind(range.from, range.to).all<PlanRow>()).results;
  return jsonResponse({ plans: rows.map((r) => planResponse(r, gate.agent ? gate.user.id : null)) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const parsed = await parsePlanInput(body, false, now, (id) => isSocialEditor(env.DB, id));
  if (!parsed.ok) return jsonResponse({ error: 'Invalid plan', code: parsed.code }, 400);
  const p = parsed.value;
  const id = generateId();
  await runWithAudit(env.DB, [
    env.DB.prepare(
      `INSERT INTO social_plans (id, title, scheduled_at, platforms, post_type, assignee_id, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, p.title, p.scheduledAt, JSON.stringify(p.platforms), p.postType, p.assigneeId ?? null, p.note ?? '', gate.user.id, now, now),
  ], { userId: gate.user.id, action: 'social.plan.create', targetType: 'social_plan', targetId: id, details: p, agent: gate.agent?.tokenId ?? null }, now);
  return jsonResponse({ id }, 201);
};
