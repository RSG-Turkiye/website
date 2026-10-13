# Social Media Panel, Phase 3a (Instagram Publishing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scheduled posts (single image, carousel, image story) go out to Instagram on time, from an account an admin connected once in the panel. Failures are classified, retried or reported, and every post shows per-platform results.

**Architecture:**
- **Connection:** Instagram Login OAuth stores a sealed 60-day token in `platform_connections` (phase 1 table and vault). A daily job refreshes it.
- **Dispatcher:** a new endpoint `/api/social/dispatch`, ticked every minute by `workers/mail-cron`, claims due `social_post_targets` rows with a lease. It runs one adapter step per target per tick and applies the result through one pure transition function.
- **Instagram adapter:** creates the container on one tick and polls it on later ticks. It publishes only when the container is `FINISHED` and records a container that is already `PUBLISHED` instead of publishing it again.
- **Post status** is derived from its targets by one pure function.

**Tech Stack:** Cloudflare Pages Functions, D1, Workers cron, Instagram Graph API (`graph.instagram.com/v25.0`), `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-social-media-panel-design.md`:
- "Constraints discovered"
- §3 data model
- §4 connections and adapters
- §5 publishing, failures and self-monitoring
- §7 testing
- §8 phase 3

Researched facts on Meta's API are summarised under "Instagram API facts" below. Phase 3b (phone quick story, video stories, live event mode) is a separate, later plan.

## Deliberate deviations from the spec (rulings)

- **No new secret for the tick.** The dispatcher reuses `MAIL_SYNC_SECRET` and the `X-Dispatch-Secret` header the mail-cron Worker already sends, compared with `safeEqual`, instead of a new `SOCIAL_DISPATCH_SECRET`. The Worker stays logic-free, and one secret fewer means one fewer thing to rotate.
- **Instagram app credentials are Pages secrets.** `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` are both secrets, not `[vars]`, so no account identifier lands in the public repo.
- **`failed` is no longer a locked post status.** A failed post can be edited (fix and retry) or re-queued. `published` and `partially_published` stay locked. This changes a phase 2a rule on purpose.
- **LinkedIn stays selectable for planning.** Its targets are marked `skipped` at publish time, with reason `not_available`, until phase 5. Skipped targets do not count when deriving the post status, so an Instagram-plus-LinkedIn post that went out on Instagram reads as `published`.
- **The lateness rule needs a marker.** Targets gain `confirmed_at`. "Publish anyway" sets it, so the 2-hour rule applies on every claim (including after a reconnect) unless a publisher confirmed.

## Global Constraints

- **Repo:** public. No secret, token, app id or account id in code, docs or tests. Tests use `example.org` and fake ids.
- **Writing rules:**
  - no em dash (U+2014) in `src/`, `functions/`, `tests/`, `workers/` or `README.md` lines you add;
  - every user-facing string in `src/i18n/ui.ts`, in both `en` and `tr`;
  - notifications are Turkish first, then English, in one message.
- **Secrets:**
  - every cron endpoint compares its secret with `safeEqual` from `functions/_lib/secret.ts`;
  - the social dispatcher reads `X-Dispatch-Secret` against `MAIL_SYNC_SECRET`;
  - daily jobs read `X-Archive-Secret` against `SYMPOSIUM_ARCHIVE_SECRET`.
- **Audit:** every state change the dispatcher or a daily job makes writes an `audit_log` row with `userId: null`. Every user action writes one with the user's id.
- **Instagram API (from the research):**
  - base `https://graph.instagram.com/v25.0`;
  - the account id is `/me?fields=user_id,username,account_type` → `user_id` (never `id`);
  - JPEG only, carousel 2 to 10 items;
  - containers expire after 24 h;
  - the image URL is `${PUBLIC_BLOG_IMAGES_URL}/${key}` (public, served as `image/jpeg` for `.jpg` keys).
- **Timing:**
  - lateness limit `LATE_SECONDS = 2 * 3600`;
  - transient retry window `RETRY_WINDOW_SECONDS = 2 * 3600` from the first attempt;
  - claim lease `CLAIM_LEASE_SECONDS = 10 * 60`, released explicitly after every step;
  - at most `TICK_BATCH = 2` targets per tick (a 10-item carousel is 11 Graph calls; Pages Functions allow 50 subrequests);
  - token refresh when under 20 days are left and the token is at least 24 h old.
- **Run** `npm test`, `npx astro check` (0 errors) and `npm run build` before every task's commit. Commit trailer: `Co-Authored-By: <your model> <noreply@anthropic.com>`.

## Instagram API facts (researched 2026-10-13; code defensively where marked)

- **OAuth.**
  - Authorize: `https://www.instagram.com/oauth/authorize?client_id&redirect_uri&response_type=code&scope=instagram_business_basic,instagram_business_content_publish&state`.
  - Strip a trailing `#_` from `code`.
  - Exchange: `POST https://api.instagram.com/oauth/access_token`, form `client_id, client_secret, grant_type=authorization_code, redirect_uri, code`. The response is either `{data:[{access_token,user_id,permissions}]}` or flat `{access_token,user_id,permissions}`, so parse both. `permissions` may be a comma string or an array.
  - Long-lived: `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret&access_token` gives `{access_token, expires_in}`.
  - Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token` gives the same shape. The token must be at least 24 h old and not expired.
- **Publish.**
  - `POST /<IG>/media` takes `image_url, caption, alt_text` for a single image. Carousel children take `image_url, is_carousel_item=true, alt_text`; the parent takes `media_type=CAROUSEL, children=<ids comma>, caption`. A story takes `media_type=STORIES, image_url`, with no caption and no alt text.
  - `alt_text` support under Instagram Login is partly unverified: on a code-100 error whose message names `alt_text`, retry once without it and note `alt_text_dropped`.
  - `GET /<container>?fields=status_code,status` returns `EXPIRED | ERROR | FINISHED | IN_PROGRESS | PUBLISHED`.
  - `POST /<IG>/media_publish creation_id` returns `{id}`. `GET /<media>?fields=permalink` is best effort and may be missing (stories).
- **Errors:** `{error:{message,type,code,error_subcode}}`. How each is classified is in Task 1.

## Review Focus

1. **An edit or cancel arrives while a target's container is being polled.** Expected: it is refused with `publishing_started` and nothing is published twice. Pinned in Task 2: guard and `targetStatements` tests.
2. **The isolate dies between `media_publish` and the database write.** Expected: the next tick sees the container `PUBLISHED`, records the target as published, and never calls `media_publish` again. Pinned in Task 4 (adapter) and Task 5 (dispatcher lifecycle).
3. **Instagram is reconnected after a two-day outage.** Expected: re-queued targets whose time is long past land in `needs_confirmation` and are not published. Pinned in Task 5 (lifecycle test) and Task 3 (re-queue on connect).
4. **A container never reaches `FINISHED`.**
   - `IN_PROGRESS` keeps polling until the 2-hour retry window ends, then fails with a sentence.
   - `EXPIRED` recreates the container.

   Pinned in Task 1 (transition) and Task 4 (adapter).
5. **The tick runs with no Instagram connection at all.** Expected: each due target moves once to `waiting_connection`, one notification goes out per target, and the next ticks do nothing. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `functions/_lib/social/types.ts` | `PublishStep`, `PostForPlatform`, `TargetState` |
| `functions/_lib/social/instagram-errors.ts` | Classify a Graph error; readable reason |
| `functions/_lib/social-dispatch.ts` | Pure: post status from targets, lateness, step to target transition |
| `functions/_lib/social/instagram.ts` | OAuth calls, token refresh rule, `instagramPublishStep` |
| `functions/_lib/social-dispatcher.ts` | One tick: claim, step, apply, derive, notify, audit |
| `functions/api/social/dispatch.ts` | Cron endpoint for the tick |
| `functions/api/admin/connections/instagram/start.ts`, `callback.ts` | Connect flow |
| `functions/api/social/posts/[id]/requeue.ts` | "Publish anyway" and "Retry" |
| `functions/api/admin/social/refresh-tokens.ts` | Daily token refresh |
| `functions/_lib/social-posts.ts` | `targetStatements` keeps started targets; `failed` unlocked; `not_jpeg` |
| `functions/_lib/social-notify.ts` | New kinds; `adminEmails` |
| `functions/_lib/dispatch-log.ts`, `functions/_lib/health.ts`, `functions/api/admin/health.ts` | Run kind; banner covers both ticks |
| `db/schema.sql` | Migration 8e |
| `workers/mail-cron/*`, `workers/symposium-cron/*` | Two new calls |
| `src/scripts/admin-connections.ts`, `src/scripts/admin-panel.ts` | Instagram Connect button, toasts |
| `src/scripts/social/*`, `src/components/admin/panes/SocialPane.astro` | Target results, requeue button, Published tab |
| `src/i18n/ui.ts`, `README.md` | Strings, setup and runbook |

---

### Task 1: Pure publishing rules

**Files:**
- Create: `functions/_lib/social/types.ts`, `functions/_lib/social/instagram-errors.ts`, `functions/_lib/social-dispatch.ts`
- Test: `tests/social-dispatch-rules.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type PublishStep = { kind: 'done'; remoteId: string | null; permalink: string | null; notes?: string[] } | { kind: 'pending'; containerId: string; notes?: string[] } | { kind: 'retry'; reason: string; clearContainer?: boolean } | { kind: 'fail'; reason: string } | { kind: 'auth'; reason: string }`
  - `interface PostForPlatform { type: 'image' | 'carousel' | 'story'; caption: string; media: { key: string; url: string; alt: string }[] }`
  - `interface TargetState { containerId: string | null }`
- Produces (`instagram-errors.ts`):
  - `interface GraphError { code?: number; error_subcode?: number; message?: string; type?: string }`
  - `type ErrorClass = 'auth' | 'pending' | 'expired' | 'content' | 'transient'`
  - `classifyGraphError(httpStatus: number, err: GraphError | null): ErrorClass`
  - `graphReason(httpStatus: number, err: GraphError | null): string`, of the form `"<key>: <detail>"` with key in `PUBLISH_REASON_KEYS`
  - `PUBLISH_REASON_KEYS`
  - `stepFromError(httpStatus, err): PublishStep`
- Produces (`social-dispatch.ts`):
  - `LATE_SECONDS`, `RETRY_WINDOW_SECONDS`
  - `type TargetStatus`
  - `derivePostStatus(statuses: TargetStatus[]): 'scheduled' | 'published' | 'partially_published' | 'failed'`
  - `isLate(scheduledAt: number, now: number, confirmedAt: number | null): boolean`
  - `interface TargetNow { status: TargetStatus; attempts: number; first_tried_at: number | null; container_id: string | null; remote_id: string | null; permalink: string | null; published_at: number | null; last_error: string | null }`
  - `interface Transition { next: TargetNow; notify: 'failed' | 'waiting_connection' | null; audit: string | null }`
  - `afterStep(step: PublishStep, t: TargetNow, now: number): Transition`

- [ ] **Step 1: Failing tests** `tests/social-dispatch-rules.test.ts`

```ts
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
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-dispatch-rules.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/social/types.ts`**

```ts
/**
 * What a platform adapter says after one step of publishing one target. The
 * dispatcher turns it into the target's next state (social-dispatch.ts).
 */
export type PublishStep =
  | { kind: 'done'; remoteId: string | null; permalink: string | null; notes?: string[] }
  /** Instagram is still processing the container; poll it next tick. */
  | { kind: 'pending'; containerId: string; notes?: string[] }
  /** Transient: try again next tick, within the retry window. */
  | { kind: 'retry'; reason: string; clearContainer?: boolean }
  /** The content itself was refused; a person has to change something. */
  | { kind: 'fail'; reason: string }
  /** The token no longer works; the target waits for a reconnect. */
  | { kind: 'auth'; reason: string };

export interface PostForPlatform {
  type: 'image' | 'carousel' | 'story';
  caption: string;
  media: { key: string; url: string; alt: string }[];
}

export interface TargetState { containerId: string | null }
```

- [ ] **Step 4: `functions/_lib/social/instagram-errors.ts`**

```ts
/**
 * Instagram Graph errors, sorted into what the dispatcher should do about
 * them. Classified on code and subcode together: Meta's documented table
 * and live responses do not always agree on which one carries the meaning.
 */
import type { PublishStep } from './types';

export interface GraphError { code?: number; error_subcode?: number; message?: string; type?: string }
export type ErrorClass = 'auth' | 'pending' | 'expired' | 'content' | 'transient';

const PENDING_SUBCODES = new Set([2207027]);
const EXPIRED_SUBCODES = new Set([2207006, 2207008, 2207020]);
const TRANSIENT_SUBCODES = new Set([2207001, 2207003, 2207032, 2207042, 2207052]);
const TRANSIENT_CODES = new Set([1, 2, -1, -2, 4, 9, 17, 32, 341, 368, 613]);
const NOT_BUSINESS = /not an instagram business/i;

export function classifyGraphError(httpStatus: number, err: GraphError | null): ErrorClass {
  if (!err) return httpStatus === 0 || httpStatus >= 500 || httpStatus === 429 ? 'transient' : 'content';
  const code = err.code ?? 0;
  const sub = err.error_subcode ?? 0;
  if (code === 190 || (code >= 200 && code <= 299)) return 'auth';
  if (code === 10) return NOT_BUSINESS.test(err.message ?? '') ? 'content' : 'auth';
  if (code === 9007 || PENDING_SUBCODES.has(sub)) return 'pending';
  if (EXPIRED_SUBCODES.has(sub)) return 'expired';
  if (TRANSIENT_SUBCODES.has(sub) || TRANSIENT_CODES.has(code)) return 'transient';
  if (httpStatus >= 500) return 'transient';
  return 'content';
}

/** Keys the panel turns into a sentence (admin.social.publishError.<key>). */
export const PUBLISH_REASON_KEYS = [
  'auth', 'needs_business', 'image_too_large', 'image_format', 'bad_ratio', 'caption_rejected', 'carousel_count',
  'account_restricted', 'spam', 'media_unreachable', 'rate_limited', 'daily_limit', 'expired', 'container_error',
  'unavailable', 'not_available', 'unknown',
] as const;

function reasonKey(httpStatus: number, err: GraphError | null): (typeof PUBLISH_REASON_KEYS)[number] {
  if (!err) return httpStatus === 0 || httpStatus >= 500 ? 'unavailable' : 'unknown';
  const code = err.code ?? 0;
  const sub = err.error_subcode ?? 0;
  if (code === 10 && NOT_BUSINESS.test(err.message ?? '')) return 'needs_business';
  if (code === 190 || code === 10 || (code >= 200 && code <= 299)) return 'auth';
  switch (sub) {
    case 2207004: return 'image_too_large';
    case 2207005: case 2207023: return 'image_format';
    case 2207009: return 'bad_ratio';
    case 2207010: case 2207040: return 'caption_rejected';
    case 2207028: return 'carousel_count';
    case 2207050: return 'account_restricted';
    case 2207051: return 'spam';
    case 2207052: case 2207003: return 'media_unreachable';
    case 2207042: return 'daily_limit';
    case 2207006: case 2207008: case 2207020: return 'expired';
  }
  if ([4, 17, 32, 341, 368, 613].includes(code)) return 'rate_limited';
  if (httpStatus >= 500 || code === 1 || code === 2 || code === -1 || code === -2) return 'unavailable';
  return 'unknown';
}

/** "<key>: <detail>", stored in last_error; the panel translates the key and shows the detail beneath. */
export function graphReason(httpStatus: number, err: GraphError | null): string {
  const detail = err?.message ?? `HTTP ${httpStatus}`;
  return `${reasonKey(httpStatus, err)}: ${detail}`.slice(0, 300);
}

export function stepFromError(httpStatus: number, err: GraphError | null): PublishStep {
  const reason = graphReason(httpStatus, err);
  switch (classifyGraphError(httpStatus, err)) {
    case 'auth': return { kind: 'auth', reason };
    case 'expired': return { kind: 'retry', reason, clearContainer: true };
    case 'transient': case 'pending': return { kind: 'retry', reason };
    default: return { kind: 'fail', reason };
  }
}
```

- [ ] **Step 5: `functions/_lib/social-dispatch.ts`**

```ts
/**
 * The publishing rules, free of I/O so they can be tested exactly
 * (spec §5): how a post's status follows from its targets, when a target is
 * too late to go out unattended, and what one adapter step does to a target.
 */
import type { PublishStep } from './social/types';

/** A "tomorrow at 18:00" post must not appear a day late without a person saying so. */
export const LATE_SECONDS = 2 * 3600;
/** Transient failures are retried every tick for this long from the first attempt. */
export const RETRY_WINDOW_SECONDS = 2 * 3600;

export type TargetStatus = 'queued' | 'waiting_connection' | 'needs_confirmation' | 'publishing' | 'published' | 'failed' | 'skipped';
const UNSETTLED: TargetStatus[] = ['queued', 'publishing', 'waiting_connection', 'needs_confirmation'];

export function derivePostStatus(statuses: TargetStatus[]): 'scheduled' | 'published' | 'partially_published' | 'failed' {
  const counted = statuses.filter((s) => s !== 'skipped');
  if (counted.some((s) => UNSETTLED.includes(s))) return 'scheduled';
  const published = counted.filter((s) => s === 'published').length;
  if (published === 0) return 'failed';
  return published === counted.length ? 'published' : 'partially_published';
}

export function isLate(scheduledAt: number, now: number, confirmedAt: number | null): boolean {
  return confirmedAt === null && now - scheduledAt > LATE_SECONDS;
}

export interface TargetNow {
  status: TargetStatus;
  attempts: number;
  first_tried_at: number | null;
  container_id: string | null;
  remote_id: string | null;
  permalink: string | null;
  published_at: number | null;
  last_error: string | null;
}

export interface Transition { next: TargetNow; notify: 'failed' | 'waiting_connection' | null; audit: string | null }

export function afterStep(step: PublishStep, t: TargetNow, now: number): Transition {
  switch (step.kind) {
    case 'done':
      return {
        next: { ...t, status: 'published', remote_id: step.remoteId, permalink: step.permalink, published_at: now, last_error: null },
        notify: null, audit: 'social.target.published',
      };
    case 'pending':
      return {
        next: { ...t, status: 'publishing', container_id: step.containerId, first_tried_at: t.first_tried_at ?? now },
        notify: null, audit: t.container_id === null ? 'social.target.container' : null,
      };
    case 'retry': {
      const first = t.first_tried_at ?? now;
      const tried = { ...t, attempts: t.attempts + 1, first_tried_at: first, last_error: step.reason };
      if (now - first >= RETRY_WINDOW_SECONDS) return { next: { ...tried, status: 'failed' }, notify: 'failed', audit: 'social.target.failed' };
      return step.clearContainer
        ? { next: { ...tried, status: 'queued', container_id: null }, notify: null, audit: null }
        : { next: tried, notify: null, audit: null };
    }
    case 'fail':
      return { next: { ...t, status: 'failed', last_error: step.reason }, notify: 'failed', audit: 'social.target.failed' };
    case 'auth':
      return { next: { ...t, status: 'waiting_connection', last_error: step.reason }, notify: 'waiting_connection', audit: 'social.target.waiting' };
  }
}
```

- [ ] **Step 6: Run the tests.** Run `node --import tsx --test tests/social-dispatch-rules.test.ts` (expected PASS), then `npm test && npx astro check`.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/social tests/social-dispatch-rules.test.ts functions/_lib/social-dispatch.ts
git commit -m "Social publishing rules: post status from targets, lateness, step transitions, Graph error classes"
```

---

### Task 2: Migration 8e and the data rules publishing needs

**Files:**
- Modify: `db/schema.sql`, `functions/_lib/social-posts.ts`, `functions/api/social/posts/[id].ts`, `functions/api/social/posts/[id]/cancel.ts`, `src/scripts/social/side-panel.ts`, `src/scripts/social/composer.ts`, `src/scripts/social/messages.ts`, `src/i18n/ui.ts`
- Test: `tests/social-posts.test.ts`, `tests/social-publish-guards.test.ts` (new)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:
  - Columns `social_post_targets.confirmed_at INTEGER` and `dispatch_runs.kind TEXT NOT NULL DEFAULT 'mail'`, plus index `idx_social_targets_status`.
  - `targetStatements` leaves `publishing` and `published` rows in place.
  - `LOCKED_STATUSES = ['published', 'partially_published', 'cancelled']`.
  - `statusAfterEdit` treats `failed` like `scheduled`.
  - `startedTargets(db, postId): Promise<number>`, the count of targets in `publishing | published`.
  - Readiness problem `not_jpeg` (with `index`).
  - Error code `publishing_started` (409).

- [ ] **Step 1: Schema.** In `db/schema.sql`:

  1. Add `confirmed_at INTEGER,` after `published_at INTEGER,` in `CREATE TABLE social_post_targets`, and `kind TEXT NOT NULL DEFAULT 'mail',` after `phase TEXT` in `CREATE TABLE dispatch_runs`. Fix the comma placement.
  2. After `CREATE TABLE ... social_post_targets`, add:

     ```sql
     CREATE INDEX IF NOT EXISTS idx_social_targets_status ON social_post_targets(status);
     ```

  3. Add this note after the 8d note:

```sql
-- 8e. Instagram publishing (phase 3a). Two columns on existing tables and an
--    index. ALTER TABLE ADD COLUMN is NOT idempotent -- run each once:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE social_post_targets ADD COLUMN confirmed_at INTEGER"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE dispatch_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'mail'"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_social_targets_status ON social_post_targets(status)"
--    Run them BEFORE deploying: the dispatcher writes confirmed_at and the
--    banner reads dispatch_runs.kind (it falls back to the old query, but the
--    social tick's run rows would fail to insert).
```

- [ ] **Step 2: Failing tests.** Append to `tests/social-posts.test.ts`:

```ts
test('readiness refuses a non-JPEG image: Instagram publishes JPEG only', () => {
  const png = '33333333-3333-4333-8333-333333333333.png';
  const d = new Map([[png, { width: 1080, height: 1350 }]]);
  assert.deepEqual(readinessProblems(ready({ media: [{ key: png, alt: 'x' }] }), d, NOW).map((p) => [p.code, p.index]), [['not_jpeg', 0]]);
});

test('a failed post can be fixed: it is no longer locked, and an editor\'s edit goes back for approval', () => {
  assert.equal(canEditPost({ id: 'ed', isPublisher: false }, { status: 'failed', created_by: 'ed' }), true);
  assert.equal(canEditPost({ id: 'ed', isPublisher: false }, { status: 'partially_published', created_by: 'ed' }), false);
  assert.equal(statusAfterEdit({ id: 'pub', isPublisher: true }, 'failed', false), 'scheduled');
  assert.equal(statusAfterEdit({ id: 'ed', isPublisher: false }, 'failed', false), 'pending_approval');
});
```

  Create `tests/social-publish-guards.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, KEYS, addMedia } from './lib/social';
import { onRequestPatch as patch } from '../functions/api/social/posts/[id]';
import { onRequestPost as cancel } from '../functions/api/social/posts/[id]/cancel';
import { targetStatements } from '../functions/_lib/social-posts';

const AT = Math.floor(Date.now() / 1000) + 3 * 86400;

function seed(db: import('node:sqlite').DatabaseSync, targets: [string, string][]) {
  addMedia(db, KEYS.feed, 1080, 1350);
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, write_nonce, created_by, created_at, updated_at)
              VALUES ('p1','image','Merhaba',?, '["instagram","linkedin"]', ?, 'scheduled', 3, 'n0', 'pub', 1, 1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), AT);
  for (const [platform, status] of targets) {
    db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, container_id) VALUES ('p1', ?, ?, ?)`).run(platform, status, status === 'publishing' ? 'c1' : null);
  }
}
const body = { revision: 3, type: 'image', caption: 'Değişti', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: AT };

test('an edit is refused once a target has started publishing', async () => {
  const { env, db } = setupSocial();
  seed(db, [['instagram', 'publishing']]);
  const res = await call(patch, 'PATCH', '/api/social/posts/p1', { env, as: 'pub', params: { id: 'p1' }, body });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'publishing_started');
  assert.equal((db.prepare(`SELECT container_id FROM social_post_targets`).get() as { container_id: string }).container_id, 'c1');
});

test('cancel is refused once a target has been published', async () => {
  const { env, db } = setupSocial();
  seed(db, [['instagram', 'published']]);
  const res = await call(cancel, 'POST', '/api/social/posts/p1/cancel', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 3 } });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as { code: string }).code, 'publishing_started');
});

test('re-writing targets keeps the ones already started and replaces the rest', async () => {
  const { db, env } = setupSocial();
  seed(db, [['instagram', 'published'], ['linkedin', 'failed']]);
  const raw = (env as { DB: D1Database }).DB;
  await raw.batch(targetStatements(raw, 'p1', 'n0', ['instagram', 'linkedin']));
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all();
  assert.deepEqual(rows.map((r) => ({ ...r })), [{ platform: 'instagram', status: 'published' }, { platform: 'linkedin', status: 'queued' }]);
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `node --import tsx --test tests/social-posts.test.ts tests/social-publish-guards.test.ts`
Expected: the new tests fail.

- [ ] **Step 4: `functions/_lib/social-posts.ts`**:

1. Change the locked list:

   ```ts
   /** Nobody edits these: they record what already happened, or what was abandoned. A failed post can be fixed and retried. */
   export const LOCKED_STATUSES: PostStatus[] = ['published', 'partially_published', 'cancelled'];
   ```

2. In `readinessProblems`, inside `post.media.forEach`, after the alt check, add:

   ```ts
   if (!m.key.endsWith('.jpg')) problems.push({ code: 'not_jpeg', index });
   ```

3. In `statusAfterEdit`, insert as the second line:

   ```ts
   const from = current === 'failed' ? 'scheduled' : current;
   ```

   Use `from` instead of `current` in the scheduled check, and in the final `return` return `from`. Update the comment: "A failed post is fixed like a scheduled one."

4. Replace `targetStatements` with:

```ts
/**
 * Replaces a post's not-yet-started targets (null: removes them), only if
 * this write's guarded update landed. A target already publishing or
 * published is left alone: deleting it and queueing it again would publish
 * the post twice.
 */
export function targetStatements(db: D1Database, postId: string, nonce: string, platforms: SocialPlatform[] | null): D1PreparedStatement[] {
  const statements = [
    db.prepare(`DELETE FROM social_post_targets WHERE post_id = ? AND status NOT IN ('publishing','published') AND ${POST_PROOF}`)
      .bind(postId, postId, nonce),
  ];
  for (const platform of platforms ?? []) {
    statements.push(db.prepare(
      `INSERT OR IGNORE INTO social_post_targets (post_id, platform, status) SELECT ?, ?, 'queued' WHERE ${POST_PROOF}`,
    ).bind(postId, platform, postId, nonce));
  }
  return statements;
}

/** How many of a post's targets have started publishing; an edit or cancel after that would publish twice or leave a stray post. */
export async function startedTargets(db: D1Database, postId: string): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM social_post_targets WHERE post_id = ? AND status IN ('publishing','published')`)
    .bind(postId).first<{ n: number }>();
  return r?.n ?? 0;
}
```

- [ ] **Step 5: Guards in the handlers.**
  - In `functions/api/social/posts/[id].ts` `onRequestPatch`, right after the `canEditPost` check, add:

    ```ts
    if (await startedTargets(env.DB, id)) return jsonResponse({ error: 'Publishing has started', code: 'publishing_started' }, 409);
    ```

  - In `cancel.ts`, after the `canCancelPost` block, add the same line.
  - Import `startedTargets` in both files.

- [ ] **Step 6: Client.**
  - In `src/scripts/social/side-panel.ts` and `composer.ts`, change the local `LOCKED` lists to `['published', 'partially_published', 'cancelled']`.
  - In `messages.ts`:
    - add `'not_jpeg'` to `PROBLEM_CODES` after `'bad_ratio'`;
    - add `'publishing_started'` to `ERROR_CODES` after `'not_cancellable'`.
  - In `src/i18n/ui.ts`:
    - en: `'admin.social.problem.not_jpeg': 'Image {n} is not a JPEG. Remove it and add it again; the panel converts it.',` and `'admin.social.error.publishing_started': 'This post has already started going out, so it can no longer be changed or cancelled.',`.
    - tr: `'admin.social.problem.not_jpeg': '{n}. görsel JPEG değil. Kaldırıp yeniden ekle; panel dönüştürür.',` and `'admin.social.error.publishing_started': 'Bu gönderinin yayını başladı; artık değiştirilemez ya da iptal edilemez.',`.

- [ ] **Step 7: Verify.** Run the two test files (PASS), then `npm test && npx astro check && npm run build`. If an existing test asserted the old `targetStatements` delete-all behaviour or `failed` being locked, update it to the new rule and name it in your report.

- [ ] **Step 8: Commit**

```bash
git add db/schema.sql functions/_lib/social-posts.ts "functions/api/social/posts/[id].ts" "functions/api/social/posts/[id]/cancel.ts" src/scripts/social src/i18n/ui.ts tests/social-posts.test.ts tests/social-publish-guards.test.ts
git commit -m "Social posts: migration 8e, started targets are never rewritten, failed posts can be fixed, JPEG only"
```

---

### Task 3: Connect Instagram from the panel

**Files:**
- Create: `functions/_lib/social/instagram.ts` (OAuth half; Task 4 adds publishing to the same file), `functions/api/admin/connections/instagram/start.ts`, `functions/api/admin/connections/instagram/callback.ts`, `tests/lib/instagram.ts`, `tests/instagram-connect.test.ts`
- Modify: `functions/_lib/auth.ts` (Env), `functions/_lib/connections.ts` (`readAccessToken`), `src/scripts/admin-connections.ts`, `src/scripts/admin-panel.ts`, `src/i18n/ui.ts`

**Interfaces:**
- Produces (`instagram.ts`):
  - `IG_GRAPH = 'https://graph.instagram.com/v25.0'`, `IG_SCOPES`
  - `instagramRedirectUri(base: string): string`, `instagramAuthUrl(env, base, state): string`
  - `exchangeInstagramCode(env, base, code): Promise<{ ok: true; token: string; userId: string; permissions: string[] } | { ok: false; status: number }>`
  - `longLivedInstagramToken(env, shortToken): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number }>`
  - `refreshInstagramToken(token): Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number; auth: boolean; reason: string }>`
  - `instagramMe(token): Promise<{ ok: true; userId: string; username: string; accountType: string } | { ok: false; status: number; auth: boolean }>`
  - `needsRefresh(row: { expires_at: number | null; connected_at: number | null }, now: number): boolean`
- Produces (`connections.ts`): `readAccessToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null>`
- Produces (`tests/lib/instagram.ts`):
  - `type GraphCall = { method: string; host: string; path: string; params: URLSearchParams }`
  - `stubGraph(handler: (c: GraphCall) => Response | undefined): { calls: GraphCall[]; restore(): void }`. Non-Instagram URLs, or a handler returning `undefined`, fall through to whatever `fetch` was installed before.
- Env: `INSTAGRAM_APP_ID?: string; INSTAGRAM_APP_SECRET?: string;`
- Connection error codes, new: `not_configured`, `not_professional`.

- [ ] **Step 1: Test helper** `tests/lib/instagram.ts`

```ts
/** Stubs Instagram's hosts and passes every other URL to the fetch installed before (stubMail, for example). */
export type GraphCall = { method: string; host: string; path: string; params: URLSearchParams };

const HOSTS = ['graph.instagram.com', 'api.instagram.com'];

export function stubGraph(handler: (c: GraphCall) => Response | undefined) {
  const calls: GraphCall[] = [];
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    if (!HOSTS.includes(url.host)) return before(input, init);
    const params = new URLSearchParams(url.search);
    if (init?.body) for (const [k, v] of new URLSearchParams(String(init.body))) params.set(k, v);
    const c = { method: (init?.method ?? 'GET').toUpperCase(), host: url.host, path: url.pathname.replace(/^\/v\d+\.\d+/, ''), params };
    calls.push(c);
    const res = handler(c);
    if (!res) throw new Error(`unexpected Instagram call ${c.method} ${c.host}${c.path}`);
    return res;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
```

- [ ] **Step 2: Failing tests** `tests/instagram-connect.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { stubGraph } from './lib/instagram';
import { onRequestGet as start } from '../functions/api/admin/connections/instagram/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/instagram/callback';
import { getConnection, readAccessToken } from '../functions/_lib/connections';
import { needsRefresh } from '../functions/_lib/social/instagram';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const KEY = Buffer.alloc(32, 1).toString('base64');

function setup(extra: Record<string, unknown> = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, INSTAGRAM_APP_ID: 'app-1', INSTAGRAM_APP_SECRET: 'sec-1', ...extra };
  return { db, env };
}
const get = (h: unknown, url: string, env: unknown) =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(url, { headers: { Cookie: 'rsg_session=s1' } }), env });

async function begin(env: unknown) {
  const res = await get(start, `${BASE}/api/admin/connections/instagram/start`, env);
  assert.equal(res.status, 302);
  return new URL(res.headers.get('Location')!);
}

function instagram(opts: { accountType?: string; permissions?: string; flat?: boolean } = {}) {
  return stubGraph((c) => {
    if (c.host === 'api.instagram.com' && c.path === '/oauth/access_token') {
      const row = { access_token: 'short', user_id: 111, permissions: opts.permissions ?? 'instagram_business_basic,instagram_business_content_publish' };
      return Response.json(opts.flat ? row : { data: [row] });
    }
    if (c.path === '/access_token') return Response.json({ access_token: 'long-1', token_type: 'bearer', expires_in: 5184000 });
    if (c.path === '/me') return Response.json({ user_id: '17841400000000000', id: 'app-scoped', username: 'rsg_test', account_type: opts.accountType ?? 'MEDIA_CREATOR' });
    return undefined;
  });
}

test('start sends the admin to Instagram with both scopes and our callback', async () => {
  const { env } = setup();
  const u = await begin(env);
  assert.equal(u.origin + u.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(u.searchParams.get('client_id'), 'app-1');
  assert.equal(u.searchParams.get('redirect_uri'), `${BASE}/api/admin/connections/instagram/callback`);
  assert.equal(u.searchParams.get('scope'), 'instagram_business_basic,instagram_business_content_publish');
  assert.ok(u.searchParams.get('state'));
});

test('start without the app credentials says so instead of failing at Instagram', async () => {
  const { env } = setup({ INSTAGRAM_APP_SECRET: undefined });
  const res = await get(start, `${BASE}/api/admin/connections/instagram/start`, env);
  assert.match(res.headers.get('Location')!, /connection_error=not_configured/);
});

test('callback stores a sealed long-lived token under the account id from /me, and re-queues waiting targets', async () => {
  const { env, db } = setup();
  db.prepare(`INSERT INTO social_posts (id, type, created_by, created_at, updated_at, status) VALUES ('p1','image','u1',1,1,'scheduled')`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, claimed_at) VALUES ('p1','instagram','waiting_connection', 5)`).run();
  const state = (await begin(env)).searchParams.get('state')!;
  const ig = instagram();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc%23_&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /\/admin\?connected=instagram$/);
    assert.equal(ig.calls[0].params.get('code'), 'abc', 'the #_ suffix is stripped');
    assert.equal(ig.calls[0].params.get('redirect_uri'), `${BASE}/api/admin/connections/instagram/callback`);
  } finally { ig.restore(); }
  const row = (await getConnection(env.DB as never, 'instagram'))!;
  assert.equal(row.account_id, '17841400000000000');
  assert.equal(row.account_name, 'rsg_test');
  assert.ok(row.expires_at! > Math.floor(Date.now() / 1000) + 59 * 86400);
  assert.equal(await readAccessToken(env, row), 'long-1');
  assert.notEqual(row.access_token_enc, 'long-1');
  assert.deepEqual({ ...db.prepare(`SELECT status, claimed_at FROM social_post_targets`).get() as object }, { status: 'queued', claimed_at: null });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.connect'`).get() as { n: number }).n, 1);
});

test('callback accepts the flat token shape too', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const ig = instagram({ flat: true });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
    assert.match(res.headers.get('Location')!, /connected=instagram/);
  } finally { ig.restore(); }
});

test('callback refuses a personal account and a grant without publishing', async () => {
  for (const [opts, code] of [[{ accountType: 'PERSONAL' }, 'not_professional'], [{ permissions: 'instagram_business_basic' }, 'missing_scope']] as const) {
    const { env } = setup();
    const state = (await begin(env)).searchParams.get('state')!;
    const ig = instagram(opts);
    try {
      const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?code=abc&state=${state}`, env);
      assert.match(res.headers.get('Location')!, new RegExp(`connection_error=${code}`));
    } finally { ig.restore(); }
    assert.equal(await getConnection(env.DB as never, 'instagram'), null);
  }
});

test('a cancelled authorisation stores nothing', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const res = await get(callback, `${BASE}/api/admin/connections/instagram/callback?error=access_denied&state=${state}`, env);
  assert.match(res.headers.get('Location')!, /connection_error=cancelled/);
});

test('a token is refreshed when under 20 days are left and it is at least a day old', () => {
  const now = 1_800_000_000;
  assert.equal(needsRefresh({ expires_at: now + 19 * 86400, connected_at: now - 40 * 86400 }, now), true);
  assert.equal(needsRefresh({ expires_at: now + 21 * 86400, connected_at: now - 40 * 86400 }, now), false);
  assert.equal(needsRefresh({ expires_at: now + 19 * 86400, connected_at: now - 3600 }, now), false);
  assert.equal(needsRefresh({ expires_at: null, connected_at: now - 40 * 86400 }, now), false);
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `node --import tsx --test tests/instagram-connect.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Env and `readAccessToken`.**
  - In `functions/_lib/auth.ts` `Env`, after `GMAIL_ACCOUNT?: string;`, add:

    ```ts
      /** Instagram app (Meta dashboard, Instagram > API setup with Instagram login). Both are Pages secrets. */
      INSTAGRAM_APP_ID?: string;
      INSTAGRAM_APP_SECRET?: string;
    ```

  - In `functions/_lib/connections.ts`, next to `readRefreshToken`, add:

```ts
/** The stored access token, or null when there is none or it cannot be opened (wrong key, tampered row). */
export async function readAccessToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null> {
  if (!row.access_token_enc) return null;
  try {
    return await unseal(env.TOKEN_ENC_KEY, row.access_token_enc, tokenContext(row.platform as Platform, 'access'));
  } catch {
    return null;
  }
}
```

  (Import `unseal` if the file does not already.)

- [ ] **Step 5: `functions/_lib/social/instagram.ts`** (OAuth half)

```ts
/**
 * Instagram API with Instagram Login (graph.instagram.com): connecting the
 * account, keeping its 60-day token alive, and (below, Task 4) publishing.
 * Where Meta's documentation and live responses have been seen to differ,
 * the code accepts both shapes.
 */
import type { Env } from '../auth';

export const IG_GRAPH = 'https://graph.instagram.com/v25.0';
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const PROFESSIONAL = ['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'];

type App = Pick<Env, 'INSTAGRAM_APP_ID' | 'INSTAGRAM_APP_SECRET'>;

export const instagramRedirectUri = (base: string) => `${base}/api/admin/connections/instagram/callback`;

export function instagramAuthUrl(env: App, base: string, state: string): string {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', env.INSTAGRAM_APP_ID ?? '');
  u.searchParams.set('redirect_uri', instagramRedirectUri(base));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IG_SCOPES.join(','));
  u.searchParams.set('state', state);
  return u.toString();
}

export const isProfessional = (accountType: string) => PROFESSIONAL.includes(accountType.toUpperCase());

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' ? v as Record<string, unknown> : null)).catch(() => null);
}
const isAuthError = (body: Record<string, unknown> | null) => {
  const code = (body?.error as { code?: number } | undefined)?.code;
  return code === 190 || code === 10 || body?.error_type === 'OAuthException';
};

export async function exchangeInstagramCode(env: App, base: string, code: string):
  Promise<{ ok: true; token: string; userId: string; permissions: string[] } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID ?? '', client_secret: env.INSTAGRAM_APP_SECRET ?? '',
        grant_type: 'authorization_code', redirect_uri: instagramRedirectUri(base), code,
      }).toString(),
    });
  } catch { return { ok: false, status: 0 }; }
  const body = await json(res);
  // Documented as {data:[{...}]}; also seen flat.
  const row = (Array.isArray(body?.data) ? (body!.data as Record<string, unknown>[])[0] : body) ?? null;
  const token = row?.access_token;
  if (!res.ok || typeof token !== 'string') return { ok: false, status: res.status };
  const raw = row!.permissions;
  const permissions = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()) : [];
  return { ok: true, token, userId: String(row!.user_id ?? ''), permissions };
}

export async function longLivedInstagramToken(env: App, shortToken: string):
  Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number }> {
  const u = new URL('https://graph.instagram.com/access_token');
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET ?? '');
  u.searchParams.set('access_token', shortToken);
  let res: Response;
  try { res = await fetch(u); } catch { return { ok: false, status: 0 }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status };
  return { ok: true, token: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400 };
}

export async function refreshInstagramToken(token: string):
  Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number; auth: boolean; reason: string }> {
  const u = new URL('https://graph.instagram.com/refresh_access_token');
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', token);
  let res: Response;
  try { res = await fetch(u); } catch (err) { return { ok: false, status: 0, auth: false, reason: String(err).slice(0, 200) }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') {
    const message = (body?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    return { ok: false, status: res.status, auth: isAuthError(body), reason: message.slice(0, 200) };
  }
  return { ok: true, token: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400 };
}

export async function instagramMe(token: string):
  Promise<{ ok: true; userId: string; username: string; accountType: string } | { ok: false; status: number; auth: boolean }> {
  const u = new URL(`${IG_GRAPH}/me`);
  u.searchParams.set('fields', 'user_id,username,account_type');
  u.searchParams.set('access_token', token);
  let res: Response;
  try { res = await fetch(u); } catch { return { ok: false, status: 0, auth: false }; }
  const body = await json(res);
  // user_id is the professional account's id, the one /<IG>/media takes; `id` is app-scoped.
  if (!res.ok || body?.user_id === undefined) return { ok: false, status: res.status, auth: isAuthError(body) };
  return { ok: true, userId: String(body.user_id), username: String(body.username ?? ''), accountType: String(body.account_type ?? '') };
}

/** Instagram refuses to refresh a token younger than a day; past 60 days it cannot be refreshed at all. */
export const REFRESH_BEFORE_SECONDS = 20 * 86400;
export function needsRefresh(row: { expires_at: number | null; connected_at: number | null }, now: number): boolean {
  if (row.expires_at === null || row.connected_at === null) return false;
  return row.expires_at - now < REFRESH_BEFORE_SECONDS && now - row.connected_at >= 86400;
}
```

  The refresh sets `connected_at` only on connect, so after the first refresh "a day old" holds for good. That is correct: a refreshed token is at least 40 days from needing it again.

- [ ] **Step 6: `functions/api/admin/connections/instagram/start.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { appendAudit } from '../../../../_lib/audit';
import { instagramAuthUrl } from '../../../../_lib/social/instagram';

/** "Connect Instagram": admin only, a one-use state, then Instagram's own consent screen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  if (!env.INSTAGRAM_APP_ID || !env.INSTAGRAM_APP_SECRET || !env.TOKEN_ENC_KEY) {
    return redirectResponse(`${getBaseUrl(request)}${returnTo}?connection_error=not_configured`);
  }
  const state = await createState(env.DB, 'instagram', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'instagram' }, now);
  return redirectResponse(instagramAuthUrl(env, getBaseUrl(request), state));
};
```

- [ ] **Step 7: `functions/api/admin/connections/instagram/callback.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeInstagramCode, longLivedInstagramToken, instagramMe, isProfessional, IG_SCOPES } from '../../../../_lib/social/instagram';

/**
 * Finishes "Connect Instagram". Every way out is a redirect back to the
 * panel with ?connected=instagram or ?connection_error=<code>. Nothing is
 * stored unless every check passes. A successful connect re-queues every
 * target that was waiting for one; the dispatcher's lateness rule decides
 * whether each still goes out on its own.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'instagram') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'instagram', details }, now);

  // Instagram appends "#_" to the code in the redirect; it is not part of it.
  const code = url.searchParams.get('code')?.replace(/#_$/, '') ?? null;
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }

  const short = await exchangeInstagramCode(env, base, code);
  if (!short.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: short.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!IG_SCOPES.every((s) => short.permissions.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', permissions: short.permissions });
    return back(returnTo, 'connection_error=missing_scope');
  }
  const long = await longLivedInstagramToken(env, short.token);
  if (!long.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'long_lived', status: long.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  const me = await instagramMe(long.token);
  if (!me.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'me', status: me.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!isProfessional(me.accountType)) {
    await audit('connection.rejected', { reason: 'not_professional', accountType: me.accountType });
    return back(returnTo, 'connection_error=not_professional');
  }

  try {
    const upsert = await connectionUpsert(env, 'instagram', {
      accountId: me.userId, accountName: me.username, accessToken: long.token, refreshToken: null,
      scopes: short.permissions.join(','), expiresAt: now + long.expiresIn, refreshExpiresAt: null,
    }, user.id, now);
    const requeue = env.DB.prepare(
      `UPDATE social_post_targets SET status = 'queued', claimed_at = NULL WHERE platform = 'instagram' AND status = 'waiting_connection'`,
    );
    await runWithAudit(env.DB, [upsert, requeue], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'instagram',
      details: { account: me.username, accountType: me.accountType, scopes: short.permissions },
    }, now);
  } catch (err) {
    console.error('instagram connection store failed', err);
    await audit('connection.rejected', { reason: 'store_failed' });
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=instagram');
};
```

- [ ] **Step 8: Panel.**
  - In `src/scripts/admin-connections.ts` `actions(c)`:
    - replace the first line with `if (c.platform !== 'gmail' && c.platform !== 'instagram') return ...later...;`;
    - build the connect `href` as `/api/admin/connections/${c.platform}/start?lang=${deps.lang}`.
  - In `row(c)`, show Instagram's account name as `@name`: replace `escapeHtml(c.accountName ?? '')` with `escapeHtml(c.accountName ? (c.platform === 'instagram' ? `@${c.accountName}` : c.accountName) : '')`.
  - In `src/scripts/admin-panel.ts`, add `'not_configured', 'not_professional'` to the `known` list. Update the comment above it to "Back from connecting an account".
  - In `src/i18n/ui.ts`, next to the other `admin.connections.error.*` keys:
    - en: `'admin.connections.error.not_configured': 'The Instagram app is not set up on the site yet (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET). See the README.',` and `'admin.connections.error.not_professional': 'That Instagram account is personal. Switch it to a professional (Business or Creator) account in the Instagram app, then connect again.',`.
    - tr: `'admin.connections.error.not_configured': 'Instagram uygulaması sitede henüz ayarlanmamış (INSTAGRAM_APP_ID / INSTAGRAM_APP_SECRET). README\'ye bak.',` and `'admin.connections.error.not_professional': 'Bu Instagram hesabı kişisel. Instagram uygulamasından profesyonel (İşletme ya da İçerik üreticisi) hesaba geçir, sonra yeniden bağla.',`.

- [ ] **Step 9: Verify.** Run `node --import tsx --test tests/instagram-connect.test.ts` (PASS), then `npm test && npx astro check && npm run build`.

- [ ] **Step 10: Commit**

```bash
git add functions/_lib/auth.ts functions/_lib/connections.ts functions/_lib/social/instagram.ts functions/api/admin/connections/instagram tests/lib/instagram.ts tests/instagram-connect.test.ts src/scripts/admin-connections.ts src/scripts/admin-panel.ts src/i18n/ui.ts
git commit -m "Connect Instagram from the panel: Instagram Login, sealed 60-day token, waiting posts re-queued"
```

---

### Task 4: Instagram publishing adapter

**Files:**
- Modify: `functions/_lib/social/instagram.ts` (append)
- Test: `tests/instagram-publish.test.ts`

**Interfaces:**
- Consumes: Task 1 (`PublishStep`, `PostForPlatform`, `TargetState`, `stepFromError`, `classifyGraphError`), Task 3 (`IG_GRAPH`, `stubGraph`).
- Produces: `instagramPublishStep(input: { igUserId: string; token: string; post: PostForPlatform; state: TargetState }): Promise<PublishStep>`

- [ ] **Step 1: Failing tests** `tests/instagram-publish.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubGraph, type GraphCall } from './lib/instagram';
import { instagramPublishStep } from '../functions/_lib/social/instagram';
import type { PostForPlatform } from '../functions/_lib/social/types';

const IG = '17841400000000000';
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://rsg-turkiye.iscbsc.org/api/images/k${n}.jpg`, alt: `Alt ${n}` });
const single: PostForPlatform = { type: 'image', caption: 'Merhaba\n\n🔗 Link profilde', media: [img(1)] };
const err = (code: number, sub?: number, message = 'x', status = 400) => Response.json({ error: { code, error_subcode: sub, message } }, { status });
const step = (post: PostForPlatform, containerId: string | null = null) => instagramPublishStep({ igUserId: IG, token: 'tok', post, state: { containerId } });

async function withGraph<T>(h: (c: GraphCall) => Response | undefined, run: () => Promise<T>) {
  const g = stubGraph(h);
  try { return { result: await run(), calls: g.calls }; } finally { g.restore(); }
}

test('first tick creates a single-image container with caption and alt text, and waits', async () => {
  const { result, calls } = await withGraph((c) => (c.method === 'POST' && c.path === `/${IG}/media` ? Response.json({ id: 'c1' }) : undefined), () => step(single));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1', notes: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.get('image_url'), single.media[0].url);
  assert.equal(calls[0].params.get('caption'), single.caption);
  assert.equal(calls[0].params.get('alt_text'), 'Alt 1');
  assert.equal(calls[0].params.get('access_token'), 'tok');
});

test('alt text refused by the API: the container is made without it, and the gap is noted', async () => {
  let n = 0;
  const { result, calls } = await withGraph((c) => {
    if (c.path !== `/${IG}/media`) return undefined;
    return n++ === 0 ? err(100, undefined, 'Invalid parameter alt_text') : Response.json({ id: 'c1' });
  }, () => step(single));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1', notes: ['alt_text_dropped'] });
  assert.equal(calls[1].params.has('alt_text'), false);
});

test('a carousel makes one child per image, then the parent with the caption', async () => {
  const post: PostForPlatform = { type: 'carousel', caption: 'Üç görsel', media: [img(1), img(2), img(3)] };
  let child = 0;
  const { result, calls } = await withGraph((c) => {
    if (c.path !== `/${IG}/media`) return undefined;
    return c.params.get('media_type') === 'CAROUSEL' ? Response.json({ id: 'parent' }) : Response.json({ id: `child${++child}` });
  }, () => step(post));
  assert.deepEqual(result, { kind: 'pending', containerId: 'parent', notes: [] });
  assert.deepEqual(calls.slice(0, 3).map((c) => [c.params.get('is_carousel_item'), c.params.get('alt_text'), c.params.has('caption')]), [['true', 'Alt 1', false], ['true', 'Alt 2', false], ['true', 'Alt 3', false]]);
  assert.equal(calls[3].params.get('children'), 'child1,child2,child3');
  assert.equal(calls[3].params.get('caption'), 'Üç görsel');
});

test('a story is media_type STORIES with no caption or alt text', async () => {
  const post: PostForPlatform = { type: 'story', caption: 'ignored', media: [img(1)] };
  const { result, calls } = await withGraph((c) => (c.path === `/${IG}/media` ? Response.json({ id: 's1' }) : undefined), () => step(post));
  assert.equal(result.kind, 'pending');
  assert.equal(calls[0].params.get('media_type'), 'STORIES');
  assert.equal(calls[0].params.has('caption'), false);
  assert.equal(calls[0].params.has('alt_text'), false);
});

test('a container still processing is polled again later; a finished one is published and its link read', async () => {
  const waiting = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'IN_PROGRESS' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(waiting.result, { kind: 'pending', containerId: 'c1' });
  const done = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.method === 'POST' && c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return Response.json({ permalink: 'https://www.instagram.com/p/abc/', id: 'm1' });
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(done.result, { kind: 'done', remoteId: 'm1', permalink: 'https://www.instagram.com/p/abc/' });
  assert.equal(done.calls.find((c) => c.path === `/${IG}/media_publish`)!.params.get('creation_id'), 'c1');
});

test('a container already PUBLISHED (crash after publishing) is recorded, never published again', async () => {
  const { result, calls } = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'PUBLISHED' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_published_container'] });
  assert.equal(calls.some((c) => c.path.endsWith('/media_publish')), false);
});

test('an expired container is recreated; an errored one fails with its status', async () => {
  const expired = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'EXPIRED' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(expired.result, { kind: 'retry', reason: 'expired: container expired', clearContainer: true });
  const broken = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'ERROR', status: 'Error: unsupported' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(broken.result, { kind: 'fail', reason: 'container_error: Error: unsupported' });
});

test('publish says "not ready yet": keep polling the same container', async () => {
  const { result } = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.path === `/${IG}/media_publish`) return err(9007, 2207027, 'Media ID is not available');
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1' });
});

test('a missing permalink does not fail a publish', async () => {
  const { result } = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return err(100, undefined, 'no permalink');
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'done', remoteId: 'm1', permalink: null });
});

test('errors become steps: expired token, ratio, 5xx, network', async () => {
  const cases: [Response | 'throw', string][] = [[err(190, 463, 'expired'), 'auth'], [err(36003, 2207009, 'ratio'), 'fail'], [new Response('', { status: 503 }), 'retry'], ['throw', 'retry']];
  for (const [res, kind] of cases) {
    const g = stubGraph(() => { if (res === 'throw') throw new TypeError('network'); return res; });
    try { assert.equal((await step(single)).kind, kind, String(kind)); } finally { g.restore(); }
  }
});
```

  The "network" case throws inside the stub; the adapter must catch a thrown `fetch` as status 0.

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/instagram-publish.test.ts`
Expected: FAIL, `instagramPublishStep` not exported.

- [ ] **Step 3: Append to `functions/_lib/social/instagram.ts`**

```ts
import type { PublishStep, PostForPlatform, TargetState } from './types';
import { stepFromError, classifyGraphError, type GraphError } from './instagram-errors';

type GraphResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: GraphError | null };

/** One Graph call. Never throws: a dropped connection is status 0, which classifies as transient. */
async function graph(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string>): Promise<GraphResult> {
  const url = new URL(`${IG_GRAPH}/${path}`);
  const all = { ...params, access_token: token };
  let res: Response;
  try {
    if (method === 'GET') {
      for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
      res = await fetch(url);
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(all).toString(),
      });
    }
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !body || body.error) return { ok: false, status: res.status, error: (body?.error as GraphError | undefined) ?? null };
  return { ok: true, data: body };
}

const fromFailure = (r: Extract<GraphResult, { ok: false }>) => stepFromError(r.status, r.error);

/** Creates a media container; if this API version refuses alt_text, makes it once more without and says so. */
async function createContainer(igUserId: string, token: string, params: Record<string, string>, alt: string, notes: string[]): Promise<GraphResult> {
  const first = await graph('POST', `${igUserId}/media`, token, alt ? { ...params, alt_text: alt } : params);
  if (!first.ok && alt && first.error?.code === 100 && /alt_text/i.test(first.error.message ?? '')) {
    if (!notes.includes('alt_text_dropped')) notes.push('alt_text_dropped');
    return graph('POST', `${igUserId}/media`, token, params);
  }
  return first;
}

/**
 * One step for one target (spec §5). With no container yet it creates one
 * (children first for a carousel) and returns pending. With a container it
 * reads its status: still processing waits; finished publishes; already
 * PUBLISHED means a previous tick published and died before recording it,
 * so the result is recorded and nothing is published twice.
 */
export async function instagramPublishStep(input: { igUserId: string; token: string; post: PostForPlatform; state: TargetState }): Promise<PublishStep> {
  const { igUserId, token, post, state } = input;
  if (state.containerId) {
    const s = await graph('GET', state.containerId, token, { fields: 'status_code,status' });
    if (!s.ok) return fromFailure(s);
    switch (s.data.status_code) {
      case 'PUBLISHED':
        return { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_published_container'] };
      case 'IN_PROGRESS':
        return { kind: 'pending', containerId: state.containerId };
      case 'EXPIRED':
        return { kind: 'retry', reason: 'expired: container expired', clearContainer: true };
      case 'FINISHED': {
        const p = await graph('POST', `${igUserId}/media_publish`, token, { creation_id: state.containerId });
        if (!p.ok) {
          return classifyGraphError(p.status, p.error) === 'pending' ? { kind: 'pending', containerId: state.containerId } : fromFailure(p);
        }
        const remoteId = String(p.data.id);
        const link = await graph('GET', remoteId, token, { fields: 'permalink' });
        const permalink = link.ok && typeof link.data.permalink === 'string' ? link.data.permalink : null;
        return { kind: 'done', remoteId, permalink };
      }
      default:
        return { kind: 'fail', reason: `container_error: ${String(s.data.status ?? s.data.status_code ?? 'unknown')}`.slice(0, 300) };
    }
  }

  const notes: string[] = [];
  let created: GraphResult;
  if (post.type === 'story') {
    created = await graph('POST', `${igUserId}/media`, token, { media_type: 'STORIES', image_url: post.media[0].url });
  } else if (post.type === 'carousel') {
    const children: string[] = [];
    for (const m of post.media) {
      const child = await createContainer(igUserId, token, { image_url: m.url, is_carousel_item: 'true' }, m.alt, notes);
      if (!child.ok) return fromFailure(child);
      children.push(String(child.data.id));
    }
    created = await graph('POST', `${igUserId}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption });
  } else {
    created = await createContainer(igUserId, token, { image_url: post.media[0].url, caption: post.caption }, post.media[0].alt, notes);
  }
  if (!created.ok) return fromFailure(created);
  return { kind: 'pending', containerId: String(created.data.id), notes };
}
```

  Move the two new `import` lines to the top of the file with the existing import.

- [ ] **Step 4: Verify.** Run `node --import tsx --test tests/instagram-publish.test.ts` (PASS), then `npm test && npx astro check && npm run build`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social/instagram.ts tests/instagram-publish.test.ts
git commit -m "Instagram adapter: container per tick, publish when finished, never twice, alt text with a fallback"
```

---

### Task 5: The dispatcher tick

**Files:**
- Create: `functions/_lib/social-dispatcher.ts`, `functions/api/social/dispatch.ts`, `tests/social-dispatcher.test.ts`
- Modify: `functions/_lib/social-notify.ts`, `functions/_lib/dispatch-log.ts`, `functions/_lib/health.ts`, `functions/api/admin/health.ts`, `workers/mail-cron/src/index.ts`, `workers/mail-cron/wrangler.toml`, `src/i18n/ui.ts`

**Interfaces:**
- Consumes:
  - Task 1 (`afterStep`, `derivePostStatus`, `isLate`, `TargetNow`, `TargetStatus`);
  - Task 3 (`readAccessToken`, `getConnection`, `connectionStatus`, `markOk`, `markBroken`);
  - Task 4 (`instagramPublishStep`);
  - `captionFor` (social-limits), `rowToDraft` (social-posts), `appendAudit`, `startRun`/`finishRun`.
- Produces:
  - `TICK_BATCH = 2`, `CLAIM_LEASE_SECONDS = 600`
  - `dispatchSocial(env: Env, now: number, origin: string): Promise<{ candidates: number; claimed: number; published: number; failed: number; waiting: number }>`
  - `NotifyKind` gains `'publish_failed' | 'waiting_connection' | 'needs_confirmation' | 'connection_broken'`
  - `adminEmails(db): Promise<string[]>`
  - `startRun(db, id, at, kind?: 'mail' | 'social')`

- [ ] **Step 1: Notifications.** In `functions/_lib/social-notify.ts`:

  1. Add:

     ```ts
     export async function adminEmails(db: D1Database): Promise<string[]> {
       return (await db.prepare('SELECT email FROM users WHERE is_admin = 1').all<{ email: string }>()).results.map((r) => r.email);
     }
     ```

  2. Extend `NotifyKind` with `'publish_failed' | 'waiting_connection' | 'needs_confirmation' | 'connection_broken'`.
  3. Add these cases to the `switch` (`ctx.note` carries the reason):

```ts
    case 'publish_failed':
      return {
        subject: `Gönderi yayınlanamadı / Post could not be published: ${ctx.label}`,
        text: `**${ctx.label}** (${tr}) Instagram'da yayınlanamadı. Neden:${note}\n\nPanelden düzeltip yeniden deneyebilirsin: ${ctx.panelUrl}\n\n---\n\n**${ctx.label}** (${en}) could not be published to Instagram. Reason:${note}\n\nFix it and retry in the panel: ${ctx.panelUrl}`,
      };
    case 'waiting_connection':
      return {
        subject: `Gönderi bağlantı bekliyor / Post waiting for a connection: ${ctx.label}`,
        text: `**${ctx.label}** (${tr}) yayınlanamıyor çünkü Instagram bağlantısı çalışmıyor. Bir admin Bağlantılar sekmesinden yeniden bağladığında gönderi sıraya döner.\n\n${ctx.panelUrl}\n\n---\n\n**${ctx.label}** (${en}) cannot go out because the Instagram connection is not working. Once an admin reconnects it in Connections, the post is queued again.\n\n${ctx.panelUrl}`,
      };
    case 'needs_confirmation':
      return {
        subject: `Geciken gönderi onay bekliyor / Late post needs a decision: ${ctx.label}`,
        text: `**${ctx.label}** ${tr} için zamanlanmıştı ve iki saatten fazla gecikti. Kendiliğinden yayınlanmayacak: panelden "Yine de yayınla" ya da "İptal et" seç.\n\n${ctx.panelUrl}\n\n---\n\n**${ctx.label}** was scheduled for ${en} and is more than two hours late. It will not go out on its own: choose "Publish anyway" or "Cancel" in the panel.\n\n${ctx.panelUrl}`,
      };
    case 'connection_broken':
      return {
        subject: `Instagram bağlantısı koptu / Instagram connection broken`,
        text: `Instagram bağlantısı artık çalışmıyor. Neden:${note}\n\nBağlantılar sekmesinden yeniden bağla; bekleyen gönderiler sıraya döner: ${ctx.panelUrl}\n\n---\n\nThe Instagram connection no longer works. Reason:${note}\n\nReconnect it in Connections; waiting posts are queued again: ${ctx.panelUrl}`,
      };
```

- [ ] **Step 2: Run log kind and banner.**

  1. `dispatch-log.ts`: `startRun(db, id, at, kind: 'mail' | 'social' = 'mail')`. When `kind === 'mail'`, keep the existing SQL unchanged (it must keep working before migration 8e). Otherwise use:

     ```sql
     INSERT INTO dispatch_runs (id, started_at, kind) VALUES (?, ?, ?)
     ```

  2. `health.ts`: `healthIssues` input gains `lastSocialRunAt: number | null | undefined`. `undefined` means "not measured" (pre-8e fallback) and is ignored. Compute the scheduler issue from:

     ```ts
     const runs = input.lastSocialRunAt === undefined ? [input.lastRunAt] : [input.lastRunAt, input.lastSocialRunAt];
     const stale = runs.some((t) => t === null || input.now - t > SCHEDULER_STALE_SECONDS);
     ```

     Push `{ kind: 'scheduler', lastRunAt: <the oldest non-null of runs, or null> }` when `stale`.

  3. `functions/api/admin/health.ts`: replace the `dispatch_runs` query with a helper that tries the following and falls back to the old single `MAX(started_at)` query (`lastSocialRunAt: undefined`) if it throws:

     ```sql
     SELECT MAX(CASE WHEN kind = 'mail' THEN started_at END) AS mail, MAX(CASE WHEN kind = 'social' THEN started_at END) AS social FROM dispatch_runs
     ```

  4. `src/i18n/ui.ts`: change the value of `admin.health.scheduler`:
     - en: `'The scheduler has not run since {time}. Posts and scheduled mail are not going out.'`
     - tr: `'Zamanlayıcı {time} tarihinden beri çalışmadı. Gönderiler ve zamanlanmış e-postalar gitmiyor.'`

  Add a test in the existing health test file (`grep -l healthIssues tests`):

```ts
test('the scheduler line appears when either tick has gone quiet', () => {
  const now = 1_800_000_000;
  const base = { connections: [], legacyGmail: false, now };
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: now - 60 }), []);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: now - 3600 }), [{ kind: 'scheduler', lastRunAt: now - 3600 }]);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: null }), [{ kind: 'scheduler', lastRunAt: now - 60 }]);
  assert.deepEqual(healthIssues({ ...base, lastRunAt: now - 60, lastSocialRunAt: undefined }), [], 'before migration 8e only mail is measured');
});
```

  Update existing `healthIssues` calls in that file to pass `lastSocialRunAt: undefined` where they did not before.

- [ ] **Step 3: Failing lifecycle tests** `tests/social-dispatcher.test.ts`

```ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail, KEYS, addMedia } from './lib/social';
import { stubGraph, type GraphCall } from './lib/instagram';
import { dispatchSocial } from '../functions/_lib/social-dispatcher';
import { onRequestPost as endpoint } from '../functions/api/social/dispatch';
import { connectionUpsert } from '../functions/_lib/connections';
import { LATE_SECONDS, RETRY_WINDOW_SECONDS } from '../functions/_lib/social-dispatch';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const T0 = 1_800_000_000;
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';

let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world(opts: { connected?: boolean; platforms?: string[]; at?: number } = {}) {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never as Parameters<typeof dispatchSocial>[0];
  addMedia(s.db, KEYS.feed, 1080, 1350);
  s.db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
                VALUES ('p1','image','Merhaba',?,?,?,'scheduled',2,'ed',1,1)`)
    .run(JSON.stringify([{ key: KEYS.feed, alt: 'Afiş' }]), JSON.stringify(opts.platforms ?? ['instagram']), opts.at ?? T0);
  for (const p of opts.platforms ?? ['instagram']) s.db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1', ?, 'queued')`).run(p);
  return { ...s, env };
}
async function connect(env: unknown) {
  const stmt = await connectionUpsert(env as never, 'instagram', {
    accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null, scopes: 'x', expiresAt: T0 + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', T0 - 86400);
  await stmt.run();
}
const target = (db: import('node:sqlite').DatabaseSync) => ({ ...db.prepare(`SELECT status, container_id, remote_id, permalink, last_error, claimed_at FROM social_post_targets WHERE platform = 'instagram'`).get() as object }) as Record<string, unknown>;
const postStatus = (db: import('node:sqlite').DatabaseSync) => (db.prepare(`SELECT status FROM social_posts WHERE id = 'p1'`).get() as { status: string }).status;
const actions = (db: import('node:sqlite').DatabaseSync) => (db.prepare(`SELECT action FROM audit_log ORDER BY at, rowid`).all() as { action: string }[]).map((r) => r.action);

function graphFlow(states: string[]) {
  let poll = 0;
  return (c: GraphCall) => {
    if (c.method === 'POST' && c.path === `/${IG}/media`) return Response.json({ id: 'c1' });
    if (c.path === '/c1') return Response.json({ status_code: states[Math.min(poll++, states.length - 1)] });
    if (c.method === 'POST' && c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return Response.json({ permalink: 'https://www.instagram.com/p/abc/' });
    return undefined;
  };
}

test('a post goes out over two ticks: container, then publish; the post becomes published', async () => {
  const { env, db, } = world();
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    assert.deepEqual([target(db).status, target(db).container_id, target(db).claimed_at], ['publishing', 'c1', null], 'lease released after the step');
    assert.equal(postStatus(db), 'scheduled');
    await dispatchSocial(env, T0 + 90, ORIGIN);
  } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).remote_id, target(db).permalink], ['published', 'm1', 'https://www.instagram.com/p/abc/']);
  assert.equal(postStatus(db), 'published');
  assert.deepEqual(actions(db).filter((a) => a.startsWith('social.')), ['social.target.container', 'social.target.published', 'social.post.published']);
  assert.equal((db.prepare(`SELECT revision FROM social_posts`).get() as { revision: number }).revision, 3, 'an open composer gets post_changed');
});

test('a crash after publishing: the next tick sees PUBLISHED and does not publish again', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET status = 'publishing', container_id = 'c1'`).run();
  const g = stubGraph(graphFlow(['PUBLISHED']));
  try { await dispatchSocial(env, T0 + 90, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'published');
  assert.equal(g.calls.some((c) => c.path.endsWith('/media_publish')), false);
});

test('no connection: the target waits once, one mail goes out, later ticks are quiet', async () => {
  const { env, db, waits } = world();
  await dispatchSocial(env, T0 + 30, ORIGIN);
  await Promise.allSettled(waits);
  assert.equal(target(db).status, 'waiting_connection');
  const mailed = mail.sent.length;
  assert.ok(mailed > 0);
  await dispatchSocial(env, T0 + 90, ORIGIN);
  assert.equal(mail.sent.length, mailed, 'nothing new');
  assert.equal(actions(db).filter((a) => a === 'social.target.waiting').length, 1);
});

test('reconnected two days later: the target needs a person, it does not go out', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + LATE_SECONDS + 60, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'needs_confirmation');
  assert.equal(g.calls.length, 0);
  assert.equal(postStatus(db), 'scheduled');
});

test('a confirmed late target goes out', async () => {
  const { env, db } = world();
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET confirmed_at = ?`).run(T0 + 2 * 86400);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0 + 2 * 86400 + 30, ORIGIN); } finally { g.restore(); }
  assert.equal(target(db).status, 'publishing');
});

test('an expired token: the target waits, the connection is marked broken, admins are told', async () => {
  const { env, db, waits } = world();
  await connect(env);
  const g = stubGraph(() => Response.json({ error: { code: 190, error_subcode: 463, message: 'expired' } }, { status: 400 }));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  await Promise.allSettled(waits);
  assert.equal(target(db).status, 'waiting_connection');
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections WHERE platform = 'instagram'`).get() as { last_error_at: number | null }).last_error_at);
  assert.ok(mail.sent.some((m) => m.to === 'admin@example.org' && /bağlantısı koptu/.test(m.subject)));
});

test('a content error fails the target and the post, with the reason stored', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(() => Response.json({ error: { code: 36003, error_subcode: 2207009, message: 'ratio' } }, { status: 400 }));
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { g.restore(); }
  assert.deepEqual([target(db).status, target(db).last_error], ['failed', 'bad_ratio: ratio']);
  assert.equal(postStatus(db), 'failed');
});

test('transient errors retry each tick and fail after the window', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(() => new Response('', { status: 503 }));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    assert.equal(target(db).status, 'queued');
    await dispatchSocial(env, T0 + 30 + RETRY_WINDOW_SECONDS, ORIGIN);
  } finally { g.restore(); }
  assert.equal(target(db).status, 'failed');
});

test('LinkedIn is skipped until phase 5; the Instagram half still makes the post published', async () => {
  const { env, db } = world({ platforms: ['instagram', 'linkedin'] });
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await dispatchSocial(env, T0 + 30, ORIGIN);
    await dispatchSocial(env, T0 + 90, ORIGIN);
  } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT status, last_error FROM social_post_targets WHERE platform = 'linkedin'`).get() as { status: string }).status, 'skipped');
  assert.equal(postStatus(db), 'published');
});

test('a post in the future, a cancelled post, and a claimed target are left alone', async () => {
  const { env, db } = world({ at: T0 + 3600 });
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0, ORIGIN); } finally { g.restore(); }
  assert.equal(g.calls.length, 0);
  db.prepare(`UPDATE social_posts SET scheduled_at = ?, status = 'cancelled'`).run(T0 - 60);
  const g2 = stubGraph(graphFlow(['FINISHED']));
  try { await dispatchSocial(env, T0, ORIGIN); } finally { g2.restore(); }
  assert.equal(g2.calls.length, 0);
});

test('the endpoint refuses a wrong secret and records its run as social', async () => {
  const { env, db } = world();
  const bad = await (endpoint as (c: unknown) => Promise<Response>)({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'nope' } }), env });
  assert.equal(bad.status, 403);
  const ok = await (endpoint as (c: unknown) => Promise<Response>)({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'tick' } }), env });
  assert.equal(ok.status, 200);
  assert.equal((db.prepare(`SELECT kind FROM dispatch_runs`).get() as { kind: string }).kind, 'social');
});
```

  The waiting-connection test checks `waits` from `setupSocial`. `dispatchSocial` sends its mail inline (awaited), so `waits` may stay empty; that is fine. If a test needs a seeded admin email, `setupSocial` already seeds `admin@example.org` (check it; if the admin's email differs, use the seeded one).

- [ ] **Step 4: Run, confirm failure**

Run: `node --import tsx --test tests/social-dispatcher.test.ts`
Expected: FAIL.

- [ ] **Step 5: `functions/_lib/social-dispatcher.ts`**

```ts
/**
 * One social dispatch tick (spec §5), called every minute by
 * workers/mail-cron through /api/social/dispatch. Claims due targets with a
 * lease, runs one adapter step each, writes the result through the pure
 * transition in social-dispatch.ts, and keeps the post's status in step with
 * its targets. Every change is audited as the system (userId null).
 */
import type { Env } from './auth';
import { getConnection, connectionStatus, readAccessToken, markOk, markBroken } from './connections';
import { rowToDraft, type PostRow } from './social-posts';
import { captionFor } from './social-limits';
import { afterStep, derivePostStatus, isLate, type TargetNow, type TargetStatus } from './social-dispatch';
import { instagramPublishStep } from './social/instagram';
import { appendAudit } from './audit';
import { notificationText, notifyEach, publisherEmails, adminEmails, postLabel, type NotifyKind } from './social-notify';

export const TICK_BATCH = 2;
export const CLAIM_LEASE_SECONDS = 10 * 60;

type Due = PostRow & {
  target_status: TargetStatus; platform: string; attempts: number; first_tried_at: number | null; container_id: string | null;
  remote_id: string | null; permalink: string | null; published_at: number | null; last_error: string | null; confirmed_at: number | null;
  author_email: string | null; plan_title: string | null;
};

export async function dispatchSocial(env: Env, now: number, origin: string) {
  const db = env.DB;
  const summary = { candidates: 0, claimed: 0, published: 0, failed: 0, waiting: 0 };
  const due = (await db.prepare(
    `SELECT p.*, t.platform, t.status AS target_status, t.attempts, t.first_tried_at, t.container_id, t.remote_id, t.permalink,
            t.published_at, t.last_error, t.confirmed_at, u.email AS author_email, pl.title AS plan_title
       FROM social_post_targets t
       JOIN social_posts p ON p.id = t.post_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN social_plans pl ON pl.post_id = p.id
      WHERE t.status IN ('queued','publishing') AND p.status = 'scheduled' AND p.scheduled_at <= ?
        AND (t.claimed_at IS NULL OR t.claimed_at <= ?)
      ORDER BY p.scheduled_at
      LIMIT ?`,
  ).bind(now, now - CLAIM_LEASE_SECONDS, TICK_BATCH).all<Due>()).results;
  summary.candidates = due.length;
  if (due.length === 0) return summary;

  const panelUrl = `${origin}/admin`;
  // The token is read once per tick; an auth failure clears it so the rest of the batch waits instead of failing the same way.
  const conn = await getConnection(db, 'instagram');
  const usable = conn && conn.account_id && ['connected', 'expiring'].includes(connectionStatus(conn, now));
  let token = usable ? await readAccessToken(env, conn!) : null;

  for (const row of due) {
    const claim = await db.prepare(
      `UPDATE social_post_targets SET claimed_at = ?
        WHERE post_id = ? AND platform = ? AND status IN ('queued','publishing') AND (claimed_at IS NULL OR claimed_at <= ?)`,
    ).bind(now, row.id, row.platform, now - CLAIM_LEASE_SECONDS).run();
    if (claim.meta.changes !== 1) continue;
    summary.claimed++;

    const t: TargetNow = {
      status: row.target_status, attempts: row.attempts, first_tried_at: row.first_tried_at, container_id: row.container_id,
      remote_id: row.remote_id, permalink: row.permalink, published_at: row.published_at, last_error: row.last_error,
    };
    const label = postLabel(row.caption, row.plan_title);
    const tell = async (kind: NotifyKind, to: string[], note?: string) =>
      notifyEach(env, to, notificationText(kind, { label, when: row.scheduled_at, note, panelUrl }));

    // Platforms without an adapter yet (LinkedIn until phase 5): settled, not counted.
    if (row.platform !== 'instagram') {
      await write(db, row, { ...t, status: 'skipped', last_error: 'not_available: no adapter yet' }, now);
      await appendAudit(db, { userId: null, action: 'social.target.skipped', targetType: 'social_post', targetId: row.id, details: { platform: row.platform } }, now);
      await settlePost(db, row.id, now);
      continue;
    }
    // Never started and more than two hours late: a person decides (spec §5, lateness rule).
    if (row.target_status === 'queued' && row.container_id === null && isLate(row.scheduled_at!, now, row.confirmed_at)) {
      await write(db, row, { ...t, status: 'needs_confirmation' }, now);
      await appendAudit(db, { userId: null, action: 'social.target.late', targetType: 'social_post', targetId: row.id, details: { platform: row.platform, scheduledAt: row.scheduled_at } }, now);
      await tell('needs_confirmation', await publisherEmails(db));
      continue;
    }
    if (!token) {
      await write(db, row, { ...t, status: 'waiting_connection', last_error: 'auth: no working Instagram connection' }, now);
      await appendAudit(db, { userId: null, action: 'social.target.waiting', targetType: 'social_post', targetId: row.id, details: { platform: row.platform } }, now);
      await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
      summary.waiting++;
      continue;
    }

    const d = rowToDraft(row);
    const step = await instagramPublishStep({
      igUserId: conn!.account_id!, token,
      post: {
        type: d.type, caption: captionFor(d, 'instagram'),
        media: d.media.map((m) => ({ key: m.key, alt: m.alt, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}` })),
      },
      state: { containerId: row.container_id },
    });
    const tr = afterStep(step, t, now);
    await write(db, row, tr.next, now);
    if (tr.audit) {
      await appendAudit(db, {
        userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id,
        details: { platform: row.platform, status: tr.next.status, reason: tr.next.last_error, remoteId: tr.next.remote_id, notes: 'notes' in step ? step.notes : undefined },
      }, now);
    }
    if (step.kind === 'done') { summary.published++; await markOk(db, 'instagram', now); }
    if (tr.next.status === 'failed') summary.failed++;
    if (step.kind === 'auth') {
      summary.waiting++;
      const wasBroken = connectionStatus(conn, now) === 'broken';
      await markBroken(db, 'instagram', step.reason, now);
      token = null;
      if (!wasBroken) await tell('connection_broken', await adminEmails(db), step.reason);
    }
    if (tr.notify === 'failed') await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? '');
    if (tr.notify === 'waiting_connection') await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
    await settlePost(db, row.id, now);
  }
  return summary;
}

/** Writes a target's next state and releases this tick's lease, so a pending container is polled again next minute. */
async function write(db: D1Database, row: Due, n: TargetNow, now: number): Promise<void> {
  await db.prepare(
    `UPDATE social_post_targets
        SET status = ?, attempts = ?, first_tried_at = ?, container_id = ?, remote_id = ?, permalink = ?, published_at = ?,
            last_error = ?, claimed_at = NULL
      WHERE post_id = ? AND platform = ? AND claimed_at = ?`,
  ).bind(n.status, n.attempts, n.first_tried_at, n.container_id, n.remote_id, n.permalink, n.published_at, n.last_error, row.id, row.platform, now).run();
}

/** Moves the post to published / partially_published / failed once every target has settled. */
async function settlePost(db: D1Database, postId: string, now: number): Promise<void> {
  const statuses = (await db.prepare('SELECT status FROM social_post_targets WHERE post_id = ?').bind(postId).all<{ status: TargetStatus }>()).results.map((r) => r.status);
  const next = derivePostStatus(statuses);
  if (next === 'scheduled') return;
  // A fresh nonce and revision, so a composer still open on the old version gets post_changed instead of overwriting.
  const res = await db.prepare(
    `UPDATE social_posts SET status = ?, revision = revision + 1, write_nonce = ?, updated_at = ? WHERE id = ? AND status = 'scheduled'`,
  ).bind(next, crypto.randomUUID(), now, postId).run();
  if (res.meta.changes === 1) {
    await appendAudit(db, { userId: null, action: `social.post.${next}`, targetType: 'social_post', targetId: postId, details: { targets: statuses } }, now);
  }
}
```

- [ ] **Step 6: `functions/api/social/dispatch.ts`**

```ts
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { safeEqual } from '../../_lib/secret';
import { startRun, finishRun } from '../../_lib/dispatch-log';
import { dispatchSocial } from '../../_lib/social-dispatcher';

/**
 * The social tick. workers/mail-cron calls it every minute with the same
 * X-Dispatch-Secret it sends to /api/mail/dispatch. Each run is recorded in
 * dispatch_runs as kind 'social', so the banner notices a stopped scheduler.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Dispatch-Secret'), env.MAIL_SYNC_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const runId = await startRun(env.DB, crypto.randomUUID(), now, 'social');
  try {
    const summary = await dispatchSocial(env, now, new URL(request.url).origin);
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), {
      candidates: summary.candidates, planned: summary.claimed, sent: summary.published, failed: summary.failed, retried: summary.waiting,
    });
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), { error: String(err).slice(0, 300) });
    console.error('social dispatch failed', err);
    return jsonResponse({ error: 'Dispatch failed', code: 'dispatch_failed' }, 500);
  }
};
```

- [ ] **Step 7: mail-cron Worker.**
  - `workers/mail-cron/wrangler.toml` `[vars]`: add `SOCIAL_DISPATCH_URL = "https://rsg-turkiye.iscbsc.org/api/social/dispatch"`.
  - `workers/mail-cron/src/index.ts`:
    - `Env` gains `/** Social publishing tick; same secret as dispatch. */ SOCIAL_DISPATCH_URL: string;`;
    - `tick` adds `const social = await call(env, 'social', env.SOCIAL_DISPATCH_URL);` after the sync call, and returns `{ dispatch, sync, social }`;
    - `Tick` gains `social: string`;
    - `failed` adds `|| t.social.startsWith('ERROR')`;
    - `summarise` appends `` ` social: ${t.social.slice(0, 120)}` ``;
    - the `fetch` handler's JSON adds `social: parseIfJson(body.social)`.

- [ ] **Step 8: Verify.** Run the dispatcher test file and the health test file (PASS), then `npm test && npx astro check && npm run build`. Confirm the Worker still type-checks if the repo checks it; otherwise read it once more by hand.

- [ ] **Step 9: Commit**

```bash
git add functions/_lib/social-dispatcher.ts functions/api/social/dispatch.ts functions/_lib/social-notify.ts functions/_lib/dispatch-log.ts functions/_lib/health.ts functions/api/admin/health.ts workers/mail-cron src/i18n/ui.ts tests
git commit -m "Social dispatcher: per-minute tick, leased claims, Instagram steps, lateness, waiting, post status, banner"
```

---

### Task 6: Publish anyway / Retry, daily token refresh, published list

**Files:**
- Create: `functions/api/social/posts/[id]/requeue.ts`, `functions/api/admin/social/refresh-tokens.ts`, `tests/social-requeue-refresh.test.ts`
- Modify: `functions/api/social/posts/index.ts`, `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml`

**Interfaces:**
- Consumes: Tasks 1 to 5; `prepareAction`, `lostRace` (social-actions); `updatePostGuarded`, `POST_PROOF`; `runGuardedWithAudit`; `refreshInstagramToken`, `needsRefresh`; `seal`, `tokenContext`.
- Produces:
  - `POST /api/social/posts/:id/requeue` `{revision}` → `{ok, revision, status: 'scheduled'}`; errors `not_requeueable` (409), `post_changed`, `not_allowed` (403 for editors via the gate).
  - `POST /api/admin/social/refresh-tokens` (X-Archive-Secret) → `{ok, refreshed: boolean}`.
  - `GET /api/social/posts?done=1` → posts in `published | partially_published | failed` from the last 60 days, newest first.

- [ ] **Step 1: Failing tests** `tests/social-requeue-refresh.test.ts`

```ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail } from './lib/social';
import { stubGraph } from './lib/instagram';
import { onRequestPost as requeue } from '../functions/api/social/posts/[id]/requeue';
import { onRequestPost as refresh } from '../functions/api/admin/social/refresh-tokens';
import { onRequestGet as list } from '../functions/api/social/posts/index';
import { connectionUpsert, getConnection, readAccessToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world(postStatus: string, targetStatus: string) {
  const s = setupSocial();
  s.db.prepare(`INSERT INTO social_posts (id, type, caption, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
                VALUES ('p1','image','x','["instagram"]', 100, ?, 4, 'ed', 1, 1)`).run(postStatus);
  s.db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, attempts, first_tried_at, last_error, container_id) VALUES ('p1','instagram',?, 3, 50, 'x', 'c9')`).run(targetStatus);
  return { ...s, env: { ...(s.env as object), TOKEN_ENC_KEY: KEY } as never };
}
const t = (db: import('node:sqlite').DatabaseSync) => ({ ...db.prepare(`SELECT status, confirmed_at, attempts, first_tried_at, last_error, container_id FROM social_post_targets`).get() as object }) as Record<string, unknown>;

test('publish anyway: a late target goes back to the queue, confirmed', async () => {
  const { env, db } = world('scheduled', 'needs_confirmation');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.equal(res.status, 200);
  const r = t(db);
  assert.equal(r.status, 'queued');
  assert.ok(r.confirmed_at);
  assert.equal(r.container_id, 'c9', 'a late target never had a container; nothing to clear');
});

test('retry: a failed post and its failed target start clean', async () => {
  const { env, db } = world('failed', 'failed');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 5, status: 'scheduled' });
  assert.deepEqual([t(db).status, t(db).attempts, t(db).first_tried_at, t(db).last_error, t(db).container_id], ['queued', 0, null, null, null]);
  assert.equal((db.prepare(`SELECT status FROM social_posts`).get() as { status: string }).status, 'scheduled');
});

test('editors cannot requeue; nothing to requeue is a 409', async () => {
  const { env } = world('failed', 'failed');
  assert.equal((await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env, as: 'ed', params: { id: 'p1' }, body: { revision: 4 } })).status, 403);
  const other = world('scheduled', 'queued');
  const res = await call(requeue, 'POST', '/api/social/posts/p1/requeue', { env: other.env, as: 'pub', params: { id: 'p1' }, body: { revision: 4 } });
  assert.equal((await res.json() as { code: string }).code, 'not_requeueable');
});

test('the done list shows settled posts only', async () => {
  const { env } = world('published', 'published');
  const res = await call(list, 'GET', '/api/social/posts?done=1', { env, as: 'ed' });
  const posts = (await res.json() as { posts: { id: string }[] }).posts;
  assert.deepEqual(posts.map((p) => p.id), ['p1']);
});

async function connected(env: unknown, connectedAt: number, expiresAt: number) {
  await (await connectionUpsert(env as never, 'instagram', { accountId: '1', accountName: 'rsg', accessToken: 'old', refreshToken: null, scopes: 'x', expiresAt, refreshExpiresAt: null }, 'admin', connectedAt)).run();
}
const cron = (env: unknown, secret = 'cron-secret') =>
  (refresh as (c: unknown) => Promise<Response>)({ request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/social/refresh-tokens', { method: 'POST', headers: { 'X-Archive-Secret': secret } }), env });

test('the daily job refreshes a token close to expiry and stores the new one sealed', async () => {
  const { env } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  const g = stubGraph((c) => (c.path === '/refresh_access_token' ? Response.json({ access_token: 'new', token_type: 'bearer', expires_in: 5184000 }) : undefined));
  try { assert.deepEqual(await (await cron(env)).json(), { ok: true, refreshed: true }); } finally { g.restore(); }
  const row = (await getConnection((env as { DB: D1Database }).DB, 'instagram'))!;
  assert.equal(await readAccessToken(env as never, row), 'new');
  assert.ok(row.expires_at! > now + 59 * 86400);
});

test('a refused refresh marks the connection broken and tells admins; a wrong secret is refused', async () => {
  const { env, db } = world('scheduled', 'queued');
  const now = Math.floor(Date.now() / 1000);
  await connected(env, now - 45 * 86400, now + 10 * 86400);
  assert.equal((await cron(env, 'nope')).status, 403);
  const g = stubGraph(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
  try { assert.deepEqual(await (await cron(env)).json(), { ok: true, refreshed: false }); } finally { g.restore(); }
  assert.ok((db.prepare(`SELECT last_error_at FROM platform_connections`).get() as { last_error_at: number | null }).last_error_at);
  assert.ok(mail.sent.some((m) => /bağlantısı koptu/.test(m.subject)));
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-requeue-refresh.test.ts`
Expected: FAIL.

- [ ] **Step 3: `functions/api/social/posts/[id]/requeue.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace } from '../../../../_lib/social-actions';
import { updatePostGuarded, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

const FROM = ['scheduled', 'failed', 'partially_published'];

/**
 * "Publish anyway" for targets held by the lateness rule, and "Retry" for
 * failed ones (spec §5). Publishers only. The target is marked confirmed,
 * so the lateness rule does not hold it again; a failed one starts with a
 * clean slate (no attempts, no stale container).
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  const waiting = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM social_post_targets WHERE post_id = ? AND status IN ('needs_confirmation','failed')`,
  ).bind(id).first<{ n: number }>();
  if (!FROM.includes(row.status) || !waiting?.n) {
    return jsonResponse({ error: 'Nothing to publish again', code: 'not_requeueable' }, 409);
  }
  const nonce = crypto.randomUUID();
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, nonce, { status: 'scheduled' }, now, FROM as never),
    { condition: POST_PROOF, binds: [id, nonce] },
    [env.DB.prepare(
      `UPDATE social_post_targets
          SET status = 'queued', confirmed_at = ?, claimed_at = NULL, attempts = 0, first_tried_at = NULL, last_error = NULL,
              container_id = CASE WHEN status = 'failed' THEN NULL ELSE container_id END
        WHERE post_id = ? AND status IN ('needs_confirmation','failed') AND ${POST_PROOF}`,
    ).bind(now, id, id, nonce)],
    { userId: gate.user.id, action: 'social.post.requeue', targetType: 'social_post', targetId: id, details: { from: row.status } },
    now,
  );
  if (!done) return lostRace();
  return jsonResponse({ ok: true, revision: revision + 1, status: 'scheduled' });
};
```

  Check that `updatePostGuarded`'s `statusIn` parameter type accepts this list. Type it as `PostStatus[]` instead of `as never` if the signature allows.

- [ ] **Step 4: `functions/api/admin/social/refresh-tokens.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { getConnection, readAccessToken, markBroken, connectionStatus, tokenContext } from '../../../_lib/connections';
import { seal } from '../../../_lib/token-vault';
import { appendAudit } from '../../../_lib/audit';
import { refreshInstagramToken, needsRefresh } from '../../../_lib/social/instagram';
import { notificationText, notifyEach, adminEmails } from '../../../_lib/social-notify';

/**
 * Daily (workers/symposium-cron). Instagram tokens live 60 days and can only
 * be refreshed while still valid, so a token with under 20 days left is
 * renewed here. A refusal marks the connection broken and tells the admins
 * at once, while there is still time to reconnect before posts start waiting.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await getConnection(env.DB, 'instagram');
  if (!row || !needsRefresh(row, now)) return jsonResponse({ ok: true, refreshed: false });
  const token = await readAccessToken(env, row);
  const result = token ? await refreshInstagramToken(token) : { ok: false as const, status: 0, auth: true, reason: 'stored token unreadable' };
  if (result.ok) {
    const sealed = await seal(env.TOKEN_ENC_KEY, result.token, tokenContext('instagram', 'access'));
    await env.DB.prepare(
      `UPDATE platform_connections SET access_token_enc = ?, expires_at = ?, last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE platform = 'instagram'`,
    ).bind(sealed, now + result.expiresIn, now).run();
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh', targetType: 'connection', targetId: 'instagram', details: { expiresAt: now + result.expiresIn } }, now);
    return jsonResponse({ ok: true, refreshed: true });
  }
  const wasBroken = connectionStatus(row, now) === 'broken';
  await markBroken(env.DB, 'instagram', `refresh: ${result.reason}`, now);
  await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'instagram', details: { status: result.status, reason: result.reason } }, now);
  if (!wasBroken) {
    const panelUrl = `${new URL(request.url).origin}/admin`;
    await notifyEach(env, await adminEmails(env.DB), notificationText('connection_broken', { label: 'Instagram', when: null, note: result.reason, panelUrl }));
  }
  return jsonResponse({ ok: true, refreshed: false });
};
```

- [ ] **Step 5: Done list.** In `functions/api/social/posts/index.ts` `onRequestGet`, before the `drafts` branch, add:

```ts
  if (url.searchParams.get('done') === '1') {
    const since = Math.floor(Date.now() / 1000) - 60 * 86400;
    const posts = await loadPosts(env.DB, env, `p.status IN ('published','partially_published','failed') AND p.scheduled_at >= ?`, [since]);
    return jsonResponse({ posts: posts.reverse() });
  }
```

- [ ] **Step 6: symposium-cron.** Follow commit 54fcd39's `SOCIAL_REMINDERS_URL` shape exactly:
  - `wrangler.toml` `[vars]`: `SOCIAL_REFRESH_URL = "https://rsg-turkiye.iscbsc.org/api/admin/social/refresh-tokens"`;
  - `Env` field with a one-line comment;
  - `Tick` key `socialRefresh`;
  - `const socialRefresh = await callSecretPost('social token refresh', env.SOCIAL_REFRESH_URL, env);` right after the reminders call;
  - the return object, `failed()` list, `summarise()` and the `fetch` handler's JSON all gain `socialRefresh`.

- [ ] **Step 7: Verify.** Run the test file (PASS), then `npm test && npx astro check && npm run build`.

- [ ] **Step 8: Commit**

```bash
git add "functions/api/social/posts/[id]/requeue.ts" functions/api/admin/social/refresh-tokens.ts functions/api/social/posts/index.ts workers/symposium-cron tests/social-requeue-refresh.test.ts
git commit -m "Social: publish anyway and retry, daily Instagram token refresh, list of settled posts"
```

---

### Task 7: Panel: results, Publish anyway / Retry, Published tab

**Files:**
- Modify: `src/scripts/social/api.ts`, `src/scripts/social/messages.ts`, `src/scripts/social/side-panel.ts`, `src/scripts/social/lists.ts`, `src/scripts/social/index.ts`, `src/scripts/social/composer.ts`, `src/components/admin/panes/SocialPane.astro`, `src/i18n/ui.ts`
- Test: `tests/admin-social-i18n.test.ts`

**Interfaces:**
- Consumes: Task 6 endpoints; `PUBLISH_REASON_KEYS` (import from `functions/_lib/social/instagram-errors.ts`, which is pure).
- Produces:
  - `api.requeue(postId, revision)`, `api.done()`
  - `TARGET_STATUS_KEYS`
  - `publishErrorText(lastError: string | null): string`
  - `targetLines(p: Post): string` (exported from `side-panel.ts`)
  - tab `published`

- [ ] **Step 1: i18n test additions.** In `tests/admin-social-i18n.test.ts`, extend the third test:

```ts
  for (const s of TARGET_STATUS_KEYS) assert.ok(has(`admin.social.target.${s}`), s);
  for (const k of PUBLISH_REASON_KEYS) assert.ok(has(`admin.social.publishError.${k}`), k);
```

  Import `TARGET_STATUS_KEYS` from messages and `PUBLISH_REASON_KEYS` from `../functions/_lib/social/instagram-errors`. Run it to see it fail.

- [ ] **Step 2: api and messages.**
  - `api.ts`:

    ```ts
    requeue: (postId: string, revision: number) => call<Result>('POST', `/api/social/posts/${id(postId)}/requeue`, { revision }),
    done: () => call<{ posts: Post[] }>('GET', '/api/social/posts?done=1').then((r) => r.posts),
    ```

  - `messages.ts`: add `'not_requeueable'` to `ERROR_CODES`, then:

```ts
import { PUBLISH_REASON_KEYS } from '../../../functions/_lib/social/instagram-errors';

export const TARGET_STATUS_KEYS = ['queued', 'waiting_connection', 'needs_confirmation', 'publishing', 'published', 'failed', 'skipped'] as const;

/** last_error is "<key>: <provider detail>"; the key becomes a sentence, the detail stays for whoever needs it. */
export function publishErrorText(lastError: string | null): string {
  if (!lastError) return '';
  const at = lastError.indexOf(': ');
  const key = at > 0 ? lastError.slice(0, at) : lastError;
  return deps().t(`admin.social.publishError.${(PUBLISH_REASON_KEYS as readonly string[]).includes(key) ? key : 'unknown'}`);
}
```

- [ ] **Step 3: Side panel.** In `side-panel.ts`, add and export:

```ts
/** One line per platform: what happened, a link when there is one, and why when it did not work. */
export function targetLines(p: Post): string {
  const { t } = deps();
  if (!p.targets.length) return '';
  return `<div class="mt-3"><p class="text-xs text-gray-500">${esc(t('admin.social.side.targets'))}</p>${p.targets.map((x) => `
    <p class="text-sm text-navy mt-1"><strong>${esc(t(`admin.connections.platform.${x.platform}`))}</strong>: ${esc(t(`admin.social.target.${x.status}`))}
      ${x.permalink ? ` · <a href="${esc(x.permalink)}" target="_blank" rel="noopener" class="underline">${esc(t('admin.social.side.viewPost'))}</a>` : ''}</p>
    ${x.lastError && x.status !== 'published' ? `<p class="text-xs text-red">${esc(publishErrorText(x.lastError))}</p><p class="text-xs text-gray-500 break-words">${esc(x.lastError.slice(x.lastError.indexOf(': ') + 2))}</p>` : ''}`).join('')}</div>`;
}
```

  In `renderPost`:

  1. Insert `${targetLines(p)}` after the author/review-note rows.
  2. Add the requeue action for publishers:

     ```ts
     const held = p.targets.some((x) => x.status === 'needs_confirmation');
     const failedAny = p.targets.some((x) => x.status === 'failed');
     if (me.isPublisher && (held || failedAny) && ['scheduled', 'failed', 'partially_published'].includes(p.status)) {
       actions.push(button(t(held ? 'admin.social.action.publishAnyway' : 'admin.social.action.retry'), 'data-act="requeue"', 'ok'));
     }
     ```

  3. Wire it next to the approve handler, in the same style the other actions use (if `run` takes the clicked button as a later argument, pass it the same way approve does):

     ```ts
     q('requeue')?.addEventListener('click', () => void run(() => api.requeue(p.id, p.revision), 'admin.social.done.requeued'));
     ```

  4. Allow cancel on a `needs_confirmation` post: the existing cancel condition (`pending_approval || scheduled`) already covers it, since the post is still `scheduled`.

- [ ] **Step 4: Published tab.**
  - In `SocialPane.astro`, add `<button type="button" data-social-tab="published" class={tabClass}>{t('admin.social.tab.published')}</button>` after the drafts tab, and `<section data-social-view="published" class="hidden"><div id="socialPublishedList"></div></section>`.
  - In `index.ts`, add `'published'` to `Tab` and `TABS`, and register `registerView('published', loadPublished)`.
  - In `lists.ts`, add:

```ts
export async function loadPublished(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialPublishedList');
  if (!list) return;
  const posts = await api.done();
  list.innerHTML = posts.map((p) => card(p, targetLines(p))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
}
```

    Import `targetLines` from `./side-panel`. `card` already renders the thumbnail and title; the second argument is the actions slot.

- [ ] **Step 5: Composer note on LinkedIn.**
  - In `composer.ts`'s platform checkbox list, render the LinkedIn label as `` `${esc(t('admin.connections.platform.linkedin'))} <span class="text-xs text-gray-500">${esc(t('admin.social.composer.linkedinLater'))}</span>` `` when `p === 'linkedin'`.
  - In `src/scripts/social/messages.ts`, keep `PROBLEM_CODES` as Task 2 left it.

- [ ] **Step 6: Strings.** Add to both blocks of `src/i18n/ui.ts`:

```ts
// en
'admin.social.tab.published': 'Published',
'admin.social.side.targets': 'Where it went',
'admin.social.side.viewPost': 'View post',
'admin.social.action.publishAnyway': 'Publish anyway',
'admin.social.action.retry': 'Retry',
'admin.social.done.requeued': 'Queued again; it goes out within a minute or two.',
'admin.social.error.not_requeueable': 'There is nothing to publish again on this post.',
'admin.social.composer.linkedinLater': '(planned only; publishing comes later)',
'admin.social.target.queued': 'Waiting for its time',
'admin.social.target.waiting_connection': 'Waiting for the connection',
'admin.social.target.needs_confirmation': 'Late: needs a decision',
'admin.social.target.publishing': 'Going out',
'admin.social.target.published': 'Published',
'admin.social.target.failed': 'Failed',
'admin.social.target.skipped': 'Not published (not available yet)',
'admin.social.publishError.auth': 'The Instagram connection no longer works. An admin has to reconnect it.',
'admin.social.publishError.needs_business': 'Instagram publishes stories through the API only for Business accounts. Switch the account to Business.',
'admin.social.publishError.image_too_large': 'An image is larger than Instagram accepts (8 MB).',
'admin.social.publishError.image_format': 'Instagram did not accept the image format.',
'admin.social.publishError.bad_ratio': 'An image has a shape Instagram does not accept. Crop it and retry.',
'admin.social.publishError.caption_rejected': 'Instagram refused the text (too long, or too many hashtags or mentions).',
'admin.social.publishError.carousel_count': 'A carousel needs 2 to 10 images.',
'admin.social.publishError.account_restricted': 'The Instagram account is restricted. Check it in the Instagram app.',
'admin.social.publishError.spam': 'Instagram flagged this post as spam.',
'admin.social.publishError.media_unreachable': 'Instagram could not download the image from the site.',
'admin.social.publishError.rate_limited': 'Instagram asked to slow down; it was retried for two hours.',
'admin.social.publishError.daily_limit': 'The account reached Instagram\'s daily publishing limit.',
'admin.social.publishError.expired': 'Instagram\'s copy of the post expired before it went out.',
'admin.social.publishError.container_error': 'Instagram could not process the post.',
'admin.social.publishError.unavailable': 'Instagram was not reachable for two hours.',
'admin.social.publishError.not_available': 'Publishing to this platform is not available yet.',
'admin.social.publishError.unknown': 'Instagram refused the post.',
```

```ts
// tr
'admin.social.tab.published': 'Yayınlananlar',
'admin.social.side.targets': 'Nereye gitti',
'admin.social.side.viewPost': 'Gönderiyi gör',
'admin.social.action.publishAnyway': 'Yine de yayınla',
'admin.social.action.retry': 'Yeniden dene',
'admin.social.done.requeued': 'Yeniden sıraya alındı; bir iki dakika içinde gider.',
'admin.social.error.not_requeueable': 'Bu gönderide yeniden yayınlanacak bir şey yok.',
'admin.social.composer.linkedinLater': '(yalnızca plan; yayın sonra gelecek)',
'admin.social.target.queued': 'Zamanını bekliyor',
'admin.social.target.waiting_connection': 'Bağlantıyı bekliyor',
'admin.social.target.needs_confirmation': 'Gecikti: karar bekliyor',
'admin.social.target.publishing': 'Gidiyor',
'admin.social.target.published': 'Yayınlandı',
'admin.social.target.failed': 'Başarısız',
'admin.social.target.skipped': 'Yayınlanmadı (henüz yok)',
'admin.social.publishError.auth': 'Instagram bağlantısı artık çalışmıyor. Bir admin yeniden bağlamalı.',
'admin.social.publishError.needs_business': "Instagram, API üzerinden story'yi yalnızca İşletme hesaplarında yayınlıyor. Hesabı İşletme'ye geçir.",
'admin.social.publishError.image_too_large': "Bir görsel Instagram'ın kabul ettiğinden büyük (8 MB).",
'admin.social.publishError.image_format': 'Instagram görsel biçimini kabul etmedi.',
'admin.social.publishError.bad_ratio': 'Bir görselin oranını Instagram kabul etmiyor. Kırp ve yeniden dene.',
'admin.social.publishError.caption_rejected': 'Instagram metni reddetti (çok uzun ya da çok fazla hashtag veya etiket).',
'admin.social.publishError.carousel_count': 'Carousel için 2 ile 10 arası görsel gerekir.',
'admin.social.publishError.account_restricted': 'Instagram hesabı kısıtlanmış. Instagram uygulamasından kontrol et.',
'admin.social.publishError.spam': 'Instagram bu gönderiyi spam olarak işaretledi.',
'admin.social.publishError.media_unreachable': 'Instagram görseli siteden indiremedi.',
'admin.social.publishError.rate_limited': 'Instagram yavaşlamamızı istedi; iki saat boyunca yeniden denendi.',
'admin.social.publishError.daily_limit': 'Hesap Instagram\'ın günlük yayın sınırına ulaştı.',
'admin.social.publishError.expired': "Gönderinin Instagram'daki kopyası yayınlanmadan süresi doldu.",
'admin.social.publishError.container_error': 'Instagram gönderiyi işleyemedi.',
'admin.social.publishError.unavailable': "Instagram'a iki saat boyunca ulaşılamadı.",
'admin.social.publishError.not_available': 'Bu platforma yayın henüz yok.',
'admin.social.publishError.unknown': 'Instagram gönderiyi reddetti.',
```

- [ ] **Step 7: Verify.** Run `npm test && npx astro check && npm run build`.

- [ ] **Step 8: Commit**

```bash
git add src tests/admin-social-i18n.test.ts
git commit -m "Social panel: per-platform results, Publish anyway and Retry, Published tab"
```

---

### Task 8: README and the production checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** Add a section "Social media publishing (phase 3a)" after the phase 2 section. Keep it in the README's existing tone and give it these parts.

  **One-time setup**, in this order:
  1. In the Meta app (Instagram > API setup with Instagram login): add the redirect URI `https://rsg-turkiye.iscbsc.org/api/admin/connections/instagram/callback` and note the Instagram app ID and secret.
  2. `npx wrangler pages secret put INSTAGRAM_APP_ID --project-name website`, then the same for `INSTAGRAM_APP_SECRET`.
  3. Run migration 8e (the three commands at the top of `db/schema.sql`).
  4. Deploy Pages (merge).
  5. Redeploy both Workers after the Pages deploy:

     ```
     cd workers/mail-cron && npx wrangler deploy
     cd workers/symposium-cron && npx wrangler deploy
     ```

  6. Connect a **test** Business account added as an Instagram Tester and publish one of each type to it. Only then connect @rsgturkey.

  **How a post goes out:**
  - every minute;
  - container, then publish;
  - the 2-hour lateness rule with "Publish anyway";
  - retries for 2 hours;
  - `waiting_connection` and reconnecting;
  - stories need a Business account;
  - LinkedIn is skipped until phase 5;
  - the API cannot delete a published post.

  **Banner lines:** the scheduler line now covers both ticks; the Instagram broken and expiring lines; what to press.

  **Token:** 60 days, refreshed daily when under 20 days are left.

- [ ] **Step 2: Verify.** Run `npm test && npx astro check && npm run build`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: Instagram publishing setup, how posts go out, and the runbook"
```

- [ ] **Step 4: Production steps (for the user, one at a time, after review; the implementer stops at Step 3).**

  **Production setup:**
  1. Add the redirect URI in the Meta app.
  2. Set the two secrets.
  3. Run migration 8e.
  4. Merge.
  5. Redeploy `mail-cron` and `symposium-cron`.

  **Then the first live posts:**
  1. Cancel or reschedule any old test post that still targets Instagram (the "Deneme post" on 14 October); otherwise it will land in `needs_confirmation`.
  2. Connect the test account and publish an image, a carousel and a story to it; check each on Instagram.
  3. Connect @rsgturkey. Stories need it switched to Business first.
