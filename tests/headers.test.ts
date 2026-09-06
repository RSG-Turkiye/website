import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

/**
 * Code with its prose removed.
 *
 * Written because this test's first run flagged escape-html.ts, whose comment
 * quotes the very payload it defends against. Only block comments and lines
 * that are entirely a comment are dropped -- stripping from `//` anywhere
 * would eat the rest of a line holding a URL, and could hide a real handler
 * sitting beside one.
 */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('<!--');
    })
    .join('\n');
}

/** Everything a person edits: pages, components, layouts, scripts. */
function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(astro|ts|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

/**
 * What the site tells a browser about its own files.
 *
 * Cloudflare Pages served everything with `max-age=0, must-revalidate`, so a
 * browser had to ask before every use. Measured on the live site: the answer
 * is 304 with no bytes, and the question costs about 0.7 s -- on the critical
 * path, for the stylesheet that blocks painting, on every navigation.
 *
 * The rules that matter are the ones it would be easy to get wrong in the
 * other direction: caching HTML for a day would hide new content, and caching
 * an unhashed file for a year would strand a replaced logo.
 */

function rules(path: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let current: string | null = null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      current = line.trim();
      out.set(current, []);
    } else if (current) {
      out.get(current)!.push(line.trim());
    }
  }
  return out;
}

for (const [site, path] of [
  ['main', new URL('../public/_headers', import.meta.url).pathname],
  ['symposium', new URL('../symposium_website/public/_headers', import.meta.url).pathname],
] as const) {
  const parsed = rules(path);

  test(`${site}: hashed assets are cached for a year and never revalidated`, () => {
    const astro = parsed.get('/_astro/*');
    assert.ok(astro, 'no rule for /_astro/*');
    const cache = astro.find((h) => h.startsWith('Cache-Control:'));
    assert.match(cache ?? '', /max-age=31536000/);
    assert.match(cache ?? '', /immutable/);
  });

  test(`${site}: HTML is not cached`, () => {
    // The rule that would hurt: a day of caching means an announcement, a new
    // post or a corrected date waits a day to appear.
    const all = parsed.get('/*') ?? [];
    const cache = all.find((h) => h.toLowerCase().startsWith('cache-control:'));
    assert.equal(cache, undefined, 'the catch-all must not set Cache-Control');
  });

  test(`${site}: unhashed assets get a day, not a year`, () => {
    for (const pattern of ['/logo/*', '/flags/*', '/images/*']) {
      const rule = parsed.get(pattern);
      if (!rule) continue; // the symposium site has no /flags
      const cache = rule.find((h) => h.startsWith('Cache-Control:')) ?? '';
      assert.match(cache, /max-age=86400/, pattern);
      assert.ok(!cache.includes('immutable'), `${pattern} must not be immutable: the name is reused`);
    }
  });

  test(`${site}: the cheap security headers are set`, () => {
    const all = (parsed.get('/*') ?? []).join(' ');
    assert.match(all, /X-Frame-Options: DENY/);
    assert.match(all, /Permissions-Policy:/);
  });

  test(`${site}: no Content-Security-Policy is claimed`, () => {
    // Deliberate, and the file says why: a policy allowing 'unsafe-inline'
    // would permit the 263 inline scripts and 1,071 inline handlers in the
    // built output -- which is to say it would permit the cross-site
    // scripting it exists to stop. Saying nothing beats saying something
    // untrue, and this test is here so adding one is a decision rather than
    // a paste.
    const text = readFileSync(path, 'utf8');
    const active = text
      .split('\n')
      .filter((l) => !l.trim().startsWith('#'))
      .join('\n');
    assert.ok(!/Content-Security-Policy/i.test(active), 'a CSP appeared; check it forbids inline script');
  });
}

test('no source file writes an inline event handler', () => {
  // Eight of these in four files multiplied to 1,071 across the built site,
  // and an onclick attribute is the one kind of script a Content-Security-
  // Policy cannot tell apart from an injected one.
  //
  // Source rather than dist: `npm test` runs before `npm run build` in CI, so
  // a check that reads the built output would pass by finding nothing. It also
  // catches the shape Header.astro actually had -- handlers inside a
  // JavaScript string, assembled with innerHTML -- because they are written
  // literally either way.
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = withoutComments(readFileSync(file, 'utf8'));
    for (const attr of ['onclick', 'onsubmit', 'onmouseover', 'onmouseout', 'onchange', 'onload', 'onerror']) {
      if (new RegExp(`\\s${attr}=["\\']`, 'i').test(text)) {
        offenders.push(`${file.slice(SRC.length)} (${attr})`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'inline handlers: attach them with addEventListener instead');
});
