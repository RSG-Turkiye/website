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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Bytes of letters per INSERT statement. The letters go in as one JSON value
 * per statement rather than one statement per person: D1's free plan allows
 * 50 queries per invocation, and a 500-person list was 502. Kept well under
 * D1's 2 MB limit on a single value.
 */
const CHUNK_BYTES = 900_000;

function chunks<T>(items: T[], size: (x: T) => number): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const n = size(item);
    if (cur.length && bytes + n > CHUNK_BYTES) { out.push(cur); cur = []; bytes = 0; }
    cur.push(item);
    bytes += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request, env)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!mayRun(user)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let input: { id?: unknown; table?: unknown; subject?: unknown; body?: unknown };
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }
  // The id is minted by the panel when the form is built, so a retry after a
  // lost response, or a second tab, sends the same id and cannot queue the
  // same people twice.
  if (!input || typeof input.id !== 'string' || !UUID.test(input.id) ||
      typeof input.table !== 'string' || typeof input.subject !== 'string' || typeof input.body !== 'string') {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const built = buildCampaign({ table: input.table, subject: input.subject, body: input.body });
  if (!built.ok) {
    return jsonResponse({ error: 'Invalid campaign', code: built.code, ...(built.unknown ? { unknown: built.unknown } : {}) }, 400);
  }

  const id = input.id;
  const already = () => jsonResponse({ error: 'Already queued', code: 'already_queued', id }, 409);
  if (await env.DB.prepare('SELECT 1 AS x FROM mail_campaigns WHERE id = ?').bind(id).first()) return already();

  const now = Math.floor(Date.now() / 1000);
  // Due now, one row per person: the dispatcher spreads them over the days
  // the quota needs, and each holds without spending an attempt while it
  // waits. The campaign row goes first in the batch, so a second request
  // with the same id that slipped past the check above fails on its primary
  // key and the whole batch, letters included, is rolled back.
  const letters = built.recipients.map((r) => ({ id: generateId(), to: JSON.stringify([r.email]), subject: r.subject, body: r.body }));
  const inserts = chunks(letters, (l) => (l.subject.length + l.body.length + l.to.length) * 2 + 80).map((part) =>
    env.DB.prepare(
      `INSERT INTO scheduled_emails
        (id, sender_user_id, recipients, subject, body, attachment_ids,
         scheduled_at, created_at, updated_at, campaign_id)
       SELECT json_extract(value, '$.id'), ?, json_extract(value, '$.to'),
              json_extract(value, '$.subject'), json_extract(value, '$.body'), '[]',
              ?, ?, ?, ?
       FROM json_each(?)`,
    ).bind(user.id, now, now, now, id, JSON.stringify(part)));
  try {
    await runWithAudit(env.DB, [
      env.DB.prepare(
        'INSERT INTO mail_campaigns (id, sender_user_id, subject, total, created_at) VALUES (?, ?, ?, ?, ?)',
      ).bind(id, user.id, input.subject.trim(), built.recipients.length, now),
      ...inserts,
    ], {
      userId: user.id, action: 'mail.campaign.create', targetType: 'mail_campaign', targetId: id,
      // Counts only: the log is kept a year, the addresses are not.
      details: { recipients: built.recipients.length, refused: built.refused.length },
    }, now);
  } catch (err) {
    if (/mail_campaigns\.id|UNIQUE constraint/i.test(String(err))) return already();
    throw err;
  }

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
  const waiting = (await env.DB.prepare(
    `SELECT campaign_id, COUNT(*) AS n FROM scheduled_emails
     WHERE campaign_id IN (${marks}) GROUP BY campaign_id`).bind(...ids)
    .all<{ campaign_id: string; n: number }>()).results ?? [];
  // The newest hold reason tells the person why nothing is moving: usually
  // the daily quota, not a fault. Newest by time, so yesterday's reason does
  // not outlive today's.
  const holds = (await env.DB.prepare(
    `SELECT campaign_id, last_error FROM scheduled_emails
     WHERE campaign_id IN (${marks}) AND last_error IS NOT NULL
     ORDER BY updated_at DESC`).bind(...ids)
    .all<{ campaign_id: string; last_error: string }>()).results ?? [];

  return jsonResponse({
    campaigns: campaigns.map((c) => ({
      ...c,
      sent: sent.find((x) => x.campaign_id === c.id && x.status === 'sent')?.n ?? 0,
      failed: sent.find((x) => x.campaign_id === c.id && x.status === 'failed')?.n ?? 0,
      waiting: waiting.find((x) => x.campaign_id === c.id)?.n ?? 0,
      held: holds.find((x) => x.campaign_id === c.id)?.last_error ?? null,
    })),
  });
};
