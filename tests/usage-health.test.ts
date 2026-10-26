import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { DatabaseSync } from 'node:sqlite';
import { setupSocial, call } from './lib/social';
import { onRequestGet as health } from '../functions/api/admin/health';
import { agentUsageToday } from '../functions/_lib/agent-limits';

let db: DatabaseSync;
let env: never;
let envWithout: never;

const dayKey = (now: number) => String(Math.floor(now / 86400)).padStart(6, '0');
const today = () => new Date().toISOString().slice(0, 10);

beforeEach(() => {
  const s = setupSocial();
  db = s.db;
  envWithout = s.env;
  env = { ...(s.env as object), CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok' } as never;
});

function seed(now: number) {
  db.prepare('UPDATE usage_state SET checked_at = ?, measured_at = ?, day = ?, requests = 42000, rows_read = 1000000, rows_written = 20000 WHERE id = 1').run(now, now, today());
  const day = dayKey(now);
  const yesterday = dayKey(now - 86400);
  const rows: [string, number, number, number, number, number][] = [
    [`${day}:t:tok1`, 10, 0, 3, 0, 0],
    [`${day}:t:tok2`, 0, 2, 0, 1, 0],
    [`${yesterday}:t:tok1`, 500, 500, 500, 500, 500], // an earlier day
  ];
  for (const [bucket, general, reserve, writes, submits, uploads] of rows) {
    db.prepare('INSERT INTO agent_counters (bucket, user_id, general, reserve, writes, submits, uploads) VALUES (?, ?, ?, ?, ?, ?, ?)').run(bucket, 'ed', general, reserve, writes, submits, uploads);
  }
  // IP and failures rows of today are not agent requests.
  db.prepare('INSERT INTO agent_counters (bucket, requests) VALUES (?, 7), (?, 9)').run(`${day}:i:abc`, `${day}:g:failures`);
}

type Body = { issues: unknown[]; usage: Record<string, unknown> & { limits: Record<string, number> } | null };

test('health carries today\'s usage and agent sums', async () => {
  const now = Math.floor(Date.now() / 1000);
  seed(now);
  const body = await (await call(health, 'GET', '/api/admin/health', { as: 'admin', env })).json() as Body;
  assert.ok(Array.isArray(body.issues));
  const u = body.usage!;
  assert.equal(u.configured, true);
  assert.equal(u.day, today());
  assert.equal(u.requests, 42_000);
  assert.equal(u.rowsRead, 1_000_000);
  assert.equal(u.rowsWritten, 20_000);
  assert.equal(u.failed, false);
  assert.equal(u.error, null);
  assert.equal(u.agentRequests, 12);
  assert.equal(u.agentWrites, 4);
  assert.deepEqual(u.limits, { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000, agentRequests: 15_000, agentWrites: 2_000 });
});

test('an admin sees why the check failed', async () => {
  db.prepare(`UPDATE usage_state SET checked_at = 5, error = 'not authorized' WHERE id = 1`).run();
  const body = await (await call(health, 'GET', '/api/admin/health', { as: 'admin', env })).json() as Body;
  assert.equal(body.usage!.failed, true);
  assert.equal(body.usage!.error, 'not authorized');
});

test('a non-admin sees that the check failed but not why', async () => {
  db.prepare(`UPDATE usage_state SET checked_at = 5, error = 'not authorized' WHERE id = 1`).run();
  const body = await (await call(health, 'GET', '/api/admin/health', { as: 'pub', env })).json() as Body;
  assert.equal(body.usage!.failed, true);
  assert.equal(body.usage!.error, null);
});

test('without the token usage says not configured', async () => {
  const body = await (await call(health, 'GET', '/api/admin/health', { as: 'admin', env: envWithout })).json() as Body;
  assert.equal(body.usage!.configured, false);
});

test('a missing usage_state table leaves the issues intact', async () => {
  db.exec('DROP TABLE usage_state');
  const res = await call(health, 'GET', '/api/admin/health', { as: 'admin', env });
  assert.equal(res.status, 200);
  const body = await res.json() as Body;
  assert.ok(Array.isArray(body.issues));
  assert.equal(body.usage, null);
});

test('agentUsageToday sums only today\'s token rows', async () => {
  const now = Math.floor(Date.now() / 1000);
  seed(now);
  assert.deepEqual(await agentUsageToday((env as { DB: D1Database }).DB, now), { requests: 12, writes: 4 });
  assert.deepEqual(await agentUsageToday((env as { DB: D1Database }).DB, now + 86400 * 2), { requests: 0, writes: 0 });
});
