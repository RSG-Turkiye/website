import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Everything done from the admin panel goes in the activity log. This test
// keeps it that way: a new endpoint that changes something and writes no
// audit row fails here until it does, or is listed below with the reason.

const ROOT = new URL('..', import.meta.url).pathname;
const PANEL = ['functions/api/admin', 'functions/api/mail', 'functions/api/social', 'functions/api/audit'];
// grantRole and revokeRole (functions/_lib/role-grants.ts) write their
// role.grant / role.revoke row in the same batch as the grant.
const WRITES_AUDIT = /appendAudit|runWithAudit|runGuardedWithAudit|grantRole|revokeRole/;
const MUTATES = /export const onRequest(Post|Put|Patch|Delete)\b/;

/** Logged by a helper they call, or not an action a person takes. */
const EXEMPT: Record<string, string> = {
  'functions/api/admin/connections/instagram/buffer.ts': 'buffer-connect.ts writes the connection.* rows',
  'functions/api/admin/connections/linkedin/buffer.ts': 'buffer-connect.ts writes the connection.* rows',
  'functions/api/admin/connections/x/buffer.ts': 'buffer-connect.ts writes the connection.* rows',
  'functions/api/social/dispatch.ts': 'the per-minute tick; social-dispatcher.ts logs each post it publishes or fails',
  'functions/api/mail/sync.ts': 'the per-minute inbox sync; it only copies replies in',
  'functions/api/mail/refresh.ts': 'an inbox sync started by opening the page; opening it is logged as view.pane',
  'functions/api/admin/social/dm/refresh.ts': 'a DM sync started from the page; opening a thread is logged as read.dm_thread',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
  });
}

test('every admin-panel endpoint that changes something writes an audit row', () => {
  const missing = PANEL.flatMap((d) => files(join(ROOT, d)))
    .map((path) => ({ rel: relative(ROOT, path), src: readFileSync(path, 'utf8') }))
    .filter(({ rel, src }) => MUTATES.test(src) && !WRITES_AUDIT.test(src) && !(rel in EXEMPT))
    .map(({ rel }) => rel);
  assert.deepEqual(missing, [], 'log the action, or add it to EXEMPT with the reason');
});

test('every exemption still exists and still has no audit call of its own', () => {
  for (const rel of Object.keys(EXEMPT)) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    assert.ok(MUTATES.test(src), `${rel} no longer changes anything; drop it from EXEMPT`);
    assert.ok(!WRITES_AUDIT.test(src), `${rel} logs now; drop it from EXEMPT`);
  }
});

test('certificate log rows never carry the participant\'s name or address', () => {
  // The log is kept a year; certificates and their names, 30 days.
  for (const rel of ['functions/api/admin/certificates.ts', 'functions/api/admin/certificates/[id].ts']) {
    const src = readFileSync(join(ROOT, rel), 'utf8');
    for (const m of src.matchAll(/details: \{([^}]*)\}/g)) {
      assert.doesNotMatch(m[1], /\b(email|name)\b/, `${rel}: ${m[1]}`);
    }
  }
});
