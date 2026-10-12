import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canSeeAdminPanel } from '../../_lib/auth';
import { appendAudit } from '../../_lib/audit';

const PANE = /^[a-z][a-z-]{0,39}$/;

/**
 * Sent by the admin panel each time a pane is shown. Client-reported, so a
 * determined user can suppress it; the server-side read entries
 * (read.connections, read.audit) cannot be.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  let pane: unknown;
  try { pane = (await request.json() as { pane?: unknown }).pane; } catch { pane = undefined; }
  if (typeof pane !== 'string' || !PANE.test(pane)) return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);

  await appendAudit(env.DB, { userId: user.id, action: 'view.pane', targetType: 'pane', targetId: pane });
  return new Response(null, { status: 204 });
};
