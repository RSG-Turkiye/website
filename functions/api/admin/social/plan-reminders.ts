import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { appendAudit } from '../../../_lib/audit';
import { notificationText, notifyEach, publisherEmails } from '../../../_lib/social-notify';

const WINDOW_SECONDS = 48 * 3600;

/**
 * Nightly (workers/symposium-cron, 04:17 Türkiye time), so the mail is
 * waiting in the morning. A plan is marked reminded only when a mail actually
 * went out; if Gmail was down, tomorrow's run tries again.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const due = (await env.DB.prepare(
    `SELECT pl.id, pl.title, pl.scheduled_at, u.email AS assignee_email
       FROM social_plans pl LEFT JOIN users u ON u.id = pl.assignee_id
      WHERE pl.post_id IS NULL AND pl.reminded_at IS NULL AND pl.scheduled_at BETWEEN ? AND ?
      ORDER BY pl.scheduled_at`,
  ).bind(now, now + WINDOW_SECONDS).all<{ id: string; title: string; scheduled_at: number; assignee_email: string | null }>()).results;
  if (due.length === 0) return jsonResponse({ ok: true, reminded: 0 });

  const publishers = await publisherEmails(env.DB);
  const panelUrl = `${new URL(request.url).origin}/admin`;
  let reminded = 0;
  for (const plan of due) {
    const message = notificationText('plan_due', { label: plan.title, when: plan.scheduled_at, panelUrl });
    const sent = await notifyEach(env, [plan.assignee_email ?? '', ...publishers], message);
    if (sent === 0) continue;
    await env.DB.prepare('UPDATE social_plans SET reminded_at = ? WHERE id = ?').bind(now, plan.id).run();
    await appendAudit(env.DB, { userId: null, action: 'social.plan.remind', targetType: 'social_plan', targetId: plan.id, details: { sent } }, now);
    reminded++;
  }
  return jsonResponse({ ok: true, reminded });
};
