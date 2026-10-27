import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash, resolveRoute } from '../src/scripts/admin/router';
import type { RoleFlags } from '../src/scripts/admin/sections';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false, sender: false, cms: { etkinlikler: { edit: false, approve: false } }, canGrant: [] };
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

test('the old Etkinlikler address is the İçerik one with its prefix swapped (PR #325 links to it)', () => {
  const editor = { ...none, cms: { etkinlikler: { edit: true, approve: false } } };
  const id = '00000000-0000-4000-8000-000000000002';
  assert.deepEqual(parseHash(`#icerik-etkinlikler/taslaklar/${id}`), { section: 'icerik', sub: 'taslaklar', item: id });
  assert.deepEqual(resolveRoute(parseHash(`#icerik-etkinlikler/taslaklar/${id}`), editor, false, false), { section: 'icerik', sub: 'taslaklar', item: id });
  assert.equal(toHash(resolveRoute(parseHash('#icerik-etkinlikler/webinarlar/_new'), editor, false, false)), '#icerik/webinarlar/_new');
  assert.equal(toHash(resolveRoute(parseHash('#icerik-etkinlikler'), editor, false, false)), '#icerik/etkinlikler');
  // Only that one prefix: a look-alike is not rewritten.
  assert.equal(parseHash('#icerik-etkinliklerx/taslaklar')!.section, 'icerik-etkinliklerx');
});

test('the old Blog section (member submissions) opens İçerik\'s Blog tab', () => {
  const admin = { ...none, admin: true, cms: { etkinlikler: { edit: true, approve: true }, yazilar: { edit: true, approve: true } } } as RoleFlags;
  assert.deepEqual(parseHash('#blog'), { section: 'icerik', sub: 'blog', item: null });
  // An old submission id after it is not a content entry: dropped.
  assert.deepEqual(parseHash('#blog/00000000-0000-4000-8000-000000000009'), { section: 'icerik', sub: 'blog', item: null });
  assert.deepEqual(parseHash('#blog/x/y'), { section: 'icerik', sub: 'blog', item: null });
  assert.equal(toHash(resolveRoute(parseHash('#blog'), admin, false, false)), '#icerik/blog');
  // Someone who no longer edits posts lands where they always would.
  assert.equal(resolveRoute(parseHash('#blog'), { ...none, sender: true }, false, false).section, 'eposta');
  assert.equal(parseHash('#blogx')!.section, 'blogx');
});

test('Help: a guide slug in the address is kept; anything that is not a slug is dropped', () => {
  const social = { ...none, social: true };
  assert.deepEqual(resolveRoute(parseHash('#yardim/social'), social, false, false), { section: 'yardim', sub: 'social', item: null });
  assert.deepEqual(resolveRoute(parseHash('#yardim/social'), social, true, false), { section: 'yardim', sub: 'social', item: null });
  assert.deepEqual(resolveRoute(parseHash('#yardim'), social, false, false), { section: 'yardim', sub: null, item: null });
  assert.equal(resolveRoute(parseHash('#yardim/../x'), social, false, false).sub, null);
  assert.equal(resolveRoute(parseHash('#yardim/NOPE!'), social, false, false).sub, null);
  assert.equal(resolveRoute(parseHash('#yardim/' + 'a'.repeat(65)), social, false, false).sub, null);
  // A well-formed slug nobody wrote is kept here; the pane falls back to the list.
  assert.deepEqual(resolveRoute(parseHash('#yardim/no-such-guide'), social, false, false), { section: 'yardim', sub: 'no-such-guide', item: null });
  // A thread id after the slug is no item of Help.
  assert.equal(resolveRoute(parseHash('#yardim/social/t2'), social, false, false).item, null);
  // Another section never keeps a sub it does not have.
  assert.equal(resolveRoute(parseHash('#sosyal/social'), social, false, false).sub, 'takvim');
  assert.equal(toHash({ section: 'yardim', sub: 'social', item: null }), '#yardim/social');
});
