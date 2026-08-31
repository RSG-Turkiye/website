import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRecipients,
  isValidEmail,
  validateCompose,
  checkRateLimit,
  MAX_RECIPIENTS,
} from '../functions/_lib/mail';

test('parseRecipients splits on commas, semicolons and newlines', () => {
  assert.deepEqual(
    parseRecipients('a@x.com, b@x.com; c@x.com\nd@x.com'),
    ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
  );
});

test('parseRecipients trims, drops empties and de-duplicates case-insensitively', () => {
  assert.deepEqual(parseRecipients('  A@x.com , a@X.com ,, '), ['A@x.com']);
});

test('isValidEmail accepts ordinary addresses and rejects malformed ones', () => {
  for (const good of ['hoca@uni.edu.tr', 'a.b+tag@sub.example.co.uk']) {
    assert.ok(isValidEmail(good), `${good} should be valid`);
  }
  for (const bad of ['', 'nope', 'a@', '@b.com', 'a b@c.com', 'a@b', 'a@b .com']) {
    assert.ok(!isValidEmail(bad), `${bad} should be invalid`);
  }
});

const good = { to: 'hoca@uni.edu.tr', subject: 'Davet', body: 'Sayın Hocam' };

test('validateCompose accepts a well-formed compose', () => {
  assert.deepEqual(validateCompose(good), { ok: true, recipients: ['hoca@uni.edu.tr'] });
});

test('validateCompose rejects each malformed field with its own code', () => {
  const cases: Array<[Partial<typeof good>, string]> = [
    [{ to: '   ' }, 'no_recipients'],
    [{ to: 'hoca@uni.edu.tr, broken' }, 'invalid_email'],
    [{ subject: '  ' }, 'empty_subject'],
    [{ subject: 'x'.repeat(201) }, 'subject_too_long'],
    [{ body: '\n  ' }, 'empty_body'],
    [{ body: 'x'.repeat(20001) }, 'body_too_long'],
  ];
  for (const [patch, code] of cases) {
    assert.deepEqual(validateCompose({ ...good, ...patch }), { ok: false, code });
  }
});

test('validateCompose rejects more than MAX_RECIPIENTS addresses', () => {
  const to = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@uni.edu.tr`).join(',');
  assert.deepEqual(validateCompose({ ...good, to }), { ok: false, code: 'too_many_recipients' });
});

/** Minimal stand-in for D1: returns queued counts in call order. */
function fakeDb(counts: number[]) {
  const queue = [...counts];
  const queries: string[] = [];
  return {
    queries,
    prepare(query: string) {
      queries.push(query);
      return {
        bind: () => ({ first: async () => ({ n: queue.shift() ?? 0 }) }),
      };
    },
  };
}

const NOW = 1_700_000_000;

test('checkRateLimit passes when all three windows have room', async () => {
  const db = fakeDb([0, 0, 0]);
  assert.deepEqual(await checkRateLimit(db, 'u1', 1, NOW), { ok: true });
});

test('checkRateLimit rejects when the hourly window would be exceeded', async () => {
  const db = fakeDb([19, 0, 0]);
  assert.deepEqual(await checkRateLimit(db, 'u1', 2, NOW), { ok: false, code: 'rate_limit_hour' });
});

test('checkRateLimit counts the pending recipients, not just history', async () => {
  // 15 already sent this hour; a 5-recipient compose exactly fills the window.
  assert.deepEqual(await checkRateLimit(fakeDb([15, 0, 0]), 'u1', 5, NOW), { ok: true });
  assert.deepEqual(
    await checkRateLimit(fakeDb([15, 0, 0]), 'u1', 6, NOW),
    { ok: false, code: 'rate_limit_hour' },
  );
});

test('checkRateLimit rejects on the daily and global windows', async () => {
  assert.deepEqual(await checkRateLimit(fakeDb([0, 100, 0]), 'u1', 1, NOW), { ok: false, code: 'rate_limit_day' });
  assert.deepEqual(await checkRateLimit(fakeDb([0, 0, 300]), 'u1', 1, NOW), { ok: false, code: 'rate_limit_global' });
});

test('checkRateLimit only counts successful sends', async () => {
  const db = fakeDb([0, 0, 0]);
  await checkRateLimit(db, 'u1', 1, NOW);
  for (const q of db.queries) {
    assert.match(q, /status = 'sent'/, 'rate limit must not count failed attempts');
  }
});
