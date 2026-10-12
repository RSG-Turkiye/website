import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { appendAudit, verifyChain, type AuditRow } from '../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const rows = (await env.DB.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all<AuditRow>()).results;
  const result = await verifyChain(rows);
  await appendAudit(env.DB, { userId: user.id, action: 'audit.verify', details: result });
  return jsonResponse(result);
};
