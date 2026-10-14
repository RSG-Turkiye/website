import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, GROUPS, visibleSections, subsFor, landing, rolesFromMe, defaultSentScope, type RoleFlags } from '../src/scripts/admin/sections';
import { ui } from '../src/i18n/ui';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false, sender: false };
const ids = (r: RoleFlags) => visibleSections(r).map((s) => s.id);

test('an admin sees every section except membership, which part 3 fills', () => {
  assert.deepEqual(ids({ ...none, admin: true }), ['genel', 'eposta', 'sosyal', 'duyurular', 'blog', 'sempozyum', 'kullanicilar', 'baglantilar', 'kayit']);
});

test('one section: no Overview, and the panel lands in it', () => {
  for (const [flag, id] of [['social', 'sosyal'], ['symposium', 'sempozyum'], ['announcer', 'duyurular']] as const) {
    const r = { ...none, [flag]: true };
    assert.deepEqual(ids(r), [id], flag);
    assert.equal(landing(r), id, flag);
  }
});

test('two sections: Overview appears and is where the panel lands', () => {
  const r = { ...none, announcer: true, symposium: true };
  assert.deepEqual(ids(r), ['genel', 'duyurular', 'sempozyum']);
  assert.equal(landing(r), 'genel');
});

test('no role, no panel', () => {
  assert.deepEqual(ids(none), []);
  assert.equal(landing(none), null);
});

test('blog stays admin-only; e-mail is for admins and senders, not for other roles', () => {
  const r = { ...none, announcer: true, symposium: true, social: true, socialPublisher: true };
  assert.ok(!ids(r).includes('blog'));
  assert.ok(!ids(r).includes('eposta'));
  assert.ok(ids({ ...none, sender: true }).includes('eposta'));
});

test('a sender alone lands in E-posta with inbox, compose and sent', () => {
  const r = { ...none, sender: true };
  assert.deepEqual(ids(r), ['eposta']);
  assert.equal(landing(r), 'eposta');
  const eposta = SECTIONS.find((s) => s.id === 'eposta')!;
  assert.deepEqual(subsFor(eposta, r).map((s) => s.id), ['gelen', 'yaz', 'gonderilenler']);
});

test('E-posta sub-pages: admin-only ones need admin, compose needs sender', () => {
  const eposta = SECTIONS.find((s) => s.id === 'eposta')!;
  const subIds = (r: RoleFlags) => subsFor(eposta, r).map((s) => s.id);
  assert.deepEqual(subIds({ ...none, admin: true }), ['gelen', 'gonderilenler', 'yetki', 'gondericiler', 'ekler']);
  assert.deepEqual(subIds({ ...none, admin: true, sender: true }), ['gelen', 'yaz', 'gonderilenler', 'yetki', 'gondericiler', 'ekler']);
});

test('the approval sub-page is for publishers', () => {
  const social = SECTIONS.find((s) => s.id === 'sosyal')!;
  assert.ok(!subsFor(social, { ...none, social: true }).some((s) => s.id === 'onay'));
  assert.ok(subsFor(social, { ...none, social: true, socialPublisher: true }).some((s) => s.id === 'onay'));
  assert.ok(subsFor(social, { ...none, admin: true }).some((s) => s.id === 'onay'));
});

test('roles come from /api/me; a publisher is also a social editor', () => {
  assert.deepEqual(rolesFromMe({ is_admin: true, is_social_publisher: true }), { admin: true, announcer: false, symposium: false, social: true, socialPublisher: true, sender: false });
  assert.deepEqual(rolesFromMe({ is_admin: 1 }), { ...none, admin: true });
  assert.equal(rolesFromMe({ is_sender: 1 }).sender, true);
  assert.equal(rolesFromMe({ is_sender: true }).sender, true);
});

test('every label exists in both languages and ids are safe for the audit log', () => {
  const keys = [...GROUPS.map((g) => g.label), ...SECTIONS.flatMap((s) => [s.label, ...s.subs.map((x) => x.label)])];
  for (const k of keys) {
    assert.ok(k in ui.en, `en ${k}`);
    assert.ok(k in ui.tr, `tr ${k}`);
  }
  for (const s of SECTIONS) assert.match(s.id, /^[a-z][a-z-]{0,39}$/);
});

test('Sent starts on Mine for anyone who can send, on Everyone for an admin who cannot', () => {
  assert.equal(defaultSentScope(false, true), 'mine', 'sender');
  assert.equal(defaultSentScope(true, true), 'mine', 'admin and sender');
  assert.equal(defaultSentScope(true, false), 'all', 'admin, not a sender');
});

test('the Inbox sub-page carries the email count, so a sender-only panel shows it', () => {
  const eposta = SECTIONS.find((s) => s.id === 'eposta')!;
  const gelen = subsFor(eposta, { ...none, sender: true }).find((s) => s.id === 'gelen');
  assert.equal(gelen?.count, 'email');
});
