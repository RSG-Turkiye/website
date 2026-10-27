import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * The handover docs are what the next maintainer's agent reads when something
 * breaks. These checks keep them present, linked to real README sections, and
 * free of the hostnames blocked in Türkiye.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const DIR = `${ROOT}docs/handover/`;
const FILES = ['README.md', 'troubleshooting.md', 'accounts.md', 'drill.md'];

/** GitHub's heading anchor: lowercase, spaces to hyphens, other punctuation dropped. */
export function githubSlug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M} _-]/gu, '')
    .replace(/ /g, '-');
}

const read = (path: string) => readFileSync(path, 'utf8');
const handoverFiles = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.md')) : []);

test('the four handover files exist', () => {
  for (const f of FILES) assert.ok(existsSync(DIR + f), `docs/handover/${f} is missing`);
});

test('CLAUDE.md points agents at the troubleshooting guide', () => {
  assert.ok(read(`${ROOT}CLAUDE.md`).includes('docs/handover/troubleshooting.md'));
});

test('no concrete blocked hostname', () => {
  const blocked = /(?<![*\w-])[a-z0-9-]+\.(pages|r2|workers)\.dev/i;
  const paths = [...handoverFiles().map((f) => DIR + f), `${ROOT}CLAUDE.md`];
  for (const p of paths) assert.doesNotMatch(read(p), blocked, p);
});

test('relative links resolve', () => {
  const link = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const f of handoverFiles()) {
    const text = read(DIR + f);
    for (const m of text.matchAll(link)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [file, anchor] = target.split('#');
      const abs = resolve(dirname(DIR + f), file);
      assert.ok(existsSync(abs), `${f}: ${target} does not exist`);
      if (anchor) {
        const slugs = read(abs)
          .split('\n')
          .filter((l) => /^#{1,6} /.test(l))
          .map((l) => githubSlug(l.replace(/^#{1,6} /, '')));
        assert.ok(slugs.includes(anchor), `${f}: ${target} has no matching heading`);
      }
    }
  }
});

test('every troubleshooting entry has the five parts', () => {
  const text = read(`${DIR}troubleshooting.md`);
  const sections = text.split(/^## /m).slice(1);
  assert.ok(sections.length >= 8, 'expected the seeded entries');
  for (const s of sections) {
    const title = s.split('\n')[0];
    for (const part of ['**Symptom**', '**Likely causes**', '**Look at**', '**Fix**', '**Who acts**']) {
      assert.ok(s.includes(part), `"${title}" lacks ${part}`);
    }
  }
});
