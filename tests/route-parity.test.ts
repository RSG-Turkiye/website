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
