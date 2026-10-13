import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ui } from '../src/i18n/ui';
import { PROBLEM_CODES, ERROR_CODES, STATUS_KEYS, TARGET_STATUS_KEYS } from '../src/scripts/social/messages';
import { PUBLISH_REASON_KEYS } from '../functions/_lib/social/instagram-errors';

const keys = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => k.startsWith('admin.social.'));
const has = (k: string) => k in ui.en && k in ui.tr;

test('every social key exists in both languages', () => {
  assert.deepEqual(keys('en').sort(), keys('tr').sort());
});

test('every key the social scripts look up exists', () => {
  const dir = new URL('../src/scripts/social/', import.meta.url);
  const used = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/'(admin\.social\.[\w.]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 40);
  for (const k of used) assert.ok(has(k), `missing ${k}`);
});

test('every problem, error and status the API can return has a sentence', () => {
  for (const c of [...PROBLEM_CODES, 'unknown']) assert.ok(has(`admin.social.problem.${c}`), c);
  for (const c of [...ERROR_CODES, 'unknown']) assert.ok(has(`admin.social.error.${c}`), c);
  for (const s of STATUS_KEYS) assert.ok(has(`admin.social.status.${s}`), s);
  for (const s of TARGET_STATUS_KEYS) assert.ok(has(`admin.social.target.${s}`), s);
  for (const k of PUBLISH_REASON_KEYS) assert.ok(has(`admin.social.publishError.${k}`), k);
  for (const t of ['image', 'carousel', 'story']) assert.ok(has(`admin.social.type.${t}`), t);
});
