import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { gmailRedirectUri, expectedGmailAccount, hasRequiredScopes, revokeGrant } from '../../../../_lib/gmail-oauth';
import { connectionUpsert } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { resetAccessToken } from '../../../../_lib/gmail';

/**
 * Finishes "Reconnect Gmail". Every way out is a redirect back to the panel
 * with either ?connected=gmail or ?connection_error=<code>; the panel turns
 * the code into a sentence. Nothing is stored unless every check passes, so a
 * failed reconnect leaves the working connection exactly as it was.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'gmail') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');

  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'gmail', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: gmailRedirectUri(base),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokenRes.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  const tokens = await tokenRes.json<{ access_token: string; refresh_token?: string; scope?: string }>();

  if (!tokens.refresh_token) {
    await audit('connection.rejected', { reason: 'no_refresh_token' });
    return back(returnTo, 'connection_error=no_refresh_token');
  }
  const scope = tokens.scope ?? '';
  if (!hasRequiredScopes(scope)) {
    await revokeGrant(tokens.refresh_token);
    await audit('connection.rejected', { reason: 'missing_scope', scope });
    return back(returnTo, 'connection_error=missing_scope');
  }

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const info = infoRes.ok ? await infoRes.json<{ email?: string }>() : {};
  const account = (info.email ?? '').toLowerCase();
  if (!account || account !== expectedGmailAccount(env)) {
    await revokeGrant(tokens.refresh_token);
    await audit('connection.rejected', { reason: 'wrong_account', account });
    return back(returnTo, 'connection_error=wrong_account');
  }

  try {
    const upsert = await connectionUpsert(env, 'gmail', {
      accountId: null, accountName: account, accessToken: null, refreshToken: tokens.refresh_token,
      scopes: scope, expiresAt: null, refreshExpiresAt: null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'gmail',
      details: { account, scopes: scope.split(' ') },
    }, now);
  } catch {
    // Google already issued the grant. Without a stored copy nobody can use it, so drop it.
    await revokeGrant(tokens.refresh_token);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  resetAccessToken();
  return back(returnTo, 'connected=gmail');
};
