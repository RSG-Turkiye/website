import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { appendAudit, type AuditRow } from '../../../_lib/audit';
import { auditFilters, AUDIT_SELECT } from '../../../_lib/audit-query';

const PAGE = 100;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const { where, binds } = auditFilters(new URL(request.url).searchParams);
  const rows = (await env.DB.prepare(`${AUDIT_SELECT} ${where} ORDER BY a.seq DESC LIMIT ?`)
    .bind(...binds, PAGE + 1).all<AuditRow & { user_email: string | null }>()).results;
  // Logged after the read, so this page does not show its own viewing.
  await appendAudit(env.DB, { userId: user.id, action: 'read.audit' });
  return jsonResponse({ rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE });
};
