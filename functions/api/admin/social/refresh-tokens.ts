import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { getConnection, readAccessToken, markBroken, connectionStatus, tokenContext } from '../../../_lib/connections';
import { seal } from '../../../_lib/token-vault';
import { appendAudit } from '../../../_lib/audit';
import { refreshInstagramToken, needsRefresh } from '../../../_lib/social/instagram';
import { notificationText, notifyEach, adminEmails } from '../../../_lib/social-notify';

/**
 * Daily (workers/symposium-cron). Instagram tokens live 60 days and can only
 * be refreshed while still valid, so a token with under 20 days left is
 * renewed here. A refusal marks the connection broken and tells the admins
 * at once, while there is still time to reconnect before posts start waiting.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await getConnection(env.DB, 'instagram');
  if (!row || !needsRefresh(row, now)) return jsonResponse({ ok: true, refreshed: false });
  const token = await readAccessToken(env, row);
  const result = token ? await refreshInstagramToken(token) : { ok: false as const, status: 0, auth: true, reason: 'stored token unreadable' };
  if (result.ok) {
    const sealed = await seal(env.TOKEN_ENC_KEY, result.token, tokenContext('instagram', 'access'));
    await env.DB.prepare(
      `UPDATE platform_connections SET access_token_enc = ?, expires_at = ?, last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE platform = 'instagram'`,
    ).bind(sealed, now + result.expiresIn, now).run();
    await env.DB.prepare(
      `UPDATE social_post_targets SET status = 'queued', claimed_at = NULL, first_tried_at = NULL, attempts = 0, last_error = NULL WHERE platform = 'instagram' AND status = 'waiting_connection'`,
    ).run();
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh', targetType: 'connection', targetId: 'instagram', details: { expiresAt: now + result.expiresIn } }, now);
    return jsonResponse({ ok: true, refreshed: true });
  }
  // A transient failure (network, 5xx) must not stop publishing for a day: leave
  // the connection alone and let tomorrow's run retry, unless the token is about
  // to become unrefreshable.
  const transient = !result.auth;
  if (transient) {
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'instagram', details: { status: result.status, reason: result.reason, transient: true } }, now);
    if (row.expires_at === null || row.expires_at - now >= 3 * 86400) return jsonResponse({ ok: true, refreshed: false });
  }
  const wasBroken = connectionStatus(row, now) === 'broken';
  await markBroken(env.DB, 'instagram', `refresh: ${result.reason}`, now);
  if (!transient) await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'instagram', details: { status: result.status, reason: result.reason } }, now);
  if (!wasBroken) {
    const panelUrl = `${new URL(request.url).origin}/admin`;
    await notifyEach(env, await adminEmails(env.DB), notificationText('connection_broken', { label: 'Instagram', when: null, note: result.reason, panelUrl }));
  }
  return jsonResponse({ ok: true, refreshed: false });
};
