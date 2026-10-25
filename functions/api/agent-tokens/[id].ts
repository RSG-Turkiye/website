/**
 * Revoking an agent token: its owner, or anyone with a live admin grant.
 * Session only, like the list (index.ts). The token is refused from the next
 * request on, since authenticateAgent reads revoked_at every time.
 */
import { checkCsrf, jsonResponse, type Env } from '../../_lib/auth';
import { runGuardedWithAudit } from '../../_lib/audit';
import { fail } from '../../_lib/cms-api';
import { COLUMNS, tokenCaller, tokenJson, unauthenticated, type TokenRow } from './index';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return fail(403, 'csrf', 'Forbidden');
  const caller = await tokenCaller(request, env);
  if (!caller) return unauthenticated();
  const { user, admin, now } = caller;

  const id = String(params.id ?? '');
  const row = await env.DB.prepare(`SELECT ${COLUMNS} FROM agent_tokens WHERE id = ?`).bind(id).first<TokenRow>();
  if (!row) return fail(404, 'not_found', 'No such token');
  const own = row.user_id === user.id;
  if (!own && !admin) return fail(403, 'forbidden', 'Forbidden');
  if (row.revoked_at !== null) return fail(409, 'already_revoked', 'This token is already revoked');

  const reason = own ? 'member' : 'admin';
  const update = env.DB.prepare(
    'UPDATE agent_tokens SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND revoked_at IS NULL',
  ).bind(now, user.id, reason, id);
  // The proof is this caller's revoke at this second; a lost race leaves no log row.
  const revoked = await runGuardedWithAudit(env.DB, update, {
    condition: 'EXISTS (SELECT 1 FROM agent_tokens WHERE id = ? AND revoked_at = ? AND revoked_by = ?)', binds: [id, now, user.id],
  }, [], { userId: user.id, action: 'agent_token.revoke', targetType: 'agent_token', targetId: id, details: { reason } }, now);
  if (!revoked) return fail(409, 'already_revoked', 'This token is already revoked');

  return jsonResponse({ token: tokenJson({ ...row, revoked_at: now, revoke_reason: reason }, now) });
};
