import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNoindexPath } from '../src/lib/noindex-routes';

test('the sign-in, account, admin and member pages are kept out of the index', () => {
  for (const path of [
    '/login/', '/account/', '/account/mail/', '/account/setup/', '/account/conversations/',
    '/admin/', '/members/', '/members/profile/',
  ]) {
    assert.equal(isNoindexPath(path), true, path + ' must be noindex');
  }
});

test('the turkish copy of a private page is treated the same as the english one', () => {
  for (const path of ['/tr/login/', '/tr/account/', '/tr/account/mail/', '/tr/account/conversations/', '/tr/admin/', '/tr/members/']) {
    assert.equal(isNoindexPath(path), true, path + ' must be noindex');
  }
});

test('the public pages we want ranked are left alone', () => {
  for (const path of [
    '/', '/tr/', '/tr', '/about/', '/blog/', '/blog/some-post/', '/webinars/',
    '/resources/', '/learning-paths/', '/events/', '/join/', '/tags/', '/search/',
    '/tr/about/', '/tr/blog/some-post/',
  ]) {
    assert.equal(isNoindexPath(path), false, path + ' must stay indexable');
  }
});

test('a prefix only matches on a whole path segment', () => {
  // '/accounts' must not be swept up by the '/account' rule.
  for (const path of ['/accounts/', '/logins/', '/administration/', '/membership/']) {
    assert.equal(isNoindexPath(path), false, path + ' must stay indexable');
  }
});

test('paths are matched with or without a trailing slash', () => {
  assert.equal(isNoindexPath('/admin'), true);
  assert.equal(isNoindexPath('/admin/'), true);
  assert.equal(isNoindexPath('/tr/admin'), true);
});
