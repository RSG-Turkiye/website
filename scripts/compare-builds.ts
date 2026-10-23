/**
 * Compare two builds of the site and report what differs. The content-into-
 * collections work promises "no visible change"; this is how that is checked.
 * Only .html, .xml and .txt files are compared; scripts, styles, images and
 * the rest are ignored. An empty tree, one without an index.html, or a
 * missing directory is an error (exit 2), never "identical": a build that
 * failed must not pass this check. Asset file names carry a content hash
 * that changes whenever any bundled CSS or JS changes, so
 * `/_astro/<name>.<hash>.<ext>` is rewritten to `/_astro/<name>.<ext>` first.
 *
 * The promise is about the rendered page, not the bytes, so two differences a
 * browser cannot see are normalised away on both sides:
 *   - Entity spelling. Astro escapes `'` and `"` inside an expression
 *     (`&#39;`) but not in literal template text, so moving a sentence into a
 *     content file changes its bytes. `&#39;`, `&#x27;`, `&apos;` become `'`
 *     and `&quot;`, `&#34;`, `&#x22;` become `"`. The numeric forms of `&`, `<`
 *     and `>` become `&amp;`, `&lt;`, `&gt;`, but these three are never
 *     decoded to the bare character: `&lt;b&gt;` shows the text "<b>", `<b>`
 *     is bold, and that difference must still be reported.
 *   - Whitespace runs. Literal text keeps the newlines around a label;
 *     an expression gets a single space. Any run of spaces, tabs and newlines
 *     becomes one space, which is how HTML renders it. Inside `<pre>` and
 *     `<textarea>` whitespace is shown as written, so it is left alone there.
 * A run is never removed, only shortened, so "a b" against "ab", a dropped
 * space next to a tag, or any changed word is still a difference.
 *
 *   npx tsx scripts/compare-builds.ts <before> <after>   (exit 1 on any difference)
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = /\.(html|xml|txt)$/;

const files = (root: string) => {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`not a directory: ${root}`);
  const found: string[] = [];
  const go = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) go(p);
      else if (EXT.test(name)) found.push(relative(root, p));
    }
  };
  go(root);
  if (found.length === 0) throw new Error(`no html, xml or txt files in ${root}`);
  if (!found.includes('index.html')) throw new Error(`no index.html in ${root}; is it a build?`);
  return found.sort();
};

const hashes = (s: string) => s.replace(/\/_astro\/([^"'\s)]*?)\.[A-Za-z0-9_-]{8,}\.(css|js|mjs)/g, '/_astro/$1.$2');

const entities = (s: string) =>
  s
    .replace(/&(?:#0*39|#[xX]0*27|apos);/g, "'")
    .replace(/&(?:#0*34|#[xX]0*22|quot);/g, '"')
    .replace(/&(?:#0*38|#[xX]0*26);/g, '&amp;')
    .replace(/&(?:#0*60|#[xX]0*3[cC]);/g, '&lt;')
    .replace(/&(?:#0*62|#[xX]0*3[eE]);/g, '&gt;');

// Split off <pre> and <textarea> elements (kept as written) from the rest.
const VERBATIM = /(<(pre|textarea)\b[\s\S]*?<\/\2\s*>)/gi;
const whitespace = (s: string) =>
  s
    .split(VERBATIM)
    .map((part, i) => (i % 3 === 0 ? part.replace(/[ \t\r\n\f]+/g, ' ') : i % 3 === 1 ? part : ''))
    .join('');

export const normalise = (s: string) => whitespace(entities(hashes(s)));

export function compareBuilds(before: string, after: string): { changed: string[]; added: string[]; removed: string[] } {
  const a = new Set(files(before));
  const b = new Set(files(after));
  const changed: string[] = [];
  for (const f of a) {
    if (b.has(f) && normalise(readFileSync(join(before, f), 'utf8')) !== normalise(readFileSync(join(after, f), 'utf8'))) changed.push(f);
  }
  return {
    changed: changed.sort(),
    added: [...b].filter((f) => !a.has(f)).sort(),
    removed: [...a].filter((f) => !b.has(f)).sort(),
  };
}

// realpath on both sides: a symlinked path to this script must still run it.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const [before, after] = process.argv.slice(2);
  if (!before || !after) {
    console.error('usage: npx tsx scripts/compare-builds.ts <before> <after>');
    process.exit(2);
  }
  let r;
  try {
    r = compareBuilds(before, after);
  } catch (e) {
    console.error(`compare-builds: ${(e as Error).message}`);
    process.exit(2);
  }
  for (const f of r.added) console.log(`added:   ${f}`);
  for (const f of r.removed) console.log(`removed: ${f}`);
  for (const f of r.changed) {
    // Pages are mostly one line once whitespace is folded, so show the first
    // differing character with some context rather than a line.
    const x = normalise(readFileSync(join(before, f), 'utf8'));
    const y = normalise(readFileSync(join(after, f), 'utf8'));
    let i = 0;
    while (i < x.length && x[i] === y[i]) i++;
    const at = Math.max(0, i - 80);
    console.log(`changed: ${f}\n  at character ${i}\n  - ${x.slice(at, i + 120)}\n  + ${y.slice(at, i + 120)}`);
  }
  const n = r.added.length + r.removed.length + r.changed.length;
  console.log(n === 0 ? 'builds are identical' : `${n} file(s) differ`);
  process.exit(n === 0 ? 0 : 1);
}
