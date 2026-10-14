import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { stubGraph } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
import { onRequestGet as debug, redactTokens } from '../functions/api/admin/social/dm/debug';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';

test('redactTokens hides access_token in paging links', () => {
  const out = JSON.stringify(redactTokens({ paging: { next: 'https://graph.instagram.com/v25.0/x?access_token=SECRET123&after=a' } }));
  assert.ok(!out.includes('SECRET123'));
  assert.match(out, /access_token=REDACTED&after=a/);
});

test('debug is admin only and never returns the token', async () => {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY } as never;
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env, 'instagram', {
    accountId: IG, accountName: 'rsg_test', accessToken: 'tok-SECRET', refreshToken: null,
    scopes: 'instagram_business_basic,instagram_business_manage_messages', expiresAt: now + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', now - 86400)).run();
  assert.equal((await call(debug, 'GET', '/api/admin/social/dm/debug', { env, as: 'pub' })).status, 403);
  const g = stubGraph((c) => Response.json({ data: [], paging: { next: `https://graph.instagram.com/v25.0${c.path}?access_token=${c.params.get('access_token')}` } }));
  let body = '';
  try { body = await (await call(debug, 'GET', '/api/admin/social/dm/debug', { env, as: 'admin' })).text(); } finally { g.restore(); }
  assert.ok(!body.includes('tok-SECRET'));
  assert.match(body, /meConversations/);
});
