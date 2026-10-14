/**
 * The numbers beside the admin panel's menu entries and on Overview. Each
 * count is returned only to someone whose role lets them act on it, so the
 * menu never hints at work a person cannot see.
 */
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, canSeeAdminPanel } from '../../_lib/auth';

const WEEK = 7 * 86400;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const admin = user.is_admin === 1;
  const publisher = admin || user.is_social_publisher === 1;
  const social = publisher || user.is_social === 1;
  const now = Math.floor(Date.now() / 1000);
  const n = async (sql: string, ...b: (string | number)[]) =>
    ((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0);

  const out: Record<string, number> = {};
  if (admin) out.email = await n('SELECT COUNT(*) AS n FROM mail_threads WHERE unread = 1');
  if (publisher) out.social = await n(`SELECT COUNT(*) AS n FROM social_posts WHERE status = 'pending_approval'`);
  if (admin) out.blog = await n(`SELECT COUNT(*) AS n FROM blog_submissions WHERE status = 'pending'`);
  if (social) out.scheduledThisWeek = await n(`SELECT COUNT(*) AS n FROM social_posts WHERE status = 'scheduled' AND scheduled_at BETWEEN ? AND ?`, now, now + WEEK);
  return jsonResponse(out);
};
