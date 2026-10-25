import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, GROUPS, visibleSections, subsFor, landing, rolesFromMe, defaultSentScope, tabHeadings, tabRuns, type RoleFlags, type SubPage } from '../src/scripts/admin/sections';
import { ui } from '../src/i18n/ui';
import { CMS_GROUPS } from '../functions/_lib/roles';

const NO = { edit: false, approve: false };
/** Content rights in every group: none, except those given. */
const cmsOnly = (given: Record<string, { edit: boolean; approve: boolean }> = {}) =>
  Object.fromEntries(CMS_GROUPS.map((g) => [g, given[g] ?? NO])) as RoleFlags['cms'];
const allCms = cmsOnly(Object.fromEntries(CMS_GROUPS.map((g) => [g, { edit: true, approve: true }])));
const noCms = cmsOnly();
const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false, sender: false, cms: noCms, canGrant: [] };
const ids = (r: RoleFlags) => visibleSections(r).map((s) => s.id);

test('an admin sees every section except membership, which part 3 fills', () => {
  assert.deepEqual(ids({ ...none, admin: true, cms: rolesFromMe({ is_admin: true }).cms }), ['genel', 'istatistik', 'eposta', 'sosyal', 'duyurular', 'sempozyum', 'icerik', 'kullanicilar', 'baglantilar', 'kayit']);
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

test('e-mail is for admins and senders, not for other roles; the old Blog section is gone', () => {
  const r = { ...none, announcer: true, symposium: true, social: true, socialPublisher: true };
  assert.ok(!SECTIONS.some((s) => (s.id as string) === 'blog'), 'blog posts are İçerik › Blog now');
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
  assert.deepEqual(rolesFromMe({ is_admin: true, is_social_publisher: true }), { admin: true, announcer: false, symposium: false, social: true, socialPublisher: true, sender: false, cms: allCms, canGrant: [] });
  assert.deepEqual(rolesFromMe({ is_admin: 1 }), { ...none, admin: true, cms: allCms });
  assert.equal(rolesFromMe({ is_sender: 1 }).sender, true);
  assert.equal(rolesFromMe({ is_sender: true }).sender, true);
});

test('every label exists in both languages and ids are safe for the audit log', () => {
  const keys = [...GROUPS.map((g) => g.label), ...SECTIONS.flatMap((s) => [s.label, ...s.subs.flatMap((x) => [x.label, ...(x.heading ? [x.heading] : [])])])];
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
  assert.deepEqual(editor.cms, cmsOnly({ etkinlikler: { edit: true, approve: false } }));
  assert.deepEqual(editor.canGrant, []);
  const approver = rolesFromMe({ grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] });
  assert.deepEqual(approver.cms, cmsOnly({ etkinlikler: { edit: true, approve: true } }));
  assert.deepEqual(approver.canGrant, ['content.etkinlikler.edit']);
  assert.deepEqual(rolesFromMe({ grants: 'nonsense' }).cms, noCms);
  assert.deepEqual(rolesFromMe({}).canGrant, []);
});

test('an approver who is not an admin gets the Roles sub-page only, to grant their group\'s edit role', () => {
  const r = rolesFromMe({ grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] });
  // Their own group's content section too, so Overview leads.
  assert.deepEqual(ids(r), ['genel', 'icerik', 'kullanicilar']);
  assert.equal(landing(r), 'genel');
  const users = SECTIONS.find((s) => s.id === 'kullanicilar')!;
  assert.deepEqual(subsFor(users, r).map((s) => s.id), ['yetkiler']);
  assert.deepEqual(subsFor(users, { ...none, admin: true }).map((s) => s.id), ['liste', 'yetkiler']);
});

const icerik = SECTIONS.find((s) => s.id === 'icerik')!;
const subIds = (r: RoleFlags) => subsFor(icerik, r).map((s) => s.id);

test('İçerik: one section for every content group; the old Etkinlikler tabs keep their ids', () => {
  const editor = { ...none, cms: cmsOnly({ etkinlikler: { edit: true, approve: false } }) };
  const approverR = { ...none, cms: cmsOnly({ etkinlikler: { edit: true, approve: true } }) };
  assert.equal(icerik.group, 'icerik');
  assert.ok(!SECTIONS.some((s) => (s.id as string) === 'icerik-etkinlikler'), 'the old section is gone (its address is an alias)');
  assert.deepEqual(ids(editor), ['icerik']);
  assert.equal(landing(editor), 'icerik');
  assert.deepEqual(subIds(editor), ['etkinlikler', 'atolyeler', 'webinarlar', 'taslaklar']);
  assert.deepEqual(subIds(approverR), ['etkinlikler', 'atolyeler', 'webinarlar', 'taslaklar', 'onay']);
  assert.ok(!ids(none).includes('icerik'));
  const fromMe = rolesFromMe({ grants: [{ role: 'content.etkinlikler.edit' }] });
  assert.ok(ids(fromMe).includes('icerik'), 'a grant opens it');
  for (const sub of icerik.subs) assert.ok(sub.label in ui.tr && sub.label in ui.en, sub.label);
});

test('İçerik: a person sees only the tabs of the groups they edit', () => {
  for (const g of CMS_GROUPS) {
    const r = { ...none, cms: cmsOnly({ [g]: { edit: true, approve: false } }) };
    assert.deepEqual(ids(r), ['icerik'], g);
    const tabs = subsFor(icerik, r).filter((s) => s.editGroup);
    assert.ok(tabs.every((s) => s.editGroup === g), `${g}: ${tabs.map((s) => s.id)}`);
    assert.ok(subIds(r).includes('taslaklar'), g);
    assert.ok(!subIds(r).includes('onay'), `${g}: an editor has no Onay`);
  }
  const yazilar = rolesFromMe({ grants: [{ role: 'content.yazilar.edit', expires_at: 1 }] });
  assert.ok(!subIds(yazilar).some((s) => ['etkinlikler', 'atolyeler', 'webinarlar'].includes(s)), 'no Etkinlikler tab for a Yazılar editor');
});

test('İçerik: Onay only for someone who approves at least one type', () => {
  // Etkinlikler has types its approvers approve.
  assert.ok(subIds({ ...none, cms: cmsOnly({ etkinlikler: { edit: true, approve: true } }) }).includes('onay'));
  assert.ok(subIds({ ...none, admin: true, cms: allCms }).includes('onay'));
  // An approver of a group with no type in the panel yet approves nothing.
  const yazilarApprover = { ...none, cms: cmsOnly({ yazilar: { edit: true, approve: true } }) };
  assert.equal(subIds(yazilarApprover).includes('onay'), subsFor(icerik, yazilarApprover).some((s) => s.editGroup === 'yazilar'));
});

test('İçerik: an admin sees every type tab, in group order, then Taslaklarım and Onay', () => {
  const r = { ...none, admin: true, cms: allCms };
  const subs = subsFor(icerik, r);
  const tabs = subs.filter((s) => s.editGroup);
  assert.deepEqual(subs.slice(tabs.length).map((s) => s.id), ['taslaklar', 'onay']);
  const order = tabs.map((s) => CMS_GROUPS.indexOf(s.editGroup!));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('tab headings: a quiet group name where the group changes, only when there are two or more groups', () => {
  const sub = (id: string, heading?: string): SubPage => ({ id, label: 'x', heading });
  assert.deepEqual(tabHeadings([sub('a', 'G1'), sub('b', 'G1'), sub('taslaklar')]), [null, null, null], 'one group: no heading, as before');
  assert.deepEqual(tabHeadings([sub('a', 'G1'), sub('b', 'G1'), sub('c', 'G2'), sub('taslaklar'), sub('onay')]), ['G1', null, 'G2', null, null]);
  assert.deepEqual(tabHeadings([]), []);
  // Today's Etkinlikler-only panel looks as it did.
  assert.ok(tabHeadings(subsFor(icerik, { ...none, cms: cmsOnly({ etkinlikler: { edit: true, approve: true } }) })).every((h) => h === null));
  for (const g of CMS_GROUPS) {
    const k = `admin.cms.groupName.${g}`;
    assert.ok(k in ui.en && k in ui.tr, k);
  }
});

test('tab runs: one tab list per content group, each named, so the group names sit outside the tab lists', () => {
  const sub = (id: string, heading?: string): SubPage => ({ id, label: 'x', heading });
  const ids = (runs: ReturnType<typeof tabRuns>) => runs.map((r) => [r.heading, r.subs.map((s) => s.id)]);
  // One group: one list, unnamed, as before.
  assert.deepEqual(ids(tabRuns([sub('a', 'G1'), sub('b', 'G1'), sub('taslaklar'), sub('onay')])), [[null, ['a', 'b', 'taslaklar', 'onay']]]);
  // Two groups: a list each, then Taslaklarım and Onay in their own.
  assert.deepEqual(ids(tabRuns([sub('a', 'G1'), sub('b', 'G1'), sub('c', 'G2'), sub('taslaklar'), sub('onay')])),
    [['G1', ['a', 'b']], ['G2', ['c']], [null, ['taslaklar', 'onay']]]);
  assert.deepEqual(tabRuns([]), []);
  // Every tab is in exactly one list, in order.
  const all = subsFor(icerik, { ...none, admin: true, cms: allCms });
  assert.deepEqual(tabRuns(all).flatMap((r) => r.subs), all);
  assert.ok(tabRuns(all).filter((r) => r.heading).length >= 2, 'an admin sees Etkinlikler and Topluluk');
});
