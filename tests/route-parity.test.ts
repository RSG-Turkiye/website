import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A Turkish page offers the same controls as its English twin.
 *
 * /blog and /tr/blog were two copies of a 230-line file. The English one grew
 * a tag filter -- a `<select id="tagFilter">`, a `data-tags` attribute on each
 * card, and a clause in the filter function. The Turkish one never did. Both
 * pages rendered, both were "translated", and nothing anywhere said that
 * Turkish readers had no way to narrow the list. It took a diff to see it.
 *
 * Prose differs between the two by design, and so do heading anchors, which
 * are generated from translated titles. What must not differ is what the
 * reader can *do*, and the honest proxy for that is the set of interactive
 * controls carrying an id: inputs, selects, buttons, textareas, forms. A
 * control on one side and not the other is a missing feature, not a missing
 * translation.
 *
 * The Turkish learning-path pages namespace their checkbox ids with `tr-` so
 * progress saved in one language does not overwrite the other. That prefix is
 * stripped before comparing -- it is the same control, deliberately named
 * apart.
 *
 * This reads dist/, so it needs a build. It skips itself when there is none,
 * which is what CI does before the build step and what a fresh clone has.
 */

const DIST = new URL('../dist/', import.meta.url).pathname;

const CONTROL = /<(?:input|select|textarea|button|form)\b[^>]*\sid="([A-Za-z][\w:-]*)"/gi;

/** The ids of interactive controls on a rendered page, Turkish prefix removed. */
function controlIds(file: string): Set<string> {
  const html = readFileSync(file, 'utf8');
  const ids = new Set<string>();
  for (const [, id] of html.matchAll(CONTROL)) ids.add(id.replace(/^tr-/, ''));
  return ids;
}

/** Every rendered page, as a path relative to dist/. */
function pages(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) pages(path, out);
    else if (name === 'index.html') out.push(relative(DIST, path));
  }
  return out;
}

test('every Turkish page offers the controls its English twin does', { skip: !existsSync(DIST) && 'no build in dist/' }, () => {
  const pairs = pages(DIST)
    .filter((p) => !p.startsWith('tr/'))
    .map((p) => ({ route: p, en: join(DIST, p), tr: join(DIST, 'tr', p) }))
    .filter((p) => existsSync(p.tr));

  assert.ok(pairs.length >= 60, `expected the bilingual routes, found ${pairs.length}`);

  const drifted: string[] = [];
  for (const { route, en, tr } of pairs) {
    const a = controlIds(en);
    const b = controlIds(tr);
    const enOnly = [...a].filter((id) => !b.has(id)).sort();
    const trOnly = [...b].filter((id) => !a.has(id)).sort();
    if (enOnly.length || trOnly.length) {
      drifted.push(
        `/${route.replace(/index\.html$/, '')}` +
          (enOnly.length ? `\n      English only: ${enOnly.join(', ')}` : '') +
          (trOnly.length ? `\n      Turkish only: ${trOnly.join(', ')}` : ''),
      );
    }
  }

  assert.deepEqual(
    drifted,
    [],
    `A control exists in one language and not the other. That is a feature one ` +
      `set of readers cannot reach:\n    ${drifted.join('\n    ')}\n  `,
  );
});

/**
 * The two things the Turkish post page silently did without.
 *
 * Controls carry ids and the test above catches them. Structured data and
 * share links do not: the Turkish post page had no <script type="ld+json">
 * and no share buttons, and the page looked complete either way. The
 * consequence was not cosmetic -- Google saw a Turkish article as an untyped
 * page, with no headline, date, author or publisher.
 */
test('a Turkish page carries the structured data and share links its English twin does', { skip: !existsSync(DIST) && 'no build in dist/' }, () => {
  const shareHosts = (html: string): string[] =>
    [...new Set([...html.matchAll(/href="https:\/\/(twitter\.com|www\.linkedin\.com)\/[^"]*"/g)].map((m) => m[1]))].sort();
  const jsonLdTypes = (html: string): string[] =>
    [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/gs)]
      .map((m) => (/"@type"\s*:\s*"([^"]+)"/.exec(m[1]) ?? [, '?'])[1] as string)
      .sort();

  const drifted: string[] = [];
  for (const route of pages(DIST).filter((p) => !p.startsWith('tr/'))) {
    const tr = join(DIST, 'tr', route);
    if (!existsSync(tr)) continue;
    const en = readFileSync(join(DIST, route), 'utf8');
    const trHtml = readFileSync(tr, 'utf8');
    const a = [jsonLdTypes(en).join(','), shareHosts(en).join(',')];
    const b = [jsonLdTypes(trHtml).join(','), shareHosts(trHtml).join(',')];
    if (a[0] !== b[0] || a[1] !== b[1]) {
      drifted.push(`/${route.replace(/index\.html$/, '')}  en=[${a}]  tr=[${b}]`);
    }
  }
  assert.deepEqual(drifted, [], `structured data or share links exist in one language only:\n    ${drifted.join('\n    ')}\n  `);
});

/**
 * Cloudflare Pages serves the 404.html nearest the requested path. Without
 * dist/tr/404.html, a mistyped URL under /tr/ answered in English.
 */
test('there is a Turkish 404 where Cloudflare Pages will look for it', { skip: !existsSync(DIST) && 'no build in dist/' }, () => {
  const tr = join(DIST, 'tr', '404.html');
  assert.ok(existsSync(join(DIST, '404.html')), 'the root 404 is still emitted');
  assert.ok(existsSync(tr), 'dist/tr/404.html is missing; /tr/* would answer in English');
  const html = readFileSync(tr, 'utf8');
  assert.match(html, /Sayfa Bulunamad/, 'the Turkish 404 is in Turkish');
  assert.doesNotMatch(html, /Page Not Found/, 'and not also in English');
});

/**
 * A year in the menu is a year with something to show.
 *
 * The webinars dropdown was five hand-written links, 2026 down to 2022. There
 * are no 2026 webinars in either language, so the menu offered a year and the
 * page it opened was empty -- and the year sets differ between languages
 * anyway (Turkish has nine 2024 talks, English has one), so one hardcoded list
 * could not be right for both. The listing filters on the #year fragment, so
 * this checks the fragment against what that page actually holds.
 */
test('every year in the webinars menu has webinars in that language', { skip: !existsSync(DIST) && 'no build in dist/' }, () => {
  for (const [label, page, listing] of [
    ['English', 'index.html', 'webinars/index.html'],
    ['Turkish', 'tr/index.html', 'tr/webinars/index.html'],
  ]) {
    const menu = new Set(
      [...readFileSync(join(DIST, page), 'utf8').matchAll(/webinars#(\d{4})/g)].map((m) => m[1]),
    );
    const present = new Set(
      [...readFileSync(join(DIST, listing), 'utf8').matchAll(/data-year="(\d{4})"/g)].map((m) => m[1]),
    );
    assert.ok(menu.size > 0, `${label}: the menu lists no years at all`);
    const empty = [...menu].filter((y) => !present.has(y)).sort();
    assert.deepEqual(empty, [], `${label} menu offers ${empty.join(', ')}, and that page has none`);
  }
});
