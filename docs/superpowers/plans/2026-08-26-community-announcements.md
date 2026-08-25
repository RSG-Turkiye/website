# Community Announcements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a restricted "announcer" role (granted by an admin, no `is_admin` access) post/edit/expire short homepage announcements from the admin panel — no code deploy needed for an announcement to go live or expire — and fix the homepage's Webinar card to pull the real latest webinar instead of static copy.

**Architecture:** One new D1 table (`announcements`) plus one new boolean column on `users` (`is_announcer`). Three new Cloudflare Pages Functions routes provide public read + admin-gated CRUD. The homepage keeps its existing build-time card rendering (Webinar becomes dynamic like the existing Blog card) and gains a small client-side script — same pattern as the page's existing Google Calendar `loadCalendar()` block — that fetches active announcements and, if any exist, replaces cards from the front and/or shows a dismissible popup.

**Tech Stack:** Astro 5 (static build) + Cloudflare Pages Functions (TypeScript) + D1 (SQLite). No test framework exists in this repo (`package.json` has no vitest/jest) — verification throughout this plan uses `npm run build` (type-checks Functions via `@cloudflare/workers-types`) plus `wrangler pages dev` against a **local** D1 replica and `curl`, matching how every other feature in this codebase has been verified.

**Spec:** `docs/superpowers/specs/2026-08-26-community-announcements-design.md`

## Global Constraints

- Timestamps are Unix **seconds** (`Math.floor(Date.now() / 1000)`), matching every existing table (`sessions.expires_at`, `rank_history.computed_at`, `user_achievement_badges.awarded_at`) — do not use milliseconds anywhere in this feature, even though the spec doc's SQL comment says "unix ms" (that comment is wrong; seconds is correct and is what this plan uses).
- IDs are generated with the existing `generateId()` helper (`functions/_lib/auth.ts`, wraps `crypto.randomUUID()`) — do not invent a different ID scheme.
- Every mutating Functions route (`POST`/`PATCH`/`DELETE`) must call `checkCsrf(request)` first and return 403 if it fails, then `getSessionUser(request, env)` and return 401 if there's no session — this is the exact order every existing mutating route in `functions/api/admin/users.ts` already follows.
- `is_announcer` and `is_admin` are independent booleans on `users`; holding one never implies or revokes the other.

---

## Task 1: Database schema — `is_announcer` column and `announcements` table

**Files:**
- Modify: `db/schema.sql`

**Interfaces:**
- Produces: `users.is_announcer` column (INTEGER, 0 or 1); `announcements` table with columns `id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at` (all as described below). Every later task reads/writes these exact column names.

- [ ] **Step 1: Add `is_announcer` to the `users` table definition**

Open `db/schema.sql` and change the `users` table's `CREATE TABLE` block (this only affects a *fresh* database — see Step 3 for the existing production database):

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  is_member     INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_announcer  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL
);
```

- [ ] **Step 2: Add the `announcements` table and its index**

At the end of `db/schema.sql`, right before the final `-- Indexes for common queries` block's closing, add:

```sql
-- Community announcements: social-media-team-managed homepage cards.
-- "Active" is derived purely from expires_at > now — there is no is_active
-- flag. Editing (PATCH) never changes created_at, so an edit can't change
-- an announcement's position among other active announcements.
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  button_text   TEXT NOT NULL,
  button_url    TEXT NOT NULL,
  show_as_popup INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON announcements(expires_at);
```

- [ ] **Step 3: Apply the schema to a local D1 replica and verify**

Run (from the repo root):

```bash
rm -rf .wrangler/state/v3/d1
wrangler d1 execute rsg-members --local --file=db/schema.sql
wrangler d1 execute rsg-members --local --command="PRAGMA table_info(users)"
wrangler d1 execute rsg-members --local --command="PRAGMA table_info(announcements)"
```

Expected: the `users` table_info output includes a row for `is_announcer` (type `INTEGER`, `notnull=1`, `dflt_value=0`), and the `announcements` table_info output lists all 9 columns from Step 2. `rm -rf .wrangler/state/v3/d1` first ensures you're applying to a clean local database, not one left over from earlier manual testing — this is a throwaway local replica, not production.

- [ ] **Step 4: Document the production migration (do not run it yet)**

Add this note as a comment at the very top of `db/schema.sql`, directly under the existing `-- Apply with: wrangler d1 execute rsg-members --file=db/schema.sql` line:

```sql
-- One-time migration already applied to production alongside this file's
-- `announcements` table (safe to re-run — schema.sql itself is idempotent,
-- but ALTER TABLE ADD COLUMN is not, so this line intentionally lives here
-- as a note rather than as a statement in this file):
--   wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_announcer INTEGER NOT NULL DEFAULT 0"
```

This documents the real migration command for whoever applies this to the live `rsg-members` database (the existing production `users` table already exists, so the `CREATE TABLE IF NOT EXISTS` in Step 1 is a no-op against it — only `ALTER TABLE ADD COLUMN` actually adds the column there). **Do not run the `--remote` command yourself as part of this task** — flag it to the user and let them run it, the same way every other production D1 change in this project has been applied.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql
git commit -m "Add is_announcer column and announcements table to schema"
```

---

## Task 2: Auth types — expose `is_announcer` on the session user and `/api/me`

**Files:**
- Modify: `functions/_lib/auth.ts:8-16` (the `User` interface)
- Modify: `functions/api/me.ts`

**Interfaces:**
- Consumes: `announcements` table and `users.is_announcer` from Task 1 (only needs the column to exist for the `SELECT *` in `getSessionUser` to include it).
- Produces: `User.is_announcer: number` (raw 0/1 from D1, used by Task 3's server-side checks); `canManageAnnouncements(user)` exported helper, consumed by Task 4's three route files; `/api/me`'s JSON response gains `user.is_announcer: boolean`, consumed by Task 5's admin page.

- [ ] **Step 1: Add `is_announcer` to the `User` interface**

In `functions/_lib/auth.ts`, change:

```typescript
export interface User {
  id: string;
  google_id: string;
  email: string;
  is_member: number;
  is_admin: number;
  created_at: number;
  last_login: number;
}
```

to:

```typescript
export interface User {
  id: string;
  google_id: string;
  email: string;
  is_member: number;
  is_admin: number;
  is_announcer: number;
  created_at: number;
  last_login: number;
}
```

`getSessionUser` already does `SELECT * FROM users WHERE id = ?` (line 60), so it will pick up the new column automatically once Task 1 Step 3/4 has been applied to whichever database this runs against — no query change needed here.

- [ ] **Step 2: Add a shared `canManageAnnouncements` helper**

Still in `functions/_lib/auth.ts`, add this exported function anywhere after the `User` interface (e.g. right after `getSessionDuration`). Task 4's three new route files import this instead of each redefining the same check:

```typescript
export function canManageAnnouncements(user: Pick<User, 'is_admin' | 'is_announcer'>): boolean {
  return user.is_admin === 1 || user.is_announcer === 1;
}
```

- [ ] **Step 3: Return `is_announcer` from `/api/me`**

In `functions/api/me.ts`, change:

```typescript
  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
    },
```

to:

```typescript
  return jsonResponse({
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
      is_announcer: user.is_announcer === 1,
    },
```

- [ ] **Step 4: Verify with a type-check build**

Run: `npm run build`
Expected: build completes with no TypeScript errors (this project's `astro check` step runs as part of `npm run build`'s pipeline through the existing `@cloudflare/workers-types` global types — a typo in either file surfaces here).

- [ ] **Step 5: Manually verify against local D1**

With the local D1 from Task 1 Step 3 still in place, insert a test user and confirm the flag round-trips:

```bash
wrangler d1 execute rsg-members --local --command="INSERT INTO users (id, google_id, email, is_member, is_admin, is_announcer, created_at, last_login) VALUES ('test-announcer-1', 'g1', 'announcer@example.com', 1, 0, 1, 1735689600, 1735689600)"
wrangler d1 execute rsg-members --local --command="SELECT id, is_admin, is_announcer FROM users WHERE id = 'test-announcer-1'"
```

Expected: the second command's output shows `is_admin: 0, is_announcer: 1` for that row. (This row is test fixture data for this task only — Task 5's manual verification will use the real login flow instead.)

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/auth.ts functions/api/me.ts
git commit -m "Expose is_announcer on session user, add canManageAnnouncements helper, update /api/me"
```

---

## Task 3: Admin API — grant/revoke the announcer role

**Files:**
- Modify: `functions/api/admin/users.ts`

**Interfaces:**
- Consumes: `User.is_announcer` (Task 2), `checkCsrf`/`getSessionUser`/`jsonResponse` (existing, from `functions/_lib/auth.ts`).
- Produces: `PATCH /api/admin/users` accepts two new `action` values, `'make_announcer'` and `'remove_announcer'`; the `GET /api/admin/users` response's `users[]` rows gain an `is_announcer` field. Task 5's admin UI consumes both.

- [ ] **Step 1: Include `is_announcer` in the admin user list query**

In `functions/api/admin/users.ts`, change the `onRequestGet` handler's query (currently starting at line 14):

```typescript
  let query = `
    SELECT
      u.id, u.email, u.is_member, u.is_admin, u.created_at, u.last_login,
```

to:

```typescript
  let query = `
    SELECT
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.created_at, u.last_login,
```

- [ ] **Step 2: Add the two new actions to the `onRequestPatch` type union and switch**

Change the body type (currently at line 60-65):

```typescript
  const body = await request.json<{
    user_id: string;
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_private' | 'clear_bio'
      | 'set_rank' | 'award_badge' | 'revoke_badge';
    value?: string;
  }>();
```

to:

```typescript
  const body = await request.json<{
    user_id: string;
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_announcer' | 'remove_announcer'
      | 'make_private' | 'clear_bio' | 'set_rank' | 'award_badge' | 'revoke_badge';
    value?: string;
  }>();
```

Then add two new cases to the `switch (body.action)` block, right after the existing `case 'remove_admin':` case (currently lines 86-88):

```typescript
    case 'make_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 0 WHERE id = ?').bind(body.user_id).run();
      break;
```

- [ ] **Step 3: Verify with a type-check build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Manually verify the new actions against local D1**

Start the local Functions dev server (from the repo root, after `npm run build` so `dist/` exists):

```bash
wrangler pages dev dist --d1=DB=rsg-members --local --port=8788 &
sleep 2
```

You need a real session to call this endpoint (it requires `getSessionUser`), which the local OAuth flow can't easily fake in a script — so verify this task's *query logic* directly against D1 instead of through HTTP, which is enough to confirm the SQL is correct:

```bash
wrangler d1 execute rsg-members --local --command="UPDATE users SET is_announcer = 1 WHERE id = 'test-announcer-1'"
wrangler d1 execute rsg-members --local --command="SELECT id, is_admin, is_announcer FROM users WHERE id = 'test-announcer-1'"
wrangler d1 execute rsg-members --local --command="UPDATE users SET is_announcer = 0 WHERE id = 'test-announcer-1'"
wrangler d1 execute rsg-members --local --command="SELECT id, is_admin, is_announcer FROM users WHERE id = 'test-announcer-1'"
```

Expected: `is_announcer` flips from 1 to 0 across the two `SELECT`s, exactly what the new `make_announcer`/`remove_announcer` actions' `UPDATE` statements do. Stop the dev server afterward: `kill %1`.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/users.ts
git commit -m "Add make_announcer/remove_announcer admin actions"
```

---

## Task 4: Announcements CRUD API

**Files:**
- Create: `functions/api/announcements.ts` (public read)
- Create: `functions/api/admin/announcements.ts` (admin list + create)
- Create: `functions/api/admin/announcements/[id].ts` (admin edit + delete)

**Interfaces:**
- Consumes: `announcements` table (Task 1), `checkCsrf`/`getSessionUser`/`jsonResponse`/`generateId` (existing `_lib/auth.ts`), `User.is_announcer`/`is_admin` (Task 2).
- Produces:
  - `GET /api/announcements` → `{ announcements: Array<{ id: string, title: string, description: string, button_text: string, button_url: string, show_as_popup: boolean }> }` — consumed by Task 6's homepage script.
  - `GET /api/admin/announcements` → `{ announcements: Array<{ id: string, title: string, description: string, button_text: string, button_url: string, show_as_popup: boolean, expires_at: number, created_at: number }> }` — consumed by Task 5's admin table.
  - `POST /api/admin/announcements` body `{ title: string, description: string, button_text: string, button_url: string, show_as_popup: boolean, expires_at: number }` → `{ ok: true, id: string }`.
  - `PATCH /api/admin/announcements/:id` body: any subset of the `POST` body fields → `{ ok: true }`.
  - `DELETE /api/admin/announcements/:id` → `{ ok: true }`.
  - All four admin-side calls: 401 if no session, 403 if `!is_admin && !is_announcer`.

- [ ] **Step 1: Public read endpoint**

Create `functions/api/announcements.ts`:

```typescript
import type { Env } from '../_lib/auth';
import { jsonResponse } from '../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);

  const result = await env.DB.prepare(
    `SELECT id, title, description, button_text, button_url, show_as_popup
     FROM announcements
     WHERE expires_at > ?
     ORDER BY created_at DESC`
  ).bind(now).all<{
    id: string;
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: number;
  }>();

  return jsonResponse({
    announcements: result.results.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      button_text: a.button_text,
      button_url: a.button_url,
      show_as_popup: a.show_as_popup === 1,
    })),
  });
};
```

- [ ] **Step 2: Admin list + create endpoint**

Create `functions/api/admin/announcements.ts`:

```typescript
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, canManageAnnouncements } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT id, title, description, button_text, button_url, show_as_popup, expires_at, created_at
     FROM announcements
     ORDER BY created_at DESC`
  ).all<{
    id: string;
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: number;
    expires_at: number;
    created_at: number;
  }>();

  return jsonResponse({
    announcements: result.results.map(a => ({
      id: a.id,
      title: a.title,
      description: a.description,
      button_text: a.button_text,
      button_url: a.button_url,
      show_as_popup: a.show_as_popup === 1,
      expires_at: a.expires_at,
      created_at: a.created_at,
    })),
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: boolean;
    expires_at: number;
  }>();

  if (!body.title || !body.description || !body.button_text || !body.button_url || !body.expires_at) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);

  await env.DB.prepare(
    `INSERT INTO announcements
      (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    body.title,
    body.description,
    body.button_text,
    body.button_url,
    body.show_as_popup ? 1 : 0,
    body.expires_at,
    user.id,
    now
  ).run();

  return jsonResponse({ ok: true, id });
};
```

- [ ] **Step 3: Admin edit + delete endpoint**

Create `functions/api/admin/announcements/[id].ts`:

```typescript
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageAnnouncements } from '../../../_lib/auth';

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  const body = await request.json<Partial<{
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: boolean;
    expires_at: number;
  }>>();

  const fields: string[] = [];
  const bindings: (string | number)[] = [];

  if (body.title !== undefined) { fields.push('title = ?'); bindings.push(body.title); }
  if (body.description !== undefined) { fields.push('description = ?'); bindings.push(body.description); }
  if (body.button_text !== undefined) { fields.push('button_text = ?'); bindings.push(body.button_text); }
  if (body.button_url !== undefined) { fields.push('button_url = ?'); bindings.push(body.button_url); }
  if (body.show_as_popup !== undefined) { fields.push('show_as_popup = ?'); bindings.push(body.show_as_popup ? 1 : 0); }
  if (body.expires_at !== undefined) { fields.push('expires_at = ?'); bindings.push(body.expires_at); }

  if (fields.length === 0) return jsonResponse({ error: 'No fields to update' }, 400);

  bindings.push(id);
  await env.DB.prepare(`UPDATE announcements SET ${fields.join(', ')} WHERE id = ?`).bind(...bindings).run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canManageAnnouncements(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  await env.DB.prepare('DELETE FROM announcements WHERE id = ?').bind(id).run();

  return jsonResponse({ ok: true });
};
```

- [ ] **Step 4: Verify with a type-check build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manually verify the full CRUD cycle against local D1 + local dev server**

```bash
wrangler pages dev dist --d1=DB=rsg-members --local --port=8788 &
sleep 2

# Public read, should be empty initially
curl -s http://localhost:8788/api/announcements
# Expected: {"announcements":[]}

# Insert one directly (simulating what POST would do, since POST needs a real session cookie)
wrangler d1 execute rsg-members --local --command="INSERT INTO announcements (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at) VALUES ('ann-1', 'Gönüllü Arıyoruz', 'Test description', 'Formu Doldur', 'https://forms.gle/example', 1, 9999999999, 'test-announcer-1', 1735689600)"

curl -s http://localhost:8788/api/announcements
# Expected: {"announcements":[{"id":"ann-1","title":"Gönüllü Arıyoruz","description":"Test description","button_text":"Formu Doldur","button_url":"https://forms.gle/example","show_as_popup":true}]}

# Confirm expired rows are excluded
wrangler d1 execute rsg-members --local --command="INSERT INTO announcements (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at) VALUES ('ann-expired', 'Old', 'Old', 'x', 'https://example.com', 0, 1, 'test-announcer-1', 1)"
curl -s http://localhost:8788/api/announcements
# Expected: still only ann-1 in the list — ann-expired's expires_at=1 is long past.

kill %1
```

- [ ] **Step 6: Commit**

```bash
git add functions/api/announcements.ts functions/api/admin/announcements.ts "functions/api/admin/announcements/[id].ts"
git commit -m "Add public and admin announcements CRUD API"
```

---

## Task 5: Admin UI — Announcements section and role-gated rendering

**Files:**
- Modify: `src/pages/admin/index.astro`

**Interfaces:**
- Consumes: `/api/me` (`user.is_admin`, `user.is_announcer` — Task 2), `/api/admin/users` (`is_announcer` field — Task 3), `/api/admin/announcements` GET/POST and `/api/admin/announcements/:id` PATCH/DELETE (Task 4).
- Produces: nothing consumed by later tasks — this is the last consumer in the chain for the admin side.

- [ ] **Step 1: Widen the page's auth gate**

In `src/pages/admin/index.astro`'s `<script>` block, change the init IIFE's gate (currently):

```typescript
    if (!data.user || !data.user.is_admin) {
      document.getElementById('notAuth')!.classList.remove('hidden');
      return;
    }

    document.getElementById('adminContent')!.classList.remove('hidden');
    await loadUsers();
```

to:

```typescript
    if (!data.user || (!data.user.is_admin && !data.user.is_announcer)) {
      document.getElementById('notAuth')!.classList.remove('hidden');
      return;
    }

    document.getElementById('adminContent')!.classList.remove('hidden');
    const isFullAdmin = data.user.is_admin === true;
    document.getElementById('userManagementSection')!.classList.toggle('hidden', !isFullAdmin);
    await loadAnnouncements(isFullAdmin);
    if (isFullAdmin) await loadUsers();
```

- [ ] **Step 2: Wrap the existing user-management markup in a toggleable section**

In the template, wrap the existing "Filters" + "User table" blocks (currently two separate top-level `<div>`s inside `#adminContent`) in one new container. Change:

```astro
        <!-- Filters -->
        <div class="bg-white rounded-2xl border border-border shadow-sm p-4 mb-6 flex flex-wrap items-center gap-3">
```

to:

```astro
        <div id="userManagementSection">
        <!-- Filters -->
        <div class="bg-white rounded-2xl border border-border shadow-sm p-4 mb-6 flex flex-wrap items-center gap-3">
```

And close it right after the existing user-table `</div>` that currently ends the table section (the one right before the final `</div>` that closes `#adminContent`'s inner content — i.e. right after this existing line):

```astro
          <div id="emptyState" class="hidden text-center py-12 text-sm text-gray-400">No users found.</div>
        </div>

      </div>
    </div>
  </div>
</BaseLayout>
```

becomes:

```astro
          <div id="emptyState" class="hidden text-center py-12 text-sm text-gray-400">No users found.</div>
        </div>
        </div>

        <!-- Announcements section -->
        <div id="announcementsSection" class="mt-8">
          <h2 class="text-lg font-semibold text-navy mb-4">Announcements</h2>

          <div class="bg-white rounded-2xl border border-border shadow-sm p-4 mb-6">
            <form id="announcementForm" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input type="hidden" id="announcementEditId" value="" />
              <input id="annTitle" type="text" placeholder="Title" required
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid sm:col-span-2" />
              <textarea id="annDescription" placeholder="Description" required rows="2"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid sm:col-span-2"></textarea>
              <input id="annButtonText" type="text" placeholder="Button text (e.g. Formu Doldur)" required
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
              <input id="annButtonUrl" type="url" placeholder="Button URL" required
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
              <label class="flex items-center gap-2 text-sm text-gray-600">
                Expires on
                <input id="annExpiresAt" type="date" required
                  class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
              </label>
              <label class="flex items-center gap-2 text-sm text-gray-600">
                <input id="annShowAsPopup" type="checkbox" class="rounded border-border" />
                Also show as popup
              </label>
              <div class="sm:col-span-2 flex items-center gap-2">
                <button type="submit" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors">
                  Save announcement
                </button>
                <button type="button" id="cancelEditBtn" class="hidden px-4 py-2 rounded-xl border border-border text-sm text-gray-500">
                  Cancel edit
                </button>
              </div>
            </form>
          </div>

          <div class="bg-white rounded-2xl border border-border shadow-sm overflow-hidden">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-[#F7F7F6]">
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Title</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Expires</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Popup</th>
                  <th class="text-right px-5 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody id="announcementsTableBody"></tbody>
            </table>
            <div id="announcementsEmptyState" class="hidden text-center py-12 text-sm text-gray-400">No announcements yet.</div>
          </div>
        </div>

      </div>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 3: Add the "make announcer"/"remove announcer" buttons to the existing user actions menu**

In the `renderUsers` function's `moreActions` template (currently):

```typescript
      const moreActions = `
        <div class="relative inline-block">
          <button data-menu="${u.id}" class="more-btn text-xs px-2 py-1.5 rounded-lg border border-border text-gray-400 hover:text-navy hover:border-navy-mid transition-colors">⋯</button>
          <div id="menu-${u.id}" class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-border py-1 z-10 min-w-[160px]">
            ${u.is_admin
              ? `<button data-id="${u.id}" data-action="remove_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Remove admin</button>`
              : `<button data-id="${u.id}" data-action="make_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make admin</button>`
            }
            <button data-id="${u.id}" data-action="make_private" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make profile private</button>
            <button data-id="${u.id}" data-action="clear_bio" class="action-btn block w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50">Clear bio</button>
          </div>
        </div>`;
```

add the announcer toggle right after the admin toggle:

```typescript
      const moreActions = `
        <div class="relative inline-block">
          <button data-menu="${u.id}" class="more-btn text-xs px-2 py-1.5 rounded-lg border border-border text-gray-400 hover:text-navy hover:border-navy-mid transition-colors">⋯</button>
          <div id="menu-${u.id}" class="hidden absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-border py-1 z-10 min-w-[160px]">
            ${u.is_admin
              ? `<button data-id="${u.id}" data-action="remove_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Remove admin</button>`
              : `<button data-id="${u.id}" data-action="make_admin" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make admin</button>`
            }
            ${u.is_announcer
              ? `<button data-id="${u.id}" data-action="remove_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Remove announcer</button>`
              : `<button data-id="${u.id}" data-action="make_announcer" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make announcer</button>`
            }
            <button data-id="${u.id}" data-action="make_private" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make profile private</button>
            <button data-id="${u.id}" data-action="clear_bio" class="action-btn block w-full text-left px-4 py-2 text-xs text-red-500 hover:bg-red-50">Clear bio</button>
          </div>
        </div>`;
```

Also add an "Announcer" badge next to the existing "Admin" badge, so the user table shows current status. Change:

```typescript
      const adminBadge = u.is_admin
        ? '<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">Admin</span>'
        : '';
```

to:

```typescript
      const adminBadge = u.is_admin
        ? '<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">Admin</span>'
        : '';
      const announcerBadge = u.is_announcer
        ? '<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">Announcer</span>'
        : '';
```

and where `${memberBadge}${adminBadge}${privateBadge}` is rendered in the table row template, change it to `${memberBadge}${adminBadge}${announcerBadge}${privateBadge}`.

- [ ] **Step 4: Add the announcements client-side logic**

Add these functions to the same `<script>` block (anywhere after the existing `formatDate` function is a natural spot):

```typescript
  function formatExpiryDate(ts: number) {
    return new Date(ts * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function renderAnnouncements(items: any[]) {
    const tbody = document.getElementById('announcementsTableBody')!;
    const empty = document.getElementById('announcementsEmptyState')!;

    if (items.length === 0) {
      tbody.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    tbody.innerHTML = items.map(a => `
      <tr class="border-b border-border last:border-0 hover:bg-[#FAFAFA] transition-colors">
        <td class="px-5 py-4 text-navy font-medium">${a.title}</td>
        <td class="px-5 py-4 text-gray-400">${formatExpiryDate(a.expires_at)}</td>
        <td class="px-5 py-4 text-gray-400">${a.show_as_popup ? 'Yes' : 'No'}</td>
        <td class="px-5 py-4 text-right">
          <button data-id="${a.id}" class="edit-announcement-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-navy-mid hover:text-navy transition-colors mr-2">Edit</button>
          <button data-id="${a.id}" class="delete-announcement-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">Delete</button>
        </td>
      </tr>`).join('');

    tbody.querySelectorAll('.edit-announcement-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
        const item = items.find(a => a.id === id);
        if (!item) return;
        (document.getElementById('announcementEditId') as HTMLInputElement).value = item.id;
        (document.getElementById('annTitle') as HTMLInputElement).value = item.title;
        (document.getElementById('annDescription') as HTMLTextAreaElement).value = item.description;
        (document.getElementById('annButtonText') as HTMLInputElement).value = item.button_text;
        (document.getElementById('annButtonUrl') as HTMLInputElement).value = item.button_url;
        (document.getElementById('annExpiresAt') as HTMLInputElement).value = new Date(item.expires_at * 1000).toISOString().slice(0, 10);
        (document.getElementById('annShowAsPopup') as HTMLInputElement).checked = item.show_as_popup;
        document.getElementById('cancelEditBtn')!.classList.remove('hidden');
      });
    });

    tbody.querySelectorAll('.delete-announcement-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const b = e.currentTarget as HTMLButtonElement;
        b.disabled = true;
        const res = await fetch(`/api/admin/announcements/${b.dataset.id}`, { method: 'DELETE' });
        if (res.ok) { showToast('Deleted'); await loadAnnouncements(true); }
        else { showToast('Error', true); b.disabled = false; }
      });
    });
  }

  async function loadAnnouncements(canWrite: boolean) {
    const res = await fetch('/api/admin/announcements');
    if (!res.ok) return;
    const data = await res.json() as { announcements: any[] };
    renderAnnouncements(data.announcements);

    if (!canWrite) return;

    const form = document.getElementById('announcementForm') as HTMLFormElement;
    const cancelBtn = document.getElementById('cancelEditBtn')!;

    function resetForm() {
      form.reset();
      (document.getElementById('announcementEditId') as HTMLInputElement).value = '';
      cancelBtn.classList.add('hidden');
    }

    cancelBtn.addEventListener('click', resetForm);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const editId = (document.getElementById('announcementEditId') as HTMLInputElement).value;
      const expiresDate = (document.getElementById('annExpiresAt') as HTMLInputElement).value;
      const body = {
        title: (document.getElementById('annTitle') as HTMLInputElement).value,
        description: (document.getElementById('annDescription') as HTMLTextAreaElement).value,
        button_text: (document.getElementById('annButtonText') as HTMLInputElement).value,
        button_url: (document.getElementById('annButtonUrl') as HTMLInputElement).value,
        show_as_popup: (document.getElementById('annShowAsPopup') as HTMLInputElement).checked,
        expires_at: Math.floor(new Date(expiresDate).getTime() / 1000),
      };

      const url = editId ? `/api/admin/announcements/${editId}` : '/api/admin/announcements';
      const method = editId ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        showToast(editId ? 'Updated' : 'Created');
        resetForm();
        await loadAnnouncements(true);
      } else {
        const err = await res.json() as { error: string };
        showToast(err.error || 'Error', true);
      }
    });
  }
```

- [ ] **Step 5: Verify with a type-check build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 6: Manually verify in a local dev server**

```bash
wrangler pages dev dist --d1=DB=rsg-members --local --port=8788 &
sleep 2
```

Set the local `test-announcer-1` user's cookie manually isn't practical without going through real Google OAuth, so verify this task's rendering logic by loading the page unauthenticated first:

```bash
curl -s http://localhost:8788/admin/ | grep -o 'id="notAuth"'
```

Expected: the string is found (confirms the page still serves; the actual auth-gated JS behavior needs a real browser + real login, which is out of scope for an automated check — do a final manual pass in a real browser with a real admin account before merging, logging in, confirming the Announcements section renders, and creating/editing/deleting a test announcement end-to-end).

`kill %1` when done.

- [ ] **Step 7: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "Add announcements management UI to admin panel"
```

---

## Task 6: Homepage — dynamic Webinar card, announcement cards, and popup

**Files:**
- Modify: `src/pages/index.astro`

**Interfaces:**
- Consumes: `getCollection('webinars', ...)` (existing Astro API, mirrors the file's own existing `latestPosts` pattern), `GET /api/announcements` (Task 4).
- Produces: nothing consumed elsewhere — this is the final task.

- [ ] **Step 1: Make the Webinar card dynamic**

Add a `latestWebinar` query alongside the existing `latestPosts` one (currently lines 10-12):

```astro
const latestPosts = (await getCollection('blog', ({ id, data }) => id.startsWith('en/') && !data.draft))
  .sort((a, b) => b.data.pubDate.getTime() - a.data.pubDate.getTime())
  .slice(0, 3);

const latestWebinar = (await getCollection('webinars', ({ id, data }) => id.startsWith('en/') && !data.draft))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())[0];
```

Then replace the Webinar card's body (currently):

```astro
        <!-- Webinar card -->
        <div class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors">
          <span class="inline-block text-xs font-medium px-2.5 py-1 rounded bg-[#FDEAEA] text-red mb-4">
            Webinar
          </span>
          <h3 class="text-base font-semibold text-navy mb-2">{t('contentCards.webinar.title')}</h3>
          <p class="text-sm text-gray-500 leading-relaxed mb-4">{t('contentCards.webinar.description')}</p>
          <a href="/webinars" class="text-sm font-medium text-navy-mid hover:text-navy transition-colors">
            {t('contentCards.webinar.button')} →
          </a>
        </div>
```

with:

```astro
        <!-- Webinar card -->
        <div id="webinarCard" class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
          <span class="inline-block text-xs font-medium px-2.5 py-1 rounded bg-[#FDEAEA] text-red mb-4 self-start">
            Webinar
          </span>
          {latestWebinar ? (
            <div class="flex-1 flex flex-col">
              <p class="text-xs text-gray-400 mb-1">
                {new Date(latestWebinar.data.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
              <h3 class="text-sm font-semibold text-navy leading-snug mb-3">{latestWebinar.data.title}</h3>
              {latestWebinar.data.description && (
                <p class="text-xs text-gray-500 leading-relaxed mb-4 flex-1">{latestWebinar.data.description.slice(0, 100)}{latestWebinar.data.description.length > 100 ? '…' : ''}</p>
              )}
              <a href={`/webinars/${latestWebinar.id.replace(/^en\//, '')}`} class="text-sm font-medium text-navy-mid hover:text-navy transition-colors mt-auto">
                {t('common.readMore')} →
              </a>
            </div>
          ) : (
            <div class="flex-1 flex flex-col">
              <h3 class="text-base font-semibold text-navy mb-2">{t('contentCards.webinar.title')}</h3>
              <p class="text-sm text-gray-500 leading-relaxed mb-4 flex-1">{t('contentCards.webinar.description')}</p>
              <a href="/webinars" class="text-sm font-medium text-navy-mid hover:text-navy transition-colors">
                {t('contentCards.webinar.button')} →
              </a>
            </div>
          )}
        </div>
```

Also add `id="eventCard"` and `id="blogCard"` to the existing Event and Blog card `<div>`s (currently the Event card's outer div has no id, and the Blog card's outer div has no id) so the new script in Step 3 can address all three by id — change:

```astro
        <!-- Events card (live calendar) -->
        <div class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
```
to
```astro
        <!-- Events card (live calendar) -->
        <div id="eventCard" class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
```

and:

```astro
        <!-- Blog card -->
        <div class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
```
to
```astro
        <!-- Blog card -->
        <div id="blogCard" class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
```

Finally, give the grid container itself an id so the new script can read/replace its children — change:

```astro
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
```
to
```astro
      <div id="contentCardsGrid" class="grid grid-cols-1 md:grid-cols-3 gap-6">
```

- [ ] **Step 2: Verify the build with zero announcements (baseline, unchanged behavior)**

Run: `npm run build`
Expected: no errors. Then:

```bash
grep -o '<h3[^>]*>[^<]*</h3>' dist/en/index.html 2>/dev/null || grep -o '<h3[^>]*>[^<]*</h3>' dist/index.html
```

Expected: shows the real latest webinar's title (not the old static "Open Student Webinars" placeholder copy) alongside the blog card's title — confirms Step 1 works before the client-side script (Step 3) is added.

- [ ] **Step 3: Add the announcement-fetching, card-replacement, and popup script**

Add this to the existing `<script>` block in `src/pages/index.astro`, after the existing `loadCalendar();` call at the very end of the file:

```typescript
  type ApiAnnouncement = {
    id: string;
    title: string;
    description: string;
    button_text: string;
    button_url: string;
    show_as_popup: boolean;
  };

  function announcementCardHtml(a: ApiAnnouncement): string {
    const label = isTR ? 'Duyuru' : 'Announcement';
    return `
      <div class="bg-navy-light border border-[#C4CEEA] rounded-lg p-6 hover:border-navy-mid transition-colors flex flex-col">
        <span class="inline-block text-xs font-medium px-2.5 py-1 rounded bg-[#FDEAEA] text-red mb-4 self-start">${label}</span>
        <div class="flex-1 flex flex-col">
          <h3 class="text-sm font-semibold text-navy leading-snug mb-3">${a.title}</h3>
          <p class="text-xs text-gray-500 leading-relaxed mb-4 flex-1">${a.description}</p>
          <a href="${a.button_url}" class="text-sm font-medium text-navy-mid hover:text-navy transition-colors mt-auto">${a.button_text} →</a>
        </div>
      </div>`;
  }

  function showAnnouncementPopup(a: ApiAnnouncement) {
    const dismissKey = `dismissed_announcement_${a.id}`;
    if (localStorage.getItem(dismissKey)) return;

    const closeLabel = isTR ? 'Kapat' : 'Close';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,32,69,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px;';
    overlay.innerHTML = `
      <div style="background:white;border-radius:16px;max-width:420px;width:100%;padding:28px;position:relative;">
        <button aria-label="${closeLabel}" style="position:absolute;top:12px;right:12px;width:28px;height:28px;border-radius:50%;border:none;background:#F7F7F6;color:#0f2045;cursor:pointer;font-size:16px;">✕</button>
        <h3 style="font-size:18px;font-weight:700;color:#0f2045;margin:0 0 8px;">${a.title}</h3>
        <p style="font-size:14px;color:#6b7280;line-height:1.6;margin:0 0 20px;">${a.description}</p>
        <a href="${a.button_url}" style="display:inline-flex;align-items:center;padding:10px 20px;border-radius:8px;background:#dc2626;color:white;font-size:14px;font-weight:500;text-decoration:none;">${a.button_text}</a>
      </div>`;

    function close() {
      localStorage.setItem(dismissKey, '1');
      overlay.remove();
    }
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('button')!.addEventListener('click', close);

    document.body.appendChild(overlay);
  }

  async function loadAnnouncements() {
    try {
      const res = await fetch('/api/announcements');
      if (!res.ok) return;
      const data = await res.json() as { announcements: ApiAnnouncement[] };
      const active = data.announcements;
      if (active.length === 0) return;

      const grid = document.getElementById('contentCardsGrid')!;
      const defaults = [
        document.getElementById('webinarCard')!,
        document.getElementById('eventCard')!,
        document.getElementById('blogCard')!,
      ];
      const announcementHtml = active.map(announcementCardHtml).join('');
      const keptDefaults = defaults.slice(active.length).map(el => el.outerHTML).join('');
      grid.innerHTML = announcementHtml + keptDefaults;

      const popupAnnouncement = active.find(a => a.show_as_popup);
      if (popupAnnouncement) showAnnouncementPopup(popupAnnouncement);
    } catch {
      // Network error: leave the three default cards exactly as server-rendered.
    }
  }

  loadAnnouncements();
```

This reuses the `isTR` constant the file's existing calendar script already defines near the top of the same `<script>` block — no new constant needed.

- [ ] **Step 4: Verify with a type-check build**

Run: `npm run build`
Expected: no TypeScript errors.

- [ ] **Step 5: Manually verify card replacement end-to-end against local D1 + dev server**

```bash
wrangler pages dev dist --d1=DB=rsg-members --local --port=8788 &
sleep 2

# Zero announcements: confirm baseline cards still show (webinar/event/blog)
curl -s http://localhost:8788/ | grep -o 'id="webinarCard"\|id="eventCard"\|id="blogCard"'
# Expected: all three ids present in the server-rendered HTML.

# Insert one active announcement, with show_as_popup=1
wrangler d1 execute rsg-members --local --command="INSERT INTO announcements (id, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at) VALUES ('ann-live-1', 'Gönüllü Arıyoruz', 'Ekibimize katıl.', 'Formu Doldur', 'https://forms.gle/example', 1, 9999999999, 'test-announcer-1', 1735689600)"

curl -s http://localhost:8788/api/announcements
# Expected: {"announcements":[{"id":"ann-live-1","title":"Gönüllü Arıyoruz", ...,"show_as_popup":true}]}
```

Then open `http://localhost:8788/` in a real browser (this part can't be verified via `curl`, since the card replacement and popup are client-side JS): confirm the leftmost card now shows "Gönüllü Arıyoruz" with an "Announcement" tag, the Webinar card is gone, Event and Blog cards remain, and a popup with the same content appears once, then stays dismissed on reload (check `localStorage.dismissed_announcement_ann-live-1` is set in devtools after closing it).

Clean up the test data and stop the server:

```bash
wrangler d1 execute rsg-members --local --command="DELETE FROM announcements WHERE id IN ('ann-1', 'ann-expired', 'ann-live-1')"
wrangler d1 execute rsg-members --local --command="DELETE FROM users WHERE id = 'test-announcer-1'"
kill %1
```

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "Make Webinar card dynamic; add announcement cards and popup to homepage"
```
