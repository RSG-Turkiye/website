import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestGet as me } from '../functions/api/me';
import { onRequestPost as logout } from '../functions/auth/logout';
import { hasSignedInMarker } from '../functions/_lib/auth';

/**
 * The header skips /api/me unless the readable rsg_signed_in marker is there,
 * so the marker must follow the real session: given at sign-in (and to
 * sessions older than the marker, by /api/me), taken away at sign-out and
 * when the session it stood for has gone.
 */
const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { DB: d1(db) };
}
const call = (h: unknown, req: Request, env: unknown) => (h as (c: unknown) => Promise<Response>)({ request: req, env });
const cookies = (res: Response) => res.headers.getSetCookie();

test('a signed-in visitor without the marker is given it', async () => {
  const res = await call(me, new Request(`${BASE}/api/me`, { headers: { Cookie: 'rsg_session=s1' } }), setup());
  assert.equal(res.status, 200);
  const set = cookies(res).find((c) => c.startsWith('rsg_signed_in=1'));
  assert.ok(set, 'marker set');
  assert.doesNotMatch(set, /HttpOnly/, 'the page must be able to read it');
});

test('a visitor who already has it is not sent it again', async () => {
  const res = await call(me, new Request(`${BASE}/api/me`, { headers: { Cookie: 'rsg_session=s1; rsg_signed_in=1' } }), setup());
  assert.equal(cookies(res).length, 0);
});

test('a marker whose session has gone is cleared', async () => {
  const res = await call(me, new Request(`${BASE}/api/me`, { headers: { Cookie: 'rsg_session=expired; rsg_signed_in=1' } }), setup());
  assert.equal(res.status, 401);
  assert.ok(cookies(res).some((c) => /^rsg_signed_in=;.*Max-Age=0/.test(c)), cookies(res).join(' | '));
});

test('signing out clears the marker with the session', async () => {
  const res = await call(logout, new Request(`${BASE}/auth/logout`, { method: 'POST', headers: { Cookie: 'rsg_session=s1; rsg_signed_in=1' } }), setup());
  const set = cookies(res);
  assert.ok(set.some((c) => /^rsg_session=;.*Max-Age=0/.test(c)), 'session cleared');
  assert.ok(set.some((c) => /^rsg_signed_in=;.*Max-Age=0/.test(c)), 'marker cleared');
});

test('the marker is recognised only as itself', () => {
  const req = (cookie: string) => new Request(BASE, { headers: { Cookie: cookie } });
  assert.equal(hasSignedInMarker(req('rsg_signed_in=1')), true);
  assert.equal(hasSignedInMarker(req('a=b; rsg_signed_in=1; c=d')), true);
  assert.equal(hasSignedInMarker(req('rsg_signed_in=10')), false);
  assert.equal(hasSignedInMarker(req('xrsg_signed_in=1')), false);
  assert.equal(hasSignedInMarker(req('')), false);
});

test('sign-in sets the marker on both of its redirects', () => {
  // The callback needs Google to run, so this reads it: two session cookies,
  // two markers.
  const src = readFileSync(new URL('../functions/auth/callback.ts', import.meta.url).pathname, 'utf8');
  assert.equal((src.match(/sessionCookie\(token, expires\)/g) ?? []).length, 2);
  assert.equal((src.match(/signedInMarker\(expires\)/g) ?? []).length, 2);
});
