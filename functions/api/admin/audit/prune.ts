import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runWithAudit, AUDIT_RETENTION_SECONDS } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';
import { firstBucketOfDay } from '../../../_lib/agent-limits';

/**
 * Called nightly by workers/symposium-cron with the same secret as the
 * certificate purge. Removes rows older than a year, expired agent rate
 * counters (every day before today) and long-dead agent tokens. The chain stays
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
  const counts = await env.DB.prepare(
    `SELECT (SELECT COUNT(*) FROM audit_log WHERE at < ?1) AS deleted,
            (SELECT COUNT(*) FROM agent_counters WHERE bucket < ?2) AS agentCounters,
            (SELECT COUNT(*) FROM agent_tokens WHERE revoked_at < ?1 OR expires_at < ?1) AS agentTokens`,
  ).bind(cutoff, firstBucketOfDay(now)).first<{ deleted: number; agentCounters: number; agentTokens: number }>();
  const deleted = Number(counts?.deleted ?? 0);
  const agentCounters = Number(counts?.agentCounters ?? 0);
  const agentTokens = Number(counts?.agentTokens ?? 0);
  await runWithAudit(env.DB, [
    env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(cutoff),
    env.DB.prepare('DELETE FROM agent_counters WHERE bucket < ?').bind(firstBucketOfDay(now)),
    env.DB.prepare('DELETE FROM agent_tokens WHERE revoked_at < ? OR expires_at < ?').bind(cutoff, cutoff),
  ], { userId: null, action: 'audit.prune', details: { deleted, cutoff, agentCounters, agentTokens } }, now);
  return jsonResponse({ ok: true, deleted });
};
