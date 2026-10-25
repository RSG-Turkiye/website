/**
 * Rewrite the learning-path files in the form the panel CMS writes.
 *
 *   npm run cms:normalize            rewrite every lp-* file that is not in that form
 *   npm run cms:normalize -- --check list them and exit 1, change nothing
 *
 * The panel rewrites a changed list whole: one edited resource rewrites its
 * file's `sections` (or `resources`). When the file is already in the
 * serializer's form, that is the edited lines only; a file written by hand in
 * another style (a plain `tag: Reading`, a blank line between sections) gets
 * its whole list rewritten by its first panel edit, and the reviewer cannot
 * see what changed. tests/cms-serialize.test.ts fails on such a file and
 * names this script.
 *
 * Each file is parsed and written back without its original text, so only
 * formatting changes: the script refuses to write a file whose values or body
 * would come out different. Ids stay double-quoted and first in each
 * resource, as tests/lp-resource-ids.test.ts requires.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { parseMarkdown, serializeMarkdown } from '../src/lib/cms/serialize';
import { lpDomainSchema, lpLevelSchema, lpRoadmapSchema } from '../src/data/learning-paths';
import type { CmsType } from '../src/lib/cms/types';

const ROOT = new URL('../', import.meta.url).pathname;
const DIRS = [
  ['src/content/lp-domains', lpDomainSchema],
  ['src/content/lp-levels', lpLevelSchema],
  ['src/content/lp-roadmap', lpRoadmapSchema],
] as const;

/** The file's text in the serializer's form. Throws if a value would change. */
export function normalised(type: CmsType, text: string, name = 'file'): string {
  const { source: _source, ...entry } = parseMarkdown(type, text);
  const out = serializeMarkdown(type, entry);
  const back = parseMarkdown(type, out);
  if (!isDeepStrictEqual(back.frontmatter, entry.frontmatter) || back.body !== entry.body) {
    throw new Error(`${name}: rewriting would change a value; fix it by hand`);
  }
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const off: string[] = [];
  for (const [dir, schema] of DIRS) {
    const type = { schema } as unknown as CmsType;
    for (const lang of ['en', 'tr']) {
      for (const f of readdirSync(`${ROOT}${dir}/${lang}`).filter((n) => n.endsWith('.md'))) {
        const path = `${dir}/${lang}/${f}`;
        const text = readFileSync(ROOT + path, 'utf8');
        const out = normalised(type, text, path);
        if (out === text) continue;
        off.push(path);
        if (!check) writeFileSync(ROOT + path, out);
      }
    }
  }
  if (off.length === 0) console.log('Every learning-path file is already in the CMS form.');
  else console.log(`${check ? 'Not in the CMS form' : 'Rewritten'}:\n  ${off.join('\n  ')}`);
  if (check && off.length > 0) process.exit(1);
}

if (process.argv[1]?.endsWith('cms-normalize.ts')) main();
