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
