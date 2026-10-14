import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash, resolveRoute } from '../src/scripts/admin/router';
import type { RoleFlags } from '../src/scripts/admin/sections';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false, sender: false };
const admin = { ...none, admin: true };

test('hash round trip', () => {
  assert.deepEqual(parseHash('#eposta/ekler'), { section: 'eposta', sub: 'ekler', item: null });
  assert.deepEqual(parseHash('#kayit'), { section: 'kayit', sub: null, item: null });
  assert.equal(parseHash('#eposta/gelen/42')!.item, '42');
  assert.equal(parseHash('#eposta/gelen/a2')!.item, 'a2');
  assert.equal(parseHash('#eposta/gelen/t2')!.item, 't2');
  // The server's own thread-id shape: Gmail-like ids pass; dots, markup and over-long ids do not.
  assert.equal(parseHash('#eposta/gelen/18c2f3a4b5d6e7f8')!.item, '18c2f3a4b5d6e7f8');
  assert.equal(parseHash('#eposta/gelen/..')!.item, null);
  assert.equal(parseHash('#eposta/gelen/' + 'a'.repeat(129))!.item, null);
  assert.equal(parseHash('#eposta/gelen/<img>')!.item, null);
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(toHash({ section: 'eposta', sub: 'ekler', item: null }), '#eposta/ekler');
  assert.equal(toHash({ section: 'kayit', sub: null, item: null }), '#kayit');
  assert.equal(toHash({ section: 'eposta', sub: 'gelen', item: '42' }), '#eposta/gelen/42');
});

test('desktop: a section with sub-pages opens its first allowed sub-page', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null, item: null }, admin, false, false), { section: 'eposta', sub: 'gelen', item: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler', item: null }, admin, false, false), { section: 'eposta', sub: 'ekler', item: null });
});

test('phone: a section with sub-pages and no sub shows the list (sub null)', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null, item: null }, admin, true, false), { section: 'eposta', sub: null, item: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler', item: null }, admin, true, false), { section: 'eposta', sub: 'ekler', item: null });
});

test('unknown or forbidden routes fall back to landing', () => {
  const sym = { ...none, symposium: true };
  assert.deepEqual(resolveRoute({ section: 'kayit', sub: null, item: null }, sym, false, false), { section: 'sempozyum', sub: 'baski', item: null });
  assert.deepEqual(resolveRoute({ section: 'nonsense', sub: 'x', item: null }, admin, false, false), { section: 'genel', sub: null, item: null });
  assert.deepEqual(resolveRoute(null, admin, false, false), { section: 'genel', sub: null, item: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'nope', item: null }, admin, false, false), { section: 'eposta', sub: 'gelen', item: null });
});

test('a forbidden sub-page falls back to the first allowed one', () => {
  const editor = { ...none, social: true };
  assert.deepEqual(resolveRoute({ section: 'sosyal', sub: 'onay', item: null }, editor, false, false), { section: 'sosyal', sub: 'takvim', item: null });
});

test('an OAuth return always lands on Bağlantılar for an admin', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler', item: null }, admin, false, true), { section: 'baglantilar', sub: null, item: null });
  assert.deepEqual(resolveRoute(null, { ...none, social: true }, false, true), { section: 'sosyal', sub: 'takvim', item: null }, 'not for someone who cannot see it');
});

test('the thread segment survives for a sender and drops with its sub-page', () => {
  const sender = { ...none, sender: true };
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'gelen', item: '42' }, sender, false, false), { section: 'eposta', sub: 'gelen', item: '42' });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'yetki', item: '42' }, sender, false, false), { section: 'eposta', sub: 'gelen', item: null });
  assert.deepEqual(resolveRoute({ section: 'kayit', sub: null, item: '42' }, sender, false, false), { section: 'eposta', sub: 'gelen', item: null });
});
