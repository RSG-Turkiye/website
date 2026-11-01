import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { runWithAudit } from '../../_lib/audit';
import { guideGate, fail, readBody } from '../../_lib/guide-api';

/** POST { url, muted }: stop (or restart) watching one announcement page that keeps raising false alarms. Approvers only. */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  const url = typeof body?.url === 'string' ? body.url : '';
  if (!url || typeof body?.muted !== 'boolean') return fail(400, 'bad_request', 'Expected { url, muted }');
  const row = await env.DB.prepare('SELECT url FROM guide_page_watch WHERE url = ?').bind(url).first();
  if (!row) return fail(404, 'not_found', 'This page is not watched');
  await runWithAudit(env.DB, [env.DB.prepare('UPDATE guide_page_watch SET muted = ? WHERE url = ?').bind(body.muted ? 1 : 0, url)],
    { userId: gate.user.id, action: 'guide.watch.mute', targetType: 'guide_page', targetId: url, details: { muted: body.muted } }, gate.now);
  return jsonResponse({ ok: true });
};
