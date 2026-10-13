import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert, requeueWaitingStatement } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeLinkedinCode, findAdminOrganization, LI_SCOPES } from '../../../../_lib/social/linkedin';

/**
 * Finishes "Connect LinkedIn". Every way out is a redirect back to the panel
 * with ?connected=linkedin or ?connection_error=<code>; nothing is stored
 * unless every check passes, including that the member administers the Page
 * named by LINKEDIN_ORGANIZATION. A successful connect re-queues waiting
 * LinkedIn targets with a clean retry clock (see requeueWaitingStatement).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'linkedin') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'linkedin', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }
  const tokens = await exchangeLinkedinCode(env, base, code);
  if (!tokens.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokens.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!LI_SCOPES.every((s) => tokens.scopes.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', scopes: tokens.scopes });
    return back(returnTo, 'connection_error=missing_scope');
  }
  const org = await findAdminOrganization(tokens.accessToken, env.LINKEDIN_ORGANIZATION ?? '');
  if (!org.ok) {
    await audit('connection.rejected', { reason: org.reason, status: org.status });
    return back(returnTo, `connection_error=${org.reason === 'not_admin' ? 'not_page_admin' : 'lookup_failed'}`);
  }

  try {
    const upsert = await connectionUpsert(env, 'linkedin', {
      accountId: org.id, accountName: org.name, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      scopes: tokens.scopes.join(','), expiresAt: now + tokens.expiresIn,
      refreshExpiresAt: tokens.refreshToken && tokens.refreshExpiresIn ? now + tokens.refreshExpiresIn : null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert, requeueWaitingStatement(env.DB, 'linkedin')], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'linkedin',
      details: { account: org.name, scopes: tokens.scopes, refreshToken: Boolean(tokens.refreshToken) },
    }, now);
  } catch (err) {
    console.error('linkedin connection store failed', err);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=linkedin');
};
