import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { consumeCode, createCode, pkceMatches } from '../functions/_lib/oauth-codes';
import { CODE_TTL, MAX_LIVE_CODES, sha256Hex } from '../functions/_lib/oauth-config';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('ed', 'g-ed', 'ed@example.org', 1, 1)`).run();
  return { db, DB: d1(db) as never as D1Database };
}

const input = {
  userId: 'ed', clientId: 'https://claude.example/oauth/client.json', label: 'claude.example',
  redirectUri: 'https://claude.example/cb', codeChallenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  scopes: ['content.events:edit', 'mcp:read'], days: 30,
};

test('a code is stored as a hash, returned once, and spent once', async () => {
  const { db, DB } = setup();
  const code = await createCode(DB, input, NOW);
  assert.ok(code);
  assert.match(code, /^rsg_oac_[A-Za-z0-9_-]{43}$/);
  const row = db.prepare('SELECT * FROM oauth_codes').get() as Record<string, unknown>;
  assert.equal(row.code_hash, await sha256Hex(code));
  assert.ok(!JSON.stringify(row).includes(code), 'the code itself is not stored');
  assert.equal(row.expires_at, NOW + CODE_TTL);

  const spent = await consumeCode(DB, code, NOW + 1);
  assert.deepEqual(spent, {
    code_hash: await sha256Hex(code), user_id: 'ed', client_id: input.clientId, label: input.label, redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge, scopes: JSON.stringify(input.scopes), days: 30, expires_at: NOW + CODE_TTL,
  });
  assert.equal(await consumeCode(DB, code, NOW + 2), null, 'single use');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get() as { n: number }).n, 0);
});

test('a code is dead after CODE_TTL', async () => {
  const { DB } = setup();
  const code = await createCode(DB, input, NOW);
  assert.ok(code);
  assert.equal(await consumeCode(DB, code, NOW + CODE_TTL), null);
});

test('an unknown value consumes nothing', async () => {
  const { db, DB } = setup();
  const code = await createCode(DB, input, NOW);
  assert.ok(code);
  assert.equal(await consumeCode(DB, 'rsg_oac_' + 'A'.repeat(43), NOW), null);
  assert.equal(await consumeCode(DB, '', NOW), null);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM oauth_codes').get() as { n: number }).n, 1);
});

test('a member holds at most MAX_LIVE_CODES live codes; expired ones go when the next is made', async () => {
  const { db, DB } = setup();
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('flo', 'g-flo', 'flo@example.org', 1, 1)`).run();
  assert.equal(MAX_LIVE_CODES, 5);
  for (let i = 0; i < 5; i++) assert.ok(await createCode(DB, input, NOW + i), `code ${i + 1}`);
  const before = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
  assert.equal(await createCode(DB, input, NOW + 5), null, 'the 6th live code');
  assert.equal((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n, before, 'a refused code writes nothing');
  assert.ok(await createCode(DB, { ...input, userId: 'flo' }, NOW + 5), 'another member is not affected');

  // The first code (made at NOW) expires at NOW + CODE_TTL; one more fits then.
  assert.ok(await createCode(DB, input, NOW + CODE_TTL), 'after one expires');
  const mine = db.prepare(`SELECT expires_at FROM oauth_codes WHERE user_id = 'ed' ORDER BY expires_at`).all() as { expires_at: number }[];
  assert.equal(mine.length, 5, 'the expired code was deleted in the same batch');
  assert.ok(mine.every((r) => r.expires_at > NOW + CODE_TTL));
  assert.equal(await createCode(DB, input, NOW + CODE_TTL), null, 'full again');
});

test('pkceMatches: RFC 7636 Appendix B', async () => {
  assert.equal(await pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'), true);
  assert.equal(await pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXK', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'), false);
  assert.equal(await pkceMatches('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM='), false, 'padding');
  // plain is never accepted: the verifier as its own challenge.
  const v = 'a'.repeat(43);
  assert.equal(await pkceMatches(v, v), false);
});

test('pkceMatches refuses a verifier outside 43 to 128 unreserved characters', async () => {
  const challengeOf = async (v: string) => {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
    return btoa(String.fromCharCode(...d)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  for (const v of ['a'.repeat(43), 'Az09._~-'.repeat(16)]) assert.equal(await pkceMatches(v, await challengeOf(v)), true, `${v.length}`);
  for (const v of ['a'.repeat(42), 'a'.repeat(129), `${'a'.repeat(42)}+`, `${'a'.repeat(42)} `, '']) {
    assert.equal(await pkceMatches(v, await challengeOf(v)), false, JSON.stringify(v));
  }
});
