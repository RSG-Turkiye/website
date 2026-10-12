# Social Media Panel, Phase 2b (Panel UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the social media panel on screen in `/admin`, on top of the phase 2a APIs:
- a calendar and a board of plans and posts;
- a side panel with each item's actions;
- a plan dialog;
- a composer with live preview, counters and the readiness checklist;
- an approval queue, a drafts list, and event-mode controls.

People with only a social role can now open the admin panel.

**Architecture:**
- **Client code:** vanilla TypeScript under `src/scripts/social/`, the same style as the rest of the admin panel (HTML strings, with `escapeHtml` on every value from the server).
- **One API client** turns every non-OK response into a typed `ApiError`, and one messages module turns its code into a sentence.
- **Pure logic is tested:** calendar math is in `src/lib/social-calendar.ts`. The composer's checklist calls the server's own `readinessProblems` and `captionProblems` from `functions/_lib`, so the panel and the server can never disagree.
- **No backend changes and no migration.** Phase 2a's tables and endpoints are already live.

**Tech Stack:** Astro, vanilla TypeScript, Tailwind classes already used by the panel, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-12-social-media-panel-design.md`:
- §1: roles and event mode
- §2: interface, the Calendar, Board, Pending approval and Composer parts
- §8: phase 2, UI half

The approved mockups (calendar-first layout with a board toggle, side panel, composer with preview) are what this builds.

## Global Constraints

- **Strings:** every user-facing string is in `src/i18n/ui.ts` under `admin.social.*`, in both `en` and `tr`.
- **No em dashes** (U+2014) anywhere in `src/` or `tests/`.
- **Escaping:** every value that came from the server is escaped with `escapeHtml` before it reaches `innerHTML`. Status and type names are looked up in constant maps, never interpolated raw.
- **Server is the authority.** The UI hides actions a user may not take, but every action is checked again by the API. When the UI and the API disagree, the API's error code is shown, never swallowed.
- **Error codes the UI must recognise:**
  - `post_changed` (409): say the post was changed elsewhere, then reload it.
  - `not_ready` (422): list the `problems`.
  - Each of these gets its own sentence: `not_pending`, `not_found`, `plan_taken`, `plan_has_post`, `not_allowed`, `not_submittable`, `not_deletable`, `not_cancellable`, `already_closed`.
  - Every validation code also gets its own sentence.
- **Who sees what:**
  - Editors see the calendar, drafts and event list, and edit their own posts.
  - Publishers and admins also see the approval queue, approve, send back, cancel any post, and open or close event windows.
  - A post that belongs to someone else opens read-only for an editor.
  - Locked posts (published, partially published, failed, cancelled) are read-only for everyone.
- **Times** are Türkiye time. New items default to 18:00. Weeks start on Monday.
- **Images:** social uploads are JPEG, at most 2000px on the longest side, with transparency filled white.
- **Autosave rules:**
  - Only drafts autosave.
  - Saves are serialised, never two in flight.
  - The composer takes the revision from every response before the next save.
  - The first `post_changed` stops autosave and tells the user.
- **Caption overrides** are sent in the fixed order `instagram`, `linkedin`, and empty overrides are left out, so autosave does not log changes that did not happen.
- **Out of scope:**
  - the phone quick-story screen, video, publishing and the published list (phase 3);
  - `/links` (phase 4);
  - LinkedIn connect (phase 5).
- **Run** `npm test`, `npx astro check` (0 errors) and `npm run build` before each task's commit.

## Review Focus

1. **A person with only a social role opens `/admin`.** Expected: they see the Social pane and nothing else. The panel does not crash on setup code meant for other roles, and does not show "not authorised". Pinned in Task 2, and in the user's browser check in Task 6.
2. **An editor opens a scheduled post.** Expected: the composer warns that saving sends it back for approval before they save. Pinned in Task 4.
3. **Autosave runs while a publisher edits the same draft.** Expected: autosave stops at the first `post_changed`, says so, and never overwrites. Pinned in Task 4: a pure `AutosaveQueue` with tests.
4. **The composer counts a caption differently from the server.** Expected: impossible, because the checklist calls the server's `readinessProblems` and `captionProblems`. Pinned in Task 4: an import check plus a build.
5. **Two people open the same empty plan slot and both start a post.** Expected: the second save gets `plan_taken` with a sentence, and the composer turns into a normal draft not tied to the plan. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/social-calendar.ts` | Month grid, ranges, day keys, 18:00 default, bucketing, plan-due rule |
| `src/scripts/social/context.ts` | Shared deps (`t`, `tf`, toast, lang, `me`) and a change signal |
| `src/scripts/social/api.ts` | Typed fetch client, `ApiError` |
| `src/scripts/social/messages.ts` | Problem and error codes to sentences |
| `src/scripts/social/autosave.ts` | Serialised autosave queue (pure, tested) |
| `src/scripts/social/calendar-view.ts` | Month grid and board rendering, navigation |
| `src/scripts/social/side-panel.ts` | Details and actions for the selected plan or post |
| `src/scripts/social/plan-dialog.ts` | Create and edit plan form |
| `src/scripts/social/composer.ts` | Post editor, checklist, autosave, submit |
| `src/scripts/social/preview.ts` | Instagram feed, story and LinkedIn previews |
| `src/scripts/social/lists.ts` | Approval queue, drafts list |
| `src/scripts/social/events.ts` | Event mode list and controls |
| `src/scripts/social/index.ts` | `setupSocial`, `loadSocial`, tab switching |
| `src/scripts/image-upload.ts` | Adds `uploadSocialImage` |
| `src/components/admin/panes/SocialPane.astro` | Pane skeleton |
| `src/components/admin/AdminNav.astro`, `AdminShell.astro` | Nav entry, pane |
| `src/scripts/admin-panel.ts` | Access for social roles, pane loader, toast map |
| `src/i18n/ui.ts` | `admin.social.*`, en and tr |
| `tests/social-calendar.test.ts`, `tests/social-autosave.test.ts`, `tests/admin-social-i18n.test.ts` | Tests |
| `README.md` | Panel usage, browser check |

---

### Task 1: Calendar math, messages, autosave queue, and every string

**Files:**
- Create: `src/lib/social-calendar.ts`, `src/scripts/social/context.ts`, `src/scripts/social/api.ts`, `src/scripts/social/messages.ts`, `src/scripts/social/autosave.ts`
- Modify: `src/i18n/ui.ts`
- Test: `tests/social-calendar.test.ts`, `tests/social-autosave.test.ts`, `tests/admin-social-i18n.test.ts`

**Interfaces:**
- Produces (`social-calendar.ts`):
  - `interface GridDay { key: string; day: number; inMonth: boolean }`
  - `monthGrid(year: number, month: number): GridDay[]`: 42 days, Monday first.
  - `gridRange(grid: GridDay[]): { from: number; to: number }`
  - `dayKey(epoch: number): string`, `timeOf(epoch: number): string`
  - `DEFAULT_TIME = '18:00'`
  - `epochAt(date: string, time?: string): number | null`
  - `bucketByDay<T>(items: T[], at: (item: T) => number | null): Map<string, T[]>`
  - `shiftMonth(year: number, month: number, delta: number): { year: number; month: number }`
  - `monthOf(epoch: number): { year: number; month: number }`
  - `PLAN_DUE_SECONDS`
  - `planDue(plan: { scheduledAt: number; postId: string | null }, now: number): boolean`
- Produces (`context.ts`):
  - `interface SocialDeps { t(key: string): string; tf(key: string, vars: Record<string, string | number>): string; showToast(message: string, isError?: boolean): void; lang: 'en' | 'tr'; me: { id: string; isPublisher: boolean } }`
  - `setDeps(d)`, `deps()`
  - `onChange(fn)`, `changed()`
- Produces (`api.ts`):
  - types `Platform`, `PostType`, `PostStatus`, `MediaItem`, `Post`, `Plan`, `Editor`, `EventMode`, `Problem`
  - `class ApiError { status; code; problems }`
  - `api` object with the methods listed in the code
- Produces (`messages.ts`):
  - `PROBLEM_CODES`, `ERROR_CODES`
  - `problemText(p: Problem): string`
  - `errorText(err: unknown): string`
  - `STATUS_KEYS`
- Produces (`autosave.ts`):
  - `class AutosaveQueue { constructor(save: () => Promise<void>, delayMs: number, timers?: Timers); touch(): void; flush(): Promise<void>; stop(): void; readonly stopped: boolean }`
  - `type Timers = { set(fn: () => void, ms: number): unknown; clear(h: unknown): void }`

- [ ] **Step 1: Failing tests.** `tests/social-calendar.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, gridRange, dayKey, timeOf, epochAt, bucketByDay, shiftMonth, monthOf, planDue, PLAN_DUE_SECONDS } from '../src/lib/social-calendar';

test('October 2026 starts on a Thursday: the grid opens on Monday 28 September', () => {
  const g = monthGrid(2026, 10);
  assert.equal(g.length, 42);
  assert.deepEqual([g[0].key, g[0].inMonth], ['2026-09-28', false]);
  assert.deepEqual([g[3].key, g[3].day, g[3].inMonth], ['2026-10-01', 1, true]);
  assert.equal(g[41].key, '2026-11-08');
});

test('a month starting on Monday has no leading days', () => {
  assert.equal(monthGrid(2026, 6)[0].key, '2026-06-01');
});

test('the range covers the whole grid in Türkiye time and fits the 62-day API cap', () => {
  const r = gridRange(monthGrid(2026, 10));
  assert.equal(r.from, Date.UTC(2026, 8, 27, 21, 0) / 1000);
  assert.equal(r.to, Date.UTC(2026, 10, 8, 20, 59, 59) / 1000);
  assert.ok(r.to - r.from <= 62 * 86400);
});

test('day keys and times are Türkiye time', () => {
  const lateUtc = Date.UTC(2026, 9, 12, 22, 30) / 1000;
  assert.equal(dayKey(lateUtc), '2026-10-13');
  assert.equal(timeOf(lateUtc), '01:30');
});

test('a new item defaults to 18:00 Türkiye time', () => {
  assert.equal(epochAt('2026-10-14'), Date.UTC(2026, 9, 14, 15, 0) / 1000);
  assert.equal(epochAt('2026-10-14', '09:30'), Date.UTC(2026, 9, 14, 6, 30) / 1000);
  assert.equal(epochAt('not a date'), null);
});

test('bucketByDay groups and sorts by time, skipping undated items', () => {
  const at = (h: number) => Date.UTC(2026, 9, 14, h) / 1000;
  const m = bucketByDay([{ t: at(15) }, { t: at(6) }, { t: null }], (x) => x.t);
  assert.deepEqual([...m.keys()], ['2026-10-14']);
  assert.deepEqual(m.get('2026-10-14')!.map((x) => x.t), [at(6), at(15)]);
});

test('month arithmetic and the month of an instant', () => {
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(monthOf(Date.UTC(2026, 9, 31, 22) / 1000), { year: 2026, month: 11 }, '01:00 on 1 November in Türkiye');
});

test('a plan is due when it has no post and is less than 48 hours away (or past)', () => {
  const now = 1_800_000_000;
  assert.equal(planDue({ scheduledAt: now + PLAN_DUE_SECONDS, postId: null }, now), true);
  assert.equal(planDue({ scheduledAt: now + PLAN_DUE_SECONDS + 1, postId: null }, now), false);
  assert.equal(planDue({ scheduledAt: now - 10, postId: null }, now), true);
  assert.equal(planDue({ scheduledAt: now + 10, postId: 'p' }, now), false);
});
```

`tests/social-autosave.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutosaveQueue, type Timers } from '../src/scripts/social/autosave';

/** Manual clock: timers run only when the test says so. */
function manual() {
  let pending: (() => void) | null = null;
  const timers: Timers = { set: (fn) => { pending = fn; return 1; }, clear: () => { pending = null; } };
  return { timers, fire: () => { const f = pending; pending = null; f?.(); }, armed: () => pending !== null };
}
const tick = () => new Promise((r) => setImmediate(r));

test('edits within the delay produce one save', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; }, 3000, c.timers);
  q.touch(); q.touch(); q.touch();
  c.fire(); await tick();
  assert.equal(saves, 1);
});

test('never two saves in flight: an edit during a save queues exactly one more', async () => {
  let inFlight = 0, maxInFlight = 0, saves = 0;
  let release!: () => void;
  const c = manual();
  const q = new AutosaveQueue(async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); saves++;
    if (saves === 1) await new Promise<void>((r) => { release = r; });
    inFlight--;
  }, 3000, c.timers);
  q.touch(); c.fire(); await tick();
  q.touch(); q.touch();
  assert.equal(c.armed(), false, 'no timer while a save is running');
  release(); await tick(); await tick();
  assert.equal(c.armed(), true, 'the pending edit is scheduled after the save');
  c.fire(); await tick();
  assert.deepEqual([saves, maxInFlight], [2, 1]);
});

test('a failing save stops the queue for good', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; throw new Error('post_changed'); }, 3000, c.timers);
  q.touch(); c.fire(); await tick();
  assert.equal(q.stopped, true);
  q.touch();
  assert.equal(c.armed(), false);
  assert.equal(saves, 1);
});

test('flush saves now if anything is pending, and waits for it', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; }, 3000, c.timers);
  await q.flush();
  assert.equal(saves, 0, 'nothing pending, nothing saved');
  q.touch();
  await q.flush();
  assert.equal(saves, 1);
  assert.equal(c.armed(), false);
});
```

`tests/admin-social-i18n.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ui } from '../src/i18n/ui';
import { PROBLEM_CODES, ERROR_CODES, STATUS_KEYS } from '../src/scripts/social/messages';

const keys = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => k.startsWith('admin.social.'));
const has = (k: string) => k in ui.en && k in ui.tr;

test('every social key exists in both languages', () => {
  assert.deepEqual(keys('en').sort(), keys('tr').sort());
});

test('every key the social scripts look up exists', () => {
  const dir = new URL('../src/scripts/social/', import.meta.url);
  const used = new Set<string>();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.ts'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/'(admin\.social\.[\w.]+)'/g)) used.add(m[1]);
  }
  assert.ok(used.size > 40);
  for (const k of used) assert.ok(has(k), `missing ${k}`);
});

test('every problem, error and status the API can return has a sentence', () => {
  for (const c of [...PROBLEM_CODES, 'unknown']) assert.ok(has(`admin.social.problem.${c}`), c);
  for (const c of [...ERROR_CODES, 'unknown']) assert.ok(has(`admin.social.error.${c}`), c);
  for (const s of STATUS_KEYS) assert.ok(has(`admin.social.status.${s}`), s);
  for (const t of ['image', 'carousel', 'story']) assert.ok(has(`admin.social.type.${t}`), t);
});
```

- [ ] **Step 2: Run, confirm failure**

Run: `node --import tsx --test tests/social-calendar.test.ts tests/social-autosave.test.ts tests/admin-social-i18n.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `src/lib/social-calendar.ts`**

```ts
/**
 * Calendar arithmetic for the social panel, all in Türkiye time. Grid days
 * are calendar dates (YYYY-MM-DD), computed on dates rather than instants so
 * no host timezone leaks in; instants go through istanbul-time.ts.
 */
import { epochToIstanbulInput, istanbulInputToEpoch } from './istanbul-time';

export interface GridDay { key: string; day: number; inMonth: boolean }

const DAY_MS = 86_400_000;

/** Six weeks, Monday first, so every month fits and the grid never changes height. */
export function monthGrid(year: number, month: number): GridDay[] {
  const first = Date.UTC(year, month - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first + (i - lead) * DAY_MS);
    days.push({ key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return days;
}

/** From the grid's first midnight to its last minute, in epoch seconds. */
export function gridRange(grid: GridDay[]): { from: number; to: number } {
  return {
    from: istanbulInputToEpoch(`${grid[0].key}T00:00`)!,
    to: istanbulInputToEpoch(`${grid[grid.length - 1].key}T23:59`)! + 59,
  };
}

export const dayKey = (epoch: number) => epochToIstanbulInput(epoch).slice(0, 10);
export const timeOf = (epoch: number) => epochToIstanbulInput(epoch).slice(11, 16);

/** The panel's default publishing time: the hour the account already posts most. */
export const DEFAULT_TIME = '18:00';

export function epochAt(date: string, time: string = DEFAULT_TIME): number | null {
  return istanbulInputToEpoch(`${date}T${time}`) ?? null;
}

export function bucketByDay<T>(items: T[], at: (item: T) => number | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const dated = items.filter((i) => at(i) !== null).sort((a, b) => (at(a)! - at(b)!));
  for (const item of dated) {
    const k = dayKey(at(item)!);
    const list = out.get(k);
    if (list) list.push(item); else out.set(k, [item]);
  }
  return out;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthOf(epoch: number): { year: number; month: number } {
  const [y, m] = dayKey(epoch).split('-').map(Number);
  return { year: y, month: m };
}

/** The same 48 hours the nightly reminder uses (functions/api/admin/social/plan-reminders.ts). */
export const PLAN_DUE_SECONDS = 48 * 3600;

export function planDue(plan: { scheduledAt: number; postId: string | null }, now: number): boolean {
  return plan.postId === null && plan.scheduledAt - now <= PLAN_DUE_SECONDS;
}
```

- [ ] **Step 4: `src/scripts/social/context.ts`**

```ts
/** What every social module needs from the admin panel, set once by setupSocial. */
export interface SocialDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
  me: { id: string; isPublisher: boolean };
}

let current: SocialDeps | null = null;

export function setDeps(d: SocialDeps): void { current = d; }
export function deps(): SocialDeps {
  if (!current) throw new Error('social panel used before setupSocial');
  return current;
}

/** Anything that changes plans or posts calls changed(); the open views reload. */
const listeners = new Set<() => void>();
export function onChange(fn: () => void): void { listeners.add(fn); }
export function changed(): void { for (const fn of listeners) fn(); }
```

- [ ] **Step 5: `src/scripts/social/api.ts`**

```ts
/**
 * The only place the social panel talks to the server. A non-OK answer
 * becomes an ApiError carrying the server's code, so every caller can turn it
 * into a sentence (messages.ts) instead of a generic failure.
 */
export type Platform = 'instagram' | 'linkedin' | 'x';
export type PostType = 'image' | 'carousel' | 'story';
export type PostStatus =
  | 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'partially_published' | 'failed' | 'rejected' | 'cancelled';

export interface MediaItem { key: string; alt: string; url: string; width?: number; height?: number }
export interface Post {
  id: string; type: PostType; caption: string; captionOverrides: Partial<Record<Platform, string>>; link: string | null;
  media: MediaItem[]; platforms: Platform[]; scheduledAt: number | null; status: PostStatus; revision: number;
  createdBy: string; authorEmail: string | null; approvedBy: string | null; approvedAt: number | null; reviewNote: string | null;
  planId: string | null; planTitle: string | null; eventModeId: string | null; createdAt: number; updatedAt: number;
  targets: { platform: Platform; status: string; permalink: string | null; lastError: string | null }[];
}
export interface Plan {
  id: string; title: string; scheduledAt: number; platforms: Platform[]; postType: PostType; assigneeId: string | null;
  assigneeEmail: string | null; note: string; postId: string | null; postStatus: PostStatus | null; createdBy: string; createdAt: number;
}
export interface Editor { id: string; email: string; name: string | null; isPublisher: boolean }
export interface EventMode {
  id: string; name: string; startsAt: number; endsAt: number; editorIds: string[]; editorEmails: string[];
  openedBy: string; closedAt: number | null; active: boolean;
}
export interface Problem { code: string; index?: number; platform?: Platform; limit?: number; actual?: number }

export interface DraftBody {
  type: PostType; caption: string; captionOverrides: Partial<Record<Platform, string>>; link: string | null;
  media: { key: string; alt: string }[]; platforms: Platform[]; scheduledAt: number | null; planId?: string;
}
export interface PlanBody {
  title: string; scheduledAt: number; platforms: Platform[]; postType: PostType; assigneeId: string | null; note: string;
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, public problems: Problem[] = []) {
    super(code);
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { code?: string; problems?: Problem[] };
  if (!res.ok) throw new ApiError(res.status, data.code ?? `http_${res.status}`, data.problems ?? []);
  return data as T;
}

const id = (s: string) => encodeURIComponent(s);
type Result = { ok: true; revision: number; status: PostStatus };

export const api = {
  plans: (from: number, to: number) => call<{ plans: Plan[] }>('GET', `/api/social/plans?from=${from}&to=${to}`).then((r) => r.plans),
  createPlan: (body: PlanBody) => call<{ id: string }>('POST', '/api/social/plans', body),
  updatePlan: (planId: string, body: Partial<PlanBody>) => call<{ ok: true }>('PATCH', `/api/social/plans/${id(planId)}`, body),
  deletePlan: (planId: string) => call<{ ok: true }>('DELETE', `/api/social/plans/${id(planId)}`),
  posts: (from: number, to: number) => call<{ posts: Post[] }>('GET', `/api/social/posts?from=${from}&to=${to}`).then((r) => r.posts),
  pending: () => call<{ posts: Post[] }>('GET', '/api/social/posts?status=pending_approval').then((r) => r.posts),
  drafts: () => call<{ posts: Post[] }>('GET', '/api/social/posts?drafts=1').then((r) => r.posts),
  post: (postId: string) => call<Post>('GET', `/api/social/posts/${id(postId)}`),
  createPost: (body: DraftBody) => call<{ id: string; revision: number }>('POST', '/api/social/posts', body),
  updatePost: (postId: string, body: DraftBody & { revision: number }) => call<Result>('PATCH', `/api/social/posts/${id(postId)}`, body),
  deletePost: (postId: string, revision: number) => call<{ ok: true }>('DELETE', `/api/social/posts/${id(postId)}`, { revision }),
  action: (postId: string, action: 'submit' | 'approve' | 'reject' | 'cancel', body: { revision: number; note?: string }) =>
    call<Result>('POST', `/api/social/posts/${id(postId)}/${action}`, body),
  editors: () => call<{ editors: Editor[] }>('GET', '/api/social/editors').then((r) => r.editors),
  events: () => call<{ modes: EventMode[] }>('GET', '/api/social/event-modes').then((r) => r.modes),
  openEvent: (body: { name: string; startsAt: number; endsAt: number; editorIds: string[] }) => call<{ id: string }>('POST', '/api/social/event-modes', body),
  closeEvent: (eventId: string) => call<{ ok: true }>('POST', `/api/social/event-modes/${id(eventId)}/close`),
};
```

- [ ] **Step 6: `src/scripts/social/messages.ts`**

```ts
/** Server codes to sentences. Every code here has an admin.social.* key in both languages (tests/admin-social-i18n.test.ts). */
import { ApiError, type Problem } from './api';
import { deps } from './context';

export const PROBLEM_CODES = [
  'no_platform', 'platform_unavailable', 'story_instagram_only', 'media_count', 'missing_alt', 'unknown_media', 'bad_ratio',
  'caption_too_long', 'too_many_hashtags', 'no_schedule', 'schedule_in_past', 'schedule_too_far', 'invalid_schedule_time',
] as const;

export const ERROR_CODES = [
  'post_changed', 'not_ready', 'not_pending', 'not_found', 'not_allowed', 'not_submittable', 'not_deletable', 'not_cancellable',
  'plan_taken', 'plan_has_post', 'already_closed', 'invalid_plan', 'invalid_title', 'invalid_platforms', 'invalid_post_type',
  'invalid_assignee', 'invalid_note', 'invalid_name', 'invalid_window', 'window_too_long', 'invalid_editors', 'invalid_range',
  'schedule_in_past', 'schedule_too_far', 'invalid_schedule_time', 'invalid_type', 'invalid_caption', 'invalid_overrides',
  'invalid_link', 'invalid_media', 'too_many_items', 'invalid_schedule', 'malformed_request',
] as const;

export const STATUS_KEYS = ['draft', 'pending_approval', 'scheduled', 'published', 'partially_published', 'failed', 'rejected', 'cancelled', 'plan'] as const;

const known = (list: readonly string[], code: string) => (list.includes(code) ? code : 'unknown');

export function problemText(p: Problem): string {
  const { t, tf } = deps();
  return tf(`admin.social.problem.${known(PROBLEM_CODES, p.code)}`, {
    n: (p.index ?? 0) + 1,
    platform: p.platform ? t(`admin.connections.platform.${p.platform}`) : '',
    limit: p.limit ?? '',
    actual: p.actual ?? '',
  });
}

export function errorText(err: unknown): string {
  const code = err instanceof ApiError ? known(ERROR_CODES, err.code) : 'unknown';
  return deps().t(`admin.social.error.${code}`);
}
```

- [ ] **Step 7: `src/scripts/social/autosave.ts`**

```ts
/**
 * Draft autosave that cannot fight the server's revision guard: edits are
 * debounced into one save, never two saves run at once (an edit during a
 * save waits for it), and the first failed save -- typically post_changed,
 * someone else edited the post -- stops autosave for good. The composer
 * reports that and asks the person to reopen the post.
 */
export type Timers = { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void };
const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class AutosaveQueue {
  private timer: unknown = null;
  private dirty = false;
  private running: Promise<void> | null = null;
  private _stopped = false;

  constructor(private save: () => Promise<void>, private delayMs: number, private timers: Timers = realTimers) {}

  get stopped(): boolean { return this._stopped; }

  /** Call on every edit. */
  touch(): void {
    if (this._stopped) return;
    this.dirty = true;
    if (this.running) return; // scheduled when the running save finishes
    if (this.timer !== null) this.timers.clear(this.timer);
    this.timer = this.timers.set(() => { this.timer = null; void this.run(); }, this.delayMs);
  }

  /** Save now if anything is pending (before closing, before submitting). */
  async flush(): Promise<void> {
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
    if (this.running) await this.running;
    if (this.dirty && !this._stopped) await this.run();
  }

  stop(): void {
    this._stopped = true;
    if (this.timer !== null) { this.timers.clear(this.timer); this.timer = null; }
  }

  private run(): Promise<void> {
    if (this._stopped || !this.dirty) return Promise.resolve();
    this.dirty = false;
    this.running = this.save()
      .catch(() => { this.stop(); })
      .finally(() => {
        this.running = null;
        if (this.dirty && !this._stopped) this.touch();
      });
    return this.running;
  }
}
```

- [ ] **Step 8: Strings.** Add these to `src/i18n/ui.ts`, in the `en` block after `'admin.audit.verifyBroken'` and in the `tr` block after its Turkish counterpart. The keys are identical and only the values differ. If later tasks need another key, add it to both blocks; the i18n test enforces this.

```ts
// en
'admin.social.heading': 'Social media',
'admin.social.intro': 'Plan the month, prepare posts and send them for approval. Nothing is published to Instagram or LinkedIn yet; that comes with the next phase.',
'admin.social.loadFailed': 'Could not load the social media panel.',
'admin.social.tab.calendar': 'Calendar',
'admin.social.tab.pending': 'Awaiting approval',
'admin.social.tab.drafts': 'Undated drafts',
'admin.social.tab.events': 'Event mode',
'admin.social.view.calendar': 'Calendar',
'admin.social.view.board': 'Board',
'admin.social.nav.prev': 'Previous month',
'admin.social.nav.next': 'Next month',
'admin.social.nav.today': 'Today',
'admin.social.newPlan': '+ Plan slot',
'admin.social.newPost': '+ Post',
'admin.social.legend.plan': 'Plan (no content yet)',
'admin.social.legend.due': 'Plan due soon, still empty',
'admin.social.board.plan': 'Plans',
'admin.social.board.draft': 'Drafts and sent back',
'admin.social.board.pending': 'Awaiting approval',
'admin.social.board.scheduled': 'Scheduled',
'admin.social.board.done': 'Done or cancelled',
'admin.social.empty': 'Nothing here yet.',
'admin.social.status.draft': 'Draft',
'admin.social.status.pending_approval': 'Awaiting approval',
'admin.social.status.scheduled': 'Scheduled',
'admin.social.status.published': 'Published',
'admin.social.status.partially_published': 'Partly published',
'admin.social.status.failed': 'Failed',
'admin.social.status.rejected': 'Sent back',
'admin.social.status.cancelled': 'Cancelled',
'admin.social.status.plan': 'Plan',
'admin.social.type.image': 'Single image',
'admin.social.type.carousel': 'Carousel',
'admin.social.type.story': 'Story',
'admin.social.side.close': 'Close',
'admin.social.side.when': 'When',
'admin.social.side.platforms': 'Platforms',
'admin.social.side.assignee': 'Responsible',
'admin.social.side.author': 'Prepared by',
'admin.social.side.note': 'Note',
'admin.social.side.reviewNote': 'Why it was sent back',
'admin.social.side.readOnly': 'Read only: this post belongs to someone else.',
'admin.social.side.dueSoon': 'Due in less than two days and still empty.',
'admin.social.action.addContent': 'Add content',
'admin.social.action.editPlan': 'Edit plan',
'admin.social.action.deletePlan': 'Delete plan',
'admin.social.action.edit': 'Edit',
'admin.social.action.open': 'Open',
'admin.social.action.submit': 'Send for approval',
'admin.social.action.schedule': 'Schedule',
'admin.social.action.approve': 'Approve and schedule',
'admin.social.action.reject': 'Send back',
'admin.social.action.rejectConfirm': 'Send back with this note',
'admin.social.action.cancel': 'Cancel post',
'admin.social.action.delete': 'Delete',
'admin.social.action.confirm': 'Click again to confirm',
'admin.social.rejectNote': 'What should change? (required)',
'admin.social.done.saved': 'Saved.',
'admin.social.done.submitted': 'Sent for approval.',
'admin.social.done.scheduled': 'Scheduled.',
'admin.social.done.approved': 'Approved and scheduled.',
'admin.social.done.rejected': 'Sent back to the author.',
'admin.social.done.cancelled': 'Cancelled.',
'admin.social.done.deleted': 'Deleted.',
'admin.social.plan.newTitle': 'New plan slot',
'admin.social.plan.editTitle': 'Edit plan slot',
'admin.social.plan.title': 'Title',
'admin.social.plan.date': 'Date',
'admin.social.plan.time': 'Time',
'admin.social.plan.platforms': 'Platforms',
'admin.social.plan.type': 'Type',
'admin.social.plan.assignee': 'Responsible',
'admin.social.plan.nobody': 'Nobody yet',
'admin.social.plan.note': 'Note (optional)',
'admin.social.plan.save': 'Save plan',
'admin.social.plan.cancel': 'Close',
'admin.social.composer.newTitle': 'New post',
'admin.social.composer.editTitle': 'Edit post',
'admin.social.composer.viewTitle': 'Post',
'admin.social.composer.fromPlan': 'For plan: {title}',
'admin.social.composer.type': 'Type',
'admin.social.composer.platforms': 'Where to post',
'admin.social.composer.xLater': 'X (not connected)',
'admin.social.composer.images': 'Images',
'admin.social.composer.imagesHint': 'The first image is the cover. Up to 10 for a carousel.',
'admin.social.composer.addImages': '+ Add images',
'admin.social.composer.uploading': 'Uploading...',
'admin.social.composer.uploadFailed': 'Upload failed: {detail}',
'admin.social.composer.alt': 'Alt text (required): what is in the image?',
'admin.social.composer.moveUp': 'Move earlier',
'admin.social.composer.moveDown': 'Move later',
'admin.social.composer.remove': 'Remove',
'admin.social.composer.caption': 'Text',
'admin.social.composer.captionShared': 'Shared text',
'admin.social.composer.captionFor': 'Only for {platform}',
'admin.social.composer.overrideHint': 'Leave empty to use the shared text.',
'admin.social.composer.storyNoCaption': 'Stories show no text; only the image goes out.',
'admin.social.composer.count': '{platform}: {chars} / {limit} characters',
'admin.social.composer.hashtags': '{count} / {limit} hashtags',
'admin.social.composer.link': 'Link (optional)',
'admin.social.composer.linkHint': 'On LinkedIn the link is clickable. On Instagram, captions cannot hold links, so "Link profilde" is added and the link goes to the links page.',
'admin.social.composer.when': 'When',
'admin.social.composer.timeHint': 'Türkiye time',
'admin.social.composer.checklist': 'Before it can go out',
'admin.social.composer.ready': 'Ready to go.',
'admin.social.composer.saveDraft': 'Save draft',
'admin.social.composer.save': 'Save',
'admin.social.composer.close': 'Close',
'admin.social.composer.closeConfirm': 'Unsaved changes will be lost. Click again to close.',
'admin.social.composer.backToApproval': 'This post is scheduled. Saving your changes sends it back for approval.',
'admin.social.composer.autosaved': 'Saved automatically at {time}',
'admin.social.composer.autosaveStopped': 'Autosave stopped: this post was changed elsewhere. Close and reopen it.',
'admin.social.composer.planTakenNow': 'Someone already added content to that plan. Your post was saved as a normal draft.',
'admin.social.composer.preview': 'Preview',
'admin.social.composer.previewInstagram': 'Instagram',
'admin.social.composer.previewStory': 'Story',
'admin.social.composer.previewLinkedin': 'LinkedIn',
'admin.social.composer.more': '... more',
'admin.social.composer.noImage': 'No image yet',
'admin.social.events.intro': 'During an open window, the editors named in it can publish stories without approval. Published media cannot be deleted through the API, so keep windows short and to trusted editors.',
'admin.social.events.none': 'No event windows.',
'admin.social.events.active': 'Open now',
'admin.social.events.upcoming': 'Not started',
'admin.social.events.ended': 'Ended',
'admin.social.events.editors': 'Editors: {list}',
'admin.social.events.close': 'Close window',
'admin.social.events.newTitle': 'Open an event window',
'admin.social.events.name': 'Name',
'admin.social.events.start': 'Starts',
'admin.social.events.end': 'Ends (at most 7 days later)',
'admin.social.events.pickEditors': 'Editors whose stories skip approval',
'admin.social.events.open': 'Open window',
'admin.social.events.opened': 'Event window opened.',
'admin.social.events.closed': 'Event window closed.',
'admin.social.problem.no_platform': 'Choose at least one platform.',
'admin.social.problem.platform_unavailable': '{platform} is not available yet.',
'admin.social.problem.story_instagram_only': 'Stories go to Instagram only.',
'admin.social.problem.media_count': 'Wrong number of images: one for a single post or story, 2 to 10 for a carousel.',
'admin.social.problem.missing_alt': 'Image {n} has no alt text.',
'admin.social.problem.unknown_media': 'Image {n} was not uploaded through the panel. Remove it and add it again.',
'admin.social.problem.bad_ratio': 'Image {n} has the wrong shape: posts need 4:5 to 1.91:1, stories 9:16.',
'admin.social.problem.caption_too_long': '{platform} text is too long: {actual} of {limit} characters.',
'admin.social.problem.too_many_hashtags': '{platform} allows {limit} hashtags; this has {actual}.',
'admin.social.problem.no_schedule': 'Choose a date and time.',
'admin.social.problem.schedule_in_past': 'The time has already passed.',
'admin.social.problem.schedule_too_far': 'That is more than 60 days ahead.',
'admin.social.problem.invalid_schedule_time': 'That date or time is not valid.',
'admin.social.problem.unknown': 'Something still needs fixing.',
'admin.social.error.post_changed': 'Someone changed this post in the meantime. Reopen it to see the latest version.',
'admin.social.error.not_ready': 'The post is not ready yet; see the list of what to fix.',
'admin.social.error.not_pending': 'This post is no longer waiting for approval.',
'admin.social.error.not_found': 'That item no longer exists.',
'admin.social.error.not_allowed': 'You are not allowed to do that with this post.',
'admin.social.error.not_submittable': 'Only drafts and sent-back posts can be sent for approval.',
'admin.social.error.not_deletable': 'Only drafts and sent-back posts can be deleted. Cancel it instead.',
'admin.social.error.not_cancellable': 'Only posts awaiting approval or scheduled can be cancelled.',
'admin.social.error.plan_taken': 'Someone already added content to this plan.',
'admin.social.error.plan_has_post': 'This plan already has a post; delete or cancel the post first.',
'admin.social.error.already_closed': 'That event window is already closed.',
'admin.social.error.invalid_plan': 'That plan no longer exists.',
'admin.social.error.invalid_title': 'The title must be 1 to 120 characters.',
'admin.social.error.invalid_platforms': 'Choose at least one available platform.',
'admin.social.error.invalid_post_type': 'Choose a type.',
'admin.social.error.invalid_assignee': 'That person cannot be responsible for social media.',
'admin.social.error.invalid_note': 'The note must be 1 to 500 characters.',
'admin.social.error.invalid_name': 'The name must be 1 to 80 characters.',
'admin.social.error.invalid_window': 'The window must end after it starts, and in the future.',
'admin.social.error.window_too_long': 'A window can be at most 7 days long.',
'admin.social.error.invalid_editors': 'Choose at least one social media editor.',
'admin.social.error.invalid_range': 'That date range is too long.',
'admin.social.error.schedule_in_past': 'The time has already passed.',
'admin.social.error.schedule_too_far': 'That is more than 60 days ahead.',
'admin.social.error.invalid_schedule_time': 'That date or time is not valid.',
'admin.social.error.invalid_type': 'Choose a type.',
'admin.social.error.invalid_caption': 'The text is too long.',
'admin.social.error.invalid_overrides': 'One of the platform texts is not valid.',
'admin.social.error.invalid_link': 'The link must start with https:// and be a valid address.',
'admin.social.error.invalid_media': 'One of the images is not valid. Remove it and add it again.',
'admin.social.error.too_many_items': 'At most 10 images.',
'admin.social.error.invalid_schedule': 'That date or time is not valid.',
'admin.social.error.malformed_request': 'The panel sent something the server did not understand. Reload the page.',
'admin.social.error.unknown': 'That did not work. Try again in a moment.',
```

```ts
// tr
'admin.social.heading': 'Sosyal medya',
'admin.social.intro': "Ayı planla, gönderileri hazırla ve onaya gönder. Henüz hiçbir şey Instagram'a ya da LinkedIn'e gitmiyor; o sonraki aşamada geliyor.",
'admin.social.loadFailed': 'Sosyal medya paneli yüklenemedi.',
'admin.social.tab.calendar': 'Takvim',
'admin.social.tab.pending': 'Onay bekleyen',
'admin.social.tab.drafts': 'Tarihsiz taslaklar',
'admin.social.tab.events': 'Etkinlik modu',
'admin.social.view.calendar': 'Takvim',
'admin.social.view.board': 'Pano',
'admin.social.nav.prev': 'Önceki ay',
'admin.social.nav.next': 'Sonraki ay',
'admin.social.nav.today': 'Bugün',
'admin.social.newPlan': '+ Plan kutusu',
'admin.social.newPost': '+ Gönderi',
'admin.social.legend.plan': 'Plan (içerik yok)',
'admin.social.legend.due': 'Zamanı yaklaşan boş plan',
'admin.social.board.plan': 'Planlar',
'admin.social.board.draft': 'Taslaklar ve geri çevrilenler',
'admin.social.board.pending': 'Onay bekliyor',
'admin.social.board.scheduled': 'Zamanlandı',
'admin.social.board.done': 'Bitti ya da iptal',
'admin.social.empty': 'Burada henüz bir şey yok.',
'admin.social.status.draft': 'Taslak',
'admin.social.status.pending_approval': 'Onay bekliyor',
'admin.social.status.scheduled': 'Zamanlandı',
'admin.social.status.published': 'Yayınlandı',
'admin.social.status.partially_published': 'Kısmen yayınlandı',
'admin.social.status.failed': 'Başarısız',
'admin.social.status.rejected': 'Geri çevrildi',
'admin.social.status.cancelled': 'İptal edildi',
'admin.social.status.plan': 'Plan',
'admin.social.type.image': 'Tek görsel',
'admin.social.type.carousel': 'Carousel',
'admin.social.type.story': 'Story',
'admin.social.side.close': 'Kapat',
'admin.social.side.when': 'Ne zaman',
'admin.social.side.platforms': 'Platformlar',
'admin.social.side.assignee': 'Sorumlu',
'admin.social.side.author': 'Hazırlayan',
'admin.social.side.note': 'Not',
'admin.social.side.reviewNote': 'Geri çevrilme nedeni',
'admin.social.side.readOnly': 'Yalnızca görüntüleme: bu gönderi başkasına ait.',
'admin.social.side.dueSoon': 'İki günden az kaldı ve hâlâ boş.',
'admin.social.action.addContent': 'İçerik ekle',
'admin.social.action.editPlan': 'Planı düzenle',
'admin.social.action.deletePlan': 'Planı sil',
'admin.social.action.edit': 'Düzenle',
'admin.social.action.open': 'Aç',
'admin.social.action.submit': 'Onaya gönder',
'admin.social.action.schedule': 'Zamanla',
'admin.social.action.approve': 'Onayla ve zamanla',
'admin.social.action.reject': 'Geri çevir',
'admin.social.action.rejectConfirm': 'Bu notla geri çevir',
'admin.social.action.cancel': 'Gönderiyi iptal et',
'admin.social.action.delete': 'Sil',
'admin.social.action.confirm': 'Onaylamak için tekrar tıkla',
'admin.social.rejectNote': 'Ne değişmeli? (zorunlu)',
'admin.social.done.saved': 'Kaydedildi.',
'admin.social.done.submitted': 'Onaya gönderildi.',
'admin.social.done.scheduled': 'Zamanlandı.',
'admin.social.done.approved': 'Onaylandı ve zamanlandı.',
'admin.social.done.rejected': 'Hazırlayana geri gönderildi.',
'admin.social.done.cancelled': 'İptal edildi.',
'admin.social.done.deleted': 'Silindi.',
'admin.social.plan.newTitle': 'Yeni plan kutusu',
'admin.social.plan.editTitle': 'Plan kutusunu düzenle',
'admin.social.plan.title': 'Başlık',
'admin.social.plan.date': 'Tarih',
'admin.social.plan.time': 'Saat',
'admin.social.plan.platforms': 'Platformlar',
'admin.social.plan.type': 'Tür',
'admin.social.plan.assignee': 'Sorumlu',
'admin.social.plan.nobody': 'Henüz kimse',
'admin.social.plan.note': 'Not (isteğe bağlı)',
'admin.social.plan.save': 'Planı kaydet',
'admin.social.plan.cancel': 'Kapat',
'admin.social.composer.newTitle': 'Yeni gönderi',
'admin.social.composer.editTitle': 'Gönderiyi düzenle',
'admin.social.composer.viewTitle': 'Gönderi',
'admin.social.composer.fromPlan': 'Plan: {title}',
'admin.social.composer.type': 'Tür',
'admin.social.composer.platforms': 'Nerede paylaşılsın',
'admin.social.composer.xLater': 'X (bağlı değil)',
'admin.social.composer.images': 'Görseller',
'admin.social.composer.imagesHint': "İlk görsel kapak olur. Carousel'de en fazla 10.",
'admin.social.composer.addImages': '+ Görsel ekle',
'admin.social.composer.uploading': 'Yükleniyor...',
'admin.social.composer.uploadFailed': 'Yükleme başarısız: {detail}',
'admin.social.composer.alt': 'Alt metin (zorunlu): görselde ne var?',
'admin.social.composer.moveUp': 'Öne al',
'admin.social.composer.moveDown': 'Geri al',
'admin.social.composer.remove': 'Kaldır',
'admin.social.composer.caption': 'Metin',
'admin.social.composer.captionShared': 'Ortak metin',
'admin.social.composer.captionFor': 'Yalnızca {platform}',
'admin.social.composer.overrideHint': 'Boş bırakırsan ortak metin kullanılır.',
'admin.social.composer.storyNoCaption': "Story'de metin görünmez; yalnızca görsel gider.",
'admin.social.composer.count': '{platform}: {chars} / {limit} karakter',
'admin.social.composer.hashtags': '{count} / {limit} hashtag',
'admin.social.composer.link': 'Link (isteğe bağlı)',
'admin.social.composer.linkHint': "LinkedIn'de link tıklanabilir. Instagram açıklamada link göstermediği için \"Link profilde\" eklenir ve link, linkler sayfasına gider.",
'admin.social.composer.when': 'Ne zaman',
'admin.social.composer.timeHint': 'Türkiye saati',
'admin.social.composer.checklist': 'Yayına çıkmadan önce',
'admin.social.composer.ready': 'Hazır.',
'admin.social.composer.saveDraft': 'Taslak olarak kaydet',
'admin.social.composer.save': 'Kaydet',
'admin.social.composer.close': 'Kapat',
'admin.social.composer.closeConfirm': 'Kaydedilmemiş değişiklikler silinecek. Kapatmak için tekrar tıkla.',
'admin.social.composer.backToApproval': 'Bu gönderi zamanlanmış. Değişikliklerini kaydedersen gönderi yeniden onaya düşer.',
'admin.social.composer.autosaved': '{time} itibarıyla otomatik kaydedildi',
'admin.social.composer.autosaveStopped': 'Otomatik kayıt durdu: bu gönderi başka yerden değiştirildi. Kapatıp yeniden aç.',
'admin.social.composer.planTakenNow': 'O plana başkası içerik ekledi. Gönderin normal bir taslak olarak kaydedildi.',
'admin.social.composer.preview': 'Önizleme',
'admin.social.composer.previewInstagram': 'Instagram',
'admin.social.composer.previewStory': 'Story',
'admin.social.composer.previewLinkedin': 'LinkedIn',
'admin.social.composer.more': '... devamı',
'admin.social.composer.noImage': 'Henüz görsel yok',
'admin.social.events.intro': 'Açık bir pencere boyunca, pencerede adı geçen editörler story\'leri onaysız yayınlayabilir. Yayınlanan içerik API ile silinemez; pencereleri kısa tut ve yalnızca güvendiğin editörleri ekle.',
'admin.social.events.none': 'Etkinlik penceresi yok.',
'admin.social.events.active': 'Şu an açık',
'admin.social.events.upcoming': 'Başlamadı',
'admin.social.events.ended': 'Bitti',
'admin.social.events.editors': 'Editörler: {list}',
'admin.social.events.close': 'Pencereyi kapat',
'admin.social.events.newTitle': 'Etkinlik penceresi aç',
'admin.social.events.name': 'Ad',
'admin.social.events.start': 'Başlangıç',
'admin.social.events.end': 'Bitiş (en fazla 7 gün sonra)',
'admin.social.events.pickEditors': "Story'leri onaysız gidecek editörler",
'admin.social.events.open': 'Pencereyi aç',
'admin.social.events.opened': 'Etkinlik penceresi açıldı.',
'admin.social.events.closed': 'Etkinlik penceresi kapatıldı.',
'admin.social.problem.no_platform': 'En az bir platform seç.',
'admin.social.problem.platform_unavailable': '{platform} henüz kullanılamıyor.',
'admin.social.problem.story_instagram_only': "Story'ler yalnızca Instagram'a gider.",
'admin.social.problem.media_count': "Görsel sayısı uygun değil: tek gönderi ya da story için bir, carousel için 2 ile 10 arası.",
'admin.social.problem.missing_alt': '{n}. görselin alt metni yok.',
'admin.social.problem.unknown_media': '{n}. görsel panelden yüklenmemiş. Kaldırıp yeniden ekle.',
'admin.social.problem.bad_ratio': "{n}. görselin oranı uygun değil: gönderiler 4:5 ile 1.91:1 arası, story'ler 9:16 olmalı.",
'admin.social.problem.caption_too_long': '{platform} metni çok uzun: {actual} / {limit} karakter.',
'admin.social.problem.too_many_hashtags': '{platform} en fazla {limit} hashtag kabul ediyor; bu metinde {actual} var.',
'admin.social.problem.no_schedule': 'Bir tarih ve saat seç.',
'admin.social.problem.schedule_in_past': 'Seçilen zaman geçmiş.',
'admin.social.problem.schedule_too_far': 'Bu, 60 günden daha ileride.',
'admin.social.problem.invalid_schedule_time': 'Tarih ya da saat geçerli değil.',
'admin.social.problem.unknown': 'Hâlâ düzeltilmesi gereken bir şey var.',
'admin.social.error.post_changed': 'Bu gönderiyi bu arada başkası değiştirdi. En son hâlini görmek için yeniden aç.',
'admin.social.error.not_ready': 'Gönderi henüz hazır değil; düzeltilecekler listesine bak.',
'admin.social.error.not_pending': 'Bu gönderi artık onay beklemiyor.',
'admin.social.error.not_found': 'Bu öğe artık yok.',
'admin.social.error.not_allowed': 'Bu gönderiyle bunu yapma yetkin yok.',
'admin.social.error.not_submittable': 'Yalnızca taslaklar ve geri çevrilenler onaya gönderilebilir.',
'admin.social.error.not_deletable': 'Yalnızca taslaklar ve geri çevrilenler silinebilir. Bunun yerine iptal et.',
'admin.social.error.not_cancellable': 'Yalnızca onay bekleyen ya da zamanlanmış gönderiler iptal edilebilir.',
'admin.social.error.plan_taken': 'Bu plana başkası zaten içerik ekledi.',
'admin.social.error.plan_has_post': 'Bu planın bir gönderisi var; önce gönderiyi sil ya da iptal et.',
'admin.social.error.already_closed': 'Bu etkinlik penceresi zaten kapalı.',
'admin.social.error.invalid_plan': 'Bu plan artık yok.',
'admin.social.error.invalid_title': 'Başlık 1 ile 120 karakter arasında olmalı.',
'admin.social.error.invalid_platforms': 'Kullanılabilir en az bir platform seç.',
'admin.social.error.invalid_post_type': 'Bir tür seç.',
'admin.social.error.invalid_assignee': 'Bu kişi sosyal medya sorumlusu olamaz.',
'admin.social.error.invalid_note': 'Not 1 ile 500 karakter arasında olmalı.',
'admin.social.error.invalid_name': 'Ad 1 ile 80 karakter arasında olmalı.',
'admin.social.error.invalid_window': 'Pencere başladıktan sonra ve gelecekte bitmeli.',
'admin.social.error.window_too_long': 'Bir pencere en fazla 7 gün sürebilir.',
'admin.social.error.invalid_editors': 'En az bir sosyal medya editörü seç.',
'admin.social.error.invalid_range': 'Tarih aralığı çok uzun.',
'admin.social.error.schedule_in_past': 'Seçilen zaman geçmiş.',
'admin.social.error.schedule_too_far': 'Bu, 60 günden daha ileride.',
'admin.social.error.invalid_schedule_time': 'Tarih ya da saat geçerli değil.',
'admin.social.error.invalid_type': 'Bir tür seç.',
'admin.social.error.invalid_caption': 'Metin çok uzun.',
'admin.social.error.invalid_overrides': 'Platform metinlerinden biri geçerli değil.',
'admin.social.error.invalid_link': 'Link https:// ile başlamalı ve geçerli bir adres olmalı.',
'admin.social.error.invalid_media': 'Görsellerden biri geçerli değil. Kaldırıp yeniden ekle.',
'admin.social.error.too_many_items': 'En fazla 10 görsel.',
'admin.social.error.invalid_schedule': 'Tarih ya da saat geçerli değil.',
'admin.social.error.malformed_request': 'Panel sunucunun anlamadığı bir şey gönderdi. Sayfayı yenile.',
'admin.social.error.unknown': 'Olmadı. Biraz sonra tekrar dene.',
```

- [ ] **Step 9: Run the tests**

Run: `node --import tsx --test tests/social-calendar.test.ts tests/social-autosave.test.ts tests/admin-social-i18n.test.ts`
Expected:
- `social-calendar` and `social-autosave`: PASS.
- `admin-social-i18n`: its first and third tests PASS. Its second test ("every key the social scripts look up") has nothing to scan yet (only `messages.ts` exists), so it fails on `used.size > 40`. Temporarily lower that assertion to `used.size >= 0` in this commit, with the comment `// raised to > 40 in Task 3, when the views exist`. Task 3 raises it back.

Then run `npm test` and `npx astro check`.

- [ ] **Step 10: Commit**

```bash
git add src/lib/social-calendar.ts src/scripts/social src/i18n/ui.ts tests/social-calendar.test.ts tests/social-autosave.test.ts tests/admin-social-i18n.test.ts
git commit -m "Social panel groundwork: calendar math, API client, messages, autosave queue, strings"
```

---

### Task 2: Access for social roles, the pane, and JPEG uploads

**Files:**
- Create: `src/components/admin/panes/SocialPane.astro`, `src/scripts/social/index.ts`
- Modify: `src/components/admin/AdminNav.astro`, `src/components/admin/AdminShell.astro`, `src/scripts/admin-panel.ts`, `src/scripts/image-upload.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `setupSocial(d: SocialDeps): void`, `loadSocial(): Promise<void>`
  - `uploadSocialImage(file: File): Promise<{ url: string; key: string; width: number; height: number }>`
  - Element ids in the pane: `socialTabs`, `socialPendingCount`, `socialCalendar`, `socialSide`, `socialMonth`, `socialPrev`, `socialNext`, `socialToday`, `socialViewCalendar`, `socialViewBoard`, `socialNewPlan`, `socialNewPost`, `socialPendingList`, `socialDraftList`, `socialEventList`, `socialEventForm`, `socialOverlay`.
  - Attributes: `data-social-tab="calendar|pending|drafts|events"` and `data-social-view` (same names). `data-publisher-only` marks elements editors must not see.

- [ ] **Step 1: `src/components/admin/panes/SocialPane.astro`**

```astro
---
/**
 * The social media pane: a calendar-first view with a board toggle, plus
 * approval, drafts and event-mode tabs (spec §2). Markup is a skeleton; the
 * views are rendered by src/scripts/social/*.
 */
import { useTranslations } from '../../../i18n/ui';
interface Props { lang: 'en' | 'tr' }
const { lang } = Astro.props;
const t = useTranslations(lang);
const tabClass = 'social-tab px-3 py-2 text-sm text-gray-500 border-b-2 border-transparent hover:text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const btn = 'px-3 py-1.5 rounded-lg border border-border text-sm text-navy hover:bg-navy-light focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
---
<div data-pane="social">
  <h2 class="text-lg font-semibold text-navy mb-1">{t('admin.social.heading')}</h2>
  <p class="text-sm text-gray-500 mb-4">{t('admin.social.intro')}</p>

  <div id="socialTabs" class="flex flex-wrap gap-1 border-b border-border mb-4">
    <button type="button" data-social-tab="calendar" class={tabClass}>{t('admin.social.tab.calendar')}</button>
    <button type="button" data-social-tab="pending" data-publisher-only class={tabClass}>
      {t('admin.social.tab.pending')} <span id="socialPendingCount" class="hidden ml-1 inline-block min-w-5 px-1.5 rounded-full bg-red text-white text-xs text-center"></span>
    </button>
    <button type="button" data-social-tab="drafts" class={tabClass}>{t('admin.social.tab.drafts')}</button>
    <button type="button" data-social-tab="events" class={tabClass}>{t('admin.social.tab.events')}</button>
  </div>

  <section data-social-view="calendar">
    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
      <div class="flex items-center gap-2">
        <button type="button" id="socialPrev" class={btn} aria-label={t('admin.social.nav.prev')}>‹</button>
        <strong id="socialMonth" class="min-w-36 text-center text-navy"></strong>
        <button type="button" id="socialNext" class={btn} aria-label={t('admin.social.nav.next')}>›</button>
        <button type="button" id="socialToday" class={btn}>{t('admin.social.nav.today')}</button>
      </div>
      <div class="inline-flex rounded-lg border border-border overflow-hidden" role="group">
        <button type="button" id="socialViewCalendar" class="px-3 py-1.5 text-sm">{t('admin.social.view.calendar')}</button>
        <button type="button" id="socialViewBoard" class="px-3 py-1.5 text-sm">{t('admin.social.view.board')}</button>
      </div>
      <div class="flex gap-2">
        <button type="button" id="socialNewPlan" class={btn}>{t('admin.social.newPlan')}</button>
        <button type="button" id="socialNewPost" class="px-3 py-1.5 rounded-lg bg-navy text-white text-sm font-medium">{t('admin.social.newPost')}</button>
      </div>
    </div>
    <div class="flex flex-col xl:flex-row gap-4 items-start">
      <div id="socialCalendar" class="flex-1 min-w-0 w-full overflow-x-auto"></div>
      <aside id="socialSide" class="hidden w-full xl:w-80 shrink-0 bg-white rounded-2xl border border-border p-4"></aside>
    </div>
  </section>

  <section data-social-view="pending" class="hidden"><div id="socialPendingList"></div></section>
  <section data-social-view="drafts" class="hidden"><div id="socialDraftList"></div></section>
  <section data-social-view="events" class="hidden">
    <p class="text-sm text-gray-500 mb-3">{t('admin.social.events.intro')}</p>
    <div id="socialEventList" class="mb-6"></div>
    <form id="socialEventForm" data-publisher-only class="bg-white rounded-2xl border border-border p-4"></form>
  </section>

  <div id="socialOverlay" class="hidden fixed inset-0 z-40 bg-black/30 overflow-y-auto p-4"></div>
</div>
```

- [ ] **Step 2: Nav and shell.**
  - `AdminNav.astro`: add `{ pane: 'social', label: t('admin.social.heading') },` after the `symposium` item.
  - `AdminShell.astro`: add `import SocialPane from './panes/SocialPane.astro';` next to the `SymposiumPane` import, and `<SocialPane lang={lang} />` right after `<SymposiumPane lang={lang} />`.

- [ ] **Step 3: `uploadSocialImage`.** Append to `src/scripts/image-upload.ts`:

```ts
export interface SocialUpload { url: string; key: string; width: number; height: number }

/**
 * For social posts: always JPEG (Instagram accepts nothing else), longest
 * side at most 2000px, transparent areas filled white so a PNG logo does not
 * turn black. Returns the server-measured size along with the key; the
 * composer's ratio check uses it and the server re-checks on submit.
 */
export async function uploadSocialImage(file: File): Promise<SocialUpload> {
  let body: Blob = file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
      if (jpeg && jpeg.size > 0) body = jpeg;
    }
    bitmap.close();
  } catch {
    // Not decodable in this browser: send it as is and let the server judge.
  }
  const res = await fetch('/api/blog-submissions/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': body.type || file.type },
    body,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? `Upload failed (${res.status})`);
  }
  return (await res.json()) as SocialUpload;
}
```

- [ ] **Step 4: `src/scripts/social/index.ts`** (tab switching and loading; the views come in Tasks 3 to 5, so this task ships placeholder loaders that Tasks 3 to 5 replace):

```ts
/**
 * Entry point for the social pane. setupSocial wires tabs and toolbar once;
 * loadSocial runs the first time the pane is shown (admin-panel.ts pane
 * loaders), and again on every changed() signal.
 */
import { setDeps, deps, onChange, type SocialDeps } from './context';

type Tab = 'calendar' | 'pending' | 'drafts' | 'events';
const TABS: Tab[] = ['calendar', 'pending', 'drafts', 'events'];
const loaders: Record<Tab, () => Promise<void>> = {
  calendar: async () => {},
  pending: async () => {},
  drafts: async () => {},
  events: async () => {},
};
let current: Tab = 'calendar';

/** Tasks 3 to 5 register their view loaders here. */
export function registerView(tab: Tab, load: () => Promise<void>): void {
  loaders[tab] = load;
}

/** Runs on setup and on every change, for publishers only: the count beside "Awaiting approval". */
let refreshPendingCount: () => Promise<void> = async () => {};
export function registerPendingCount(fn: () => Promise<void>): void { refreshPendingCount = fn; }

function showTab(tab: Tab): void {
  current = tab;
  document.querySelectorAll<HTMLButtonElement>('[data-social-tab]').forEach((b) => {
    const on = b.dataset.socialTab === tab;
    b.classList.toggle('border-red', on);
    b.classList.toggle('text-navy', on);
    b.classList.toggle('font-medium', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll<HTMLElement>('[data-social-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.socialView !== tab));
  void reloadCurrent();
}

async function reloadCurrent(): Promise<void> {
  try {
    await loaders[current]();
  } catch {
    deps().showToast(deps().t('admin.social.loadFailed'), true);
  }
}

export function setupSocial(d: SocialDeps): void {
  setDeps(d);
  if (!d.me.isPublisher) document.querySelectorAll('[data-pane="social"] [data-publisher-only]').forEach((el) => el.remove());
  document.querySelectorAll<HTMLButtonElement>('[data-social-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      const tab = b.dataset.socialTab as Tab;
      if (TABS.includes(tab)) showTab(tab);
    });
  });
  onChange(() => { void reloadCurrent(); void refreshPendingCount().catch(() => {}); });
}

export async function loadSocial(): Promise<void> {
  showTab('calendar');
  await refreshPendingCount().catch(() => {});
}
```

- [ ] **Step 5: `src/scripts/admin-panel.ts`**:

1. **Import.** `import { setupSocial, loadSocial } from './social';`.

2. **`applyRoleVisibility`:**
   - The parameter type gains `isSocial: boolean`.
   - The full-admin list gains `'social'` after `'symposium'`.
   - The other branch gains `...(roles.isSocial ? ['social'] : []),`.

3. **`runPaneLoader`.** Replace the ternary with a map:

   ```ts
   const LOAD_FAILED: Record<string, string> = {
     audit: 'admin.audit.loadFailed',
     connections: 'admin.connections.loadFailed',
     social: 'admin.social.loadFailed',
   };
   ```

   and `loader().catch(() => showToast(t((Object.hasOwn(LOAD_FAILED, pane) ? LOAD_FAILED[pane] : 'admin.social.loadFailed') as never), true));`.

4. **Bootstrap gate.** Change the condition to `if (!data.user || (!data.user.is_admin && !data.user.is_announcer && !data.user.is_symposium && !data.user.is_social && !data.user.is_social_publisher))`.

5. **Social flags.** After `const isSymposium = ...` add:

   ```ts
     const isSocial = data.user.is_social === true || data.user.is_social_publisher === true;
     const isSocialPublisher = isFullAdmin || data.user.is_social_publisher === true;
   ```

   Pass `isSocial` to `applyRoleVisibility({ isFullAdmin, isAnnouncer, isSymposium, isSocial }, ...)`.

6. **Wire the pane.** After the `if (isFullAdmin) { setupConnections... }` block, add:

   ```ts
     if (isFullAdmin || isSocial) {
       setupSocial({
         t: t as (k: string) => string,
         tf: tf as (k: string, v: Record<string, string | number>) => string,
         showToast, lang, me: { id: data.user.id, isPublisher: isSocialPublisher },
       });
       registerPaneLoader('social', loadSocial);
     }
   ```

7. **Check the bootstrap for a social-only user.** Read the rest of the bootstrap with a social-only user in mind (no admin, announcer or symposium flag). Every setup or load must already sit behind its own flag. If anything outside those guards assumes another role's DOM exists (`getElementById(...)!` on an element only another pane renders), guard it with that role's flag. Note what you changed in the report.

- [ ] **Step 6: Verify**

Run: `npm test && npx astro check && npm run build`
Expected: all pass. The i18n test still uses its temporary `>= 0` assertion.

- [ ] **Step 7: Commit**

```bash
git add src/components/admin src/scripts/social/index.ts src/scripts/admin-panel.ts src/scripts/image-upload.ts
git commit -m "Social pane in /admin, open to social roles; JPEG uploads for posts"
```

---

### Task 3: Calendar, board, side panel and plan dialog

**Files:**
- Create: `src/scripts/social/calendar-view.ts`, `src/scripts/social/side-panel.ts`, `src/scripts/social/plan-dialog.ts`, `src/scripts/social/ui.ts`
- Modify: `src/scripts/social/index.ts`, `tests/admin-social-i18n.test.ts` (restore `used.size > 40`)

**Interfaces:**
- Consumes:
  - Task 1 (`api`, `messages`, `social-calendar`, `context`) and Task 2 (`registerView`).
  - `openComposer` from `composer.ts`, which arrives in Task 4. Until then, `side-panel.ts` imports it from a stub `composer.ts` that exports `export async function openComposer(_: { postId?: string; plan?: Plan; date?: string }): Promise<void> {}`. Task 4 replaces the stub.
- Produces:
  - `ui.ts`: `esc`, `button(label, attrs, variant)`, `statusClass(status)`, `overlay`, `closeOverlay()`, `armConfirm(button, run)`
  - `loadCalendar(): Promise<void>`
  - `showSide(kind: 'plan' | 'post', id: string): void`
  - `openPlanDialog(opts: { plan?: Plan; date?: string }): Promise<void>`
  - `editorsCache(): Promise<Editor[]>`

- [ ] **Step 1: `src/scripts/social/ui.ts`**

```ts
/** Small rendering helpers shared by the social views. */
import { escapeHtml } from '../escape-html';
import type { PostStatus } from './api';
import { deps } from './context';

export const esc = escapeHtml;

const VARIANTS = {
  primary: 'bg-navy text-white hover:bg-navy-mid',
  danger: 'border border-red text-red hover:bg-red-tint',
  plain: 'border border-border text-navy hover:bg-navy-light',
  ok: 'border border-green-700 text-green-700 hover:bg-green-50',
} as const;

export function button(label: string, attrs: string, variant: keyof typeof VARIANTS = 'plain'): string {
  return `<button type="button" ${attrs} class="px-3 py-1.5 rounded-lg text-sm font-medium ${VARIANTS[variant]} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${esc(label)}</button>`;
}

/** Colour per status; plans use 'plan' and 'due'. Looked up, never interpolated from the server. */
const STATUS_CLASS: Record<string, string> = {
  plan: 'border border-dashed border-gray-400 text-gray-600 bg-[#f6f7fa]',
  due: 'border border-dashed border-red text-red bg-red-tint',
  draft: 'bg-gray-100 text-gray-700',
  rejected: 'bg-amber-50 text-amber-800',
  pending_approval: 'bg-amber-100 text-amber-900',
  scheduled: 'bg-blue-100 text-blue-900',
  published: 'bg-green-100 text-green-900',
  partially_published: 'bg-green-50 text-green-800',
  failed: 'bg-red-tint text-red',
  cancelled: 'bg-gray-100 text-gray-500 line-through',
};
export const statusClass = (s: PostStatus | 'plan' | 'due') => (Object.hasOwn(STATUS_CLASS, s) ? STATUS_CLASS[s] : STATUS_CLASS.draft);

export const overlay = () => document.getElementById('socialOverlay')!;
export function closeOverlay(): void {
  const o = overlay();
  o.classList.add('hidden');
  o.replaceChildren();
}

/** Two clicks instead of a browser dialog: the panel never uses confirm(). */
export function armConfirm(b: HTMLButtonElement, run: () => Promise<void>): void {
  b.addEventListener('click', () => {
    if (b.dataset.armed !== '1') {
      b.dataset.armed = '1';
      b.dataset.label = b.textContent ?? '';
      b.textContent = deps().t('admin.social.action.confirm');
      return;
    }
    b.disabled = true;
    void run().finally(() => { b.disabled = false; b.dataset.armed = ''; b.textContent = b.dataset.label ?? ''; });
  });
}
```

- [ ] **Step 2: `src/scripts/social/calendar-view.ts`**

```ts
/** Month grid and board for plans and posts (spec §2: calendar first, board toggle remembered per viewer). */
import { api, type Plan, type Post } from './api';
import { deps } from './context';
import { esc, statusClass } from './ui';
import { monthGrid, gridRange, bucketByDay, dayKey, timeOf, shiftMonth, monthOf, planDue } from '../../lib/social-calendar';
import { showSide } from './side-panel';
import { openPlanDialog } from './plan-dialog';
import { openComposer } from './composer';

const VIEW_KEY = 'rsg.social.view';
let year = 0;
let month = 0;
let view: 'calendar' | 'board' = 'calendar';
let plans: Plan[] = [];
let posts: Post[] = [];
let wired = false;

function readView(): 'calendar' | 'board' {
  try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'calendar'; } catch { return 'calendar'; }
}
function writeView(v: 'calendar' | 'board'): void {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: not remembered */ }
}
const now = () => Math.floor(Date.now() / 1000);

function wire(): void {
  if (wired) return;
  wired = true;
  ({ year, month } = monthOf(now()));
  view = readView();
  const go = (delta: number) => { ({ year, month } = shiftMonth(year, month, delta)); void loadCalendar(); };
  document.getElementById('socialPrev')!.addEventListener('click', () => go(-1));
  document.getElementById('socialNext')!.addEventListener('click', () => go(1));
  document.getElementById('socialToday')!.addEventListener('click', () => { ({ year, month } = monthOf(now())); void loadCalendar(); });
  document.getElementById('socialViewCalendar')!.addEventListener('click', () => { view = 'calendar'; writeView(view); render(); });
  document.getElementById('socialViewBoard')!.addEventListener('click', () => { view = 'board'; writeView(view); render(); });
  document.getElementById('socialNewPlan')!.addEventListener('click', () => void openPlanDialog({}));
  document.getElementById('socialNewPost')!.addEventListener('click', () => void openComposer({}));
  document.getElementById('socialCalendar')!.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]');
    if (target) { showSide(target.dataset.entry as 'plan' | 'post', target.dataset.id!); return; }
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (day && (e.target as HTMLElement).closest('[data-add]')) void openPlanDialog({ date: day.dataset.day! });
  });
}

export async function loadCalendar(): Promise<void> {
  wire();
  const { from, to } = gridRange(monthGrid(year, month));
  [plans, posts] = await Promise.all([api.plans(from, to), api.posts(from, to)]);
  render();
}

/** Plans that already have a post are shown as that post, never twice. */
const emptyPlans = () => plans.filter((p) => p.postId === null);

function entry(kind: 'plan' | 'post', id: string, cls: string, label: string): string {
  return `<button type="button" data-entry="${kind}" data-id="${esc(id)}" class="block w-full text-left mt-1 px-1.5 py-0.5 rounded text-xs truncate ${cls}">${esc(label)}</button>`;
}
const postLabel = (p: Post) => p.planTitle || p.caption.trim().split('\n')[0] || deps().t(`admin.social.type.${p.type}`);

function render(): void {
  const { t, lang } = deps();
  const el = document.getElementById('socialCalendar')!;
  document.getElementById('socialMonth')!.textContent = new Date(Date.UTC(year, month - 1, 15))
    .toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  for (const [id, on] of [['socialViewCalendar', view === 'calendar'], ['socialViewBoard', view === 'board']] as const) {
    const b = document.getElementById(id)!;
    b.classList.toggle('bg-navy-light', on);
    b.classList.toggle('font-medium', on);
    b.setAttribute('aria-pressed', String(on));
  }
  el.innerHTML = view === 'calendar' ? grid() : board();

  function grid(): string {
    const days = monthGrid(year, month);
    const today = dayKey(now());
    const byDayPlans = bucketByDay(emptyPlans(), (p) => p.scheduledAt);
    const byDayPosts = bucketByDay(posts, (p) => p.scheduledAt);
    const head = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i))
      .toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }));
    const cells = days.map((d) => {
      const items = [
        ...(byDayPlans.get(d.key) ?? []).map((p) => entry('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), `${timeOf(p.scheduledAt)} ${p.title}`)),
        ...(byDayPosts.get(d.key) ?? []).map((p) => entry('post', p.id, statusClass(p.status), `${p.scheduledAt ? timeOf(p.scheduledAt) : ''} ${postLabel(p)}`)),
      ].join('');
      return `<div data-day="${d.key}" class="group min-h-24 rounded-lg border p-1 text-xs ${d.inMonth ? 'bg-white border-border' : 'bg-[#fafbfd] border-border text-gray-400'} ${d.key === today ? 'ring-2 ring-navy' : ''}">
        <div class="flex justify-between"><span>${d.day}</span><button type="button" data-add aria-label="${esc(t('admin.social.newPlan'))}" class="hidden group-hover:inline text-gray-400 hover:text-navy">+</button></div>${items}</div>`;
    }).join('');
    const legend = `<div class="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
      ${(['plan', 'due', 'pending_approval', 'scheduled', 'rejected'] as const).map((s) => `<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded ${statusClass(s)}"></span>${esc(s === 'plan' ? t('admin.social.legend.plan') : s === 'due' ? t('admin.social.legend.due') : t(`admin.social.status.${s}`))}</span>`).join('')}
    </div>`;
    return `<div class="min-w-[640px]"><div class="grid grid-cols-7 gap-1 mb-1 text-xs text-gray-500 text-center">${head.map((h) => `<div>${esc(h)}</div>`).join('')}</div>
      <div class="grid grid-cols-7 gap-1">${cells}</div></div>${legend}`;
  }

  function board(): string {
    const cols: [string, string][] = [
      ['plan', t('admin.social.board.plan')], ['draft', t('admin.social.board.draft')], ['pending_approval', t('admin.social.board.pending')],
      ['scheduled', t('admin.social.board.scheduled')], ['done', t('admin.social.board.done')],
    ];
    const bucket = (p: Post) => (p.status === 'draft' || p.status === 'rejected' ? 'draft'
      : p.status === 'pending_approval' || p.status === 'scheduled' ? p.status : 'done');
    const card = (kind: 'plan' | 'post', id: string, cls: string, title: string, sub: string) =>
      `<button type="button" data-entry="${kind}" data-id="${esc(id)}" class="block w-full text-left mb-2 p-2 rounded-lg bg-white border border-border text-xs">
        <span class="inline-block px-1.5 rounded ${cls}">&nbsp;</span> <strong class="text-navy">${esc(title)}</strong><br><span class="text-gray-500">${esc(sub)}</span></button>`;
    const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '');
    return `<div class="grid grid-cols-1 md:grid-cols-5 gap-3">${cols.map(([key, label]) => {
      const items = key === 'plan'
        ? emptyPlans().map((p) => card('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), p.title, `${when(p.scheduledAt)} ${p.assigneeEmail ?? ''}`))
        : posts.filter((p) => bucket(p) === key).map((p) => card('post', p.id, statusClass(p.status), postLabel(p), `${when(p.scheduledAt)} ${t(`admin.social.status.${p.status}`)}`));
      return `<div class="bg-[#f4f6fa] rounded-xl p-2"><h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">${esc(label)} · ${items.length}</h3>${items.join('') || `<p class="text-xs text-gray-400">${esc(t('admin.social.empty'))}</p>`}</div>`;
    }).join('')}</div>`;
  }
}

/** For side-panel lookups without a refetch. */
export const findPlan = (id: string) => plans.find((p) => p.id === id);
export const findPost = (id: string) => posts.find((p) => p.id === id);
```

- [ ] **Step 3: `src/scripts/social/side-panel.ts`**

```ts
/** Details and actions for the item clicked on the calendar or board. */
import { api, type Plan, type Post } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { dayKey, timeOf, planDue } from '../../lib/social-calendar';
import { findPlan, findPost } from './calendar-view';
import { openPlanDialog } from './plan-dialog';
import { openComposer } from './composer';

const side = () => document.getElementById('socialSide')!;
const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '-');
const row = (label: string, value: string) => `<p class="text-xs text-gray-500 mt-2">${esc(label)}</p><p class="text-sm text-navy">${value}</p>`;
const LOCKED = ['published', 'partially_published', 'failed', 'cancelled'];

export function hideSide(): void { side().classList.add('hidden'); side().replaceChildren(); }

export function showSide(kind: 'plan' | 'post', id: string): void {
  if (kind === 'plan') { const p = findPlan(id); if (p) renderPlan(p); }
  else { const p = findPost(id); if (p) renderPost(p); }
}

async function run(work: () => Promise<unknown>, doneKey: string): Promise<void> {
  const { t, showToast } = deps();
  try {
    await work();
    showToast(t(doneKey));
    hideSide();
    changed();
  } catch (err) {
    showToast(errorText(err), true);
  }
}

function frame(title: string, body: string): void {
  const { t } = deps();
  side().innerHTML = `<div class="flex justify-between items-start gap-2"><h3 class="font-semibold text-navy">${esc(title)}</h3>
    ${button(t('admin.social.side.close'), 'data-close')}</div>${body}`;
  side().classList.remove('hidden');
  side().querySelector('[data-close]')!.addEventListener('click', hideSide);
}

function renderPlan(p: Plan): void {
  const { t } = deps();
  const now = Math.floor(Date.now() / 1000);
  frame(p.title, `
    ${planDue(p, now) ? `<p class="mt-2 text-xs font-semibold text-red">${esc(t('admin.social.side.dueSoon'))}</p>` : ''}
    ${row(t('admin.social.side.when'), esc(when(p.scheduledAt)))}
    ${row(t('admin.social.side.platforms'), esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(', ')))}
    ${row(t('admin.social.plan.type'), esc(t(`admin.social.type.${p.postType}`)))}
    ${row(t('admin.social.side.assignee'), esc(p.assigneeEmail ?? t('admin.social.plan.nobody')))}
    ${p.note ? row(t('admin.social.side.note'), esc(p.note)) : ''}
    <div class="flex flex-wrap gap-2 mt-4">
      ${button(t('admin.social.action.addContent'), 'data-act="content"', 'primary')}
      ${button(t('admin.social.action.editPlan'), 'data-act="edit"')}
      ${button(t('admin.social.action.deletePlan'), 'data-act="delete"', 'danger')}
    </div>`);
  side().querySelector('[data-act="content"]')!.addEventListener('click', () => void openComposer({ plan: p }));
  side().querySelector('[data-act="edit"]')!.addEventListener('click', () => void openPlanDialog({ plan: p }));
  armConfirm(side().querySelector<HTMLButtonElement>('[data-act="delete"]')!, () => run(() => api.deletePlan(p.id), 'admin.social.done.deleted'));
}

function renderPost(p: Post): void {
  const { t, me } = deps();
  const mine = p.createdBy === me.id;
  const canEdit = !LOCKED.includes(p.status) && (me.isPublisher || mine);
  const actions: string[] = [];
  actions.push(button(t(canEdit ? 'admin.social.action.edit' : 'admin.social.action.open'), 'data-act="open"', 'primary'));
  if (canEdit && (p.status === 'draft' || p.status === 'rejected')) {
    actions.push(button(t(me.isPublisher ? 'admin.social.action.schedule' : 'admin.social.action.submit'), 'data-act="submit"', 'ok'));
    actions.push(button(t('admin.social.action.delete'), 'data-act="delete"', 'danger'));
  }
  if (me.isPublisher && p.status === 'pending_approval') {
    actions.push(button(t('admin.social.action.approve'), 'data-act="approve"', 'ok'));
    actions.push(button(t('admin.social.action.reject'), 'data-act="reject"', 'danger'));
  }
  if ((me.isPublisher || mine) && (p.status === 'pending_approval' || p.status === 'scheduled')) {
    actions.push(button(t('admin.social.action.cancel'), 'data-act="cancel"', 'danger'));
  }
  frame(p.planTitle || t(`admin.social.type.${p.type}`), `
    <p class="mt-1 text-xs font-semibold">${esc(t(`admin.social.status.${p.status}`))}</p>
    ${!canEdit && !LOCKED.includes(p.status) ? `<p class="mt-2 text-xs text-gray-500">${esc(t('admin.social.side.readOnly'))}</p>` : ''}
    ${row(t('admin.social.side.when'), esc(when(p.scheduledAt)))}
    ${row(t('admin.social.side.platforms'), esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(', ')))}
    ${row(t('admin.social.side.author'), esc(p.authorEmail ?? ''))}
    ${p.reviewNote ? row(t('admin.social.side.reviewNote'), esc(p.reviewNote)) : ''}
    ${p.media[0] ? `<img src="${esc(p.media[0].url)}" alt="${esc(p.media[0].alt)}" class="mt-3 w-full max-h-48 object-cover rounded-lg">` : ''}
    <div class="flex flex-wrap gap-2 mt-4">${actions.join('')}</div>
    <div data-reject class="hidden mt-3"><textarea rows="3" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
      ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div>`);

  const q = (s: string) => side().querySelector<HTMLButtonElement>(`[data-act="${s}"]`);
  q('open')?.addEventListener('click', () => void openComposer({ postId: p.id }));
  q('submit')?.addEventListener('click', () => void run(() => api.action(p.id, 'submit', { revision: p.revision }),
    me.isPublisher ? 'admin.social.done.scheduled' : 'admin.social.done.submitted'));
  q('approve')?.addEventListener('click', () => void run(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved'));
  q('reject')?.addEventListener('click', () => side().querySelector('[data-reject]')!.classList.remove('hidden'));
  q('rejectSend')?.addEventListener('click', () => {
    const note = side().querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
    void run(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected');
  });
  const del = q('delete'); if (del) armConfirm(del, () => run(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  const cancel = q('cancel'); if (cancel) armConfirm(cancel, () => run(() => api.action(p.id, 'cancel', { revision: p.revision }), 'admin.social.done.cancelled'));
}
```

- [ ] **Step 4: `src/scripts/social/plan-dialog.ts`**

```ts
/** Create or edit a plan slot (spec §2: plans are dashed boxes until content is attached). */
import { api, type Editor, type Plan, type Platform, type PostType } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, overlay, closeOverlay } from './ui';
import { DEFAULT_TIME, dayKey, timeOf, epochAt } from '../../lib/social-calendar';

let editors: Editor[] | null = null;
export async function editorsCache(): Promise<Editor[]> {
  if (!editors) editors = await api.editors();
  return editors;
}

const PLATFORMS: Platform[] = ['instagram', 'linkedin'];
const TYPES: PostType[] = ['image', 'carousel', 'story'];
const input = 'mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy';

export async function openPlanDialog(opts: { plan?: Plan; date?: string }): Promise<void> {
  const { t, showToast } = deps();
  const plan = opts.plan;
  let people: Editor[] = [];
  try { people = await editorsCache(); } catch { people = []; }
  const tomorrow = dayKey(Math.floor(Date.now() / 1000) + 86400);
  const date = plan ? dayKey(plan.scheduledAt) : opts.date ?? tomorrow;
  const time = plan ? timeOf(plan.scheduledAt) : DEFAULT_TIME;
  const o = overlay();
  o.innerHTML = `<form data-plan class="max-w-lg mx-auto mt-10 bg-white rounded-2xl border border-border p-5 space-y-3">
    <h3 class="font-semibold text-navy">${esc(t(plan ? 'admin.social.plan.editTitle' : 'admin.social.plan.newTitle'))}</h3>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.title'))}<input name="title" required maxlength="120" class="${input}" value="${esc(plan?.title ?? '')}"></label>
    <div class="flex gap-3">
      <label class="block text-xs text-gray-500 flex-1">${esc(t('admin.social.plan.date'))}<input name="date" type="date" required class="${input}" value="${esc(date)}"></label>
      <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.time'))}<input name="time" type="time" required class="${input}" value="${esc(time)}"></label>
    </div>
    <fieldset class="text-xs text-gray-500">${esc(t('admin.social.plan.platforms'))}<div class="flex gap-4 mt-1">
      ${PLATFORMS.map((p) => `<label class="text-sm text-navy"><input type="checkbox" name="platform" value="${p}" ${(plan?.platforms ?? ['instagram']).includes(p) ? 'checked' : ''}> ${esc(t(`admin.connections.platform.${p}`))}</label>`).join('')}
    </div></fieldset>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.type'))}<select name="type" class="${input}">
      ${TYPES.map((x) => `<option value="${x}" ${(plan?.postType ?? 'image') === x ? 'selected' : ''}>${esc(t(`admin.social.type.${x}`))}</option>`).join('')}</select></label>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.assignee'))}<select name="assignee" class="${input}">
      <option value="">${esc(t('admin.social.plan.nobody'))}</option>
      ${people.map((e) => `<option value="${esc(e.id)}" ${plan?.assigneeId === e.id ? 'selected' : ''}>${esc(e.name ? `${e.name} (${e.email})` : e.email)}</option>`).join('')}</select></label>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.plan.note'))}<textarea name="note" maxlength="500" rows="2" class="${input}">${esc(plan?.note ?? '')}</textarea></label>
    <div class="flex gap-2 justify-end">${button(t('admin.social.plan.cancel'), 'data-close')}
      <button type="submit" class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white">${esc(t('admin.social.plan.save'))}</button></div>
  </form>`;
  o.classList.remove('hidden');
  o.querySelector('[data-close]')!.addEventListener('click', closeOverlay);
  const form = o.querySelector<HTMLFormElement>('[data-plan]')!;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const scheduledAt = epochAt(String(f.get('date')), String(f.get('time')));
    const body = {
      title: String(f.get('title')).trim(),
      scheduledAt: scheduledAt ?? -1,
      platforms: f.getAll('platform').map(String) as Platform[],
      postType: String(f.get('type')) as PostType,
      assigneeId: String(f.get('assignee')) || null,
      note: String(f.get('note')),
    };
    void (async () => {
      try {
        if (plan) await api.updatePlan(plan.id, body); else await api.createPlan(body);
        showToast(t('admin.social.done.saved'));
        closeOverlay();
        changed();
      } catch (err) {
        showToast(errorText(err), true);
      }
    })();
  });
}
```

- [ ] **Step 5: Stub composer and register the view.** Create `src/scripts/social/composer.ts` containing only:

```ts
import type { Plan } from './api';
/** Replaced in Task 4. */
export async function openComposer(_: { postId?: string; plan?: Plan; date?: string }): Promise<void> {}
```

In `index.ts`, add `import { loadCalendar } from './calendar-view';` and, at the end of `setupSocial`, `registerView('calendar', loadCalendar);`.

In `tests/admin-social-i18n.test.ts`, restore `assert.ok(used.size > 40);`.

- [ ] **Step 6: Verify**

Run: `npm test && npx astro check && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/social tests/admin-social-i18n.test.ts
git commit -m "Social calendar and board, side panel actions, plan slots"
```

---

### Task 4: Composer, preview, checklist and autosave

**Files:**
- Replace: `src/scripts/social/composer.ts`
- Create: `src/scripts/social/preview.ts`
- Test: `tests/social-composer-body.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1 to 3.
  - From the server libs: `readinessProblems(post, dims, now)` from `functions/_lib/social-posts.ts`.
  - `captionFor`, `captionProblems`, `countChars`, `countHashtags`, `CAPTION_LIMITS`, `INSTAGRAM_MAX_HASHTAGS`, `ENABLED_PLATFORMS` from `functions/_lib/social-limits.ts`.
  - `uploadSocialImage` (Task 2).
- Produces:
  - `openComposer(opts: { postId?: string; plan?: Plan; date?: string }): Promise<void>`
  - `toDraftBody(state: ComposerState): DraftBody`: pure, exported for its test.
  - `interface ComposerState`
  - `renderPreview(state, which): string`
- **Import check.** Importing `functions/_lib/social-posts.ts` from the browser bundle is the point: one rule, two callers. After Step 2, `npm run build` must pass.
  - If Vite refuses the import (a Workers-only global would be the cause), do not copy the function.
  - Instead, move `readinessProblems` and its pure helpers into `functions/_lib/social-limits.ts`, re-export them from `social-posts.ts`, and note it in the report.

- [ ] **Step 1: Failing test** `tests/social-composer-body.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toDraftBody, type ComposerState } from '../src/scripts/social/composer';

const base: ComposerState = {
  id: null, revision: 0, status: 'draft', planId: null, planTitle: null, type: 'image', platforms: ['instagram'],
  media: [{ key: 'k.jpg', alt: ' Afiş ', url: 'u', width: 1080, height: 1350 }],
  caption: 'Merhaba', overrides: { linkedin: '', instagram: 'IG' }, link: '  ', date: '2026-10-14', time: '18:00',
};

test('the body sends trimmed alt text, no blank link, and only non-empty overrides in a fixed order', () => {
  const b = toDraftBody(base);
  assert.deepEqual(b.media, [{ key: 'k.jpg', alt: 'Afiş' }]);
  assert.equal(b.link, null);
  assert.deepEqual(Object.keys(b.captionOverrides), ['instagram']);
  assert.equal(b.scheduledAt, Date.UTC(2026, 9, 14, 15, 0) / 1000);
  assert.equal('planId' in b, false, 'planId only on create');
});

test('overrides keep instagram before linkedin whatever order they were typed in', () => {
  const b = toDraftBody({ ...base, overrides: { linkedin: 'LI', instagram: 'IG' } });
  assert.deepEqual(Object.keys(b.captionOverrides), ['instagram', 'linkedin']);
});

test('a new post from a plan carries the plan id and the plan type; a bad date is null', () => {
  const b = toDraftBody({ ...base, planId: 'pl', type: 'carousel', date: '' }, true);
  assert.equal(b.planId, 'pl');
  assert.equal(b.type, 'carousel');
  assert.equal(b.scheduledAt, null);
});
```

- [ ] **Step 2: `src/scripts/social/preview.ts`**

```ts
/** What the post will look like on each platform (spec §2: live preview). */
import { captionFor } from '../../../functions/_lib/social-limits';
import type { ComposerState } from './composer';
import { deps } from './context';
import { esc } from './ui';

export type PreviewKind = 'instagram' | 'story' | 'linkedin';

function source(s: ComposerState) {
  return { caption: s.caption, captionOverrides: s.overrides, link: s.link.trim() || null };
}

export function renderPreview(s: ComposerState, which: PreviewKind): string {
  const { t } = deps();
  const img = s.media[0];
  const picture = (ratio: string) => img
    ? `<div class="w-full ${ratio} bg-gray-200 bg-center bg-cover" style="background-image:url('${esc(img.url)}')" role="img" aria-label="${esc(img.alt)}"></div>`
    : `<div class="w-full ${ratio} bg-gray-100 flex items-center justify-center text-xs text-gray-400">${esc(t('admin.social.composer.noImage'))}</div>`;
  if (which === 'story') {
    return `<div class="w-56 mx-auto rounded-xl overflow-hidden bg-gray-800">${picture('aspect-[9/16]')}</div>
      <p class="text-xs text-gray-500 mt-2">${esc(t('admin.social.composer.storyNoCaption'))}</p>`;
  }
  if (which === 'linkedin') {
    const text = captionFor(source(s), 'linkedin');
    const link = s.link.trim();
    const body = link && text.endsWith(link)
      ? `${esc(text.slice(0, text.length - link.length))}<span class="text-[#0a66c2] font-semibold">${esc(link)}</span>`
      : esc(text);
    return `<div class="rounded-lg border border-gray-200 bg-white text-sm">
      <div class="p-3 font-semibold text-navy">ISCB SC RSG-Türkiye</div>
      <div class="px-3 pb-2 whitespace-pre-wrap break-words">${body}</div>${picture('aspect-[1.91/1]')}</div>`;
  }
  const text = captionFor(source(s), 'instagram');
  const chars = [...text];
  const short = chars.length > 125 ? `${esc(chars.slice(0, 125).join(''))}<span class="text-gray-400">${esc(t('admin.social.composer.more'))}</span>` : esc(text);
  const dots = s.media.length > 1 ? `<div class="text-center text-xs text-gray-400 pt-1">${s.media.map((_, i) => (i === 0 ? '●' : '○')).join(' ')}</div>` : '';
  return `<div class="rounded-lg border border-gray-200 bg-white text-sm">
    <div class="p-2 font-semibold">rsgturkey</div>${picture('aspect-[4/5]')}${dots}
    <div class="p-2 whitespace-pre-wrap break-words"><strong>rsgturkey</strong> ${short}</div></div>`;
}
```

- [ ] **Step 3: `src/scripts/social/composer.ts`** (replaces the stub)

```ts
/**
 * The post editor. One state object, rendered on every change. The
 * checklist calls the server's own readinessProblems, so the panel and the
 * server cannot disagree about whether a post may go out (spec §2).
 */
import { api, ApiError, type DraftBody, type MediaItem, type Plan, type Platform, type PostStatus, type PostType } from './api';
import { deps, changed } from './context';
import { errorText, problemText } from './messages';
import { esc, button, overlay, closeOverlay } from './ui';
import { AutosaveQueue } from './autosave';
import { renderPreview, type PreviewKind } from './preview';
import { uploadSocialImage } from '../image-upload';
import { readinessProblems } from '../../../functions/_lib/social-posts';
import {
  captionFor, countChars, countHashtags, CAPTION_LIMITS, INSTAGRAM_MAX_HASHTAGS, ENABLED_PLATFORMS, CAROUSEL_MAX_ITEMS,
} from '../../../functions/_lib/social-limits';
import { DEFAULT_TIME, dayKey, timeOf, epochAt } from '../../lib/social-calendar';

export interface ComposerState {
  id: string | null;
  revision: number;
  status: PostStatus;
  planId: string | null;
  planTitle: string | null;
  type: PostType;
  platforms: Platform[];
  media: MediaItem[];
  caption: string;
  overrides: Partial<Record<Platform, string>>;
  link: string;
  date: string;
  time: string;
}

const LOCKED: PostStatus[] = ['published', 'partially_published', 'failed', 'cancelled'];
const OVERRIDE_ORDER: Platform[] = ['instagram', 'linkedin'];

/** Pure: what the API receives. Overrides in a fixed order and only when written, so autosave logs no phantom changes. */
export function toDraftBody(s: ComposerState, creating = false): DraftBody {
  const captionOverrides: Partial<Record<Platform, string>> = {};
  for (const p of OVERRIDE_ORDER) {
    const v = s.overrides[p];
    if (v !== undefined && v.trim() !== '') captionOverrides[p] = v;
  }
  const body: DraftBody = {
    type: s.type,
    caption: s.caption,
    captionOverrides,
    link: s.link.trim() || null,
    media: s.media.map((m) => ({ key: m.key, alt: m.alt.trim() })),
    platforms: s.platforms,
    scheduledAt: s.date ? epochAt(s.date, s.time || DEFAULT_TIME) : null,
  };
  if (creating && s.planId) body.planId = s.planId;
  return body;
}

let state: ComposerState;
let editable = true;
let capTab: 'shared' | Platform = 'shared';
let previewKind: PreviewKind = 'instagram';
let dirty = false;
let autosave: AutosaveQueue | null = null;
let savedAt = '';
let stopped = false;

/** Existing media carry no size; measure them in the browser for the preview checklist (the server re-checks). */
function measure(m: MediaItem): Promise<void> {
  if (m.width && m.height) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { m.width = img.naturalWidth; m.height = img.naturalHeight; resolve(); };
    img.onerror = () => resolve();
    img.src = m.url;
  });
}

export async function openComposer(opts: { postId?: string; plan?: Plan; date?: string }): Promise<void> {
  const { me, showToast } = deps();
  stopped = false;
  dirty = false;
  savedAt = '';
  capTab = 'shared';
  previewKind = 'instagram';
  autosave?.stop();
  autosave = null;
  if (opts.postId) {
    let post;
    try { post = await api.post(opts.postId); } catch (err) { showToast(errorText(err), true); return; }
    state = {
      id: post.id, revision: post.revision, status: post.status, planId: post.planId, planTitle: post.planTitle, type: post.type,
      platforms: post.platforms, media: post.media, caption: post.caption, overrides: { ...post.captionOverrides },
      link: post.link ?? '', date: post.scheduledAt ? dayKey(post.scheduledAt) : '', time: post.scheduledAt ? timeOf(post.scheduledAt) : DEFAULT_TIME,
    };
    editable = !LOCKED.includes(post.status) && (me.isPublisher || post.createdBy === me.id);
    await Promise.all(state.media.map(measure));
  } else {
    const p = opts.plan;
    state = {
      id: null, revision: 0, status: 'draft', planId: p?.id ?? null, planTitle: p?.title ?? null,
      // The API does not copy the plan's type into a new draft; the composer sends it.
      type: p?.postType ?? 'image', platforms: p?.platforms ?? ['instagram'], media: [], caption: '', overrides: {}, link: '',
      date: p ? dayKey(p.scheduledAt) : opts.date ?? '', time: p ? timeOf(p.scheduledAt) : DEFAULT_TIME,
    };
    editable = true;
  }
  if (editable && state.status === 'draft') autosave = new AutosaveQueue(saveDraft, 3000);
  overlay().classList.remove('hidden');
  render();
}

/** Create on first save, PATCH afterwards; always take the new revision. */
async function saveDraft(): Promise<void> {
  try {
    if (!state.id) {
      const r = await api.createPost(toDraftBody(state, true));
      state.id = r.id;
      state.revision = r.revision;
    } else {
      const r = await api.updatePost(state.id, { ...toDraftBody(state), revision: state.revision });
      state.revision = r.revision;
      state.status = r.status;
    }
    dirty = false;
    savedAt = timeOf(Math.floor(Date.now() / 1000));
    renderStatusLine();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'plan_taken') {
      // Someone filled the slot first: keep the work as a plain draft.
      deps().showToast(deps().t('admin.social.composer.planTakenNow'), true);
      state.planId = null;
      state.planTitle = null;
      return saveDraft();
    }
    stopped = true;
    renderStatusLine();
    throw err;
  }
}

function touch(): void {
  dirty = true;
  autosave?.touch();
  renderChecks();
  renderPreviewPane();
}

function problems() {
  const dims = new Map(state.media.filter((m) => m.width && m.height).map((m) => [m.key, { width: m.width!, height: m.height! }]));
  return readinessProblems(toDraftBody(state), dims, Math.floor(Date.now() / 1000));
}

function render(): void {
  const { t, tf, me } = deps();
  const title = !editable ? 'admin.social.composer.viewTitle' : state.id ? 'admin.social.composer.editTitle' : 'admin.social.composer.newTitle';
  const dis = editable ? '' : 'disabled';
  const field = 'mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy';
  const warn = editable && state.status === 'scheduled' && !me.isPublisher
    ? `<p class="mb-3 p-2 rounded-lg bg-amber-50 text-amber-900 text-sm">${esc(t('admin.social.composer.backToApproval'))}</p>` : '';
  overlay().innerHTML = `<div class="max-w-6xl mx-auto my-6 bg-white rounded-2xl border border-border p-5">
    <div class="flex justify-between items-start gap-3 mb-3">
      <div><h3 class="text-lg font-semibold text-navy">${esc(t(title))}</h3>
        ${state.planTitle ? `<p class="text-sm text-gray-500">${esc(tf('admin.social.composer.fromPlan', { title: state.planTitle }))}</p>` : ''}</div>
      ${button(t('admin.social.composer.close'), 'data-close')}
    </div>
    ${warn}
    <div class="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5">
      <div class="space-y-4">
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.type'))}</p>
          <div class="inline-flex mt-1 rounded-lg border border-border overflow-hidden">
            ${(['image', 'carousel', 'story'] as const).map((x) => `<button type="button" data-type="${x}" ${dis} class="px-3 py-1.5 text-sm ${state.type === x ? 'bg-navy-light font-semibold text-navy' : 'text-gray-500'}">${esc(t(`admin.social.type.${x}`))}</button>`).join('')}
          </div></div>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.platforms'))}</p>
          <div class="flex flex-wrap gap-4 mt-1 text-sm">
            ${ENABLED_PLATFORMS.map((p) => `<label><input type="checkbox" data-platform="${p}" ${dis} ${state.platforms.includes(p) ? 'checked' : ''}> ${esc(t(`admin.connections.platform.${p}`))}</label>`).join('')}
            <label class="text-gray-400"><input type="checkbox" disabled> ${esc(t('admin.social.composer.xLater'))}</label>
          </div></div>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.images'))} <span class="font-normal text-gray-500">${esc(t('admin.social.composer.imagesHint'))}</span></p>
          <div data-media class="flex flex-wrap gap-3 mt-2"></div></div>
        <div data-caption></div>
        <label class="block text-xs font-semibold text-navy">${esc(t('admin.social.composer.link'))}
          <input data-link type="url" ${dis} class="${field}" value="${esc(state.link)}" placeholder="https://"></label>
        <p class="text-xs text-gray-500 -mt-2">${esc(t('admin.social.composer.linkHint'))}</p>
        <div><p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.when'))} <span class="font-normal text-gray-500">${esc(t('admin.social.composer.timeHint'))}</span></p>
          <div class="flex gap-2 mt-1"><input data-date type="date" ${dis} class="px-3 py-2 rounded-xl border border-border text-sm" value="${esc(state.date)}">
            <input data-time type="time" ${dis} class="px-3 py-2 rounded-xl border border-border text-sm" value="${esc(state.time)}"></div></div>
        <div data-checks class="border-t border-border pt-3"></div>
        <div data-actions class="flex flex-wrap gap-2 items-center"></div>
      </div>
      <div class="lg:sticky lg:top-4 self-start">
        <p class="text-xs font-semibold text-navy mb-2">${esc(t('admin.social.composer.preview'))}</p>
        <div class="flex gap-1 mb-2">${(['instagram', 'story', 'linkedin'] as const).map((k) => `<button type="button" data-pv="${k}" class="flex-1 px-2 py-1 rounded-lg border text-xs ${previewKind === k ? 'border-navy text-navy font-semibold' : 'border-border text-gray-500'}">${esc(t(`admin.social.composer.preview${k === 'instagram' ? 'Instagram' : k === 'story' ? 'Story' : 'Linkedin'}`))}</button>`).join('')}</div>
        <div data-preview></div>
      </div>
    </div></div>`;
  wireForm();
  renderMedia();
  renderCaption();
  renderChecks();
  renderPreviewPane();
  renderActions();
}

function wireForm(): void {
  const o = overlay();
  const { t } = deps();
  o.querySelector('[data-close]')!.addEventListener('click', (e) => {
    const b = e.currentTarget as HTMLButtonElement;
    const needsConfirm = dirty && !autosave && editable;
    if (needsConfirm && b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = t('admin.social.composer.closeConfirm'); return; }
    void (async () => { await autosave?.flush().catch(() => {}); autosave?.stop(); closeOverlay(); changed(); })();
  });
  if (!editable) return;
  o.querySelectorAll<HTMLButtonElement>('[data-type]').forEach((b) => b.addEventListener('click', () => {
    state.type = b.dataset.type as PostType;
    if (state.type === 'story') state.platforms = ['instagram'];
    dirty = true; autosave?.touch(); render();
  }));
  o.querySelectorAll<HTMLInputElement>('[data-platform]').forEach((c) => c.addEventListener('change', () => {
    const p = c.dataset.platform as Platform;
    state.platforms = c.checked ? [...new Set([...state.platforms, p])] : state.platforms.filter((x) => x !== p);
    touch();
  }));
  o.querySelector<HTMLInputElement>('[data-link]')!.addEventListener('input', (e) => { state.link = (e.target as HTMLInputElement).value; touch(); });
  o.querySelector<HTMLInputElement>('[data-date]')!.addEventListener('input', (e) => { state.date = (e.target as HTMLInputElement).value; touch(); });
  o.querySelector<HTMLInputElement>('[data-time]')!.addEventListener('input', (e) => { state.time = (e.target as HTMLInputElement).value; touch(); });
  o.querySelectorAll<HTMLButtonElement>('[data-pv]').forEach((b) => b.addEventListener('click', () => { previewKind = b.dataset.pv as PreviewKind; render(); }));
}

function renderMedia(): void {
  const { t, tf, showToast } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-media]')!;
  const dis = editable ? '' : 'disabled';
  box.innerHTML = state.media.map((m, i) => `<div class="w-40 border border-border rounded-lg p-1.5 text-xs">
      <div class="h-32 rounded bg-gray-200 bg-center bg-cover" style="background-image:url('${esc(m.url)}')"></div>
      <p class="text-gray-500 mt-1">${m.width && m.height ? `${m.width}x${m.height}` : ''}</p>
      <textarea data-alt="${i}" ${dis} rows="3" maxlength="1000" class="w-full mt-1 px-1.5 py-1 rounded border ${m.alt.trim() ? 'border-border' : 'border-red bg-red-tint'}" placeholder="${esc(t('admin.social.composer.alt'))}">${esc(m.alt)}</textarea>
      ${editable ? `<div class="flex gap-1 mt-1">
        <button type="button" data-up="${i}" aria-label="${esc(t('admin.social.composer.moveUp'))}" class="px-1.5 border rounded">‹</button>
        <button type="button" data-down="${i}" aria-label="${esc(t('admin.social.composer.moveDown'))}" class="px-1.5 border rounded">›</button>
        <button type="button" data-remove="${i}" class="ml-auto px-1.5 border rounded text-red">${esc(t('admin.social.composer.remove'))}</button></div>` : ''}
    </div>`).join('')
    + (editable && state.media.length < CAROUSEL_MAX_ITEMS
      ? `<label class="w-40 min-h-40 border-2 border-dashed border-gray-300 rounded-lg flex items-center justify-center text-xs text-gray-500 cursor-pointer text-center p-2">
          <span data-upload-label>${esc(t('admin.social.composer.addImages'))}</span><input data-files type="file" accept="image/*" ${state.type === 'carousel' ? 'multiple' : ''} class="sr-only"></label>` : '');
  if (!editable) return;
  box.querySelectorAll<HTMLTextAreaElement>('[data-alt]').forEach((a) => a.addEventListener('input', () => {
    state.media[Number(a.dataset.alt)].alt = a.value;
    a.classList.toggle('border-red', !a.value.trim()); a.classList.toggle('bg-red-tint', !a.value.trim());
    touch();
  }));
  const move = (i: number, d: number) => {
    const j = i + d; if (j < 0 || j >= state.media.length) return;
    [state.media[i], state.media[j]] = [state.media[j], state.media[i]];
    dirty = true; autosave?.touch(); renderMedia(); renderChecks(); renderPreviewPane();
  };
  box.querySelectorAll<HTMLButtonElement>('[data-up]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.up), -1)));
  box.querySelectorAll<HTMLButtonElement>('[data-down]').forEach((b) => b.addEventListener('click', () => move(Number(b.dataset.down), 1)));
  box.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => b.addEventListener('click', () => {
    state.media.splice(Number(b.dataset.remove), 1); dirty = true; autosave?.touch(); renderMedia(); renderChecks(); renderPreviewPane();
  }));
  box.querySelector<HTMLInputElement>('[data-files]')?.addEventListener('change', (e) => {
    const files = [...((e.target as HTMLInputElement).files ?? [])].slice(0, CAROUSEL_MAX_ITEMS - state.media.length);
    const label = box.querySelector<HTMLElement>('[data-upload-label]');
    if (label) label.textContent = t('admin.social.composer.uploading');
    void (async () => {
      for (const file of files) {
        try {
          const up = await uploadSocialImage(file);
          state.media.push({ key: up.key, url: up.url, alt: '', width: up.width, height: up.height });
        } catch (err) {
          showToast(tf('admin.social.composer.uploadFailed', { detail: err instanceof Error ? err.message : '' }), true);
        }
      }
      dirty = true; autosave?.touch(); renderMedia(); renderChecks(); renderPreviewPane();
    })();
  });
}

function renderCaption(): void {
  const { t, tf } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-caption]')!;
  const dis = editable ? '' : 'disabled';
  if (state.type === 'story') {
    box.innerHTML = `<p class="text-xs text-gray-500">${esc(t('admin.social.composer.storyNoCaption'))}</p>`;
    return;
  }
  const tabs: ('shared' | Platform)[] = ['shared', ...state.platforms.filter((p) => ENABLED_PLATFORMS.includes(p))];
  if (!tabs.includes(capTab)) capTab = 'shared';
  const value = capTab === 'shared' ? state.caption : state.overrides[capTab] ?? '';
  box.innerHTML = `<p class="text-xs font-semibold text-navy">${esc(t('admin.social.composer.caption'))}</p>
    <div class="flex gap-1 mt-1 border-b border-border">${tabs.map((k) => `<button type="button" data-cap="${k}" class="px-2 py-1 text-xs ${capTab === k ? 'border-b-2 border-red text-navy font-semibold' : 'text-gray-500'}">${esc(k === 'shared' ? t('admin.social.composer.captionShared') : tf('admin.social.composer.captionFor', { platform: t(`admin.connections.platform.${k}`) }))}</button>`).join('')}</div>
    <textarea data-captext ${dis} rows="7" class="w-full px-3 py-2 border border-border border-t-0 rounded-b-xl text-sm" placeholder="${esc(capTab === 'shared' ? '' : t('admin.social.composer.overrideHint'))}">${esc(value)}</textarea>
    <div data-counts class="flex flex-wrap gap-4 mt-1 text-xs text-gray-500"></div>`;
  box.querySelectorAll<HTMLButtonElement>('[data-cap]').forEach((b) => b.addEventListener('click', () => { capTab = b.dataset.cap as 'shared' | Platform; renderCaption(); }));
  box.querySelector<HTMLTextAreaElement>('[data-captext]')!.addEventListener('input', (e) => {
    const v = (e.target as HTMLTextAreaElement).value;
    if (capTab === 'shared') state.caption = v; else state.overrides[capTab] = v;
    renderCounts();
    touch();
  });
  renderCounts();
}

function renderCounts(): void {
  const { t, tf } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-counts]');
  if (!box) return;
  const src = { caption: state.caption, captionOverrides: state.overrides, link: state.link.trim() || null };
  box.innerHTML = state.platforms.filter((p) => ENABLED_PLATFORMS.includes(p)).map((p) => {
    const text = captionFor(src, p);
    const chars = countChars(text);
    const over = chars > CAPTION_LIMITS[p];
    const tags = p === 'instagram' ? countHashtags(text) : 0;
    return `<span class="${over ? 'text-red font-semibold' : ''}">${esc(tf('admin.social.composer.count', { platform: t(`admin.connections.platform.${p}`), chars, limit: CAPTION_LIMITS[p] }))}</span>`
      + (p === 'instagram' ? `<span class="${tags > INSTAGRAM_MAX_HASHTAGS ? 'text-red font-semibold' : ''}">${esc(tf('admin.social.composer.hashtags', { count: tags, limit: INSTAGRAM_MAX_HASHTAGS }))}</span>` : '');
  }).join('');
}

function renderChecks(): void {
  const { t } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-checks]');
  if (!box) return;
  const list = problems();
  box.innerHTML = `<p class="text-xs font-semibold text-navy mb-1">${esc(t('admin.social.composer.checklist'))}</p>` + (list.length
    ? `<ul class="text-sm text-red space-y-0.5">${list.map((p) => `<li>✕ ${esc(problemText(p))}</li>`).join('')}</ul>`
    : `<p class="text-sm text-green-700">✓ ${esc(t('admin.social.composer.ready'))}</p>`);
  renderActions();
}

function renderPreviewPane(): void {
  const box = overlay().querySelector<HTMLElement>('[data-preview]');
  if (box) box.innerHTML = renderPreview(state, previewKind);
}

function renderStatusLine(): void {
  const { t, tf } = deps();
  const line = overlay().querySelector<HTMLElement>('[data-saved]');
  if (!line) return;
  line.textContent = stopped ? t('admin.social.composer.autosaveStopped') : savedAt ? tf('admin.social.composer.autosaved', { time: savedAt }) : '';
  line.classList.toggle('text-red', stopped);
}

function renderActions(): void {
  const { t, me } = deps();
  const box = overlay().querySelector<HTMLElement>('[data-actions]');
  if (!box) return;
  if (!editable) { box.innerHTML = ''; return; }
  const ready = problems().length === 0;
  const isDraftish = state.status === 'draft' || state.status === 'rejected';
  box.innerHTML = (isDraftish
    ? button(t('admin.social.composer.saveDraft'), 'data-save')
      + `<button type="button" data-submit ${ready && !stopped ? '' : 'disabled'} class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t(me.isPublisher ? 'admin.social.action.schedule' : 'admin.social.action.submit'))}</button>`
    : `<button type="button" data-save ${stopped ? 'disabled' : ''} class="px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white disabled:opacity-40">${esc(t('admin.social.composer.save'))}</button>`)
    + `<span data-saved class="text-xs text-gray-500"></span>`;
  renderStatusLine();
  box.querySelector('[data-save]')?.addEventListener('click', () => void saveExplicit());
  box.querySelector('[data-submit]')?.addEventListener('click', () => void submit());
}

/** Explicit save: drafts go through the autosave queue (one in flight); other statuses PATCH directly. */
async function saveExplicit(): Promise<void> {
  const { t, showToast } = deps();
  try {
    if (autosave) { autosave.touch(); await autosave.flush(); if (autosave.stopped) throw new ApiError(409, 'post_changed'); }
    else await saveDraft();
    showToast(t('admin.social.done.saved'));
    if (state.status !== 'draft') { closeOverlay(); changed(); }
  } catch (err) {
    showToast(errorText(err), true);
  }
}

async function submit(): Promise<void> {
  const { t, showToast } = deps();
  try {
    if (autosave) { autosave.touch(); await autosave.flush(); if (autosave.stopped) throw new ApiError(409, 'post_changed'); }
    else if (dirty || !state.id) await saveDraft();
    const r = await api.action(state.id!, 'submit', { revision: state.revision });
    autosave?.stop();
    showToast(t(r.status === 'scheduled' ? 'admin.social.done.scheduled' : 'admin.social.done.submitted'));
    closeOverlay();
    changed();
  } catch (err) {
    if (err instanceof ApiError && err.code === 'not_ready') {
      showToast(err.problems.map(problemText).join(' ') || errorText(err), true);
      return;
    }
    showToast(errorText(err), true);
  }
}
```

- [ ] **Step 4: Verify (including the import check)**

Run: `node --import tsx --test tests/social-composer-body.test.ts` (expected: PASS), then `npm test && npx astro check && npm run build`.
- **If the build refuses the `functions/_lib` import,** follow the fallback in this task's Interfaces and rerun.
- **If `astro check` reports an unused variable or import,** remove it rather than silencing it.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/social/composer.ts src/scripts/social/preview.ts tests/social-composer-body.test.ts
git commit -m "Social composer: live preview, counters, server-identical checklist, safe autosave"
```

---

### Task 5: Approval queue, undated drafts, event mode

**Files:**
- Create: `src/scripts/social/lists.ts`, `src/scripts/social/events.ts`
- Modify: `src/scripts/social/index.ts`

**Interfaces:**
- Consumes: Tasks 1 to 4 (`api`, `deps`, `changed`, `errorText`, `esc`, `button`, `armConfirm`, `openComposer`, `editorsCache`, `dayKey`, `timeOf`, `epochAt`).
- Produces:
  - `loadPending(): Promise<void>`, `loadDrafts(): Promise<void>`
  - `refreshPendingCount(): Promise<void>`
  - `loadEvents(): Promise<void>`

- [ ] **Step 1: `src/scripts/social/lists.ts`**

```ts
/** The approval queue (publishers) and the undated drafts list. */
import { api, type Post } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { openComposer } from './composer';
import { dayKey, timeOf } from '../../lib/social-calendar';

const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '');

function card(p: Post, actions: string): string {
  const { t } = deps();
  const thumb = p.media[0]
    ? `<div class="w-16 h-20 shrink-0 rounded bg-gray-200 bg-center bg-cover" style="background-image:url('${esc(p.media[0].url)}')"></div>`
    : '<div class="w-16 h-20 shrink-0 rounded bg-gray-100"></div>';
  const alts = p.media.filter((m) => m.alt.trim()).length;
  return `<div data-post="${esc(p.id)}" class="flex gap-3 p-3 mb-3 bg-white rounded-2xl border border-border">${thumb}
    <div class="flex-1 min-w-0"><p class="font-medium text-navy truncate">${esc(p.planTitle || p.caption.split('\n')[0] || t(`admin.social.type.${p.type}`))}</p>
      <p class="text-xs text-gray-500">${esc(t(`admin.social.type.${p.type}`))} · ${esc(p.platforms.map((x) => t(`admin.connections.platform.${x}`)).join(' + '))} · ${esc(when(p.scheduledAt))} · ${esc(p.authorEmail ?? '')} · ${alts}/${p.media.length} alt</p>
      <div class="flex flex-wrap gap-2 mt-2">${actions}</div>
      <div data-reject class="hidden mt-2"><textarea rows="2" maxlength="500" class="w-full px-2 py-1 rounded-lg border border-border text-sm" placeholder="${esc(t('admin.social.rejectNote'))}"></textarea>
        ${button(t('admin.social.action.rejectConfirm'), 'data-act="rejectSend"', 'danger')}</div></div></div>`;
}

async function act(work: () => Promise<unknown>, doneKey: string): Promise<void> {
  const { t, showToast } = deps();
  try { await work(); showToast(t(doneKey)); changed(); } catch (err) { showToast(errorText(err), true); }
}

export async function refreshPendingCount(): Promise<void> {
  if (!deps().me.isPublisher) return;
  const n = (await api.pending()).length;
  const pill = document.getElementById('socialPendingCount');
  if (!pill) return;
  pill.textContent = String(n);
  pill.classList.toggle('hidden', n === 0);
}

export async function loadPending(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialPendingList');
  if (!list) return;
  const posts = await api.pending();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.approve'), 'data-act="approve"', 'ok'),
    button(t('admin.social.action.open'), 'data-act="open"'),
    button(t('admin.social.action.reject'), 'data-act="reject"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="approve"]')!.addEventListener('click', () => void act(() => api.action(p.id, 'approve', { revision: p.revision }), 'admin.social.done.approved'));
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    el.querySelector('[data-act="reject"]')!.addEventListener('click', () => el.querySelector('[data-reject]')!.classList.remove('hidden'));
    el.querySelector('[data-act="rejectSend"]')!.addEventListener('click', () => {
      const note = el.querySelector<HTMLTextAreaElement>('[data-reject] textarea')!.value.trim();
      void act(() => api.action(p.id, 'reject', { revision: p.revision, note }), 'admin.social.done.rejected');
    });
  }
}

export async function loadDrafts(): Promise<void> {
  const { t } = deps();
  const list = document.getElementById('socialDraftList');
  if (!list) return;
  const posts = await api.drafts();
  list.innerHTML = posts.map((p) => card(p, [
    button(t('admin.social.action.edit'), 'data-act="open"', 'primary'),
    button(t('admin.social.action.delete'), 'data-act="delete"', 'danger'),
  ].join(''))).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.empty'))}</p>`;
  for (const p of posts) {
    const el = list.querySelector<HTMLElement>(`[data-post="${CSS.escape(p.id)}"]`)!;
    el.querySelector('[data-act="open"]')!.addEventListener('click', () => void openComposer({ postId: p.id }));
    armConfirm(el.querySelector<HTMLButtonElement>('[data-act="delete"]')!, () => act(() => api.deletePost(p.id, p.revision), 'admin.social.done.deleted'));
  }
}
```

- [ ] **Step 2: `src/scripts/social/events.ts`**

```ts
/** Event mode (spec §1): list for everyone, open/close for publishers. */
import { api } from './api';
import { deps, changed } from './context';
import { errorText } from './messages';
import { esc, button, armConfirm } from './ui';
import { editorsCache } from './plan-dialog';
import { dayKey, timeOf } from '../../lib/social-calendar';
import { epochToIstanbulInput, istanbulInputToEpoch } from '../../lib/istanbul-time';

const when = (e: number) => `${dayKey(e)} ${timeOf(e)}`;
const field = 'mt-1 w-full px-3 py-2 rounded-xl border border-border text-sm text-navy';

export async function loadEvents(): Promise<void> {
  const { t, tf, me, showToast } = deps();
  const list = document.getElementById('socialEventList');
  if (!list) return;
  const modes = await api.events();
  const now = Math.floor(Date.now() / 1000);
  list.innerHTML = modes.map((m) => {
    const state = m.active ? 'active' : m.closedAt !== null || m.endsAt <= now ? 'ended' : 'upcoming';
    const badge = state === 'active' ? 'bg-green-100 text-green-900' : state === 'ended' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-900';
    return `<div data-event="${esc(m.id)}" class="p-3 mb-2 bg-white rounded-2xl border border-border">
      <div class="flex flex-wrap items-center gap-2"><strong class="text-navy">${esc(m.name)}</strong>
        <span class="px-2 rounded-full text-xs ${badge}">${esc(t(`admin.social.events.${state}`))}</span>
        <span class="text-xs text-gray-500">${esc(when(m.startsAt))} - ${esc(when(m.endsAt))}</span></div>
      <p class="text-xs text-gray-500 mt-1">${esc(tf('admin.social.events.editors', { list: m.editorEmails.join(', ') }))}</p>
      ${me.isPublisher && state !== 'ended' ? `<div class="mt-2">${button(t('admin.social.events.close'), 'data-close-event', 'danger')}</div>` : ''}</div>`;
  }).join('') || `<p class="text-sm text-gray-500">${esc(t('admin.social.events.none'))}</p>`;
  list.querySelectorAll<HTMLElement>('[data-event]').forEach((el) => {
    const b = el.querySelector<HTMLButtonElement>('[data-close-event]');
    if (b) armConfirm(b, async () => {
      try { await api.closeEvent(el.dataset.event!); showToast(t('admin.social.events.closed')); changed(); } catch (err) { showToast(errorText(err), true); }
    });
  });
  if (me.isPublisher) await renderForm();
}

async function renderForm(): Promise<void> {
  const { t, showToast } = deps();
  const form = document.getElementById('socialEventForm') as HTMLFormElement | null;
  if (!form || form.dataset.ready === '1') return;
  form.dataset.ready = '1';
  let people: Awaited<ReturnType<typeof editorsCache>> = [];
  try { people = await editorsCache(); } catch { people = []; }
  const now = Math.floor(Date.now() / 1000);
  form.innerHTML = `<h3 class="font-semibold text-navy mb-2">${esc(t('admin.social.events.newTitle'))}</h3>
    <label class="block text-xs text-gray-500">${esc(t('admin.social.events.name'))}<input name="name" required maxlength="80" class="${field}"></label>
    <div class="flex flex-wrap gap-3 mt-2">
      <label class="block text-xs text-gray-500">${esc(t('admin.social.events.start'))}<input name="start" type="datetime-local" required class="${field}" value="${esc(epochToIstanbulInput(now))}"></label>
      <label class="block text-xs text-gray-500">${esc(t('admin.social.events.end'))}<input name="end" type="datetime-local" required class="${field}" value="${esc(epochToIstanbulInput(now + 2 * 86400))}"></label>
    </div>
    <fieldset class="mt-2 text-xs text-gray-500">${esc(t('admin.social.events.pickEditors'))}<div class="flex flex-wrap gap-3 mt-1">
      ${people.filter((p) => !p.isPublisher).map((p) => `<label class="text-sm text-navy"><input type="checkbox" name="editor" value="${esc(p.id)}"> ${esc(p.name ?? p.email)}</label>`).join('')}
    </div></fieldset>
    <button type="submit" class="mt-3 px-3 py-1.5 rounded-lg text-sm font-medium bg-navy text-white">${esc(t('admin.social.events.open'))}</button>`;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body = {
      name: String(f.get('name')).trim(),
      startsAt: istanbulInputToEpoch(String(f.get('start'))) ?? -1,
      endsAt: istanbulInputToEpoch(String(f.get('end'))) ?? -1,
      editorIds: f.getAll('editor').map(String),
    };
    void (async () => {
      try { await api.openEvent(body); showToast(t('admin.social.events.opened')); form.reset(); changed(); } catch (err) { showToast(errorText(err), true); }
    })();
  });
}
```

- [ ] **Step 3: Register the views.** In `index.ts`:
  - Add `import { loadPending, loadDrafts, refreshPendingCount } from './lists';` and `import { loadEvents } from './events';`.
  - At the end of `setupSocial`, add:

    ```ts
      registerView('pending', loadPending);
      registerView('drafts', loadDrafts);
      registerView('events', loadEvents);
      registerPendingCount(refreshPendingCount);
    ```

- [ ] **Step 4: Verify**

Run: `npm test && npx astro check && npm run build`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/social
git commit -m "Social approval queue, undated drafts, event mode controls"
```

---

### Task 6: README and the browser check

**Files:**
- Modify: `README.md`

- [ ] **Step 1: README.** In the social media section, replace "the panel screens come in plan 2b" with a short "Using the panel" part:
  - Where it is: `/admin` → Social media. Editors and publishers see it; nobody else does.
  - Calendar and board. A plan slot is a dashed box; an empty slot due within two days turns red.
  - Composer:
    - alt text required on every image;
    - counters per platform, counted conservatively;
    - a checklist that matches the server exactly;
    - drafts autosave, and autosave stops if someone else changes the post.
  - What a publisher does: approve, send back with a note, cancel, and open or close event windows.
  - Still to come: publishing (phase 3), the phone quick story (phase 3), `/links` (phase 4), LinkedIn connect (phase 5).

- [ ] **Step 2: Verify everything**

Run: `npm test && npx astro check && npm run build`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: using the social media panel"
```

- [ ] **Step 4: Browser check (the user, after deploy, signed in).** These steps are for the user to do; the implementer stops at Step 3.
  1. **As an admin:**
     - Open Social media.
     - Create a plan slot for tomorrow 18:00, assigned to an editor. It appears dashed.
     - Click it, choose "Add content", add one 4:5 image with alt text and a caption, and choose Schedule. It turns blue.
  2. **Give a test account the editor role, then sign in as it.**
     - Only Social media is visible.
     - Make a draft. Remove the alt text: the checklist and the button react.
     - Send it for approval.
  3. **As the admin:**
     - The approval tab shows a count of 1. Send it back with a note.
     - As the editor, the note is shown. Fix it and send it again.
     - As the admin, approve it.
  4. **Event mode:** open a window naming the editor. As the editor, a 9:16 story scheduled inside the window goes straight to Scheduled.
  5. **Turkish panel:** `/tr/admin` shows all of the above in Turkish.
