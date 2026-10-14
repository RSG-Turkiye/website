/**
 * DM inbox list (spec §8): the conversations the poll has seen, newest
 * first, with their derived state. Publishers and admins only. The
 * platform's conversation id stays on the server; links use our own id.
 */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish } from '../../../../_lib/auth';
import { getConnection } from '../../../../_lib/connections';
import { dmView, type DmThreadRow } from '../../../../_lib/social-dm';
import { dmStatus } from '../../../../_lib/social-dm-poll';

export function threadOut(r: DmThreadRow, now: number) {
  const v = dmView(r, now);
  return {
    id: r.id, username: r.peer_username,
    lastInboundAt: r.last_inbound_at || null, lastOutboundAt: r.last_outbound_at || null,
    lastAt: Math.max(r.last_inbound_at ?? 0, r.last_outbound_at ?? 0),
    ...v,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const [status, ig, li] = await Promise.all([dmStatus(env, now), getConnection(env.DB, 'instagram'), getConnection(env.DB, 'linkedin')]);
  const rows = (await env.DB.prepare(
    `SELECT * FROM social_dm_threads WHERE platform = 'instagram'
     ORDER BY MAX(COALESCE(last_inbound_at, 0), COALESCE(last_outbound_at, 0)) DESC LIMIT 100`,
  ).all<DmThreadRow>()).results;
  return jsonResponse({
    status, account: ig?.account_name ?? null, linkedin: !!li?.access_token_enc,
    threads: rows.map((r) => threadOut(r, now)),
  });
};
