import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { isPlatform, disconnectStatement } from '../../../_lib/connections';
import { runWithAudit } from '../../../_lib/audit';
import { resetAccessToken } from '../../../_lib/gmail';

/** For Gmail this drops the stored token; mail falls back to the GMAIL_REFRESH_TOKEN secret if it is still set. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request, env)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const platform = params.platform;
  if (!isPlatform(platform)) return jsonResponse({ error: 'Unknown platform', code: 'unknown_platform' }, 400);

  await runWithAudit(env.DB, [disconnectStatement(env.DB, platform)], {
    userId: user.id, action: 'connection.disconnect', targetType: 'connection', targetId: platform,
  });
  if (platform === 'gmail') resetAccessToken();
  return jsonResponse({ ok: true });
};
