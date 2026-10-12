import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ui } from '../src/i18n/ui';

// The admin panel was rebuilt specifically so that every user-facing string
// lives in src/i18n/ui.ts under both languages -- the Turkish panel used to
// ship English labels because a pane was built once and translated by hand,
// incompletely. These tests guard the symposium pane against the same
// mistake: every `admin.symposium.*` key the English side defines must also
// exist, non-empty, on the Turkish side, and vice versa.

function symposiumKeys(lang: 'en' | 'tr'): string[] {
  return Object.keys(ui[lang]).filter((k) => k.startsWith('admin.symposium.'));
}

test('every English admin.symposium key has a Turkish counterpart', () => {
  const en = new Set(symposiumKeys('en'));
  const tr = new Set(symposiumKeys('tr'));
  const missing = [...en].filter((k) => !tr.has(k));
  assert.deepEqual(missing, [], `Turkish is missing: ${missing.join(', ')}`);
});

test('every Turkish admin.symposium key has an English counterpart', () => {
  const en = new Set(symposiumKeys('en'));
  const tr = new Set(symposiumKeys('tr'));
  const extra = [...tr].filter((k) => !en.has(k));
  assert.deepEqual(extra, [], `English is missing: ${extra.join(', ')}`);
});

test('no admin.symposium value is empty in either language', () => {
  for (const lang of ['en', 'tr'] as const) {
    for (const key of symposiumKeys(lang)) {
      const value = (ui[lang] as Record<string, string>)[key];
      assert.ok(value.length > 0, `${lang}.${key} is empty`);
    }
  }
});

test('the ten session types each have a label in both languages', () => {
  const types = [
    'opening', 'keynote', 'workshop', 'panel', 'talk', 'company', 'poster',
    'networking', 'break', 'closing',
  ];
  for (const type of types) {
    const key = `admin.symposium.sessions.type.${type}`;
    assert.ok(key in ui.en, `en missing ${key}`);
    assert.ok(key in ui.tr, `tr missing ${key}`);
  }
});

test('the certificates section has a label for every kind and every row problem', () => {
  // admin-certificates.ts builds these keys from data, so a missing one
  // would only show up as a raw key in the panel.
  const kinds = ['participation', 'workshop', 'presentation', 'appreciation'];
  const problems = ['invalid_email', 'invalid_kind', 'missing_name', 'missing_file', 'duplicate', 'not_pdf', 'too_large'];
  const keys = [
    'admin.symposium.certificates.heading',
    ...kinds.map((k) => `admin.symposium.certificates.kind.${k}`),
    ...problems.map((p) => `admin.symposium.certificates.problem.${p}`),
    'admin.symposium.certificates.csvError.empty',
    'admin.symposium.certificates.csvError.missing_columns',
  ];
  for (const key of keys) {
    assert.ok(key in ui.en, `en missing ${key}`);
    assert.ok(key in ui.tr, `tr missing ${key}`);
  }
  assert.notEqual(ui.tr['admin.symposium.certificates.heading' as keyof typeof ui.tr], ui.en['admin.symposium.certificates.heading' as keyof typeof ui.en]);
});

test('the Turkish symposium heading is not the English word', () => {
  // A cheap tripwire for the exact failure mode the shared shell was built
  // to end: a pane whose Turkish copy is quietly still English.
  assert.notEqual(ui.tr['admin.symposium.heading'], ui.en['admin.symposium.heading']);
  assert.notEqual(ui.tr['admin.symposium.speakers.heading'], ui.en['admin.symposium.speakers.heading']);
  assert.notEqual(ui.tr['admin.symposium.sessions.heading'], ui.en['admin.symposium.sessions.heading']);
  assert.notEqual(ui.tr['admin.symposium.committee.heading'], ui.en['admin.symposium.committee.heading']);
  assert.notEqual(ui.tr['admin.symposium.edition.heading'], ui.en['admin.symposium.edition.heading']);
});
