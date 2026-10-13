import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { getConnection, readAccessToken, readRefreshToken, markBroken, connectionStatus, tokenContext, requeueWaitingStatement } from '../../../_lib/connections';
import { seal } from '../../../_lib/token-vault';
import { appendAudit } from '../../../_lib/audit';
import { refreshInstagramToken, needsRefresh } from '../../../_lib/social/instagram';
import { refreshLinkedinToken } from '../../../_lib/social/linkedin';
import { refreshXOnUse } from '../../../_lib/social/x';
import { notificationText, notifyEach, adminEmails } from '../../../_lib/social-notify';

/**
 * Daily (workers/symposium-cron). Instagram tokens live 60 days and can only
 * be refreshed while still valid, so a token with under 20 days left is
 * renewed here. A refusal marks the connection broken and tells the admins
 * at once, while there is still time to reconnect before posts start waiting.
 * LinkedIn is renewed from its refresh token, or reminded about (see below).
 */
async function refreshInstagram(env: Env, now: number, panelUrl: string): Promise<boolean> {
  const row = await getConnection(env.DB, 'instagram');
  if (!row || !needsRefresh(row, now)) return false;
  const token = await readAccessToken(env, row);
  const result = token ? await refreshInstagramToken(token) : { ok: false as const, status: 0, auth: true, reason: 'stored token unreadable' };
  if (result.ok) {
    const sealed = await seal(env.TOKEN_ENC_KEY, result.token, tokenContext('instagram', 'access'));
    await env.DB.prepare(
      `UPDATE platform_connections SET access_token_enc = ?, expires_at = ?, last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE platform = 'instagram'`,
    ).bind(sealed, now + result.expiresIn, now).run();
    await requeueWaitingStatement(env.DB, 'instagram').run();
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh', targetType: 'connection', targetId: 'instagram', details: { expiresAt: now + result.expiresIn } }, now);
    return true;
  }
  // A transient failure (network, 5xx) must not stop publishing for a day: leave
  // the connection alone and let tomorrow's run retry, unless the token is about
  // to become unrefreshable.
  const transient = !result.auth;
  if (transient) {
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'instagram', details: { status: result.status, reason: result.reason, transient: true } }, now);
    if (row.expires_at === null || row.expires_at - now >= 3 * 86400) return false;
  }
  const wasBroken = connectionStatus(row, now) === 'broken';
  await markBroken(env.DB, 'instagram', `refresh: ${result.reason}`, now);
  if (!transient) await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'instagram', details: { status: result.status, reason: result.reason } }, now);
  if (!wasBroken) {
    await notifyEach(env, await adminEmails(env.DB), notificationText('connection_broken', { label: 'Instagram', when: null, note: result.reason, panelUrl }));
  }
  return false;
}

const LINKEDIN_REFRESH_BEFORE = 20 * 86400;
const REMIND_DAYS = [14, 7, 3, 1];

/**
 * LinkedIn: with a refresh token, the access token (60 days) is renewed
 * inside its last 20 days; the refresh token itself lasts a year from the
 * first connect, and the admins are reminded before it ends. Without one
 * (the app was not granted programmatic refresh), only the reminders.
 */
async function refreshLinkedin(env: Env, now: number, panelUrl: string): Promise<'refreshed' | 'reminded' | 'none'> {
  const row = await getConnection(env.DB, 'linkedin');
  if (!row?.access_token_enc || row.expires_at === null) return 'none';
  const mailAdmins = async (kind: 'connection_expiring' | 'connection_broken', note: string) =>
    notifyEach(env, await adminEmails(env.DB), notificationText(kind, { label: 'LinkedIn', when: null, note, panelUrl, platform: 'LinkedIn' }));

  let refreshed = false;
  let refreshEnd = row.refresh_expires_at;
  if (row.refresh_token_enc && row.expires_at - now < LINKEDIN_REFRESH_BEFORE) {
    let refresh: string | null = null;
    try { refresh = await readRefreshToken(env, row); } catch { refresh = null; }
    const result = refresh ? await refreshLinkedinToken(env, refresh) : { ok: false as const, status: 0, auth: true, reason: 'stored token unreadable' };
    if (result.ok) {
      const access = await seal(env.TOKEN_ENC_KEY, result.accessToken, tokenContext('linkedin', 'access'));
      const newRefresh = result.refreshToken ? await seal(env.TOKEN_ENC_KEY, result.refreshToken, tokenContext('linkedin', 'refresh')) : row.refresh_token_enc;
      await env.DB.prepare(
        `UPDATE platform_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at),
                last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE platform = 'linkedin'`,
      ).bind(access, newRefresh, now + result.expiresIn, result.refreshExpiresIn ? now + result.refreshExpiresIn : null, now).run();
      await requeueWaitingStatement(env.DB, 'linkedin').run();
      await appendAudit(env.DB, { userId: null, action: 'connection.refresh', targetType: 'connection', targetId: 'linkedin', details: { expiresAt: now + result.expiresIn } }, now);
      refreshed = true;
      if (result.refreshExpiresIn) refreshEnd = now + result.refreshExpiresIn;
    } else {
      await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'linkedin', details: { status: result.status, reason: result.reason, transient: !result.auth } }, now);
      if (result.auth || row.expires_at - now < 3 * 86400) {
        const wasBroken = connectionStatus(row, now) === 'broken';
        await markBroken(env.DB, 'linkedin', `refresh: ${result.reason}`, now);
        if (!wasBroken) await mailAdmins('connection_broken', result.reason);
        return 'none';
      }
    }
  }

  // Independent of the refresh above: a refresh-token end that falls on a reminder day still mails.
  const end = row.refresh_token_enc ? refreshEnd : row.expires_at;
  if (end === null) return refreshed ? 'refreshed' : 'none';
  const daysLeft = Math.ceil((end - now) / 86400);
  if (!REMIND_DAYS.includes(daysLeft)) return refreshed ? 'refreshed' : 'none';
  await mailAdmins('connection_expiring', String(daysLeft));
  await appendAudit(env.DB, { userId: null, action: 'connection.expiry_reminder', targetType: 'connection', targetId: 'linkedin', details: { daysLeft } }, now);
  return refreshed ? 'refreshed' : 'reminded';
}

/**
 * X: renew the access token every day, even when it is still fresh, so the
 * refresh token stays in use on days nothing is posted. A refusal marks X
 * broken (refreshXOnUse does that) and mails the admins.
 */
async function keepXAlive(env: Env, now: number, panelUrl: string): Promise<'refreshed' | 'none'> {
  const row = await getConnection(env.DB, 'x');
  if (!row?.refresh_token_enc || !row.account_id || connectionStatus(row, now) === 'broken') return 'none';
  const u = await refreshXOnUse(env, row, now);
  if (u.ok) {
    await requeueWaitingStatement(env.DB, 'x').run();
    return 'refreshed';
  }
  if (u.why === 'broken' && u.justBroke) {
    await notifyEach(env, await adminEmails(env.DB), notificationText('connection_broken', { label: 'X', when: null, note: u.reason ?? '', panelUrl, platform: 'X' }));
  }
  return 'none';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const panelUrl = `${new URL(request.url).origin}/admin`;
  // One platform's failure must not hide another's result or fail the cron call.
  const refreshed = await refreshInstagram(env, now, panelUrl).catch((err) => { console.error('instagram refresh failed', err); return false; });
  const linkedin = await refreshLinkedin(env, now, panelUrl).catch((err) => { console.error('linkedin refresh failed', err); return 'none' as const; });
  const x = await keepXAlive(env, now, panelUrl).catch((err) => { console.error('x refresh failed', err); return 'none' as const; });
  return jsonResponse({ ok: true, refreshed, linkedin, x });
};
