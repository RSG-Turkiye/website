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
 * The promise is about the rendered page, not the bytes, so in .html files
 * two differences a browser cannot see are normalised away on both sides.
 * .txt and .xml files (robots.txt, llms.txt, feeds, sitemaps) are compared
 * byte for byte after the asset-hash step: their newlines and entities mean
 * something, so a flattened llms.txt must fail.
 *   - Entity spelling. Astro escapes `'` inside an expression (`&#39;`) but
 *     not in literal template text, so moving a sentence into a content file
 *     changes its bytes. `&#39;`, `&#x27;`, `&apos;` become `'`. For `"`, `&`,
 *     `<` and `>` only the spelling is equated (`&#34;` -> `&quot;`,
 *     `&#60;` -> `&lt;`, ...); they are never decoded to the bare character:
 *     `&lt;b&gt;` shows the text "<b>" where `<b>` is bold, and
 *     `title="a&quot;b"` parses differently from `title="a"b"`.
 *   - Whitespace runs. Literal text keeps the newlines around a label; an
 *     expression gets a single space. Any run of spaces, tabs and newlines
 *     becomes one space, which is how HTML renders it. A run is shortened,
 *     never removed, so "a b" against "ab", a dropped space next to a tag,
 *     or any changed word is still a difference.
 * `<pre>` and `<textarea>` show whitespace as written, so they keep it (their
 * entities are still equated). `<script>` and `<style>` are not HTML text at
 * all, so neither step touches them.
 *
 * For each changed file the CLI reports every separate region that differs,
 * not only the first, so a second change in a file that was changed on
 * purpose cannot hide behind the first.
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
    .replace(/&(?:#0*34|#[xX]0*22);/g, '&quot;')
    .replace(/&(?:#0*38|#[xX]0*26);/g, '&amp;')
    .replace(/&(?:#0*60|#[xX]0*3[cC]);/g, '&lt;')
    .replace(/&(?:#0*62|#[xX]0*3[eE]);/g, '&gt;');

const fold = (s: string) => s.replace(/[ \t\r\n\f]+/g, ' ');

// split() with these two groups yields [text, element, tag name, text, ...].
const VERBATIM = /(<(pre|textarea|script|style)\b[\s\S]*?<\/\2\s*>)/gi;
const html = (s: string) =>
  s
    .split(VERBATIM)
    .map((part, i, all) => {
      if (i % 3 === 0) return fold(entities(part));
      if (i % 3 === 2) return '';
      return /^(pre|textarea)$/i.test(all[i + 1]) ? entities(part) : part;
    })
    .join('');

/** A file's text as compared: see the header for what is ignored, and where. */
export const normalise = (s: string, file: string) => (file.endsWith('.html') ? html(hashes(s)) : hashes(s));

export function compareBuilds(before: string, after: string): { changed: string[]; added: string[]; removed: string[] } {
  const a = new Set(files(before));
  const b = new Set(files(after));
  const changed: string[] = [];
  for (const f of a) {
    if (b.has(f) && normalise(readFileSync(join(before, f), 'utf8'), f) !== normalise(readFileSync(join(after, f), 'utf8'), f)) changed.push(f);
  }
  return {
    changed: changed.sort(),
    added: [...b].filter((f) => !a.has(f)).sort(),
    removed: [...a].filter((f) => !b.has(f)).sort(),
  };
}

// Tags, runs of other text and runs of whitespace: a page is mostly one long
// line once whitespace is folded, so the diff works on these, not on lines.
const tokens = (s: string) => s.match(/<[^>]*>?|[^<\s]+|\s+/g) ?? [];

/** One differing region: where it starts in each text, and its text there. */
export type Region = { at: number; before: string; after: string };

/**
 * The separate regions in which two texts differ, in order, from a token diff
 * (Myers). Changes separated only by whitespace are one region. Returns null
 * when the texts differ in more than `maxEdits` tokens, which is too many to
 * list usefully.
 */
export function diffRegions(x: string, y: string, maxEdits = 2000): Region[] | null {
  const a = tokens(x);
  const b = tokens(y);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) lo++;
  let ha = a.length;
  let hb = b.length;
  while (ha > lo && hb > lo && a[ha - 1] === b[hb - 1]) { ha--; hb--; }
  const n = ha - lo;
  const m = hb - lo;
  const max = Math.min(n + m, maxEdits);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  outer: for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && a[lo + i] === b[lo + j]) { i++; j++; }
      v[off + k] = i;
      if (i >= n && j >= m) { found = d; break outer; }
    }
  }
  if (found < 0) return null;
  // Walk back from the end, marking which tokens of each side are unchanged.
  const keepA = new Uint8Array(n);
  const keepB = new Uint8Array(m);
  let i = n;
  let j = m;
  for (let d = found; d >= 0; d--) {
    const w = trace[d];
    const k = i - j;
    const pk = k === -d || (k !== d && w[off + k - 1] < w[off + k + 1]) ? k + 1 : k - 1;
    const pi = d === 0 ? 0 : w[off + pk];
    const pj = d === 0 ? 0 : pi - pk;
    while (i > pi && j > pj) { i--; j--; keepA[i] = 1; keepB[j] = 1; }
    i = pi;
    j = pj;
  }
  // Character offsets of each token, to report positions and text.
  const starts = (t: string[]) => { const o = [0]; for (const s of t) o.push(o[o.length - 1] + s.length); return o; };
  const sa = starts(a);
  const sb = starts(b);
  const regions: Region[] = [];
  let p = 0;
  let q = 0;
  while (p < n || q < m) {
    if (p < n && q < m && keepA[p] && keepB[q]) { p++; q++; continue; }
    const p0 = p;
    const q0 = q;
    // Extend over changed tokens, and over unchanged whitespace between them.
    for (;;) {
      while (p < n && !keepA[p]) p++;
      while (q < m && !keepB[q]) q++;
      let p2 = p;
      let q2 = q;
      while (p2 < n && q2 < m && keepA[p2] && keepB[q2] && /^\s+$/.test(a[lo + p2])) { p2++; q2++; }
      if (p2 > p && ((p2 < n && !keepA[p2]) || (q2 < m && !keepB[q2]))) { p = p2; q = q2; continue; }
      break;
    }
    regions.push({ at: sa[lo + p0], before: x.slice(sa[lo + p0], sa[lo + p]), after: y.slice(sb[lo + q0], sb[lo + q]) });
  }
  return regions;
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
  const SHOW = 10;
  for (const f of r.changed) {
    const x = normalise(readFileSync(join(before, f), 'utf8'), f);
    const y = normalise(readFileSync(join(after, f), 'utf8'), f);
    const regions = diffRegions(x, y);
    if (!regions) {
      console.log(`changed: ${f}\n  too many differences to list`);
      continue;
    }
    console.log(`changed: ${f}\n  ${regions.length} differing region${regions.length === 1 ? '' : 's'}`);
    for (const g of regions.slice(0, SHOW)) {
      const ctx = x.slice(Math.max(0, g.at - 60), g.at);
      console.log(`  at character ${g.at}\n  - ${ctx}[${g.before.slice(0, 200)}]\n  + ${ctx}[${g.after.slice(0, 200)}]`);
    }
    if (regions.length > SHOW) console.log(`  ... and ${regions.length - SHOW} more`);
  }
  const n = r.added.length + r.removed.length + r.changed.length;
  console.log(n === 0 ? 'builds are identical' : `${n} file(s) differ`);
  process.exit(n === 0 ? 0 : 1);
}
