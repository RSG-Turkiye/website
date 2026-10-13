import { test } from 'node:test';
import assert from 'node:assert/strict';
import { derivePostStatus, isLate, afterStep, LATE_SECONDS, RETRY_WINDOW_SECONDS, type TargetNow } from '../functions/_lib/social-dispatch';
import { classifyGraphError, graphReason, stepFromError } from '../functions/_lib/social/instagram-errors';

const T0 = 1_800_000_000;
const fresh: TargetNow = { status: 'queued', attempts: 0, first_tried_at: null, container_id: null, remote_id: null, permalink: null, published_at: null, last_error: null };

test('a post stays scheduled while any target is still on its way', () => {
  assert.equal(derivePostStatus(['published', 'queued']), 'scheduled');
  assert.equal(derivePostStatus(['publishing']), 'scheduled');
  assert.equal(derivePostStatus(['waiting_connection', 'published']), 'scheduled');
  assert.equal(derivePostStatus(['needs_confirmation']), 'scheduled');
});

test('once every target is settled, the post says how it went; skipped targets do not count', () => {
  assert.equal(derivePostStatus(['published']), 'published');
  assert.equal(derivePostStatus(['published', 'skipped']), 'published');
  assert.equal(derivePostStatus(['published', 'failed']), 'partially_published');
  assert.equal(derivePostStatus(['failed', 'skipped']), 'failed');
  assert.equal(derivePostStatus(['skipped']), 'failed', 'published nowhere');
});

test('late means more than two hours past, unless a publisher confirmed', () => {
  assert.equal(isLate(T0, T0 + LATE_SECONDS, null), false);
  assert.equal(isLate(T0, T0 + LATE_SECONDS + 1, null), true);
  assert.equal(isLate(T0, T0 + 3 * 86400, T0 + 3 * 86400 - 60), false);
});

test('pending stores the container and starts the clock once', () => {
  const a = afterStep({ kind: 'pending', containerId: 'c1' }, fresh, T0);
  assert.deepEqual([a.next.status, a.next.container_id, a.next.first_tried_at, a.audit, a.notify], ['publishing', 'c1', T0, 'social.target.container', null]);
  const b = afterStep({ kind: 'pending', containerId: 'c1' }, a.next, T0 + 60);
  assert.deepEqual([b.next.first_tried_at, b.audit], [T0, null], 'polling again is not news');
});

test('done records the result and clears the error', () => {
  const d = afterStep({ kind: 'done', remoteId: 'm1', permalink: 'https://www.instagram.com/p/x/' }, { ...fresh, status: 'publishing', container_id: 'c1', last_error: 'x' }, T0);
  assert.deepEqual([d.next.status, d.next.remote_id, d.next.permalink, d.next.published_at, d.next.last_error, d.audit], ['published', 'm1', 'https://www.instagram.com/p/x/', T0, null, 'social.target.published']);
});

test('retry counts, keeps the container unless told to clear it, and gives up after the window', () => {
  const r = afterStep({ kind: 'retry', reason: 'transient: 5xx' }, { ...fresh, status: 'publishing', container_id: 'c1' }, T0);
  assert.deepEqual([r.next.status, r.next.attempts, r.next.container_id, r.next.first_tried_at, r.next.last_error], ['publishing', 1, 'c1', T0, 'transient: 5xx']);
  const e = afterStep({ kind: 'retry', reason: 'expired: container', clearContainer: true }, r.next, T0 + 60);
  assert.deepEqual([e.next.status, e.next.container_id], ['queued', null]);
  const g = afterStep({ kind: 'retry', reason: 'transient: 5xx' }, { ...r.next, first_tried_at: T0 }, T0 + RETRY_WINDOW_SECONDS);
  assert.deepEqual([g.next.status, g.notify, g.audit], ['failed', 'failed', 'social.target.failed']);
});

test('fail and auth settle at once, with a notification', () => {
  const f = afterStep({ kind: 'fail', reason: 'bad_ratio: x' }, fresh, T0);
  assert.deepEqual([f.next.status, f.next.last_error, f.notify, f.audit], ['failed', 'bad_ratio: x', 'failed', 'social.target.failed']);
  const kept = afterStep({ kind: 'fail', reason: 'bad_ratio: x' }, { ...fresh, status: 'publishing', container_id: 'c1' }, T0);
  assert.equal(kept.next.container_id, 'c1', 'a refused publish may still have gone out: the container stays');
  const cleared = afterStep({ kind: 'fail', reason: 'container_error: ERROR', clearContainer: true }, { ...fresh, status: 'publishing', container_id: 'c1' }, T0);
  assert.deepEqual([cleared.next.status, cleared.next.container_id, cleared.notify], ['failed', null, 'failed']);
  const a = afterStep({ kind: 'auth', reason: 'auth: expired' }, fresh, T0);
  assert.deepEqual([a.next.status, a.notify, a.audit], ['waiting_connection', 'waiting_connection', 'social.target.waiting']);
});

test('Graph errors are classified on code and subcode', () => {
  assert.equal(classifyGraphError(400, { code: 190, error_subcode: 463 }), 'auth');
  assert.equal(classifyGraphError(400, { code: 10, message: 'Permission removed' }), 'auth');
  assert.equal(classifyGraphError(400, { code: 10, message: 'The user is not an Instagram Business' }), 'content');
  assert.equal(classifyGraphError(400, { code: 9007, error_subcode: 2207027 }), 'pending');
  assert.equal(classifyGraphError(400, { code: 24, error_subcode: 2207008 }), 'expired');
  assert.equal(classifyGraphError(400, { code: 36003, error_subcode: 2207009 }), 'content');
  assert.equal(classifyGraphError(400, { code: 9, error_subcode: 2207042 }), 'transient');
  assert.equal(classifyGraphError(400, { code: 17 }), 'transient');
  assert.equal(classifyGraphError(500, null), 'transient');
  assert.equal(classifyGraphError(0, null), 'transient', 'network');
  assert.equal(classifyGraphError(400, { code: 100, message: 'Invalid parameter' }), 'content');
});

test('reasons carry a key the panel can translate, then the provider text', () => {
  assert.equal(graphReason(400, { code: 36003, error_subcode: 2207009, message: 'ratio' }), 'bad_ratio: ratio');
  assert.equal(graphReason(400, { code: 10, message: 'The user is not an Instagram Business' }), 'needs_business: The user is not an Instagram Business');
  assert.equal(graphReason(503, null), 'unavailable: HTTP 503');
  assert.equal(stepFromError(400, { code: 190 }).kind, 'auth');
  assert.deepEqual(stepFromError(400, { code: 24, error_subcode: 2207008, message: 'gone' }), { kind: 'retry', reason: 'expired: gone', clearContainer: true });
});

test('a container still processing after the retry window fails the target instead of polling forever', () => {
  const p = afterStep({ kind: 'pending', containerId: 'c1' }, { ...fresh, status: 'publishing', container_id: 'c1', first_tried_at: T0 }, T0 + RETRY_WINDOW_SECONDS);
  assert.deepEqual([p.next.status, p.notify, p.audit], ['failed', 'failed', 'social.target.failed']);
  assert.ok(p.next.last_error?.startsWith('processing: '));
});

test('spam and account restriction are terminal content errors, even with a transient code', () => {
  assert.equal(classifyGraphError(400, { code: 4, error_subcode: 2207051 }), 'content');
  assert.equal(graphReason(400, { code: 4, error_subcode: 2207051, message: 'spam' }), 'spam: spam');
  assert.equal(classifyGraphError(400, { code: 25, error_subcode: 2207050 }), 'content');
});

test('HTTP 429 without a body is a rate limit', () => {
  assert.equal(graphReason(429, null), 'rate_limited: HTTP 429');
  assert.equal(classifyGraphError(429, null), 'transient');
});
