import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ui } from '../src/i18n/ui';

/**
 * The three doors under the hero, and the two things about them that can rot.
 *
 * An outside review said the learning paths, the best content on the site,
 * were invisible from the homepage (#203). The section that fixes it is a
 * list of rows rather than a fourth card grid, and its counts are read from
 * the collections rather than typed. Both of those are easy to undo by
 * accident: a card grid is what anyone would reach for, and "82 recordings"
 * is quicker to hardcode than to derive.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIST = join(ROOT, 'dist');
const skip = !existsSync(DIST) && 'run `npm run build` first';

const KEYS = [
  'doors.heading',
  'doors.new.question', 'doors.new.detail', 'doors.new.count',
  'doors.content.question', 'doors.content.detail', 'doors.content.count',
  'doors.join.question', 'doors.join.detail', 'doors.join.end',
];

test('every door string exists in both languages', () => {
  for (const key of KEYS) {
    assert.ok(key in ui.en, `${key} missing from English`);
    assert.ok(key in ui.tr, `${key} missing from Turkish`);
    assert.notEqual(
      (ui.en as Record<string, string>)[key],
      (ui.tr as Record<string, string>)[key],
      `${key} is the same string in both languages, which means one was not translated`,
    );
  }
});

test('the counts are placeholders, not numbers someone typed', () => {
  for (const lang of ['en', 'tr'] as const) {
    for (const key of ['doors.new.count', 'doors.content.count']) {
      const value = (ui[lang] as Record<string, string>)[key];
      assert.match(value, /\{n\}/, `${lang} ${key} should interpolate a count, got "${value}"`);
      assert.doesNotMatch(value, /\d/, `${lang} ${key} has a literal digit in it: "${value}"`);
    }
  }
});

test('the rendered counts match what is actually in the repo', { skip }, () => {
  const stages = readdirSync(join(ROOT, 'src/content/lp-roadmap/en')).filter(f => f.endsWith('.md')).length;
  const webinars = readdirSync(join(ROOT, 'src/content/webinars/en')).filter(f => f.endsWith('.md')).length;
  assert.ok(stages > 0 && webinars > 0, 'expected roadmap stages and webinars to exist');

  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(home.includes(`${stages} stages`), `homepage should say "${stages} stages"`);
  assert.ok(home.includes(`${webinars} recordings`), `homepage should say "${webinars} recordings"`);

  const tr = readFileSync(join(DIST, 'tr', 'index.html'), 'utf8');
  assert.ok(tr.includes(`${stages} aşama`), `Turkish homepage should say "${stages} aşama"`);
  assert.ok(tr.includes(`${webinars} kayıt`), `Turkish homepage should say "${webinars} kayıt"`);
});

test('each door points at the page it names, in the reader language', { skip }, () => {
  const pairs: [string, string[]][] = [
    ['index.html', ['/learning-paths/roadmap/', '/webinars/', '/join/']],
    [join('tr', 'index.html'), ['/tr/learning-paths/roadmap/', '/tr/webinars/', '/tr/join/']],
  ];
  for (const [page, hrefs] of pairs) {
    const html = readFileSync(join(DIST, page), 'utf8');
    for (const href of hrefs) {
      assert.ok(html.includes(`href="${href}"`), `${page} should link to ${href}`);
      assert.ok(
        existsSync(join(DIST, href.replace(/^\//, ''), 'index.html')),
        `${href} is linked from the homepage but did not build`,
      );
    }
  }
});

test('the section is a list of rows, not a fifth card grid', { skip }, () => {
  // The whole point of the shape: the homepage already has four bordered,
  // rounded card sections. A fifth would bury these three questions rather
  // than lift them out. If someone rebuilds this as cards, the review of
  // that PR should be about the decision, not about a silent regression.
  const source = readFileSync(join(ROOT, 'src/components/EntryIndex.astro'), 'utf8');
  assert.doesNotMatch(source, /rounded-(lg|xl|2xl)/, 'the doors should not be rounded cards');
  assert.doesNotMatch(source, /shadow-/, 'the doors should not carry a card shadow');
  assert.match(source, /border-b border-\[#C4CEEA\]/, 'the rows are separated by a hairline rule');
});
