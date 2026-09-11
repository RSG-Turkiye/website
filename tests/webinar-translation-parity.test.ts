import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { counterpartSlug, type TranslatableEntry } from '../src/lib/translations';

/**
 * Every webinar exists in both languages.
 *
 * The two archives drifted twenty entries apart without anyone noticing.
 * Thirteen talks had a Turkish page and no English one -- eight of them from
 * 2024, so the English listing ran from June 2023 straight to December 2024
 * and read as if the series had stopped for a year and a half. Seven went the
 * other way.
 *
 * Nothing reported it. A webinar with one language builds fine, renders fine,
 * and looks complete on the page it is on; the hole is only visible if you
 * diff the two directories, which nobody does when adding a talk in a hurry
 * after the event.
 *
 * Pairing goes through `counterpartSlug`, the same function the language
 * toggle and the hreflang tags use -- so this fails for a Turkish file with a
 * Turkish slug and no `translationKey` exactly when the toggle would strand
 * the reader on the listing page.
 */

const WEBINARS = new URL('../src/content/webinars/', import.meta.url).pathname;

function entries(): TranslatableEntry[] {
  return globSync('*/*.md', { cwd: WEBINARS }).map((file) => {
    const text = readFileSync(join(WEBINARS, file), 'utf8');
    const end = text.indexOf('\n---', 3);
    const block = text.startsWith('---') ? text.slice(3, end === -1 ? undefined : end) : '';
    const m = /^translationKey:\s*(.*)$/m.exec(block);
    return {
      id: file.replace(/\.md$/, ''),
      data: { translationKey: m ? m[1].trim().replace(/^["']|["']$/g, '') : '' },
    };
  });
}

for (const [from, to] of [['en', 'tr'], ['tr', 'en']] as const) {
  test(`every ${from} webinar has a ${to} counterpart`, () => {
    const all = entries();
    assert.ok(all.length >= 100, `expected both webinar folders, found ${all.length} files`);

    const orphans = all
      .filter((e) => e.id.startsWith(`${from}/`))
      .filter((e) => counterpartSlug(all, e.id, to) === null)
      .map((e) => e.id);

    assert.deepEqual(
      orphans,
      [],
      `These webinars are missing their ${to.toUpperCase()} page, so that ` +
        `language's archive has a hole and the language toggle drops the ` +
        `reader on the listing:\n    ${orphans.join('\n    ')}\n  `,
    );
  });
}
