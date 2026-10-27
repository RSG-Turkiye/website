import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guidesFor, heldRolesFromMe } from '../src/scripts/admin/sections/help';
import { ui } from '../src/i18n/ui';

// The nine guides of src/content/help, in `order`, with the roles each is for.
const GUIDES = [
  { slug: 'connect-claude', roles: ['all'] },
  { slug: 'social', roles: ['social'] },
  { slug: 'social-publisher', roles: ['social_publisher'] },
  { slug: 'content-editor', roles: ['content.etkinlikler.edit', 'content.yazilar.edit', 'content.ogrenme.edit', 'content.topluluk.edit', 'content.sayfalar.edit'] },
  { slug: 'content-approver', roles: ['content.etkinlikler.approve', 'content.yazilar.approve', 'content.ogrenme.approve', 'content.topluluk.approve', 'content.sayfalar.approve'] },
  { slug: 'announcer', roles: ['announcer'] },
  { slug: 'sender', roles: ['sender'] },
  { slug: 'symposium', roles: ['symposium'] },
  { slug: 'admin', roles: ['admin'] },
];

test('admin sees every guide', () => {
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
