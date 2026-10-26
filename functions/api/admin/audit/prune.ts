import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runWithAudit, AUDIT_RETENTION_SECONDS } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';
import { firstBucketOfDay } from '../../../_lib/agent-limits';

/**
 * Called nightly by workers/symposium-cron with the same secret as the
 * certificate purge. Removes rows older than a year, expired agent rate
 * counters (every day before today), long-dead agent tokens, expired OAuth
 * codes and self-registered OAuth clients nobody used. The chain stays
 * verifiable: verifyChain accepts a first row that links to a removed one and
 * reports it as anchoredAfterPrune.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - AUDIT_RETENTION_SECONDS;
  // Agent counters of earlier UTC days (their keys sort before today's, so
  // this is a primary-key range), and agent tokens revoked or
  // expired over a year ago (their audit rows have gone with them by now).
  // Counted first, then deleted in the same batch as the audit.prune row, so
  // nothing is deleted without its record. The counts are exact: no row
  // newly matches these conditions in between.
  // OAuth: codes past their expiry, and registered (DCR) clients over a day
  // old that no connection and no code names. The clients go first in the
  // batch, so their count is exact: a client whose only reference is a dead
  // code or token deleted below goes the next night.
  const unusedClient = (since: string) => `created_at < ${since} AND NOT EXISTS (SELECT 1 FROM agent_tokens t WHERE t.client_id = oauth_clients.id)
    AND NOT EXISTS (SELECT 1 FROM oauth_codes c WHERE c.client_id = oauth_clients.id)`;
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM audit_log WHERE at < ?1) AS deleted,
            (SELECT COUNT(*) FROM agent_counters WHERE bucket < ?2) AS agentCounters,
            (SELECT COUNT(*) FROM agent_tokens WHERE revoked_at < ?1 OR expires_at < ?1) AS agentTokens,
            (SELECT COUNT(*) FROM oauth_codes WHERE expires_at < ?3) AS oauthCodes,
            (SELECT COUNT(*) FROM oauth_clients WHERE ${unusedClient('?4')}) AS oauthClients`,
  ).bind(cutoff, firstBucketOfDay(now), now, now - 86400)
    .first<{ deleted: number; agentCounters: number; agentTokens: number; oauthCodes: number; oauthClients: number }>();
  const deleted = Number(counts?.deleted ?? 0);
  const agentCounters = Number(counts?.agentCounters ?? 0);
  const agentTokens = Number(counts?.agentTokens ?? 0);
  const oauthCodes = Number(counts?.oauthCodes ?? 0);
  const oauthClients = Number(counts?.oauthClients ?? 0);
  await runWithAudit(env.DB, [
    env.DB.prepare(`DELETE FROM oauth_clients WHERE ${unusedClient('?')}`).bind(now - 86400),
    env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM agent_counters WHERE bucket < ?').bind(firstBucketOfDay(now)),
    env.DB.prepare('DELETE FROM agent_tokens WHERE revoked_at < ? OR expires_at < ?').bind(cutoff, cutoff),
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
  ], { userId: null, action: 'audit.prune', details: { deleted, cutoff, agentCounters, agentTokens, oauthCodes, oauthClients } }, now);
  return jsonResponse({ ok: true, deleted });
};
