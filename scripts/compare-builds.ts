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

export const normalise = (s: string) => s.replace(/\/_astro\/([^"'\s)]*?)\.[A-Za-z0-9_-]{8,}\.(css|js|mjs)/g, '/_astro/$1.$2');

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
    const x = normalise(readFileSync(join(before, f), 'utf8')).split('\n');
    const y = normalise(readFileSync(join(after, f), 'utf8')).split('\n');
    const i = x.findIndex((l, n) => l !== y[n]);
    const n = i === -1 ? Math.min(x.length, y.length) : i;
    console.log(`changed: ${f}\n  line ${n + 1}\n  - ${(x[n] ?? '').slice(0, 200)}\n  + ${(y[n] ?? '').slice(0, 200)}`);
  }
  const n = r.added.length + r.removed.length + r.changed.length;
  console.log(n === 0 ? 'builds are identical' : `${n} file(s) differ`);
  process.exit(n === 0 ? 0 : 1);
}
