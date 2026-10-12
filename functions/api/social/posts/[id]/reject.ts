import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { updatePostGuarded, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, body, revision, now } = prep.value;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 1 || note.length > 500) return jsonResponse({ error: 'A note of 1-500 characters is required', code: 'invalid_note' }, 400);
  if (row.status !== 'pending_approval') return jsonResponse({ error: 'This post is not waiting for approval', code: 'not_pending' }, 409);
  const newRevision = revision + 1;
  const nonce = crypto.randomUUID();
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, { status: 'rejected', review_note: note }, now, ['pending_approval']),
    { condition: POST_PROOF, binds: [id, nonce] },
    [],
    { userId: gate.user.id, action: 'social.post.reject', targetType: 'social_post', targetId: id, details: { note } },
    now,
  );
  if (!done) return lostRace();
  notifyLater(ctx, env, request, 'rejected', row, 'author', { note });
  return jsonResponse({ ok: true, revision: newRevision, status: 'rejected' });
};
