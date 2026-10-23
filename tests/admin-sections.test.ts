import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, GROUPS, visibleSections, subsFor, landing, rolesFromMe, defaultSentScope, type RoleFlags } from '../src/scripts/admin/sections';
import { ui } from '../src/i18n/ui';

const noCms = { etkinlikler: { edit: false, approve: false } };
const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false, sender: false, cms: noCms, canGrant: [] };
const ids = (r: RoleFlags) => visibleSections(r).map((s) => s.id);

test('an admin sees every section except membership, which part 3 fills', () => {
  assert.deepEqual(ids({ ...none, admin: true, cms: rolesFromMe({ is_admin: true }).cms }), ['genel', 'istatistik', 'eposta', 'sosyal', 'duyurular', 'blog', 'sempozyum', 'icerik-etkinlikler', 'kullanicilar', 'baglantilar', 'kayit']);
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
  assert.deepEqual(rolesFromMe({ is_admin: true, is_social_publisher: true }), { admin: true, announcer: false, symposium: false, social: true, socialPublisher: true, sender: false, cms: { etkinlikler: { edit: true, approve: true } }, canGrant: [] });
  assert.deepEqual(rolesFromMe({ is_admin: 1 }), { ...none, admin: true, cms: { etkinlikler: { edit: true, approve: true } } });
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

test('the DM tab is for publishers and admins, with its own count', () => {
  const sosyal = SECTIONS.find((s) => s.id === 'sosyal')!;
  const dm = sosyal.subs.find((s) => s.id === 'dm')!;
  assert.equal(dm.publisherOnly, true);
  assert.equal(dm.count, 'dm');
  const base = { ...none, social: true };
  assert.ok(!subsFor(sosyal, base).some((s) => s.id === 'dm'), 'editor');
  assert.ok(subsFor(sosyal, { ...base, socialPublisher: true }).some((s) => s.id === 'dm'), 'publisher');
  assert.ok(subsFor(sosyal, { ...base, social: false, admin: true }).some((s) => s.id === 'dm'), 'admin');
});

test('the Sosyal menu badge counts approvals plus unread DMs; the DM tab keeps its own', () => {
  const sosyal = SECTIONS.find((s) => s.id === 'sosyal')!;
  assert.equal(sosyal.count, 'socialTotal');
  assert.equal(sosyal.subs.find((s) => s.id === 'dm')!.count, 'dm');
});

test('content rights come from the live grants /api/me carries', () => {
  const editor = rolesFromMe({ grants: [{ role: 'content.etkinlikler.edit', expires_at: 1 }] });
  assert.deepEqual(editor.cms, { etkinlikler: { edit: true, approve: false } });
  assert.deepEqual(editor.canGrant, []);
  const approver = rolesFromMe({ grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] });
  assert.deepEqual(approver.cms, { etkinlikler: { edit: true, approve: true } });
  assert.deepEqual(approver.canGrant, ['content.etkinlikler.edit']);
  assert.deepEqual(rolesFromMe({ grants: 'nonsense' }).cms, noCms);
  assert.deepEqual(rolesFromMe({}).canGrant, []);
});

test('an approver who is not an admin gets the Roles sub-page only, to grant their group\'s edit role', () => {
  const r = rolesFromMe({ grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] });
  // Their own group's content section too, so Overview leads.
  assert.deepEqual(ids(r), ['genel', 'icerik-etkinlikler', 'kullanicilar']);
  assert.equal(landing(r), 'genel');
  const users = SECTIONS.find((s) => s.id === 'kullanicilar')!;
  assert.deepEqual(subsFor(users, r).map((s) => s.id), ['yetkiler']);
  assert.deepEqual(subsFor(users, { ...none, admin: true }).map((s) => s.id), ['liste', 'yetkiler']);
});

test('Etkinlikler: editors, approvers and admins; the approval queue for approvers only', () => {
  const cms = SECTIONS.find((s) => s.id === 'icerik-etkinlikler')!;
  const editor = { ...none, cms: { etkinlikler: { edit: true, approve: false } } };
  const approverR = { ...none, cms: { etkinlikler: { edit: true, approve: true } } };
  assert.equal(cms.group, 'icerik');
  assert.deepEqual(ids(editor), ['icerik-etkinlikler']);
  assert.equal(landing(editor), 'icerik-etkinlikler');
  assert.deepEqual(subsFor(cms, editor).map((s) => s.id), ['etkinlikler', 'atolyeler', 'webinarlar', 'taslaklar']);
  assert.deepEqual(subsFor(cms, approverR).map((s) => s.id), ['etkinlikler', 'atolyeler', 'webinarlar', 'taslaklar', 'onay']);
  assert.ok(!ids(none).includes('icerik-etkinlikler'));
  const fromMe = rolesFromMe({ grants: [{ role: 'content.etkinlikler.edit' }] });
  assert.ok(ids(fromMe).includes('icerik-etkinlikler'), 'a grant opens it');
  for (const sub of cms.subs) assert.ok(sub.label in ui.tr && sub.label in ui.en, sub.label);
});
