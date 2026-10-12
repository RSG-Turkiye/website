# Social Media Panel, Phase 2a (Content backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site everything the social media panel needs underneath its screens: plans, posts, the approval flow, event mode and email notifications, all served over audited, role-checked JSON APIs. Nothing is published to any platform yet.

**Architecture:**
- **Pure rules** live in `functions/_lib/`:
  - `social-limits.ts`: caption and ratio limits, shared later by the composer.
  - `social-posts.ts`: draft parsing, readiness checks and status rules.
  - `social-events.ts`: event-mode coverage.
  - `social-plans.ts`: plan input parsing.
- **Endpoints** under `functions/api/social/` are thin handlers over those rules.
- **Concurrency.** Every post mutation is guarded by a `revision` column. It is written in one D1 batch with its audit row, using a new `runGuardedWithAudit`. Two publishers acting at once cannot both win, and nothing changes without a log row.
- **Notifications.** System email goes through `buildMime` + `sendMail`, as `notifyThreadOwner` already does. It is fired with `waitUntil` and can never fail the request.

**Tech Stack:** Cloudflare Pages Functions, D1, R2, Workers cron, `node:test` with in-memory `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-12-social-media-panel-design.md`, covering:
- §1: roles and event mode
- §3: data model, `social_plans`, `social_posts`, `social_post_targets`, `social_event_modes`, media storage
- §5: notifications, and the plan reminder in the daily job
- §6: audit
- §8: phase 2, backend half. The UI is plan 2b.

## Global Constraints

- **Language and dashes:** no em dashes (U+2014) in `functions/`, `src/` or `tests/`. User-facing email text is bilingual, Turkish first, then English.
- **Public repo:** no secrets or real personal emails in code, tests or docs. Tests use `example.org`.
- **Migrations are run by hand:** one note `8d` at the top of `db/schema.sql`, after `8c`. New tables are `CREATE TABLE IF NOT EXISTS` at the end of the file.
- **Roles are checked on the server** with `canSocialEdit` / `canSocialPublish` from `functions/_lib/auth.ts`:
  - Editors create and edit plans and drafts, and submit.
  - Publishers also approve, reject and cancel any post, and open or close event modes.
  - Admins count as publishers.
- **Every mutation is audited** with `runWithAudit` or `runGuardedWithAudit` (Task 1). Action names: `social.plan.create|update|delete|remind`, `social.post.create|update|delete|submit|approve|reject|cancel`, `social.event.open|close`. Reads are not logged here; plan 2b logs pane views.
- **Lookups keyed by user input use `Object.hasOwn` or array `includes` on constant arrays**, never `obj[userString]`.
- **Exact values:**
  - Enabled platforms: `['instagram', 'linkedin']`. `x` exists in the model but is refused as `platform_unavailable`.
  - Caption limits: Instagram 2200 characters and 30 hashtags; LinkedIn 3000.
  - Carousel: 2 to 10 items. Image post: 1 item. Story: 1 item, Instagram only, 9:16.
  - Feed ratio: 4:5 to 1.91:1. Ratio tolerance: 1%.
  - Alt text: required for readiness, at most 1000 characters.
  - Link: `https://` only, at most 2048 characters.
  - Plan title: 1 to 120 characters. Plan note: at most 500. Review note: 1 to 500.
  - Event mode: 1 to 80 character name; length 7 days at most.
  - Calendar query span: 62 days at most.
  - Plan reminder window: 48 hours.
  - `LINK_IN_BIO_LINE = '🔗 Link profilde'`.
- **Media dimensions come from the server.** The upload endpoint records `width`/`height` in `social_media`, and readiness reads them from there, never from the client.
- **Run** `npm test`; also `npx astro check` (CI runs it) and `npm run build` before the last commit.

## Review Focus

1. **Two publishers act on one pending post at the same moment** (approve and reject, or approve twice). Expected: one wins; the other gets 409 `post_changed` and changes nothing, writing no audit row and sending no email. Pinned in Task 7.
2. **A publisher approves a request whose time has already passed.** Expected: 422 with problem `schedule_in_past`; the post stays pending. Pinned in Task 7.
3. **An editor edits a post that is already scheduled.** Expected: it returns to `pending_approval` and its queued targets are removed. A publisher's edit keeps it scheduled and rebuilds the targets. An event-mode story keeps `scheduled` only while a window still covers the editor. Pinned in Task 6.
4. **Gmail is broken, or a recipient list is empty, when a notification is due.** Expected: the request still succeeds, and the failure is only logged to the console. Pinned in Task 4 and Task 7.
5. **A client lies about image size** (sends a 9:16 story with a 1:1 image), or names an image key it never uploaded. Expected: readiness reports `bad_ratio` / `unknown_media` from the server's own record. Pinned in Task 3.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/schema.sql` | Note 8d; tables `social_media`, `social_plans`, `social_posts`, `social_post_targets`, `social_event_modes` |
| `functions/_lib/audit.ts` | Adds `runGuardedWithAudit` |
| `functions/_lib/social-limits.ts` | Platform and type constants, caption counting, `captionFor`, `ratioOk`, `captionProblems` |
| `functions/_lib/social-posts.ts` | Post types, `parseDraft`, `readinessProblems`, `mediaDims`, status rules, guarded statement builders, row mapping |
| `functions/_lib/social-events.ts` | `eventCovers`, `coveringEvent` |
| `functions/_lib/social-plans.ts` | `parsePlanInput` |
| `functions/_lib/social-notify.ts` | `sendSystemEmail`, `notificationText`, `publisherEmails`, `notifyEach` |
| `functions/_lib/social-api.ts` | `socialGate`, `readBody`, `malformed`, `nowSeconds`, `intParam`, `rangeParams` |
| `functions/api/blog-submissions/upload-image.ts` | Social roles may upload; records dimensions; returns `{url, key, width, height}` |
| `functions/api/social/editors.ts` | GET people who can be assigned |
| `functions/api/social/plans/index.ts`, `[id].ts` | Plan list/create, update/delete |
| `functions/api/social/posts/index.ts`, `[id].ts` | Post list/create, get/update/delete |
| `functions/api/social/posts/[id]/submit.ts`, `approve.ts`, `reject.ts`, `cancel.ts` | Status actions |
| `functions/api/social/event-modes/index.ts`, `[id]/close.ts` | Event mode list/open/close |
| `functions/api/admin/social/plan-reminders.ts` | Daily, secret-gated reminders |
| `workers/symposium-cron/src/index.ts`, `wrangler.toml` | Calls plan reminders |
| `tests/lib/social.ts` | Shared test fixture |
| `README.md` | Social content section, migration 8d, reminder |

---

### Task 1: Guarded audited writes

**Files:**
- Modify: `functions/_lib/audit.ts`
- Test: `tests/audit-guarded.test.ts`

**Interfaces:**
- Consumes: `hashRow`, `GENESIS`, `AuditEntry` (same file).
- Produces:
  - `interface AuditProof { condition: string; binds: unknown[] }`
  - `runGuardedWithAudit(db: D1Database, guard: D1PreparedStatement, proof: AuditProof, after: D1PreparedStatement[], entry: AuditEntry, now?: number): Promise<boolean>`
    - Returns true when the guard changed at least one row.
    - The audit row is inserted only when `proof.condition` (an SQL boolean expression written in code, never user input) holds after the guard.
    - `after` statements must carry their own guard condition.

- [ ] **Step 1: Write the failing test** `tests/audit-guarded.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { runGuardedWithAudit, verifyChain, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE t (id TEXT PRIMARY KEY, rev INTEGER NOT NULL, note TEXT)`);
  db.prepare(`INSERT INTO t (id, rev) VALUES ('a', 0)`).run();
  return { db, DB: d1(db) as never as D1Database };
}
const PROOF = (rev: number) => ({ condition: 'EXISTS (SELECT 1 FROM t WHERE id = ? AND rev = ?)', binds: ['a', rev] });

test('when the guard applies, the audit row and the after-statements land', async () => {
  const { db, DB } = setup();
  const ok = await runGuardedWithAudit(
    DB,
    DB.prepare('UPDATE t SET rev = rev + 1 WHERE id = ? AND rev = ?').bind('a', 0),
    PROOF(1),
    [DB.prepare(`UPDATE t SET note = 'after' WHERE id = ? AND EXISTS (SELECT 1 FROM t WHERE id = ? AND rev = ?)`).bind('a', 'a', 1)],
    { userId: 'u1', action: 'x.change' }, 100,
  );
  assert.equal(ok, true);
  assert.deepEqual({ ...db.prepare('SELECT rev, note FROM t').get() as object }, { rev: 1, note: 'after' });
  const rows = db.prepare('SELECT * FROM audit_log').all() as unknown as AuditRow[];
  assert.equal(rows.length, 1);
  assert.equal((await verifyChain(rows)).ok, true);
});

test('when the guard matches nothing, nothing is written and false comes back', async () => {
  const { db, DB } = setup();
  const ok = await runGuardedWithAudit(
    DB,
    DB.prepare('UPDATE t SET rev = rev + 1 WHERE id = ? AND rev = ?').bind('a', 7),
    PROOF(8),
    [DB.prepare(`UPDATE t SET note = 'after' WHERE id = ? AND EXISTS (SELECT 1 FROM t WHERE id = ? AND rev = ?)`).bind('a', 'a', 8)],
    { userId: 'u1', action: 'x.change' }, 100,
  );
  assert.equal(ok, false);
  assert.deepEqual({ ...db.prepare('SELECT rev, note FROM t').get() as object }, { rev: 0, note: null });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('two writers racing on one revision: exactly one wins', async () => {
  const { db, DB } = setup();
  const attempt = () => runGuardedWithAudit(
    DB, DB.prepare('UPDATE t SET rev = rev + 1 WHERE id = ? AND rev = ?').bind('a', 0), PROOF(1), [],
    { userId: 'u1', action: 'x.change' }, 100,
  );
  const results = await Promise.all([attempt(), attempt()]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 1);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/audit-guarded.test.ts`
Expected: FAIL, `runGuardedWithAudit` is not exported.

- [ ] **Step 3: Implement.** In `functions/_lib/audit.ts`, after `appendAudit`, add:

```ts
/** An SQL boolean expression, written in code, that is true only if the guard took effect. */
export interface AuditProof {
  condition: string;
  binds: unknown[];
}

/**
 * For changes that may lose a race: the guard is a conditional UPDATE or
 * DELETE (for example `WHERE id = ? AND revision = ?`). The guard, the audit
 * row and the `after` statements go in one batch. The audit row is inserted
 * only when `proof` holds afterwards, so a guard that matched nothing leaves
 * no record of a change that did not happen. Each `after` statement must
 * carry the same kind of condition itself. Returns whether the guard changed
 * a row.
 */
export async function runGuardedWithAudit(
  db: D1Database,
  guard: D1PreparedStatement,
  proof: AuditProof,
  after: D1PreparedStatement[],
  entry: AuditEntry,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = await db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').first<{ hash: string }>();
    const base = {
      at: now,
      user_id: entry.userId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: JSON.stringify(entry.details ?? {}),
      prev_hash: last?.hash ?? GENESIS,
    };
    const hash = await hashRow(base);
    const insert = db.prepare(
      `INSERT INTO audit_log (at, user_id, action, target_type, target_id, details, prev_hash, hash)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${proof.condition}`,
    ).bind(base.at, base.user_id, base.action, base.target_type, base.target_id, base.details, base.prev_hash, hash, ...proof.binds);
    try {
      const results = await db.batch([guard, insert, ...after]);
      const changes = (results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
      return Number(changes) > 0;
    } catch (err) {
      if (!isChainCollision(err)) throw err;
    }
  }
  throw new Error(`audit_log: could not append after ${MAX_ATTEMPTS} attempts`);
}
```

- [ ] **Step 4: Run the tests**

Run: `node --import tsx --test tests/audit-guarded.test.ts tests/audit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/audit.ts tests/audit-guarded.test.ts
git commit -m "Audit: guarded writes that log only the change that happened"
```

---

### Task 2: Shared limits

**Files:**
- Create: `functions/_lib/social-limits.ts`
- Test: `tests/social-limits.test.ts`

**Interfaces:**
- Produces:
  - `type SocialPlatform = 'instagram' | 'linkedin' | 'x'`
  - `type PostType = 'image' | 'carousel' | 'story'`
  - `ALL_PLATFORMS`, `ENABLED_PLATFORMS`, `POST_TYPES`
  - `CAPTION_LIMITS`, `INSTAGRAM_MAX_HASHTAGS`, `CAROUSEL_MIN_ITEMS`, `CAROUSEL_MAX_ITEMS`, `MAX_ALT_LENGTH`, `LINK_IN_BIO_LINE`
  - `countChars(text: string): number`, `countHashtags(text: string): number`
  - `interface CaptionSource { caption: string; captionOverrides: Partial<Record<SocialPlatform, string>>; link: string | null }`
  - `captionFor(src: CaptionSource, platform: SocialPlatform): string`
  - `ratioOk(type: PostType, width: number, height: number): boolean`
  - `type CaptionProblem = { code: 'caption_too_long' | 'too_many_hashtags'; platform: SocialPlatform; limit: number; actual: number }`
  - `captionProblems(src: CaptionSource, platforms: SocialPlatform[], type: PostType): CaptionProblem[]`
  - Plan 2b's composer imports this file to count exactly as the server does.

- [ ] **Step 1: Failing test** `tests/social-limits.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countChars, countHashtags, captionFor, ratioOk, captionProblems, LINK_IN_BIO_LINE,
} from '../functions/_lib/social-limits';

test('characters are counted as the user sees them', () => {
  assert.equal(countChars('şğüöçı'), 6);
  assert.equal(countChars('🧬🎓'), 2, 'an emoji is one character, not two UTF-16 units');
});

test('hashtags include Turkish letters and digits', () => {
  assert.equal(countHashtags('#RSGTürkiye #biyoinformatik #2026 # not'), 3);
});

test('Instagram gets the link-in-bio line, LinkedIn gets the link itself', () => {
  const src = { caption: 'Sertifikalar yayında', captionOverrides: {}, link: 'https://rsg-turkiye.iscbsc.org/certificates' };
  assert.equal(captionFor(src, 'instagram'), `Sertifikalar yayında\n\n${LINK_IN_BIO_LINE}`);
  assert.equal(captionFor(src, 'linkedin'), 'Sertifikalar yayında\n\nhttps://rsg-turkiye.iscbsc.org/certificates');
  assert.equal(captionFor({ ...src, link: null }, 'instagram'), 'Sertifikalar yayında');
});

test('a non-empty override replaces the shared caption for that platform only', () => {
  const src = { caption: 'TR', captionOverrides: { linkedin: 'EN' }, link: null };
  assert.equal(captionFor(src, 'linkedin'), 'EN');
  assert.equal(captionFor(src, 'instagram'), 'TR');
  assert.equal(captionFor({ ...src, captionOverrides: { linkedin: '   ' } }, 'linkedin'), 'TR', 'blank override falls back');
});

test('ratios: feed 4:5 to 1.91:1, story 9:16, with 1% tolerance', () => {
  assert.equal(ratioOk('image', 1080, 1350), true);
  assert.equal(ratioOk('carousel', 1080, 1080), true);
  assert.equal(ratioOk('image', 1910, 1000), true);
  assert.equal(ratioOk('image', 1080, 1920), false, 'a story-shaped image is not a feed post');
  assert.equal(ratioOk('story', 1080, 1920), true);
  assert.equal(ratioOk('story', 1080, 1350), false);
  assert.equal(ratioOk('image', 0, 100), false);
});

test('caption problems per platform; stories have no caption to check', () => {
  const long = 'a'.repeat(2201);
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  const src = { caption: long, captionOverrides: { linkedin: tags }, link: null };
  assert.deepEqual(captionProblems(src, ['instagram', 'linkedin'], 'image'), [
    { code: 'caption_too_long', platform: 'instagram', limit: 2200, actual: 2201 },
  ]);
  assert.deepEqual(captionProblems({ ...src, caption: tags }, ['instagram'], 'image'), [
    { code: 'too_many_hashtags', platform: 'instagram', limit: 30, actual: 31 },
  ]);
  assert.deepEqual(captionProblems(src, ['instagram'], 'story'), []);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-limits.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `functions/_lib/social-limits.ts`

```ts
/**
 * What each platform accepts, counted one way for the composer and the
 * server alike (spec §2): plan 2b imports this file, so the panel can never
 * call a caption fine that the server then refuses.
 */
export type SocialPlatform = 'instagram' | 'linkedin' | 'x';
export type PostType = 'image' | 'carousel' | 'story';

export const ALL_PLATFORMS: SocialPlatform[] = ['instagram', 'linkedin', 'x'];
/** X is modelled but not offered until its own phase. */
export const ENABLED_PLATFORMS: SocialPlatform[] = ['instagram', 'linkedin'];
export const POST_TYPES: PostType[] = ['image', 'carousel', 'story'];

export const CAPTION_LIMITS: Record<SocialPlatform, number> = { instagram: 2200, linkedin: 3000, x: 280 };
export const INSTAGRAM_MAX_HASHTAGS = 30;
export const CAROUSEL_MIN_ITEMS = 2;
export const CAROUSEL_MAX_ITEMS = 10;
export const MAX_ALT_LENGTH = 1000;
/** Instagram never makes caption links clickable; the link goes to /links instead. */
export const LINK_IN_BIO_LINE = '🔗 Link profilde';

const FEED_MIN_RATIO = 4 / 5;
const FEED_MAX_RATIO = 1.91;
const STORY_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.01;

/** Code points, so an emoji or a Turkish letter is one character. */
export function countChars(text: string): number {
  return [...text].length;
}

export function countHashtags(text: string): number {
  return (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
}

export interface CaptionSource {
  caption: string;
  captionOverrides: Partial<Record<SocialPlatform, string>>;
  link: string | null;
}

/** The text a platform will receive: its override if one is written, then the link in that platform's form. */
export function captionFor(src: CaptionSource, platform: SocialPlatform): string {
  const override = Object.hasOwn(src.captionOverrides, platform) ? src.captionOverrides[platform] : undefined;
  const base = override !== undefined && override.trim() !== '' ? override : src.caption;
  if (!src.link) return base;
  const tail = platform === 'instagram' ? LINK_IN_BIO_LINE : src.link;
  return base.trim() === '' ? tail : `${base}\n\n${tail}`;
}

export function ratioOk(type: PostType, width: number, height: number): boolean {
  if (!(width > 0) || !(height > 0)) return false;
  const r = width / height;
  if (type === 'story') return Math.abs(r - STORY_RATIO) <= STORY_RATIO * RATIO_TOLERANCE;
  return r >= FEED_MIN_RATIO * (1 - RATIO_TOLERANCE) && r <= FEED_MAX_RATIO * (1 + RATIO_TOLERANCE);
}

export type CaptionProblem = {
  code: 'caption_too_long' | 'too_many_hashtags';
  platform: SocialPlatform;
  limit: number;
  actual: number;
};

/** A story shows no caption, so a story's caption is never checked. */
export function captionProblems(src: CaptionSource, platforms: SocialPlatform[], type: PostType): CaptionProblem[] {
  if (type === 'story') return [];
  const problems: CaptionProblem[] = [];
  for (const platform of platforms) {
    const text = captionFor(src, platform);
    const chars = countChars(text);
    if (chars > CAPTION_LIMITS[platform]) {
      problems.push({ code: 'caption_too_long', platform, limit: CAPTION_LIMITS[platform], actual: chars });
    }
    if (platform === 'instagram') {
      const tags = countHashtags(text);
      if (tags > INSTAGRAM_MAX_HASHTAGS) {
        problems.push({ code: 'too_many_hashtags', platform, limit: INSTAGRAM_MAX_HASHTAGS, actual: tags });
      }
    }
  }
  return problems;
}
```

- [ ] **Step 4: Run** `node --import tsx --test tests/social-limits.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social-limits.ts tests/social-limits.test.ts
git commit -m "Social limits: one way to count captions and check ratios"
```

---

### Task 3: Schema, upload dimensions, and the post rules

**Files:**
- Modify: `db/schema.sql` (note 8d; five tables at the end)
- Modify: `functions/api/blog-submissions/upload-image.ts`
- Create: `functions/_lib/social-posts.ts`, `functions/_lib/social-events.ts`
- Test: `tests/social-posts.test.ts`, `tests/upload-image-social.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's constants and functions.
  - `validateScheduledAt(value, now)` from `functions/_lib/schedule.ts`: codes `invalid_schedule_time`, `schedule_in_past`, `schedule_too_far`.
  - `IMAGE_KEY` from `functions/api/images/[key].ts`.
  - `canSocialEdit` from auth.
- Produces (social-posts.ts):
  - `type PostStatus = 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'partially_published' | 'failed' | 'rejected' | 'cancelled'`
  - `LOCKED_STATUSES: PostStatus[]`
  - `interface MediaRef { key: string; alt: string }`
  - `interface DraftInput { type: PostType; caption: string; captionOverrides: Partial<Record<SocialPlatform, string>>; link: string | null; media: MediaRef[]; platforms: SocialPlatform[]; scheduledAt: number | null }`
  - `type Parsed<T> = { ok: true; value: T } | { ok: false; code: string }`
  - `parseDraft(body: Record<string, unknown>): Parsed<DraftInput>`
  - `type Problem = { code: string; index?: number; platform?: SocialPlatform; limit?: number; actual?: number }`
  - `mediaDims(db: D1Database, keys: string[]): Promise<Map<string, { width: number; height: number }>>`
  - `readinessProblems(post: DraftInput, dims: Map<string, { width: number; height: number }>, now: number): Problem[]`
  - `interface Actor { id: string; isPublisher: boolean }`
  - `canEditPost(actor: Actor, post: { status: PostStatus; created_by: string }): boolean`
  - `canDeletePost(actor: Actor, post: { status: PostStatus; created_by: string }): boolean`
  - `canCancelPost(actor: Actor, post: { status: PostStatus; created_by: string }): boolean`
  - `statusAfterEdit(actor: Actor, current: PostStatus, storyCovered: boolean): PostStatus`
  - `statusOnSubmit(actor: Actor, storyCovered: boolean): 'scheduled' | 'pending_approval'`
  - `interface PostRow` (the DB row: `id, type, caption, caption_overrides, link, media, platforms, scheduled_at, status, revision, created_by, approved_by, approved_at, review_note, event_mode_id, created_at, updated_at`)
  - `rowToDraft(row: PostRow): DraftInput`
  - `type PostColumn` (union of writable column names)
  - `POST_PROOF: string`, which is `'EXISTS (SELECT 1 FROM social_posts WHERE id = ? AND revision = ?)'`
  - `updatePostGuarded(db: D1Database, id: string, revision: number, fields: Partial<Record<PostColumn, unknown>>, now: number, statusIn?: PostStatus[]): D1PreparedStatement`
  - `targetStatements(db: D1Database, postId: string, newRevision: number, platforms: SocialPlatform[] | null): D1PreparedStatement[]`
  - `unlinkPlanStatement(db: D1Database, postId: string, newRevision: number): D1PreparedStatement`
  - `draftColumns(d: DraftInput): Partial<Record<PostColumn, unknown>>`
- Produces (social-events.ts):
  - `interface EventModeRow { id: string; name: string; starts_at: number; ends_at: number; editor_ids: string; opened_by: string; closed_by: string | null; closed_at: number | null; created_at: number }`
  - `MAX_EVENT_SECONDS`
  - `eventCovers(mode: EventModeRow, userId: string, now: number): boolean`
  - `coveringEvent(db: D1Database, userId: string, now: number): Promise<EventModeRow | null>`
- Upload endpoint: social editors may upload. Every successful upload inserts a `social_media` row, and the response is `{ url, key, width, height }`.

- [ ] **Step 1: Schema.** At the end of `db/schema.sql`:

```sql
-- Social media content (spec §3). Dimensions of every uploaded image are
-- recorded here by /api/blog-submissions/upload-image, so a post's ratio
-- check reads the server's own measurement, never the browser's claim.
CREATE TABLE IF NOT EXISTS social_media (
  key           TEXT PRIMARY KEY,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   INTEGER NOT NULL
);

-- A slot on the calendar before its content exists. post_id is set when a
-- post is attached, and cleared again if that post is deleted or cancelled.
CREATE TABLE IF NOT EXISTS social_plans (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  scheduled_at  INTEGER NOT NULL,
  platforms     TEXT NOT NULL DEFAULT '["instagram"]',
  post_type     TEXT NOT NULL DEFAULT 'image' CHECK (post_type IN ('image','carousel','story')),
  assignee_id   TEXT,
  note          TEXT NOT NULL DEFAULT '',
  post_id       TEXT,
  reminded_at   INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_plans_at ON social_plans(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_plans_post ON social_plans(post_id);

-- revision rises on every change; each write names the revision it read, so
-- two people acting at once cannot both win (functions/_lib/social-posts.ts).
CREATE TABLE IF NOT EXISTS social_posts (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('image','carousel','story')),
  caption            TEXT NOT NULL DEFAULT '',
  caption_overrides  TEXT NOT NULL DEFAULT '{}',
  link               TEXT,
  media              TEXT NOT NULL DEFAULT '[]',
  platforms          TEXT NOT NULL DEFAULT '[]',
  scheduled_at       INTEGER,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','scheduled','published','partially_published','failed','rejected','cancelled')),
  revision           INTEGER NOT NULL DEFAULT 0,
  created_by         TEXT NOT NULL,
  approved_by        TEXT,
  approved_at        INTEGER,
  review_note        TEXT,
  event_mode_id      TEXT,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_at ON social_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);

-- One row per post per platform: the unit phase 3's dispatcher publishes.
CREATE TABLE IF NOT EXISTS social_post_targets (
  post_id         TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('instagram','linkedin','x')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','waiting_connection','needs_confirmation','publishing','published','failed','skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  claimed_at      INTEGER,
  last_error      TEXT,
  container_id    TEXT,
  remote_id       TEXT,
  permalink       TEXT,
  published_at    INTEGER,
  PRIMARY KEY (post_id, platform)
);

-- A time-boxed window in which named editors' stories skip approval (spec §1).
CREATE TABLE IF NOT EXISTS social_event_modes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  editor_ids  TEXT NOT NULL DEFAULT '[]',
  opened_by   TEXT NOT NULL,
  closed_by   TEXT,
  closed_at   INTEGER,
  created_at  INTEGER NOT NULL
);
```

Header note after 8c:

```sql
-- 8d. Social media content tables (social_media, social_plans, social_posts,
--    social_post_targets, social_event_modes). New tables, IF NOT EXISTS:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run it before deploying. Without social_media, image uploads still work
--    (the insert is wrapped) but every social post reads as unknown_media;
--    without the others, /api/social/* answers 500.
--
```

- [ ] **Step 2: Failing tests.** `tests/upload-image-social.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { onRequestPost } from '../functions/api/blog-submissions/upload-image';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
/** A minimal JPEG whose frame header says width x height. */
const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0, 0, 0, 0, 0, 0, 0, 0]);

function setup(roles: Record<string, number>, schema = SCHEMA) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','a@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db), BLOG_IMAGES: fakeR2(), PUBLIC_BLOG_IMAGES_URL: 'https://rsg-turkiye.iscbsc.org/api/images' } as never };
}
const upload = (env: unknown, bytes: Uint8Array) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/blog-submissions/upload-image', {
      method: 'POST', headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'image/jpeg' }, body: bytes,
    }),
    env,
  });

test('a social editor may upload, and the server records the real size', async () => {
  const { env, db } = setup({ is_social: 1 });
  const res = await upload(env, jpeg(1080, 1350));
  assert.equal(res.status, 200);
  const body = await res.json() as { url: string; key: string; width: number; height: number };
  assert.match(body.key, /^[0-9a-f-]{36}\.jpg$/);
  assert.equal(body.url, `https://rsg-turkiye.iscbsc.org/api/images/${body.key}`);
  assert.deepEqual([body.width, body.height], [1080, 1350]);
  const row = db.prepare('SELECT width, height, uploaded_by FROM social_media WHERE key = ?').get(body.key);
  assert.deepEqual({ ...row as object }, { width: 1080, height: 1350, uploaded_by: 'u1' });
});

test('someone with no writing or social role still cannot upload', async () => {
  const { env } = setup({ is_member: 1 });
  assert.equal((await upload(env, jpeg(10, 10))).status, 403);
});

test('before the 8d migration a blog upload still succeeds', async () => {
  const pre = SCHEMA.replace(/CREATE TABLE IF NOT EXISTS social_media[\s\S]*?\);/, '');
  const { env } = setup({ is_writer: 1 }, pre);
  assert.equal((await upload(env, jpeg(800, 600))).status, 200);
});
```

`tests/social-posts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import {
  parseDraft, readinessProblems, mediaDims, canEditPost, canDeletePost, canCancelPost, statusAfterEdit, statusOnSubmit,
  updatePostGuarded, targetStatements, POST_PROOF, type DraftInput,
} from '../functions/_lib/social-posts';
import { eventCovers, coveringEvent, type EventModeRow } from '../functions/_lib/social-events';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY_A = '11111111-1111-4111-8111-111111111111.jpg';
const KEY_B = '22222222-2222-4222-8222-222222222222.jpg';
const NOW = 1_800_000_000;

test('parseDraft accepts a sparse draft and fills defaults', () => {
  const r = parseDraft({ type: 'image' });
  assert.deepEqual(r, { ok: true, value: { type: 'image', caption: '', captionOverrides: {}, link: null, media: [], platforms: [], scheduledAt: null } });
});

test('parseDraft refuses wrong shapes with a code', () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ type: 'reel' }, 'invalid_type'],
    [{ type: 'image', caption: 7 }, 'invalid_caption'],
    [{ type: 'image', captionOverrides: { myspace: 'x' } }, 'invalid_overrides'],
    [{ type: 'image', captionOverrides: { constructor: 'x' } }, 'invalid_overrides'],
    [{ type: 'image', link: 'http://example.org' }, 'invalid_link'],
    [{ type: 'image', media: [{ key: '../etc/passwd', alt: '' }] }, 'invalid_media'],
    [{ type: 'image', media: Array.from({ length: 11 }, () => ({ key: KEY_A, alt: 'x' })) }, 'too_many_items'],
    [{ type: 'image', platforms: ['instagram', 'instagram'] }, 'invalid_platforms'],
    [{ type: 'image', platforms: ['toString'] }, 'invalid_platforms'],
    [{ type: 'image', scheduledAt: 1.5 }, 'invalid_schedule'],
  ];
  for (const [body, code] of bad) assert.deepEqual(parseDraft(body), { ok: false, code }, code);
});

const ready = (over: Partial<DraftInput> = {}): DraftInput => ({
  type: 'image', caption: 'Merhaba', captionOverrides: {}, link: null,
  media: [{ key: KEY_A, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: NOW + 3600, ...over,
});
const dims = new Map([[KEY_A, { width: 1080, height: 1350 }], [KEY_B, { width: 1080, height: 1920 }]]);
const codes = (p: DraftInput) => readinessProblems(p, dims, NOW).map((x) => x.code);

test('a complete post has no problems', () => {
  assert.deepEqual(readinessProblems(ready(), dims, NOW), []);
});

test('readiness: every rule says what is wrong', () => {
  assert.deepEqual(codes(ready({ platforms: [] })), ['no_platform']);
  assert.deepEqual(codes(ready({ platforms: ['x'] })), ['platform_unavailable']);
  assert.deepEqual(codes(ready({ media: [{ key: KEY_A, alt: '  ' }] })), ['missing_alt']);
  assert.deepEqual(codes(ready({ media: [] })), ['media_count']);
  assert.deepEqual(codes(ready({ type: 'carousel' })), ['media_count'], 'a carousel needs at least two');
  assert.deepEqual(codes(ready({ media: [{ key: KEY_B, alt: 'x' }] })), ['bad_ratio'], 'the server size wins, not the claim');
  assert.deepEqual(codes(ready({ media: [{ key: '33333333-3333-4333-8333-333333333333.jpg', alt: 'x' }] })), ['unknown_media']);
  assert.deepEqual(codes(ready({ type: 'story', media: [{ key: KEY_B, alt: 'x' }], platforms: ['instagram', 'linkedin'] })), ['story_instagram_only']);
  assert.deepEqual(codes(ready({ type: 'story', media: [{ key: KEY_B, alt: 'x' }] })), []);
  assert.deepEqual(codes(ready({ scheduledAt: null })), ['no_schedule']);
  assert.deepEqual(codes(ready({ scheduledAt: NOW - 60 })), ['schedule_in_past']);
  assert.deepEqual(codes(ready({ caption: 'a'.repeat(2201) })), ['caption_too_long']);
});

test('mediaDims reads the server record, and an empty list asks nothing', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, 1080, 1350, 'image/jpeg', 1, 'u', 1)`).run(KEY_A);
  const m = await mediaDims(d1(db) as never, [KEY_A, KEY_B]);
  assert.deepEqual([...m.entries()], [[KEY_A, { width: 1080, height: 1350 }]]);
  assert.equal((await mediaDims(d1(db) as never, [])).size, 0);
});

const editor = { id: 'ed', isPublisher: false };
const publisher = { id: 'pub', isPublisher: true };

test('who may edit, delete and cancel', () => {
  const own = (status: string) => ({ status: status as never, created_by: 'ed' });
  const other = (status: string) => ({ status: status as never, created_by: 'someone' });
  assert.equal(canEditPost(editor, own('draft')), true);
  assert.equal(canEditPost(editor, own('scheduled')), true);
  assert.equal(canEditPost(editor, other('draft')), false);
  assert.equal(canEditPost(publisher, other('scheduled')), true);
  for (const s of ['published', 'partially_published', 'failed', 'cancelled']) assert.equal(canEditPost(publisher, other(s)), false, s);
  assert.equal(canDeletePost(editor, own('draft')), true);
  assert.equal(canDeletePost(editor, own('pending_approval')), false);
  assert.equal(canDeletePost(publisher, other('rejected')), true);
  assert.equal(canCancelPost(editor, own('pending_approval')), true);
  assert.equal(canCancelPost(editor, other('scheduled')), false);
  assert.equal(canCancelPost(publisher, other('scheduled')), true);
  assert.equal(canCancelPost(publisher, other('draft')), false);
});

test('status after an edit and on submit', () => {
  assert.equal(statusAfterEdit(editor, 'scheduled', false), 'pending_approval');
  assert.equal(statusAfterEdit(editor, 'scheduled', true), 'scheduled', 'a covered event story stays scheduled');
  assert.equal(statusAfterEdit(publisher, 'scheduled', false), 'scheduled');
  assert.equal(statusAfterEdit(editor, 'rejected', false), 'draft');
  assert.equal(statusAfterEdit(editor, 'pending_approval', false), 'pending_approval');
  assert.equal(statusOnSubmit(editor, false), 'pending_approval');
  assert.equal(statusOnSubmit(editor, true), 'scheduled');
  assert.equal(statusOnSubmit(publisher, false), 'scheduled');
});

test('event coverage: open, in time, and naming the editor', () => {
  const mode: EventModeRow = { id: 'e', name: 'Sempozyum', starts_at: NOW - 10, ends_at: NOW + 10, editor_ids: '["ed"]', opened_by: 'pub', closed_by: null, closed_at: null, created_at: NOW - 20 };
  assert.equal(eventCovers(mode, 'ed', NOW), true);
  assert.equal(eventCovers(mode, 'other', NOW), false);
  assert.equal(eventCovers(mode, 'ed', NOW + 10), false, 'ends_at is exclusive');
  assert.equal(eventCovers({ ...mode, closed_at: NOW - 1 }, 'ed', NOW), false);
  assert.equal(eventCovers({ ...mode, editor_ids: 'not json' }, 'ed', NOW), false);
});

test('coveringEvent finds the open window for this editor', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 10, NOW + 10);
  assert.equal((await coveringEvent(d1(db) as never, 'ed', NOW))?.id, 'e');
  assert.equal(await coveringEvent(d1(db) as never, 'other', NOW), null);
});

test('guarded update and targets only act on the expected revision', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_posts (id, type, created_by, created_at, updated_at) VALUES ('p','image','ed',1,1)`).run();
  const DB = d1(db) as never as D1Database;
  const stale = await DB.batch([updatePostGuarded(DB, 'p', 5, { status: 'scheduled' }, NOW), ...targetStatements(DB, 'p', 6, ['instagram'])]);
  assert.equal((stale[0] as { meta: { changes: number } }).meta.changes, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 0);
  await DB.batch([updatePostGuarded(DB, 'p', 0, { status: 'scheduled' }, NOW), ...targetStatements(DB, 'p', 1, ['instagram', 'linkedin'])]);
  assert.deepEqual({ ...db.prepare('SELECT status, revision FROM social_posts').get() as object }, { status: 'scheduled', revision: 1 });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 2);
  assert.match(POST_PROOF, /revision = \?/);
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `node --import tsx --test tests/social-posts.test.ts tests/upload-image-social.test.ts`
Expected: FAIL, modules not found, and the upload test gets 403.

- [ ] **Step 4: Upload endpoint.** In `functions/api/blog-submissions/upload-image.ts`:

1. Import `canSocialEdit`.
2. Change the role check to `if (user.is_writer !== 1 && !canManageSymposium(user) && !canSocialEdit(user)) {`, and add to the comment above it: "Social editors upload post images here too (spec §3)."
3. Replace the final two statements with:

```ts
  const key = `${crypto.randomUUID()}.${extension}`;
  await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType } });

  // The social panel checks a post's aspect ratio against this record rather
  // than whatever the browser claims. Wrapped: a blog upload must not fail
  // because the social tables have not been migrated yet.
  try {
    await env.DB.prepare(
      'INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(key, size.width, size.height, contentType, bytes.byteLength, user.id, Math.floor(Date.now() / 1000)).run();
  } catch (err) {
    console.error('social_media insert failed', err);
  }

  return jsonResponse({ url: `${env.PUBLIC_BLOG_IMAGES_URL}/${key}`, key, width: size.width, height: size.height });
```

- [ ] **Step 5: `functions/_lib/social-events.ts`**

```ts
/** Event mode (spec §1): a time-boxed window in which named editors' stories skip approval. */
export interface EventModeRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number;
  editor_ids: string;
  opened_by: string;
  closed_by: string | null;
  closed_at: number | null;
  created_at: number;
}

export const MAX_EVENT_SECONDS = 7 * 86400;

function ids(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function eventCovers(mode: EventModeRow, userId: string, now: number): boolean {
  return mode.closed_at === null && mode.starts_at <= now && now < mode.ends_at && ids(mode.editor_ids).includes(userId);
}

export async function coveringEvent(db: D1Database, userId: string, now: number): Promise<EventModeRow | null> {
  const rows = (await db.prepare(
    'SELECT * FROM social_event_modes WHERE closed_at IS NULL AND starts_at <= ? AND ends_at > ?',
  ).bind(now, now).all<EventModeRow>()).results;
  return rows.find((m) => eventCovers(m, userId, now)) ?? null;
}
```

- [ ] **Step 6: `functions/_lib/social-posts.ts`**

```ts
/**
 * The rules for a social post: what a draft may look like, what makes it
 * ready to go out, who may change it, and the guarded statements every change
 * is written with. Pure apart from mediaDims, which reads the server's own
 * record of image sizes.
 */
import {
  ALL_PLATFORMS, ENABLED_PLATFORMS, POST_TYPES, CAROUSEL_MIN_ITEMS, CAROUSEL_MAX_ITEMS, MAX_ALT_LENGTH,
  ratioOk, captionProblems, type PostType, type SocialPlatform,
} from './social-limits';
import { validateScheduledAt } from './schedule';
import { IMAGE_KEY } from '../api/images/[key]';

export type PostStatus =
  | 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'partially_published' | 'failed' | 'rejected' | 'cancelled';
/** Nobody edits these: they record what already happened, or what was abandoned. */
export const LOCKED_STATUSES: PostStatus[] = ['published', 'partially_published', 'failed', 'cancelled'];

const MAX_CAPTION_STORED = 5000;
const MAX_LINK = 2048;

export interface MediaRef { key: string; alt: string }

export interface DraftInput {
  type: PostType;
  caption: string;
  captionOverrides: Partial<Record<SocialPlatform, string>>;
  link: string | null;
  media: MediaRef[];
  platforms: SocialPlatform[];
  scheduledAt: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: string };
const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });
const isPlatform = (v: unknown): v is SocialPlatform => typeof v === 'string' && (ALL_PLATFORMS as string[]).includes(v);

/** Shape only. A draft may be incomplete; readinessProblems decides whether it can go out. */
export function parseDraft(body: Record<string, unknown>): Parsed<DraftInput> {
  const type = body.type;
  if (typeof type !== 'string' || !(POST_TYPES as string[]).includes(type)) return fail('invalid_type');

  const caption = body.caption ?? '';
  if (typeof caption !== 'string' || caption.length > MAX_CAPTION_STORED) return fail('invalid_caption');

  const rawOverrides = body.captionOverrides ?? {};
  if (rawOverrides === null || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) return fail('invalid_overrides');
  const captionOverrides: Partial<Record<SocialPlatform, string>> = {};
  for (const [k, v] of Object.entries(rawOverrides)) {
    if (!isPlatform(k) || typeof v !== 'string' || v.length > MAX_CAPTION_STORED) return fail('invalid_overrides');
    captionOverrides[k] = v;
  }

  let link: string | null = null;
  if (body.link !== undefined && body.link !== null && body.link !== '') {
    if (typeof body.link !== 'string' || body.link.length > MAX_LINK || !body.link.startsWith('https://')) return fail('invalid_link');
    try { new URL(body.link); } catch { return fail('invalid_link'); }
    link = body.link;
  }

  const rawMedia = body.media ?? [];
  if (!Array.isArray(rawMedia)) return fail('invalid_media');
  if (rawMedia.length > CAROUSEL_MAX_ITEMS) return fail('too_many_items');
  const media: MediaRef[] = [];
  for (const m of rawMedia) {
    if (m === null || typeof m !== 'object') return fail('invalid_media');
    const { key, alt } = m as { key?: unknown; alt?: unknown };
    if (typeof key !== 'string' || !IMAGE_KEY.test(key)) return fail('invalid_media');
    if (typeof alt !== 'string' || alt.length > MAX_ALT_LENGTH) return fail('invalid_media');
    media.push({ key, alt });
  }

  const rawPlatforms = body.platforms ?? [];
  if (!Array.isArray(rawPlatforms) || !rawPlatforms.every(isPlatform) || new Set(rawPlatforms).size !== rawPlatforms.length) {
    return fail('invalid_platforms');
  }

  const scheduledAt = body.scheduledAt ?? null;
  if (scheduledAt !== null && (typeof scheduledAt !== 'number' || !Number.isInteger(scheduledAt) || scheduledAt < 0)) {
    return fail('invalid_schedule');
  }

  return { ok: true, value: { type: type as PostType, caption, captionOverrides, link, media, platforms: rawPlatforms, scheduledAt } };
}

export type Problem = { code: string; index?: number; platform?: SocialPlatform; limit?: number; actual?: number };

/** Sizes as the upload endpoint measured them. Keys never uploaded are simply absent. */
export async function mediaDims(db: D1Database, keys: string[]): Promise<Map<string, { width: number; height: number }>> {
  const out = new Map<string, { width: number; height: number }>();
  if (keys.length === 0) return out;
  const rows = (await db.prepare(
    `SELECT key, width, height FROM social_media WHERE key IN (${keys.map(() => '?').join(',')})`,
  ).bind(...keys).all<{ key: string; width: number; height: number }>()).results;
  for (const r of rows) out.set(r.key, { width: r.width, height: r.height });
  return out;
}

/** Everything that stops a post from being submitted or approved. Empty means ready. */
export function readinessProblems(post: DraftInput, dims: Map<string, { width: number; height: number }>, now: number): Problem[] {
  const problems: Problem[] = [];
  if (post.platforms.length === 0) problems.push({ code: 'no_platform' });
  for (const platform of post.platforms) {
    if (!ENABLED_PLATFORMS.includes(platform)) problems.push({ code: 'platform_unavailable', platform });
  }
  if (post.type === 'story' && post.platforms.some((p) => p !== 'instagram')) problems.push({ code: 'story_instagram_only' });

  const n = post.media.length;
  const countOk = post.type === 'carousel' ? n >= CAROUSEL_MIN_ITEMS && n <= CAROUSEL_MAX_ITEMS : n === 1;
  if (!countOk) problems.push({ code: 'media_count', actual: n });

  post.media.forEach((m, index) => {
    if (m.alt.trim() === '') problems.push({ code: 'missing_alt', index });
    const d = dims.get(m.key);
    if (!d) problems.push({ code: 'unknown_media', index });
    else if (!ratioOk(post.type, d.width, d.height)) problems.push({ code: 'bad_ratio', index });
  });

  const enabled = post.platforms.filter((p) => ENABLED_PLATFORMS.includes(p));
  for (const p of captionProblems(post, enabled, post.type)) problems.push(p);

  if (post.scheduledAt === null) problems.push({ code: 'no_schedule' });
  else {
    const v = validateScheduledAt(post.scheduledAt, now);
    if (!v.ok) problems.push({ code: v.code });
  }
  return problems;
}

export interface Actor { id: string; isPublisher: boolean }
type Owned = { status: PostStatus; created_by: string };

export function canEditPost(actor: Actor, post: Owned): boolean {
  if (LOCKED_STATUSES.includes(post.status)) return false;
  return actor.isPublisher || post.created_by === actor.id;
}

export function canDeletePost(actor: Actor, post: Owned): boolean {
  return (post.status === 'draft' || post.status === 'rejected') && (actor.isPublisher || post.created_by === actor.id);
}

export function canCancelPost(actor: Actor, post: Owned): boolean {
  return (post.status === 'pending_approval' || post.status === 'scheduled') && (actor.isPublisher || post.created_by === actor.id);
}

/**
 * An editor changing a post that was approved sends it back for approval;
 * a publisher's change, or a story inside an event window that covers the
 * editor, keeps it scheduled. A rejected post becomes a draft again.
 */
export function statusAfterEdit(actor: Actor, current: PostStatus, storyCovered: boolean): PostStatus {
  if (current === 'rejected') return 'draft';
  if (current === 'scheduled' && !actor.isPublisher && !storyCovered) return 'pending_approval';
  return current;
}

export function statusOnSubmit(actor: Actor, storyCovered: boolean): 'scheduled' | 'pending_approval' {
  return actor.isPublisher || storyCovered ? 'scheduled' : 'pending_approval';
}

export interface PostRow {
  id: string;
  type: PostType;
  caption: string;
  caption_overrides: string;
  link: string | null;
  media: string;
  platforms: string;
  scheduled_at: number | null;
  status: PostStatus;
  revision: number;
  created_by: string;
  approved_by: string | null;
  approved_at: number | null;
  review_note: string | null;
  event_mode_id: string | null;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function rowToDraft(row: PostRow): DraftInput {
  return {
    type: row.type,
    caption: row.caption,
    captionOverrides: parseJson(row.caption_overrides, {}),
    link: row.link,
    media: parseJson(row.media, []),
    platforms: parseJson(row.platforms, []),
    scheduledAt: row.scheduled_at,
  };
}

export type PostColumn =
  | 'type' | 'caption' | 'caption_overrides' | 'link' | 'media' | 'platforms' | 'scheduled_at'
  | 'status' | 'approved_by' | 'approved_at' | 'review_note' | 'event_mode_id';

export function draftColumns(d: DraftInput): Partial<Record<PostColumn, unknown>> {
  return {
    type: d.type,
    caption: d.caption,
    caption_overrides: JSON.stringify(d.captionOverrides),
    link: d.link,
    media: JSON.stringify(d.media),
    platforms: JSON.stringify(d.platforms),
    scheduled_at: d.scheduledAt,
  };
}

/** True after a guarded update took effect: the row carries the revision that update wrote. */
export const POST_PROOF = 'EXISTS (SELECT 1 FROM social_posts WHERE id = ? AND revision = ?)';

/** Column names come from the PostColumn union, never from a request. */
export function updatePostGuarded(
  db: D1Database, id: string, revision: number, fields: Partial<Record<PostColumn, unknown>>, now: number, statusIn?: PostStatus[],
): D1PreparedStatement {
  const cols = Object.keys(fields) as PostColumn[];
  const sets = cols.map((c) => `${c} = ?, `).join('');
  const statusClause = statusIn && statusIn.length ? ` AND status IN (${statusIn.map(() => '?').join(', ')})` : '';
  return db.prepare(
    `UPDATE social_posts SET ${sets}revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?${statusClause}`,
  ).bind(...cols.map((c) => fields[c]), now, id, revision, ...(statusIn ?? []));
}

/** Replaces a post's queued targets (null: removes them), only if the guarded update landed. */
export function targetStatements(db: D1Database, postId: string, newRevision: number, platforms: SocialPlatform[] | null): D1PreparedStatement[] {
  const statements = [
    db.prepare(`DELETE FROM social_post_targets WHERE post_id = ? AND ${POST_PROOF}`).bind(postId, postId, newRevision),
  ];
  for (const platform of platforms ?? []) {
    statements.push(db.prepare(
      `INSERT INTO social_post_targets (post_id, platform, status) SELECT ?, ?, 'queued' WHERE ${POST_PROOF}`,
    ).bind(postId, platform, postId, newRevision));
  }
  return statements;
}

/** Frees the plan slot a deleted or cancelled post was filling. */
export function unlinkPlanStatement(db: D1Database, postId: string, newRevision: number): D1PreparedStatement {
  return db.prepare(`UPDATE social_plans SET post_id = NULL WHERE post_id = ? AND ${POST_PROOF}`).bind(postId, postId, newRevision);
}
```

- [ ] **Step 5b: Note on deletion.** A deleted post has no row left to prove a revision against. Task 6 therefore deletes with a guarded `DELETE ... WHERE id = ? AND revision = ?`, a proof of `NOT EXISTS (SELECT 1 FROM social_posts WHERE id = ?)`, and the plan unlink as `UPDATE social_plans SET post_id = NULL WHERE post_id = ? AND NOT EXISTS (SELECT 1 FROM social_posts WHERE id = ?)`. Nothing to write in this task.

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test tests/social-posts.test.ts tests/upload-image-social.test.ts tests/schema.test.ts tests/image-key.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql functions/api/blog-submissions/upload-image.ts functions/_lib/social-posts.ts functions/_lib/social-events.ts tests/social-posts.test.ts tests/upload-image-social.test.ts
git commit -m "Social content tables, server-measured image sizes, and the post rules"
```

---

### Task 4: Notifications

**Files:**
- Create: `functions/_lib/social-notify.ts`
- Create: `tests/lib/social.ts` (shared fixture, used by Tasks 4-9)
- Test: `tests/social-notify.test.ts`

**Interfaces:**
- Consumes:
  - `buildMime(msg: MimeMessage): string` and `sendMail(env, raw): Promise<SentMessage>` from `functions/_lib/gmail.ts`
  - `renderBody(markdown): { text, html }` from `functions/_lib/markdown.ts`
  - `Env.RSG_MAIL_FROM`
- Produces:
  - `sendSystemEmail(env: Env, msg: { to: string; subject: string; text: string }): Promise<boolean>`: never throws.
  - `type NotifyKind = 'submitted' | 'approved' | 'rejected' | 'plan_due'`
  - `notificationText(kind: NotifyKind, ctx: { label: string; when: number | null; actor?: string; note?: string; panelUrl: string }): { subject: string; text: string }`
  - `publisherEmails(db: D1Database): Promise<string[]>`
  - `notifyEach(env: Env, emails: string[], message: { subject: string; text: string }): Promise<number>`: deduplicates and returns the count sent.
  - `postLabel(caption: string, planTitle: string | null): string`
- Fixture (`tests/lib/social.ts`):
  - `setupSocial(): { db, env, waits }`. The users are `admin` (`is_admin`), `pub` (`is_social_publisher` and `is_social`), `ed` and `ed2` (`is_social`) and `mem` (`is_member`), with sessions `s-<id>`.
  - `call(handler, method, path, opts?: { as?: string; body?: unknown; params?: Record<string,string> }): Promise<Response>`
  - `stubMail(): { sent: { to: string; subject: string }[]; restore(): void; fail(): void }`
  - `addMedia(db, key, w, h)`
  - `settle(waits)`
  - `KEYS: { feed: string; story: string; square: string }`

- [ ] **Step 1: Fixture** `tests/lib/social.ts`

```ts
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './d1-sqlite';
import { resetAccessToken } from '../../functions/_lib/gmail';

const SCHEMA = readFileSync(new URL('../../db/schema.sql', import.meta.url).pathname, 'utf8');
export const BASE = 'https://rsg-turkiye.iscbsc.org';
export const KEYS = {
  feed: '11111111-1111-4111-8111-111111111111.jpg',
  story: '22222222-2222-4222-8222-222222222222.jpg',
  square: '33333333-3333-4333-8333-333333333333.jpg',
};

export function addMedia(db: DatabaseSync, key: string, width: number, height: number): void {
  db.prepare(`INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'image/jpeg', 1, 'ed', 1)`).run(key, width, height);
}

export function setupSocial() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const users: [string, string, string][] = [
    ['admin', 'admin@example.org', 'is_admin'],
    ['pub', 'pub@example.org', 'is_social_publisher'],
    ['ed', 'ed@example.org', 'is_social'],
    ['ed2', 'ed2@example.org', 'is_social'],
    ['mem', 'mem@example.org', 'is_member'],
  ];
  for (const [id, email, role] of users) {
    db.prepare(`INSERT INTO users (id, google_id, email, ${role}, created_at, last_login) VALUES (?, ?, ?, 1, 1, 1)`).run(id, `g-${id}`, email);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  db.prepare(`UPDATE users SET is_social = 1 WHERE id = 'pub'`).run();
  addMedia(db, KEYS.feed, 1080, 1350);
  addMedia(db, KEYS.story, 1080, 1920);
  addMedia(db, KEYS.square, 1080, 1080);
  const waits: Promise<unknown>[] = [];
  const env = {
    DB: d1(db), RSG_MAIL_FROM: 'turkey.rsg@gmail.com', GMAIL_REFRESH_TOKEN: 'r', GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's',
    PUBLIC_BLOG_IMAGES_URL: `${BASE}/api/images`, SYMPOSIUM_ARCHIVE_SECRET: 'cron-secret',
  };
  return { db, env: env as never, waits };
}

export async function call(
  handler: unknown, method: string, path: string,
  opts: { as?: string; body?: unknown; params?: Record<string, string>; waits?: Promise<unknown>[]; env: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.as) headers.Cookie = `rsg_session=s-${opts.as}`;
  const request = new Request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const waits = opts.waits ?? [];
  return (handler as (c: unknown) => Promise<Response>)({
    request, env: opts.env, params: opts.params ?? {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
}

export async function settle(waits: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(waits);
}

/** Stubs Google: token refresh succeeds, each send is recorded with its To and Subject. */
export function stubMail() {
  resetAccessToken();
  const sent: { to: string; subject: string }[] = [];
  let failing = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    if (failing) return new Response('down', { status: 500 });
    const { raw } = JSON.parse(String(init?.body)) as { raw: string };
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const to = /^To: (.+)$/m.exec(mime)?.[1].trim() ?? '';
    const subjectRaw = /^Subject: (.+)$/m.exec(mime)?.[1].trim() ?? '';
    const enc = /^=\?UTF-8\?B\?(.+)\?=$/.exec(subjectRaw);
    sent.push({ to, subject: enc ? Buffer.from(enc[1], 'base64').toString('utf8') : subjectRaw });
    return new Response(JSON.stringify({ id: 'm', threadId: 't' }), { status: 200 });
  }) as typeof fetch;
  return { sent, fail: () => { failing = true; }, restore: () => { globalThis.fetch = original; resetAccessToken(); } };
}
```

- [ ] **Step 2: Failing test** `tests/social-notify.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { sendSystemEmail, notificationText, publisherEmails, notifyEach, postLabel } from '../functions/_lib/social-notify';

test('publishers are admins and social publishers, nobody else', async () => {
  const { env } = setupSocial();
  assert.deepEqual((await publisherEmails((env as { DB: D1Database }).DB)).sort(), ['admin@example.org', 'pub@example.org']);
});

test('a system email goes out from the RSG address', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  try {
    assert.equal(await sendSystemEmail(env, { to: 'ed@example.org', subject: 'Deneme', text: 'Merhaba' }), true);
    assert.deepEqual(mail.sent, [{ to: 'ed@example.org', subject: 'Deneme' }]);
  } finally { mail.restore(); }
});

test('a failing Gmail is reported as false, never thrown', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  mail.fail();
  try {
    assert.equal(await sendSystemEmail(env, { to: 'ed@example.org', subject: 'x', text: 'y' }), false);
  } finally { mail.restore(); }
});

test('notifyEach skips duplicates and blanks and counts what went', async () => {
  const { env } = setupSocial();
  const mail = stubMail();
  try {
    assert.equal(await notifyEach(env, ['a@example.org', 'a@example.org', '', 'b@example.org'], { subject: 's', text: 't' }), 2);
    assert.equal(mail.sent.length, 2);
  } finally { mail.restore(); }
});

test('every kind of message is bilingual and names the post', () => {
  for (const kind of ['submitted', 'approved', 'rejected', 'plan_due'] as const) {
    const m = notificationText(kind, { label: 'Konuşmacı 3', when: 1_800_000_000, actor: 'Ayşe', note: 'Görseli değiştir', panelUrl: 'https://rsg-turkiye.iscbsc.org/admin' });
    assert.match(m.subject, /Konuşmacı 3/, kind);
    assert.match(m.text, /https:\/\/rsg-turkiye\.iscbsc\.org\/admin/, kind);
    assert.match(m.text, /\n---\n/, `${kind} has a Turkish and an English half`);
  }
  assert.match(notificationText('rejected', { label: 'x', when: null, note: 'Görseli değiştir', panelUrl: 'u' }).text, /Görseli değiştir/);
});

test('postLabel prefers the plan title, then the caption start', () => {
  assert.equal(postLabel('uzun bir metin', 'Plan adı'), 'Plan adı');
  assert.equal(postLabel('a'.repeat(80), null), `${'a'.repeat(60)}…`);
  assert.equal(postLabel('  ', null), '(başlıksız / untitled)');
});
```

- [ ] **Step 3: Run, confirm failure**

Run: `node --import tsx --test tests/social-notify.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement** `functions/_lib/social-notify.ts`

```ts
/**
 * Mail the panel sends on its own: approval requests, decisions, and plans
 * still waiting for content. Built like notifyThreadOwner in conversations.ts
 * -- buildMime + sendMail, never sendAndLog -- so machine mail does not bury
 * members' own sends in sent_emails. Nothing here throws: a notification that
 * cannot go out must never fail the action that triggered it. When Gmail
 * itself is broken, the admin panel's banner already says notifications are
 * paused.
 */
import type { Env } from './auth';
import { buildMime, sendMail } from './gmail';
import { renderBody } from './markdown';

export async function sendSystemEmail(env: Env, msg: { to: string; subject: string; text: string }): Promise<boolean> {
  try {
    const raw = buildMime({
      fromAddress: env.RSG_MAIL_FROM, fromName: 'RSG-Türkiye', to: msg.to, replyTo: env.RSG_MAIL_FROM,
      subject: msg.subject, body: renderBody(msg.text), attachments: [],
    });
    await sendMail(env, raw);
    return true;
  } catch (err) {
    console.error('social notification failed', err);
    return false;
  }
}

export async function notifyEach(env: Env, emails: string[], message: { subject: string; text: string }): Promise<number> {
  let sent = 0;
  for (const to of new Set(emails.map((e) => e.trim()).filter(Boolean))) {
    if (await sendSystemEmail(env, { to, ...message })) sent++;
  }
  return sent;
}

export async function publisherEmails(db: D1Database): Promise<string[]> {
  return (await db.prepare('SELECT email FROM users WHERE is_admin = 1 OR is_social_publisher = 1').all<{ email: string }>())
    .results.map((r) => r.email);
}

export function postLabel(caption: string, planTitle: string | null): string {
  if (planTitle && planTitle.trim()) return planTitle.trim();
  const text = caption.trim().replace(/\s+/g, ' ');
  if (!text) return '(başlıksız / untitled)';
  const chars = [...text];
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : text;
}

const when = (epoch: number | null, locale: 'tr-TR' | 'en-GB') =>
  epoch === null ? '' : new Date(epoch * 1000).toLocaleString(locale, {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });

export type NotifyKind = 'submitted' | 'approved' | 'rejected' | 'plan_due';

/** Turkish first, then English, in one message: the reader's language is not known. */
export function notificationText(
  kind: NotifyKind,
  ctx: { label: string; when: number | null; actor?: string; note?: string; panelUrl: string },
): { subject: string; text: string } {
  const tr = when(ctx.when, 'tr-TR');
  const en = when(ctx.when, 'en-GB');
  const who = ctx.actor ?? '';
  const note = ctx.note ? `\n\n> ${ctx.note}` : '';
  switch (kind) {
    case 'submitted':
      return {
        subject: `Onay bekleyen gönderi / Post awaiting approval: ${ctx.label}`,
        text: `${who} bir gönderiyi onaya gönderdi: **${ctx.label}** (${tr}).\n\nPanelden onaylayabilir ya da geri çevirebilirsin: ${ctx.panelUrl}\n\n---\n\n${who} submitted a post for approval: **${ctx.label}** (${en}).\n\nApprove or send it back in the panel: ${ctx.panelUrl}`,
      };
    case 'approved':
      return {
        subject: `Gönderin onaylandı / Your post was approved: ${ctx.label}`,
        text: `**${ctx.label}** onaylandı ve ${tr} için zamanlandı.\n\n${ctx.panelUrl}\n\n---\n\n**${ctx.label}** was approved and scheduled for ${en}.\n\n${ctx.panelUrl}`,
      };
    case 'rejected':
      return {
        subject: `Gönderin geri çevrildi / Your post was sent back: ${ctx.label}`,
        text: `**${ctx.label}** onaylanmadı. Not:${note}\n\nDüzenleyip yeniden gönderebilirsin: ${ctx.panelUrl}\n\n---\n\n**${ctx.label}** was not approved. Note:${note}\n\nEdit it and submit again: ${ctx.panelUrl}`,
      };
    case 'plan_due':
      return {
        subject: `İçeriği bekleyen plan / Plan waiting for content: ${ctx.label}`,
        text: `${tr} tarihindeki **${ctx.label}** planına henüz içerik yüklenmedi.\n\n${ctx.panelUrl}\n\n---\n\nThe plan **${ctx.label}** for ${en} has no content yet.\n\n${ctx.panelUrl}`,
      };
  }
}
```

- [ ] **Step 5: Run** `node --import tsx --test tests/social-notify.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/social-notify.ts tests/lib/social.ts tests/social-notify.test.ts
git commit -m "Social notifications: bilingual system mail that never fails the action"
```

---

### Task 5: Plans API and the editors list

**Files:**
- Create: `functions/_lib/social-api.ts`, `functions/_lib/social-plans.ts`
- Create: `functions/api/social/editors.ts`, `functions/api/social/plans/index.ts`, `functions/api/social/plans/[id].ts`
- Test: `tests/social-plans-api.test.ts`

**Interfaces:**
- Consumes:
  - `canSocialEdit`, `canSocialPublish`, `getSessionUser`, `jsonResponse` and `checkCsrf` from auth
  - `runWithAudit`, `runGuardedWithAudit` (Task 1)
  - `ENABLED_PLATFORMS`, `POST_TYPES` (Task 2)
  - `validateScheduledAt`
  - `Actor` (Task 3)
  - the fixture (Task 4)
- Produces:
  - `socialGate(request, env, need: 'edit' | 'publish', mutating: boolean): Promise<{ ok: true; user: User; actor: Actor } | { ok: false; response: Response }>`
  - `readBody(request): Promise<Record<string, unknown> | null>`
  - `malformed(): Response`
  - `nowSeconds(): number`
  - `intParam(v: string | null): number | null`
  - `rangeParams(url: URL): { from: number; to: number } | null` (at most 62 days)
  - `parsePlanInput(body, partial: boolean, now: number, isEditorId: (id: string) => Promise<boolean>): Promise<Parsed<PlanInput>>`
  - `isSocialEditor(db: D1Database, id: string): Promise<boolean>` (in `social-plans.ts`)
  - `interface PlanInput { title?: string; scheduledAt?: number; platforms?: SocialPlatform[]; postType?: PostType; assigneeId?: string | null; note?: string }`
  - **`GET /api/social/editors`** returns `{ editors: { id, email, name, isPublisher }[] }`
  - **`GET /api/social/plans?from&to`** returns `{ plans: PlanResponse[] }`. Each plan is `{ id, title, scheduledAt, platforms, postType, assigneeId, assigneeEmail, note, postId, postStatus, createdBy, createdAt }`.
  - **`POST /api/social/plans`** returns 201 `{ id }`
  - **`PATCH /api/social/plans/:id`** returns `{ ok: true }`
  - **`DELETE /api/social/plans/:id`** returns `{ ok: true }`, 409 `plan_has_post`, or 404.

- [ ] **Step 1: Failing test** `tests/social-plans-api.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import * as plans from '../functions/api/social/plans/index';
import * as plan from '../functions/api/social/plans/[id]';
import * as editors from '../functions/api/social/editors';

const NOW = Math.floor(Date.now() / 1000);
const valid = { title: 'Konuşmacı 3 tanıtımı', scheduledAt: NOW + 86400, platforms: ['instagram', 'linkedin'], postType: 'carousel', assigneeId: 'ed', note: '' };

test('an editor creates a plan; it lists in range with the assignee; the change is audited', async () => {
  const { env, db } = setupSocial();
  const res = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid });
  assert.equal(res.status, 201);
  const { id } = await res.json() as { id: string };
  const list = await (await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 2 * 86400}`, { env, as: 'ed2' })).json() as { plans: { id: string; assigneeEmail: string; platforms: string[]; postStatus: string | null }[] };
  assert.deepEqual(list.plans.map((p) => [p.id, p.assigneeEmail, p.platforms, p.postStatus]), [[id, 'ed@example.org', ['instagram', 'linkedin'], null]]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.plan.create'`).get() as { n: number }).n, 1);
});

test('bad plans are refused with a code', async () => {
  const { env } = setupSocial();
  const cases: [Record<string, unknown>, string][] = [
    [{ ...valid, title: '' }, 'invalid_title'],
    [{ ...valid, title: 'x'.repeat(121) }, 'invalid_title'],
    [{ ...valid, scheduledAt: NOW - 10 }, 'schedule_in_past'],
    [{ ...valid, platforms: [] }, 'invalid_platforms'],
    [{ ...valid, platforms: ['x'] }, 'invalid_platforms'],
    [{ ...valid, postType: 'reel' }, 'invalid_post_type'],
    [{ ...valid, assigneeId: 'mem' }, 'invalid_assignee'],
    [{ ...valid, note: 'n'.repeat(501) }, 'invalid_note'],
  ];
  for (const [body, code] of cases) {
    const res = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body });
    assert.equal(res.status, 400, code);
    assert.equal((await res.json() as { code: string }).code, code);
  }
});

test('a member without a social role gets 403; nobody signed in gets 401', async () => {
  const { env } = setupSocial();
  assert.equal((await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'mem', body: valid })).status, 403);
  assert.equal((await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 10}`, { env })).status, 401);
});

test('the list needs a sane range', async () => {
  const { env } = setupSocial();
  assert.equal((await call(plans.onRequestGet, 'GET', '/api/social/plans', { env, as: 'ed' })).status, 400);
  assert.equal((await call(plans.onRequestGet, 'GET', `/api/social/plans?from=${NOW}&to=${NOW + 63 * 86400}`, { env, as: 'ed' })).status, 400);
});

test('editing a plan keeps unspecified fields, resets the reminder when the date moves, and logs before and after', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid })).json() as { id: string };
  db.prepare('UPDATE social_plans SET reminded_at = 5 WHERE id = ?').run(id);
  const res = await call(plan.onRequestPatch, 'PATCH', `/api/social/plans/${id}`, { env, as: 'ed2', params: { id }, body: { scheduledAt: NOW + 2 * 86400 } });
  assert.equal(res.status, 200);
  const row = db.prepare('SELECT title, scheduled_at, reminded_at FROM social_plans WHERE id = ?').get(id) as { title: string; scheduled_at: number; reminded_at: number | null };
  assert.deepEqual([row.title, row.scheduled_at, row.reminded_at], [valid.title, NOW + 2 * 86400, null]);
  const audit = db.prepare(`SELECT details FROM audit_log WHERE action = 'social.plan.update'`).get() as { details: string };
  assert.deepEqual(JSON.parse(audit.details).changed, { scheduledAt: { from: valid.scheduledAt, to: NOW + 2 * 86400 } });
});

test('a plan with a post attached cannot be deleted; an empty one can', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: valid })).json() as { id: string };
  db.prepare(`UPDATE social_plans SET post_id = 'p1' WHERE id = ?`).run(id);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 409);
  db.prepare(`UPDATE social_plans SET post_id = NULL WHERE id = ?`).run(id);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 200);
  assert.equal(db.prepare('SELECT 1 FROM social_plans WHERE id = ?').get(id), undefined);
  assert.equal((await call(plan.onRequestDelete, 'DELETE', `/api/social/plans/${id}`, { env, as: 'ed', params: { id } })).status, 404);
});

test('the editors list holds exactly the people who can be assigned', async () => {
  const { env } = setupSocial();
  const { editors: list } = await (await call(editors.onRequestGet, 'GET', '/api/social/editors', { env, as: 'ed' })).json() as { editors: { id: string; isPublisher: boolean }[] };
  assert.deepEqual(list.map((e) => [e.id, e.isPublisher]).sort(), [['admin', true], ['ed', false], ['ed2', false], ['pub', true]]);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-plans-api.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/social-api.ts`**

```ts
/** The few things every /api/social handler does first. */
import type { Env, User } from './auth';
import { getSessionUser, jsonResponse, checkCsrf, canSocialEdit, canSocialPublish } from './auth';
import type { Actor } from './social-posts';

export type Gate = { ok: true; user: User; actor: Actor } | { ok: false; response: Response };

export async function socialGate(request: Request, env: Env, need: 'edit' | 'publish', mutating: boolean): Promise<Gate> {
  if (mutating && !checkCsrf(request)) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { ok: false, response: jsonResponse({ error: 'Not authenticated' }, 401) };
  const allowed = need === 'publish' ? canSocialPublish(user) : canSocialEdit(user);
  if (!allowed) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  return { ok: true, user, actor: { id: user.id, isPublisher: canSocialPublish(user) } };
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await request.json();
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const malformed = () => jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const intParam = (v: string | null): number | null => (v !== null && /^\d{1,12}$/.test(v) ? Number(v) : null);

const MAX_RANGE_SECONDS = 62 * 86400;

/** A calendar window: both ends, in order, at most 62 days apart. */
export function rangeParams(url: URL): { from: number; to: number } | null {
  const from = intParam(url.searchParams.get('from'));
  const to = intParam(url.searchParams.get('to'));
  if (from === null || to === null || to < from || to - from > MAX_RANGE_SECONDS) return null;
  return { from, to };
}
```

- [ ] **Step 4: `functions/_lib/social-plans.ts`**

```ts
import { ENABLED_PLATFORMS, POST_TYPES, type PostType, type SocialPlatform } from './social-limits';
import { validateScheduledAt } from './schedule';
import type { Parsed } from './social-posts';

/** Admins and both social roles: the people a plan or an event window can name. */
export async function isSocialEditor(db: D1Database, id: string): Promise<boolean> {
  return Boolean(await db.prepare(
    'SELECT 1 FROM users WHERE id = ? AND (is_admin = 1 OR is_social = 1 OR is_social_publisher = 1)',
  ).bind(id).first());
}

export interface PlanInput {
  title?: string;
  scheduledAt?: number;
  platforms?: SocialPlatform[];
  postType?: PostType;
  assigneeId?: string | null;
  note?: string;
}

const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });

/** `partial` for PATCH: absent fields stay absent. A plan's date must still be in the future. */
export async function parsePlanInput(
  body: Record<string, unknown>, partial: boolean, now: number, isEditorId: (id: string) => Promise<boolean>,
): Promise<Parsed<PlanInput>> {
  const out: PlanInput = {};
  const has = (k: string) => Object.hasOwn(body, k);

  if (has('title') || !partial) {
    const t = body.title;
    if (typeof t !== 'string' || t.trim().length < 1 || t.trim().length > 120) return fail('invalid_title');
    out.title = t.trim();
  }
  if (has('scheduledAt') || !partial) {
    const v = validateScheduledAt(body.scheduledAt, now);
    if (!v.ok) return fail(v.code);
    out.scheduledAt = v.scheduledAt;
  }
  if (has('platforms') || !partial) {
    const p = body.platforms;
    if (!Array.isArray(p) || p.length === 0 || new Set(p).size !== p.length
      || !p.every((x) => typeof x === 'string' && (ENABLED_PLATFORMS as string[]).includes(x))) return fail('invalid_platforms');
    out.platforms = p as SocialPlatform[];
  }
  if (has('postType') || !partial) {
    const t = body.postType ?? 'image';
    if (typeof t !== 'string' || !(POST_TYPES as string[]).includes(t)) return fail('invalid_post_type');
    out.postType = t as PostType;
  }
  if (has('assigneeId')) {
    const a = body.assigneeId;
    if (a === null || a === '') out.assigneeId = null;
    else if (typeof a !== 'string' || !(await isEditorId(a))) return fail('invalid_assignee');
    else out.assigneeId = a;
  }
  if (has('note')) {
    const n = body.note ?? '';
    if (typeof n !== 'string' || n.length > 500) return fail('invalid_note');
    out.note = n;
  }
  return { ok: true, value: out };
}
```

- [ ] **Step 5: `functions/api/social/editors.ts`**

```ts
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { socialGate } from '../../_lib/social-api';

/** Everyone who can be given a plan or included in an event window. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const rows = (await env.DB.prepare(
    `SELECT u.id, u.email, p.display_name AS name, (u.is_admin = 1 OR u.is_social_publisher = 1) AS is_publisher
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id
      WHERE u.is_admin = 1 OR u.is_social = 1 OR u.is_social_publisher = 1
      ORDER BY u.email`,
  ).all<{ id: string; email: string; name: string | null; is_publisher: number }>()).results;
  return jsonResponse({ editors: rows.map((r) => ({ id: r.id, email: r.email, name: r.name, isPublisher: r.is_publisher === 1 })) });
};
```

- [ ] **Step 6: `functions/api/social/plans/index.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds, rangeParams } from '../../../_lib/social-api';
import { parsePlanInput, isSocialEditor } from '../../../_lib/social-plans';
import { runWithAudit } from '../../../_lib/audit';

type PlanRow = {
  id: string; title: string; scheduled_at: number; platforms: string; post_type: string; assignee_id: string | null;
  assignee_email: string | null; note: string; post_id: string | null; post_status: string | null; created_by: string; created_at: number;
};

function planResponse(r: PlanRow) {
  let platforms: string[] = [];
  try { platforms = JSON.parse(r.platforms); } catch { platforms = []; }
  return {
    id: r.id, title: r.title, scheduledAt: r.scheduled_at, platforms, postType: r.post_type,
    assigneeId: r.assignee_id, assigneeEmail: r.assignee_email, note: r.note, postId: r.post_id, postStatus: r.post_status,
    createdBy: r.created_by, createdAt: r.created_at,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const range = rangeParams(new URL(request.url));
  if (!range) return jsonResponse({ error: 'from and to are required, at most 62 days apart', code: 'invalid_range' }, 400);
  const rows = (await env.DB.prepare(
    `SELECT pl.*, u.email AS assignee_email, p.status AS post_status
       FROM social_plans pl
       LEFT JOIN users u ON u.id = pl.assignee_id
       LEFT JOIN social_posts p ON p.id = pl.post_id
      WHERE pl.scheduled_at BETWEEN ? AND ?
      ORDER BY pl.scheduled_at`,
  ).bind(range.from, range.to).all<PlanRow>()).results;
  return jsonResponse({ plans: rows.map(planResponse) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const parsed = await parsePlanInput(body, false, now, (id) => isSocialEditor(env.DB, id));
  if (!parsed.ok) return jsonResponse({ error: 'Invalid plan', code: parsed.code }, 400);
  const p = parsed.value;
  const id = generateId();
  await runWithAudit(env.DB, [
    env.DB.prepare(
      `INSERT INTO social_plans (id, title, scheduled_at, platforms, post_type, assignee_id, note, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, p.title, p.scheduledAt, JSON.stringify(p.platforms), p.postType, p.assigneeId ?? null, p.note ?? '', gate.user.id, now, now),
  ], { userId: gate.user.id, action: 'social.plan.create', targetType: 'social_plan', targetId: id, details: p }, now);
  return jsonResponse({ id }, 201);
};
```

- [ ] **Step 7: `functions/api/social/plans/[id].ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import { parsePlanInput, isSocialEditor, type PlanInput } from '../../../_lib/social-plans';
import { runWithAudit, runGuardedWithAudit } from '../../../_lib/audit';

type Row = { id: string; title: string; scheduled_at: number; platforms: string; post_type: string; assignee_id: string | null; note: string; post_id: string | null };

const COLUMN: Record<keyof PlanInput, string> = {
  title: 'title', scheduledAt: 'scheduled_at', platforms: 'platforms', postType: 'post_type', assigneeId: 'assignee_id', note: 'note',
};

function current(row: Row): Required<PlanInput> {
  let platforms: PlanInput['platforms'] = [];
  try { platforms = JSON.parse(row.platforms); } catch { platforms = []; }
  return {
    title: row.title, scheduledAt: row.scheduled_at, platforms: platforms ?? [], postType: row.post_type as Required<PlanInput>['postType'],
    assigneeId: row.assignee_id, note: row.note,
  };
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT * FROM social_plans WHERE id = ?').bind(id).first<Row>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const parsed = await parsePlanInput(body, true, now, (uid) => isSocialEditor(env.DB, uid));
  if (!parsed.ok) return jsonResponse({ error: 'Invalid plan', code: parsed.code }, 400);

  const before = current(row);
  const changed: Record<string, { from: unknown; to: unknown }> = {};
  const sets: string[] = [];
  const binds: unknown[] = [];
  for (const key of Object.keys(parsed.value) as (keyof PlanInput)[]) {
    const to = parsed.value[key];
    if (JSON.stringify(to) === JSON.stringify(before[key])) continue;
    changed[key] = { from: before[key], to };
    sets.push(`${COLUMN[key]} = ?`);
    binds.push(key === 'platforms' ? JSON.stringify(to) : to ?? null);
  }
  if (sets.length === 0) return jsonResponse({ ok: true });
  // A new date deserves a new reminder.
  if (Object.hasOwn(changed, 'scheduledAt')) sets.push('reminded_at = NULL');

  await runWithAudit(env.DB, [
    env.DB.prepare(`UPDATE social_plans SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).bind(...binds, now, id),
  ], { userId: gate.user.id, action: 'social.plan.update', targetType: 'social_plan', targetId: id, details: { changed } }, now);
  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT * FROM social_plans WHERE id = ?').bind(id).first<Row>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);
  if (row.post_id) return jsonResponse({ error: 'This plan already has a post', code: 'plan_has_post' }, 409);
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('DELETE FROM social_plans WHERE id = ? AND post_id IS NULL').bind(id),
    { condition: 'NOT EXISTS (SELECT 1 FROM social_plans WHERE id = ?)', binds: [id] },
    [],
    { userId: gate.user.id, action: 'social.plan.delete', targetType: 'social_plan', targetId: id, details: { title: row.title, scheduledAt: row.scheduled_at } },
  );
  if (!done) return jsonResponse({ error: 'This plan already has a post', code: 'plan_has_post' }, 409);
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 8: Run the tests**

Run: `node --import tsx --test tests/social-plans-api.test.ts tests/routes.test.ts tests/route-parity.test.ts tests/functions-hygiene.test.ts tests/api-input.test.ts`
Expected: PASS. If a route-list test fails on the new routes, add them to its list as the message says.

- [ ] **Step 9: Commit**

```bash
git add functions/_lib/social-api.ts functions/_lib/social-plans.ts functions/api/social tests/social-plans-api.test.ts
git commit -m "Social plans API: calendar slots with assignees, audited"
```

---

### Task 6: Posts API (list, get, create, edit, delete)

**Files:**
- Create: `functions/_lib/social-post-read.ts`, `functions/api/social/posts/index.ts`, `functions/api/social/posts/[id].ts`
- Test: `tests/social-posts-api.test.ts`

**Interfaces:**
- Consumes: Tasks 1-5.
- Produces:
  - **`loadPosts(db, env, where: string, binds: unknown[]): Promise<PostResponse[]>`** and **`loadPost(db, env, id): Promise<{ row: PostRow; response: PostResponse } | null>`**.
    - `PostResponse = { id, type, caption, captionOverrides, link, media: { key, alt, url }[], platforms, scheduledAt, status, revision, createdBy, authorEmail, approvedBy, approvedAt, reviewNote, planId, planTitle, eventModeId, createdAt, updatedAt, targets: { platform, status, permalink, lastError }[] }`
  - **`GET /api/social/posts?from&to`** returns posts scheduled in the range. `?status=pending_approval` returns all pending posts. `?drafts=1` returns undated drafts: your own, or everyone's for a publisher.
  - **`POST /api/social/posts`** takes a draft body plus an optional `planId`, and returns 201 `{ id, revision }`.
    - If a `planId` is given, the plan's empty date, platforms and type are copied into the draft, and the plan is linked.
    - 409 `plan_taken` if the plan already has a post.
  - **`GET /api/social/posts/:id`** returns `PostResponse`.
  - **`PATCH /api/social/posts/:id`** takes `{ ...draft, revision }` and returns `{ ok: true, revision, status }`.
    - 409 `post_changed` on a stale revision; 403 when the actor may not edit the post.
    - 422 `{ code: 'not_ready', problems }` when the edit would leave a scheduled post not ready.
  - **`DELETE /api/social/posts/:id`** takes `{ revision }`, deletes only drafts and rejected posts, and unlinks the plan.

- [ ] **Step 1: Failing test** `tests/social-posts-api.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, KEYS } from './lib/social';
import * as posts from '../functions/api/social/posts/index';
import * as post from '../functions/api/social/posts/[id]';
import * as plans from '../functions/api/social/plans/index';

const NOW = Math.floor(Date.now() / 1000);
const draft = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: NOW + 3600 };

async function create(env: unknown, as: string, body: Record<string, unknown> = draft) {
  const res = await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, as, body });
  return { res, json: await res.json() as { id: string; revision: number } };
}

test('an editor creates a draft; GET shows it with image URLs and the author', async () => {
  const { env } = setupSocial();
  const { res, json } = await create(env, 'ed');
  assert.equal(res.status, 201);
  assert.equal(json.revision, 0);
  const got = await (await call(post.onRequestGet, 'GET', `/api/social/posts/${json.id}`, { env, as: 'ed2', params: { id: json.id } })).json() as { status: string; authorEmail: string; media: { url: string }[] };
  assert.equal(got.status, 'draft');
  assert.equal(got.authorEmail, 'ed@example.org');
  assert.equal(got.media[0].url, `https://rsg-turkiye.iscbsc.org/api/images/${KEYS.feed}`);
});

test('creating from a plan copies its slot and links it; a taken plan refuses a second post', async () => {
  const { env, db } = setupSocial();
  const planRes = await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: { title: 'P', scheduledAt: NOW + 7200, platforms: ['linkedin'], postType: 'carousel' } });
  const { id: planId } = await planRes.json() as { id: string };
  const { json } = await create(env, 'ed', { type: 'carousel', planId });
  const row = db.prepare('SELECT scheduled_at, platforms FROM social_posts WHERE id = ?').get(json.id) as { scheduled_at: number; platforms: string };
  assert.deepEqual([row.scheduled_at, JSON.parse(row.platforms)], [NOW + 7200, ['linkedin']]);
  assert.equal((db.prepare('SELECT post_id FROM social_plans WHERE id = ?').get(planId) as { post_id: string }).post_id, json.id);
  const second = await create(env, 'ed2', { type: 'image', planId });
  assert.equal(second.res.status, 409);
  assert.equal((second.json as unknown as { code: string }).code, 'plan_taken');
});

test('a stale revision is refused and changes nothing', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  const ok = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'İkinci', revision: 0 } });
  assert.equal(ok.status, 200);
  const stale = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Üçüncü', revision: 0 } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as { code: string }).code, 'post_changed');
  assert.equal((db.prepare('SELECT caption FROM social_posts').get() as { caption: string }).caption, 'İkinci');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.post.update'`).get() as { n: number }).n, 1);
});

test('another editor cannot edit my draft; a publisher can', async () => {
  const { env } = setupSocial();
  const { json } = await create(env, 'ed');
  assert.equal((await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed2', params: { id: json.id }, body: { ...draft, revision: 0 } })).status, 403);
  assert.equal((await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, revision: 0 } })).status, 200);
});

test('an editor editing a scheduled post sends it back for approval and removes its targets', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled', revision = 3 WHERE id = ?`).run(json.id);
  db.prepare(`INSERT INTO social_post_targets (post_id, platform) VALUES (?, 'instagram')`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { ...draft, caption: 'Değişti', revision: 3 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 4, status: 'pending_approval' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 0);
});

test('a publisher editing a scheduled post keeps it scheduled and rebuilds targets, if still ready', async () => {
  const { env, db } = setupSocial();
  const { json } = await create(env, 'ed');
  db.prepare(`UPDATE social_posts SET status = 'scheduled' WHERE id = ?`).run(json.id);
  const res = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, platforms: ['instagram', 'linkedin'], revision: 0 } });
  assert.deepEqual(await res.json(), { ok: true, revision: 1, status: 'scheduled' });
  assert.deepEqual((db.prepare('SELECT platform FROM social_post_targets ORDER BY platform').all() as { platform: string }[]).map((r) => r.platform), ['instagram', 'linkedin']);
  const broken = await call(post.onRequestPatch, 'PATCH', `/api/social/posts/${json.id}`, { env, as: 'pub', params: { id: json.id }, body: { ...draft, media: [{ key: KEYS.feed, alt: '' }], revision: 1 } });
  assert.equal(broken.status, 422);
  assert.deepEqual((await broken.json() as { problems: { code: string }[] }).problems.map((p) => p.code), ['missing_alt']);
});

test('only drafts and rejected posts can be deleted, and deleting frees the plan', async () => {
  const { env, db } = setupSocial();
  const { id: planId } = await (await call(plans.onRequestPost, 'POST', '/api/social/plans', { env, as: 'ed', body: { title: 'P', scheduledAt: NOW + 7200, platforms: ['instagram'] } })).json() as { id: string };
  const { json } = await create(env, 'ed', { type: 'image', planId });
  db.prepare(`UPDATE social_posts SET status = 'pending_approval' WHERE id = ?`).run(json.id);
  assert.equal((await call(post.onRequestDelete, 'DELETE', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { revision: 0 } })).status, 409);
  db.prepare(`UPDATE social_posts SET status = 'draft' WHERE id = ?`).run(json.id);
  assert.equal((await call(post.onRequestDelete, 'DELETE', `/api/social/posts/${json.id}`, { env, as: 'ed', params: { id: json.id }, body: { revision: 0 } })).status, 200);
  assert.equal((db.prepare('SELECT post_id FROM social_plans WHERE id = ?').get(planId) as { post_id: string | null }).post_id, null);
});

test('list: a date range, pending posts, and undated drafts', async () => {
  const { env, db } = setupSocial();
  const a = (await create(env, 'ed')).json.id;
  const b = (await create(env, 'ed2', { type: 'image' })).json.id;
  db.prepare(`UPDATE social_posts SET status = 'pending_approval' WHERE id = ?`).run(a);
  const ranged = await (await call(posts.onRequestGet, 'GET', `/api/social/posts?from=${NOW}&to=${NOW + 86400}`, { env, as: 'ed' })).json() as { posts: { id: string }[] };
  assert.deepEqual(ranged.posts.map((p) => p.id), [a]);
  const pending = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?status=pending_approval', { env, as: 'pub' })).json() as { posts: { id: string }[] };
  assert.deepEqual(pending.posts.map((p) => p.id), [a]);
  const mine = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { env, as: 'ed' })).json() as { posts: { id: string }[] };
  assert.deepEqual(mine.posts.map((p) => p.id), [], 'b is ed2\'s and a has a date');
  const all = await (await call(posts.onRequestGet, 'GET', '/api/social/posts?drafts=1', { env, as: 'pub' })).json() as { posts: { id: string }[] };
  assert.deepEqual(all.posts.map((p) => p.id), [b]);
  assert.equal((await call(posts.onRequestGet, 'GET', '/api/social/posts?status=toString', { env, as: 'pub' })).status, 400);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-posts-api.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/social-post-read.ts`**

```ts
import type { Env } from './auth';
import { rowToDraft, type PostRow } from './social-posts';

type Joined = PostRow & { author_email: string | null; plan_id: string | null; plan_title: string | null };
type TargetRow = { post_id: string; platform: string; status: string; permalink: string | null; last_error: string | null };

const SELECT = `SELECT p.*, u.email AS author_email, pl.id AS plan_id, pl.title AS plan_title
                  FROM social_posts p
                  LEFT JOIN users u ON u.id = p.created_by
                  LEFT JOIN social_plans pl ON pl.post_id = p.id`;

function respond(env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, row: Joined, targets: TargetRow[]) {
  const d = rowToDraft(row);
  return {
    id: row.id, type: d.type, caption: d.caption, captionOverrides: d.captionOverrides, link: d.link,
    media: d.media.map((m) => ({ ...m, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}` })),
    platforms: d.platforms, scheduledAt: d.scheduledAt, status: row.status, revision: row.revision,
    createdBy: row.created_by, authorEmail: row.author_email, approvedBy: row.approved_by, approvedAt: row.approved_at,
    reviewNote: row.review_note, planId: row.plan_id, planTitle: row.plan_title, eventModeId: row.event_mode_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    targets: targets.filter((t) => t.post_id === row.id).map((t) => ({ platform: t.platform, status: t.status, permalink: t.permalink, lastError: t.last_error })),
  };
}
export type PostResponse = ReturnType<typeof respond>;

/** `where` is written in code; values go through binds. */
export async function loadPosts(db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, where: string, binds: unknown[]): Promise<PostResponse[]> {
  const rows = (await db.prepare(`${SELECT} WHERE ${where} ORDER BY p.scheduled_at, p.created_at`).bind(...binds).all<Joined>()).results;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const targets = (await db.prepare(
    `SELECT post_id, platform, status, permalink, last_error FROM social_post_targets WHERE post_id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all<TargetRow>()).results;
  return rows.map((r) => respond(env, r, targets));
}

export async function loadPost(db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, id: string): Promise<{ row: PostRow; response: PostResponse } | null> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Joined>();
  if (!row) return null;
  const targets = (await db.prepare('SELECT post_id, platform, status, permalink, last_error FROM social_post_targets WHERE post_id = ?').bind(id).all<TargetRow>()).results;
  return { row, response: respond(env, row, targets) };
}
```

- [ ] **Step 4: `functions/api/social/posts/index.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds, rangeParams } from '../../../_lib/social-api';
import { parseDraft, draftColumns } from '../../../_lib/social-posts';
import { loadPosts } from '../../../_lib/social-post-read';
import { runWithAudit, runGuardedWithAudit } from '../../../_lib/audit';

const LISTABLE_STATUSES = ['pending_approval', 'scheduled'];

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  if (status !== null) {
    if (!LISTABLE_STATUSES.includes(status)) return jsonResponse({ error: 'Unknown status', code: 'invalid_status' }, 400);
    return jsonResponse({ posts: await loadPosts(env.DB, env, 'p.status = ?', [status]) });
  }
  if (url.searchParams.get('drafts') === '1') {
    return gate.actor.isPublisher
      ? jsonResponse({ posts: await loadPosts(env.DB, env, `p.status = 'draft' AND p.scheduled_at IS NULL`, []) })
      : jsonResponse({ posts: await loadPosts(env.DB, env, `p.status = 'draft' AND p.scheduled_at IS NULL AND p.created_by = ?`, [gate.user.id]) });
  }
  const range = rangeParams(url);
  if (!range) return jsonResponse({ error: 'from and to are required, at most 62 days apart', code: 'invalid_range' }, 400);
  return jsonResponse({ posts: await loadPosts(env.DB, env, 'p.scheduled_at BETWEEN ? AND ?', [range.from, range.to]) });
};

type PlanSlot = { id: string; scheduled_at: number; platforms: string; post_type: string; post_id: string | null };

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const parsed = parseDraft(body);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid post', code: parsed.code }, 400);
  const d = parsed.value;
  const now = nowSeconds();
  const id = generateId();
  const planId = typeof body.planId === 'string' && body.planId ? body.planId : null;

  if (!planId) {
    const cols = draftColumns(d);
    await runWithAudit(env.DB, [insertPost(env.DB, id, cols, gate.user.id, now, '')], {
      userId: gate.user.id, action: 'social.post.create', targetType: 'social_post', targetId: id, details: { type: d.type },
    }, now);
    return jsonResponse({ id, revision: 0 }, 201);
  }

  const plan = await env.DB.prepare('SELECT id, scheduled_at, platforms, post_type, post_id FROM social_plans WHERE id = ?').bind(planId).first<PlanSlot>();
  if (!plan) return jsonResponse({ error: 'Unknown plan', code: 'invalid_plan' }, 400);
  if (plan.post_id) return jsonResponse({ error: 'This plan already has a post', code: 'plan_taken' }, 409);
  // The plan's slot fills whatever the draft left empty.
  const filled = {
    ...d,
    scheduledAt: d.scheduledAt ?? plan.scheduled_at,
    platforms: d.platforms.length ? d.platforms : (() => { try { return JSON.parse(plan.platforms); } catch { return []; } })(),
  };
  const linked = 'EXISTS (SELECT 1 FROM social_plans WHERE id = ? AND post_id = ?)';
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE social_plans SET post_id = ?, updated_at = ? WHERE id = ? AND post_id IS NULL').bind(id, now, planId),
    { condition: linked, binds: [planId, id] },
    [insertPost(env.DB, id, draftColumns(filled), gate.user.id, now, ` WHERE ${linked}`, [planId, id])],
    { userId: gate.user.id, action: 'social.post.create', targetType: 'social_post', targetId: id, details: { type: d.type, planId } },
    now,
  );
  if (!done) return jsonResponse({ error: 'This plan already has a post', code: 'plan_taken' }, 409);
  return jsonResponse({ id, revision: 0 }, 201);
};

function insertPost(
  db: D1Database, id: string, cols: Record<string, unknown>, userId: string, now: number, where: string, whereBinds: unknown[] = [],
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO social_posts (id, type, caption, caption_overrides, link, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?, ?, ?${where}`,
  ).bind(id, cols.type, cols.caption, cols.caption_overrides, cols.link, cols.media, cols.platforms, cols.scheduled_at, userId, now, now, ...whereBinds);
}
```

- [ ] **Step 5: `functions/api/social/posts/[id].ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import {
  parseDraft, draftColumns, rowToDraft, canEditPost, canDeletePost, statusAfterEdit, readinessProblems, mediaDims,
  updatePostGuarded, targetStatements, POST_PROOF,
} from '../../../_lib/social-posts';
import { coveringEvent } from '../../../_lib/social-events';
import { loadPost } from '../../../_lib/social-post-read';
import { runGuardedWithAudit } from '../../../_lib/audit';

const revisionOf = (body: Record<string, unknown>) =>
  typeof body.revision === 'number' && Number.isInteger(body.revision) && body.revision >= 0 ? body.revision : null;

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const found = await loadPost(env.DB, env, String(params.id));
  return found ? jsonResponse(found.response) : jsonResponse({ error: 'Not found' }, 404);
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const found = await loadPost(env.DB, env, id);
  if (!found) return jsonResponse({ error: 'Not found' }, 404);
  const { row } = found;
  if (!canEditPost(gate.actor, row)) return jsonResponse({ error: 'You cannot edit this post', code: 'not_allowed' }, 403);
  const body = await readBody(request);
  if (!body) return malformed();
  const revision = revisionOf(body);
  if (revision === null) return malformed();
  const parsed = parseDraft(body);
  if (!parsed.ok) return jsonResponse({ error: 'Invalid post', code: parsed.code }, 400);
  const next = parsed.value;
  const now = nowSeconds();

  const covered = next.type === 'story' && !gate.actor.isPublisher && Boolean(await coveringEvent(env.DB, gate.user.id, now));
  const status = statusAfterEdit(gate.actor, row.status, covered);
  if (status === 'scheduled') {
    const problems = readinessProblems(next, await mediaDims(env.DB, next.media.map((m) => m.key)), now);
    if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);
  }

  const before = rowToDraft(row);
  const changed = Object.fromEntries(
    (Object.keys(next) as (keyof typeof next)[])
      .filter((k) => JSON.stringify(next[k]) !== JSON.stringify(before[k]))
      .map((k) => [k, { from: before[k], to: next[k] }]),
  );
  const newRevision = revision + 1;
  const fields = { ...draftColumns(next), status };
  const targets = status === 'scheduled'
    ? targetStatements(env.DB, id, newRevision, next.platforms)
    : row.status === 'scheduled' ? targetStatements(env.DB, id, newRevision, null) : [];
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, fields, now),
    { condition: POST_PROOF, binds: [id, newRevision] },
    targets,
    { userId: gate.user.id, action: 'social.post.update', targetType: 'social_post', targetId: id, details: { changed, status: { from: row.status, to: status } } },
    now,
  );
  if (!done) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  return jsonResponse({ ok: true, revision: newRevision, status });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'edit', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const found = await loadPost(env.DB, env, id);
  if (!found) return jsonResponse({ error: 'Not found' }, 404);
  const { row } = found;
  if (!canDeletePost(gate.actor, row)) {
    return (row.created_by === gate.user.id || gate.actor.isPublisher)
      ? jsonResponse({ error: 'Only drafts and sent-back posts can be deleted', code: 'not_deletable' }, 409)
      : jsonResponse({ error: 'You cannot delete this post', code: 'not_allowed' }, 403);
  }
  const body = await readBody(request);
  const revision = body ? revisionOf(body) : null;
  if (revision === null) return malformed();
  const gone = 'NOT EXISTS (SELECT 1 FROM social_posts WHERE id = ?)';
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`DELETE FROM social_posts WHERE id = ? AND revision = ? AND status IN ('draft', 'rejected')`).bind(id, revision),
    { condition: gone, binds: [id] },
    [env.DB.prepare(`UPDATE social_plans SET post_id = NULL WHERE post_id = ? AND ${gone}`).bind(id, id)],
    { userId: gate.user.id, action: 'social.post.delete', targetType: 'social_post', targetId: id, details: { status: row.status } },
  );
  if (!done) return jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test tests/social-posts-api.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/social-post-read.ts functions/api/social/posts tests/social-posts-api.test.ts
git commit -m "Social posts API: drafts, plan slots, guarded edits"
```

---

### Task 7: Submit, approve, reject, cancel

**Files:**
- Create: `functions/api/social/posts/[id]/submit.ts`, `approve.ts`, `reject.ts`, `cancel.ts`
- Create: `functions/_lib/social-actions.ts` (shared load-and-check plus notification helpers)
- Test: `tests/social-actions-api.test.ts`

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces:
  - **`POST /api/social/posts/:id/submit`** takes `{ revision }` and returns `{ ok, revision, status: 'pending_approval' | 'scheduled' }`.
    - Allowed from `draft` or `rejected`, by the owner or a publisher.
    - 422 `not_ready` with `problems`.
    - Publishers schedule directly; an editor's story schedules directly while an event window covers them.
    - Notifies publishers when the result is pending.
  - **`POST /api/social/posts/:id/approve`** takes `{ revision }`.
    - Publisher only; only from `pending_approval`.
    - Re-checks readiness against now: 422 `not_ready` with `schedule_in_past` and similar.
    - Builds the targets and notifies the author.
  - **`POST /api/social/posts/:id/reject`** takes `{ revision, note }`.
    - Publisher only; only from `pending_approval`; the note is 1 to 500 characters.
    - Notifies the author.
  - **`POST /api/social/posts/:id/cancel`** takes `{ revision }`.
    - Allowed from `pending_approval` or `scheduled`, by the owner or a publisher.
    - Removes the targets and frees the plan.
  - All four return 409 `post_changed` on a lost race or a stale revision, write no audit row and send no mail.

- [ ] **Step 1: Failing test** `tests/social-actions-api.test.ts`

```ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, settle, stubMail, KEYS } from './lib/social';
import * as posts from '../functions/api/social/posts/index';
import * as submit from '../functions/api/social/posts/[id]/submit';
import * as approve from '../functions/api/social/posts/[id]/approve';
import * as reject from '../functions/api/social/posts/[id]/reject';
import * as cancel from '../functions/api/social/posts/[id]/cancel';

const NOW = Math.floor(Date.now() / 1000);
const draft = { type: 'image', caption: 'Merhaba', media: [{ key: KEYS.feed, alt: 'Afiş' }], platforms: ['instagram', 'linkedin'], scheduledAt: NOW + 3600 };

async function newPost(env: unknown, as = 'ed', body: Record<string, unknown> = draft) {
  return (await (await call(posts.onRequestPost, 'POST', '/api/social/posts', { env, as, body })).json() as { id: string }).id;
}
/** Notifications not awaited by a test are collected here and settled before the stub is removed. */
const pending: Promise<unknown>[] = [];
const act = (handler: unknown, path: string, env: unknown, as: string, id: string, body: Record<string, unknown>, waits: Promise<unknown>[] = pending) =>
  call(handler, 'POST', `/api/social/posts/${id}/${path}`, { env, as, params: { id }, body, waits });
const status = (db: import('node:sqlite').DatabaseSync, id: string) => (db.prepare('SELECT status, revision FROM social_posts WHERE id = ?').get(id) as { status: string; revision: number });
const targets = (db: import('node:sqlite').DatabaseSync) => (db.prepare('SELECT platform FROM social_post_targets ORDER BY platform').all() as { platform: string }[]).map((r) => r.platform);

// Every test runs with Google stubbed, so no notification ever reaches the network.
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(async () => { await settle(pending.splice(0)); mail.restore(); });

/** Creates and submits as `as`; the submit's own notification is settled and forgotten. */
async function submitted(env: unknown, as = 'ed', body: Record<string, unknown> = draft): Promise<string> {
  const id = await newPost(env, as, body);
  const waits: Promise<unknown>[] = [];
  const res = await act(submit.onRequestPost, 'submit', env, as, id, { revision: 0 }, waits);
  assert.equal(res.status, 200);
  await settle(waits);
  mail.sent.length = 0;
  return id;
}

test('an editor submits: pending, publishers are mailed, nothing queued yet', async () => {
  const { env, db, waits } = setupSocial();
  const id = await newPost(env);
  const res = await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 }, waits);
  assert.deepEqual(await res.json(), { ok: true, revision: 1, status: 'pending_approval' });
  await settle(waits);
  assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'pub@example.org']);
  assert.match(mail.sent[0].subject, /Onay bekleyen gönderi/);
  assert.deepEqual(targets(db), []);
});

test('submitting an unready post is a 422 listing what to fix', async () => {
  const { env } = setupSocial();
  const id = await newPost(env, 'ed', { ...draft, media: [{ key: KEYS.feed, alt: '' }] });
  const res = await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 });
  assert.equal(res.status, 422);
  assert.deepEqual((await res.json() as { problems: { code: string }[] }).problems.map((p) => p.code), ['missing_alt']);
});

test('a publisher submits straight to scheduled with targets', async () => {
  const { env, db } = setupSocial();
  const id = await newPost(env, 'pub');
  assert.deepEqual(await (await act(submit.onRequestPost, 'submit', env, 'pub', id, { revision: 0 })).json(), { ok: true, revision: 1, status: 'scheduled' });
  assert.deepEqual(targets(db), ['instagram', 'linkedin']);
  assert.equal((db.prepare('SELECT approved_by FROM social_posts').get() as { approved_by: string }).approved_by, 'pub');
});

test('an editor\'s story skips approval only inside an event window that names them', async () => {
  const { env, db } = setupSocial();
  const story = { type: 'story', media: [{ key: KEYS.story, alt: 'Sahne' }], platforms: ['instagram'], scheduledAt: NOW + 600 };
  const id1 = await newPost(env, 'ed', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id1, { revision: 0 })).json() as { status: string }).status, 'pending_approval');
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 60, NOW + 3600);
  const id2 = await newPost(env, 'ed', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id2, { revision: 0 })).json() as { status: string }).status, 'scheduled');
  assert.equal((db.prepare('SELECT event_mode_id FROM social_posts WHERE id = ?').get(id2) as { event_mode_id: string }).event_mode_id, 'e');
  const id3 = await newPost(env, 'ed2', story);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed2', id3, { revision: 0 })).json() as { status: string }).status, 'pending_approval', 'ed2 is not named');
  const id4 = await newPost(env, 'ed', draft);
  assert.equal((await (await act(submit.onRequestPost, 'submit', env, 'ed', id4, { revision: 0 })).json() as { status: string }).status, 'pending_approval', 'event mode covers stories only');
});

test('approve schedules, builds targets and mails the author', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  const res = await act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 }, waits);
  assert.deepEqual(await res.json(), { ok: true, revision: 2, status: 'scheduled' });
  await settle(waits);
  assert.deepEqual(targets(db), ['instagram', 'linkedin']);
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org']);
  assert.match(mail.sent[0].subject, /onaylandı/);
});

test('an editor cannot approve', async () => {
  const { env } = setupSocial();
  const id = await submitted(env);
  assert.equal((await act(approve.onRequestPost, 'approve', env, 'ed2', id, { revision: 1 })).status, 403);
});

test('approving a request whose time has passed is refused', async () => {
  const { env, db } = setupSocial();
  const id = await submitted(env);
  db.prepare('UPDATE social_posts SET scheduled_at = ? WHERE id = ?').run(NOW - 60, id);
  const res = await act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 });
  assert.equal(res.status, 422);
  assert.ok((await res.json() as { problems: { code: string }[] }).problems.some((p) => p.code === 'schedule_in_past'));
  assert.equal(status(db, id).status, 'pending_approval');
});

test('approve and reject at the same moment: one wins, the other changes nothing and mails nobody', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  const [a, r] = await Promise.all([
    act(approve.onRequestPost, 'approve', env, 'pub', id, { revision: 1 }, waits),
    act(reject.onRequestPost, 'reject', env, 'admin', id, { revision: 1, note: 'Görseli değiştir' }, waits),
  ]);
  await settle(waits);
  assert.deepEqual([a.status, r.status].sort(), [200, 409]);
  const decisions = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action IN ('social.post.approve', 'social.post.reject')`).get() as { n: number }).n;
  assert.equal(decisions, 1);
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org'], 'only the winner mails the author');
});

test('reject needs a note, stores it, and mails the author', async () => {
  const { env, db, waits } = setupSocial();
  const id = await submitted(env);
  assert.equal((await act(reject.onRequestPost, 'reject', env, 'pub', id, { revision: 1, note: '' })).status, 400);
  assert.equal((await act(reject.onRequestPost, 'reject', env, 'pub', id, { revision: 1, note: 'Görseli değiştir' }, waits)).status, 200);
  await settle(waits);
  assert.deepEqual({ ...db.prepare('SELECT status, review_note FROM social_posts').get() as object }, { status: 'rejected', review_note: 'Görseli değiştir' });
  assert.deepEqual(mail.sent.map((m) => m.to), ['ed@example.org']);
});

test('a broken Gmail never fails the action', async () => {
  const { env, waits } = setupSocial();
  mail.fail();
  const id = await newPost(env);
  assert.equal((await act(submit.onRequestPost, 'submit', env, 'ed', id, { revision: 0 }, waits)).status, 200);
  await settle(waits);
  assert.equal(mail.sent.length, 0);
});

test('cancel removes targets and frees the plan; drafts cannot be cancelled', async () => {
  const { env, db } = setupSocial();
  const id = await newPost(env, 'pub');
  db.prepare(`INSERT INTO social_plans (id, title, scheduled_at, created_by, created_at, updated_at, post_id) VALUES ('pl','P',?, 'pub', 1, 1, ?)`).run(NOW + 3600, id);
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'pub', id, { revision: 0 })).status, 409, 'a draft is deleted, not cancelled');
  await act(submit.onRequestPost, 'submit', env, 'pub', id, { revision: 0 });
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'ed', id, { revision: 1 })).status, 403, 'not ed\'s post');
  assert.equal((await act(cancel.onRequestPost, 'cancel', env, 'pub', id, { revision: 1 })).status, 200);
  assert.equal(status(db, id).status, 'cancelled');
  assert.deepEqual(targets(db), []);
  assert.equal((db.prepare(`SELECT post_id FROM social_plans WHERE id = 'pl'`).get() as { post_id: string | null }).post_id, null);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-actions-api.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/social-actions.ts`**

```ts
import type { Env } from './auth';
import { jsonResponse } from './auth';
import { socialGate, readBody, malformed, nowSeconds, type Gate } from './social-api';
import { loadPost } from './social-post-read';
import { rowToDraft, type PostRow } from './social-posts';
import { notificationText, notifyEach, publisherEmails, postLabel, type NotifyKind } from './social-notify';

type Ok = { gate: Extract<Gate, { ok: true }>; row: PostRow & { plan_title?: string | null; author_email?: string | null }; body: Record<string, unknown>; revision: number; now: number };

/** Session, role, CSRF, the post, and the revision the caller acted on. */
export async function prepareAction(
  request: Request, env: Env, id: string, need: 'edit' | 'publish',
): Promise<{ ok: true; value: Ok } | { ok: false; response: Response }> {
  const gate = await socialGate(request, env, need, true);
  if (!gate.ok) return gate;
  const found = await loadPost(env.DB, env, id);
  if (!found) return { ok: false, response: jsonResponse({ error: 'Not found' }, 404) };
  const body = await readBody(request);
  if (!body) return { ok: false, response: malformed() };
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return { ok: false, response: malformed() };
  return { ok: true, value: { gate, row: found.row as Ok['row'], body, revision, now: nowSeconds() } };
}

export const lostRace = () => jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);

/** Fire-and-forget: never awaited by the response, never allowed to throw. */
export function notifyLater(
  ctx: { waitUntil(p: Promise<unknown>): void }, env: Env, request: Request, kind: NotifyKind,
  row: Ok['row'], to: 'publishers' | 'author', extra: { actor?: string; note?: string } = {},
): void {
  const work = (async () => {
    const d = rowToDraft(row);
    const label = postLabel(d.caption, row.plan_title ?? null);
    const panelUrl = `${new URL(request.url).origin}/admin`;
    const message = notificationText(kind, { label, when: d.scheduledAt, panelUrl, ...extra });
    const emails = to === 'publishers' ? await publisherEmails(env.DB) : row.author_email ? [row.author_email] : [];
    await notifyEach(env, emails, message);
  })().catch((err) => console.error('social notification failed', err));
  ctx.waitUntil(work);
}
```

- [ ] **Step 4: `functions/api/social/posts/[id]/submit.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { rowToDraft, readinessProblems, mediaDims, statusOnSubmit, updatePostGuarded, targetStatements, POST_PROOF } from '../../../../_lib/social-posts';
import { coveringEvent } from '../../../../_lib/social-events';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'edit');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (row.created_by !== gate.user.id && !gate.actor.isPublisher) return jsonResponse({ error: 'You cannot submit this post', code: 'not_allowed' }, 403);
  if (row.status !== 'draft' && row.status !== 'rejected') return jsonResponse({ error: 'Only drafts can be submitted', code: 'not_submittable' }, 409);

  const draft = rowToDraft(row);
  const problems = readinessProblems(draft, await mediaDims(env.DB, draft.media.map((m) => m.key)), now);
  if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);

  const event = draft.type === 'story' && !gate.actor.isPublisher ? await coveringEvent(env.DB, gate.user.id, now) : null;
  const status = statusOnSubmit(gate.actor, Boolean(event));
  const newRevision = revision + 1;
  const fields = status === 'scheduled'
    ? { status, approved_by: gate.user.id, approved_at: now, event_mode_id: event?.id ?? null, review_note: null }
    : { status, review_note: null };
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, fields, now, ['draft', 'rejected']),
    { condition: POST_PROOF, binds: [id, newRevision] },
    status === 'scheduled' ? targetStatements(env.DB, id, newRevision, draft.platforms) : [],
    { userId: gate.user.id, action: 'social.post.submit', targetType: 'social_post', targetId: id, details: { status, eventModeId: event?.id ?? null } },
    now,
  );
  if (!done) return lostRace();
  if (status === 'pending_approval') notifyLater(ctx, env, request, 'submitted', row, 'publishers', { actor: row.author_email ?? '' });
  return jsonResponse({ ok: true, revision: newRevision, status });
};
```

- [ ] **Step 5: `functions/api/social/posts/[id]/approve.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { rowToDraft, readinessProblems, mediaDims, updatePostGuarded, targetStatements, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

/** Re-checks everything against now: a request approved late must not schedule into the past. */
export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (row.status !== 'pending_approval') return lostRace();
  const draft = rowToDraft(row);
  const problems = readinessProblems(draft, await mediaDims(env.DB, draft.media.map((m) => m.key)), now);
  if (problems.length) return jsonResponse({ error: 'Not ready', code: 'not_ready', problems }, 422);

  const newRevision = revision + 1;
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, { status: 'scheduled', approved_by: gate.user.id, approved_at: now, review_note: null }, now, ['pending_approval']),
    { condition: POST_PROOF, binds: [id, newRevision] },
    targetStatements(env.DB, id, newRevision, draft.platforms),
    { userId: gate.user.id, action: 'social.post.approve', targetType: 'social_post', targetId: id },
    now,
  );
  if (!done) return lostRace();
  notifyLater(ctx, env, request, 'approved', row, 'author');
  return jsonResponse({ ok: true, revision: newRevision, status: 'scheduled' });
};
```

- [ ] **Step 6: `functions/api/social/posts/[id]/reject.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace, notifyLater } from '../../../../_lib/social-actions';
import { updatePostGuarded, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env, params } = ctx;
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'publish');
  if (!prep.ok) return prep.response;
  const { gate, row, body, revision, now } = prep.value;
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length < 1 || note.length > 500) return jsonResponse({ error: 'A note of 1-500 characters is required', code: 'invalid_note' }, 400);
  if (row.status !== 'pending_approval') return lostRace();
  const newRevision = revision + 1;
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, { status: 'rejected', review_note: note }, now, ['pending_approval']),
    { condition: POST_PROOF, binds: [id, newRevision] },
    [],
    { userId: gate.user.id, action: 'social.post.reject', targetType: 'social_post', targetId: id, details: { note } },
    now,
  );
  if (!done) return lostRace();
  notifyLater(ctx, env, request, 'rejected', row, 'author', { note });
  return jsonResponse({ ok: true, revision: newRevision, status: 'rejected' });
};
```

- [ ] **Step 7: `functions/api/social/posts/[id]/cancel.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { prepareAction, lostRace } from '../../../../_lib/social-actions';
import { canCancelPost, updatePostGuarded, targetStatements, unlinkPlanStatement, POST_PROOF } from '../../../../_lib/social-posts';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const id = String(params.id);
  const prep = await prepareAction(request, env, id, 'edit');
  if (!prep.ok) return prep.response;
  const { gate, row, revision, now } = prep.value;
  if (!canCancelPost(gate.actor, row)) {
    return (row.created_by === gate.user.id || gate.actor.isPublisher)
      ? jsonResponse({ error: 'Only pending or scheduled posts can be cancelled', code: 'not_cancellable' }, 409)
      : jsonResponse({ error: 'You cannot cancel this post', code: 'not_allowed' }, 403);
  }
  const newRevision = revision + 1;
  const done = await runGuardedWithAudit(
    env.DB,
    updatePostGuarded(env.DB, id, revision, { status: 'cancelled' }, now, ['pending_approval', 'scheduled']),
    { condition: POST_PROOF, binds: [id, newRevision] },
    [...targetStatements(env.DB, id, newRevision, null), unlinkPlanStatement(env.DB, id, newRevision)],
    { userId: gate.user.id, action: 'social.post.cancel', targetType: 'social_post', targetId: id, details: { from: row.status } },
    now,
  );
  if (!done) return lostRace();
  return jsonResponse({ ok: true, revision: newRevision, status: 'cancelled' });
};
```

- [ ] **Step 8: Run the tests**

Run: `node --import tsx --test tests/social-actions-api.test.ts tests/social-posts-api.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add functions/_lib/social-actions.ts "functions/api/social/posts/[id]" tests/social-actions-api.test.ts
git commit -m "Social approval flow: submit, approve, reject, cancel, race-safe"
```

---

### Task 8: Event modes API

**Files:**
- Create: `functions/api/social/event-modes/index.ts`, `functions/api/social/event-modes/[id]/close.ts`
- Test: `tests/social-event-modes-api.test.ts`

**Interfaces:**
- Consumes:
  - `MAX_EVENT_SECONDS` and `EventModeRow` (Task 3)
  - `socialGate`, `readBody`, `malformed` and `nowSeconds` (Task 5)
  - `isSocialEditor` (Task 5, `functions/_lib/social-plans.ts`)
  - `runWithAudit` and `runGuardedWithAudit`
- Produces:
  - **`GET /api/social/event-modes`** (editor) returns `{ modes: { id, name, startsAt, endsAt, editorIds, editorEmails, openedBy, closedAt, active }[] }`. It lists modes whose `ends_at` falls after now minus 7 days.
  - **`POST /api/social/event-modes`** (publisher) takes `{ name, startsAt, endsAt, editorIds }` and returns 201 `{ id }`.
    - Codes: `invalid_name`, `invalid_window`, `window_too_long`, `invalid_editors`.
  - **`POST /api/social/event-modes/:id/close`** (publisher) returns `{ ok: true }`, or 409 `already_closed`.

- [ ] **Step 1: Failing test** `tests/social-event-modes-api.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import * as modes from '../functions/api/social/event-modes/index';
import * as close from '../functions/api/social/event-modes/[id]/close';

const NOW = Math.floor(Date.now() / 1000);
const valid = { name: '13. Sempozyum', startsAt: NOW - 60, endsAt: NOW + 2 * 86400, editorIds: ['ed'] };

test('a publisher opens an event window; editors see it as active', async () => {
  const { env, db } = setupSocial();
  const res = await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body: valid });
  assert.equal(res.status, 201);
  const list = await (await call(modes.onRequestGet, 'GET', '/api/social/event-modes', { env, as: 'ed' })).json() as { modes: { name: string; active: boolean; editorEmails: string[] }[] };
  assert.deepEqual(list.modes.map((m) => [m.name, m.active, m.editorEmails]), [['13. Sempozyum', true, ['ed@example.org']]]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.event.open'`).get() as { n: number }).n, 1);
});

test('only publishers open windows, and bad windows are refused', async () => {
  const { env } = setupSocial();
  assert.equal((await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'ed', body: valid })).status, 403);
  const cases: [Record<string, unknown>, string][] = [
    [{ ...valid, name: '' }, 'invalid_name'],
    [{ ...valid, endsAt: valid.startsAt }, 'invalid_window'],
    [{ ...valid, startsAt: NOW - 3 * 86400, endsAt: NOW - 86400 }, 'invalid_window'],
    [{ ...valid, endsAt: valid.startsAt + 8 * 86400 }, 'window_too_long'],
    [{ ...valid, editorIds: [] }, 'invalid_editors'],
    [{ ...valid, editorIds: ['mem'] }, 'invalid_editors'],
  ];
  for (const [body, code] of cases) {
    const res = await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body });
    assert.equal(res.status, 400, code);
    assert.equal((await res.json() as { code: string }).code, code);
  }
});

test('closing works once', async () => {
  const { env } = setupSocial();
  const { id } = await (await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body: valid })).json() as { id: string };
  assert.equal((await call(close.onRequestPost, 'POST', `/api/social/event-modes/${id}/close`, { env, as: 'admin', params: { id } })).status, 200);
  assert.equal((await call(close.onRequestPost, 'POST', `/api/social/event-modes/${id}/close`, { env, as: 'pub', params: { id } })).status, 409);
  const list = await (await call(modes.onRequestGet, 'GET', '/api/social/event-modes', { env, as: 'ed' })).json() as { modes: { active: boolean }[] };
  assert.equal(list.modes[0].active, false);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-event-modes-api.test.ts`
Expected: FAIL.

- [ ] **Step 3: `functions/api/social/event-modes/index.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse, generateId } from '../../../_lib/auth';
import { socialGate, readBody, malformed, nowSeconds } from '../../../_lib/social-api';
import { MAX_EVENT_SECONDS, type EventModeRow } from '../../../_lib/social-events';
import { runWithAudit } from '../../../_lib/audit';
import { isSocialEditor } from '../../../_lib/social-plans';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'edit', false);
  if (!gate.ok) return gate.response;
  const now = nowSeconds();
  const rows = (await env.DB.prepare('SELECT * FROM social_event_modes WHERE ends_at > ? ORDER BY starts_at DESC')
    .bind(now - 7 * 86400).all<EventModeRow>()).results;
  const emails = new Map((await env.DB.prepare('SELECT id, email FROM users WHERE is_admin = 1 OR is_social = 1 OR is_social_publisher = 1')
    .all<{ id: string; email: string }>()).results.map((u) => [u.id, u.email]));
  const modes = rows.map((m) => {
    let editorIds: string[] = [];
    try { editorIds = JSON.parse(m.editor_ids); } catch { editorIds = []; }
    return {
      id: m.id, name: m.name, startsAt: m.starts_at, endsAt: m.ends_at, editorIds,
      editorEmails: editorIds.map((i) => emails.get(i) ?? i), openedBy: m.opened_by, closedAt: m.closed_at,
      active: m.closed_at === null && m.starts_at <= now && now < m.ends_at,
    };
  });
  return jsonResponse({ modes });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await socialGate(request, env, 'publish', true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  if (!body) return malformed();
  const now = nowSeconds();
  const bad = (code: string) => jsonResponse({ error: 'Invalid event window', code }, 400);

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 1 || name.length > 80) return bad('invalid_name');
  const { startsAt, endsAt } = body;
  if (typeof startsAt !== 'number' || typeof endsAt !== 'number' || !Number.isInteger(startsAt) || !Number.isInteger(endsAt)
    || endsAt <= startsAt || endsAt <= now) return bad('invalid_window');
  if (endsAt - startsAt > MAX_EVENT_SECONDS) return bad('window_too_long');
  const ids = body.editorIds;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 50 || new Set(ids).size !== ids.length || !ids.every((i) => typeof i === 'string')) return bad('invalid_editors');
  for (const i of ids as string[]) if (!(await isSocialEditor(env.DB, i))) return bad('invalid_editors');

  const id = generateId();
  await runWithAudit(env.DB, [
    env.DB.prepare('INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, name, startsAt, endsAt, JSON.stringify(ids), gate.user.id, now),
  ], { userId: gate.user.id, action: 'social.event.open', targetType: 'social_event_mode', targetId: id, details: { name, startsAt, endsAt, editorIds: ids } }, now);
  return jsonResponse({ id }, 201);
};

```

- [ ] **Step 4: `functions/api/social/event-modes/[id]/close.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { jsonResponse } from '../../../../_lib/auth';
import { socialGate, nowSeconds } from '../../../../_lib/social-api';
import { runGuardedWithAudit } from '../../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  const gate = await socialGate(request, env, 'publish', true);
  if (!gate.ok) return gate.response;
  const id = String(params.id);
  const now = nowSeconds();
  const exists = await env.DB.prepare('SELECT 1 FROM social_event_modes WHERE id = ?').bind(id).first();
  if (!exists) return jsonResponse({ error: 'Not found' }, 404);
  const done = await runGuardedWithAudit(
    env.DB,
    env.DB.prepare('UPDATE social_event_modes SET closed_at = ?, closed_by = ? WHERE id = ? AND closed_at IS NULL').bind(now, gate.user.id, id),
    { condition: 'EXISTS (SELECT 1 FROM social_event_modes WHERE id = ? AND closed_at = ? AND closed_by = ?)', binds: [id, now, gate.user.id] },
    [],
    { userId: gate.user.id, action: 'social.event.close', targetType: 'social_event_mode', targetId: id },
    now,
  );
  if (!done) return jsonResponse({ error: 'Already closed', code: 'already_closed' }, 409);
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 5: Run** `node --import tsx --test tests/social-event-modes-api.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/social/event-modes tests/social-event-modes-api.test.ts
git commit -m "Event modes API: publishers open and close story windows"
```

---

### Task 9: Daily plan reminders

**Files:**
- Create: `functions/api/admin/social/plan-reminders.ts`
- Modify: `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml`, `tests/symposium-cron.test.ts`
- Test: `tests/social-plan-reminders.test.ts`

**Interfaces:**
- Consumes:
  - `safeEqual` (`functions/_lib/secret.ts`) and `appendAudit`
  - `notificationText`, `notifyEach` and `publisherEmails` (Task 4)
  - the worker's existing `callSecretPost(label, url, env)`
- Produces:
  - **`POST /api/admin/social/plan-reminders`**, gated by the `X-Archive-Secret` header, returns `{ ok: true, reminded: number }`.
    - It picks plans with `post_id IS NULL AND reminded_at IS NULL AND scheduled_at` between now and now plus 48 hours.
    - It mails the assignee and the publishers, and sets `reminded_at` only when at least one mail went out.
    - It writes the audit row `social.plan.remind` (user null).
  - Worker env `SOCIAL_REMINDERS_URL`; `Tick` gains `socialReminders: string`.

- [ ] **Step 1: Failing test** `tests/social-plan-reminders.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { onRequestPost } from '../functions/api/admin/social/plan-reminders';

const NOW = Math.floor(Date.now() / 1000);
const remind = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/social/plan-reminders', { method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {} }),
    env,
  });

function seed(db: import('node:sqlite').DatabaseSync) {
  const add = db.prepare(`INSERT INTO social_plans (id, title, scheduled_at, assignee_id, post_id, reminded_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'pub', 1, 1)`);
  add.run('due', 'Konuşmacı 3', NOW + 3600, 'ed', null, null);
  add.run('later', 'Sonra', NOW + 5 * 86400, 'ed', null, null);
  add.run('filled', 'Dolu', NOW + 3600, 'ed', 'p1', null);
  add.run('done', 'Hatırlatıldı', NOW + 3600, 'ed', null, NOW - 10);
}

test('the secret gates it', async () => {
  const { env } = setupSocial();
  assert.equal((await remind(env)).status, 403);
  assert.equal((await remind(env, 'wrong')).status, 403);
});

test('only empty plans due within 48 hours, once each, to the assignee and publishers', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const mail = stubMail();
  try {
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 1 });
    assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'ed@example.org', 'pub@example.org']);
    assert.match(mail.sent[0].subject, /Konuşmacı 3/);
    assert.ok((db.prepare(`SELECT reminded_at FROM social_plans WHERE id = 'due'`).get() as { reminded_at: number }).reminded_at);
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 0 }, 'not twice');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.plan.remind'`).get() as { n: number }).n, 1);
  } finally { mail.restore(); }
});

test('when no mail can go out, the plan is tried again tomorrow', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const mail = stubMail();
  mail.fail();
  try {
    assert.deepEqual(await (await remind(env, 'cron-secret')).json(), { ok: true, reminded: 0 });
    assert.equal((db.prepare(`SELECT reminded_at FROM social_plans WHERE id = 'due'`).get() as { reminded_at: number | null }).reminded_at, null);
  } finally { mail.restore(); }
});
```

In `tests/symposium-cron.test.ts`:
1. Add `SOCIAL_REMINDERS_URL: 'https://main/social-reminders',` to `ENV`.
2. Extend the secret-header condition with `|| url.includes('/social-reminders')`.
3. The order assertion becomes `[ENV.ARCHIVE_URL, ENV.PURGE_URL, ENV.AUDIT_PRUNE_URL, ENV.SOCIAL_REMINDERS_URL, ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]`.
4. Every `f.calls.slice(3)` becomes `f.calls.slice(4)`.
5. Add:

```ts
test('a failing reminder run is reported but stops nothing', async () => {
  const f = stubFetch(ENV.SOCIAL_REMINDERS_URL);
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 502);
    assert.deepEqual(f.calls.slice(4), [ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
    assert.match(String((await res.json() as { socialReminders: string }).socialReminders), /^ERROR 500/);
  } finally { f.restore(); }
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-plan-reminders.test.ts tests/symposium-cron.test.ts`
Expected: FAIL.

- [ ] **Step 3: `functions/api/admin/social/plan-reminders.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { safeEqual } from '../../../_lib/secret';
import { appendAudit } from '../../../_lib/audit';
import { notificationText, notifyEach, publisherEmails } from '../../../_lib/social-notify';

const WINDOW_SECONDS = 48 * 3600;

/**
 * Nightly (workers/symposium-cron, 04:17 Türkiye time), so the mail is
 * waiting in the morning. A plan is marked reminded only when a mail actually
 * went out; if Gmail was down, tomorrow's run tries again.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const due = (await env.DB.prepare(
    `SELECT pl.id, pl.title, pl.scheduled_at, u.email AS assignee_email
       FROM social_plans pl LEFT JOIN users u ON u.id = pl.assignee_id
      WHERE pl.post_id IS NULL AND pl.reminded_at IS NULL AND pl.scheduled_at BETWEEN ? AND ?
      ORDER BY pl.scheduled_at`,
  ).bind(now, now + WINDOW_SECONDS).all<{ id: string; title: string; scheduled_at: number; assignee_email: string | null }>()).results;
  if (due.length === 0) return jsonResponse({ ok: true, reminded: 0 });

  const publishers = await publisherEmails(env.DB);
  const panelUrl = `${new URL(request.url).origin}/admin`;
  let reminded = 0;
  for (const plan of due) {
    const message = notificationText('plan_due', { label: plan.title, when: plan.scheduled_at, panelUrl });
    const sent = await notifyEach(env, [plan.assignee_email ?? '', ...publishers], message);
    if (sent === 0) continue;
    await env.DB.prepare('UPDATE social_plans SET reminded_at = ? WHERE id = ?').bind(now, plan.id).run();
    await appendAudit(env.DB, { userId: null, action: 'social.plan.remind', targetType: 'social_plan', targetId: plan.id, details: { sent } }, now);
    reminded++;
  }
  return jsonResponse({ ok: true, reminded });
};
```

- [ ] **Step 4: Worker.** In `workers/symposium-cron/src/index.ts`:

1. Add to `Env`:

   ```ts
     /** Main site's social plan reminders; same secret as archive. */
     SOCIAL_REMINDERS_URL: string;
   ```

2. In `tick`, after `auditPrune`, add `const socialReminders = await callSecretPost('social reminders', env.SOCIAL_REMINDERS_URL, env);` and return it.
3. Add `socialReminders: string` to `Tick`.
4. Add `t.socialReminders` to `failed`.
5. Add ` social reminders: ${t.socialReminders.slice(0, 120)}` to `summarise`.
6. Add `socialReminders: parseIfJson(body.socialReminders),` to the `fetch` output.

In `wrangler.toml` `[vars]`, add `SOCIAL_REMINDERS_URL = "https://rsg-turkiye.iscbsc.org/api/admin/social/plan-reminders"`. Add one line to the header comment: "It also emails reminders for social media plans still empty 48 hours ahead."

- [ ] **Step 5: Run** `node --import tsx --test tests/social-plan-reminders.test.ts tests/symposium-cron.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/social workers/symposium-cron tests/social-plan-reminders.test.ts tests/symposium-cron.test.ts
git commit -m "Nightly reminders for social plans still empty two days out"
```

---

### Task 10: README and full verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** Add a section `## Social media content (phase 2a)` after "Connections and the status banner", containing:
  - **What exists now:**
    - plans, posts and the approval flow over `/api/social/*`;
    - event modes;
    - email notifications;
    - nightly plan reminders.
  - **What does not exist yet:** nothing is published to Instagram or LinkedIn yet (phase 3), and the panel screens come in plan 2b.
  - **Roles:**
    - Editors plan and draft, and submit for approval.
    - Publishers schedule directly, approve or send back with a note, cancel, and open event windows.
    - An editor's story skips approval only inside an open event window that names them.
  - **Before deploying:**
    - Run migration 8d (`wrangler d1 execute rsg-members --remote --file=db/schema.sql`).
    - After merge, redeploy `workers/symposium-cron` (`cd workers/symposium-cron && npx wrangler deploy`) so `SOCIAL_REMINDERS_URL` is called.
  - **Notifications** go from `RSG_MAIL_FROM` and are not recorded in sent mail. When Gmail is broken they pause, and the status banner already says so.

- [ ] **Step 2: Verify everything.**

Run:
```bash
npm test
npx astro check
npm run build
```
Expected:
- `npm test`: all pass.
- `astro check`: 0 errors.
- Build: completes.

If `astro check` flags a typing problem in a new file, fix it in that file with no behaviour change and rerun.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: social media content backend (phase 2a)"
```
