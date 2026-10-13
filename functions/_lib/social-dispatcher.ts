/**
 * One social dispatch tick (spec §5), called every minute by
 * workers/mail-cron through /api/social/dispatch. Claims due targets with a
 * lease, runs one adapter step each, writes the result through the pure
 * transition in social-dispatch.ts, and keeps the post's status in step with
 * its targets. Every change is audited as the system (userId null).
 */
import type { Env } from './auth';
import { getConnection, connectionStatus, readAccessToken, markOk, markBroken } from './connections';
import { rowToDraft, type PostRow } from './social-posts';
import { captionFor } from './social-limits';
import { afterStep, derivePostStatus, isLate, CLAIM_LEASE_SECONDS, type TargetNow, type TargetStatus } from './social-dispatch';
import { instagramPublishStep } from './social/instagram';
import { appendAudit } from './audit';
import { notificationText, notifyEach, publisherEmails, adminEmails, postLabel, type NotifyKind } from './social-notify';

export const TICK_BATCH = 2;
export { CLAIM_LEASE_SECONDS };

type Due = PostRow & {
  target_status: TargetStatus; platform: string; attempts: number; first_tried_at: number | null; container_id: string | null;
  remote_id: string | null; permalink: string | null; published_at: number | null; last_error: string | null; confirmed_at: number | null;
  author_email: string | null; plan_title: string | null;
};

export async function dispatchSocial(env: Env, now: number, origin: string) {
  const db = env.DB;
  const summary = { candidates: 0, claimed: 0, published: 0, failed: 0, waiting: 0 };
  const due = (await db.prepare(
    `SELECT p.*, t.platform, t.status AS target_status, t.attempts, t.first_tried_at, t.container_id, t.remote_id, t.permalink,
            t.published_at, t.last_error, t.confirmed_at, u.email AS author_email, pl.title AS plan_title
       FROM social_post_targets t
       JOIN social_posts p ON p.id = t.post_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN social_plans pl ON pl.post_id = p.id
      WHERE t.status IN ('queued','publishing') AND p.status = 'scheduled' AND p.scheduled_at <= ?
        AND (t.claimed_at IS NULL OR t.claimed_at <= ?)
      ORDER BY p.scheduled_at
      LIMIT ?`,
  ).bind(now, now - CLAIM_LEASE_SECONDS, TICK_BATCH).all<Due>()).results;
  summary.candidates = due.length;

  // A tick that died between a target's write and its post's settle leaves a post 'scheduled' with every target settled; no claim would ever touch it again.
  const orphans = (await db.prepare(
    `SELECT p.id FROM social_posts p
      WHERE p.status = 'scheduled'
        AND EXISTS (SELECT 1 FROM social_post_targets t WHERE t.post_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM social_post_targets t WHERE t.post_id = p.id AND t.status IN ('queued','publishing','waiting_connection','needs_confirmation'))
      LIMIT 10`,
  ).all<{ id: string }>()).results;
  for (const o of orphans) await settlePost(db, o.id, now);
  if (due.length === 0) return summary;

  const panelUrl = `${origin}/admin`;
  // The token is read once per tick; an auth failure clears it so the rest of the batch waits instead of failing the same way.
  const conn = await getConnection(db, 'instagram');
  const usable = conn && conn.account_id && ['connected', 'expiring'].includes(connectionStatus(conn, now));
  let token = usable ? await readAccessToken(env, conn!) : null;
  if (usable && !token) {
    await markBroken(db, 'instagram', 'stored token unreadable', now);
    await notifyEach(env, await adminEmails(db), notificationText('connection_broken', { label: '', when: null, note: 'stored token unreadable', panelUrl }));
  }

  for (const row of due) {
    const claim = await db.prepare(
      `UPDATE social_post_targets SET claimed_at = ?
        WHERE post_id = ? AND platform = ? AND status IN ('queued','publishing') AND (claimed_at IS NULL OR claimed_at <= ?)
          AND status = ? AND container_id IS ?`,
    ).bind(now, row.id, row.platform, now - CLAIM_LEASE_SECONDS, row.target_status, row.container_id).run();
    if (claim.meta.changes !== 1) continue;
    summary.claimed++;

    const t: TargetNow = {
      status: row.target_status, attempts: row.attempts, first_tried_at: row.first_tried_at, container_id: row.container_id,
      remote_id: row.remote_id, permalink: row.permalink, published_at: row.published_at, last_error: row.last_error,
    };
    const label = postLabel(row.caption, row.plan_title);
    const tell = async (kind: NotifyKind, to: string[], note?: string) =>
      notifyEach(env, to, notificationText(kind, { label, when: row.scheduled_at, note, panelUrl }));

    // Platforms without an adapter yet (LinkedIn until phase 5): settled, not counted.
    if (row.platform !== 'instagram') {
      await write(db, row, { ...t, status: 'skipped', last_error: 'not_available: no adapter yet' }, now);
      await settlePost(db, row.id, now);
      await appendAudit(db, { userId: null, action: 'social.target.skipped', targetType: 'social_post', targetId: row.id, details: { platform: row.platform } }, now);
      continue;
    }
    // Queued with no attempt in its current run (a transient retry has already started and runs out its own window) and more than two hours late: a person decides (spec §5, lateness rule).
    // A container kept from before a wait does not exempt it: reconnect, refresh and requeue all reset first_tried_at, and a held target keeps its container for the status read after confirmation.
    if (row.target_status === 'queued' && row.first_tried_at === null && isLate(row.scheduled_at!, now, row.confirmed_at)) {
      await write(db, row, { ...t, status: 'needs_confirmation' }, now);
      await settlePost(db, row.id, now);
      await appendAudit(db, { userId: null, action: 'social.target.late', targetType: 'social_post', targetId: row.id, details: { platform: row.platform, scheduledAt: row.scheduled_at } }, now);
      await tell('needs_confirmation', await publisherEmails(db));
      continue;
    }
    if (!token) {
      await write(db, row, { ...t, status: 'waiting_connection', last_error: 'auth: no working Instagram connection' }, now);
      await settlePost(db, row.id, now);
      await appendAudit(db, { userId: null, action: 'social.target.waiting', targetType: 'social_post', targetId: row.id, details: { platform: row.platform } }, now);
      await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
      summary.waiting++;
      continue;
    }

    const d = rowToDraft(row);
    const step = await instagramPublishStep({
      igUserId: conn!.account_id!, token,
      post: {
        type: d.type, caption: captionFor(d, 'instagram'),
        media: d.media.map((m) => ({ key: m.key, alt: m.alt, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}` })),
      },
      state: { containerId: row.container_id },
    });
    const tr = afterStep(step, t, now);
    await write(db, row, tr.next, now);
    await settlePost(db, row.id, now);
    if (tr.audit) {
      await appendAudit(db, {
        userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id,
        details: { platform: row.platform, status: tr.next.status, reason: tr.next.last_error, remoteId: tr.next.remote_id, notes: 'notes' in step ? step.notes : undefined },
      }, now);
    }
    if (step.kind === 'done') { summary.published++; await markOk(db, 'instagram', now); }
    if (tr.next.status === 'failed') summary.failed++;
    if (step.kind === 'auth') {
      summary.waiting++;
      const wasBroken = connectionStatus(conn, now) === 'broken';
      await markBroken(db, 'instagram', step.reason, now);
      token = null;
      if (!wasBroken) await tell('connection_broken', await adminEmails(db), step.reason);
    }
    if (tr.notify === 'failed') await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? '');
    if (tr.notify === 'waiting_connection') await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
  }
  return summary;
}

/** Writes a target's next state and releases this tick's lease, so a pending container is polled again next minute. */
async function write(db: D1Database, row: Due, n: TargetNow, now: number): Promise<void> {
  await db.prepare(
    `UPDATE social_post_targets
        SET status = ?, attempts = ?, first_tried_at = ?, container_id = ?, remote_id = ?, permalink = ?, published_at = ?,
            last_error = ?, claimed_at = NULL
      WHERE post_id = ? AND platform = ? AND claimed_at = ?`,
  ).bind(n.status, n.attempts, n.first_tried_at, n.container_id, n.remote_id, n.permalink, n.published_at, n.last_error, row.id, row.platform, now).run();
}

/** Moves the post to published / partially_published / failed once every target has settled. */
async function settlePost(db: D1Database, postId: string, now: number): Promise<void> {
  const statuses = (await db.prepare('SELECT status FROM social_post_targets WHERE post_id = ?').bind(postId).all<{ status: TargetStatus }>()).results.map((r) => r.status);
  const next = derivePostStatus(statuses);
  if (next === 'scheduled') return;
  // A fresh nonce and revision, so a composer still open on the old version gets post_changed instead of overwriting.
  const res = await db.prepare(
    `UPDATE social_posts SET status = ?, revision = revision + 1, write_nonce = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'`,
  ).bind(next, crypto.randomUUID(), now, postId).run();
  if (res.meta.changes === 1) {
    await appendAudit(db, { userId: null, action: `social.post.${next}`, targetType: 'social_post', targetId: postId, details: { targets: statuses } }, now);
  }
}
