import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { guidesFor, heldRolesFromMe, audienceKey } from '../src/scripts/admin/sections/help';
import { helpSchema } from '../src/data/help';
import { parseMarkdown } from '../src/lib/cms/serialize';
import { cmsType } from '../src/lib/cms/types';
import { ui } from '../src/i18n/ui';

// The real guides (src/content/help/en), in `order`, so the filter is tested against what ships.
const DIR = new URL('../src/content/help/en/', import.meta.url).pathname;
const anyMarkdown = cmsType('webinars')!;
const GUIDES = readdirSync(DIR).filter((f) => f.endsWith('.md')).map((f) => {
  const data = helpSchema.parse(parseMarkdown(anyMarkdown, readFileSync(DIR + f, 'utf8')).frontmatter);
  return { slug: f.replace(/\.md$/, ''), roles: data.roles, order: data.order };
}).sort((a, b) => a.order - b.order);

test('admin sees every guide', () => {
  assert.equal(GUIDES.length, 9);
  assert.deepEqual(guidesFor(GUIDES, ['admin'], true), GUIDES.map((g) => g.slug));
});

test('a social editor sees connect-claude and social only', () => {
  assert.deepEqual(guidesFor(GUIDES, ['social'], false), ['connect-claude', 'social']);
});

test('a social publisher also sees the social editor guide', () => {
  assert.deepEqual(guidesFor(GUIDES, ['social_publisher'], false), ['connect-claude', 'social', 'social-publisher']);
});

test('an Etkinlikler approver sees content-approver and content-editor', () => {
  assert.deepEqual(guidesFor(GUIDES, ['content.etkinlikler.approve'], false), ['connect-claude', 'content-editor', 'content-approver']);
});

test('publisher + Etkinlikler editor: each guide once', () => {
  const out = guidesFor(GUIDES, ['social_publisher', 'content.etkinlikler.edit', 'content.yazilar.edit'], false);
  assert.deepEqual(out, ['connect-claude', 'social', 'social-publisher', 'content-editor']);
  assert.equal(new Set(out).size, out.length);
});

test('no roles: connect-claude only', () => {
  assert.deepEqual(guidesFor(GUIDES, [], false), ['connect-claude']);
});

test('an announcer, a sender and a symposium editor see their own guide', () => {
  assert.deepEqual(guidesFor(GUIDES, ['announcer', 'sender'], false), ['connect-claude', 'announcer', 'sender']);
  assert.deepEqual(guidesFor(GUIDES, ['symposium'], false), ['connect-claude', 'symposium']);
});

test('the roles held come from the is_* columns and the live grants', () => {
  const held = heldRolesFromMe({ is_sender: 1, is_social_publisher: true, is_announcer: 0, grants: [{ role: 'content.yazilar.edit' }, { role: 'sender' }] });
  assert.deepEqual([...held].sort(), ['content.yazilar.edit', 'sender', 'social_publisher']);
});

test('every real guide has a "for whom" line in both languages', () => {
  for (const g of GUIDES) {
    const key = audienceKey(g.roles);
    for (const lang of ['en', 'tr'] as const) {
      const v = (ui[lang] as Record<string, string>)[key];
      assert.ok(v && !v.includes('—'), `${lang} ${key} for ${g.slug}`);
    }
  }
});

test('the Help strings exist in both languages', () => {
  for (const key of ['admin.help.heading', 'admin.help.intro', 'admin.help.back']) {
    for (const lang of ['en', 'tr'] as const) {
      const v = (ui[lang] as Record<string, string>)[key];
      assert.ok(v && v.length > 0, `${lang} ${key}`);
      assert.ok(!v.includes('—'), `${lang} ${key} has an em dash`);
    }
  }
  assert.equal(ui.en['admin.help.heading'], 'Help');
  assert.equal(ui.tr['admin.help.heading'], 'Yardım');
});
