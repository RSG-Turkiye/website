import type { Env } from '../../../_lib/auth';
import { runWithAudit } from '../../../_lib/audit';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { CLAIM_LEASE_SECONDS } from '../../../_lib/mail-queue';

/**
 * Cancels what is left of a mail-out. Letters already sent stay sent, and a
 * row the dispatcher has claimed within its lease is mid-send and left to
 * finish: deleting it would not stop the message, only its log row. A claim
 * past its lease belongs to an invocation that died, and the next tick would
 * pick it up, so it is dropped with the rest.
 */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request, env)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const id = String(params.id);
  const campaign = await env.DB.prepare('SELECT sender_user_id FROM mail_campaigns WHERE id = ?')
    .bind(id).first<{ sender_user_id: string }>();
  // Someone else's campaign answers the same as a missing one.
  if (!campaign || (campaign.sender_user_id !== user.id && user.is_admin !== 1)) {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  const stale = now - CLAIM_LEASE_SECONDS;
  const pending = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM scheduled_emails WHERE campaign_id = ? AND (claimed_at IS NULL OR claimed_at <= ?)',
  ).bind(id, stale).first<{ n: number }>();
  const dropped = pending?.n ?? 0;

  await runWithAudit(env.DB, [
    env.DB.prepare('DELETE FROM scheduled_emails WHERE campaign_id = ? AND (claimed_at IS NULL OR claimed_at <= ?)').bind(id, stale),
    env.DB.prepare('UPDATE mail_campaigns SET cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ?').bind(now, id),
  ], {
    userId: user.id, action: 'mail.campaign.cancel', targetType: 'mail_campaign', targetId: id,
    details: { dropped },
  }, now);

  return jsonResponse({ ok: true, dropped });
};
