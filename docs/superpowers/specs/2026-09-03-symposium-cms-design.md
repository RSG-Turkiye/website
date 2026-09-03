# Symposium CMS — design

**Date:** 2026-09-03
**Status:** approved, ready for planning
**Supersedes:** parts C and D of `2026-09-02-symposium-2026-and-seo-design.md`, which
sketched this and deferred it.

## Context

The 13th symposium is on 10 October 2026. The site announces it correctly today, but
every detail still lands by someone editing markdown and pushing. The committee
cannot open registration, add a speaker or move a session without a pull request.

The earlier work settled the architecture and deliberately left it unbuilt:

- The admin lives on the **main** site, reusing its Google OAuth, `sessions` table
  and role flags. The symposium site gets no login, no database, no auth surface.
- The symposium site fetches at **build time** and inlines the result into static
  HTML. A client-side fetch would hide the speakers and the programme — the
  most-searched content on a conference site — from Google, which is the opposite
  of what the SEO work was for.
- Saving in the admin fires the `rsg-symposium-cron` deploy hook. That hook is
  deployed and verified: a POST returns a deployment id that matches a real
  production build.

## The backbone

> **The repo is always the source of a working site. D1 is an overlay.**

The build reads the repo first, then tries to fetch the D1 overlay for the upcoming
edition, then merges. **If the fetch fails, the build proceeds on repo data alone**
and logs loudly. The site stays up and stays correct; it is only missing edits made
since the last commit.

This is the design, not a fallback. The two alternatives are worse: a build that
fails leaves everyone guessing why the site stopped updating, and a build that
succeeds with empty data silently deletes the speakers and the programme.

It also settles the seam. `2026.md` already carries the venue, the date and the
theme. D1 carries what changes weekly. Neither has to know about the other beyond
one merge step.

## Goals

1. Anyone on the committee with the right role can open registration, publish an
   announcement, add a speaker, set a session time or list a committee member —
   from a browser, without a pull request, live in about a minute.
2. The symposium site keeps working, correctly, if D1 or the API is unavailable.
3. When the symposium is over, its content becomes a permanent part of the repo
   with no human bookkeeping, and the CMS is empty for the 14th.

## Non-goals

- Editing the archive. Past editions stay in the repo; a CMS for content written
  once a year is overhead.
- A second login, a second user table, or any auth on the symposium site.
- Rich-text editing. Fields are plain text, URLs and dates.
- Taking registrations ourselves. Registration and abstracts remain external forms;
  we hold a link and a deadline.

---

## 1. Move the remaining hand-maintained arrays into content

`src/data/speakers.ts` (15 records), `src/data/sessions.ts` (16) and
`src/data/committee.ts` (0) are hand-maintained TypeScript arrays spanning every
edition — the same shape as the `data/editions.ts` that was deleted on 2026-09-02
because a flag inside it went stale and nothing warned.

Adding D1 on top of them would recreate that: 2026's speakers in the database,
2023–2025's in a TypeScript file, and the archive step generating TypeScript source.

**They move to per-edition data files in the content collection**, one file per
edition per kind:

```
src/content/speakers/2024.json     ← array of speakers for that edition
src/content/sessions/2024.json
src/content/committee/2026.json
```

Three new collections in `src/content.config.ts`, each `glob({ pattern: "*.json" })`
with a Zod schema mirroring today's TypeScript interfaces. The migration is 31
records and is mechanical.

Two properties this buys: the archive is **data, not code**, so the archive step in
§6 writes JSON rather than generating TypeScript; and every edition's content has
exactly one shape whether it came from a pull request or from the CMS.

## 2. D1 schema

Four new tables plus one column, holding **only the upcoming edition**. Following
the repo's convention, each is applied by hand and documented at the top of
`db/schema.sql` with a note on what breaks if the migration is skipped.

```sql
-- The edition's volatile settings. At most one row: the upcoming edition.
CREATE TABLE IF NOT EXISTS symposium_edition (
  year                  INTEGER PRIMARY KEY,
  registration_url      TEXT NOT NULL DEFAULT '',
  registration_deadline INTEGER,
  abstract_url          TEXT NOT NULL DEFAULT '',
  abstract_deadline     INTEGER,
  -- Nullable on purpose: NULL means "no opinion, use the repo's flag", the same
  -- rule the three lists follow. Only an explicit 0 or 1 overrides 2026.md.
  venue_public          INTEGER,
  city_public           INTEGER,
  archived_pr_url       TEXT,
  updated_by            TEXT NOT NULL REFERENCES users(id),
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symposium_speakers (
  id       TEXT PRIMARY KEY,
  year     INTEGER NOT NULL,
  name     TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  company  TEXT NOT NULL DEFAULT '',
  bio      TEXT NOT NULL DEFAULT '',
  photo    TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symposium_sessions (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL,
  title       TEXT NOT NULL,
  type        TEXT NOT NULL,
  time        TEXT NOT NULL DEFAULT '',
  end_time    TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  speaker_ids TEXT NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symposium_committee (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  role_tr     TEXT NOT NULL DEFAULT '',
  affiliation TEXT NOT NULL DEFAULT '',
  photo       TEXT NOT NULL DEFAULT '',
  linkedin    TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);
```

**Announcements reuse the existing table** rather than getting a second one:

```sql
ALTER TABLE announcements ADD COLUMN site TEXT NOT NULL DEFAULT 'main';
```

The default keeps every existing row on the main site, so the migration is safe to
run against production before any code ships. `/api/announcements` filters
`site = 'main'`; the symposium overlay filters `site = 'symposium'`.

`sort` exists on the three list tables because the admin needs a stable order the
committee controls; `id` ordering would be arbitrary and `name` ordering wrong for
a programme.

## 3. Role and permission

A new flag, following the three that precede it:

```
wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_symposium INTEGER NOT NULL DEFAULT 0"
```

**Every check goes through one helper**, beside the existing one in
`functions/_lib/auth.ts`:

```ts
export function canManageSymposium(user: Pick<User, 'is_admin' | 'is_symposium'>): boolean {
  return user.is_admin === 1 || user.is_symposium === 1;
}
```

Nothing else may test `is_symposium` directly. The role model is expected to be
reconsidered soon; when it changes, this function is the only place that has to.

Note an existing inconsistency to avoid copying: `canManageAnnouncements` compares
`=== 1` while `src/scripts/admin-panel.ts` compares `=== true` against the API's
JSON booleans. The new helper follows the server-side convention (`=== 1`); the
client asks the API rather than testing flags itself.

## 4. API

**Admin, authenticated** — `functions/api/admin/symposium/…`, modelled on
`functions/api/admin/announcements.ts`: `getSessionUser` → 401, `canManageSymposium`
→ 403, `checkCsrf` on every write.

| Route | Verbs |
|---|---|
| `/api/admin/symposium/edition` | `GET`, `PUT` |
| `/api/admin/symposium/speakers` | `GET`, `POST` |
| `/api/admin/symposium/speakers/[id]` | `PUT`, `DELETE` |
| `/api/admin/symposium/sessions` | `GET`, `POST` |
| `/api/admin/symposium/sessions/[id]` | `PUT`, `DELETE` |
| `/api/admin/symposium/committee` | `GET`, `POST` |
| `/api/admin/symposium/committee/[id]` | `PUT`, `DELETE` |

**Public, unauthenticated** — one route the build reads:

```
GET /api/symposium  →  { year, edition, speakers, sessions, committee, announcements }
```

One request rather than five, because the build makes it once and a partial fetch
would produce a half-merged site.

**The hall's name is never in this payload.** The venue and city strings live in
`2026.md` and reach the page through `locationFor`, which already has tests
asserting the hall cannot leak. What the overlay carries is the two *visibility
flags*, so the committee can announce the venue from the admin without the hall
ever travelling over an unauthenticated API. Announcing it is then a checkbox
rather than a pull request, and the string it reveals was in the repo all along.

## 5. Build-time merge

`symposium_website` gains one module, `src/lib/overlay.ts`, with the merge as a pure
tested function and the fetch beside it:

```ts
export function mergeOverlay(repo: EditionContent, overlay: Overlay | null): EditionContent
export async function fetchOverlay(year: number): Promise<Overlay | null>   // never throws
```

`fetchOverlay` returns `null` on any failure — non-2xx, timeout, malformed JSON —
after logging the reason at `error` level so a failed overlay is visible in the
Cloudflare build log. It takes a short timeout (5s) so a hanging API cannot stall a
deploy.

`mergeOverlay` is field-level, not wholesale. The overlay supplies the registration
and abstract links and deadlines, and the two venue-visibility flags. For the three
lists, **an absent or empty list means "no opinion" and the repo's list stands**; a
non-empty list replaces it.

That has one deliberate consequence: the CMS cannot empty a list back to nothing. It
is the right trade — an overlay that briefly returns `[]` (a bad deploy, a half-run
migration) must not silently delete a published programme, and genuinely removing
every speaker is an act for a pull request.

The API host is a build-time environment variable with the production URL as its
default, so a local `npm run build` needs no configuration.

## 6. Publishing, and the archive

**Publishing.** Every successful write to an admin symposium route fires the
`rsg-symposium` deploy hook. The hook URL becomes a Pages secret on the **main**
site, `SYMPOSIUM_DEPLOY_HOOK` — the same value the cron Worker holds. Two copies of
one secret is the cost of the two projects being separate; the alternative is the
admin calling the Worker, which adds a hop and another failure mode.

The hook fires **after** the database write commits, and a hook failure does not
fail the request: the edit is saved either way, and the nightly rebuild will pick it
up. The response tells the admin whether the rebuild started, so a broken hook is
visible rather than silent.

**The archive.** Once the edition's `endOfEvent` has passed, the nightly Worker:

1. reads the D1 rows for that year,
2. renders them into `src/content/speakers/<year>.json`, `sessions/<year>.json`,
   `committee/<year>.json`, and merges the edition settings back into
   `src/content/editions/<year>.md`,
3. opens a pull request,
4. records the PR URL in `symposium_edition.archived_pr_url`.

`functions/_lib/github.ts` already creates a branch, commits files and opens a PR;
`openBlogPostPR` generalises into `openContentPR` by lifting its hardcoded branch
prefix into a parameter.

It is **idempotent**: a row with `archived_pr_url` set is skipped, so a Worker that
runs twice does not open two PRs. Merging the PR is a human act — that is the point
at which the archive becomes permanent. Clearing D1 happens on the next admin visit,
which sees the PR is merged and offers to start the next edition.

## 7. Admin UI

A new pane in the panel that already exists. `AdminNav` gains a Symposium entry —
in the same commit as the pane, per the rule that no nav item leads nowhere — and
the pane holds four sections matching the tables: edition settings, speakers,
sessions, committee. Announcements are already a pane; they gain a site selector.

The panel's conventions carry: the visible focus ring, `text-gray-500` as the
contrast floor, `tabular-nums` on anything numeric, `overflow-x-auto` on tables, and
every string through `src/i18n/ui.ts` in both languages.

Each save shows whether the rebuild was triggered. Nothing else auto-refreshes; a
CMS that reloads under the editor's hands loses work.

## 8. What this does not change

`2026.md` keeps the venue and city **strings**, the date and the theme. Those are
decided once and are not weekly edits, and keeping the hall out of the database is
what keeps the withheld-hall guarantee inside the repo, where a test already asserts
it.

Their **visibility** is the exception, and it belongs in the overlay: announcing the
venue is exactly the kind of last-minute act the CMS exists for. The repo's flags are
the default; the overlay may override them. A missing overlay therefore leaves the
hall withheld, which is the safe direction.

## Open questions

1. **Photo uploads.** Speakers and committee members have a `photo` URL. Today those
   are Cloudinary links pasted by hand. An upload flow would need R2 and a size
   policy; the main site already has `BLOG_IMAGES` and an upload endpoint to model
   on. Deferred unless the committee asks.
2. **Who sees the archive prompt.** After the archive PR is merged, someone must
   start the next edition. Whether that is any symposium role or admins only is
   unresolved.

## Acceptance

- [ ] A user with `is_symposium` and no other flag can edit every symposium field
      and nothing else in the panel
- [ ] `speakers.ts`, `sessions.ts` and `committee.ts` are deleted; nothing imports them
- [ ] With the API returning 500, `npm run build` in `symposium_website` succeeds and
      the site renders the repo's content, with the failure in the build log
- [ ] With the API returning an overlay, a speaker added in the admin appears in the
      built HTML — not fetched by the browser
- [ ] `venue_public` is 0 and the hall appears in no API response and no built page
- [ ] Saving any symposium field triggers a `rsg-symposium` deployment
- [ ] Running the archive step twice opens exactly one pull request
