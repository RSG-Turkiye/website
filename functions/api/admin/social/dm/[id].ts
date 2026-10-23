/** One DM conversation, fetched live from Instagram; opening it marks it read for the whole team. */
import type { Env } from '../../../../_lib/auth';
import { appendAudit } from '../../../../_lib/audit';
import { getSessionUser, jsonResponse, canSocialPublish } from '../../../../_lib/auth';
import { markBroken } from '../../../../_lib/connections';
import { usableToken } from '../../../../_lib/social/tokens';
import { instagramDm } from '../../../../_lib/social/instagram-dm';
import type { DmThreadRow } from '../../../../_lib/social-dm';
import { dmStatus } from '../../../../_lib/social-dm-poll';
import { threadOut } from './index';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const id = String(params.id ?? '');
  const row = await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE id = ?`).bind(id).first<DmThreadRow>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  const now = Math.floor(Date.now() / 1000);
  await appendAudit(env.DB, { userId: user.id, action: 'read.dm_thread', targetType: 'dm_thread', targetId: id }, now);
  if (row.last_inbound_at) {
    await env.DB.prepare(`UPDATE social_dm_threads SET read_at = ?, read_by = ? WHERE id = ?`).bind(now, user.id, id).run();
    row.read_at = now;
  }
  // Without the messaging scope Meta's refusal reads as 'auth'; never reach it (R6).
  if (await dmStatus(env, now) !== 'ok') return jsonResponse({ thread: threadOut(row, now), messages: null, error: 'connection' });
  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return jsonResponse({ thread: threadOut(row, now), messages: null, error: 'connection' });
  const th = await instagramDm.thread(tok.token, row.conversation_id, tok.account);
  if (!th.ok) {
    if (th.kind === 'auth') await markBroken(env.DB, 'instagram', th.reason, now);
    return jsonResponse({ thread: threadOut(row, now), messages: null, error: th.kind });
  }
  return jsonResponse({
    thread: threadOut(row, now),
    messages: th.messages.map((m) => ({ id: m.id, at: m.at, mine: m.mine, text: m.text, attachments: m.attachments })),
  });
};
