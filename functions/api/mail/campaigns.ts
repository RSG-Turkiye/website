import type { Env } from '../../_lib/auth';
import { runWithAudit } from '../../_lib/audit';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { buildCampaign } from '../../../src/lib/mail-campaign';

/**
 * Bulk personal mail (docs/superpowers/specs/2026-11-05-bulk-personal-mail-design.md).
 *
 * POST takes the pasted table and the letter, builds each person's copy with
 * the same code the panel used for its preview, and queues one row per
 * person. Nothing is sent here: the dispatcher sends them inside the send
 * window and under the campaign quota (functions/_lib/mail.ts). GET lists
 * campaigns with their progress.
 *
 * Senders and admins only, like the rest of panel mail. Not an agent route:
 * starting a mail-out is sending, not drafting (CLAUDE.md rule 10).
 */

const mayRun = (u: { is_sender: number; is_admin: number }) => u.is_sender === 1 || u.is_admin === 1;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request, env)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!mayRun(user)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let input: { table?: unknown; subject?: unknown; body?: unknown };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }
  if (!input || typeof input.table !== 'string' || typeof input.subject !== 'string' || typeof input.body !== 'string') {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const built = buildCampaign({ table: input.table, subject: input.subject, body: input.body });
  if (!built.ok) {
    return jsonResponse({ error: 'Invalid campaign', code: built.code, ...(built.unknown ? { unknown: built.unknown } : {}) }, 400);
  }

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  const queue = env.DB.prepare(
    `INSERT INTO scheduled_emails
      (id, sender_user_id, recipients, subject, body, attachment_ids,
       scheduled_at, created_at, updated_at, campaign_id)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, ?, ?)`,
  );
  await runWithAudit(env.DB, [
    env.DB.prepare(
      'INSERT INTO mail_campaigns (id, sender_user_id, subject, total, created_at) VALUES (?, ?, ?, ?, ?)',
    ).bind(id, user.id, input.subject.trim(), built.recipients.length, now),
    // Due now, one per person: the dispatcher spreads them over the days the
    // quota needs, and each holds without spending an attempt while it waits.
    ...built.recipients.map((r) =>
      queue.bind(generateId(), user.id, JSON.stringify([r.email]), r.subject, r.body, now, now, now, id)),
  ], {
    userId: user.id, action: 'mail.campaign.create', targetType: 'mail_campaign', targetId: id,
    // Counts only: the log is kept a year, the addresses are not.
    details: { recipients: built.recipients.length, refused: built.refused.length },
  }, now);

  return jsonResponse({ ok: true, id, total: built.recipients.length, refused: built.refused }, 201);
};

interface CampaignRow {
  id: string; subject: string; total: number; created_at: number; cancelled_at: number | null;
  sender_email?: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!mayRun(user)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  // An admin sees every campaign, since a mail-out speaks for the
  // organisation; a sender sees their own.
  const campaigns = (user.is_admin === 1
    ? await env.DB.prepare(
        `SELECT c.id, c.subject, c.total, c.created_at, c.cancelled_at, u.email AS sender_email
         FROM mail_campaigns c JOIN users u ON u.id = c.sender_user_id
         ORDER BY c.created_at DESC LIMIT 20`).all<CampaignRow>()
    : await env.DB.prepare(
        `SELECT id, subject, total, created_at, cancelled_at
         FROM mail_campaigns WHERE sender_user_id = ?
         ORDER BY created_at DESC LIMIT 20`).bind(user.id).all<CampaignRow>()).results ?? [];
  if (campaigns.length === 0) return jsonResponse({ campaigns: [] });

  const ids = campaigns.map((c) => c.id);
  const marks = ids.map(() => '?').join(',');
  const sent = (await env.DB.prepare(
    `SELECT campaign_id, status, COUNT(*) AS n FROM sent_emails
     WHERE campaign_id IN (${marks}) GROUP BY campaign_id, status`).bind(...ids)
    .all<{ campaign_id: string; status: string; n: number }>()).results ?? [];
  // The newest hold reason tells the person why nothing is moving: usually
  // the daily quota or the send window, not a fault.
  const waiting = (await env.DB.prepare(
    `SELECT campaign_id, COUNT(*) AS n, MAX(last_error) AS held FROM scheduled_emails
     WHERE campaign_id IN (${marks}) GROUP BY campaign_id`).bind(...ids)
    .all<{ campaign_id: string; n: number; held: string | null }>()).results ?? [];

  return jsonResponse({
    campaigns: campaigns.map((c) => {
      const w = waiting.find((x) => x.campaign_id === c.id);
      return {
        ...c,
        sent: sent.find((x) => x.campaign_id === c.id && x.status === 'sent')?.n ?? 0,
        failed: sent.find((x) => x.campaign_id === c.id && x.status === 'failed')?.n ?? 0,
        waiting: w?.n ?? 0,
        held: w?.held ?? null,
      };
    }),
  });
};
