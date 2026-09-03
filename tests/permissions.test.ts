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

test('a truthy value that is not 1 does not grant access', () => {
  // D1 stores 0 or 1. Anything else is corrupt data, and a truthy check would
  // wave it through -- `=== 1` is what makes that a denial rather than a grant.
  assert.equal(canManageSymposium({ is_admin: 2, is_symposium: 0 }), false);
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: -1 }), false);
});
