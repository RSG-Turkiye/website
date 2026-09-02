import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replySubject,
  buildReferences,
  computeThreadState,
  shouldNotify,
  snippet,
  NOTIFY_THROTTLE_SECONDS,
  MAX_REFERENCES,
} from '../functions/_lib/conversations';
import type { ParsedMessage } from '../functions/_lib/gmail-read';

function msg(over: Partial<ParsedMessage>): ParsedMessage {
  return {
    id: 'm',
    direction: 'in',
    rfc822MessageId: null,
    fromEmail: 'a@b.c',
    fromName: null,
    subject: null,
    bodyText: '',
    attachmentCount: 0,
    sentAt: 0,
    ...over,
  };
}

test('replySubject prefixes a plain subject', () => {
  assert.equal(replySubject('Sempozyum daveti'), 'Re: Sempozyum daveti');
});

test('replySubject does not double an existing prefix, in any case or spacing', () => {
  assert.equal(replySubject('Re: Sempozyum'), 'Re: Sempozyum');
  assert.equal(replySubject('re: Sempozyum'), 're: Sempozyum');
  assert.equal(replySubject('RE : Sempozyum'), 'RE : Sempozyum');
  assert.equal(replySubject('  Re: Sempozyum  '), 'Re: Sempozyum');
});

test('replySubject handles an empty subject', () => {
  assert.equal(replySubject('   '), 'Re:');
});

test('buildReferences drops nulls, deduplicates, and keeps order', () => {
  assert.deepEqual(
    buildReferences(['<a@x>', null, '<b@x>', '<a@x>']),
    ['<a@x>', '<b@x>'],
  );
});

test('buildReferences keeps only the most recent ids', () => {
  const ids = Array.from({ length: MAX_REFERENCES + 5 }, (_, i) => `<m${i}@x>`);
  const built = buildReferences(ids);
  assert.equal(built.length, MAX_REFERENCES);
  assert.equal(built[built.length - 1], `<m${ids.length - 1}@x>`);
  assert.equal(built[0], `<m${ids.length - MAX_REFERENCES}@x>`);
});

test('buildReferences on nothing usable returns an empty array', () => {
  assert.deepEqual(buildReferences([null, null]), []);
});

test('computeThreadState reports the newest message and its direction', () => {
  const state = computeThreadState([
    msg({ id: 'a', sentAt: 100, direction: 'out' }),
    msg({ id: 'b', sentAt: 300, direction: 'in' }),
    msg({ id: 'c', sentAt: 200, direction: 'out' }),
  ]);
  assert.deepEqual(state, { lastMessageAt: 300, lastDirection: 'in' });
});

test('computeThreadState on an empty thread returns null', () => {
  assert.equal(computeThreadState([]), null);
});

test('computeThreadState prefers the later entry when timestamps tie', () => {
  const state = computeThreadState([
    msg({ id: 'a', sentAt: 100, direction: 'out' }),
    msg({ id: 'b', sentAt: 100, direction: 'in' }),
  ]);
  assert.deepEqual(state, { lastMessageAt: 100, lastDirection: 'in' });
});

test('shouldNotify allows a first notification', () => {
  assert.equal(shouldNotify(null, 1_800_000_000), true);
});

test('shouldNotify blocks inside the throttle window and allows on its edge', () => {
  const now = 1_800_000_000;
  assert.equal(shouldNotify(now - NOTIFY_THROTTLE_SECONDS + 1, now), false);
  assert.equal(shouldNotify(now - NOTIFY_THROTTLE_SECONDS, now), true);
});

test('shouldNotify blocks a timestamp in the future rather than trusting it', () => {
  const now = 1_800_000_000;
  assert.equal(shouldNotify(now + 600, now), false);
});

test('snippet collapses whitespace and leaves a short body whole', () => {
  assert.equal(snippet('  Merhaba\n\n  dünya \t'), 'Merhaba dünya');
});

test('snippet truncates a long body with an ellipsis', () => {
  const long = 'x'.repeat(500);
  const out = snippet(long);
  assert.equal(out.length, 140);
  assert.ok(out.endsWith('…'));
});

test('snippet on an empty body returns an empty string', () => {
  assert.equal(snippet(''), '');
});
