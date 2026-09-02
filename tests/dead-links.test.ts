import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEAD_DOMAINS = ['rsgturkey.com', 'iscbrsgturkey.wordpress.com'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no content links to a domain we no longer control', () => {
  const offenders: string[] = [];
  for (const file of walk('src/content')) {
    const text = readFileSync(file, 'utf8');
    for (const domain of DEAD_DOMAINS) {
      if (text.includes(domain)) offenders.push(`${file} -> ${domain}`);
    }
  }
  assert.deepEqual(offenders, [], 'dead links found');
});

test('the 2017-2018 news post exists exactly once', () => {
  const matches = readdirSync('src/content/blog/tr')
    .filter((f) => f.replace(/-/g, '').startsWith('rsgturkiyedenhaberler'));
  assert.equal(matches.length, 1, `found ${matches.join(', ')}`);
});
