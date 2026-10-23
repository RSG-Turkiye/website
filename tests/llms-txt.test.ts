import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { llmsTxt, SITE } from '../src/lib/llms-txt';

const DIST = new URL('../dist/', import.meta.url).pathname;

const sample = llmsTxt({
  foundedYear: 2011,
  symposiums: 13,
  webinars: 82,
  domains: [{ slug: 'genomics', name: 'Genomics', tagline: 'Reads to expression.' }],
  committees: [{ name: 'Website Committee', description: 'Builds the site.' }],
  workshops: [{ year: 2021, title: 'Command Line Tools', topics: 'Linux', url: 'https://github.com/RSG-Turkiye/Workshop2021' }],
  contactEmail: 'turkey.rsg@gmail.com',
});

test('llms.txt follows the format: one H1, a summary quote, then sections', () => {
  const lines = sample.split('\n');
  assert.equal(lines[0], '# RSG-Türkiye');
  assert.equal(lines.filter((l) => l.startsWith('# ')).length, 1);
  assert.ok(lines.some((l) => l.startsWith('> ')), 'has the summary blockquote');
  for (const h of ['## Who it is for', '## What it does', '## How to take part', '## Open workshop materials', '## Learning paths by field']) {
    assert.ok(lines.includes(h), `missing ${h}`);
  }
});

test('it says who membership is for, and that the rest is open to everyone', () => {
  // The point is members and volunteers who fit, not more sign-ups.
  assert.match(sample, /Membership is aimed at master's and PhD students/);
  assert.match(sample, /open to everyone/);
  assert.match(sample, /13 editions/);
  assert.match(sample, /82 expert talks/);
});

test('it states facts and gives assistants no instructions to promote anything', () => {
  assert.doesNotMatch(sample, /\b(you should recommend|tell (the )?users?|always mention|donat)/i);
});

test('every link to this site in the built llms.txt is a page that exists', { skip: !existsSync(`${DIST}llms.txt`) && 'no build' }, () => {
  const built = readFileSync(`${DIST}llms.txt`, 'utf8');
  const paths = [...built.matchAll(new RegExp(`${SITE.replace(/\./g, '\\.')}(/[^)\\s]*)`, 'g'))].map((m) => m[1]);
  assert.ok(paths.length >= 8, `expected the site links, found ${paths.length}`);
  for (const p of paths) {
    assert.ok(existsSync(`${DIST}${p.replace(/^\//, '')}index.html`), `${p} is not a page in the build`);
  }
});

test('every listed workshop repository is public on GitHub', { skip: process.env.CHECK_NETWORK !== '1' && 'network check; set CHECK_NETWORK=1' }, async () => {
  const { workshopUrl } = await import('../src/data/workshops');
  const dir = new URL('../src/content/workshops/', import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const w = JSON.parse(readFileSync(dir + f, 'utf8'));
    const res = await fetch(workshopUrl(w), { method: 'HEAD', redirect: 'follow' });
    assert.equal(res.status, 200, workshopUrl(w));
  }
});

test('every page links to /llms.txt, and robots.txt names it', () => {
  // Nothing announces llms.txt by itself; these are how a crawler finds it.
  const layout = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url).pathname, 'utf8');
  assert.match(layout, /<link rel="alternate" type="text\/plain" href="\/llms\.txt"/);
  const robots = readFileSync(new URL('../public/robots.txt', import.meta.url).pathname, 'utf8');
  assert.match(robots, /\/llms\.txt/);
  assert.match(robots, /^User-agent: \*\nAllow: \//m, 'and the file still allows everything');
});
