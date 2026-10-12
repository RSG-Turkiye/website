import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { rowToDraft, readinessProblems, mediaDims, updatePostGuarded, targetStatements, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

/** Re-checks everything against now: a request approved late must not schedule into the past. */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (row.status !== 'pending_approval') return lostRace();
  const draft = rowToDraft(row);
  const problems = readinessProblems(draft, await mediaDims(env.DB, draft.media.map((m) => m.key)), now);
  if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);

  const newRevision = revision + 1;
  const nonce = crypto.randomUUID();
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, { status: 'scheduled', approved_by: gate.user.id, approved_at: now, review_note: null }, now, ['pending_approval']),
    { condition: POST_PROOF, binds: [id, nonce] },
    targetStatements(env.DB, id, nonce, draft.platforms),
    { userId: gate.user.id, action: 'social.post.approve', targetType: 'social_post', targetId: id },
    now,
  );
  if (!done) return lostRace();
  notifyLater(ctx, env, request, 'approved', row, 'author');
  return jsonResponse({ ok: true, revision: newRevision, status: 'scheduled' });
};
