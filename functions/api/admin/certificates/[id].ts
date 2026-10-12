import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';
import { organiser } from '../certificates';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE id = ?').bind(id).first<{ id: string }>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  await env.MAIL_ATTACHMENTS.delete(certKey(row.id));
  await env.DB.prepare('DELETE FROM symposium_certificates WHERE id = ?').bind(row.id).run();
  return jsonResponse({ ok: true });
};
