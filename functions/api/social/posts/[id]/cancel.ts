import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace } from '../../../../_lib/social-actions';
import { canCancelPost, updatePostGuarded, targetStatements, startedTargets, unlinkPlanStatement, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'edit');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (!canCancelPost(gate.actor, row)) {
    return (row.created_by === gate.user.id || gate.actor.isPublisher)
      ? jsonResponse({ error: 'Only pending or scheduled posts can be cancelled', code: 'not_cancellable' }, 409)
      : jsonResponse({ error: 'You cannot cancel this post', code: 'not_allowed' }, 403);
  }
  if (await startedTargets(env.DB, id)) return jsonResponse({ error: 'Publishing has started', code: 'publishing_started' }, 409);
  const newRevision = revision + 1;
  const nonce = crypto.randomUUID();
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, { status: 'cancelled' }, now, ['pending_approval', 'scheduled']),
    { condition: POST_PROOF, binds: [id, nonce] },
    [...targetStatements(env.DB, id, nonce, null), unlinkPlanStatement(env.DB, id, nonce)],
    { userId: gate.user.id, action: 'social.post.cancel', targetType: 'social_post', targetId: id, details: { from: row.status } },
    now,
  );
  if (!done) return lostRace();
  return jsonResponse({ ok: true, revision: newRevision, status: 'cancelled' });
};
