/**
 * The DM inbox's two e-mails (spec §7). The digest tells publishers that new
 * DMs are waiting, at most hourly, six a day, never at night. The last call
 * goes to publishers and admins when a DM has four hours left, at any hour,
 * once per incoming message. Both name senders and times only, never what
 * they wrote, so DM content does not collect in the organisation's Sent folder.
 */
import type { DmEnv } from './social-dm-poll';
import { notifyEach, publisherEmails } from './social-notify';
import { dmView, digestFresh, digestList, mayDigest, lastCallDue, WINDOW_SECONDS, type DmThreadRow } from './social-dm';

export const dmPanelUrl = (origin: string, id: string) => `${origin}/tr/admin#sosyal/dm/${id}`;

const who = (r: DmThreadRow, lang: 'tr' | 'en') => r.peer_username ? `@${r.peer_username}` : lang === 'tr' ? 'Instagram kullanıcısı' : 'Instagram user';
const hoursLeft = (r: DmThreadRow, now: number) => Math.max(1, Math.floor(dmView(r, now).secondsLeft / 3600));
const at = (epoch: number, locale: 'tr-TR' | 'en-GB') => new Date(epoch * 1000).toLocaleString(locale, {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
});

export function dmDigestText(rows: DmThreadRow[], now: number, origin: string): { subject: string; text: string } {
  const n = rows.length;
  const tr = rows.map((r) => `- **${who(r, 'tr')}**, ${at(r.last_inbound_at!, 'tr-TR')}, ${hoursLeft(r, now)} saat kaldı: ${dmPanelUrl(origin, r.id)}`).join('\n');
  const en = rows.map((r) => `- **${who(r, 'en')}**, ${at(r.last_inbound_at!, 'en-GB')}, ${hoursLeft(r, now)} h left: ${dmPanelUrl(origin, r.id)}`).join('\n');
  return {
    subject: `Instagram: ${n} cevaplanmamış mesaj / ${n} unanswered message${n === 1 ? '' : 's'}`,
    text: `@rsgturkey hesabında cevaplanmamış mesajlar var. Instagram bir mesaja yalnızca 24 saat içinde panelden cevap verilmesine izin veriyor.\n\n${tr}\n\n---\n\nThere are unanswered messages on @rsgturkey. Instagram allows answering from the panel only within 24 hours.\n\n${en}`,
  };
}

/** Turkish "from" phrase that reads right with and without a username. */
const fromTr = (r: DmThreadRow) => r.peer_username ? `@${r.peer_username} hesabından gelen mesaj` : 'Bir Instagram kullanıcısından gelen mesaj';

export function dmLastCallText(r: DmThreadRow, now: number, origin: string): { subject: string; text: string } {
  const h = hoursLeft(r, now);
  return {
    subject: `Son ${h} saat: ${who(r, 'tr')} / Last ${h} h: ${who(r, 'en')}`,
    text: `${fromTr(r)} ${at(r.last_inbound_at!, 'tr-TR')} tarihinden beri cevap bekliyor. ${h} saat sonra panelden cevap verilemeyecek.\n\n${dmPanelUrl(origin, r.id)}\n\n---\n\nThe message from ${who(r, 'en')} has waited since ${at(r.last_inbound_at!, 'en-GB')}. In ${h} h it can no longer be answered from the panel.\n\n${dmPanelUrl(origin, r.id)}`,
  };
}

async function digestRecipients(db: D1Database): Promise<{ id: string; email: string }[]> {
  const pubs = (await db.prepare(`SELECT id, email FROM users WHERE is_social_publisher = 1`).all<{ id: string; email: string }>()).results;
  if (pubs.length) return pubs;
  return (await db.prepare(`SELECT id, email FROM users WHERE is_admin = 1`).all<{ id: string; email: string }>()).results;
}

export async function runDmNotifications(env: DmEnv, now: number, origin: string): Promise<{ lastCalls: number; digests: number }> {
  const out = { lastCalls: 0, digests: 0 };
  await env.DB.prepare(`DELETE FROM social_dm_digest_log WHERE sent_at < ?`).bind(now - 2 * 86400).run();
  // Every rule below needs a thread still open (an inbound message under 24 h old), so
  // older rows are never read: this runs every minute and the table is never pruned.
  const rows = (await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE platform = 'instagram' AND last_inbound_at > ?`)
    .bind(now - WINDOW_SECONDS).all<DmThreadRow>()).results;

  for (const r of lastCallDue(rows, now)) {
    const sent = await notifyEach(env as never, await publisherEmails(env.DB), dmLastCallText(r, now, origin));
    if (sent > 0) {
      await env.DB.prepare(`UPDATE social_dm_threads SET final_warned_at = ? WHERE id = ?`).bind(r.last_inbound_at, r.id).run();
      out.lastCalls++;
    }
  }

  const fresh = digestFresh(rows, now);
  if (fresh.length === 0) return out;
  const message = dmDigestText(digestList(rows, now), now, origin);
  for (const person of await digestRecipients(env.DB)) {
    const log = (await env.DB.prepare(`SELECT sent_at FROM social_dm_digest_log WHERE user_id = ?`).bind(person.id).all<{ sent_at: number }>()).results;
    if (!mayDigest(log.map((l) => l.sent_at), now)) continue;
    if (await notifyEach(env as never, [person.email], message) > 0) {
      await env.DB.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES (?, ?)`).bind(person.id, now).run();
      out.digests++;
    }
  }
  // R5: marked only if someone got it, so a quiet-hours DM is still fresh at 08:00.
  if (out.digests > 0) {
    await env.DB.batch(fresh.map((r) => env.DB.prepare(`UPDATE social_dm_threads SET digested_at = ? WHERE id = ?`).bind(r.last_inbound_at, r.id)));
  }
  return out;
}
