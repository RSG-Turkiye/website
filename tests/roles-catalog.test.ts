import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleDef, resolveExpiry, type RoleDef } from '../functions/_lib/roles';

const TR = 3 * 3600;
// Türkiye wall-clock time to unix seconds.
const tr = (y: number, m: number, d: number, h = 12) => Date.UTC(y, m - 1, d, h) / 1000 - TR;
const admin = { isAdmin: true, activeRoles: ['admin'] };
const nobody = { isAdmin: false, activeRoles: [] as string[] };
const def = (k: string) => roleDef(k)!;

test('one month is a calendar month, not 30 days', () => {
  const r = resolveExpiry(def('writer'), { months: 1 }, tr(2026, 10, 23), admin);
  assert.deepEqual(r, { ok: true, expiresAt: tr(2026, 11, 23) });
});

test('a month from 31 January ends on the last day of February', () => {
  const r = resolveExpiry(def('writer'), { months: 1 }, tr(2026, 1, 31), admin);
  assert.deepEqual(r, { ok: true, expiresAt: tr(2026, 2, 28) });
});

test('edit-level roles run one month and are never permanent', () => {
  const now = tr(2026, 10, 23);
  assert.equal(resolveExpiry(def('writer'), { months: 1 }, now, admin).ok, true);
  assert.deepEqual(resolveExpiry(def('writer'), { months: 2 }, now, admin), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(def('writer'), { permanent: true }, now, admin), { ok: false, code: 'permanent_not_allowed' });
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
  assert.deepEqual(resolveExpiry(def('writer'), { until: now - 1 }, now, admin), { ok: false, code: 'in_the_past' });
  assert.deepEqual(resolveExpiry(def('writer'), { until: now }, now, admin), { ok: false, code: 'in_the_past' });
  assert.deepEqual(resolveExpiry(def('symposium'), { months: 4 as 3 }, now, admin), { ok: false, code: 'bad_duration' });
  assert.deepEqual(resolveExpiry(def('symposium'), { until: NaN }, now, admin), { ok: false, code: 'bad_duration' });
});

test('a non-admin may grant only a role they approve, for one month', () => {
  const now = tr(2026, 10, 23);
  const fixture: RoleDef = { key: 'writer', level: 'edit', approverRole: 'content.blog.approve' };
  const approver = { isAdmin: false, activeRoles: ['content.blog.approve'] };
  assert.deepEqual(resolveExpiry(fixture, { months: 1 }, now, approver), { ok: true, expiresAt: tr(2026, 11, 23) });
  assert.deepEqual(resolveExpiry(fixture, { months: 2 }, now, approver), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(fixture, { until: tr(2026, 12, 1) }, now, approver), { ok: false, code: 'too_long' });
  assert.deepEqual(resolveExpiry(fixture, { permanent: true }, now, approver), { ok: false, code: 'permanent_not_allowed' });
  assert.deepEqual(resolveExpiry(fixture, { months: 1 }, now, nobody), { ok: false, code: 'not_allowed' });
  assert.deepEqual(resolveExpiry(def('writer'), { months: 1 }, now, approver), { ok: false, code: 'not_allowed' });
  assert.deepEqual(resolveExpiry(def('admin'), { months: 1 }, now, approver), { ok: false, code: 'not_allowed' });
});

test('the catalog', () => {
  assert.deepEqual(roleDef('social_publisher')!.implies, ['social']);
  assert.equal(roleDef('writer')!.column, 'is_writer');
  assert.equal(roleDef('constructor'), null);
  assert.equal(roleDef('toString'), null);
});
