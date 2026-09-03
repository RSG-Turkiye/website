# Symposium CMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the symposium committee open registration, publish announcements, and manage speakers, the programme and the committee list from a browser — live in about a minute, with no pull request.

**Architecture:** The admin lives on the main site and reuses its Google OAuth, `sessions` table and role flags; the symposium site gets no login and no database. Content lands in D1, the symposium site's build fetches it once and inlines it into static HTML, and saving fires the `rsg-symposium` deploy hook. **The repo is always the source of a working site and D1 is an overlay** — if the fetch fails, the build proceeds on repo data and says so.

**Tech Stack:** Astro 5 (static), Cloudflare Pages Functions, D1, Tailwind v4, `node:test` + `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-03-symposium-cms-design.md`

## Global Constraints

- **Two projects, one repo.** The main site is the repo root (`website` Pages project, `https://rsg-turkiye.iscbsc.org`) and hosts the admin and both APIs. The symposium site is `symposium_website/` (`symposium-website` Pages project, `https://symposium.rsg-turkiye.iscbsc.org`) and only *reads*.
- **The hall's name never enters D1 or the public API.** `venue` and `venueCity` stay in `src/content/editions/<year>.md` and reach the page through `locationFor`. Only the two visibility flags are in the overlay.
- **One permission helper.** Everything checks `canManageSymposium(user)`; nothing tests `is_symposium` directly. The role model is expected to change.
- **Server-side role checks compare `=== 1`** (D1 stores integers), matching `canManageAnnouncements`. The client asks the API rather than testing flags.
- **Absent or empty means "no opinion".** In `mergeOverlay`, an absent or empty list leaves the repo's list standing; `null` flags leave the repo's flags standing. Only non-empty lists and explicit `0`/`1` override.
- **Sessions reference speakers by `slug`**, not row id (`SessionRow.astro:12`, `editions/[year].astro:24`).
- **Every user-facing string goes through `src/i18n/ui.ts`** in both `en` and `tr`. The admin panel has no hardcoded copy.
- **Panel conventions carry:** visible `focus-visible` ring, `text-gray-500` as the contrast floor (gray-400 is 2.54:1 and fails AA), `tabular-nums` on numerics, `overflow-x-auto` on tables.
- Tests are `node:test` + `node:assert/strict`. Repo root: **131 passing**. `symposium_website`: **44 passing**. Both must stay green.
- D1 migrations are applied **by hand** and documented at the top of `db/schema.sql`, with a note on what breaks if skipped — follow the existing `is_announcer` / `is_writer` / `is_sender` entries.

---

## File Structure

**Symposium site — created:**

| Path | Responsibility |
|---|---|
| `src/content/speakers/<year>.json` | One edition's speakers (migrated from `data/speakers.ts`) |
| `src/content/sessions/<year>.json` | One edition's programme |
| `src/content/committee/<year>.json` | One edition's committee |
| `src/lib/overlay.ts` | `mergeOverlay` (pure, tested) + `fetchOverlay` (never throws) |
| `src/lib/content.ts` | Collection readers the pages call instead of the deleted arrays |
| `tests/overlay.test.ts` | Merge semantics |

**Symposium site — deleted:** `src/data/speakers.ts`, `src/data/sessions.ts`, `src/data/committee.ts`.

**Main site — created:**

| Path | Responsibility |
|---|---|
| `functions/api/symposium.ts` | The public overlay the build reads. No auth. |
| `functions/api/admin/symposium/edition.ts` | Edition settings, `GET`/`PUT` |
| `functions/api/admin/symposium/[kind].ts` | Speakers / sessions / committee, `GET`/`POST` |
| `functions/api/admin/symposium/[kind]/[id].ts` | `PUT`/`DELETE` |
| `functions/_lib/symposium.ts` | Row↔JSON shaping and the deploy-hook trigger, shared by the routes |
| `functions/_lib/archive.ts` | Rendering D1 into repo files for the archive PR |
| `src/components/admin/panes/SymposiumPane.astro` | The admin pane |
| `tests/symposium-shape.test.ts` | Row↔JSON shaping |
| `tests/archive-render.test.ts` | Archive rendering, pure |

**Main site — modified:** `db/schema.sql`, `functions/_lib/auth.ts`, `functions/_lib/github.ts`, `functions/api/announcements.ts`, `src/components/admin/AdminShell.astro`, `src/components/admin/AdminNav.astro`, `src/scripts/admin-panel.ts`, `src/i18n/ui.ts`, `workers/symposium-cron/src/index.ts`.

---

## Task 1: Move speakers, sessions and committee into content collections

The prerequisite. Three hand-maintained TypeScript arrays become per-edition JSON, so the archive step writes data rather than generating code, and so the CMS overlays one shape instead of two.

**Files:**
- Create: `symposium_website/src/content/speakers/{2023,2024,2025}.json`, `sessions/2024.json`, `committee/` (empty dir with `.gitkeep`)
- Create: `symposium_website/src/lib/content.ts`
- Modify: `symposium_website/src/content.config.ts`
- Delete: `symposium_website/src/data/{speakers,sessions,committee}.ts`
- Modify: every consumer found by the grep in Step 1

**Interfaces:**
- Consumes: nothing.
- Produces, from `src/lib/content.ts`:
  - `getSpeakers(year: number): Promise<Speaker[]>`
  - `getSessions(year: number): Promise<Session[]>` — sorted by `sort`, then `order`
  - `getCommittee(year: number): Promise<CommitteeMember[]>`
  - `getSpeakerBySlug(year: number, slug: string): Promise<Speaker | undefined>`
  - The `Speaker`, `Session`, `SessionType` and `CommitteeMember` types, re-exported so consumers keep their imports' shape.

- [ ] **Step 1: Find every consumer before touching anything**

```bash
cd symposium_website && grep -rn "data/speakers\|data/sessions\|data/committee" src/
```

Write the list down. Every one must compile at the end of this task.

- [ ] **Step 2: Add the three collections**

In `src/content.config.ts`, beside the existing `editions`:

```ts
import { file, glob } from "astro/loaders";

const speakers = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/speakers" }),
  schema: z.object({
    year: z.number(),
    people: z.array(z.object({
      slug: z.string(),
      name: z.string(),
      position: z.string().default(""),
      company: z.string().default(""),
      bio: z.string().default(""),
      photo: z.string().default(""),
      linkedin: z.string().optional(),
      twitter: z.string().optional(),
      website: z.string().optional(),
    })),
  }),
});

const sessions = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/sessions" }),
  schema: z.object({
    year: z.number(),
    items: z.array(z.object({
      slug: z.string(),
      title: z.string(),
      type: z.enum(["opening","keynote","workshop","panel","talk","company","poster","networking","break","closing"]),
      speakerSlugs: z.array(z.string()).default([]),
      description: z.string().default(""),
      time: z.string().default(""),
      endTime: z.string().optional(),
      order: z.number(),
    })),
  }),
});

const committee = defineCollection({
  loader: glob({ pattern: "*.json", base: "./src/content/committee" }),
  schema: z.object({
    year: z.number(),
    people: z.array(z.object({
      name: z.string(),
      role: z.string().default(""),
      roleTr: z.string().default(""),
      affiliation: z.string().default(""),
      photo: z.string().default(""),
      linkedin: z.string().optional(),
    })),
  }),
});

export const collections = { editions, speakers, sessions, committee };
```

Each file wraps its array in an object with a `year`, because a bare top-level array cannot carry the edition the file is for and the archive step writes the year explicitly.

- [ ] **Step 3: Convert the data by hand, verifying the counts**

Split `src/data/speakers.ts`'s 15 records by their `editions` value into `2023.json`, `2024.json`, `2025.json` (five each — confirmed, no speaker appears in two editions). Every field carries over unchanged; drop the `editions` array, since the filename now says it.

`src/data/sessions.ts`'s 16 records are all `edition: 2024` → `sessions/2024.json`. Keep `slug`, `order`, `time` (all `""` today) and `speakerSlugs` exactly.

`src/data/committee.ts` is empty; create `src/content/committee/.gitkeep` and no JSON.

Verify before moving on:

```bash
python3 -c "
import json
tot=0
for y in (2023,2024,2025):
    n=len(json.load(open(f'src/content/speakers/{y}.json'))['people']); tot+=n; print(y,n)
print('speakers total:',tot,'(expected 15)')
print('sessions 2024:',len(json.load(open('src/content/sessions/2024.json'))['items']),'(expected 16)')"
```

- [ ] **Step 4: Write the readers**

`src/lib/content.ts` — the only module that touches `astro:content` for these:

```ts
import { getCollection } from "astro:content";

export type SessionType =
  | "opening" | "keynote" | "workshop" | "panel" | "talk"
  | "company" | "poster" | "networking" | "break" | "closing";

export interface Speaker {
  slug: string; name: string; position: string; company: string;
  bio: string; photo: string;
  linkedin?: string; twitter?: string; website?: string;
}

export interface Session {
  slug: string; title: string; type: SessionType; speakerSlugs: string[];
  description: string; time: string; endTime?: string; order: number;
}

export interface CommitteeMember {
  name: string; role: string; roleTr: string;
  affiliation: string; photo: string; linkedin?: string;
}

async function forYear<T>(collection: "speakers" | "sessions" | "committee", year: number, key: "people" | "items"): Promise<T[]> {
  const entries = await getCollection(collection as never);
  const entry = entries.find((e: { data: { year: number } }) => e.data.year === year);
  return entry ? ((entry.data as Record<string, unknown>)[key] as T[]) : [];
}

export const getSpeakers = (year: number) => forYear<Speaker>("speakers", year, "people");
export const getCommittee = (year: number) => forYear<CommitteeMember>("committee", year, "people");

export async function getSessions(year: number): Promise<Session[]> {
  const items = await forYear<Session>("sessions", year, "items");
  return [...items].sort((a, b) => a.order - b.order);
}

export async function getSpeakerBySlug(year: number, slug: string): Promise<Speaker | undefined> {
  return (await getSpeakers(year)).find((s) => s.slug === slug);
}
```

- [ ] **Step 5: Repoint every consumer and delete the arrays**

Work through Step 1's list. The call shape changes from synchronous `getSpeakersByEdition(year)` to `await getSpeakers(year)` — the pages are already `async` in their frontmatter.

`SessionRow.astro` resolves a session's speakers; it takes them as a prop rather than importing the array, so the component stays free of data access.

Then:

```bash
rm src/data/speakers.ts src/data/sessions.ts src/data/committee.ts
grep -rn "data/speakers\|data/sessions\|data/committee" src/ && echo "STILL REFERENCED" || echo "clean"
```

- [ ] **Step 6: Verify nothing on the site changed**

```bash
npm run build && npx astro check
grep -c "Mehmet Baysan" dist/editions/2024/index.html
grep -c "Nextflow" dist/editions/2024/index.html
npm test
```

The 2024 edition page must still list its speakers and its programme. 44/44 tests.

- [ ] **Step 7: Commit**

```bash
git add -A symposium_website/src
git commit -m "refactor: move speakers, sessions and committee into content collections

Three hand-maintained TypeScript arrays, spanning every edition, in the
same shape as the data/editions.ts deleted on 2026-09-02 because a value
inside it went stale and nothing warned.

They become one JSON file per edition per kind, so the CMS overlays a
single shape and the archive step writes data rather than generating
TypeScript source."
```

---

## Task 2: The D1 tables, the role, and the permission helper

**Files:**
- Modify: `db/schema.sql`
- Modify: `functions/_lib/auth.ts`
- Test: `tests/permissions.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `canManageSymposium(user: Pick<User, 'is_admin' | 'is_symposium'>): boolean`, and `is_symposium: number` on the `User` interface.

- [ ] **Step 1: Write the failing test**

`tests/permissions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageSymposium } from '../functions/_lib/auth';

test('an admin may manage the symposium', () => {
  assert.equal(canManageSymposium({ is_admin: 1, is_symposium: 0 }), true);
});

test('the symposium role may manage the symposium', () => {
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 1 }), true);
});

test('nobody else may', () => {
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 0 }), false);
});

test('the check is on the integer D1 stores, not a boolean', () => {
  // canManageAnnouncements compares === 1 while admin-panel.ts compares === true
  // against the API's JSON. Server-side helpers follow the server-side shape.
  assert.equal(canManageSymposium({ is_admin: 1 as unknown as number, is_symposium: 0 }), true);
  assert.equal(canManageSymposium({ is_admin: 0, is_symposium: 0 }), false);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/permissions.test.ts
```

Expected: FAIL — `canManageSymposium` is not exported.

- [ ] **Step 3: Add the flag and the helper**

In `functions/_lib/auth.ts`, add `is_symposium: number;` to `interface User` beside `is_sender`, then beside `canManageAnnouncements`:

```ts
/**
 * The only place `is_symposium` is read. Everything that gates symposium
 * editing calls this, so when the role model is reworked -- which is
 * expected -- this function is the whole of the change.
 */
export function canManageSymposium(user: Pick<User, 'is_admin' | 'is_symposium'>): boolean {
  return user.is_admin === 1 || user.is_symposium === 1;
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test
```

Expected: 135/135 (131 + 4).

- [ ] **Step 5: Document the migrations**

At the top of `db/schema.sql`, following the numbered notes already there, add an entry giving the exact commands and what breaks without them:

```
-- N. The symposium CMS needs one new role column, four new tables and one
--    new column on announcements. Without them every /api/admin/symposium
--    route 500s with a raw "Worker threw exception" page rather than JSON,
--    which surfaces in the panel as a Save button that does nothing:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_symposium INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE announcements ADD COLUMN site TEXT NOT NULL DEFAULT 'main'"
--      (then the four CREATE TABLE statements below, which are safe to re-run)
```

Then add the four `CREATE TABLE IF NOT EXISTS` statements from the spec's §2 to the body of the file, including the `slug` column on `symposium_speakers` and `speaker_slugs` on `symposium_sessions`, and the nullable `venue_public` / `city_public` with their explanatory comment.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql functions/_lib/auth.ts tests/permissions.test.ts
git commit -m "feat: add the is_symposium role and the symposium tables

One helper reads the flag, so the coming rework of the role model has a
single place to change. The visibility flags are nullable because NULL
means 'no opinion, use the repo' -- the same rule the overlay's lists
follow."
```

---

## Task 3: The public overlay endpoint

One unauthenticated `GET` the symposium build reads once.

**Files:**
- Create: `functions/api/symposium.ts`
- Create: `functions/_lib/symposium.ts`
- Modify: `functions/api/announcements.ts`
- Test: `tests/symposium-shape.test.ts` (create)

**Interfaces:**
- Consumes: `canManageSymposium` (not used here — this route is public), the tables from Task 2.
- Produces, from `functions/_lib/symposium.ts` — every type below is declared in that file:

```ts
// The D1 row shapes, mirroring Task 2's CREATE TABLE statements exactly.
export interface SpeakerRow { id: string; slug: string; year: number; name: string; position: string; company: string; bio: string; photo: string; linkedin: string; sort: number }
export interface SessionRow { id: string; year: number; title: string; type: string; time: string; end_time: string; description: string; speaker_slugs: string; sort: number }
export interface CommitteeRow { id: string; year: number; name: string; role: string; role_tr: string; affiliation: string; photo: string; linkedin: string; sort: number }
export interface AnnouncementRow { id: string; title: string; description: string; button_text: string; button_url: string; show_as_popup: number; expires_at: number }
export interface EditionRow { year: number; registration_url: string; registration_deadline: number | null; abstract_url: string; abstract_deadline: number | null; venue_public: number | null; city_public: number | null }

// What the public endpoint serves and the build consumes. Booleans, not 0/1.
export interface EditionOverlay { registrationUrl: string; registrationDeadline: number | null; abstractUrl: string; abstractDeadline: number | null; venuePublic: boolean | null; cityPublic: boolean | null }
export interface OverlaySpeaker { slug: string; name: string; position: string; company: string; bio: string; photo: string; linkedin?: string }
export interface OverlaySession { slug: string; title: string; type: string; speakerSlugs: string[]; description: string; time: string; endTime?: string; order: number }
export interface OverlayCommittee { name: string; role: string; roleTr: string; affiliation: string; photo: string; linkedin?: string }
export interface Overlay {
  year: number | null;
  edition: EditionOverlay;
  speakers: OverlaySpeaker[];
  sessions: OverlaySession[];
  committee: OverlayCommittee[];
  announcements: AnnouncementRow[];
}

export function rowsToOverlay(
  edition: EditionRow,
  speakers: SpeakerRow[],
  sessions: SessionRow[],
  committee: CommitteeRow[],
  announcements: AnnouncementRow[],
): Overlay;
```

- [ ] **Step 1: Write the failing test**

`tests/symposium-shape.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToOverlay } from '../functions/_lib/symposium';

const editionRow = {
  year: 2026, registration_url: 'https://forms.gle/reg', registration_deadline: 1790000000,
  abstract_url: '', abstract_deadline: null, venue_public: null, city_public: 1,
};

test('an unset flag stays null so the repo keeps its say', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  assert.equal(o.edition.venuePublic, null);
  assert.equal(o.edition.cityPublic, true);
});

test('an empty url is carried as an empty string, not dropped', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  assert.equal(o.edition.abstractUrl, '');
  assert.equal(o.edition.abstractDeadline, null);
});

test('speaker slugs survive so sessions can still point at them', () => {
  const o = rowsToOverlay(editionRow,
    [{ id: 'a', slug: 'ada-lovelace', year: 2026, name: 'Ada Lovelace', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 0 }],
    [{ id: 'b', year: 2026, title: 'Keynote', type: 'keynote', time: '09:30', end_time: '', description: '', speaker_slugs: '["ada-lovelace"]', sort: 0 }],
    [], []);
  assert.equal(o.speakers[0].slug, 'ada-lovelace');
  assert.deepEqual(o.sessions[0].speakerSlugs, ['ada-lovelace']);
});

test('a malformed speaker_slugs blob degrades to empty rather than throwing', () => {
  const o = rowsToOverlay(editionRow, [],
    [{ id: 'b', year: 2026, title: 'Keynote', type: 'keynote', time: '', end_time: '', description: '', speaker_slugs: 'not json', sort: 0 }],
    [], []);
  assert.deepEqual(o.sessions[0].speakerSlugs, []);
});

test('rows come out in sort order, not insertion order', () => {
  const o = rowsToOverlay(editionRow,
    [{ id: 'b', slug: 'b', year: 2026, name: 'B', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 2 },
     { id: 'a', slug: 'a', year: 2026, name: 'A', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 1 }],
    [], [], []);
  assert.deepEqual(o.speakers.map((s) => s.name), ['A', 'B']);
});

test('the hall never appears in the payload', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  assert.ok(!JSON.stringify(o).includes('venue'), 'no venue string may travel over the public API');
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/symposium-shape.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the shaping module**

`functions/_lib/symposium.ts` holds the row types and `rowsToOverlay`. It is pure — no D1, no fetch — so it can be tested outside a Worker. Booleans come out as `true`/`false`/`null`, never `0`/`1`, because the consumer is JSON. `speaker_slugs` is parsed inside a `try`/`catch` returning `[]`, so one bad row cannot fail a build. Sorting is by `sort` then `id` for stability.

- [ ] **Step 4: Write the route**

`functions/api/symposium.ts` — `onRequestGet` only, no auth. It reads the single `symposium_edition` row with the highest `year` that has no `archived_pr_url`, then the three lists and the announcements where `site = 'symposium'` and `expires_at > now`, and returns `rowsToOverlay(...)`. If there is no edition row it returns `{ year: null, ... }` with empty lists and a `200` — the build treats that as "no overlay", which is not an error.

- [ ] **Step 5: Scope the existing announcements endpoint**

`functions/api/announcements.ts` gains `AND site = 'main'` to its `WHERE`, so the main site keeps showing only its own. The column defaults to `'main'`, so this is a no-op for every existing row.

- [ ] **Step 6: Run the tests and commit**

```bash
npm test
git add functions/ tests/symposium-shape.test.ts
git commit -m "feat: publish the symposium overlay for the build to read

One unauthenticated GET, because the build makes it once and a partial
fetch would produce a half-merged site. The hall's name is not in it --
only the visibility flag -- so announcing the venue never puts the room
on an open endpoint."
```

---

## Task 4: The build-time merge

**Files:**
- Create: `symposium_website/src/lib/overlay.ts`
- Create: `symposium_website/tests/overlay.test.ts`
- Modify: `symposium_website/src/lib/content.ts`, and the pages that read editions
- Modify: `symposium_website/astro.config.mjs`

**Interfaces:**
- Consumes: `getSpeakers` / `getSessions` / `getCommittee` from Task 1; the payload shape from Task 3.
- Produces, from `symposium_website/src/lib/overlay.ts`:

```ts
// What a page needs to render the upcoming edition. The repo fills it from the
// content collections; the overlay may replace parts of it. Note the absence of
// `venue` and `venueCity`: they are read from the edition markdown by
// locationFor, and the overlay is not allowed to introduce them.
export interface RepoContent {
  registrationUrl: string;
  abstractUrl: string;
  registrationDeadline?: Date;
  abstractDeadline?: Date;
  venuePublic: boolean;
  cityPublic: boolean;
  speakers: Speaker[];       // from src/lib/content.ts, Task 1
  sessions: Session[];
  committee: CommitteeMember[];
}

export function mergeOverlay(repo: RepoContent, overlay: Overlay | null): RepoContent;
export async function fetchOverlay(year: number, apiBase: string): Promise<Overlay | null>;
```

`Overlay` and its members are imported from the main site's shape by copying the
type declarations into this file — the two projects do not share a module, and a
build-time HTTP boundary is not worth a package to cross it.

- [ ] **Step 1: Write the failing test**

`symposium_website/tests/overlay.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOverlay } from '../src/lib/overlay';

const repo = {
  registrationUrl: '', abstractUrl: '',
  registrationDeadline: undefined, abstractDeadline: undefined,
  venuePublic: false, cityPublic: true,
  speakers: [{ slug: 'from-repo', name: 'From Repo' }],
  sessions: [{ slug: 's1', title: 'From Repo', order: 1 }],
  committee: [],
} as never;

test('no overlay at all leaves the repo untouched', () => {
  assert.deepEqual(mergeOverlay(repo, null), repo);
});

test('the overlay supplies the links the repo does not have', () => {
  const out = mergeOverlay(repo, { edition: { registrationUrl: 'https://forms.gle/reg' } } as never);
  assert.equal(out.registrationUrl, 'https://forms.gle/reg');
});

test('an empty speaker list means no opinion, not deletion', () => {
  // A bad deploy or a half-run migration must not silently erase a published
  // programme. Removing every speaker is an act for a pull request.
  const out = mergeOverlay(repo, { speakers: [], sessions: [] } as never);
  assert.equal(out.speakers[0].name, 'From Repo');
  assert.equal(out.sessions[0].title, 'From Repo');
});

test('a non-empty list replaces the repo list wholesale', () => {
  const out = mergeOverlay(repo, { speakers: [{ slug: 'from-cms', name: 'From CMS' }] } as never);
  assert.deepEqual(out.speakers.map((s: { name: string }) => s.name), ['From CMS']);
});

test('a null flag leaves the repo flag standing', () => {
  const out = mergeOverlay(repo, { edition: { venuePublic: null } } as never);
  assert.equal(out.venuePublic, false);
});

test('an explicit true announces the venue the repo was withholding', () => {
  const out = mergeOverlay(repo, { edition: { venuePublic: true } } as never);
  assert.equal(out.venuePublic, true);
});

test('the overlay cannot introduce a venue string', () => {
  const out = mergeOverlay(repo, { edition: { venue: 'Secret Hall' } } as never);
  assert.ok(!('venue' in out) || (out as { venue?: string }).venue === undefined);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `../src/lib/overlay` not found.

- [ ] **Step 3: Write the module**

`src/lib/overlay.ts`. `mergeOverlay` is pure and takes no astro import, so the tests can load it. It copies the repo object, then for each of the six edition fields applies the overlay's value **only when it is neither `undefined` nor `null`**; for the three lists it replaces **only when the overlay's list has length**. It never reads a `venue` or `venueCity` key from the overlay.

`fetchOverlay` sits in the same file and is the only impure part:

```ts
const TIMEOUT_MS = 5000;

/**
 * Returns null on any failure. A symposium site that fails to build because
 * an API blinked is worse than one that is a few hours out of date, and a
 * build that quietly succeeds with no data would delete the programme.
 */
export async function fetchOverlay(year: number, apiBase: string): Promise<Overlay | null> {
  try {
    const res = await fetch(`${apiBase}/api/symposium`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) {
      console.error(`[overlay] ${res.status} from ${apiBase} -- building from the repo alone`);
      return null;
    }
    const data = await res.json() as Overlay;
    if (data.year !== year) {
      console.error(`[overlay] serves year ${data.year}, building ${year} -- building from the repo alone`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[overlay] unreachable (${String(err)}) -- building from the repo alone`);
    return null;
  }
}
```

- [ ] **Step 4: Wire it into the pages**

`src/lib/content.ts` grows one function the pages call instead of reading collections directly for the upcoming edition:

```ts
export async function getUpcomingContent(): Promise<RepoContent | null>
```

It reads the repo content for the upcoming edition, calls `fetchOverlay`, returns `mergeOverlay(...)`. Pages that render the upcoming edition — the two homepages, `/speakers`, `/schedule`, `/committee` — call it. Archive pages keep reading the collections directly; an archived edition has no overlay.

The API base is read from `import.meta.env.PUBLIC_API_BASE ?? 'https://rsg-turkiye.iscbsc.org'`, so a local build needs no configuration.

- [ ] **Step 5: Prove the failure path**

```bash
cd symposium_website
PUBLIC_API_BASE=http://127.0.0.1:9 npm run build 2>&1 | tail -20
```

Port 9 refuses connections. The build must **succeed**, print the `[overlay] unreachable` line, and produce a site with the repo's content. Confirm:

```bash
grep -c "13th RSG-Türkiye" dist/index.html
grep -ro "U3 Amph" dist/ | wc -l
```

- [ ] **Step 6: Run everything and commit**

```bash
npm test && npm run build
git add src/lib/overlay.ts src/lib/content.ts tests/overlay.test.ts astro.config.mjs src/pages
git commit -m "feat: merge the CMS overlay into the build, and survive it being gone

The repo is the source of a working site; D1 is an overlay. A failed
fetch logs and the build continues on repo data, because a build that
fails leaves everyone guessing and a build that succeeds with empty data
silently deletes the programme.

An absent or empty list means 'no opinion' rather than 'delete', so a bad
deploy cannot erase a published programme."
```

---

## Task 5: Admin API — edition settings, and publishing

**Files:**
- Create: `functions/api/admin/symposium/edition.ts`
- Modify: `functions/_lib/symposium.ts`
- Test: extend `tests/symposium-shape.test.ts`

**Interfaces:**
- Consumes: `canManageSymposium`, `rowsToOverlay`.
- Produces: `triggerRebuild(env: Env): Promise<{ triggered: boolean; detail: string }>` in `functions/_lib/symposium.ts`.

- [ ] **Step 1: Write the failing test**

Append to `tests/symposium-shape.test.ts`:

```ts
import { editionRowFromInput } from '../functions/_lib/symposium';

test('a blank deadline is stored as null, not as zero', () => {
  const row = editionRowFromInput({ registrationUrl: 'https://x', registrationDeadline: '' });
  assert.equal(row.registration_deadline, null);
});

test('a date arrives as a day and is stored as a timestamp', () => {
  const row = editionRowFromInput({ registrationDeadline: '2026-10-01' });
  assert.equal(row.registration_deadline, Date.UTC(2026, 9, 1) / 1000);
});

test('an untouched visibility flag stays null', () => {
  const row = editionRowFromInput({});
  assert.equal(row.venue_public, null);
});

test('an explicit false is stored as 0, not dropped as falsy', () => {
  // The difference between "hide it" and "no opinion" is the whole point of
  // the column being nullable.
  const row = editionRowFromInput({ venuePublic: false });
  assert.equal(row.venue_public, 0);
});

test('a url is rejected rather than stored when it is not http', () => {
  assert.throws(() => editionRowFromInput({ registrationUrl: 'javascript:alert(1)' }), /http/);
});
```

- [ ] **Step 2: Run it and watch it fail, then implement**

```bash
npm test -- tests/symposium-shape.test.ts
```

`editionRowFromInput` validates and shapes; it rejects any URL whose protocol is not `http:` or `https:`, since these values are rendered into `href`s on a public site.

- [ ] **Step 3: Write the route**

`functions/api/admin/symposium/edition.ts`: `getSessionUser` → 401, `canManageSymposium` → 403, `checkCsrf` on `PUT`. `GET` returns the row (or defaults when absent). `PUT` upserts by `year`, sets `updated_by` and `updated_at`, then calls `triggerRebuild`.

- [ ] **Step 4: Write the rebuild trigger**

In `functions/_lib/symposium.ts`:

```ts
/**
 * Fires the symposium site's deploy hook after a write commits.
 *
 * Never throws and never fails the request: the edit is saved either way,
 * and the nightly rebuild picks it up regardless. The result is returned so
 * the panel can tell the editor whether the site is rebuilding -- a hook
 * that has quietly stopped working is the failure this reports on.
 */
export async function triggerRebuild(env: Env): Promise<{ triggered: boolean; detail: string }> {
  if (!env.SYMPOSIUM_DEPLOY_HOOK) return { triggered: false, detail: 'no hook configured' };
  try {
    const res = await fetch(env.SYMPOSIUM_DEPLOY_HOOK, { method: 'POST' });
    const body = await res.text();
    if (!res.ok) console.error(`rebuild hook ${res.status}: ${body.slice(0, 200)}`);
    return { triggered: res.ok, detail: res.ok ? 'rebuild started' : `hook ${res.status}` };
  } catch (err) {
    console.error(`rebuild hook threw: ${String(err).slice(0, 200)}`);
    return { triggered: false, detail: 'hook unreachable' };
  }
}
```

Add `SYMPOSIUM_DEPLOY_HOOK: string;` to `interface Env` in `functions/_lib/auth.ts`, and a README line: the same hook URL the cron Worker holds, set on the **main** site with `wrangler pages secret put SYMPOSIUM_DEPLOY_HOOK`.

- [ ] **Step 5: Run the tests and commit**

```bash
npm test
git add functions/ tests/ README.md
git commit -m "feat: edit the symposium's registration and abstract settings

Saving fires the deploy hook after the write commits, and a hook failure
does not fail the save -- the edit is stored and the nightly rebuild will
publish it. The response says whether the rebuild started, so a hook that
has quietly stopped working is visible rather than silent."
```

---

## Task 6: Admin API — speakers, sessions and committee

**Files:**
- Create: `functions/api/admin/symposium/[kind].ts`, `functions/api/admin/symposium/[kind]/[id].ts`
- Modify: `functions/_lib/symposium.ts`
- Test: extend `tests/symposium-shape.test.ts`

**Interfaces:**
- Consumes: `canManageSymposium`, `triggerRebuild`.
- Produces: `KIND_TABLES: Record<'speakers'|'sessions'|'committee', string>` and `rowFromInput(kind, input)` in `functions/_lib/symposium.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { rowFromInput, KIND_TABLES } from '../functions/_lib/symposium';

test('only the three known kinds map to a table', () => {
  assert.deepEqual(Object.keys(KIND_TABLES).sort(), ['committee', 'sessions', 'speakers']);
  assert.equal(KIND_TABLES.speakers, 'symposium_speakers');
});

test('a speaker gets a slug derived from the name when none is given', () => {
  const row = rowFromInput('speakers', { name: 'Ada Lovelace' }, 2026);
  assert.equal(row.slug, 'ada-lovelace');
});

test('Turkish letters survive slugging without becoming mojibake', () => {
  const row = rowFromInput('speakers', { name: 'Ayşe Yılmaz Öztürk' }, 2026);
  assert.equal(row.slug, 'ayse-yilmaz-ozturk');
});

test('a session stores its speaker links as slugs', () => {
  const row = rowFromInput('sessions', { title: 'Keynote', type: 'keynote', speakerSlugs: ['ada-lovelace'] }, 2026);
  assert.equal(row.speaker_slugs, '["ada-lovelace"]');
});

test('an unknown session type is rejected rather than stored', () => {
  assert.throws(() => rowFromInput('sessions', { title: 'X', type: 'lightning' }, 2026), /type/);
});

test('an unknown kind is rejected', () => {
  assert.throws(() => rowFromInput('sponsors' as never, {}, 2026), /kind/);
});
```

Turkish slugging matters: `ş`→`s`, `ı`→`i`, `ö`→`o`, `ü`→`u`, `ğ`→`g`, `ç`→`c`, and `İ`→`i`. A naïve `toLowerCase()` turns `İ` into `i̇` (i plus a combining dot), which then fails to match the session's `speakerSlugs`.

- [ ] **Step 2: Run it, implement, run again**

```bash
npm test -- tests/symposium-shape.test.ts
```

- [ ] **Step 3: Write the routes**

`[kind].ts` handles `GET` (list, ordered by `sort`) and `POST` (create, `sort` defaulting to `max + 1`). `[kind]/[id].ts` handles `PUT` and `DELETE`. All four gate on `canManageSymposium`, all writes `checkCsrf`, and every write calls `triggerRebuild` and returns its result.

An unknown `kind` returns 404 rather than 500 — the parameter comes from the URL.

- [ ] **Step 4: Run the tests and commit**

```bash
npm test
git add functions/ tests/
git commit -m "feat: manage symposium speakers, sessions and committee

Slugs are derived with an explicit Turkish transliteration: a plain
toLowerCase turns İ into i plus a combining dot, which would silently
stop matching the speakerSlugs a session points at."
```

---

## Task 7: The admin pane

**Files:**
- Create: `src/components/admin/panes/SymposiumPane.astro`
- Modify: `src/components/admin/AdminShell.astro`, `AdminNav.astro`, `src/scripts/admin-panel.ts`, `src/i18n/ui.ts`

**Interfaces:**
- Consumes: every route from Tasks 5 and 6.
- Produces: a `symposium` pane and its nav entry.

- [ ] **Step 1: Add the copy**

Every label, placeholder, button and empty state goes into `src/i18n/ui.ts` under `admin.symposium.*`, in both blocks. No hardcoded strings — the panel was rebuilt on 2026-09-03 specifically to end that.

- [ ] **Step 2: Add the nav entry and the pane**

`AdminNav.astro` gains a `symposium` item; `AdminShell.astro` gains the pane. They land in the same commit, per the rule that no nav item leads nowhere.

`applyRoleVisibility` in `admin-panel.ts` grows the symposium pane into its allowed list: an admin gets everything as before, and a user with only `is_symposium` gets the symposium pane and nothing else. The allowed list is computed from what `/api/me` returns, not from a flag the client re-derives.

- [ ] **Step 3: Build the four sections**

Edition settings is a form; speakers, sessions and committee are list-plus-form. Reuse the announcements pane's shape rather than inventing a second one.

Panel conventions, all already in the file to copy from: the `focus-visible` ring on every control, `text-gray-500` as the lightest text, `tabular-nums` on dates and times, `overflow-x-auto` on any table.

Each save shows the `triggerRebuild` result — "rebuild started" or the failure — beside the button. Nothing auto-refreshes.

- [ ] **Step 4: Verify by hand**

```bash
npm run build && npx astro check && npm test
```

Then confirm in the built HTML that the symposium pane exists in both languages and that its strings are the Turkish ones on `/tr/admin`:

```bash
grep -c 'data-pane="symposium"' dist/admin/index.html dist/tr/admin/index.html
```

- [ ] **Step 5: Commit**

```bash
git add src/ tests/
git commit -m "feat: the symposium pane in the admin panel

A user with only is_symposium sees this pane and nothing else, from the
same role plumbing the announcer role already uses. Each save reports
whether the rebuild started."
```

---

## Task 8: The automated archive

**Files:**
- Modify: `functions/_lib/github.ts`, `workers/symposium-cron/src/index.ts`, `db/schema.sql`
- Create: `functions/_lib/archive.ts`, `functions/api/admin/symposium/archive.ts`
- Test: `tests/archive-render.test.ts` (create)

**Interfaces:**
- Consumes: `rowsToOverlay`, the tables from Task 2.
- Produces: `openContentPR(params, env)` (generalised from `openBlogPostPR`), and `renderArchive(overlay): { path: string; content: string }[]` — pure.

- [ ] **Step 1: Write the failing test**

`tests/archive-render.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../functions/_lib/archive';

const overlay = {
  year: 2026,
  edition: { registrationUrl: 'https://forms.gle/reg', venuePublic: true, cityPublic: true },
  speakers: [{ slug: 'ada-lovelace', name: 'Ada Lovelace', position: '', company: '', bio: '', photo: '' }],
  sessions: [{ slug: 'keynote', title: 'Keynote', type: 'keynote', speakerSlugs: ['ada-lovelace'], description: '', time: '09:30', order: 1 }],
  committee: [],
  announcements: [],
} as never;

test('it writes one file per kind, under the symposium site', () => {
  const paths = renderArchive(overlay).map((f) => f.path).sort();
  assert.deepEqual(paths, [
    'symposium_website/src/content/sessions/2026.json',
    'symposium_website/src/content/speakers/2026.json',
  ]);
});

test('an empty kind writes no file rather than an empty one', () => {
  // committee is empty above
  const paths = renderArchive(overlay).map((f) => f.path);
  assert.ok(!paths.some((p) => p.includes('committee')));
});

test('the written JSON parses back to the shape the collection expects', () => {
  const speakers = renderArchive(overlay).find((f) => f.path.includes('speakers'))!;
  const parsed = JSON.parse(speakers.content);
  assert.equal(parsed.year, 2026);
  assert.equal(parsed.people[0].slug, 'ada-lovelace');
});

test('the JSON is formatted, so the pull request is reviewable', () => {
  const speakers = renderArchive(overlay).find((f) => f.path.includes('speakers'))!;
  assert.ok(speakers.content.includes('\n  '), 'indented, not one line');
  assert.ok(speakers.content.endsWith('\n'), 'trailing newline');
});

test('the session keeps the slug link to its speaker', () => {
  const sessions = renderArchive(overlay).find((f) => f.path.includes('sessions'))!;
  assert.deepEqual(JSON.parse(sessions.content).items[0].speakerSlugs, ['ada-lovelace']);
});
```

- [ ] **Step 2: Run it, implement `renderArchive`, run again**

Pure: overlay in, files out. No D1, no GitHub.

- [ ] **Step 3: Generalise the PR helper**

In `functions/_lib/github.ts`, rename `openBlogPostPR` to `openContentPR` and lift its hardcoded `blog-submission/` prefix into a `branchPrefix` parameter. Update the one existing caller (`functions/api/admin/blog-submissions/[id].ts`) to pass `'blog-submission'`, so its behaviour is unchanged.

- [ ] **Step 4: Write the archive step**

`functions/api/admin/symposium/archive.ts` — a `POST` the cron Worker calls with the shared secret, gated the way `/api/mail/dispatch` is. It:

1. finds the edition whose `endOfEvent` has passed and whose `archived_pr_url` is null,
2. reads its rows, calls `renderArchive`,
3. calls `openContentPR` with `branchPrefix: 'symposium-archive'`,
4. writes the PR URL into `archived_pr_url`.

**Idempotence:** step 1 is the guard. A row with `archived_pr_url` set is skipped, so a Worker that runs twice opens one PR. Write the URL in the same statement that would be re-read.

- [ ] **Step 5: Call it from the nightly Worker**

`workers/symposium-cron/src/index.ts` already POSTs the deploy hook. It gains a second call to the archive endpoint before the rebuild, so an archived edition is in the repo before the site rebuilds without it. Both results are reported; either failing must fail the invocation, following the pattern that Worker already uses.

- [ ] **Step 6: Prove idempotence**

```bash
npm test
```

Plus, against a local D1 with a seeded past-dated edition, call the endpoint twice and confirm the second returns "already archived" and opens no PR. Record the actual output in the commit message.

- [ ] **Step 7: Commit**

```bash
git add functions/ workers/ tests/ db/schema.sql
git commit -m "feat: archive a finished symposium into the repo automatically

After the edition ends the nightly Worker renders D1 into the content
collection and opens a pull request; merging it makes the archive
permanent in git. Skipping any row that already has a PR URL is what
makes a Worker that runs twice open one pull request."
```

---

## Task 9: Close out

- [ ] **Step 1: Full verification**

```bash
npm test && npm run build && npx astro check
cd symposium_website && npm test && npm run build && npx astro check
```

- [ ] **Step 2: Prove the two properties that only fail in production**

```bash
cd symposium_website
PUBLIC_API_BASE=http://127.0.0.1:9 npm run build 2>&1 | grep "\[overlay\]"
grep -c "13th RSG-Türkiye" dist/index.html
grep -ro "U3 Amph" dist/ | wc -l
```

The build survives a dead API, still renders the edition, and still withholds the hall.

- [ ] **Step 3: Open the PR**

Body leads with what the committee can now do without a pull request, then the backbone, then the migrations a human must run.

- [ ] **Step 4: Post-merge checklist for a human**

- [ ] Run the three migrations in `db/schema.sql` (role column, announcements column, four tables)
- [ ] `wrangler pages secret put SYMPOSIUM_DEPLOY_HOOK` on the **main** site
- [ ] Grant `is_symposium` to the committee members who need it
- [ ] Redeploy `workers/symposium-cron` so it picks up the archive call
- [ ] Enter the registration and abstract links once the forms exist
