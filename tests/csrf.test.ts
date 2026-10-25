// checkCsrf (functions/_lib/auth.ts): which pages may make a signed-in
// person's browser change something. In production only the site itself
// (and same-origin requests); localhost and *.pages.dev pages only where a
// developer set ALLOW_DEV_ORIGINS=1 in .dev.vars.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkCsrf } from '../functions/_lib/auth';

const SITE = 'https://rsg-turkiye.iscbsc.org';
const from = (origin: string | null, url = `${SITE}/api/profile`) =>
  new Request(url, { method: 'POST', headers: origin === null ? {} : { Origin: origin } });

test('production: the site and same-origin requests pass; localhost and any *.pages.dev page do not', () => {
  const env = {};
  assert.equal(checkCsrf(from(null), env), true);
  assert.equal(checkCsrf(from(SITE), env), true);
  for (const origin of ['http://localhost:4321', 'http://127.0.0.1:8788', 'https://website.pages.dev', 'https://abc123.website.pages.dev', 'https://someone-else.pages.dev', 'https://evil.example', 'http://localhost.evil.example']) {
    assert.equal(checkCsrf(from(origin), env), false, origin);
  }
  assert.equal(checkCsrf(from(SITE), { ALLOW_DEV_ORIGINS: '0' }), true);
  assert.equal(checkCsrf(from('http://localhost:4321'), { ALLOW_DEV_ORIGINS: '0' }), false);
});

test('a local preview posting to itself passes with no flag: same origin', () => {
  assert.equal(checkCsrf(from('http://localhost:4329', 'http://localhost:4329/api/profile'), {}), true);
  assert.equal(checkCsrf(from('http://localhost:4321', 'http://localhost:4329/api/profile'), {}), false);
});

test('with ALLOW_DEV_ORIGINS=1, localhost, 127.0.0.1 and *.pages.dev pages pass; other sites still do not', () => {
  const env = { ALLOW_DEV_ORIGINS: '1' };
  for (const origin of ['http://localhost:4321', 'http://localhost', 'http://127.0.0.1:8788', 'https://abc123.website.pages.dev']) {
    assert.equal(checkCsrf(from(origin), env), true, origin);
  }
  for (const origin of ['https://evil.example', 'http://localhost.evil.example', 'https://pages.dev.evil.example', 'http://website.pages.dev']) {
    assert.equal(checkCsrf(from(origin), env), false, origin);
  }
});
