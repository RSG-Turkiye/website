import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

/**
 * Plan 4, A11: a roadmap stage's number is its place, so no two stages share
 * one. A deleted stage leaves a gap, so numbers need not be contiguous. Read
 * generically from every file (the panel approves a new stage only when its
 * number is free on main).
 */
const ROOT = new URL('../src/content/lp-roadmap/', import.meta.url).pathname;

test('roadmap stage numbers are unique positive integers in each language, and each file starts with its number', () => {
  for (const lang of ['en', 'tr']) {
    const seen = new Map<number, string>();
    for (const f of readdirSync(`${ROOT}${lang}`).filter((n) => n.endsWith('.md'))) {
      const m = /^number:\s*(\d+)\s*$/m.exec(readFileSync(`${ROOT}${lang}/${f}`, 'utf8'));
      assert.ok(m, `${lang}/${f}: no number`);
      const n = Number(m![1]);
      assert.ok(Number.isInteger(n) && n >= 1, `${lang}/${f}`);
      assert.equal(Number(/^(\d+)-/.exec(f)?.[1]), n, `${lang}/${f}: the file name starts with its number`);
      assert.ok(!seen.has(n), `${lang}: ${f} and ${seen.get(n)} are both stage ${n}`);
      seen.set(n, f);
    }
    assert.ok(seen.size > 0);
  }
});
