import { test } from 'node:test';
import assert from 'node:assert/strict';
import { onRequestPatch } from '../functions/api/admin/blog-submissions/[id]';

/**
 * A submission is reviewed once.
 *
 * Neither branch of this handler read the row's status, and both acted on
 * whatever they were handed. Three things followed, all reachable by clicking
 * a button twice:
 *
 *  - Approving again with a different slug opened a second pull request for
 *    the same post. openContentPR is idempotent per branch name, so the same
 *    slug converges and a different one does not.
 *  - Rejecting an approved submission set it to 'rejected' with its pull
 *    request still open, which let the writer edit and resubmit -- the
 *    resubmit path allows exactly that status -- and a second approval open a
 *    third PR.
 *  - Approving a rejected one published something its author had been told
 *    was turned down.
 *
 * These pin the guard. What they cannot pin is two admins clicking approve in
 * the same second with different slugs: the row is read before the pull
 * request is opened, so both would reach GitHub. The conditional UPDATE keeps
 * the database consistent through that, and the second PR would be a stray
 * branch for a person to close. Closing that properly needs a fourth status
 * value, which the CHECK constraint does not allow without a migration.
 */

const SUBMISSION = {
  id: 'sub-1',
  submitted_by: 'user-1',
  lang: 'en',
  title: 'A post',
  description: 'About something',
  category: 'tutorial',
  tags: '[]',
  author: 'A Writer',
  image_url: '',
  body: 'text',
  slug: 'a-post',
  paired_submission_id: null,
  submitter_email: 'writer@example.org',
};

function harness(status: string) {
  const writes: string[] = [];
  const env = {
    DB: {
      prepare(sql: string) {
        return {
          bind: (..._v: unknown[]) => ({
            async first() {
              if (/FROM sessions/.test(sql)) return { user_id: 'admin-1' };
              if (/FROM users/.test(sql)) return { id: 'admin-1', is_admin: 1, email: 'a@x.org' };
              if (/FROM blog_submissions/.test(sql)) return { ...SUBMISSION, status };
              return null;
            },
            async all() {
              return { results: [] };
            },
            async run() {
              writes.push(sql.replace(/\s+/g, ' ').trim());
              return { meta: { changes: 1 } };
            },
          }),
        };
      },
      async batch(statements: unknown[]) {
        writes.push(`BATCH(${statements.length})`);
        return [];
      },
    },
  };
  return { env, writes };
}

/** The handler resolves the admin through getSessionUser, which reads D1. */
async function patch(env: unknown, body: unknown): Promise<Response> {
  return (onRequestPatch as (c: unknown) => Promise<Response>)({
    request: new Request('https://x/api/admin/blog-submissions/sub-1', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://rsg-turkiye.iscbsc.org',
        Cookie: 'rsg_session=test-session',
      },
      body: JSON.stringify(body),
    }),
    params: { id: 'sub-1' },
    env,
  });
}

for (const status of ['approved', 'rejected']) {
  test(`approving an already-${status} submission is refused, and writes nothing`, async () => {
    const h = harness(status);
    const res = await patch(h.env, { action: 'approve', slug: 'a-different-slug' });
    assert.equal(res.status, 409);
    const body = await res.json<{ code?: string; error?: string }>();
    assert.equal(body.code, 'not_pending');
    assert.match(body.error ?? '', new RegExp(status));
    assert.deepEqual(h.writes, [], 'no write, and no pull request');
  });

  test(`rejecting an already-${status} submission is refused, and writes nothing`, async () => {
    const h = harness(status);
    const res = await patch(h.env, { action: 'reject', reason: 'no' });
    assert.equal(res.status, 409);
    assert.deepEqual(h.writes, []);
  });
}

test('a pending submission is still reviewable', async () => {
  // The guard must refuse the reviewed ones and nothing else. Reject is the
  // branch that needs no network, so it is the one this checks.
  const h = harness('pending');
  const res = await patch(h.env, { action: 'reject', reason: 'not this time' });
  assert.equal(res.status, 200);
  assert.ok(
    h.writes.some((w) => w.startsWith('BATCH')),
    'the rejection is written',
  );
});
