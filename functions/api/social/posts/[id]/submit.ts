import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { rowToDraft, readinessProblems, mediaDims, statusOnSubmit, updatePostGuarded, targetStatements, POST_PROOF } from '../../../../_lib/social-posts';
import { coveringEvent } from '../../../../_lib/social-events';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'edit');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (row.created_by !== gate.user.id && !gate.actor.isPublisher) return jsonResponse({ error: 'You cannot submit this post', code: 'not_allowed' }, 403);
  if (row.status !== 'draft' && row.status !== 'rejected') return jsonResponse({ error: 'Only drafts can be submitted', code: 'not_submittable' }, 409);

  const draft = rowToDraft(row);
  const problems = readinessProblems(draft, await mediaDims(env.DB, draft.media.map((m) => m.key)), now);
  if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);

  const window = draft.type === 'story' && !gate.actor.isPublisher ? await coveringEvent(env.DB, gate.user.id, now) : null;
  // Covered only when the story goes out before the window closes.
  const event = window && draft.scheduledAt !== null && draft.scheduledAt < window.ends_at ? window : null;
  const status = statusOnSubmit(gate.actor, Boolean(event));
  const newRevision = revision + 1;
  const nonce = crypto.randomUUID();
  const fields = status === 'scheduled'
    ? { status, approved_by: gate.user.id, approved_at: now, event_mode_id: event?.id ?? null, review_note: null }
    : { status, review_note: null };
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, fields, now, ['draft', 'rejected']),
    { condition: POST_PROOF, binds: [id, nonce] },
    status === 'scheduled' ? targetStatements(env.DB, id, nonce, draft.platforms) : [],
    { userId: gate.user.id, action: 'social.post.submit', targetType: 'social_post', targetId: id, details: { status, eventModeId: event?.id ?? null } },
    now,
  );
  if (!done) return lostRace();
  if (status === 'pending_approval') notifyLater(ctx, env, request, 'submitted', row, 'publishers', { actor: row.author_email ?? '' });
  return jsonResponse({ ok: true, revision: newRevision, status });
};
