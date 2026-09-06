import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'node:fs';

/**
 * A picture a post points at is a picture that exists.
 *
 * Three posts declared `image: "/images/blog-welcome.jpg"` and its two
 * neighbours, in both languages -- six references to three files that have
 * never been in public/images/. The post page rendered them straight into an
 * <img src>, so every reader of those articles got a broken-image glyph where
 * the author's face goes, and the listing card fell back to its placeholder
 * without saying why.
 *
 * Astro does not check this: the field is a plain string, and a path that
 * resolves to nothing is a 404 at request time, not a build error. So the six
 * references are now empty, and this keeps the next one from landing.
 *
 * Remote URLs are not checked -- that would be a network call in a unit test,
 * and a link that rots later is a different problem. What is checked is the
 * kind that can be: a site-relative path must name a file in public/.
 */

const CONTENT = new URL('../src/content/', import.meta.url).pathname;
const PUBLIC = new URL('../public/', import.meta.url).pathname;

/** Every `field: "value"` in a file's frontmatter block. */
function frontmatter(text: string): Record<string, string> {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  const out: Record<string, string> = {};
  for (const line of text.slice(3, end === -1 ? undefined : end).split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

test('every site-relative image a post declares is a file in public/', () => {
  const files = globSync('**/*.md', { cwd: CONTENT }).map((f) => join(CONTENT, f));
  assert.ok(files.length >= 100, `expected the content collections, found ${files.length}`);

  const missing: string[] = [];
  for (const file of files) {
    const data = frontmatter(readFileSync(file, 'utf8'));
    for (const field of ['image', 'speakerPhoto', 'ogImage']) {
      const value = data[field];
      if (!value || /^(https?:)?\/\//.test(value)) continue;
      if (!existsSync(join(PUBLIC, value.replace(/^\//, '')))) {
        missing.push(`${file.slice(CONTENT.length)} -> ${field}: ${value}`);
      }
    }
  }

  assert.deepEqual(
    missing,
    [],
    `A post points at a picture that is not in public/. Readers get a broken ` +
      `image; nothing else reports it:\n    ${missing.join('\n    ')}\n  `,
  );
});
