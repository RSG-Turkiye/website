import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { PLATFORMS, connectionStatus, connectionExpiry, isBufferRow, withLiveExpiry, type ConnectionRow } from '../../../_lib/connections';
import { appendAudit } from '../../../_lib/audit';

type Row = ConnectionRow & { connected_by_email: string | null; connected_by_name: string | null };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const rows = (await env.DB.prepare(
    `SELECT c.*, u.email AS connected_by_email, p.display_name AS connected_by_name
       FROM platform_connections c
       LEFT JOIN users u ON u.id = c.connected_by
       LEFT JOIN profiles p ON p.user_id = c.connected_by`,
  ).all<Row>()).results;
  const legacyGmail = Boolean(env.GMAIL_REFRESH_TOKEN);

  const connections = PLATFORMS.map((platform) => {
    const row = withLiveExpiry(rows.find((r) => r.platform === platform) ?? null, env);
    const viaBuffer = isBufferRow(row);
    // A Buffer row stores no token, but it is a connection that can be removed.
    const hasStoredToken = Boolean(row?.refresh_token_enc || row?.access_token_enc) || viaBuffer;
    return {
      platform,
      status: connectionStatus(row, now, platform === 'gmail' && legacyGmail),
      accountName: row?.account_name ?? null,
      connectedBy: row?.connected_by_name || row?.connected_by_email || null,
      connectedAt: row?.connected_at ?? null,
      lastOkAt: row?.last_ok_at ?? null,
      lastError: row?.last_error ?? null,
      expiresAt: connectionExpiry(row),
      usesLegacySecret: platform === 'gmail' && legacyGmail && !hasStoredToken,
      hasStoredToken,
      via: viaBuffer ? 'buffer' : null,
    };
  });

  await appendAudit(env.DB, { userId: user.id, action: 'read.connections' }, now);
  return jsonResponse({ connections });
};
