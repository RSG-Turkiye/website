/**
 * Answer a DM from the panel. Refused once 24 hours have passed since the
 * person's newest message (Meta would refuse it anyway), and checked again
 * against Meta's own answer. Audited with the actor and thread, never the text.
 */
import type { Env } from '../../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish, checkCsrf } from '../../../../../_lib/auth';
import { markBroken } from '../../../../../_lib/connections';
import { appendAudit } from '../../../../../_lib/audit';
import { usableToken } from '../../../../../_lib/social/tokens';
import { instagramDm } from '../../../../../_lib/social/instagram-dm';
import { dmView, MAX_REPLY_BYTES, type DmThreadRow } from '../../../../../_lib/social-dm';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const id = String(params.id ?? '');
  const row = await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE id = ?`).bind(id).first<DmThreadRow>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return jsonResponse({ error: 'Empty', code: 'empty' }, 400);
  if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES) return jsonResponse({ error: 'Too long', code: 'too_long' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const v = dmView(row, now);
  if (v.closesAt === null || v.expired) return jsonResponse({ error: 'Window closed', code: 'window_closed' }, 409);

  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return jsonResponse({ error: 'Connection', code: 'connection' }, 503);
  const sent = await instagramDm.send(tok.token, row.peer_id, text);
  if (!sent.ok) {
    if (sent.kind === 'window') return jsonResponse({ error: 'Window closed', code: 'window_closed' }, 409);
    if (sent.kind === 'auth') { await markBroken(env.DB, 'instagram', sent.reason, now); return jsonResponse({ error: 'Connection', code: 'connection' }, 503); }
    if (sent.kind === 'transient') return jsonResponse({ error: 'Unavailable', code: 'unavailable' }, 503);
    return jsonResponse({ error: 'Refused', code: 'refused' }, 422);
  }
  await env.DB.prepare(`UPDATE social_dm_threads SET last_outbound_at = ?, read_at = ?, read_by = ? WHERE id = ?`).bind(now, now, user.id, id).run();
  await appendAudit(env.DB, { userId: user.id, action: 'social.dm.reply', targetType: 'social_dm', targetId: id, details: { platform: 'instagram', bytes: new TextEncoder().encode(text).length } }, now);
  return jsonResponse({ ok: true });
};
