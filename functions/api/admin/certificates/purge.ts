// Retention: certificates and their email addresses are kept 30 days. The
// symposium-cron Worker calls this nightly with the archive secret, before
// it rebuilds the symposium site, so the home page band goes with the last
// certificate. An R2 lifecycle rule on certificates/ (31 days) is the safety
// net if this stops running.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Archive-Secret');
  if (!env.SYMPOSIUM_ARCHIVE_SECRET || secret !== env.SYMPOSIUM_ARCHIVE_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE expires_at <= ?')
    .bind(now).all<{ id: string }>();
  // Objects first: if this throws, the rows survive and the next run retries.
  // Deleting a key that is already gone is not an error in R2.
  for (let i = 0; i < results.length; i += 1000) {
    await env.MAIL_ATTACHMENTS.delete(results.slice(i, i + 1000).map((r) => certKey(r.id)));
  }
  const certs = await env.DB.prepare('DELETE FROM symposium_certificates WHERE expires_at <= ?').bind(now).run();
  const lookups = await env.DB.prepare('DELETE FROM certificate_lookups WHERE at < ?').bind(now - 86400).run();
  return jsonResponse({ ok: true, certificates: certs.meta.changes, lookups: lookups.meta.changes });
};
