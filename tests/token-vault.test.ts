import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, VaultError } from '../functions/_lib/token-vault';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');

test('a sealed token opens with the same key and context', async () => {
  const sealed = await seal(KEY, 'refresh-abc', 'gmail:refresh');
  assert.match(sealed, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!sealed.includes('refresh-abc'));
  assert.equal(await unseal(KEY, sealed, 'gmail:refresh'), 'refresh-abc');
});

test('two seals of the same token differ (fresh IV)', async () => {
  assert.notEqual(await seal(KEY, 't', 'c'), await seal(KEY, 't', 'c'));
});

test('a token sealed for one platform does not open as another', async () => {
  const sealed = await seal(KEY, 't', 'gmail:refresh');
  await assert.rejects(unseal(KEY, sealed, 'instagram:refresh'), VaultError);
});

test('wrong key, tampering, and garbage all fail as VaultError', async () => {
  const sealed = await seal(KEY, 't', 'c');
  await assert.rejects(unseal(OTHER, sealed, 'c'), VaultError);
  const [v, iv, ct] = sealed.split('.');
  const flipped = `${v}.${iv}.${ct.slice(0, -4)}AAA=`;
  await assert.rejects(unseal(KEY, flipped, 'c'), VaultError);
  await assert.rejects(unseal(KEY, 'not-a-token', 'c'), VaultError);
});

test('a missing or wrong-length key is a VaultError, not a crash', async () => {
  await assert.rejects(seal(undefined, 't', 'c'), /TOKEN_ENC_KEY is not set/);
  await assert.rejects(seal(Buffer.alloc(16).toString('base64'), 't', 'c'), /32 bytes/);
  await assert.rejects(unseal('%%%', 'v1.a.b', 'c'), VaultError);
});
