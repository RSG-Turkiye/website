/**
 * Mail the panel sends on its own: approval requests, decisions, and plans
 * still waiting for content. Built like notifyThreadOwner in conversations.ts
 * -- buildMime + sendMail, never sendAndLog -- so machine mail does not bury
 * members' own sends in sent_emails. Nothing here throws: a notification that
 * cannot go out must never fail the action that triggered it. When Gmail
 * itself is broken, the admin panel's banner already says notifications are
 * paused.
 */
import type { Env } from './auth';
import { buildMime, sendMail } from './gmail';
import { renderBody } from './markdown';

export async function sendSystemEmail(env: Env, msg: { to: string; subject: string; text: string }): Promise<boolean> {
  try {
    const raw = buildMime({
      fromAddress: env.RSG_MAIL_FROM, fromName: 'RSG-Türkiye', to: msg.to, replyTo: env.RSG_MAIL_FROM,
      subject: msg.subject, body: renderBody(msg.text), attachments: [],
    });
    await sendMail(env, raw);
    return true;
  } catch (err) {
    console.error('social notification failed', err);
    return false;
  }
}

export async function notifyEach(env: Env, emails: string[], message: { subject: string; text: string }): Promise<number> {
  let sent = 0;
  for (const to of new Set(emails.map((e) => e.trim()).filter(Boolean))) {
    if (await sendSystemEmail(env, { to, ...message })) sent++;
  }
  return sent;
}

export async function publisherEmails(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT email FROM users WHERE is_admin = 1 OR is_social_publisher = 1').all<{ email: string }>())
    .results.map((r) => r.email);
}

export function postLabel(caption: string, planTitle: string | null): string {
  if (planTitle && planTitle.trim()) return planTitle.trim();
  const text = caption.trim().replace(/\s+/g, ' ');
  if (!text) return '(başlıksız / untitled)';
  const chars = [...text];
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : text;
}

const when = (epoch: number | null, locale: 'tr-TR' | 'en-GB') =>
  epoch === null ? '' : new Date(epoch * 1000).toLocaleString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });

export type NotifyKind = 'submitted' | 'approved' | 'rejected' | 'plan_due';

/** Turkish first, then English, in one message: the reader's language is not known. */
export function notificationText(
  kind: NotifyKind,
  ctx: { label: string; when: number | null; actor?: string; note?: string; panelUrl: string },
): { subject: string; text: string } {
  const tr = when(ctx.when, 'tr-TR');
  const en = when(ctx.when, 'en-GB');
  const who = ctx.actor ?? '';
  const note = ctx.note ? `\n\n> ${ctx.note}` : '';
  switch (kind) {
    case 'submitted':
      return {
        subject: `Onay bekleyen gönderi / Post awaiting approval: ${ctx.label}`,
        text: `${who} bir gönderiyi onaya gönderdi: **${ctx.label}** (${tr}).\n\nPanelden onaylayabilir ya da geri çevirebilirsin: ${ctx.panelUrl}\n\n---\n\n${who} submitted a post for approval: **${ctx.label}** (${en}).\n\nApprove or send it back in the panel: ${ctx.panelUrl}`,
      };
    case 'approved':
      return {
        subject: `Gönderin onaylandı / Your post was approved: ${ctx.label}`,
        text: `**${ctx.label}** onaylandı ve ${tr} için zamanlandı.\n\n${ctx.panelUrl}\n\n---\n\n**${ctx.label}** was approved and scheduled for ${en}.\n\n${ctx.panelUrl}`,
      };
    case 'rejected':
      return {
        subject: `Gönderin geri çevrildi / Your post was sent back: ${ctx.label}`,
        text: `**${ctx.label}** onaylanmadı. Not:${note}\n\nDüzenleyip yeniden gönderebilirsin: ${ctx.panelUrl}\n\n---\n\n**${ctx.label}** was not approved. Note:${note}\n\nEdit it and submit again: ${ctx.panelUrl}`,
      };
    case 'plan_due':
      return {
        subject: `İçeriği bekleyen plan / Plan waiting for content: ${ctx.label}`,
        text: `${tr} tarihindeki **${ctx.label}** planına henüz içerik yüklenmedi.\n\n${ctx.panelUrl}\n\n---\n\nThe plan **${ctx.label}** for ${en} has no content yet.\n\n${ctx.panelUrl}`,
      };
  }
}
