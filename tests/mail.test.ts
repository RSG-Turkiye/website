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

test('validateCompose accepts at-limit subject, body, and recipient count', () => {
  // 200-character subject should pass
  const result1 = validateCompose({ ...good, subject: 'x'.repeat(200) });
  assert.strictEqual(result1.ok, true, '200-char subject should succeed');
  if (result1.ok) {
    assert.strictEqual(result1.recipients[0], 'hoca@uni.edu.tr');
  }

  // 20000-character body should pass
  const result2 = validateCompose({ ...good, body: 'x'.repeat(20000) });
  assert.strictEqual(result2.ok, true, '20000-char body should succeed');
  if (result2.ok) {
    assert.strictEqual(result2.recipients[0], 'hoca@uni.edu.tr');
  }

  // Exactly MAX_RECIPIENTS addresses should pass
  const to = Array.from({ length: MAX_RECIPIENTS }, (_, i) => `p${i}@uni.edu.tr`).join(',');
  const result3 = validateCompose({ ...good, to });
  assert.strictEqual(result3.ok, true, `exactly ${MAX_RECIPIENTS} recipients should succeed`);
  if (result3.ok) {
    assert.strictEqual(result3.recipients.length, MAX_RECIPIENTS, `should have exactly ${MAX_RECIPIENTS} recipients`);
  }
});

/** Stand-in for D1: returns queued counts in call order and records bind arguments. */
function fakeDb(counts: number[]) {
  const queue = [...counts];
  const queries: string[] = [];
  const bindings: Array<{ query: string; args: unknown[] }> = [];
  return {
    queries,
    bindings,
    prepare(query: string) {
      queries.push(query);
      return {
        bind: (...args: unknown[]) => {
          bindings.push({ query, args });
          return { first: async () => ({ n: queue.shift() ?? 0 }) };
        },
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

test('checkRateLimit binds hourly window with userId and hourly cutoff', async () => {
  const db = fakeDb([0, 0, 0]);
  const userId = 'test-user-123';
  await checkRateLimit(db, userId, 1, NOW);

  // First binding should be the hourly window query with (userId, NOW - 3600)
  const hourlyBinding = db.bindings[0];
  assert.ok(hourlyBinding, 'should have at least one binding');
  assert.match(hourlyBinding.query, /sender_user_id/, 'hourly query must filter by sender_user_id');
  assert.strictEqual(hourlyBinding.args[0], userId, 'hourly query first arg should be userId');
  assert.strictEqual(hourlyBinding.args[1], NOW - 3600, 'hourly query second arg should be NOW - 3600');
});

test('checkRateLimit binds daily per-user window with userId and daily cutoff', async () => {
  const db = fakeDb([0, 0, 0]);
  const userId = 'test-user-456';
  await checkRateLimit(db, userId, 1, NOW);

  // Second binding should be the daily per-user window query with (userId, NOW - 86400)
  const dailyBinding = db.bindings[1];
  assert.ok(dailyBinding, 'should have at least two bindings');
  assert.match(dailyBinding.query, /sender_user_id/, 'daily query must filter by sender_user_id');
  assert.strictEqual(dailyBinding.args[0], userId, 'daily query first arg should be userId');
  assert.strictEqual(dailyBinding.args[1], NOW - 86400, 'daily query second arg should be NOW - 86400');
});

test('checkRateLimit binds global daily window with only daily cutoff', async () => {
  const db = fakeDb([0, 0, 0]);
  await checkRateLimit(db, 'u1', 1, NOW);

  // Third binding should be the global daily window query with (NOW - 86400)
  const globalBinding = db.bindings[2];
  assert.ok(globalBinding, 'should have at least three bindings');
  assert.doesNotMatch(globalBinding.query, /sender_user_id/, 'global query must not filter by sender_user_id');
  assert.strictEqual(globalBinding.args.length, 1, 'global query should have exactly one bind argument');
  assert.strictEqual(globalBinding.args[0], NOW - 86400, 'global query arg should be NOW - 86400');
});
