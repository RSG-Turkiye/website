import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttachments, type AttachmentCache } from '../functions/_lib/compose';

/**
 * What resolving an attachment is allowed to cost.
 *
 * One 9 MB PDF on 32 scheduled emails killed the dispatcher twice over. First
 * because the file was fetched and base64-encoded once per recipient; the
 * cache fixed that, and then held 12.8 MB of encoded string for the whole
 * tick, which was the next thing to run the isolate out of memory. Resolving
 * now reads no bytes at all -- a filename, a content type, an R2 key and a
 * size -- and the sender streams the object as it uploads it.
 */
function fakeEnv(counters: { db: number; head: number; get: number }, size = 9_814_671) {
  const row = {
    id: 'a1',
    filename: 'sponsorship.pdf',
    r2_key: 'k/a1',
    content_type: 'application/pdf',
    // Deliberately not the same as the R2 object below: the resolution must
    // report what R2 holds, because the streaming upload declares that number
    // as its Content-Length and a stale column would fail every send.
    size_bytes: 123,
  };
  return {
    DB: {
      prepare() {
        return {
          bind: () => ({
            all: async () => {
              counters.db++;
              return { results: [row] };
            },
          }),
        };
      },
    },
    MAIL_ATTACHMENTS: {
      head: async () => {
        counters.head++;
        return { size };
      },
      get: async () => {
        counters.get++;
        return { body: new ReadableStream() };
      },
    },
  } as never;
}

const counters = () => ({ db: 0, head: 0, get: 0 });

test('resolving reads no bytes, only what the message needs to describe them', async () => {
  const c = counters();
  const resolved = await resolveAttachments(fakeEnv(c), ['a1']);
  assert.ok(resolved.ok);
  assert.deepEqual(resolved.attachments, [
    { filename: 'sponsorship.pdf', contentType: 'application/pdf', r2Key: 'k/a1', size: 9_814_671 },
  ]);
  assert.equal(c.get, 0, 'the object itself is never fetched here');
  assert.equal(c.head, 1);
});

test('the size comes from R2, not from the database column', async () => {
  // The column says 123. FixedLengthStream would fail the upload on the
  // difference, so this is not a matter of tidiness.
  const resolved = await resolveAttachments(fakeEnv(counters(), 4_242_424), ['a1']);
  assert.ok(resolved.ok);
  assert.equal(resolved.attachments[0].size, 4_242_424);
});

test('with a cache the lookup happens once for the whole dispatch', async () => {
  const c = counters();
  const env = fakeEnv(c);
  const cache: AttachmentCache = new Map();
  for (let i = 0; i < 5; i++) await resolveAttachments(env, ['a1'], cache);
  assert.equal(c.head, 1, 'R2 consulted once');
  assert.equal(c.db, 1, 'attachment row read once');
});

test('without a cache every call looks it up again', async () => {
  const c = counters();
  const env = fakeEnv(c);
  for (let i = 0; i < 5; i++) await resolveAttachments(env, ['a1']);
  assert.equal(c.head, 5);
});

test('the cached copy is the real thing, not an empty stand-in', async () => {
  const env = fakeEnv(counters());
  const cache: AttachmentCache = new Map();
  const first = await resolveAttachments(env, ['a1'], cache);
  const second = await resolveAttachments(env, ['a1'], cache);
  assert.ok(first.ok && second.ok);
  assert.deepEqual(second.attachments, first.attachments);
});

test('a cache holding only some of the ids does not serve a partial set', async () => {
  // Half a hit must go back to the source rather than send an email missing
  // one of its attachments.
  const env = fakeEnv(counters());
  const cache: AttachmentCache = new Map();
  await resolveAttachments(env, ['a1'], cache);
  const mixed = await resolveAttachments(env, ['a1', 'a2'], cache);
  assert.equal(mixed.ok, false, 'a2 does not exist, so this must fail rather than send a1 alone');
});

test('an object missing from R2 is refused rather than sent empty', async () => {
  const env = {
    DB: {
      prepare: () => ({
        bind: () => ({
          all: async () => ({
            results: [
              { id: 'a1', filename: 'x.pdf', r2_key: 'k/a1', content_type: 'application/pdf', size_bytes: 10 },
            ],
          }),
        }),
      }),
    },
    MAIL_ATTACHMENTS: { head: async () => null },
  } as never;
  const resolved = await resolveAttachments(env, ['a1']);
  assert.deepEqual(resolved, { ok: false, code: 'unknown_attachment' });
});

test('the ceiling is applied to what R2 holds', async () => {
  // MAX_ATTACHMENT_BYTES is 15 MiB; the column still says 123.
  const resolved = await resolveAttachments(fakeEnv(counters(), 16 * 1024 * 1024), ['a1']);
  assert.deepEqual(resolved, { ok: false, code: 'attachments_too_large' });
});
