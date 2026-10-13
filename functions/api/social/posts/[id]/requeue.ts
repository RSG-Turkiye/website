import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace } from '../../../../_lib/social-actions';
import { updatePostGuarded, POST_PROOF, type PostStatus } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

const FROM: PostStatus[] = ['scheduled', 'failed', 'partially_published'];

/**
 * "Publish anyway" for targets held by the lateness rule, and "Retry" for
 * failed ones (spec §5). Publishers only. The target is marked confirmed,
 * so the lateness rule does not hold it again; a failed one starts with a
 * clean slate (no attempts, no stale error). container_id is kept: if a
 * media_publish response was lost and the 2h window ran out, the container may
 * already be published, and the adapter re-reads its status instead of making
 * (and publishing) a second one.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  const waiting = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM social_post_targets WHERE post_id = ? AND status IN ('needs_confirmation','failed')`,
  ).bind(id).first<{ n: number }>();
  if (!FROM.includes(row.status) || !waiting?.n) {
    return jsonResponse({ error: 'Nothing to publish again', code: 'not_requeueable' }, 409);
  }
  const nonce = crypto.randomUUID();
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, { status: 'scheduled' }, now, FROM),
    { condition: POST_PROOF, binds: [id, nonce] },
    [env.DB.prepare(
      `UPDATE social_post_targets
          SET status = 'queued', confirmed_at = ?, claimed_at = NULL, attempts = 0, first_tried_at = NULL, last_error = NULL
        WHERE post_id = ? AND status IN ('needs_confirmation','failed') AND ${POST_PROOF}`,
    ).bind(now, id, id, nonce)],
    { userId: gate.user.id, action: 'social.post.requeue', targetType: 'social_post', targetId: id, details: { from: row.status, targets: waiting.n } },
    now,
  );
  if (!done) return lostRace();
  return jsonResponse({ ok: true, revision: revision + 1, status: 'scheduled' });
};
