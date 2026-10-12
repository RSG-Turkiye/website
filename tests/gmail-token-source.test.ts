import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { getAccessToken, resetAccessToken } from '../functions/_lib/gmail';
import { connectionUpsert, getConnection } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 5).toString('base64');

function setup(opts: { withTables?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  if (opts.withTables !== false) db.exec(SCHEMA);
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GMAIL_REFRESH_TOKEN: 'secret-token', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' };
  return { db, env };
}

function stubToken(respond: (refresh: string) => Response) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const refresh = new URLSearchParams(String(init?.body)).get('refresh_token')!;
    seen.push(refresh);
    return respond(refresh);
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}
const ok = () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });

beforeEach(() => resetAccessToken());

test('with no stored connection, the secret is used and success is recorded', async () => {
  const { env } = setup();
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(env as never), 'at');
    assert.deepEqual(f.seen, ['secret-token']);
    assert.ok((await getConnection(env.DB, 'gmail'))!.last_ok_at);
  } finally { f.restore(); }
});

test('a stored connection wins over the secret', async () => {
  const { env } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'stored-token', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 1)).run();
  const f = stubToken(ok);
  try {
    await getAccessToken(env as never);
    assert.deepEqual(f.seen, ['stored-token']);
  } finally { f.restore(); }
});

test('invalid_grant marks Gmail broken and still throws', async () => {
  const { env } = setup();
  const f = stubToken(() => new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 }));
  try {
    await assert.rejects(getAccessToken(env as never), /Token refresh failed \(400\)/);
    const row = (await getConnection(env.DB, 'gmail'))!;
    assert.match(row.last_error!, /invalid_grant/);
    assert.ok(row.last_error_at);
  } finally { f.restore(); }
});

test('a 500 from Google is not recorded as broken', async () => {
  const { env } = setup();
  const f = stubToken(() => new Response('oops', { status: 500 }));
  try {
    await assert.rejects(getAccessToken(env as never));
    assert.equal(await getConnection(env.DB, 'gmail'), null);
  } finally { f.restore(); }
});

test('an unreadable stored token (key rotated) falls back to the secret and says so', async () => {
  const { env } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'stored', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 1)).run();
  const rotated = { ...env, TOKEN_ENC_KEY: Buffer.alloc(32, 6).toString('base64') };
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(rotated as never), 'at');
    assert.deepEqual(f.seen, ['secret-token']);
    assert.match((await getConnection(env.DB, 'gmail'))!.last_error!, /could not be read/);
  } finally { f.restore(); }
});

test('before the migration (no tables) mail still gets a token from the secret', async () => {
  const { env } = setup({ withTables: false });
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(env as never), 'at');
  } finally { f.restore(); }
});

test('with neither a stored token nor the secret, the old error message stands', async () => {
  const { env } = setup();
  const f = stubToken(ok);
  try {
    await assert.rejects(getAccessToken({ ...env, GMAIL_REFRESH_TOKEN: '' } as never), /GMAIL_REFRESH_TOKEN is not configured/);
  } finally { f.restore(); }
});
