import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { auditLabel } from '../src/lib/audit-labels';

const ROOT = new URL('../functions', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

/** Every action code the server can write, the templated ones expanded. */
function codes(): string[] {
  const src = files(ROOT).map((f) => readFileSync(f, 'utf8')).join('\n');
  const found = new Set<string>();
  // action: 'x.y', audit: 'x.y', audit('x.y', settleAs(..., 'x.y') and a ? 'x.y' : 'x.z'
  for (const m of src.matchAll(/(?:action|audit)(?::\s*|\(\s*)'([a-z_]+\.[a-z_.]+)'/g)) found.add(m[1]);
  for (const m of src.matchAll(/action: [^'\n]*\? '([a-z_]+\.[a-z_.]+)' : '([a-z_]+\.[a-z_.]+)'/g)) { found.add(m[1]); found.add(m[2]); }
  for (const m of src.matchAll(/settleAs\([^\n]*'([a-z_]+\.[a-z_.]+)'\)/g)) found.add(m[1]);
  for (const m of src.matchAll(/auditOutcome\([^\n]*?'([a-z_]+\.[a-z_.]+)'/g)) found.add(m[1]);
  for (const kind of ['speakers', 'sessions', 'committee']) for (const verb of ['create', 'update', 'delete']) found.add(`symposium.${kind}.${verb}`);
  for (const a of ['verify', 'unverify', 'award_badge', 'revoke_badge', 'set_rank']) found.add(`user.${a}`);
  for (const s of ['published', 'partially_published', 'failed']) found.add(`social.post.${s}`);
  return [...found].sort();
}

test('every action code the server writes has a name in both languages', () => {
  const all = codes();
  assert.ok(all.length > 60, `found only ${all.length} codes; the scan is missing some`);
  const missing = all.flatMap((c) => (['en', 'tr'] as const).filter((l) => !auditLabel(c, l)).map((l) => `${c} (${l})`));
  assert.deepEqual(missing, []);
});

test('an unknown code has no name, so the log shows the code itself', () => {
  assert.equal(auditLabel('something.new', 'tr'), null);
  assert.equal(auditLabel('symposium.speakers.archive', 'en'), null);
});

test('the symposium family reads naturally in both languages', () => {
  assert.equal(auditLabel('symposium.committee.create', 'tr'), 'Sempozyumda komite üyesi ekledi');
  assert.equal(auditLabel('symposium.speakers.delete', 'en'), 'Removed a speaker');
});
