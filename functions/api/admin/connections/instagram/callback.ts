import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeInstagramCode, longLivedInstagramToken, instagramMe, isProfessional, IG_SCOPES } from '../../../../_lib/social/instagram';

/**
 * Finishes "Connect Instagram". Every way out is a redirect back to the
 * panel with ?connected=instagram or ?connection_error=<code>. Nothing is
 * stored unless every check passes. A successful connect re-queues every
 * target that was waiting for one; the dispatcher's lateness rule decides
 * whether each still goes out on its own. Each also gets a clean retry
 * clock, so a long wait does not make its first transient error fatal.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'instagram') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'instagram', details }, now);

  // Instagram appends "#_" to the code in the redirect; it is not part of it.
  const code = url.searchParams.get('code')?.replace(/#_$/, '') ?? null;
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }

  const short = await exchangeInstagramCode(env, base, code);
  if (!short.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: short.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!IG_SCOPES.every((s) => short.permissions.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', permissions: short.permissions });
    return back(returnTo, 'connection_error=missing_scope');
  }
  const long = await longLivedInstagramToken(env, short.token);
  if (!long.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'long_lived', status: long.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  const me = await instagramMe(long.token);
  if (!me.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'me', status: me.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!isProfessional(me.accountType)) {
    await audit('connection.rejected', { reason: 'not_professional', accountType: me.accountType });
    return back(returnTo, 'connection_error=not_professional');
  }

  try {
    const upsert = await connectionUpsert(env, 'instagram', {
      accountId: me.userId, accountName: me.username, accessToken: long.token, refreshToken: null,
      scopes: short.permissions.join(','), expiresAt: now + long.expiresIn, refreshExpiresAt: null,
    }, user.id, now);
    const requeue = env.DB.prepare(
      `UPDATE social_post_targets SET status = 'queued', claimed_at = NULL, first_tried_at = NULL, attempts = 0, last_error = NULL WHERE platform = 'instagram' AND status = 'waiting_connection'`,
    );
    await runWithAudit(env.DB, [upsert, requeue], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'instagram',
      details: { account: me.username, accountType: me.accountType, scopes: short.permissions },
    }, now);
  } catch (err) {
    console.error('instagram connection store failed', err);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=instagram');
};
