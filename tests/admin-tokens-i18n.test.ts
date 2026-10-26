import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ui } from '../src/i18n/ui';

const keys = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => k.startsWith('admin.tokens.'));
const has = (k: string) => k in ui.en && k in ui.tr;
const value = (lang: 'en' | 'tr', k: string) => (ui[lang] as Record<string, string>)[k];

test('every agent tokens key exists in both languages', () => {
  assert.deepEqual(keys('en').sort(), keys('tr').sort());
});

test('the help box and the connected apps have every sentence', () => {
  const wanted = [
    'admin.tokens.connect.heading', 'admin.tokens.connect.claude.heading',
    ...[1, 2, 3, 4, 5].map((n) => `admin.tokens.connect.claude.step${n}`), 'admin.tokens.connect.claude.plans',
    'admin.tokens.connect.chatgpt.heading',
    ...[1, 2, 3, 4].map((n) => `admin.tokens.connect.chatgpt.step${n}`), 'admin.tokens.connect.chatgpt.plans',
    'admin.tokens.connect.menusChange',
    'admin.tokens.apps.heading', 'admin.tokens.apps.none', 'admin.tokens.apps.disconnect', 'admin.tokens.apps.disconnectConfirm',
    'admin.tokens.apps.disconnected', 'admin.tokens.apps.disconnectFailed', 'admin.tokens.apps.row.connected',
    'admin.tokens.kind.app', 'admin.tokens.row.revokedAuto',
  ];
  for (const k of wanted) assert.ok(has(k), `missing ${k}`);
  for (const lang of ['en', 'tr'] as const) {
    assert.match(value(lang, 'admin.tokens.connect.claude.step2'), /https:\/\/rsg-turkiye\.iscbsc\.org\/api\/mcp/);
    assert.match(value(lang, 'admin.tokens.apps.row.connected'), /\{date\}/);
  }
  assert.match(value('tr', 'admin.tokens.connect.claude.heading'), /Claude'a bağla/);
  assert.equal(value('tr', 'admin.tokens.apps.heading'), 'Bağlı uygulamalar');
});

test('no agent tokens sentence has an em dash or a blocked host', () => {
  for (const lang of ['en', 'tr'] as const) {
    for (const k of keys(lang)) {
      assert.ok(!value(lang, k).includes('—'), `${lang} ${k} has an em dash`);
      assert.ok(!/\.(pages|r2|workers)\.dev/.test(value(lang, k)), `${lang} ${k} names a blocked host`);
    }
  }
});

test('every key the tokens section and pane look up exists', () => {
  const used = new Set<string>();
  for (const f of ['../src/scripts/admin/sections/tokens.ts', '../src/components/admin/panes/TokensPane.astro']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    for (const m of src.matchAll(/'(admin\.tokens\.[\w.]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 30);
  for (const k of used) assert.ok(has(k), `missing ${k}`);
});
