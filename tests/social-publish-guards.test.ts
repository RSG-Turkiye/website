import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, settle, stubMail, KEYS } from './lib/social';
import { onRequestPatch as patch } from '../functions/api/social/posts/[id]';
import { onRequestPost as cancel } from '../functions/api/social/posts/[id]/cancel';
import { targetStatements } from '../functions/_lib/social-posts';

const NOW = () => Math.floor(Date.now() / 1000);
const AT = NOW() + 3 * 86400;

type Seeded = [platform: string, status: string, extra?: { container?: string | null; claimedAt?: number | null }];
function seed(db: import('node:sqlite').DatabaseSync, targets: Seeded[]) {
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, write_nonce, created_by, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?, '["instagram","linkedin"]', ?, 'scheduled', 3, 'n0', 'pub', 1, 1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), AT);
  for (const [platform, status, extra] of targets) {
    const container = extra && 'container' in extra ? extra.container : status === 'publishing' ? 'c1' : null;
    db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, container_id, claimed_at) VALUES ('p1', ?, ?, ?, ?)`)
      .run(platform, status, container ?? null, extra?.claimedAt ?? null);
  }
}
const targetRows = (db: import('node:sqlite').DatabaseSync) =>
  db.prepare(`SELECT platform, status, container_id, claimed_at FROM social_post_targets ORDER BY platform`).all().map((r) => ({ ...r }));
const body = { revision: 3, type: 'image', caption: 'Değişti', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: AT };

test('an edit is refused once a target has started publishing', async () => {
  const { env, db } = setupSocial();
  seed(db, [['instagram', 'publishing']]);
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'publishing_started');
  assert.equal((db.prepare(`SELECT container_id FROM social_post_targets`).get() as { container_id: string }).container_id, 'c1');
});

test('cancel is refused once a target has been published', async () => {
  const { env, db } = setupSocial();
  seed(db, [['instagram', 'published']]);
  const res = await call(cancel, 'POST', '/api/social/posts/p1/cancel', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 3 } });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'publishing_started');
});

test('re-writing targets keeps the ones already started and replaces the rest', async () => {
  const { db, env } = setupSocial();
  seed(db, [['instagram', 'published'], ['linkedin', 'failed']]);
  const raw = (env as { DB: D1Database }).DB;
  await raw.batch(targetStatements(raw, 'p1', 'n0', ['instagram', 'linkedin'], NOW()));
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ platform: 'instagram', status: 'published' }, { platform: 'linkedin', status: 'queued' }]);
});

/** A failed post whose Instagram target failed; container null means Instagram never held one for it (or reported it ERROR). */
function seedFailed(db: import('node:sqlite').DatabaseSync, container: string | null = null) {
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, write_nonce, created_by, approved_by, approved_at, event_mode_id, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?, '["instagram"]', ?, 'failed', 3, 'n0', 'ed', 'pub', 5, 'ev1', 1, 1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), AT);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, container_id) VALUES ('p1', 'instagram', 'failed', ?)`).run(container);
}

test('an editor fixing a failed post sends it back for approval: approval cleared, publishers mailed', async () => {
  const mail = stubMail();
  try {
    const { env, db, waits } = setupSocial();
    db.exec('PRAGMA foreign_keys = OFF');
    seedFailed(db);
    const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'ed', params: { id: 'p1' }, body, waits });
    assert.equal(res.status, 200);
    assert.equal((await res.json() as { status: string }).status, 'pending_approval');
    const row = db.prepare(`SELECT status, approved_by, approved_at, event_mode_id FROM social_posts WHERE id = 'p1'`).get() as Record<string, unknown>;
    assert.deepEqual({ ...row }, { status: 'pending_approval', approved_by: null, approved_at: null, event_mode_id: null });
    await settle(waits);
    assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'pub@example.org']);
    assert.match(mail.sent[0].subject, /Onay bekleyen gönderi/);
  } finally { mail.restore(); }
});

test('a publisher fixing a failed post reschedules it with fresh queued targets', async () => {
  const { env, db } = setupSocial();
  db.exec('PRAGMA foreign_keys = OFF');
  seedFailed(db, null);
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body: { ...body, platforms: ['instagram', 'linkedin'] } });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { status: string }).status, 'scheduled');
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ platform: 'instagram', status: 'queued' }, { platform: 'linkedin', status: 'queued' }]);
});

// A target that may own a container Instagram already published is never deleted or replaced: edit and cancel refuse, the row stays as it was.
async function refusedBoth(targets: Seeded[]) {
  for (const which of ['patch', 'cancel'] as const) {
    const { env, db } = setupSocial();
    seed(db, targets);
    const before = targetRows(db);
    const res = which === 'patch'
      ? await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body })
      : await call(cancel, 'POST', '/api/social/posts/p1/cancel', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 3 } });
    assert.equal(res.status, 409, which);
    assert.equal((await res.json() as { code: string }).code, 'publishing_started', which);
    assert.deepEqual(targetRows(db), before, `${which}: targets untouched`);
    assert.equal((db.prepare(`SELECT status FROM social_posts`).get() as { status: string }).status, 'scheduled', which);
  }
}

test('a failed target that holds a container: edit and cancel are refused, the row is untouched', async () => {
  await refusedBoth([['instagram', 'failed', { container: 'c1' }], ['linkedin', 'queued']]);
});

test('a queued target that holds a container (re-queued after a wait): edit and cancel are refused', async () => {
  await refusedBoth([['instagram', 'queued', { container: 'c1' }]]);
});

test('a target a tick claimed a minute ago: edit and cancel are refused', async () => {
  await refusedBoth([['instagram', 'queued', { claimedAt: NOW() - 60 }]]);
});

test('a claim older than the lease does not hold an edit', async () => {
  const { env, db } = setupSocial();
  seed(db, [['instagram', 'queued', { claimedAt: NOW() - 601 }]]);
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body });
  assert.equal(res.status, 200);
  assert.deepEqual(targetRows(db), [{ platform: 'instagram', status: 'queued', container_id: null, claimed_at: null }]);
});

test('a failed post whose target holds no container: a publisher edit re-queues it fresh', async () => {
  const { env, db } = setupSocial();
  db.exec('PRAGMA foreign_keys = OFF');
  seedFailed(db, null);
  db.prepare(`UPDATE social_post_targets SET attempts = 4, first_tried_at = 5, last_error = 'container_error: ERROR'`).run();
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { status: string }).status, 'scheduled');
  assert.deepEqual({ ...db.prepare(`SELECT status, attempts, first_tried_at, last_error, container_id, claimed_at, confirmed_at FROM social_post_targets`).get() as object },
    { status: 'queued', attempts: 0, first_tried_at: null, last_error: null, container_id: null, claimed_at: null, confirmed_at: null });
});

test('a failed post whose target holds a container is not editable; Retry is the way forward', async () => {
  const { env, db } = setupSocial();
  db.exec('PRAGMA foreign_keys = OFF');
  seedFailed(db, 'c1');
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'publishing_started');
  assert.equal((db.prepare(`SELECT container_id FROM social_post_targets`).get() as { container_id: string }).container_id, 'c1');
});

test('re-writing targets spares one that holds a container or a live claim', async () => {
  const { db, env } = setupSocial();
  seed(db, [['instagram', 'failed', { container: 'c1' }], ['linkedin', 'queued', { claimedAt: NOW() - 60 }]]);
  const raw = (env as { DB: D1Database }).DB;
  const before = targetRows(db);
  await raw.batch(targetStatements(raw, 'p1', 'n0', null, NOW()));
  assert.deepEqual(targetRows(db), before);
});
