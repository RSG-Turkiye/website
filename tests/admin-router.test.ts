import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash, resolveRoute } from '../src/scripts/admin/router';
import type { RoleFlags } from '../src/scripts/admin/sections';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false };
const admin = { ...none, admin: true };

test('hash round trip', () => {
  assert.deepEqual(parseHash('#eposta/ekler'), { section: 'eposta', sub: 'ekler' });
  assert.deepEqual(parseHash('#kayit'), { section: 'kayit', sub: null });
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(toHash({ section: 'eposta', sub: 'ekler' }), '#eposta/ekler');
  assert.equal(toHash({ section: 'kayit', sub: null }), '#kayit');
});

test('desktop: a section with sub-pages opens its first allowed sub-page', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null }, admin, false, false), { section: 'eposta', sub: 'yetki' });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, false, false), { section: 'eposta', sub: 'ekler' });
});

test('phone: a section with sub-pages and no sub shows the list (sub null)', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null }, admin, true, false), { section: 'eposta', sub: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, true, false), { section: 'eposta', sub: 'ekler' });
});

test('unknown or forbidden routes fall back to landing', () => {
  const sym = { ...none, symposium: true };
  assert.deepEqual(resolveRoute({ section: 'kayit', sub: null }, sym, false, false), { section: 'sempozyum', sub: 'baski' });
  assert.deepEqual(resolveRoute({ section: 'nonsense', sub: 'x' }, admin, false, false), { section: 'genel', sub: null });
  assert.deepEqual(resolveRoute(null, admin, false, false), { section: 'genel', sub: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'nope' }, admin, false, false), { section: 'eposta', sub: 'yetki' });
});

test('a forbidden sub-page falls back to the first allowed one', () => {
  const editor = { ...none, social: true };
  assert.deepEqual(resolveRoute({ section: 'sosyal', sub: 'onay' }, editor, false, false), { section: 'sosyal', sub: 'takvim' });
});

test('an OAuth return always lands on Bağlantılar for an admin', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, false, true), { section: 'baglantilar', sub: null });
  assert.deepEqual(resolveRoute(null, { ...none, social: true }, false, true), { section: 'sosyal', sub: 'takvim' }, 'not for someone who cannot see it');
});
