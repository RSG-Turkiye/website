import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { appendAudit, AUDIT_RETENTION_SECONDS } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';

/**
 * Called nightly by workers/symposium-cron with the same secret as the
 * certificate purge. Removes rows older than a year. The chain stays
 * verifiable: verifyChain accepts a first row that links to a removed one and
 * reports it as anchoredAfterPrune.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - AUDIT_RETENTION_SECONDS;
  const result = await env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(cutoff).run();
  const deleted = Number(result.meta.changes ?? 0);
  await appendAudit(env.DB, { userId: null, action: 'audit.prune', details: { deleted, cutoff } }, now);
  return jsonResponse({ ok: true, deleted });
};
