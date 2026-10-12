import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';
import { triggerRebuild } from '../../../_lib/symposium';
import { organiser } from '../certificates';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT id, year FROM symposium_certificates WHERE id = ?')
    .bind(id).first<{ id: string; year: number }>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  await env.MAIL_ATTACHMENTS.delete(certKey(row.id));
  await env.DB.prepare('DELETE FROM symposium_certificates WHERE id = ?').bind(row.id).run();

  // The last one of its year: rebuild, or the symposium home page keeps
  // saying certificates are ready until the nightly build, and the button
  // leads to "none found". Any other single delete leaves the band true.
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM symposium_certificates WHERE year = ?')
    .bind(row.year).first<{ n: number }>();
  if ((left?.n ?? 0) === 0) return jsonResponse({ ok: true, rebuild: await triggerRebuild(env) });
  return jsonResponse({ ok: true });
};
