import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import * as plans from '../functions/api/social/plans/index';
import * as plan from '../functions/api/social/plans/[id]';
import * as editors from '../functions/api/social/editors';

const NOW = Math.floor(Date.now() / 1000);
const valid = { title: 'Konuşmacı 3 tanıtımı', scheduledAt: NOW + 86400, platforms: ['instagram', 'linkedin'], postType: 'carousel', assigneeId: 'ed', note: '' };

test('an editor creates a plan; it lists in range with the assignee; the change is audited', async () => {
  const { env, db } = setupSocial();
  const res = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid });
  assert.equal(res.status, 201);
  const { id } = await res.json() as { id: string };
  const list = await (await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 2 * 86400}`, { env, as: 'ed2' })).json() as { plans: { id: string; assigneeEmail: string; platforms: string[]; postStatus: string | null }[] };
  assert.deepEqual(list.plans.map((p) => [p.id, p.assigneeEmail, p.platforms, p.postStatus]), [[id, 'ed@example.org', ['instagram', 'linkedin'], null]]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.plan.create'`).get() as { n: number }).n, 1);
});

test('bad plans are refused with a code', async () => {
  const { env } = setupSocial();
  const cases: [Record<string, unknown>, string][] = [
    [{ ...valid, title: '' }, 'invalid_title'],
    [{ ...valid, title: 'x'.repeat(121) }, 'invalid_title'],
    [{ ...valid, scheduledAt: NOW - 10 }, 'schedule_in_past'],
    [{ ...valid, platforms: [] }, 'invalid_platforms'],
    [{ ...valid, platforms: ['mastodon'] }, 'invalid_platforms'],
    [{ ...valid, postType: 'reel' }, 'invalid_post_type'],
    [{ ...valid, assigneeId: 'mem' }, 'invalid_assignee'],
    [{ ...valid, note: 'n'.repeat(501) }, 'invalid_note'],
  ];
  for (const [body, code] of cases) {
    const res = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body });
    assert.equal(res.status, 400, code);
    assert.equal((await res.json() as { code: string }).code, code);
  }
});

test('a member without a social role gets 403; nobody signed in gets 401', async () => {
  const { env } = setupSocial();
  assert.equal((await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'mem', body: valid })).status, 403);
  assert.equal((await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 10}`, { env })).status, 401);
});

test('the list needs a sane range', async () => {
  const { env } = setupSocial();
  assert.equal((await call(plans.onRequestGet, 'GET', '/api/social/plans', { env, as: 'ed' })).status, 400);
  assert.equal((await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 63 * 86400}`, { env, as: 'ed' })).status, 400);
});

test('editing a plan keeps unspecified fields, resets the reminder when the date moves, and logs before and after', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid })).json() as { id: string };
  db.prepare('UPDATE social_plans SET reminded_at = 5 WHERE id = ?').run(id);
  const res = await call(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, { env, as: 'ed2', params: { id }, body: { scheduledAt: NOW + 2 * 86400 } });
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT title, scheduled_at, reminded_at FROM social_plans WHERE id = ?').get(id) as { title: string; scheduled_at: number; reminded_at: number | null };
  assert.deepEqual([row.title, row.scheduled_at, row.reminded_at], [valid.title, NOW + 2 * 86400, null]);
  const audit = db.prepare(`SELECT details FROM audit_log WHERE action = 'social.plan.update'`).get() as { details: string };
  assert.deepEqual(JSON.parse(audit.details).changed, { scheduledAt: { from: valid.scheduledAt, to: NOW + 2 * 86400 } });
});

test('a plan with a post attached cannot be deleted; an empty one can', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid })).json() as { id: string };
  db.prepare(`UPDATE social_plans SET post_id = 'p1' WHERE id = ?`).run(id);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 409);
  db.prepare(`UPDATE social_plans SET post_id = NULL WHERE id = ?`).run(id);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM social_plans WHERE id = ?').get(id), undefined);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 404);
});

test('the editors list holds exactly the people who can be assigned', async () => {
  const { env } = setupSocial();
  const { editors: list } = await (await call(editors.onRequestGet, 'GET', '/api/social/editors', { env, as: 'ed' })).json() as { editors: { id: string; isPublisher: boolean }[] };
  assert.deepEqual(list.map((e) => [e.id, e.isPublisher]).sort(), [['admin', true], ['ed', false], ['ed2', false], ['pub', true]]);
});

test('a plan whose date has passed still takes a new title, and a demoted assignee echoed back does not block it', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid })).json() as { id: string };
  db.prepare('UPDATE social_plans SET scheduled_at = ? WHERE id = ?').run(NOW - 86400, id);
  db.prepare(`UPDATE users SET is_social = 0 WHERE id = 'ed'`).run();
  const res = await call(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, { env, as: 'ed2', params: { id }, body: { ...valid, title: 'Yeni başlık', scheduledAt: NOW - 86400 } });
  assert.equal(res.status, 200);
  assert.equal((db.prepare('SELECT title FROM social_plans WHERE id = ?').get(id) as { title: string }).title, 'Yeni başlık');
  const moved = await call(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, { env, as: 'ed2', params: { id }, body: { scheduledAt: NOW - 5 } });
  assert.equal((await moved.json() as { code: string }).code, 'schedule_in_past');
  const other = await call(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, { env, as: 'ed2', params: { id }, body: { assigneeId: 'mem' } });
  assert.equal((await other.json() as { code: string }).code, 'invalid_assignee');
});
