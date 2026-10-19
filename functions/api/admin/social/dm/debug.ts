/**
 * Admin-only diagnosis for the DM inbox: what Instagram answers for the
 * connected account's conversation list, as it came back. Used when the poll
 * finds nothing although messages exist. Never returns the token: Graph's
 * paging links carry access_token in their query, so every such value is
 * replaced before the answer leaves the server.
 */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../../_lib/auth';
import { igGraph, type GraphResult } from '../../../../_lib/social/instagram';
import { usableToken } from '../../../../_lib/social/tokens';
import { getConnection, isBufferRow } from '../../../../_lib/connections';

export const redactTokens = (v: unknown): unknown =>
  JSON.parse(JSON.stringify(v ?? null).replace(/access_token=[^&"\\]*/g, 'access_token=REDACTED'));

const shape = (r: GraphResult) => (r.ok ? { ok: true, data: redactTokens(r.data) } : { ok: false, status: r.status, error: redactTokens(r.error) });

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const row = await getConnection(env.DB, 'instagram');
  // A Buffer row's token is the Buffer key: it must never reach graph.instagram.com.
  if (isBufferRow(row)) return jsonResponse({ token: 'via_buffer', scopes: row?.scopes ?? null });
  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return jsonResponse({ token: tok.why, scopes: row?.scopes ?? null });
  const id = tok.account.id;
  const [me, mine, byId, plain] = await Promise.all([
    igGraph('GET', 'me', tok.token, { fields: 'user_id,username,account_type' }),
    igGraph('GET', 'me/conversations', tok.token, { platform: 'instagram', fields: 'id,updated_time' }),
    igGraph('GET', `${id}/conversations`, tok.token, { platform: 'instagram', fields: 'id,updated_time,participants' }),
    igGraph('GET', 'me/conversations', tok.token, { platform: 'instagram' }),
  ]);
  return jsonResponse({
    account: { id, name: tok.account.name }, scopes: row?.scopes ?? null,
    me: shape(me), meConversations: shape(mine), idConversations: shape(byId), meConversationsNoFields: shape(plain),
  });
};
