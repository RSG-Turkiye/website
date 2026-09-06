import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
