import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import {
  connectionStatus, connectionUpsert, getConnection, markOk, markBroken, readRefreshToken,
  disconnectStatement, EXPIRING_WINDOW_SECONDS, type ConnectionRow,
} from '../functions/_lib/connections';
import { healthIssues, SCHEDULER_STALE_SECONDS } from '../functions/_lib/health';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = 1_800_000_000;
const blank: ConnectionRow = {
  platform: 'instagram', account_id: null, account_name: null, access_token_enc: null, refresh_token_enc: null,
  scopes: null, expires_at: null, refresh_expires_at: null, connected_by: null, connected_at: null,
  last_ok_at: null, last_error: null, last_error_at: null,
};

test('status is derived from the row', () => {
  assert.equal(connectionStatus(null, NOW), 'unused');
  assert.equal(connectionStatus(blank, NOW), 'unused', 'a health-only row with no token is not a connection');
  const live = { ...blank, access_token_enc: 'x', expires_at: NOW + 60 * 86400 };
  assert.equal(connectionStatus(live, NOW), 'connected');
  assert.equal(connectionStatus({ ...live, expires_at: NOW + EXPIRING_WINDOW_SECONDS }, NOW), 'expiring');
  assert.equal(connectionStatus({ ...live, expires_at: NOW }, NOW), 'broken');
  assert.equal(connectionStatus({ ...live, last_error_at: NOW - 5, last_ok_at: NOW - 10 }, NOW), 'broken');
  assert.equal(connectionStatus({ ...live, last_error_at: NOW - 10, last_ok_at: NOW - 5 }, NOW), 'connected', 'a success after the error clears it');
  assert.equal(connectionStatus({ ...live, refresh_expires_at: NOW + 3 * 86400 }, NOW), 'expiring', 'the refresh expiry wins when present');
});

test('Gmail on the legacy secret counts as connected, and can break', () => {
  const gmail = { ...blank, platform: 'gmail' as const };
  assert.equal(connectionStatus(null, NOW, true), 'connected');
  assert.equal(connectionStatus({ ...gmail, last_error_at: NOW, last_error: 'invalid_grant' }, NOW, true), 'broken');
});

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, env: { DB: d1(db) as never, TOKEN_ENC_KEY: KEY } };
}

test('a stored connection keeps tokens sealed and reads back', async () => {
  const { db, env } = setup();
  const stmt = await connectionUpsert(env, 'gmail', {
    accountId: null, accountName: 'turkey.rsg@gmail.com', accessToken: null, refreshToken: 'r-123',
    scopes: 'a b', expiresAt: null, refreshExpiresAt: null,
  }, 'u1', NOW);
  await stmt.run();
  const raw = db.prepare('SELECT * FROM platform_connections').get() as Record<string, unknown>;
  assert.ok(!JSON.stringify(raw).includes('r-123'));
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(await readRefreshToken(env, row), 'r-123');
  assert.equal(row.connected_by, 'u1');
  assert.equal(row.last_ok_at, NOW);
});

test('reconnecting clears an earlier error', async () => {
  const { env } = setup();
  await markBroken(env.DB, 'gmail', 'invalid_grant', NOW - 100);
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'r', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', NOW)).run();
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(row.last_error, null);
  assert.equal(row.last_error_at, null);
});

test('markOk and markBroken create a health-only row when none exists', async () => {
  const { env } = setup();
  await markOk(env.DB, 'gmail', NOW);
  await markBroken(env.DB, 'gmail', 'x'.repeat(1000), NOW + 1);
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(row.last_ok_at, NOW);
  assert.equal(row.last_error!.length, 300, 'errors are truncated');
  assert.equal(row.refresh_token_enc, null);
});

test('disconnect removes the row', async () => {
  const { env } = setup();
  await markOk(env.DB, 'gmail', NOW);
  await disconnectStatement(env.DB, 'gmail').run();
  assert.equal(await getConnection(env.DB, 'gmail'), null);
});

test('health lists broken and expiring connections and a stale scheduler', () => {
  const issues = healthIssues({
    connections: [
      { ...blank, platform: 'instagram', access_token_enc: 'x', expires_at: NOW + 3 * 86400 },
      { ...blank, platform: 'gmail', last_error: 'invalid_grant', last_error_at: NOW },
    ],
    legacyGmail: true,
    lastRunAt: NOW - SCHEDULER_STALE_SECONDS - 1,
    lastSocialRunAt: undefined,
    now: NOW,
  });
  assert.deepEqual(issues, [
    { kind: 'connection', platform: 'gmail', status: 'broken', expiresAt: null, lastError: 'invalid_grant' },
    { kind: 'connection', platform: 'instagram', status: 'expiring', expiresAt: NOW + 3 * 86400, lastError: null },
    { kind: 'scheduler', lastRunAt: NOW - SCHEDULER_STALE_SECONDS - 1 },
  ]);
});

test('a healthy system has no issues', () => {
  assert.deepEqual(healthIssues({ connections: [], legacyGmail: true, lastRunAt: NOW - 30, lastSocialRunAt: undefined, now: NOW }), []);
});

test('the scheduler line appears when either tick has gone quiet', () => {
  const now = 1_800_000_000;
  const base = { connections: [], legacyGmail: false, now };
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: now - 60 }), []);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: now - 3600 }), [{ kind: 'scheduler', lastRunAt: now - 3600 }]);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: null }), [{ kind: 'scheduler', lastRunAt: now - 60 }]);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: undefined }), [], 'before migration 8e only mail is measured');
});
