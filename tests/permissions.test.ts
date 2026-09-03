import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageSymposium } from '../functions/_lib/auth';

test('an admin may manage the symposium', () => {
  assert.equal(canManageSymposium({ is_admin: 1, is_symposium: 0 }), true);
});

test('the symposium role may manage the symposium', () => {
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 1 }), true);
});

test('nobody else may', () => {
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 0 }), false);
});

test('the check is on the integer D1 stores, not a boolean', () => {
  // canManageAnnouncements compares === 1 while admin-panel.ts compares === true
  // against the API's JSON. Server-side helpers follow the server-side shape.
  assert.equal(canManageSymposium({ is_admin: 1 as unknown as number, is_symposium: 0 }), true);
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 0 }), false);
});
