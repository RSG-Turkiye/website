import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEAD_DOMAINS = ['rsgturkey.com', 'iscbrsgturkey.wordpress.com'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no content links to a domain we no longer control', () => {
  const offenders: string[] = [];
  for (const file of walk('src/content')) {
    const text = readFileSync(file, 'utf8');
    for (const domain of DEAD_DOMAINS) {
      if (text.includes(domain)) offenders.push(`${file} -> ${domain}`);
    }
  }
  assert.deepEqual(offenders, [], 'dead links found');
});

test('the 2017-2018 news post exists exactly once', () => {
  const matches = readdirSync('src/content/blog/tr')
    .filter((f) => f.replace(/-/g, '').startsWith('rsgturkiyedenhaberler'));
  assert.equal(matches.length, 1, `found ${matches.join(', ')}`);
});

// --- duplicate detection, collection-wide ----------------------------------
// Three duplicate pairs have been found in this content by hand, each one
// only after it was already live and Google had indexed both copies. The
// named check above finds the first pair and nothing else. These two look at
// the whole collection.

/** The frontmatter title, normalised so the variations that produced every
 * duplicate so far collapse onto each other: en-dash for hyphen, curly quotes,
 * case, and runs of whitespace. */
function normalisedTitle(text: string): string | null {
  const m = /^title:\s*["']?(.+?)["']?\s*$/m.exec(text);
  if (!m) return null;
  return m[1]
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The body below the frontmatter, stripped to letters and digits, so two
 * copies that differ only by an embedded form or by punctuation still match. */
function bodyFingerprint(text: string): string {
  const body = text.replace(/^---[\s\S]*?\n---/, "");
  return body.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 600);
}

test('no two posts share a title', () => {
  const byTitle = new Map<string, string[]>();
  for (const file of walk('src/content/blog')) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
    const title = normalisedTitle(readFileSync(file, 'utf8'));
    if (!title) continue;
    // The same post in English and Turkish is a translation, not a duplicate,
    // and translations legitimately share a title when the term is the same.
    const lang = file.includes('/blog/tr/') ? 'tr' : 'en';
    const key = `${lang}::${title}`;
    byTitle.set(key, [...(byTitle.get(key) ?? []), file]);
  }
  const dupes = [...byTitle.entries()].filter(([, files]) => files.length > 1);
  assert.deepEqual(dupes.map(([k, f]) => `${k} -> ${f.join(', ')}`), []);
});

test('no two posts share an opening', () => {
  // Catches the pair that differ in title but are the same article -- the
  // shape of the second duplicate found here, where one copy carried an
  // embedded form and the other did not.
  const byBody = new Map<string, string[]>();
  for (const file of walk('src/content/blog')) {
    if (!file.endsWith('.md') && !file.endsWith('.mdx')) continue;
    const fp = bodyFingerprint(readFileSync(file, 'utf8'));
    if (fp.length < 200) continue; // too short to judge
    const lang = file.includes('/blog/tr/') ? 'tr' : 'en';
    const key = `${lang}::${fp}`;
    byBody.set(key, [...(byBody.get(key) ?? []), file]);
  }
  const dupes = [...byBody.values()].filter((files) => files.length > 1);
  assert.deepEqual(dupes.map((f) => f.join(' == ')), []);
});
