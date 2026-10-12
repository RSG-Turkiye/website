import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { appendAudit, toCsv, type AuditRow } from '../../../_lib/audit';
import { auditFilters, AUDIT_SELECT } from '../../../_lib/audit-query';

const MAX_ROWS = 50_000;

/**
 * Logged BEFORE the rows are read, so the file contains the record of its own
 * export. JSON is the verifiable format (exact cell text); CSV is for reading.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const params = new URL(request.url).searchParams;
  const format = params.get('format') === 'json' ? 'json' : 'csv';
  const { where, binds } = auditFilters(params);
  await appendAudit(env.DB, {
    userId: user.id, action: 'audit.export',
    details: { format, filters: Object.fromEntries([...params].filter(([k]) => k !== 'format')) },
  });
  const rows = (await env.DB.prepare(`${AUDIT_SELECT} ${where} ORDER BY a.seq ASC LIMIT ?`)
    .bind(...binds, MAX_ROWS).all<AuditRow & { user_email: string | null }>()).results;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const body = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
  return new Response(body, {
    headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rsg-audit-${stamp}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
};
