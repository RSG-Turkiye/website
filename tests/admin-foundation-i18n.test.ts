import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ui } from '../src/i18n/ui';

const PREFIXES = ['admin.connections.', 'admin.audit.', 'admin.health.'];
const keys = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => PREFIXES.some((p) => k.startsWith(p)));

test('every new admin key exists in both languages', () => {
  assert.deepEqual(keys('en').sort(), keys('tr').sort());
  assert.ok(keys('en').length > 30);
});

test('every key the new scripts look up exists', () => {
  const used = new Set<string>();
  for (const f of ['admin-health', 'admin-connections', 'admin-audit', 'admin-panel']) {
    const src = readFileSync(new URL(`../src/scripts/${f}.ts`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/'((?:admin\.(?:connections|audit|health|badge\.social|action\.(?:make|remove)Social)[\w.]*))'/g)) used.add(m[1]);
  }
  for (const k of used) {
    assert.ok(k in ui.en, `en missing ${k}`);
    assert.ok(k in ui.tr, `tr missing ${k}`);
  }
});

test('each connection error code the callback can send has a sentence', () => {
  for (const code of ['bad_state', 'not_admin', 'cancelled', 'token_exchange', 'no_refresh_token', 'missing_scope', 'wrong_account', 'store_failed', 'unknown']) {
    assert.ok(`admin.connections.error.${code}` in ui.en, code);
    assert.ok(`admin.connections.error.${code}` in ui.tr, code);
  }
});
