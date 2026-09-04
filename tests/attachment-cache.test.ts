import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttachments, type AttachmentCache } from '../functions/_lib/compose';

/**
 * One 9 MB PDF on 32 scheduled emails killed the dispatcher: it was fetched
 * from R2 and base64-encoded once per recipient. These check the file is
 * touched once per dispatch instead.
 */
function fakeEnv(counters: { db: number; r2: number }) {
  const row = {
    id: 'a1', filename: 'sponsorship.pdf', r2_key: 'k/a1',
    content_type: 'application/pdf', size_bytes: 9_000_000,
  };
  return {
    DB: {
      prepare() {
        return {
          bind: () => ({
            all: async () => { counters.db++; return { results: [row] }; },
          }),
        };
      },
    },
    MAIL_ATTACHMENTS: {
      get: async () => {
        counters.r2++;
        return { arrayBuffer: async () => new ArrayBuffer(64) };
      },
    },
  } as never;
}

test('without a cache the same file is fetched again for every email', () => {
  // Documents the old behaviour, so the fix cannot be quietly undone.
  const c = { db: 0, r2: 0 };
  const env = fakeEnv(c);
  return (async () => {
    for (let i = 0; i < 5; i++) await resolveAttachments(env, ['a1']);
    assert.equal(c.r2, 5);
  })();
});

test('with a cache it is fetched and encoded once for the whole dispatch', async () => {
  const c = { db: 0, r2: 0 };
  const env = fakeEnv(c);
  const cache: AttachmentCache = new Map();
  for (let i = 0; i < 5; i++) await resolveAttachments(env, ['a1'], cache);
  assert.equal(c.r2, 1, 'R2 read once');
  assert.equal(c.db, 1, 'attachment row read once');
});

test('the cached copy is the same bytes, not an empty stand-in', async () => {
  const c = { db: 0, r2: 0 };
  const env = fakeEnv(c);
  const cache: AttachmentCache = new Map();
  const first = await resolveAttachments(env, ['a1'], cache);
  const second = await resolveAttachments(env, ['a1'], cache);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(second.attachments, first.attachments);
  assert.equal(second.attachments[0].filename, 'sponsorship.pdf');
});

test('a cache holding only some of the ids does not serve a partial set', async () => {
  // Half a hit must go back to the source rather than send an email missing
  // one of its attachments.
  const c = { db: 0, r2: 0 };
  const env = fakeEnv(c);
  const cache: AttachmentCache = new Map();
  await resolveAttachments(env, ['a1'], cache);
  const mixed = await resolveAttachments(env, ['a1', 'a2'], cache);
  assert.equal(mixed.ok, false, 'a2 does not exist, so this must fail rather than send a1 alone');
});
