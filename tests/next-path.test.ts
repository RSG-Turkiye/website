import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext, readNext, nextCookie } from '../functions/_lib/next-path';
import { onRequestGet as login } from '../functions/auth/login';

test('allowed: admin and account paths, with search and hash', () => {
  assert.equal(safeNext('/tr/admin#sosyal/dm/abc-1'), '/tr/admin#sosyal/dm/abc-1');
  assert.equal(safeNext('/admin'), '/admin');
  assert.equal(safeNext('/account/mail?x=1'), '/account/mail?x=1');
  assert.equal(safeNext('/tr/account'), '/tr/account');
});

test('refused: other sites, other paths, tricks', () => {
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/admin', 'javascript:alert(1)', '/admin/../../blog',
    '/blog', '/administrator', '', '/%2F%2Fevil.example', '/admin\nSet-Cookie: x', null, 42, '/' + 'a'.repeat(600),
    '/admin\t', '/\t/evil.example', '/admin@evil.example', '/admin%5c..%5cblog', '/admin/%5Cevil.example', '/admin/%2e%2e/blog',
    '/admin/%2E%2E/%2E%2E/blog', '/admin#\\evil', '/admin\u0000', '/admin\u007f', ' /admin', '/tr/admin/..%2f..%2fblog',
    'admin', '/ADMIN', '/tr//admin', '/en/admin']) {
    assert.equal(safeNext(bad), null, String(bad));
  }
});

test('the cookie round-trips and is HttpOnly, path /auth, ten minutes', () => {
  const c = nextCookie('/tr/admin#sosyal/dm/x');
  assert.match(c, /HttpOnly/);
  assert.match(c, /Path=\/auth/);
  assert.match(c, /Max-Age=600/);
  const value = c.split(';')[0];
  assert.equal(readNext(new Request('https://x.example/auth/callback', { headers: { Cookie: `a=b; ${value}` } })), '/tr/admin#sosyal/dm/x');
  assert.equal(readNext(new Request('https://x.example/auth/callback', { headers: { Cookie: 'rsg_next=%2F%2Fevil.example' } })), null);
});

test('login stores a valid next and ignores a bad one', async () => {
  const env = { GOOGLE_CLIENT_ID: 'c' } as never;
  const ok = await login({ request: new Request('https://rsg-turkiye.iscbsc.org/auth/login?next=%2Ftr%2Fadmin%23sosyal%2Fdm%2Fx'), env } as never);
  assert.match(ok.headers.get('Set-Cookie') ?? '', /^rsg_next=/);
  const bad = await login({ request: new Request('https://rsg-turkiye.iscbsc.org/auth/login?next=%2F%2Fevil.example'), env } as never);
  assert.equal(bad.headers.get('Set-Cookie'), null);
  assert.match(bad.headers.get('Location') ?? '', /^https:\/\/accounts\.google\.com\//);
});
