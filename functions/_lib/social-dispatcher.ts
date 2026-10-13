/**
 * One social dispatch tick (spec §5), called every minute by
 * workers/mail-cron through /api/social/dispatch. Claims due targets with a
 * lease, runs one adapter step each, writes the result through the pure
 * transition in social-dispatch.ts, and keeps the post's status in step with
 * its targets. Every change is audited as the system (userId null). Nothing
 * here is specific to a platform: social/registry.ts names the publish step,
 * social/tokens.ts the token.
 */
import type { Env } from './auth';
import { markOk, markBroken, requeueWaitingStatement } from './connections';
import { rowToDraft, type PostRow } from './social-posts';
import { captionFor, type SocialPlatform } from './social-limits';
import { afterStep, derivePostStatus, isLate, CLAIM_LEASE_SECONDS, type TargetNow, type TargetStatus } from './social-dispatch';
import { PUBLISHERS, PLATFORM_LABEL, SKIP_WHEN_UNCONNECTED } from './social/registry';
import { usableToken, type Usable } from './social/tokens';
import { appendAudit } from './audit';
import { notificationText, notifyEach, publisherEmails, adminEmails, postLabel, type NotifyKind } from './social-notify';

export const TICK_BATCH = 2;
export { CLAIM_LEASE_SECONDS };

type Due = PostRow & {
  target_status: TargetStatus; platform: SocialPlatform; attempts: number; first_tried_at: number | null; container_id: string | null;
  remote_id: string | null; permalink: string | null; published_at: number | null; last_error: string | null; confirmed_at: number | null;
  author_email: string | null; plan_title: string | null;
};

async function loadMedia(env: Env, key: string): Promise<Uint8Array | null> {
  const object = await env.BLOG_IMAGES.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

export async function dispatchSocial(env: Env, now: number, origin: string) {
  const db = env.DB;
  const summary = { candidates: 0, claimed: 0, published: 0, failed: 0, waiting: 0 };
  const panelUrl = `${origin}/admin`;
  const brokenMail = (platform: SocialPlatform, note: string) =>
    notificationText('connection_broken', { label: '', when: null, note, panelUrl, platform: PLATFORM_LABEL[platform] });

  // A token is read once per platform per tick; an auth failure replaces it, so the rest of the batch waits instead of failing the same way.
  const tokens = new Map<SocialPlatform, Usable>();
  const tokenFor = async (platform: SocialPlatform): Promise<Usable> => {
    const cached = tokens.get(platform);
    if (cached) return cached;
    const u = await usableToken(env, platform, now);
    if (!u.ok && u.why === 'unreadable') {
      await markBroken(db, platform, 'stored token unreadable', now);
      await notifyEach(env, await adminEmails(db), brokenMail(platform, 'stored token unreadable'));
    }
    if (!u.ok && u.why === 'broken' && u.justBroke) await notifyEach(env, await adminEmails(db), brokenMail(platform, u.reason ?? ''));
    tokens.set(platform, u);
    return u;
  };
  // Read now, as before this was platform-neutral: an unreadable Instagram token is reported even on a tick with nothing due.
  await tokenFor('instagram');

  // A target can be left waiting with its connection working again (a tick
  // that wrote waiting_connection just after a reconnect re-queued): put it
  // back, exactly as a reconnect would. This runs before the due query, since
  // waiting targets are not due and a tick with none due would never get here.
  const waiting = (await db.prepare(`SELECT DISTINCT platform FROM social_post_targets WHERE status = 'waiting_connection'`).all<{ platform: SocialPlatform }>()).results;
  for (const { platform } of waiting) {
    if (!(await tokenFor(platform)).ok) continue;
    const healed = await requeueWaitingStatement(db, platform).run();
    if (healed.meta.changes > 0) {
      await appendAudit(db, { userId: null, action: 'social.target.requeued', targetType: 'connection', targetId: platform, details: { targets: healed.meta.changes } }, now);
    }
  }

  // Fewest attempts first: a target retrying a transient error must not starve newer due posts.
  const due = (await db.prepare(
    `SELECT p.*, t.platform, t.status AS target_status, t.attempts, t.first_tried_at, t.container_id, t.remote_id, t.permalink,
            t.published_at, t.last_error, t.confirmed_at, u.email AS author_email, pl.title AS plan_title
       FROM social_post_targets t
       JOIN social_posts p ON p.id = t.post_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN social_plans pl ON pl.post_id = p.id
      WHERE t.status IN ('queued','publishing') AND p.status = 'scheduled' AND p.scheduled_at <= ?
        AND (t.claimed_at IS NULL OR t.claimed_at <= ?)
      ORDER BY t.attempts, p.scheduled_at
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

  for (const row of due) {
    const claim = await db.prepare(
      `UPDATE social_post_targets SET claimed_at = ?
        WHERE post_id = ? AND platform = ? AND status IN ('queued','publishing') AND (claimed_at IS NULL OR claimed_at <= ?)
          AND status = ? AND container_id IS ?`,
    ).bind(now, row.id, row.platform, now - CLAIM_LEASE_SECONDS, row.target_status, row.container_id).run();
    if (claim.meta.changes !== 1) continue;
    summary.claimed++;

    const platform = row.platform;
    const name = PLATFORM_LABEL[platform];
    const t: TargetNow = {
      status: row.target_status, attempts: row.attempts, first_tried_at: row.first_tried_at, container_id: row.container_id,
      remote_id: row.remote_id, permalink: row.permalink, published_at: row.published_at, last_error: row.last_error,
    };
    const label = postLabel(row.caption, row.plan_title);
    const tell = async (kind: NotifyKind, to: string[], note?: string) =>
      notifyEach(env, to, notificationText(kind, { label, when: row.scheduled_at, note, panelUrl, platform: name }));
    const settleAs = async (next: TargetNow, action: string, details: Record<string, unknown> = {}) => {
      if (!await write(db, row, next, now)) return false;
      await settlePost(db, row.id, now);
      await appendAudit(db, { userId: null, action, targetType: 'social_post', targetId: row.id, details: { platform, ...details } }, now);
      return true;
    };

    const publish = PUBLISHERS[platform];
    if (!publish) {
      await settleAs({ ...t, status: 'skipped', last_error: 'not_available: no adapter yet' }, 'social.target.skipped');
      continue;
    }
    const usable = await tokenFor(platform);
    if (!usable.ok && usable.why === 'unused' && SKIP_WHEN_UNCONNECTED.has(platform)) {
      await settleAs({ ...t, status: 'skipped', last_error: `not_connected: ${name} is not connected` }, 'social.target.skipped', { reason: 'not_connected' });
      continue;
    }
    // Queued with no attempt in its current run (a transient retry has already started and runs out its own window) and more than two hours late: a person decides (spec §5, lateness rule).
    // A container kept from before a wait does not exempt it: reconnect, refresh and requeue all reset first_tried_at, and a held target keeps its container for the status read after confirmation.
    if (row.target_status === 'queued' && row.first_tried_at === null && isLate(row.scheduled_at!, now, row.confirmed_at)) {
      if (!await settleAs({ ...t, status: 'needs_confirmation' }, 'social.target.late', { scheduledAt: row.scheduled_at })) continue;
      await tell('needs_confirmation', await publisherEmails(db));
      continue;
    }
    if (!usable.ok && usable.why === 'transient') {
      const tr = afterStep({ kind: 'retry', reason: usable.reason }, t, now);
      if (!await write(db, row, tr.next, now)) continue;
      await settlePost(db, row.id, now);
      if (tr.audit) await appendAudit(db, { userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id, details: { platform, status: tr.next.status, reason: tr.next.last_error } }, now);
      if (tr.next.status === 'failed') { summary.failed++; await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? ''); }
      continue;
    }
    if (!usable.ok) {
      if (!await settleAs({ ...t, status: 'waiting_connection', last_error: `auth: no working ${name} connection` }, 'social.target.waiting')) continue;
      await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
      summary.waiting++;
      continue;
    }

    const d = rowToDraft(row);
    const step = await publish({
      account: usable.account, token: usable.token, now,
      post: {
        type: d.type, caption: captionFor(d, platform),
        media: d.media.map((m) => ({ key: m.key, alt: m.alt, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}`, load: () => loadMedia(env, m.key) })),
      },
      state: { containerId: t.container_id },
      checkpoint: async (containerId) => {
        const res = await db.prepare(
          'UPDATE social_post_targets SET container_id = ? WHERE post_id = ? AND platform = ? AND claimed_at = ?',
        ).bind(containerId, row.id, row.platform, now).run();
        if (res.meta.changes !== 1) return false;
        t.container_id = containerId;
        return true;
      },
    });
    const tr = afterStep(step, t, now);
    // Lost the lease (the step outlived it and another tick took over): that tick owns the target now; record nothing.
    if (!await write(db, row, tr.next, now)) continue;
    await settlePost(db, row.id, now);
    if (tr.audit) {
      await appendAudit(db, {
        userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id,
        details: { platform, status: tr.next.status, reason: tr.next.last_error, remoteId: tr.next.remote_id, notes: 'notes' in step ? step.notes : undefined },
      }, now);
    }
    if (step.kind === 'done') { summary.published++; await markOk(db, platform, now); }
    if (tr.next.status === 'failed') summary.failed++;
    if (step.kind === 'auth') {
      summary.waiting++;
      await markBroken(db, platform, step.reason, now);
      tokens.set(platform, { ok: false, why: 'broken' });
      // usable.ok was true, so the connection was not broken before this step.
      await tell('connection_broken', await adminEmails(db), step.reason);
    }
    if (tr.notify === 'failed') await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? '');
    if (tr.notify === 'waiting_connection') await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
  }
  return summary;
}

/**
 * Writes a target's next state and releases this tick's lease, so a pending
 * container is polled again next minute. False when the lease was lost: the
 * row is no longer this tick's to write, so the caller stops there.
 */
async function write(db: D1Database, row: Due, n: TargetNow, now: number): Promise<boolean> {
  const res = await db.prepare(
    `UPDATE social_post_targets
        SET status = ?, attempts = ?, first_tried_at = ?, container_id = ?, remote_id = ?, permalink = ?, published_at = ?,
            last_error = ?, claimed_at = NULL
      WHERE post_id = ? AND platform = ? AND claimed_at = ?`,
  ).bind(n.status, n.attempts, n.first_tried_at, n.container_id, n.remote_id, n.permalink, n.published_at, n.last_error, row.id, row.platform, now).run();
  return res.meta.changes === 1;
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
