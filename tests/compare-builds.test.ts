import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareBuilds } from '../scripts/compare-builds';

const made: string[] = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

function build(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'cb-'));
  made.push(dir);
  for (const [name, body] of Object.entries({ 'index.html': '<p>home</p>', ...files })) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
}

const script = new URL('../scripts/compare-builds.ts', import.meta.url).pathname;
const cli = (a: string, b: string, entry = script) =>
  spawnSync(process.execPath, ['--import', 'tsx', entry, a, b], { encoding: 'utf8' });

test('a changed asset hash is not a difference', () => {
  const a = build({ 'index.html': '<link href="/_astro/index.Bx3k9aZq.css"><script src="/_astro/app.D41d8cd9.js">' });
  const b = build({ 'index.html': '<link href="/_astro/index.Qq77xx01.css"><script src="/_astro/app.99aa88bb.js">' });
  assert.deepEqual(compareBuilds(a, b), { changed: [], added: [], removed: [] });
});

test('hashes are normalised in nested pages too', () => {
  const a = build({ 'tr/blog/x/index.html': '<link href="/_astro/_slug_.Bx3k9aZq.css">' });
  const b = build({ 'tr/blog/x/index.html': '<link href="/_astro/_slug_.Zz00yy11.css">' });
  assert.deepEqual(compareBuilds(a, b), { changed: [], added: [], removed: [] });
});

test('a changed paragraph is listed', () => {
  const a = build({ 'a/index.html': '<p>one</p>', 'b.txt': 'x' });
  const b = build({ 'a/index.html': '<p>two</p>', 'b.txt': 'x' });
  assert.deepEqual(compareBuilds(a, b).changed, ['a/index.html']);
});

test('a file in only one build is added or removed', () => {
  const a = build({ 'old.xml': '<a/>', 'same.html': 'x' });
  const b = build({ 'new.txt': 'n', 'same.html': 'x' });
  const r = compareBuilds(a, b);
  assert.deepEqual(r.added, ['new.txt']);
  assert.deepEqual(r.removed, ['old.xml']);
});

test('an empty, index-less or missing tree throws instead of passing', () => {
  const ok = build({});
  const empty = mkdtempSync(join(tmpdir(), 'cb-')); made.push(empty);
  const noIndex = build({}); rmSync(join(noIndex, 'index.html'));
  writeFileSync(join(noIndex, 'a.txt'), 'x');
  for (const bad of [empty, noIndex, join(empty, 'nope')]) {
    assert.throws(() => compareBuilds(ok, bad));
    assert.throws(() => compareBuilds(bad, ok));
  }
});

test('CLI exits 0 when identical, 1 when different', () => {
  const a = build({ 'p/index.html': '<p>one</p>' });
  const same = build({ 'p/index.html': '<p>one</p>' });
  const diff = build({ 'p/index.html': '<p>two</p>' });
  assert.equal(cli(a, same).status, 0);
  const r = cli(a, diff);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /p\/index\.html/);
});

test('CLI exits 2 with a message for an empty or missing directory', () => {
  const ok = build({});
  const empty = mkdtempSync(join(tmpdir(), 'cb-')); made.push(empty);
  for (const bad of [empty, join(empty, 'nope')]) {
    const r = cli(ok, bad);
    assert.equal(r.status, 2);
    assert.doesNotMatch(r.stderr, /at .*\.ts:\d+/, 'a message, not a stack trace');
    assert.ok(r.stderr.trim().length > 0);
  }
});

test('CLI still runs when started through a symlink', () => {
  const a = build({ 'p/index.html': '<p>one</p>' });
  const diff = build({ 'p/index.html': '<p>two</p>' });
  const dir = mkdtempSync(join(tmpdir(), 'cb-')); made.push(dir);
  const link = join(dir, 'cmp.ts');
  symlinkSync(script, link);
  assert.equal(cli(a, diff, link).status, 1);
});

// Browser-invisible differences: how Astro spells an apostrophe, and how it
// lays out whitespace around an expression, do not change the rendered page.
const same = (x: string, y: string) =>
  compareBuilds(build({ 'p/index.html': x }), build({ 'p/index.html': y })).changed.length === 0;

test("an escaped apostrophe or quote equals the plain character", () => {
  assert.ok(same("<h1>RSG-Türkiye'ye Katıl</h1>", '<h1>RSG-Türkiye&#39;ye Katıl</h1>'));
  assert.ok(same("<p>it's</p>", '<p>it&#x27;s</p>'));
  assert.ok(same('<p>&quot;q&#34;</p>', '<p>&#x22;q&quot;</p>'));
});

test('a multi-line label equals the same label on one line', () => {
  assert.ok(same('<a href="/x">\n            Visit ISCB\n          </a>', '<a href="/x"> Visit ISCB </a>'));
  assert.ok(same('<p>a\n\t b</p>', '<p>a b</p>'));
});

test('joined words, a changed word or a dropped space are still differences', () => {
  assert.ok(!same('<p>a b</p>', '<p>ab</p>'));
  assert.ok(!same('<p>Visit ISCB</p>', '<p>Visit ISBC</p>'));
  assert.ok(!same('<a> Visit</a>', '<a>Visit</a>'));
});

test('escaped markup never equals real markup', () => {
  assert.ok(!same('<p>&lt;b&gt;x&lt;/b&gt;</p>', '<p><b>x</b></p>'));
  assert.ok(same('<p>&#60;b&#62; &#38;</p>', '<p>&lt;b&gt; &amp;</p>'));
});

test('whitespace inside <pre> and <textarea> still counts', () => {
  assert.ok(!same('<pre>a\n  b</pre>', '<pre>a b</pre>'));
  assert.ok(!same('<textarea>a\n\nb</textarea>', '<textarea>a b</textarea>'));
  assert.ok(same('<pre>x</pre>\n\n<p>y</p>', '<pre>x</pre> <p>y</p>'));
});

test('CLI shows where a one-line page differs', () => {
  const a = build({ 'p/index.html': '<p>' + 'x '.repeat(300) + 'one</p>' });
  const b = build({ 'p/index.html': '<p>' + 'x '.repeat(300) + 'two</p>' });
  const r = cli(a, b);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /one/);
  assert.match(r.stdout, /two/);
});

const sameIn = (name: string, x: string, y: string) =>
  compareBuilds(build({ [name]: x }), build({ [name]: y })).changed.length === 0;

test('.txt and .xml stay byte-exact: their newlines carry meaning', () => {
  assert.ok(!sameIn('llms.txt', 'a\nb', 'a b'));
  assert.ok(!sameIn('robots.txt', "a\n\nb", 'a\nb'));
  assert.ok(!sameIn('sitemap.xml', '<loc>it&#39;s</loc>', "<loc>it's</loc>"));
  assert.ok(sameIn('feed.xml', '<link href="/_astro/a.Bx3k9aZq.css">', '<link href="/_astro/a.Qq77xx01.css">'));
});

test('&quot; is never decoded: inside an attribute it changes the markup', () => {
  assert.ok(!same('<p title="a&quot;b">x</p>', '<p title="a"b">x</p>'));
  assert.ok(!same('<p>&quot;q&quot;</p>', '<p>"q"</p>'));
});

test('whitespace inside <script> and <style> still counts', () => {
  assert.ok(!same('<script>a\n  b</script>', '<script>a b</script>'));
  assert.ok(!same('<style>a\n  b</style>', '<style>a b</style>'));
});

test('diffRegions finds every separate change, not only the first', async () => {
  const { diffRegions } = await import('../scripts/compare-builds');
  assert.deepEqual(diffRegions('<p>a b c</p>', '<p>a b c</p>'), []);
  const one = diffRegions('<p>one two three</p>', '<p>one TWO three</p>');
  assert.deepEqual(one?.map((r) => [r.before, r.after]), [['two', 'TWO']]);
  const filler = ' x'.repeat(200);
  const two = diffRegions(`<p>a${filler}</p><p>b</p>`, `<p>A${filler}</p><p>B</p>`);
  assert.deepEqual(two?.map((r) => [r.before, r.after]), [['a', 'A'], ['b', 'B']]);
  // Words changed side by side, with only spaces between, are one region.
  assert.equal(diffRegions('<p>a b c d</p>', '<p>a X Y d</p>')?.length, 1);
  // An insertion and a deletion count too.
  assert.deepEqual(diffRegions('<p>a</p><p>b</p>', '<p>a</p><i>n</i><p>b</p>')?.map((r) => r.after), ['<i>n</i>']);
  assert.deepEqual(diffRegions('<p>a</p><i>n</i><p>b</p>', '<p>a</p><p>b</p>')?.map((r) => r.before), ['<i>n</i>']);
  assert.equal(diffRegions('a b c d e f', 'A B C D E F', 3), null);
});

test('CLI reports a second change in the same file', () => {
  const filler = ' x'.repeat(300);
  const a = build({ 'p/index.html': `<p>first${filler}</p><p>second</p>` });
  const b = build({ 'p/index.html': `<p>FIRST${filler}</p><p>SECOND</p>` });
  const r = cli(a, b);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /2 differing regions/);
  assert.match(r.stdout, /\[second\]/);
  assert.match(r.stdout, /\[SECOND\]/);
});
