# Member Blog Submissions — Design

## Problem

Blog posts today (`src/content/blog/en/*.md`, `src/content/blog/tr/*.md`) are git-based static content: a developer (or anyone with repo write access) commits a markdown file and opens a PR, which is consumed at build time by `getCollection('blog', ...)` across ~10 pages (blog listing, post page, tags, search, homepage card, RSS — each in both languages). There is no way for a member to contribute a post without going through git directly.

The goal is to let a trusted subset of members write and submit blog posts through the website while signed in, have an admin review and approve them, and have approved posts become real PRs against this repo — publishing through the exact same git-based pipeline every other post already uses. This deliberately keeps git as the single source of truth for blog content; nothing about the existing 10 consuming pages changes.

## Goals

1. Let members holding a new `is_writer` role submit a blog post (all the fields the existing schema already requires) through a signed-in web form, with an optional file upload for the post image.
2. Let an admin review pending submissions (in both the English and Turkish admin panels) and either approve or reject them, with a required reason on rejection so the member can revise and resubmit.
3. On approval, automatically create a git branch, commit a new markdown file matching the existing `blog` collection schema, and open a GitHub PR — no admin has to write git commands or a PR by hand. The PR still goes through the repo's normal review/merge process; approval in our admin UI does not bypass that.
4. Let a submission optionally include a companion translation (EN+TR together) submitted at the same time, publishing both languages in one PR so they never end up mismatched (one live, one forgotten).

## Out of scope

- Retroactively adding a translation to an already-published post. This is a real need but a separate flow (browsing published posts missing a translation, submitting against an existing slug) — deferred to a future iteration.
- An in-app markdown editor with live preview, or in-app content editing by the admin before approval. Once a PR is open, ordinary GitHub tooling (viewing the diff, pushing a fix commit, requesting changes) covers this — duplicating it in our own UI is not worth building for v1.
- A general-purpose CMS or roles/permissions engine. `is_writer` is a single-purpose boolean flag, matching the existing `is_admin`/`is_member`/`is_announcer` pattern — not a role table.
- Draft autosave / resuming a submission mid-write without submitting. A submission is written in one sitting and submitted; editing after rejection reuses the same row (see §3).

## 1. Permission model

Add one column to `users`:

```sql
ALTER TABLE users ADD COLUMN is_writer INTEGER NOT NULL DEFAULT 0;
```

- A full admin (`is_admin = 1`) can grant/revoke `is_writer` on any user from the existing admin panel's user table, via two new actions on the existing endpoint (`functions/api/admin/users.ts`): `make_writer` / `remove_writer`, mirroring `make_announcer`/`remove_announcer` exactly.
- `is_writer` is independent of `is_admin`/`is_announcer`/`is_member` — a user can hold any combination.
- Only `is_admin` can review (approve/reject) submissions. `is_writer` alone does not grant review capability over other members' submissions.

## 2. Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS blog_submissions (
  id                 TEXT PRIMARY KEY,
  submitted_by       TEXT NOT NULL REFERENCES users(id),
  lang               TEXT NOT NULL CHECK (lang IN ('en', 'tr')),
  title              TEXT NOT NULL,
  description        TEXT NOT NULL,
  category           TEXT NOT NULL,
  tags               TEXT NOT NULL DEFAULT '[]',  -- JSON array, stored as text
  author             TEXT NOT NULL,                -- prefilled from the submitter's profile display_name, editable
  image_url          TEXT NOT NULL DEFAULT '',     -- R2 public URL after upload; '' if no image
  body               TEXT NOT NULL,                -- markdown content
  slug               TEXT NOT NULL,                -- auto-generated from title; admin may edit before approval to avoid collisions
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason   TEXT,
  pr_url             TEXT,                          -- set once a PR is successfully opened
  paired_submission_id TEXT REFERENCES blog_submissions(id), -- links an EN+TR pair submitted together; NULL for a solo-language submission
  created_at         INTEGER NOT NULL,
  reviewed_at        INTEGER,
  reviewed_by        TEXT REFERENCES users(id)
);
```

- "Active" reviewable state is `status = 'pending'`. A rejected submission stays in the table (with `rejection_reason` set) until the member edits and resubmits it, which updates the same row's fields and resets `status` to `'pending'` (clearing `rejection_reason`) — it does not create a new row, so the member's history stays as one entry per logical post attempt.
- `paired_submission_id` is symmetric: if submission A pairs with B, `A.paired_submission_id = B.id` and `B.paired_submission_id = A.id`. Both rows share the same `slug` (enforced in application code at submission time, not a DB constraint, since SQLite has no cross-row check constraints).
- `status`/`pr_url`/`reviewed_at`/`reviewed_by` are only ever set together, at the moment a PR is confirmed successfully opened (see §4) — a failed GitHub API call must leave the row exactly as it was (`status` still `'pending'`), never partially updated.

## 3. Member submission flow

New section on `/account` (and its Turkish equivalent), visible only when `data.user.is_writer` is true — hidden entirely otherwise, same pattern as the existing account-page conditional sections.

**Form fields:**
- Language (EN/TR dropdown)
- Title, Description
- Category — a dropdown of the three values already in use across existing posts (`community`, `events`, `general`), not free text, to keep the tag/category pages consistent. Not schema-enforced (the `blog` collection's `category` field stays `z.string()`), purely a UI convenience; a new category can be added to the dropdown later without a schema change.
- Tags — comma-separated free text
- Author — prefilled from the submitter's profile `display_name`, editable (for a pen name or co-author credit)
- Image — file upload (see §5)
- Body — a plain markdown `<textarea>`, no live preview (YAGNI for v1 — the admin's approval step and the eventual GitHub PR view are where real preview happens)
- Optional: "Also submit a [other language] version" checkbox — when checked, reveals a second Title/Description/Tags/Body set for the other language (Author/Category/Image are shared, since these describe the same real-world post rather than the language-specific text)

**Submission:** creates one `blog_submissions` row (or two paired rows, if the companion-language checkbox was used) with `status = 'pending'`. If an image was attached, it uploads to R2 first and stores the resulting URL.

**"My Submissions" list:** same page, shows the member's own submissions with status — Pending / Approved (linking to the PR) / Rejected (showing `rejection_reason`, with an "Edit and resubmit" action that reopens the same form pre-filled, submitting a PATCH that updates the row and resets it to `pending`).

## 4. Admin review + GitHub PR automation

New "Blog Submissions" section added to **both** `src/pages/admin/index.astro` and `src/pages/tr/admin/index.astro` (built for both from the start — the previous Community Announcements feature initially missed the Turkish admin page and had to backfill it; this plan does not repeat that), visible only to `is_admin`.

**Review UI:** a table of pending submissions (title, submitter, language, category, submitted date). Clicking one shows the full content read-only (title, description, tags, image preview, rendered/raw body) — for a paired submission, both languages are shown together, reviewed and actioned as one unit. The admin can edit only the `slug` here (to resolve a collision with an existing file), not the body/title/etc. — content fixes happen in the PR itself once it exists, via ordinary GitHub tooling.

**Approve** triggers, server-side:
1. Check `src/content/blog/<lang>/<slug>.md` doesn't already exist in the repo (via the GitHub Contents API) for every language in this submission (one check for solo, two for a pair). A collision returns an error to the admin instead of proceeding — the admin adjusts the slug and retries.
2. Create a new branch off `main` (e.g. `blog-submission/<slug>`).
3. Build each language's markdown file (frontmator + body) matching the `blog` collection's exact schema (`title`, `pubDate` set to the approval timestamp, `description`, `author`, `category`, `tags`, `image`, `draft: false`, `type: "post"`), and commit it to the new branch via the GitHub Contents API. A paired submission commits both files in the same branch.
4. Open a PR from that branch to `main` via the GitHub API. Title: `New blog post: <title>`. Body includes "Submitted by `<submitter email>`, approved by `<admin email>`" plus the description, so provenance is visible in the PR itself without relying on git commit authorship.
5. Only once the PR is confirmed created: update the submission row(s) — `status = 'approved'`, `pr_url`, `reviewed_at`, `reviewed_by`. Any failure before this point leaves the row `pending` and surfaces a clear error to the admin (network failure, bad token, branch-already-exists, etc.) — it is retryable, not a dead end.
6. The admin panel shows the PR link directly, so review/merge continues on GitHub as normal — this feature only automates getting a PR open, not the merge/deploy that follows it (deploy still requires an actual PR merge, same as every other change in this repo).

**Reject** requires a non-empty reason, sets `status = 'rejected'` and `rejection_reason`, `reviewed_at`, `reviewed_by`. No GitHub interaction happens on rejection.

**GitHub identity:** a single fine-grained Personal Access Token, scoped to this repository only with `Contents: Read and write` and `Pull requests: Read and write` permissions, generated from a dedicated bot GitHub account (not a personal admin account) and stored as a Cloudflare Pages secret (`GITHUB_PAT`, alongside the existing `GOOGLE_CLIENT_SECRET`/`SESSION_SECRET`) — never in the codebase, never in D1. Every PR this feature opens is authored as that bot account; the "Submitted by / approved by" note in the PR body is what carries human attribution, not git authorship.

## 5. Bilingual pairing

Scoped to submission-time only for v1 (see Out of scope): a writer may optionally submit both languages of the same post together, producing two `blog_submissions` rows linked by `paired_submission_id` and sharing one `slug`. They are reviewed together and, on approval, committed together in a single PR touching both `src/content/blog/en/<slug>.md` and `src/content/blog/tr/<slug>.md` — so a paired post either ships in both languages at once or not at all, never half-published. A solo-language submission is entirely unaffected by this — pairing is opt-in, never required.

## 6. Image upload (R2)

A new Cloudflare R2 bucket (e.g. `rsg-blog-images`), bound to Pages Functions the same way D1 is bound in `wrangler.toml` (a new `[[r2_buckets]]` binding). Upload happens at submission time, before the `blog_submissions` row is written, storing the resulting public URL in `image_url`.

- Public access: either a public bucket or a custom subdomain (e.g. `images.rsg-turkiye...`) fronting it — a normal, well-documented Cloudflare setup, decided at implementation time.
- Limits: ~5MB max file size, restricted to `image/jpeg`, `image/png`, `image/webp`, `image/gif` — enforced server-side (not just via the `<input accept>` hint, which a direct API call could bypass), to bound storage growth and rule out unrelated file types.
- Free-tier headroom: R2's free tier (10GB storage, 1M Class A + 10M Class B operations/month) comfortably covers blog-post-image volume; this feature is not expected to approach it.

## Testing / verification

- Build the site locally after schema/API changes; confirm `/account` and both admin pages render correctly with zero submissions in the DB (baseline, unchanged for non-writer/non-admin users).
- Using a real test `is_writer` account locally, submit a solo-language post and confirm it lands in `blog_submissions` with `status='pending'`, and appears in the admin review table.
- Using a real test `is_admin` account, approve it against a mocked/dry-run GitHub API response locally (no real token needed for local dev); confirm the row updates to `approved` with a `pr_url` only on a successful mock response, and stays `pending` with a surfaced error on a simulated failure.
- Confirm a paired EN+TR submission produces exactly one two-file commit/PR on approval, not two separate PRs.
- Confirm reject → edit → resubmit correctly reuses the same row and clears `rejection_reason` on resubmit.
- Confirm the image upload path enforces the size/type limits server-side, not just client-side.
- A real end-to-end pass against the actual GitHub API (real bot token, real PR opened against a test branch or this repo) is a manual verification step at the end of implementation, not something automated per-task — same as this repo's existing manual-verification convention for anything touching real external services (Google Calendar API, Google OAuth).
