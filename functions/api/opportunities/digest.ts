import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { signRemoval } from '../../_lib/opportunity';
import { buildDigest, isDigestSender, type DigestItem } from '../../_lib/opportunity-digest';

const SITE = 'https://rsg-turkiye.iscbsc.org';
const RECIPIENT = 'turkey.rsg@gmail.com';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Ingest-Secret');
  if (!env.INGEST_SECRET || secret !== env.INGEST_SECRET) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  if (!env.OPPORTUNITY_DIGEST_SENDER_ID) return jsonResponse({ error: 'digest sender is not configured', code: 'digest_sender_unset' }, 500);

  const sender = await env.DB.prepare('SELECT is_sender FROM users WHERE id = ?').bind(env.OPPORTUNITY_DIGEST_SENDER_ID).first<{ is_sender: number }>();
  if (!isDigestSender(sender)) return jsonResponse({ error: 'digest sender is not a mail sender', code: 'digest_sender_not_sender' }, 500);

  const now = Math.floor(Date.now() / 1000);
  const items = await env.DB.prepare(
    'SELECT id, title, url, source FROM opportunities WHERE published_at >= ? AND removed_at IS NULL ORDER BY published_at',
  ).bind(now - 7 * 86400).all<DigestItem>();
  const runs = await env.DB.prepare(
    'SELECT started_at, sources FROM opportunity_runs WHERE started_at >= ? ORDER BY started_at',
  ).bind(now - 30 * 86400).all<{ started_at: number; sources: string }>();

  const digest = await buildDigest(
    items.results,
    runs.results,
    async (id) => `${SITE}/api/opportunities/${id}/remove?token=${await signRemoval(id, env.INGEST_SECRET)}`,
    now,
  );

  // Same shape as the rows api/mail/send.ts writes: recipients is a JSON array,
  // scheduled_at is unix seconds. Due now, so the next dispatcher tick takes it.
  await env.DB.prepare(
    `INSERT INTO scheduled_emails
       (id, sender_user_id, recipients, subject, body, attachment_ids, scheduled_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), env.OPPORTUNITY_DIGEST_SENDER_ID, JSON.stringify([RECIPIENT]),
    digest.subject, digest.body, '[]', now, now, now,
  ).run();

  return jsonResponse({ queued: true, items: items.results.length });
};
