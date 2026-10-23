// Retention: certificates and their email addresses are kept 30 days; only
// their counts outlive them, in certificate_stats. The
// symposium-cron Worker calls this nightly with the archive secret, before
// it rebuilds the symposium site, so the home page band goes with the last
// certificate. An R2 lifecycle rule on certificates/ (31 days) is the safety
// net if this stops running.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';
import { appendAudit } from '../../../_lib/audit';

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
  // The counts go into certificate_stats in the same batch that deletes the
  // rows, so a certificate is never both counted and kept, or deleted and
  // not counted. Several nights can purge the same year (uploads on
  // different days), hence the running sum.
  const [, certs] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO certificate_stats (year, certificates, people, viewed, downloaded)
       SELECT year, SUM(n), COUNT(*), SUM(v > 0), SUM(d > 0) FROM (
         SELECT year, email, COUNT(*) AS n, SUM(views) AS v, SUM(downloads) AS d
         FROM symposium_certificates WHERE expires_at <= ? GROUP BY year, email
       ) WHERE true GROUP BY year
       ON CONFLICT(year) DO UPDATE SET
         certificates = certificates + excluded.certificates,
         people = people + excluded.people,
         viewed = viewed + excluded.viewed,
         downloaded = downloaded + excluded.downloaded`
    ).bind(now),
    env.DB.prepare('DELETE FROM symposium_certificates WHERE expires_at <= ?').bind(now),
  ]);
  const lookups = await env.DB.prepare('DELETE FROM certificate_lookups WHERE at < ?').bind(now - 86400).run();
  // Only a night that deleted something is worth a line in the log.
  if (certs.meta.changes > 0) {
    await appendAudit(env.DB, { userId: null, action: 'certificate.purge', details: { certificates: certs.meta.changes } }, now);
  }
  return jsonResponse({ ok: true, certificates: certs.meta.changes, lookups: lookups.meta.changes });
};
