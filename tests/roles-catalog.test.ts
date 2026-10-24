import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleDef, resolveExpiry, grantableBy, rightsFromRoles, CMS_GROUPS, ROLES } from '../functions/_lib/roles';

const TR = 3 * 3600;
// Türkiye wall-clock time to unix seconds.
const tr = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) / 1000 - TR;
const admin = { isAdmin: true, activeRoles: ['admin'] };
const nobody = { isAdmin: false, activeRoles: [] as string[] };
const def = (k: string) => roleDef(k)!;

test('one month is a calendar month, not 30 days', () => {
  const r = resolveExpiry(def('sender'), { months: 1 }, tr(2026, 10, 23), admin);
  assert.deepEqual(r, { ok: true, expiresAt: tr(2026, 11, 23) });
});

test('a month from 31 January ends on the last day of February', () => {
  const r = resolveExpiry(def('sender'), { months: 1 }, tr(2026, 1, 31), admin);
  assert.deepEqual(r, { ok: true, expiresAt: tr(2026, 2, 28) });
});

test('edit-level roles run one month and are never permanent', () => {
  const now = tr(2026, 10, 23);
  assert.equal(resolveExpiry(def('sender'), { months: 1 }, now, admin).ok, true);
  assert.deepEqual(resolveExpiry(def('sender'), { months: 2 }, now, admin), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(def('sender'), { permanent: true }, now, admin), { ok: false, code: 'permanent_not_allowed' });
});

test('leader-level roles run up to twelve months, or permanent from an admin', () => {
  const now = tr(2026, 10, 23);
  assert.deepEqual(resolveExpiry(def('symposium'), { months: 12 }, now, admin), { ok: true, expiresAt: tr(2027, 10, 23) });
  assert.deepEqual(resolveExpiry(def('symposium'), { permanent: true }, now, admin), { ok: true, expiresAt: null });
  assert.deepEqual(resolveExpiry(def('symposium'), { until: tr(2027, 11, 23) }, now, admin), { ok: false, code: 'too_long' });
  assert.equal(resolveExpiry(def('symposium'), { until: tr(2027, 10, 23) }, now, admin).ok, true);
});

test('a custom end date is used as given', () => {
  const now = tr(2026, 10, 23);
  assert.deepEqual(resolveExpiry(def('sender'), { until: tr(2026, 11, 10) }, now, admin), { ok: true, expiresAt: tr(2026, 11, 10) });
});

test('a past end date and an unoffered length are refused', () => {
  const now = tr(2026, 10, 23);
  assert.deepEqual(resolveExpiry(def('sender'), { until: now - 1 }, now, admin), { ok: false, code: 'in_the_past' });
  assert.deepEqual(resolveExpiry(def('sender'), { until: now }, now, admin), { ok: false, code: 'in_the_past' });
  assert.deepEqual(resolveExpiry(def('symposium'), { months: 4 as 3 }, now, admin), { ok: false, code: 'bad_duration' });
  assert.deepEqual(resolveExpiry(def('symposium'), { until: NaN }, now, admin), { ok: false, code: 'bad_duration' });
});

test('a non-admin may grant only a role they approve, for one month', () => {
  const now = tr(2026, 10, 23);
  const approver = { isAdmin: false, activeRoles: ['content.etkinlikler.approve'] };
  const edit = def('content.etkinlikler.edit');
  assert.deepEqual(resolveExpiry(edit, { months: 1 }, now, approver), { ok: true, expiresAt: tr(2026, 11, 23) });
  assert.deepEqual(resolveExpiry(edit, { months: 2 }, now, approver), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(edit, { until: tr(2026, 12, 1) }, now, approver), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(edit, { permanent: true }, now, approver), { ok: false, code: 'permanent_not_allowed' });
  assert.deepEqual(resolveExpiry(edit, { months: 1 }, now, nobody), { ok: false, code: 'not_allowed' });
  assert.deepEqual(resolveExpiry(def('content.etkinlikler.approve'), { months: 1 }, now, approver), { ok: false, code: 'not_allowed' });
  assert.deepEqual(resolveExpiry(def('sender'), { months: 1 }, now, approver), { ok: false, code: 'not_allowed' });
  assert.deepEqual(resolveExpiry(def('admin'), { months: 1 }, now, approver), { ok: false, code: 'not_allowed' });
  // An editor is not an approver.
  const editor = { isAdmin: false, activeRoles: ['content.etkinlikler.edit'] };
  assert.deepEqual(resolveExpiry(edit, { months: 1 }, now, editor), { ok: false, code: 'not_allowed' });
});

test('the Etkinlikler roles: edit renews monthly, approve is a leader role, neither has a column', () => {
  const edit = def('content.etkinlikler.edit');
  const approve = def('content.etkinlikler.approve');
  assert.equal(edit.level, 'edit');
  assert.equal(edit.approverRole, 'content.etkinlikler.approve');
  assert.equal(edit.column, undefined);
  assert.equal(approve.level, 'leader');
  assert.equal(approve.column, undefined);
  assert.equal(approve.approverRole, undefined);
  const now = tr(2026, 10, 23);
  assert.equal(resolveExpiry(approve, { months: 12 }, now, admin).ok, true);
  assert.deepEqual(resolveExpiry(edit, { months: 2 }, now, admin), { ok: false, code: 'too_long' });
});

test('grantableBy lists the roles a non-admin may hand out', () => {
  assert.deepEqual(grantableBy(['content.etkinlikler.approve']), ['content.etkinlikler.edit']);
  assert.deepEqual(grantableBy(['content.etkinlikler.edit', 'writer', 'admin']), []);
  assert.deepEqual(grantableBy([]), []);
});

test('the catalog', () => {
  assert.deepEqual(roleDef('social_publisher')!.implies, ['social']);
  assert.equal(roleDef('writer')!.column, 'is_writer');
  assert.equal(roleDef('writer')!.retired, true);
  assert.equal(roleDef('constructor'), null);
  assert.equal(roleDef('toString'), null);
});

test('writer is retired: nobody may grant it, not even an admin, and no approver lists it', () => {
  const now = tr(2026, 10, 23);
  assert.deepEqual(resolveExpiry(def('writer'), { months: 1 }, now, admin), { ok: false, code: 'retired' });
  assert.deepEqual(resolveExpiry(def('writer'), { permanent: true }, now, admin), { ok: false, code: 'retired' });
  assert.ok(!grantableBy(ROLES.map((r) => r.key)).includes('writer'));
  assert.deepEqual(ROLES.filter((r) => r.retired).map((r) => r.key), ['writer']);
});

test('every content group has an edit role (a month, its approver may grant it) and an approve role (an admin\'s)', () => {
  assert.deepEqual([...CMS_GROUPS], ['etkinlikler', 'yazilar', 'ogrenme', 'topluluk', 'sayfalar']);
  const now = tr(2026, 10, 23);
  for (const g of CMS_GROUPS) {
    const edit = def(`content.${g}.edit`);
    const approve = def(`content.${g}.approve`);
    assert.equal(edit.level, 'edit', g);
    assert.equal(edit.approverRole, `content.${g}.approve`, g);
    assert.equal(edit.column, undefined, g);
    assert.equal(approve.level, 'leader', g);
    assert.equal(approve.approverRole, undefined, g);
    assert.deepEqual(grantableBy([`content.${g}.approve`]), [`content.${g}.edit`], g);
    const approver = { isAdmin: false, activeRoles: [`content.${g}.approve`] };
    assert.equal(resolveExpiry(edit, { months: 1 }, now, approver).ok, true, g);
    assert.deepEqual(resolveExpiry(approve, { months: 1 }, now, approver), { ok: false, code: 'not_allowed' }, g);
    assert.equal(resolveExpiry(approve, { permanent: true }, now, admin).ok, true, g);
    assert.deepEqual(resolveExpiry(edit, { months: 2 }, now, admin), { ok: false, code: 'too_long' }, g);
  }
  // One group's approver grants nothing in another.
  const yaz = { isAdmin: false, activeRoles: ['content.yazilar.approve'] };
  assert.deepEqual(resolveExpiry(def('content.etkinlikler.edit'), { months: 1 }, now, yaz), { ok: false, code: 'not_allowed' });
});

test('rightsFromRoles: each group answers only for its own roles; an admin has all', () => {
  const r = rightsFromRoles(['content.yazilar.edit', 'content.sayfalar.approve'], false);
  assert.deepEqual(r, {
    etkinlikler: { edit: false, approve: false },
    yazilar: { edit: true, approve: false },
    ogrenme: { edit: false, approve: false },
    topluluk: { edit: false, approve: false },
    sayfalar: { edit: true, approve: true },
  });
  assert.ok(Object.values(rightsFromRoles([], true)).every((x) => x.edit && x.approve));
});
