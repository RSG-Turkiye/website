import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert, requeueWaitingStatement } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeXCode, pkceVerifier, xMe, X_SCOPES } from '../../../../_lib/social/x';

/** Finishes "Connect X". Same shape as Instagram's and LinkedIn's: a redirect with ?connected=x or ?connection_error=<code>, nothing stored unless every check passes. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!state || !consumed || consumed.platform !== 'x') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'x', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }
  const tokens = await exchangeXCode(env, base, code, await pkceVerifier(env.X_CLIENT_SECRET ?? '', state));
  if (!tokens.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokens.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!X_SCOPES.every((s) => tokens.scopes.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', scopes: tokens.scopes });
    return back(returnTo, 'connection_error=missing_scope');
  }
  if (!tokens.refreshToken) {
    await audit('connection.rejected', { reason: 'no_refresh_token' });
    return back(returnTo, 'connection_error=no_refresh_token');
  }
  const me = await xMe(tokens.accessToken);
  if (!me.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'me', status: me.status });
    return back(returnTo, 'connection_error=token_exchange');
  }

  try {
    const upsert = await connectionUpsert(env, 'x', {
      accountId: me.id, accountName: me.username, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      scopes: tokens.scopes.join(','), expiresAt: now + tokens.expiresIn, refreshExpiresAt: null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert, requeueWaitingStatement(env.DB, 'x')], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'x', details: { account: me.username, scopes: tokens.scopes },
    }, now);
  } catch (err) {
    console.error('x connection store failed', err);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=x');
};
