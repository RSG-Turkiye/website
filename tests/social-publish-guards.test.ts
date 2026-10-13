import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, settle, stubMail, KEYS } from './lib/social';
import { onRequestPatch as patch } from '../functions/api/social/posts/[id]';
import { onRequestPost as cancel } from '../functions/api/social/posts/[id]/cancel';
import { targetStatements } from '../functions/_lib/social-posts';

const AT = Math.floor(Date.now() / 1000) + 3 * 86400;

function seed(db: import('node:sqlite').DatabaseSync, targets: [string, string][]) {
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, write_nonce, created_by, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?, '["instagram","linkedin"]', ?, 'scheduled', 3, 'n0', 'pub', 1, 1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), AT);
  for (const [platform, status] of targets) {
    db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, container_id) VALUES ('p1', ?, ?, ?)`).run(platform, status, status === 'publishing' ? 'c1' : null);
  }
}
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
  await raw.batch(targetStatements(raw, 'p1', 'n0', ['instagram', 'linkedin']));
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ platform: 'instagram', status: 'published' }, { platform: 'linkedin', status: 'queued' }]);
});

function seedFailed(db: import('node:sqlite').DatabaseSync) {
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, write_nonce, created_by, approved_by, approved_at, event_mode_id, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?, '["instagram"]', ?, 'failed', 3, 'n0', 'ed', 'pub', 5, 'ev1', 1, 1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), AT);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1', 'instagram', 'failed')`).run();
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
  seedFailed(db);
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body: { ...body, platforms: ['instagram', 'linkedin'] } });
  assert.equal(res.status, 200);
  assert.equal((await res.json() as { status: string }).status, 'scheduled');
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ platform: 'instagram', status: 'queued' }, { platform: 'linkedin', status: 'queued' }]);
});
