import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import {
  parseDraft, draftColumns, rowToDraft, canEditPost, canDeletePost, statusAfterEdit, readinessProblems, mediaDims,
  updatePostGuarded, targetStatements, startedTargets, POST_PROOF, type PostColumn,
} from '../../../_lib/social-posts';
import { coveringEvent } from '../../../_lib/social-events';
import { loadPost } from '../../../_lib/social-post-read';
import { notifyLater } from '../../../_lib/social-actions';
import { runGuardedWithAudit } from '../../../_lib/audit';

const revisionOf = (body: Record<string, unknown>) =>
  typeof body.revision === 'number' && Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const found = await loadPost(env.DB, env, String(params.id));
  return found ? jsonResponse(found.response) : jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
};

export const onRequestPatch: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const found = await loadPost(env.DB, env, id);
  if (!found) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  const { row } = found;
  if (!canEditPost(gate.actor, row)) return jsonResponse({ error: 'You cannot edit this post', code: 'not_allowed' }, 403);
  if (await startedTargets(env.DB, id)) return jsonResponse({ error: 'Publishing has started', code: 'publishing_started' }, 409);
  const body = await readBody(request);
  if (!body) return malformed();
  const revision = revisionOf(body);
  if (revision === null) return malformed();
  if (revision !== row.revision) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  const parsed = parseDraft(body);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid post', code: parsed.code }, 400);
  const next = parsed.value;
  const now = nowSeconds();

  // A story is covered only by a window that is still open at the time it is scheduled for.
  const window = next.type === 'story' && !gate.actor.isPublisher ? await coveringEvent(env.DB, gate.user.id, now) : null;
  const event = window && next.scheduledAt !== null && next.scheduledAt < window.ends_at ? window : null;
  const covered = event !== null;
  const status = statusAfterEdit(gate.actor, row.status, covered);
  if (status === 'scheduled') {
    const problems = readinessProblems(next, await mediaDims(env.DB, next.media.map((m) => m.key)), now);
    if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);
  }

  const before = rowToDraft(row);
  const changed = Object.fromEntries(
    (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]))
      .map((k) => [k, { from: before[k], to: next[k] }]),
  );
  const newRevision = revision + 1;
  const nonce = crypto.randomUUID();
  const fields: Partial<Record<PostColumn, unknown>> = { ...draftColumns(next), status };
  if (status === 'scheduled' && event) fields.event_mode_id = event.id;
  // Approval belongs to the version that was approved; a re-submission starts clean.
  if (row.status === 'scheduled' && status === 'pending_approval') Object.assign(fields, { approved_by: null, approved_at: null, event_mode_id: null });
  if (row.status === 'rejected' && status === 'draft') fields.review_note = null;
  const targets = status === 'scheduled'
    ? targetStatements(env.DB, id, nonce, next.platforms)
    : row.status === 'scheduled' ? targetStatements(env.DB, id, nonce, null) : [];
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, fields, now),
    { condition: POST_PROOF, binds: [id, nonce] },
    targets,
    { userId: gate.user.id, action: 'social.post.update', targetType: 'social_post', targetId: id, details: { changed, status: { from: row.status, to: status } } },
    now,
  );
  if (!done) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  if (row.status === 'scheduled' && status === 'pending_approval') {
    notifyLater(ctx, env, request, 'submitted', { ...row, caption: next.caption, scheduled_at: next.scheduledAt } as Parameters<typeof notifyLater>[4], 'publishers', { actor: (row as { author_email?: string | null }).author_email ?? '' });
  }
  return jsonResponse({ ok: true, revision: newRevision, status });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const found = await loadPost(env.DB, env, id);
  if (!found) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  const { row } = found;
  if (!canDeletePost(gate.actor, row)) {
    return (row.created_by === gate.user.id || gate.actor.isPublisher)
      ? jsonResponse({ error: 'Only drafts and sent-back posts can be deleted', code: 'not_deletable' }, 409)
      : jsonResponse({ error: 'You cannot delete this post', code: 'not_allowed' }, 403);
  }
  const body = await readBody(request);
  const revision = body ? revisionOf(body) : null;
  if (revision === null) return malformed();
  if (revision !== row.revision) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  // Known minor: two people deleting the same draft at once can both pass this
  // proof, logging the delete twice. Nothing else is affected.
  const gone = 'NOT EXISTS (SELECT 1 FROM social_posts WHERE id = ?)';
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`DELETE FROM social_posts WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`).bind(id, revision),
    { condition: gone, binds: [id] },
    [env.DB.prepare(`UPDATE social_plans SET post_id = NULL WHERE post_id = ? AND ${gone}`).bind(id, id)],
    { userId: gate.user.id, action: 'social.post.delete', targetType: 'social_post', targetId: id, details: { status: row.status } },
  );
  if (!done) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  return jsonResponse({ ok: true });
};
