import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds, rangeParams } from '../../../_lib/social-api';
import { parseDraft, draftColumns } from '../../../_lib/social-posts';
import { loadPosts, AGENT_VISIBLE } from '../../../_lib/social-post-read';
import { runWithAudit, runGuardedWithAudit } from '../../../_lib/audit';

const LISTABLE_STATUSES = ['pending_approval', 'scheduled'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const forAgent = gate.agent ? gate.user.id : null;
  // A token lists only its member's own posts and what already went out.
  const list = (where: string, binds: unknown[]) => forAgent === null
    ? loadPosts(env.DB, env, where, binds)
    : loadPosts(env.DB, env, `(${where}) AND ${AGENT_VISIBLE}`, [...binds, forAgent], forAgent);
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  if (status !== null) {
    if (!LISTABLE_STATUSES.includes(status)) return jsonResponse({ error: 'Unknown status', code: 'invalid_status' }, 400);
    return jsonResponse({ posts: await list('p.status = ?', [status]) });
  }
  if (url.searchParams.get('done') === '1') {
    const since = Math.floor(Date.now() / 1000) - 60 * 86400;
    const posts = await list(`p.status IN ('published','partially_published','failed') AND p.scheduled_at >= ?`, [since]);
    return jsonResponse({ posts: posts.reverse() });
  }
  if (url.searchParams.get('drafts') === '1') {
    return gate.actor.isPublisher
      ? jsonResponse({ posts: await list(`p.status = 'draft' AND p.scheduled_at IS NULL`, []) })
      : jsonResponse({ posts: await list(`p.status = 'draft' AND p.scheduled_at IS NULL AND p.created_by = ?`, [gate.user.id]) });
  }
  const range = rangeParams(url);
  if (!range) return jsonResponse({ error: 'from and to are required, at most 62 days apart', code: 'invalid_range' }, 400);
  return jsonResponse({ posts: await list('p.scheduled_at BETWEEN ? AND ?', [range.from, range.to]) });
};

type PlanSlot = { id: string; scheduled_at: number; platforms: string; post_type: string; post_id: string | null };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const parsed = parseDraft(body);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid post', code: parsed.code }, 400);
  const d = parsed.value;
  const now = nowSeconds();
  const id = generateId();
  const planId = typeof body.planId === 'string' && body.planId ? body.planId : null;
  const agent = gate.agent?.tokenId ?? null;

  if (!planId) {
    const cols = draftColumns(d);
    await runWithAudit(env.DB, [insertPost(env.DB, id, cols, gate.user.id, agent, now, '')], {
      userId: gate.user.id, action: 'social.post.create', targetType: 'social_post', targetId: id, details: { type: d.type }, agent,
    }, now);
    return jsonResponse({ id, revision: 0 }, 201);
  }

  const plan = await env.DB.prepare('SELECT id, scheduled_at, platforms, post_type, post_id, created_by FROM social_plans WHERE id = ?').bind(planId).first<PlanSlot & { created_by: string }>();
  // A token links a post only to a plan its own member made, as it edits only those.
  if (!plan || (gate.agent && plan.created_by !== gate.user.id)) return jsonResponse({ error: 'Unknown plan', code: 'invalid_plan' }, 400);
  if (plan.post_id) return jsonResponse({ error: 'This plan already has a post', code: 'plan_taken' }, 409);
  // The plan's slot fills whatever the draft left empty.
  const filled = {
    ...d,
    scheduledAt: d.scheduledAt ?? plan.scheduled_at,
    platforms: d.platforms.length ? d.platforms : (() => { try { return JSON.parse(plan.platforms); } catch { return []; } })(),
  };
  const linked = 'EXISTS (SELECT 1 FROM social_plans WHERE id = ? AND post_id = ?)';
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE social_plans SET post_id = ?, updated_at = ? WHERE id = ? AND post_id IS NULL').bind(id, now, planId),
    { condition: linked, binds: [planId, id] },
    [insertPost(env.DB, id, draftColumns(filled), gate.user.id, agent, now, ` WHERE ${linked}`, [planId, id])],
    { userId: gate.user.id, action: 'social.post.create', targetType: 'social_post', targetId: id, details: { type: d.type, planId }, agent },
    now,
  );
  if (!done) return jsonResponse({ error: 'This plan already has a post', code: 'plan_taken' }, 409);
  return jsonResponse({ id, revision: 0 }, 201);
};

function insertPost(
  db: D1Database, id: string, cols: Record<string, unknown>, userId: string, agentTokenId: string | null, now: number, where: string, whereBinds: unknown[] = [],
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO social_posts (id, type, caption, caption_overrides, link, media, platforms, scheduled_at, status, revision, created_by, agent_token_id, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?, ?${where}`,
  ).bind(id, cols.type, cols.caption, cols.caption_overrides, cols.link, cols.media, cols.platforms, cols.scheduled_at, userId, agentTokenId, now, now, ...whereBinds);
}
