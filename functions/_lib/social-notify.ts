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
import { renderBody, renderTemplate, inertText, slot, type RenderedBody } from './markdown';

/** A system mail: `body`, when given, is already rendered (notificationText); otherwise `text` is rendered as Markdown. */
export type SystemMessage = { subject: string; text: string; body?: RenderedBody };

export async function sendSystemEmail(env: Env, msg: SystemMessage & { to: string }): Promise<boolean> {
  try {
    const raw = buildMime({
      fromAddress: env.RSG_MAIL_FROM, fromName: 'RSG-Türkiye', to: msg.to, replyTo: env.RSG_MAIL_FROM,
      subject: msg.subject, body: msg.body ?? renderBody(msg.text), attachments: [],
    });
    await sendMail(env, raw);
    return true;
  } catch (err) {
    console.error('social notification failed', err);
    return false;
  }
}

export async function notifyEach(env: Env, emails: string[], message: SystemMessage): Promise<number> {
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

export async function adminEmails(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT email FROM users WHERE is_admin = 1').all<{ email: string }>()).results.map((r) => r.email);
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

export type NotifyKind = 'submitted' | 'approved' | 'rejected' | 'plan_due' | 'publish_failed' | 'waiting_connection' | 'needs_confirmation' | 'connection_broken' | 'connection_expiring' | 'buffer_key_expiring';

/** Turkish first, then English, in one message: the reader's language is not known. */
/** The longest label a subject carries, in characters. */
export const SUBJECT_LABEL_MAX = 80;

/**
 * The label, the note and the actor are written by people (a plan title, a
 * caption, a reviewer's note), and a token can write them too. They go into
 * the mail as inert, escaped text: never Markdown, never a link (renderTemplate),
 * so a title such as "[Reset your password](https://...)" cannot become a
 * clickable link in mail sent from the organisation's own address. In the
 * subject the label is one line of at most SUBJECT_LABEL_MAX characters.
 */
export function notificationText(
  kind: NotifyKind,
  ctx: { label: string; when: number | null; actor?: string; note?: string; panelUrl: string; platform?: string },
): Required<SystemMessage> {
  const { subject, template } = notificationTemplate(kind, ctx);
  const body = renderTemplate(template, [ctx.label, ctx.note ?? '', ctx.actor ?? '']);
  return { subject, text: body.text, body };
}

/**
 * The label for the subject: one line, inert as in the body but readable
 * where a zero-width space could not help (a subject is plain text, and some
 * clients and previews linkify it): schemes dropped, and every dot inside a
 * host-like word shown as [.] ("evil[.]example"). At most SUBJECT_LABEL_MAX
 * characters.
 */
function subjectLabel(label: string): string {
  const flat = inertText(label).replace(/\u200B/g, '')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\//gi, '')
    .replace(/([\p{L}\p{N}])\.(?=[\p{L}\p{N}])/gu, '$1[.]');
  const chars = [...flat];
  return chars.length > SUBJECT_LABEL_MAX ? `${chars.slice(0, SUBJECT_LABEL_MAX - 1).join('')}…` : chars.join('');
}

function notificationTemplate(
  kind: NotifyKind,
  ctx: { label: string; when: number | null; actor?: string; note?: string; panelUrl: string; platform?: string },
): { subject: string; template: string } {
  const p = ctx.platform ?? 'Instagram';
  const tr = when(ctx.when, 'tr-TR');
  const en = when(ctx.when, 'en-GB');
  const label = subjectLabel(ctx.label);
  const L = slot(0);
  const who = slot(2);
  const note = ctx.note ? `\n\n> ${slot(1)}` : '';
  switch (kind) {
    case 'submitted':
      return {
        subject: `Onay bekleyen gönderi / Post awaiting approval: ${label}`,
        template: `${who} bir gönderiyi onaya gönderdi: **${L}** (${tr}).\n\nPanelden onaylayabilir ya da geri çevirebilirsin: ${ctx.panelUrl}\n\n---\n\n${who} submitted a post for approval: **${L}** (${en}).\n\nApprove or send it back in the panel: ${ctx.panelUrl}`,
      };
    case 'approved':
      return {
        subject: `Gönderin onaylandı / Your post was approved: ${label}`,
        template: `**${L}** onaylandı ve ${tr} için zamanlandı.\n\n${ctx.panelUrl}\n\n---\n\n**${L}** was approved and scheduled for ${en}.\n\n${ctx.panelUrl}`,
      };
    case 'rejected':
      return {
        subject: `Gönderin geri çevrildi / Your post was sent back: ${label}`,
        template: `**${L}** onaylanmadı. Not:${note}\n\nDüzenleyip yeniden gönderebilirsin: ${ctx.panelUrl}\n\n---\n\n**${L}** was not approved. Note:${note}\n\nEdit it and submit again: ${ctx.panelUrl}`,
      };
    case 'plan_due':
      return {
        subject: `İçeriği bekleyen plan / Plan waiting for content: ${label}`,
        template: `${tr} tarihindeki **${L}** planına henüz içerik yüklenmedi.\n\n${ctx.panelUrl}\n\n---\n\nThe plan **${L}** for ${en} has no content yet.\n\n${ctx.panelUrl}`,
      };
    case 'publish_failed':
      return {
        subject: `Gönderi yayınlanamadı / Post could not be published: ${label}`,
        template: `**${L}** (${tr}) ${p}'da yayınlanamadı. Neden:${note}\n\nPanelden düzeltip yeniden deneyebilirsin: ${ctx.panelUrl}\n\n---\n\n**${L}** (${en}) could not be published to ${p}. Reason:${note}\n\nFix it and retry in the panel: ${ctx.panelUrl}`,
      };
    case 'waiting_connection':
      return {
        subject: `Gönderi bağlantı bekliyor / Post waiting for a connection: ${label}`,
        template: `**${L}** (${tr}) yayınlanamıyor çünkü ${p} bağlantısı çalışmıyor. Bir admin Bağlantılar sekmesinden yeniden bağladığında gönderi sıraya döner.\n\n${ctx.panelUrl}\n\n---\n\n**${L}** (${en}) cannot go out because the ${p} connection is not working. Once an admin reconnects it in Connections, the post is queued again.\n\n${ctx.panelUrl}`,
      };
    case 'needs_confirmation':
      return {
        subject: `Geciken gönderi onay bekliyor / Late post needs a decision: ${label}`,
        template: `**${L}** ${tr} için zamanlanmıştı ve iki saatten fazla gecikti. Kendiliğinden yayınlanmayacak: panelden "Yine de yayınla" ya da "İptal et" seç.\n\n${ctx.panelUrl}\n\n---\n\n**${L}** was scheduled for ${en} and is more than two hours late. It will not go out on its own: choose "Publish anyway" or "Cancel" in the panel.\n\n${ctx.panelUrl}`,
      };
    case 'connection_broken':
      return {
        subject: `${p} bağlantısı koptu / ${p} connection broken`,
        template: `${p} bağlantısı artık çalışmıyor. Neden:${note}\n\nBağlantılar sekmesinden yeniden bağla; bekleyen gönderiler sıraya döner: ${ctx.panelUrl}\n\n---\n\nThe ${p} connection no longer works. Reason:${note}\n\nReconnect it in Connections; waiting posts are queued again: ${ctx.panelUrl}`,
      };
    case 'buffer_key_expiring':
      return {
        subject: `Buffer API anahtarının süresi doluyor / Buffer API key expiring`,
        template: `LinkedIn ve X gönderilerini taşıyan Buffer API anahtarının süresi ${slot(1)} gün içinde doluyor. Dolunca LinkedIn ve X gönderileri bekler.\n\nYenilemek için:\n1. Buffer'da (turkey.rsg@gmail.com) Settings > API: yeni anahtar oluştur (izinler: account:read, posts:read, posts:write).\n2. Kendi terminalinde: npx wrangler pages secret put BUFFER_API_KEY --project-name website\n3. wrangler.toml içindeki BUFFER_KEY_EXPIRES'ı yeni bitiş tarihiyle değiştir ve deploy et.\n4. Eski anahtarı Buffer'da sil.\n\nPanel: ${ctx.panelUrl}\n\n---\n\nThe Buffer API key that carries LinkedIn and X posts expires in ${slot(1)} days. After that, LinkedIn and X posts wait.\n\nTo renew it:\n1. In Buffer (turkey.rsg@gmail.com), Settings > API: create a new key (permissions: account:read, posts:read, posts:write).\n2. In your own terminal: npx wrangler pages secret put BUFFER_API_KEY --project-name website\n3. Change BUFFER_KEY_EXPIRES in wrangler.toml to the new end date and deploy.\n4. Delete the old key in Buffer.\n\nPanel: ${ctx.panelUrl}`,
      };
    case 'connection_expiring':
      return {
        subject: `${p} bağlantısının süresi doluyor / ${p} connection expiring`,
        template: `${p} bağlantısının süresi ${slot(1)} gün içinde doluyor ve kendiliğinden yenilenemiyor. Süre dolmadan Bağlantılar sekmesinden yeniden bağla: ${ctx.panelUrl}\n\n---\n\nThe ${p} connection expires in ${slot(1)} days and cannot renew itself. Reconnect it in Connections before then: ${ctx.panelUrl}`,
      };
  }
}
