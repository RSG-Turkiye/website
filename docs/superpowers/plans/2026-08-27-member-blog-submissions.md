# Member Blog Submissions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let members holding a new `is_writer` role submit blog posts through the website; let an admin (in both the English and Turkish admin panels) review and approve/reject them; on approval, automatically open a GitHub PR containing the new markdown file(s), publishing through the site's existing git-based blog pipeline.

**Architecture:** A new D1 table (`blog_submissions`) holds pending/rejected/approved submissions. A new `is_writer` boolean flag (mirroring the existing `is_admin`/`is_announcer` pattern) gates who can submit. Approval is the only step that talks to GitHub: a new `functions/_lib/github.ts` helper wraps the GitHub REST API to create a branch, commit one or two markdown files (matching the existing `blog` content-collection schema exactly), and open a PR — nothing about the 10 existing pages that already consume `getCollection('blog', ...)` changes. Images upload to a new Cloudflare R2 bucket at submission time.

**Tech Stack:** Astro 5 (content collections, unchanged), Cloudflare Pages Functions (TypeScript), Cloudflare D1 (SQLite), Cloudflare R2 (object storage), GitHub REST API v3.

**Spec:** `docs/superpowers/specs/2026-08-27-member-blog-submissions-design.md`

## Global Constraints

- All timestamps are Unix **seconds** (`Math.floor(Date.now() / 1000)`), never milliseconds — matches every existing table in `db/schema.sql`.
- Follow the existing session-cookie auth pattern in `functions/_lib/auth.ts` exactly: `getSessionUser(request, env)`, `checkCsrf(request)`, `jsonResponse(data, status)` on every new route.
- `is_writer` is an independent boolean flag, like `is_admin`/`is_announcer`/`is_member` — no role table, no hierarchy.
- Only `is_admin` may review (approve/reject) submissions. `is_writer` alone never grants review capability.
- The GitHub bot token (`GITHUB_PAT`) is a Cloudflare secret, never committed, never stored in D1.
- A submission's `status`/`pr_url`/`reviewed_at`/`reviewed_by` are only ever updated together, and only after a PR is confirmed successfully created — a failed GitHub API call must leave the row exactly as it was.
- New admin-facing UI is built for **both** `src/pages/admin/index.astro` and `src/pages/tr/admin/index.astro` in the same task — never deferred to a follow-up task for the Turkish page (a prior feature on this branch had to backfill this after shipping English-only, twice; this plan does not repeat that).
- This project has no test runner (`npm test` is not a defined script). Verification is: `npm run build` (must stay clean), `npx tsc --noEmit` (must stay clean), and manual verification against `wrangler pages dev dist --local --port=8788` + `wrangler d1 execute rsg-members --local` — the same convention used throughout this codebase's existing Functions code. Do NOT add `--d1=DB=rsg-members` to the `wrangler pages dev` command — `wrangler.toml` already declares the binding, and that flag creates a second, disconnected local D1.
- The GitHub repo this feature opens PRs against is `RSG-Turkiye/website`, base branch `main` — hardcode these as constants, not configurable vars (this feature only ever targets this one repo).

---

### Task 1: DB schema

**Files:**
- Modify: `db/schema.sql`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `users.is_writer` column; `blog_submissions` table with columns `id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, rejection_reason, pr_url, paired_submission_id, created_at, reviewed_at, reviewed_by` — every later task's SQL uses exactly these names.

- [ ] **Step 1: Add the `is_writer` column and the migration note**

Open `db/schema.sql`. Find the `users` table definition and add `is_writer` right after `is_announcer`:

```sql
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  is_member     INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_announcer  INTEGER NOT NULL DEFAULT 0,
  is_writer     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL
);
```

At the top of the file, in the existing "REQUIRED: run BOTH of the following against production BEFORE deploying" comment block, add a third required command (keep the two existing ones — for `is_announcer` and for the `announcements` table — exactly as they are, just append):

```sql
-- 3. This file's `CREATE TABLE IF NOT EXISTS blog_submissions` statement
--    below is NOT applied to production automatically -- it must be run
--    by hand (`IF NOT EXISTS` makes it safe to re-run):
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_writer INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --command="CREATE TABLE IF NOT EXISTS blog_submissions (id TEXT PRIMARY KEY, submitted_by TEXT NOT NULL REFERENCES users(id), lang TEXT NOT NULL CHECK (lang IN ('en', 'tr')), title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', author TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')), rejection_reason TEXT, pr_url TEXT, paired_submission_id TEXT REFERENCES blog_submissions(id), created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id))"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_blog_submissions_status ON blog_submissions(status)"
--    Without this, /api/blog-submissions and /api/admin/blog-submissions
--    500 with "no such table: blog_submissions".
```

- [ ] **Step 2: Add the `blog_submissions` table**

Find the `announcements` table block (the last `CREATE TABLE` before the indexes section) and add this new block right after it, before the `CREATE INDEX` lines:

```sql
-- Member blog submissions: a member with is_writer submits through the
-- website; an admin approves or rejects. Approval opens a real GitHub PR
-- (see functions/_lib/github.ts) -- git remains the single source of
-- truth for published posts, this table only holds the pending/rejected
-- work-in-progress state before that PR exists.
CREATE TABLE IF NOT EXISTS blog_submissions (
  id                   TEXT PRIMARY KEY,
  submitted_by         TEXT NOT NULL REFERENCES users(id),
  lang                 TEXT NOT NULL CHECK (lang IN ('en', 'tr')),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  category             TEXT NOT NULL,
  tags                 TEXT NOT NULL DEFAULT '[]',
  author               TEXT NOT NULL,
  image_url            TEXT NOT NULL DEFAULT '',
  body                 TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason     TEXT,
  pr_url               TEXT,
  paired_submission_id TEXT REFERENCES blog_submissions(id),
  created_at           INTEGER NOT NULL,
  reviewed_at          INTEGER,
  reviewed_by          TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_blog_submissions_status ON blog_submissions(status);
```

- [ ] **Step 3: Verify locally**

```bash
wrangler d1 execute rsg-members --local --file=db/schema.sql
wrangler d1 execute rsg-members --local --command="SELECT sql FROM sqlite_master WHERE name = 'blog_submissions'"
```

Expected: no errors, and the second command prints the `CREATE TABLE` statement back, confirming the table was created in the local D1.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "Add is_writer column and blog_submissions table to schema"
```

---

### Task 2: Auth plumbing — `is_writer` exposure and admin role toggle

**Files:**
- Modify: `functions/_lib/auth.ts`
- Modify: `functions/api/me.ts`
- Modify: `functions/api/admin/users.ts`

**Interfaces:**
- Consumes: `users.is_writer` column (Task 1).
- Produces: `User.is_writer: number` on the shared `User` type; `GET /api/me` response includes `user.is_writer: boolean`; `PATCH /api/admin/users` accepts `make_writer`/`remove_writer` actions; `GET /api/admin/users` includes `is_writer` in each row. Later tasks' auth checks read `user.is_writer === 1` server-side and `data.user.is_writer === true` client-side.

- [ ] **Step 1: Add `is_writer` to the `User` interface**

In `functions/_lib/auth.ts`, find the `User` interface:

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

Add `is_writer` right after `is_announcer`:

```typescript
export interface User {
  id: string;
  google_id: string;
  email: string;
  is_member: number;
  is_admin: number;
  is_announcer: number;
  is_writer: number;
  created_at: number;
  last_login: number;
}
```

- [ ] **Step 2: Expose `is_writer` from `/api/me`**

In `functions/api/me.ts`, find the `user` object in the returned `jsonResponse`:

```typescript
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
      is_announcer: user.is_announcer === 1,
    },
```

Add `is_writer`:

```typescript
    user: {
      id: user.id,
      email: user.email,
      is_member: user.is_member === 1,
      is_admin: user.is_admin === 1,
      is_announcer: user.is_announcer === 1,
      is_writer: user.is_writer === 1,
    },
```

- [ ] **Step 3: Add `is_writer` to the admin users list and add `make_writer`/`remove_writer` actions**

In `functions/api/admin/users.ts`, find the `SELECT` in `onRequestGet`:

```typescript
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.created_at, u.last_login,
```

Add `u.is_writer`:

```typescript
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.is_writer, u.created_at, u.last_login,
```

In the same file's `onRequestPatch`, find the action union type:

```typescript
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_announcer' | 'remove_announcer'
      | 'make_private' | 'clear_bio' | 'set_rank' | 'award_badge' | 'revoke_badge';
```

Add `make_writer`/`remove_writer`:

```typescript
    action: 'verify' | 'unverify' | 'make_admin' | 'remove_admin' | 'make_announcer' | 'remove_announcer'
      | 'make_writer' | 'remove_writer' | 'make_private' | 'clear_bio' | 'set_rank' | 'award_badge' | 'revoke_badge';
```

Find the `switch (body.action)` block's `make_announcer`/`remove_announcer` cases:

```typescript
    case 'make_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_announcer':
      await env.DB.prepare('UPDATE users SET is_announcer = 0 WHERE id = ?').bind(body.user_id).run();
      break;
```

Add the writer cases right after:

```typescript
    case 'make_writer':
      await env.DB.prepare('UPDATE users SET is_writer = 1 WHERE id = ?').bind(body.user_id).run();
      break;
    case 'remove_writer':
      await env.DB.prepare('UPDATE users SET is_writer = 0 WHERE id = ?').bind(body.user_id).run();
      break;
```

- [ ] **Step 4: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors from either command.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/auth.ts functions/api/me.ts functions/api/admin/users.ts
git commit -m "Expose is_writer on session user, add make_writer/remove_writer admin actions"
```

---

### Task 3: GitHub API client helper

**Files:**
- Create: `functions/_lib/github.ts`

**Interfaces:**
- Consumes: `env.GITHUB_PAT` (a new secret — not set by this task; see the note in Step 5).
- Produces: `openBlogPostPR(params: OpenPrParams, env: Env): Promise<OpenPrResult>` where:
  ```typescript
  type OpenPrParams = {
    branchSlug: string; // used to build the branch name; not a file path
    files: Array<{ path: string; content: string }>; // repo-relative paths + full file text
    title: string;
    prBody: string;
  };
  type OpenPrResult = { success: true; prUrl: string } | { success: false; error: string };
  ```
  Task 6 (admin approve endpoint) is the only consumer of `openBlogPostPR`.

- [ ] **Step 1: Write the GitHub API wrapper**

Create `functions/_lib/github.ts`:

```typescript
import type { Env } from './auth';

const GITHUB_OWNER = 'RSG-Turkiye';
const GITHUB_REPO = 'website';
const GITHUB_BASE_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';

type OpenPrParams = {
  branchSlug: string;
  files: Array<{ path: string; content: string }>;
  title: string;
  prBody: string;
};

type OpenPrResult = { success: true; prUrl: string } | { success: false; error: string };

async function githubRequest(
  path: string,
  init: RequestInit,
  env: Env
): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rsg-turkiye-website',
      ...(init.headers ?? {}),
    },
  });
}

function toBase64Utf8(content: string): string {
  // nodejs_compat is enabled in wrangler.toml, so Buffer is available.
  // btoa() alone would corrupt non-Latin1 characters (ı, ş, ğ, ç, ö, ü),
  // which real post content will contain.
  return Buffer.from(content, 'utf-8').toString('base64');
}

async function getBaseBranchSha(env: Env): Promise<string> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BASE_BRANCH}`,
    { method: 'GET' },
    env
  );
  if (!res.ok) throw new Error(`Failed to read base branch ref (${res.status})`);
  const data = await res.json<{ object: { sha: string } }>();
  return data.object.sha;
}

async function createBranch(branchName: string, baseSha: string, env: Env): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    },
    env
  );
  if (res.status === 422) {
    // Branch name already exists (e.g. a prior failed attempt left it
    // behind). Treat as usable rather than failing -- the commit step
    // will fail loudly on its own if this branch is actually unusable.
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create branch ${branchName} (${res.status}): ${body}`);
  }
}

async function commitFile(
  branchName: string,
  filePath: string,
  content: string,
  message: string,
  env: Env
): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: toBase64Utf8(content),
        branch: branchName,
      }),
    },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to commit ${filePath} (${res.status}): ${body}`);
  }
}

async function createPullRequest(
  branchName: string,
  title: string,
  body: string,
  env: Env
): Promise<string> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: branchName,
        base: GITHUB_BASE_BRANCH,
        body,
      }),
    },
    env
  );
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to open PR (${res.status}): ${errBody}`);
  }
  const data = await res.json<{ html_url: string }>();
  return data.html_url;
}

/**
 * Checks whether a file already exists at `filePath` on the base branch.
 * Used before opening a PR to catch a slug collision early.
 */
export async function fileExistsOnBaseBranch(filePath: string, env: Env): Promise<boolean> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BASE_BRANCH}`,
    { method: 'GET' },
    env
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  const body = await res.text();
  throw new Error(`Failed to check ${filePath} (${res.status}): ${body}`);
}

/**
 * Creates a branch, commits one or two files to it, and opens a PR
 * against main. Returns { success: false, error } on any failure without
 * throwing -- callers (the admin approve endpoint) must not update a
 * submission's status unless this returns { success: true }.
 */
export async function openBlogPostPR(params: OpenPrParams, env: Env): Promise<OpenPrResult> {
  const branchName = `blog-submission/${params.branchSlug}`;
  try {
    const baseSha = await getBaseBranchSha(env);
    await createBranch(branchName, baseSha, env);
    for (const file of params.files) {
      await commitFile(branchName, file.path, file.content, `Add ${file.path}`, env);
    }
    const prUrl = await createPullRequest(branchName, params.title, params.prBody, env);
    return { success: true, prUrl };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown GitHub API error' };
  }
}
```

- [ ] **Step 2: Add `GITHUB_PAT` to the `Env` interface**

In `functions/_lib/auth.ts`, find:

```typescript
export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}
```

Add `GITHUB_PAT`:

```typescript
export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_PAT: string;
}
```

- [ ] **Step 3: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors. `functions/_lib/github.ts` is not yet called from anywhere (Task 6 wires it up), so there is nothing to exercise at runtime yet — this task is verified by type-checking cleanly.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/auth.ts functions/_lib/github.ts
git commit -m "Add GitHub API client helper for opening blog-post PRs"
```

- [ ] **Step 5: Leave a note for the human operator (do not attempt this yourself)**

This task does not (and cannot, from within this environment) create the actual GitHub PAT or set the `GITHUB_PAT` secret — that requires a human to generate a fine-grained Personal Access Token from a dedicated bot GitHub account (scoped to `RSG-Turkiye/website` only, with `Contents: Read and write` and `Pull requests: Read and write` permissions) and run:

```bash
wrangler pages secret put GITHUB_PAT --project-name website
```

Record this as a note in your final report; do not block on it — Task 6's local verification uses a mocked GitHub response (see Task 6 Step 4), not a real token.

---

### Task 4: R2 bucket binding and image upload endpoint

**Files:**
- Modify: `wrangler.toml`
- Modify: `functions/_lib/auth.ts`
- Create: `functions/api/blog-submissions/upload-image.ts`

**Interfaces:**
- Consumes: `canSubmitBlogPost` is not needed here — this endpoint checks `user.is_writer === 1` directly, matching the style of other single-flag checks in this codebase.
- Produces: `POST /api/blog-submissions/upload-image` — request body is the raw image bytes with a `Content-Type` header identifying the MIME type; response `{ url: string }` on success. Task 7 (member submission UI) is the only consumer.

- [ ] **Step 1: Add the R2 binding**

In `wrangler.toml`, add a new `[[r2_buckets]]` section after the existing `[[d1_databases]]` block:

```toml
[[r2_buckets]]
binding = "BLOG_IMAGES"
bucket_name = "rsg-blog-images"
```

Add a new var for the bucket's public base URL (a placeholder for now — the human operator sets the real value after creating the bucket and its public access method, see Step 5):

```toml
[vars]
GOOGLE_CLIENT_ID = "273051123979-t52aq69ueh1mji460qie6ip2j68c3agc.apps.googleusercontent.com"
PUBLIC_BLOG_IMAGES_URL = "https://pub-placeholder.r2.dev"
```

- [ ] **Step 2: Add `BLOG_IMAGES`/`PUBLIC_BLOG_IMAGES_URL` to the `Env` interface**

In `functions/_lib/auth.ts`, find the `Env` interface (already modified by Task 3 to include `GITHUB_PAT`):

```typescript
export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_PAT: string;
}
```

Add the two new bindings:

```typescript
export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_PAT: string;
  BLOG_IMAGES: R2Bucket;
  PUBLIC_BLOG_IMAGES_URL: string;
}
```

- [ ] **Step 3: Write the upload endpoint**

Create `functions/api/blog-submissions/upload-image.ts`:

```typescript
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_writer !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const contentType = request.headers.get('Content-Type') ?? '';
  const extension = ALLOWED_TYPES[contentType];
  if (!extension) {
    return jsonResponse({ error: 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.' }, 400);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: 'Empty file' }, 400);
  }
  if (bytes.byteLength > MAX_BYTES) {
    return jsonResponse({ error: 'Image too large (max 5MB)' }, 400);
  }

  const key = `${crypto.randomUUID()}.${extension}`;
  await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType } });

  return jsonResponse({ url: `${env.PUBLIC_BLOG_IMAGES_URL}/${key}` });
};
```

- [ ] **Step 4: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors. `R2Bucket` is a global type provided by `@cloudflare/workers-types`, already available in this project (the same way `D1Database`/`PagesFunction` are used without an explicit import elsewhere in `functions/`).

Manual local verification (R2 has local emulation via `--local`, same as D1):

```bash
wrangler pages dev dist --local --port=8788 &
sleep 2
curl -s -X POST http://localhost:8788/api/blog-submissions/upload-image \
  -H "Content-Type: image/png" \
  --data-binary "@/dev/null"
# Expected: {"error":"Empty file"} (401/403 if you don't have a logged-in
# session cookie set -- that's also correct behavior; either response
# confirms the route exists and the guard checks run in order).
kill %1
```

- [ ] **Step 5: Leave a note for the human operator (do not attempt this yourself)**

This task cannot create the actual R2 bucket or configure its public access from within this environment. The human operator needs to:

```bash
wrangler r2 bucket create rsg-blog-images
```

...then enable public access (either the bucket's own `r2.dev` public URL, or a custom domain) via the Cloudflare dashboard, and update `PUBLIC_BLOG_IMAGES_URL` in `wrangler.toml` (and redeploy) to the real public base URL once known. Record this as a note in your final report; do not block on it.

- [ ] **Step 6: Commit**

```bash
git add wrangler.toml functions/_lib/auth.ts functions/api/blog-submissions/upload-image.ts
git commit -m "Add R2 bucket binding and blog-submission image upload endpoint"
```

---

### Task 5: Member-facing blog submissions API

**Files:**
- Create: `functions/api/blog-submissions.ts`
- Create: `functions/api/blog-submissions/[id].ts`

**Interfaces:**
- Consumes: `getSessionUser`, `checkCsrf`, `jsonResponse`, `generateId` from `functions/_lib/auth.ts` (all pre-existing, unchanged); `blog_submissions` table (Task 1).
- Produces:
  - `GET /api/blog-submissions` → `{ submissions: SubmissionRow[] }` (the caller's own submissions only).
  - `POST /api/blog-submissions` → creates one row, or two paired rows if `translation` is present in the body; returns `{ ok: true, id: string }` (the primary submission's id).
  - `PATCH /api/blog-submissions/:id` → edits and resets to `pending` a submission the caller owns whose `status` is `'rejected'`; if the submission is paired, updates both rows together. Returns `{ ok: true }`.
  - `SubmissionRow` shape (used by Task 7's UI): `{ id, lang, title, description, category, tags: string[], author, image_url, body, slug, status, rejection_reason, pr_url, paired_submission_id }` (tags parsed from the stored JSON-text column back into an array before being returned).

- [ ] **Step 1: Write the list + create endpoint**

Create `functions/api/blog-submissions.ts`:

```typescript
import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../_lib/auth';

type SubmissionRow = {
  id: string;
  submitted_by: string;
  lang: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  author: string;
  image_url: string;
  body: string;
  slug: string;
  status: string;
  rejection_reason: string | null;
  pr_url: string | null;
  paired_submission_id: string | null;
  created_at: number;
};

function toPublicShape(row: SubmissionRow) {
  return {
    id: row.id,
    lang: row.lang,
    title: row.title,
    description: row.description,
    category: row.category,
    tags: JSON.parse(row.tags) as string[],
    author: row.author,
    image_url: row.image_url,
    body: row.body,
    slug: row.slug,
    status: row.status,
    rejection_reason: row.rejection_reason,
    pr_url: row.pr_url,
    paired_submission_id: row.paired_submission_id,
  };
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

type LangPost = {
  title: string;
  description: string;
  tags: string[];
  body: string;
};

type CreateBody = LangPost & {
  lang: 'en' | 'tr';
  category: string;
  author: string;
  image_url?: string;
  translation?: LangPost & { lang: 'en' | 'tr' };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const result = await env.DB.prepare(
    'SELECT * FROM blog_submissions WHERE submitted_by = ? ORDER BY created_at DESC'
  ).bind(user.id).all<SubmissionRow>();

  return jsonResponse({ submissions: result.results.map(toPublicShape) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_writer !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<CreateBody>();

  if (!body.lang || !body.title || !body.description || !body.category || !body.author || !body.body) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }
  if (body.translation && (!body.translation.title || !body.translation.description || !body.translation.body)) {
    return jsonResponse({ error: 'Missing required field in translation' }, 400);
  }

  const slug = slugify(body.title);
  const now = Math.floor(Date.now() / 1000);
  const imageUrl = body.image_url ?? '';
  const tagsJson = JSON.stringify(body.tags ?? []);

  const primaryId = generateId();

  if (!body.translation) {
    await env.DB.prepare(
      `INSERT INTO blog_submissions
        (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      primaryId, user.id, body.lang, body.title, body.description, body.category,
      tagsJson, body.author, imageUrl, body.body, slug, now
    ).run();

    return jsonResponse({ ok: true, id: primaryId });
  }

  const translation = body.translation;
  const pairedId = generateId();
  const pairedTagsJson = JSON.stringify(translation.tags ?? []);

  await env.DB.prepare(
    `INSERT INTO blog_submissions
      (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at, paired_submission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    primaryId, user.id, body.lang, body.title, body.description, body.category,
    tagsJson, body.author, imageUrl, body.body, slug, now, pairedId
  ).run();

  await env.DB.prepare(
    `INSERT INTO blog_submissions
      (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at, paired_submission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    pairedId, user.id, translation.lang, translation.title, translation.description, body.category,
    pairedTagsJson, body.author, imageUrl, translation.body, slug, now, primaryId
  ).run();

  return jsonResponse({ ok: true, id: primaryId });
};
```

- [ ] **Step 2: Write the edit-and-resubmit endpoint**

Create `functions/api/blog-submissions/[id].ts`:

```typescript
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';

type LangPost = {
  title: string;
  description: string;
  tags: string[];
  body: string;
};

type ResubmitBody = LangPost & {
  category: string;
  author: string;
  image_url?: string;
  translation?: LangPost;
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const id = params.id as string;
  const existing = await env.DB.prepare(
    'SELECT id, submitted_by, status, paired_submission_id FROM blog_submissions WHERE id = ?'
  ).bind(id).first<{ id: string; submitted_by: string; status: string; paired_submission_id: string | null }>();

  if (!existing) return jsonResponse({ error: 'Not found' }, 404);
  if (existing.submitted_by !== user.id) return jsonResponse({ error: 'Forbidden' }, 403);
  if (existing.status !== 'rejected') {
    return jsonResponse({ error: 'Only a rejected submission can be edited and resubmitted' }, 400);
  }

  const body = await request.json<ResubmitBody>();
  if (!body.title || !body.description || !body.category || !body.author || !body.body) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }

  const imageUrl = body.image_url ?? '';
  const tagsJson = JSON.stringify(body.tags ?? []);

  await env.DB.prepare(
    `UPDATE blog_submissions
     SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
         status = 'pending', rejection_reason = NULL
     WHERE id = ?`
  ).bind(body.title, body.description, body.category, tagsJson, body.author, imageUrl, body.body, id).run();

  if (existing.paired_submission_id && body.translation) {
    const t = body.translation;
    const pairedTagsJson = JSON.stringify(t.tags ?? []);
    await env.DB.prepare(
      `UPDATE blog_submissions
       SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
           status = 'pending', rejection_reason = NULL
       WHERE id = ?`
    ).bind(t.title, t.description, body.category, pairedTagsJson, body.author, imageUrl, t.body, existing.paired_submission_id).run();
  }

  return jsonResponse({ ok: true });
};
```

- [ ] **Step 3: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors.

Manual local verification:

```bash
wrangler pages dev dist --local --port=8788 &
sleep 2

# Create a test writer user and a session for it
wrangler d1 execute rsg-members --local --command="INSERT INTO users (id, google_id, email, is_member, is_admin, is_writer, created_at, last_login) VALUES ('test-writer-1', 'g-test-writer-1', 'writer@example.com', 1, 0, 1, 1735689600, 1735689600)"
wrangler d1 execute rsg-members --local --command="INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('test-session-1', 'test-writer-1', 9999999999, 1735689600)"

curl -s -X POST http://localhost:8788/api/blog-submissions \
  -H "Content-Type: application/json" \
  -H "Cookie: rsg_session=test-session-1" \
  -d '{"lang":"en","title":"Test Post","description":"A test","category":"community","tags":["test"],"author":"Test Writer","body":"Hello world"}'
# Expected: {"ok":true,"id":"<some-uuid>"}

curl -s http://localhost:8788/api/blog-submissions -H "Cookie: rsg_session=test-session-1"
# Expected: {"submissions":[{"id":"...","lang":"en","title":"Test Post",...,"status":"pending",...}]}

wrangler d1 execute rsg-members --local --command="DELETE FROM blog_submissions WHERE submitted_by = 'test-writer-1'"
wrangler d1 execute rsg-members --local --command="DELETE FROM sessions WHERE id = 'test-session-1'"
wrangler d1 execute rsg-members --local --command="DELETE FROM users WHERE id = 'test-writer-1'"
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add functions/api/blog-submissions.ts "functions/api/blog-submissions/[id].ts"
git commit -m "Add member-facing blog submissions API (list, create, edit-and-resubmit)"
```

---

### Task 6: Admin-facing blog submissions API (review, approve, reject)

**Files:**
- Create: `functions/api/admin/blog-submissions.ts`
- Create: `functions/api/admin/blog-submissions/[id].ts`

**Interfaces:**
- Consumes: `openBlogPostPR`, `fileExistsOnBaseBranch` from `functions/_lib/github.ts` (Task 3); `blog_submissions` table (Task 1); the same `toPublicShape`-equivalent field list Task 5 established (this file defines its own small local copy rather than importing across route files, matching this codebase's existing convention of route files being self-contained).
- Produces:
  - `GET /api/admin/blog-submissions` → `{ submissions: SubmissionRow[] }` (all rows, newest first — the admin UI groups paired rows client-side by `paired_submission_id`, same approach as `GET /api/blog-submissions`).
  - `PATCH /api/admin/blog-submissions/:id` with `{ action: 'approve' }` or `{ action: 'reject', reason: string }`. Approve opens a PR (and its pair's PR files, if paired) via `openBlogPostPR`; only on success does it set `status='approved'` on the row (and its pair). Returns `{ ok: true, pr_url: string }` on approve, `{ ok: true }` on reject, or `{ error: string }` (never partially updating state) on a GitHub failure.

- [ ] **Step 1: Write the admin list endpoint**

Create `functions/api/admin/blog-submissions.ts`:

```typescript
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';

type SubmissionRow = {
  id: string;
  submitted_by: string;
  lang: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  author: string;
  image_url: string;
  body: string;
  slug: string;
  status: string;
  rejection_reason: string | null;
  pr_url: string | null;
  paired_submission_id: string | null;
  created_at: number;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT s.*, u.email AS submitter_email
     FROM blog_submissions s
     JOIN users u ON u.id = s.submitted_by
     ORDER BY s.created_at DESC`
  ).all<SubmissionRow & { submitter_email: string }>();

  return jsonResponse({
    submissions: result.results.map(row => ({
      id: row.id,
      lang: row.lang,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: JSON.parse(row.tags) as string[],
      author: row.author,
      image_url: row.image_url,
      body: row.body,
      slug: row.slug,
      status: row.status,
      rejection_reason: row.rejection_reason,
      pr_url: row.pr_url,
      paired_submission_id: row.paired_submission_id,
      submitter_email: row.submitter_email,
    })),
  });
};
```

- [ ] **Step 2: Write the approve/reject endpoint**

Create `functions/api/admin/blog-submissions/[id].ts`:

```typescript
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { openBlogPostPR, fileExistsOnBaseBranch } from '../../../_lib/github';

type SubmissionRow = {
  id: string;
  lang: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  author: string;
  image_url: string;
  body: string;
  slug: string;
  paired_submission_id: string | null;
};

type ActionBody =
  | { action: 'approve'; slug?: string }
  | { action: 'reject'; reason: string };

function buildFrontmatter(row: SubmissionRow, now: number): string {
  const pubDate = new Date(now * 1000).toISOString().slice(0, 10);
  const tags = JSON.parse(row.tags) as string[];
  const lines = [
    '---',
    `title: ${JSON.stringify(row.title)}`,
    `pubDate: ${pubDate}`,
    `description: ${JSON.stringify(row.description)}`,
    `author: ${JSON.stringify(row.author)}`,
    `category: ${JSON.stringify(row.category)}`,
    `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
    `image: ${JSON.stringify(row.image_url)}`,
    'draft: false',
    'type: "post"',
    '---',
    '',
    row.body,
    '',
  ];
  return lines.join('\n');
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const admin = await getSessionUser(request, env);
  if (!admin) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!admin.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  const row = await env.DB.prepare('SELECT * FROM blog_submissions WHERE id = ?')
    .bind(id).first<SubmissionRow>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json<ActionBody>();

  if (body.action === 'reject') {
    if (!body.reason) return jsonResponse({ error: 'A rejection reason is required' }, 400);
    const now = Math.floor(Date.now() / 1000);
    await env.DB.prepare(
      `UPDATE blog_submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
    ).bind(body.reason, now, admin.id, id).run();
    if (row.paired_submission_id) {
      await env.DB.prepare(
        `UPDATE blog_submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
      ).bind(body.reason, now, admin.id, row.paired_submission_id).run();
    }
    return jsonResponse({ ok: true });
  }

  if (body.action !== 'approve') return jsonResponse({ error: 'Unknown action' }, 400);

  const slug = body.slug ?? row.slug;
  let pairedRow: SubmissionRow | null = null;
  if (row.paired_submission_id) {
    pairedRow = await env.DB.prepare('SELECT * FROM blog_submissions WHERE id = ?')
      .bind(row.paired_submission_id).first<SubmissionRow>();
  }

  const filesToCheck = pairedRow
    ? [`src/content/blog/${row.lang}/${slug}.md`, `src/content/blog/${pairedRow.lang}/${slug}.md`]
    : [`src/content/blog/${row.lang}/${slug}.md`];

  for (const path of filesToCheck) {
    try {
      if (await fileExistsOnBaseBranch(path, env)) {
        return jsonResponse({ error: `A file already exists at ${path} -- choose a different slug` }, 409);
      }
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'GitHub check failed' }, 502);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const files = pairedRow
    ? [
        { path: `src/content/blog/${row.lang}/${slug}.md`, content: buildFrontmatter({ ...row, slug }, now) },
        { path: `src/content/blog/${pairedRow.lang}/${slug}.md`, content: buildFrontmatter({ ...pairedRow, slug }, now) },
      ]
    : [{ path: `src/content/blog/${row.lang}/${slug}.md`, content: buildFrontmatter({ ...row, slug }, now) }];

  const result = await openBlogPostPR(
    {
      branchSlug: slug,
      files,
      title: `New blog post: ${row.title}`,
      prBody: `Submitted by a member, approved by ${admin.email}.\n\n${row.description}`,
    },
    env
  );

  if (!result.success) {
    return jsonResponse({ error: result.error }, 502);
  }

  await env.DB.prepare(
    `UPDATE blog_submissions SET status = 'approved', pr_url = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
  ).bind(result.prUrl, now, admin.id, id).run();
  if (pairedRow) {
    await env.DB.prepare(
      `UPDATE blog_submissions SET status = 'approved', pr_url = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
    ).bind(result.prUrl, now, admin.id, pairedRow.id).run();
  }

  return jsonResponse({ ok: true, pr_url: result.prUrl });
};
```

- [ ] **Step 2b: Note on `params.id`'s relative import depth**

`functions/api/admin/blog-submissions/[id].ts` is three directories below `functions/` (`api/admin/blog-submissions/`), so its import of `_lib/auth` and `_lib/github` uses `../../../_lib/...` — one level deeper than `functions/api/admin/announcements/[id].ts`'s `../../../_lib/auth` (that file is at the same depth, so this matches). Double-check this by comparing directory depth if the import fails to resolve at build time; don't guess at the relative path from directory name alone.

- [ ] **Step 3: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual local verification with a mocked GitHub response**

No real `GITHUB_PAT` exists yet (Task 3 left this for the human operator). Verify the endpoint's logic without calling the real GitHub API by temporarily stubbing `openBlogPostPR` in a scratch copy — do NOT commit a stub into the real file. Instead, verify what you can without a real token:

```bash
wrangler pages dev dist --local --port=8788 &
sleep 2

# Create a test admin, a test writer's rejected submission, and a session for the admin
wrangler d1 execute rsg-members --local --command="INSERT INTO users (id, google_id, email, is_member, is_admin, is_writer, created_at, last_login) VALUES ('test-admin-2', 'g-test-admin-2', 'admin2@example.com', 1, 1, 0, 1735689600, 1735689600)"
wrangler d1 execute rsg-members --local --command="INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('test-session-2', 'test-admin-2', 9999999999, 1735689600)"
wrangler d1 execute rsg-members --local --command="INSERT INTO users (id, google_id, email, is_member, is_writer, created_at, last_login) VALUES ('test-writer-2', 'g-test-writer-2', 'writer2@example.com', 1, 1, 1735689600, 1735689600)"
wrangler d1 execute rsg-members --local --command="INSERT INTO blog_submissions (id, submitted_by, lang, title, description, category, tags, author, body, slug, status, created_at) VALUES ('sub-1', 'test-writer-2', 'en', 'Test', 'desc', 'general', '[]', 'Test Writer', 'body text', 'test-slug', 'pending', 1735689600)"

curl -s http://localhost:8788/api/admin/blog-submissions -H "Cookie: rsg_session=test-session-2"
# Expected: {"submissions":[{"id":"sub-1","lang":"en","title":"Test",...,"status":"pending","submitter_email":"writer2@example.com"}]}

curl -s -X PATCH http://localhost:8788/api/admin/blog-submissions/sub-1 \
  -H "Content-Type: application/json" -H "Cookie: rsg_session=test-session-2" \
  -d '{"action":"reject","reason":"needs more detail"}'
# Expected: {"ok":true}

curl -s http://localhost:8788/api/admin/blog-submissions -H "Cookie: rsg_session=test-session-2"
# Expected: status is now "rejected", rejection_reason is "needs more detail"

# The approve path calls the real GitHub API and will fail without a real
# GITHUB_PAT (expected -- confirm it fails CLEANLY, i.e. a 401/502 JSON
# error, and that the submission's status is untouched, still 'rejected'
# from the step above, not corrupted to a half-approved state):
curl -s -X PATCH http://localhost:8788/api/admin/blog-submissions/sub-1 \
  -H "Content-Type: application/json" -H "Cookie: rsg_session=test-session-2" \
  -d '{"action":"approve"}'
# Expected: a JSON {"error": "..."} response (GitHub auth failure), NOT a
# 500/crash, and NOT {"ok":true}.

wrangler d1 execute rsg-members --local --command="DELETE FROM blog_submissions WHERE id = 'sub-1'"
wrangler d1 execute rsg-members --local --command="DELETE FROM sessions WHERE id = 'test-session-2'"
wrangler d1 execute rsg-members --local --command="DELETE FROM users WHERE id IN ('test-admin-2', 'test-writer-2')"
kill %1
```

State clearly in your report that the real-GitHub-success path (a real PR actually opening) is NOT verifiable until the human operator sets `GITHUB_PAT` — this is expected and matches Task 3's note.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/blog-submissions.ts "functions/api/admin/blog-submissions/[id].ts"
git commit -m "Add admin blog submissions review API (list, approve via GitHub PR, reject)"
```

---

### Task 7: Member submission UI (English and Turkish `/account` pages)

**Files:**
- Modify: `src/pages/account/index.astro`
- Modify: `src/pages/tr/account/index.astro`

**Interfaces:**
- Consumes: `GET /api/me` (`user.is_writer`, Task 2), `GET /api/blog-submissions`, `POST /api/blog-submissions`, `PATCH /api/blog-submissions/:id` (Task 5), `POST /api/blog-submissions/upload-image` (Task 4).
- Produces: nothing consumed by a later task — this and Task 8 are the last two tasks.

Both files currently have the same structure (confirmed 241 lines each, English strings vs. Turkish strings, otherwise identical layout and script logic) — apply the same change to both, translating UI text for the Turkish file exactly as the existing file already does for its own sections (it has no `isTR` conditional; Turkish strings are hardcoded directly, matching this file's existing convention).

- [ ] **Step 1: Add the "Write a Post" card to the English page**

In `src/pages/account/index.astro`, find the closing of the `interestsCard` block (the last card before `</div>` that closes `#profileContent`) and add a new card right after it, before `#profileContent`'s closing `</div>`:

```astro
        <!-- Write a post (writers only) -->
        <div id="writerCard" class="hidden bg-white rounded-2xl border border-border shadow-sm p-6">
          <h2 class="text-sm font-semibold text-navy mb-4">Write a Blog Post</h2>

          <form id="submissionForm" class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            <select id="subLang" required class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid">
              <option value="en">English</option>
              <option value="tr">Turkish</option>
            </select>
            <select id="subCategory" required class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid">
              <option value="community">Community</option>
              <option value="events">Events</option>
              <option value="general">General</option>
            </select>
            <input id="subTitle" type="text" placeholder="Title" required
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid sm:col-span-2" />
            <textarea id="subDescription" placeholder="Short description" required rows="2"
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid sm:col-span-2"></textarea>
            <input id="subTags" type="text" placeholder="Tags (comma separated)"
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
            <input id="subAuthor" type="text" placeholder="Author name" required
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
            <input id="subImage" type="file" accept="image/jpeg,image/png,image/webp,image/gif"
              class="text-sm text-gray-600 sm:col-span-2" />
            <textarea id="subBody" placeholder="Write your post in Markdown" required rows="10"
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid sm:col-span-2 font-mono"></textarea>

            <label class="flex items-center gap-2 text-sm text-gray-600 sm:col-span-2">
              <input id="subAddTranslation" type="checkbox" class="rounded border-border" />
              Also submit a translation in the other language
            </label>

            <div id="translationFields" class="hidden sm:col-span-2 grid grid-cols-1 gap-3 pt-3 border-t border-border">
              <input id="subTransTitle" type="text" placeholder="Title (translation)"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
              <textarea id="subTransDescription" placeholder="Short description (translation)" rows="2"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid"></textarea>
              <input id="subTransTags" type="text" placeholder="Tags (translation, comma separated)"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid" />
              <textarea id="subTransBody" placeholder="Post body (translation, Markdown)" rows="10"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy placeholder-gray-300 focus:outline-none focus:border-navy-mid font-mono"></textarea>
            </div>

            <button type="submit" class="sm:col-span-2 px-4 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors">
              Submit for review
            </button>
          </form>

          <h3 class="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">My Submissions</h3>
          <div id="submissionsList" class="flex flex-col gap-3"></div>
          <p id="submissionsEmpty" class="hidden text-sm text-gray-400">No submissions yet.</p>
        </div>
```

- [ ] **Step 2: Add the submission-handling script to the English page**

At the end of the existing `<script>` block in `src/pages/account/index.astro` (after the closing `})();` of the existing profile-loading IIFE, but still inside the same `<script>` tag), add:

```typescript
  function escapeHtml(s: unknown): string {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c] as string));
  }

  type Submission = {
    id: string;
    lang: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    image_url: string;
    body: string;
    status: string;
    rejection_reason: string | null;
    pr_url: string | null;
    paired_submission_id: string | null;
  };

  function submissionStatusHtml(s: Submission): string {
    if (s.status === 'approved' && s.pr_url) {
      return `<a href="${escapeHtml(s.pr_url)}" target="_blank" rel="noopener noreferrer" class="text-xs text-green-700">Approved — view PR →</a>`;
    }
    if (s.status === 'rejected') {
      return `<span class="text-xs text-red-600">Rejected: ${escapeHtml(s.rejection_reason ?? '')}</span> <button data-id="${s.id}" class="edit-resubmit-btn text-xs text-navy-mid hover:underline ml-2">Edit and resubmit</button>`;
    }
    return `<span class="text-xs text-gray-400">Pending review</span>`;
  }

  async function loadSubmissions() {
    const res = await fetch('/api/blog-submissions');
    if (!res.ok) return;
    const data = await res.json() as { submissions: Submission[] };
    const list = document.getElementById('submissionsList')!;
    const empty = document.getElementById('submissionsEmpty')!;

    // Render each submission once; a paired translation is shown as a
    // suffix on its primary row rather than as its own separate row.
    const shown = new Set<string>();
    const rows = data.submissions.filter(s => {
      if (shown.has(s.id)) return false;
      if (s.paired_submission_id) shown.add(s.paired_submission_id);
      shown.add(s.id);
      return true;
    });

    if (rows.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = rows.map(s => `
      <div class="p-3 rounded-xl border border-border">
        <div class="text-sm font-medium text-navy">${escapeHtml(s.title)}</div>
        <div class="mt-1">${submissionStatusHtml(s)}</div>
      </div>`).join('');

    list.querySelectorAll('.edit-resubmit-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.currentTarget as HTMLButtonElement).dataset.id!;
        const s = data.submissions.find(x => x.id === id);
        if (!s) return;
        (document.getElementById('subLang') as HTMLSelectElement).value = s.lang;
        (document.getElementById('subCategory') as HTMLSelectElement).value = s.category;
        (document.getElementById('subTitle') as HTMLInputElement).value = s.title;
        (document.getElementById('subDescription') as HTMLTextAreaElement).value = s.description;
        (document.getElementById('subTags') as HTMLInputElement).value = s.tags.join(', ');
        (document.getElementById('subAuthor') as HTMLInputElement).value = s.author;
        (document.getElementById('subBody') as HTMLTextAreaElement).value = s.body;
        document.getElementById('submissionForm')!.dataset.editId = id;
        document.getElementById('writerCard')!.scrollIntoView({ behavior: 'smooth' });
      });
    });
  }

  document.getElementById('subAddTranslation')?.addEventListener('change', (e) => {
    document.getElementById('translationFields')!.classList.toggle('hidden', !(e.target as HTMLInputElement).checked);
  });

  document.getElementById('submissionForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const editId = form.dataset.editId;

    let imageUrl = '';
    const fileInput = document.getElementById('subImage') as HTMLInputElement;
    if (fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const uploadRes = await fetch('/api/blog-submissions/upload-image', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      if (!uploadRes.ok) {
        alert('Image upload failed');
        return;
      }
      const uploadData = await uploadRes.json() as { url: string };
      imageUrl = uploadData.url;
    }

    const addTranslation = (document.getElementById('subAddTranslation') as HTMLInputElement).checked;
    const payload: any = {
      lang: (document.getElementById('subLang') as HTMLSelectElement).value,
      category: (document.getElementById('subCategory') as HTMLSelectElement).value,
      title: (document.getElementById('subTitle') as HTMLInputElement).value,
      description: (document.getElementById('subDescription') as HTMLTextAreaElement).value,
      tags: (document.getElementById('subTags') as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean),
      author: (document.getElementById('subAuthor') as HTMLInputElement).value,
      body: (document.getElementById('subBody') as HTMLTextAreaElement).value,
    };
    if (imageUrl) payload.image_url = imageUrl;

    if (addTranslation) {
      payload.translation = {
        lang: payload.lang === 'en' ? 'tr' : 'en',
        title: (document.getElementById('subTransTitle') as HTMLInputElement).value,
        description: (document.getElementById('subTransDescription') as HTMLTextAreaElement).value,
        tags: (document.getElementById('subTransTags') as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean),
        body: (document.getElementById('subTransBody') as HTMLTextAreaElement).value,
      };
    }

    const url = editId ? `/api/blog-submissions/${editId}` : '/api/blog-submissions';
    const method = editId ? 'PATCH' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      form.reset();
      delete form.dataset.editId;
      document.getElementById('translationFields')!.classList.add('hidden');
      await loadSubmissions();
    } else {
      const err = await res.json() as { error: string };
      alert(err.error || 'Submission failed');
    }
  });
```

- [ ] **Step 3: Gate the card's visibility and load submissions in the existing init block**

In the same file's existing init IIFE, find where `data.user.is_member` is checked (the member badge / membership CTA logic) and add the writer gate right after it:

```typescript
      // Writer: blog submissions
      if (data.user.is_writer) {
        document.getElementById('writerCard')!.classList.remove('hidden');
        await loadSubmissions();
      }
```

- [ ] **Step 4: Apply the identical change to the Turkish page**

In `src/pages/tr/account/index.astro`, apply the exact same structural changes as Steps 1-3, with these Turkish strings in place of the English ones (the DOM ids stay identical — `writerCard`, `submissionForm`, `subLang`, etc. — only the visible text/labels change, matching this file's existing no-`isTR` convention of hardcoding Turkish text directly):

- Card heading: `Blog Yazısı Yaz`
- Language options: `Türkçe` / `İngilizce` (note: this file already writes in Turkish first per its own convention elsewhere — order the `<option>`s as `tr` first, `en` second, unlike the English file's `en`-first ordering)
- Category options: `Topluluk` (community), `Etkinlikler` (events), `Genel` (general)
- Placeholders: `Başlık`, `Kısa açıklama`, `Etiketler (virgülle ayırın)`, `Yazar adı`, `Yazınızı Markdown ile yazın`
- Checkbox label: `Diğer dilde de bir çeviri göndermek istiyorum`
- Translation fields placeholders: `Başlık (çeviri)`, `Kısa açıklama (çeviri)`, `Etiketler (çeviri, virgülle ayırın)`, `Yazı içeriği (çeviri, Markdown)`
- Submit button: `İncelemeye gönder`
- "My Submissions" heading: `Gönderilerim`
- Empty state: `Henüz gönderi yok.`
- `submissionStatusHtml`: `'Approved — view PR →'` → `'Onaylandı — PR\'ı görüntüle →'`; `'Rejected: '` → `'Reddedildi: '`; `'Edit and resubmit'` → `'Düzenle ve tekrar gönder'`; `'Pending review'` → `'İncelemede'`

Everything else (function names, DOM ids, API calls, control flow) is byte-identical between the two files — only user-visible text changes.

- [ ] **Step 5: Verify**

```bash
npm run build
```

Expected: no errors. Then:

```bash
grep -o 'id="writerCard"' dist/account/index.html
grep -o 'id="writerCard"' dist/tr/account/index.html
```

Expected: both print `id="writerCard"`, confirming the section renders (hidden by default, until a writer's `/api/me` response unhides it client-side) on both pages.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account/index.astro src/pages/tr/account/index.astro
git commit -m "Add blog post submission form and status list to account pages (EN + TR)"
```

---

### Task 8: Admin review UI (English and Turkish `/admin` pages)

**Files:**
- Modify: `src/pages/admin/index.astro`
- Modify: `src/pages/tr/admin/index.astro`

**Interfaces:**
- Consumes: `GET /api/admin/blog-submissions`, `PATCH /api/admin/blog-submissions/:id` (Task 6). Renders alongside the pre-existing Announcements section from an earlier feature on this branch — both are `is_admin`-gated sections on the same page, unrelated to each other otherwise.
- Produces: nothing — final task of the plan.

Both admin pages already have an `#announcementsSection` (from a previous feature) visible only to `is_admin`/`is_announcer`. This task adds a new, separate `#blogSubmissionsSection`, visible **only to `is_admin`** (not `is_writer` — writers review nothing, they only see their own submissions on `/account`, per Task 7).

- [ ] **Step 1: Add the review section to the English admin page**

In `src/pages/admin/index.astro`, find the closing `</div>` of `#announcementsSection` and add a new sibling section right after it, still inside `#adminContent`:

```astro
        <!-- Blog submissions section -->
        <div id="blogSubmissionsSection" class="mt-8">
          <h2 class="text-lg font-semibold text-navy mb-4">Blog Submissions</h2>
          <div id="blogSubmissionsList" class="flex flex-col gap-4"></div>
          <p id="blogSubmissionsEmpty" class="hidden text-sm text-gray-400">No pending submissions.</p>
        </div>
```

- [ ] **Step 2: Add the review script to the English admin page**

At the end of the existing `<script>` block (after the init IIFE that already exists for the announcements section — this plan's Task 5/6/7/8 numbering is unrelated to that earlier feature's own task numbers, don't confuse the two), add:

```typescript
  function escapeHtmlForBlogReview(s: unknown): string {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c] as string));
  }

  type BlogSubmission = {
    id: string;
    lang: string;
    title: string;
    description: string;
    category: string;
    tags: string[];
    author: string;
    image_url: string;
    body: string;
    slug: string;
    status: string;
    rejection_reason: string | null;
    pr_url: string | null;
    paired_submission_id: string | null;
    submitter_email: string;
  };

  function blogSubmissionCardHtml(primary: BlogSubmission, paired: BlogSubmission | null): string {
    const langLabel = (s: BlogSubmission) => s.lang === 'en' ? 'English' : 'Turkish';
    const bodyPreview = (s: BlogSubmission) => `
      <div class="mt-2 p-3 rounded-lg bg-[#F7F7F6] text-xs">
        <div class="font-medium text-navy">${langLabel(s)}: ${escapeHtmlForBlogReview(s.title)}</div>
        <div class="text-gray-500 mt-1">${escapeHtmlForBlogReview(s.description)}</div>
        <pre class="whitespace-pre-wrap mt-2 text-gray-600">${escapeHtmlForBlogReview(s.body)}</pre>
      </div>`;

    return `
      <div class="bg-white rounded-2xl border border-border shadow-sm p-5" data-id="${primary.id}">
        <div class="flex items-center justify-between">
          <div class="text-sm font-semibold text-navy">${escapeHtmlForBlogReview(primary.title)}</div>
          <span class="text-xs text-gray-400">${escapeHtmlForBlogReview(primary.submitter_email)}</span>
        </div>
        <div class="text-xs text-gray-400 mt-1">Category: ${escapeHtmlForBlogReview(primary.category)} · Slug: <input class="blog-slug-input text-xs border border-border rounded px-1" value="${escapeHtmlForBlogReview(primary.slug)}" /></div>
        ${bodyPreview(primary)}
        ${paired ? bodyPreview(paired) : ''}
        <div class="mt-3 flex items-center gap-2">
          <button class="blog-approve-btn text-xs px-3 py-1.5 rounded-lg bg-navy text-white hover:bg-navy-mid transition-colors">Approve</button>
          <button class="blog-reject-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-500 hover:border-red hover:text-red transition-colors">Reject</button>
        </div>
      </div>`;
  }

  async function loadBlogSubmissions() {
    const res = await fetch('/api/admin/blog-submissions');
    if (!res.ok) return;
    const data = await res.json() as { submissions: BlogSubmission[] };
    const pending = data.submissions.filter(s => s.status === 'pending');

    const list = document.getElementById('blogSubmissionsList')!;
    const empty = document.getElementById('blogSubmissionsEmpty')!;

    const shown = new Set<string>();
    const cards = pending.filter(s => {
      if (shown.has(s.id)) return false;
      if (s.paired_submission_id) shown.add(s.paired_submission_id);
      shown.add(s.id);
      return true;
    });

    if (cards.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = cards.map(s => {
      const paired = s.paired_submission_id
        ? pending.find(p => p.id === s.paired_submission_id) ?? null
        : null;
      return blogSubmissionCardHtml(s, paired);
    }).join('');

    list.querySelectorAll('.blog-approve-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = (e.currentTarget as HTMLButtonElement).closest('[data-id]') as HTMLElement;
        const id = card.dataset.id!;
        const slugInput = card.querySelector('.blog-slug-input') as HTMLInputElement;
        (e.currentTarget as HTMLButtonElement).setAttribute('disabled', 'true');
        const res = await fetch(`/api/admin/blog-submissions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', slug: slugInput.value }),
        });
        if (res.ok) {
          await loadBlogSubmissions();
        } else {
          const err = await res.json() as { error: string };
          alert(err.error || 'Approve failed');
          (e.currentTarget as HTMLButtonElement).removeAttribute('disabled');
        }
      });
    });

    list.querySelectorAll('.blog-reject-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const card = (e.currentTarget as HTMLButtonElement).closest('[data-id]') as HTMLElement;
        const id = card.dataset.id!;
        const reason = prompt('Reason for rejection:');
        if (!reason) return;
        const res = await fetch(`/api/admin/blog-submissions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject', reason }),
        });
        if (res.ok) {
          await loadBlogSubmissions();
        } else {
          const err = await res.json() as { error: string };
          alert(err.error || 'Reject failed');
        }
      });
    });
  }
```

- [ ] **Step 3: Call `loadBlogSubmissions()` from the init block, gated on full admin**

In the same file's init IIFE, find the line that gates the announcements section (`if (isFullAdmin) await loadUsers();` or similar, from the earlier Announcements feature) and add, right after it:

```typescript
    if (isFullAdmin) await loadBlogSubmissions();
```

- [ ] **Step 4: Apply the identical change to the Turkish admin page**

In `src/pages/tr/admin/index.astro`, apply the exact same structural and script changes as Steps 1-3, translating visible text only (DOM ids, function names, and API calls stay identical):

- Section heading: `Blog Gönderileri`
- Empty state: `Bekleyen gönderi yok.`
- `langLabel`: `'English'` → keep as-is for the English half, `'Turkish'` → keep as-is for the Turkish half (these describe which language the sub-post is in, they can stay in English as labels — but for full consistency with this file's own convention, translate to `'İngilizce'` / `'Türkçe'`)
- `Category:` → `Kategori:`, `Slug:` → `Slug:` (unchanged, it's a technical term already used as-is elsewhere on this site)
- `Approve` button → `Onayla`
- `Reject` button → `Reddet`
- `prompt('Reason for rejection:')` → `prompt('Reddetme sebebi:')`
- `alert('Approve failed')` → `alert('Onaylama başarısız oldu')`, `alert('Reject failed')` → `alert('Reddetme başarısız oldu')`

- [ ] **Step 5: Verify**

```bash
npm run build
npx tsc --noEmit
```

Expected: no errors from either.

```bash
grep -o 'id="blogSubmissionsSection"' dist/admin/index.html
grep -o 'id="blogSubmissionsSection"' dist/tr/admin/index.html
```

Expected: both print the id, confirming the section is present on both pages' server-rendered HTML.

Manual local verification (reuse the Task 6 Step 4 test-data pattern — create a test admin session and a pending `blog_submissions` row, then load `http://localhost:8788/admin/` and `http://localhost:8788/tr/admin/` in a real browser if Playwright or another browser is available in this environment; confirm the pending submission's card renders with its title/description/body preview and that clicking Reject actually PATCHes and removes it from the pending list). Clean up test data and stop the dev server afterward.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/index.astro src/pages/tr/admin/index.astro
git commit -m "Add blog submissions review UI to admin panels (EN + TR)"
```
