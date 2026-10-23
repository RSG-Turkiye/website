/**
 * The numbers beside the admin panel's menu entries and on Overview. Each
 * count is returned only to someone whose role lets them act on it, so the
 * menu never hints at work a person cannot see. The e-mail count is the
 * caller's own unread threads, for admins and senders alike.
 */
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';
import { canOpenAdminPanel } from '../../_lib/cms-access';

const WEEK = 7 * 86400;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!(await canOpenAdminPanel(env.DB, user, Math.floor(Date.now() / 1000)))) return jsonResponse({ error: 'Forbidden' }, 403);

  const admin = user.is_admin === 1;
  const publisher = admin || user.is_social_publisher === 1;
  const social = publisher || user.is_social === 1;
  const now = Math.floor(Date.now() / 1000);
  const out: Record<string, number> = {};
  // One failing query (a table missing on a fresh database, say) leaves out
  // its own number only; the menu shows no badge for a missing key.
  const count = async (key: string, sql: string, ...b: (string | number)[]) => {
    try {
      out[key] = (await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0;
    } catch (err) {
      console.error(`admin counts: ${key} failed`, err);
    }
  };

  if (admin || user.is_sender === 1) await count('email', 'SELECT COUNT(*) AS n FROM mail_threads WHERE unread = 1 AND sender_user_id = ?', user.id);
  if (publisher) await count('social', `SELECT COUNT(*) AS n FROM social_posts WHERE status = 'pending_approval'`);
  if (publisher) await count('dm', `SELECT COUNT(*) AS n FROM social_dm_threads
    WHERE last_inbound_at > COALESCE(last_outbound_at, 0) AND last_inbound_at > ? AND COALESCE(read_at, 0) < last_inbound_at`, now - 86400);
  // The Sosyal menu badge: approvals plus unread messages. A missing dm count (migration not applied) adds nothing.
  if (typeof out.social === 'number') out.socialTotal = out.social + (out.dm ?? 0);
  if (admin) await count('blog', `SELECT COUNT(*) AS n FROM blog_submissions WHERE status = 'pending'`);
  if (social) await count('scheduledThisWeek', `SELECT COUNT(*) AS n FROM social_posts WHERE status = 'scheduled' AND scheduled_at BETWEEN ? AND ?`, now, now + WEEK);
  return jsonResponse(out);
};
