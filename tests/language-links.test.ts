import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A Turkish page keeps the reader on the Turkish site.
 *
 * The pattern was always the same: the label was translated and the
 * destination was not. The header's "Üyeler" went to /members, the signed-in
 * menu was hardcoded English and sent people to /account, and the "Katıl"
 * button on the Turkish learning-path pages went to /join. Every one of those
 * Turkish routes exists and was built; the pages simply were not asking for
 * them.
 *
 * Source rather than the build, because `npm test` runs before
 * `npm run build` in CI and a check reading dist/ would pass by finding
 * nothing.
 */

const TR_PAGES = new URL('../src/pages/tr/', import.meta.url).pathname;

/** Paths that are the same in both languages and correctly have no /tr twin. */
const LANGUAGE_NEUTRAL = [
  '/auth/', // sign-in and sign-out are one flow, not a page
  '/api/',
  '/_astro',
  '/logo/',
  '/flags/',
  '/images/',
  '/favicon',
  // The member profile page exists only in English. The Turkish directory
  // links to it because there is nowhere else to send a reader today --
  // see the note in issue #113. When /tr/members/profile exists, this
  // exception goes and the test starts enforcing it.
  '/members/',
];

function pages(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...pages(path));
    else if (name.endsWith('.astro')) out.push(path);
  }
  return out;
}

test('no Turkish page links to an English one', () => {
  const offenders: string[] = [];
  for (const file of pages(TR_PAGES)) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/href="(\/[^"#]*)"/g)) {
      const href = match[1];
      if (href === '/' || href.startsWith('/tr')) continue;
      if (LANGUAGE_NEUTRAL.some((p) => href.startsWith(p))) continue;
      offenders.push(`${file.slice(TR_PAGES.length)} -> ${href}`);
    }
  }
  assert.deepEqual(offenders, [], 'these leave the Turkish site');
});

test('the header asks for the members page in the page\'s own language', () => {
  const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url).pathname, 'utf8');
  assert.ok(!/href="\/members"/.test(header), 'a hardcoded /members is back');
  assert.match(header, /membersNavLink[^>]*href=\{`\$\{prefix\}\/members`\}/);
});

test('the signed-in menu is built from translations, not literals', () => {
  // It is assembled in JavaScript, so the strings and the prefix are handed
  // to the script rather than read from the markup.
  const header = readFileSync(new URL('../src/components/Header.astro', import.meta.url).pathname, 'utf8');
  for (const literal of ['>Sign In<', '>My Profile<', '>Sign Out<']) {
    assert.ok(!header.includes(literal), `hardcoded ${literal}`);
  }
  assert.match(header, /ui\.signIn/);
  assert.match(header, /ui\.myProfile/);
  assert.match(header, /ui\.signOut/);
  assert.match(header, /ui\.prefix \+ \(data\.profile \? '\/account' : '\/account\/setup'\)/);
});
