import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { onRequestPost } from '../functions/api/admin/social/plan-reminders';

const NOW = Math.floor(Date.now() / 1000);
const remind = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/social/plan-reminders', { method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {} }),
    env,
  });

function seed(db: import('node:sqlite').DatabaseSync) {
  const add = db.prepare(`INSERT INTO social_plans (id, title, scheduled_at, assignee_id, post_id, reminded_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pub', 1, 1)`);
  add.run('due', 'Konuşmacı 3', NOW + 3600, 'ed', null, null);
  add.run('later', 'Sonra', NOW + 5 * 86400, 'ed', null, null);
  add.run('filled', 'Dolu', NOW + 3600, 'ed', 'p1', null);
  add.run('done', 'Hatırlatıldı', NOW + 3600, 'ed', null, NOW - 10);
}

test('the secret gates it', async () => {
  const { env } = setupSocial();
  assert.equal((await remind(env)).status, 403);
  assert.equal((await remind(env, 'wrong')).status, 403);
});

test('only empty plans due within 48 hours, once each, to the assignee and publishers', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const mail = stubMail();
  try {
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 1 });
    assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'ed@example.org', 'pub@example.org']);
    assert.match(mail.sent[0].subject, /Konuşmacı 3/);
    assert.ok((db.prepare(`SELECT reminded_at FROM social_plans WHERE id = 'due'`).get() as { reminded_at: number }).reminded_at);
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 0 }, 'not twice');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.plan.remind'`).get() as { n: number }).n, 1);
  } finally { mail.restore(); }
});

test('when no mail can go out, the plan is tried again tomorrow', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const mail = stubMail();
  mail.fail();
  try {
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 0 });
    assert.equal((db.prepare(`SELECT reminded_at FROM social_plans WHERE id = 'due'`).get() as { reminded_at: number | null }).reminded_at, null);
  } finally { mail.restore(); }
});
