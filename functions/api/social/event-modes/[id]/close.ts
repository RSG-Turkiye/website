import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { socialGate, nowSeconds } from '../../../../_lib/social-api';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'publish', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const now = nowSeconds();
  const exists = await env.DB.prepare('SELECT 1 FROM social_event_modes WHERE id = ?').bind(id).first();
  if (!exists) return jsonResponse({ error: 'Not found' }, 404);
  // Event rows have no per-write nonce column, so the proof is "no close audit row exists yet".
  // Only the write that closed the row finds none: a losing writer sees the winner's audit row.
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE social_event_modes SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL').bind(now, gate.user.id, id),
    {
      condition: `EXISTS (SELECT 1 FROM social_event_modes WHERE id = ? AND closed_at = ? AND closed_by = ?)
        AND NOT EXISTS (SELECT 1 FROM audit_log WHERE action = 'social.event.close' AND target_id = ?)`,
      binds: [id, now, gate.user.id, id],
    },
    [],
    { userId: gate.user.id, action: 'social.event.close', targetType: 'social_event_mode', targetId: id },
    now,
  );
  if (!done) return jsonResponse({ error: 'Already closed', code: 'already_closed' }, 409);
  return jsonResponse({ ok: true });
};
