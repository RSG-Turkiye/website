# Phase 0: an edition retires on merge, not on a pull request being opened

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/api/symposium` retiring a symposium edition the moment its archive pull request is *opened*, so an unmerged pull request can no longer empty the programme on a green build.

**Architecture:** `symposium_edition` gains an `archived_at` column. Opening the pull request still writes `archived_pr_url`; only a *merged* pull request writes `archived_at`, and every "is this edition retired" query moves from the first column to the second. The daily cron already re-runs the archive endpoint, so the merge check costs no new schedule.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1 (SQLite), GitHub REST API, `node --test` with `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-symposium-cms-edition-design.md` (phase 0)

## Scope

This plan implements **phase 0 only**. Phases 0b, 1, 2, 3 and 4 in the spec
each get their own plan: they are separate subsystems (a snapshot path, the
overlay's field set, the public payload's withholding rule, a markdown
renderer, a content-collection migration), and each produces working,
testable software on its own. Phase 0 is first because every later phase
increases what an unmerged pull request costs.

## Global Constraints

- Prose that reaches a page must contain no em dash. `tests/no-em-dashes.test.ts`
  reads `src/` and `dist/` on both sites; code comments are exempt, so a `--`
  in a comment is fine and a `—` in a user-facing string is not.
- Every `admin.symposium.*` i18n key must exist and be non-empty in **both**
  `en` and `tr` in `src/i18n/ui.ts`. `tests/admin-symposium-i18n.test.ts`
  fails the build otherwise, in both directions.
- A symposium column's name is written out by hand in several places and
  `tests/symposium-columns.test.ts` is what keeps them in step. Read its
  header comment before adding a column.
- `ALTER TABLE ADD COLUMN` is not idempotent, so schema changes are recorded
  as numbered notes at the top of `db/schema.sql` rather than as statements
  in its body. Follow the existing numbering.
- Run tests from the repository root with `npm test`. A single file is
  `node --import tsx --test tests/<file>.test.ts`.

## Deviation from the spec, and why

The spec proposes renaming `archived_pr_url` to `archive_pr_url` and adding
`archived_at`, with a backfill. This plan **does not rename**. It adds
`archived_at` beside the existing column and leaves the name alone.

The rename buys a slightly better name and costs a window in which deployed
code reads a column that no longer exists -- which the spec itself names as
"the one way this phase can itself cause the problem it is fixing". The
existing name is also not wrong: the column holds the pull request's URL,
which is what it says. Dropping the rename removes the risk entirely and
loses nothing.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `db/schema.sql` | Declares `archived_at`; carries the numbered migration note for it |
| `functions/_lib/symposium.ts` | Gains `archiveDecision`, the pure rule saying what the archive loop should do with a row |
| `functions/_lib/github.ts` | Gains `pullNumberFromUrl` (pure) and `prState` (the one network call) |
| `functions/api/admin/symposium/archive.ts` | Uses both: stamps `archived_at` when the pull request has merged, reports it when it has not |
| `functions/api/symposium.ts` | Retires on `archived_at` |
| `functions/api/admin/symposium/edition.ts` | Retires on `archived_at`; returns the pull request URL so the panel can show it |
| `functions/api/admin/symposium/[kind].ts` | Retires on `archived_at` |
| `src/components/admin/panes/SymposiumPane.astro` | A line showing an open archive pull request |
| `src/scripts/admin-panel.ts` | Fills that line in |
| `src/i18n/ui.ts` | Its two strings, in both languages |
| `tests/archive-decision.test.ts` | New: the rule's table of cases |
| `tests/pull-number.test.ts` | New: URL parsing, including the shapes that must be refused |

---

### Task 1: The column and its migration note

**Files:**
- Modify: `db/schema.sql:521-534` (the `symposium_edition` table) and the numbered notes at the top of the file

**Interfaces:**
- Consumes: nothing
- Produces: a nullable `archived_at INTEGER` column on `symposium_edition`, meaning "the archive pull request was merged, at this unix timestamp"

- [ ] **Step 1: Add the column to the table declaration**

In `db/schema.sql`, inside `CREATE TABLE IF NOT EXISTS symposium_edition`,
directly under the `archived_pr_url` line:

```sql
  archived_pr_url       TEXT,
  -- When the archive pull request was *merged*, as a unix timestamp. NULL
  -- while it is unopened or open. This, not archived_pr_url, is what retires
  -- an edition from the public endpoint: stamping on the pull request being
  -- opened meant a pull request nobody merged emptied the programme, on a
  -- build that stayed green because a year mismatch is the same ordinary
  -- state as an edition nobody has programmed yet.
  archived_at           INTEGER,
```

- [ ] **Step 2: Add the numbered migration note**

At the top of `db/schema.sql`, after the highest-numbered existing note,
following its format exactly:

```
-- 7k. functions/api/symposium.ts and the two admin symposium routes now
--    filter on archived_at; deploying without this first makes every one of
--    them 500 with D1 "no such column: archived_at". ALTER TABLE ADD COLUMN
--    is not idempotent, so this is a note rather than a statement below:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_edition ADD COLUMN archived_at INTEGER"
--    Then backfill, so that an edition already archived and merged stays
--    retired rather than reappearing on the public endpoint:
--      wrangler d1 execute rsg-members --remote --command="UPDATE symposium_edition SET archived_at = updated_at WHERE archived_pr_url IS NOT NULL AND archived_at IS NULL"
--    The backfill deliberately assumes an already-stamped edition was
--    merged. That is what today's behaviour already asserts -- such a row is
--    retired right now -- so this preserves it exactly rather than making
--    finished editions public again.
```

`7k` is the next free number: the file's notes run to `7j` (the committee
`teams` column), and this belongs to the same numbered group of symposium
schema changes. Confirm with
`grep -nE "^-- [0-9]+[a-z]?\." db/schema.sql | tail -3` before writing it,
in case another branch has landed one in the meantime.

- [ ] **Step 3: Verify nothing else in the repo names the column yet**

Run: `grep -rn "archived_at" --include="*.ts" . | grep -v node_modules`
Expected: no output. The column exists only in the schema at this point.

- [ ] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "symposium_edition records when its archive pull request merged"
```

---

### Task 2: The rule for what the archive loop does with a row

**Files:**
- Modify: `functions/_lib/symposium.ts` (append near `editionYearAllowed`)
- Test: `tests/archive-decision.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export type ArchiveDecision =
  | { action: 'skip' }        // merged: nothing left to do
  | { action: 'check-merge' } // a pull request exists, its fate is unknown
  | { action: 'open-pr' };    // no pull request yet

export function archiveDecision(
  row: { archived_pr_url: string | null; archived_at: number | null },
): ArchiveDecision;
```

- [ ] **Step 1: Write the failing test**

Create `tests/archive-decision.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveDecision } from '../functions/_lib/symposium';

test('a row nobody has archived yet needs a pull request', () => {
  assert.deepEqual(
    archiveDecision({ archived_pr_url: null, archived_at: null }),
    { action: 'open-pr' },
  );
});

test('a row with a pull request and no merge is the case this phase exists for', () => {
  // The old code treated this as done and retired the edition. It is not
  // done: the content is in a branch nobody has merged.
  assert.deepEqual(
    archiveDecision({ archived_pr_url: 'https://github.com/o/r/pull/7', archived_at: null }),
    { action: 'check-merge' },
  );
});

test('a merged row is finished', () => {
  assert.deepEqual(
    archiveDecision({ archived_pr_url: 'https://github.com/o/r/pull/7', archived_at: 1789000000 }),
    { action: 'skip' },
  );
});

test('a merge stamp with no pull request is still finished', () => {
  // Not reachable through the routes, but a hand-run backfill can produce
  // it, and "merged" must win over "no URL on file" rather than reopening a
  // pull request for an edition that is already in the repository.
  assert.deepEqual(
    archiveDecision({ archived_pr_url: null, archived_at: 1789000000 }),
    { action: 'skip' },
  );
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/archive-decision.test.ts`
Expected: FAIL, `archiveDecision is not a function` (it is not exported yet).

- [ ] **Step 3: Write the rule**

In `functions/_lib/symposium.ts`, after `editionYearAllowed`:

```ts
/**
 * What the archive run should do with one edition row.
 *
 * Three states, not two. `archived_pr_url` used to mean both "a pull request
 * exists" and "this edition is dealt with", so opening the pull request
 * retired the edition from the public endpoint whether or not anybody merged
 * it -- and an unmerged one left the site serving an empty programme on a
 * build that stayed green.
 *
 * Pure, and separated from the route, so the three cases are a table in a
 * test rather than something only reachable by standing up D1 and GitHub.
 */
export type ArchiveDecision =
  | { action: 'skip' }
  | { action: 'check-merge' }
  | { action: 'open-pr' };

export function archiveDecision(
  row: { archived_pr_url: string | null; archived_at: number | null },
): ArchiveDecision {
  if (row.archived_at != null) return { action: 'skip' };
  if (row.archived_pr_url) return { action: 'check-merge' };
  return { action: 'open-pr' };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/archive-decision.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/symposium.ts tests/archive-decision.test.ts
git commit -m "Three states for an edition's archive, not two"
```

---

### Task 3: Asking GitHub whether the pull request merged

**Files:**
- Modify: `functions/_lib/github.ts`
- Test: `tests/pull-number.test.ts` (create)

**Interfaces:**
- Consumes: `githubRequest`, `GITHUB_OWNER`, `GITHUB_REPO` (already private to `github.ts`)
- Produces:

```ts
export function pullNumberFromUrl(prUrl: string): number | null;

export type PrState =
  | { kind: 'merged'; mergedAt: number }   // unix seconds
  | { kind: 'unmerged' }                   // open, or closed without merging
  | { kind: 'unknown'; error: string };

export async function prState(prUrl: string, env: Env): Promise<PrState>;
```

- [ ] **Step 1: Write the failing test for the parser**

Create `tests/pull-number.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pullNumberFromUrl } from '../functions/_lib/github';

test('a pull request URL yields its number', () => {
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/226'), 226);
});

test('a trailing slash is not a different pull request', () => {
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/226/'), 226);
});

test('an issue is not a pull request', () => {
  // notifyNewSubmission opens issues against the same repository, so an
  // issue URL landing in this column is a mistake worth refusing rather
  // than reading a number out of.
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/issues/226'), null);
});

test('anything else is refused rather than guessed at', () => {
  assert.equal(pullNumberFromUrl(''), null);
  assert.equal(pullNumberFromUrl('not a url'), null);
  assert.equal(pullNumberFromUrl('https://github.com/RSG-Turkiye/website/pull/abc'), null);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/pull-number.test.ts`
Expected: FAIL, `pullNumberFromUrl is not a function`.

- [ ] **Step 3: Write the parser and the lookup**

In `functions/_lib/github.ts`, after `openContentPR`:

```ts
/**
 * The number out of a pull request's browser URL, or null when the string is
 * not one.
 *
 * Separated from the request below so the refusals are testable without a
 * token: an issue URL, an empty column and a truncated string must all come
 * back null rather than being read as a pull request that would then be
 * asked about.
 */
export function pullNumberFromUrl(prUrl: string): number | null {
  const match = /\/pull\/(\d+)\/?$/.exec(prUrl.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Whether a pull request has been merged.
 *
 * `unknown` is deliberately not `unmerged`: a rate limit or a bad token must
 * leave the edition exactly as it was for the next run to retry, and
 * treating "we could not ask" as "not merged" would do that -- but treating
 * it as merged would retire an edition whose content is not in the
 * repository. The caller stamps only on `merged`.
 */
export type PrState =
  | { kind: 'merged'; mergedAt: number }
  | { kind: 'unmerged' }
  | { kind: 'unknown'; error: string };

export async function prState(prUrl: string, env: Env): Promise<PrState> {
  const number = pullNumberFromUrl(prUrl);
  if (number === null) return { kind: 'unknown', error: `not a pull request URL: ${prUrl}` };
  try {
    const res = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${number}`,
      { method: 'GET' },
      env
    );
    if (!res.ok) {
      const body = await res.text();
      return { kind: 'unknown', error: `pull ${number} lookup failed (${res.status}): ${body.slice(0, 200)}` };
    }
    const data = await res.json<{ merged_at: string | null }>();
    if (!data.merged_at) return { kind: 'unmerged' };
    return { kind: 'merged', mergedAt: Math.floor(Date.parse(data.merged_at) / 1000) };
  } catch (e) {
    return { kind: 'unknown', error: e instanceof Error ? e.message : 'Unknown GitHub API error' };
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/pull-number.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/github.ts tests/pull-number.test.ts
git commit -m "Ask GitHub whether the archive pull request merged"
```

---

### Task 4: The archive run stamps the merge

**Files:**
- Modify: `functions/api/admin/symposium/archive.ts:21-26` (the row type), `:57-60` (the SELECT), `:64-68` (the skip branch), `:186-200` (the stamp)

**Interfaces:**
- Consumes: `archiveDecision` (Task 2), `prState` (Task 3)
- Produces: two new `ArchiveResult` statuses, `'pr-open'` and `'merge-check-failed'`

- [ ] **Step 1: Widen the row type and the SELECT**

Replace line 26:

```ts
type EditionCandidateRow = EditionRow & { archived_pr_url: string | null; archived_at: number | null };
```

and the SELECT at line 57:

```ts
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline,
            venue_public, city_public, archived_pr_url, archived_at
     FROM symposium_edition
     ORDER BY year ASC`
```

- [ ] **Step 2: Add the two new result statuses**

In the `ArchiveResult` union near line 35, alongside `'already-archived'`:

```ts
  | { year: number; status: 'pr-open'; prUrl: string }
  | { year: number; status: 'merge-check-failed'; prUrl: string; error: string }
```

- [ ] **Step 3: Replace the skip branch with the three-way decision**

Replace lines 64-68 (the `if (edition.archived_pr_url)` block) with:

```ts
    const decision = archiveDecision(edition);

    if (decision.action === 'skip') {
      results.push({ year: edition.year, status: 'already-archived', prUrl: edition.archived_pr_url ?? '' });
      continue;
    }

    if (decision.action === 'check-merge') {
      // The pull request exists. Whether the edition is finished is now
      // GitHub's answer, not ours: until it merges, the content is in a
      // branch and the public endpoint must go on serving this edition from
      // D1.
      const prUrl = edition.archived_pr_url!;
      const state = await prState(prUrl, env);
      if (state.kind === 'merged') {
        await env.DB.prepare(
          `UPDATE symposium_edition SET archived_at = ? WHERE year = ?`
        ).bind(state.mergedAt, edition.year).run();
        results.push({ year: edition.year, status: 'already-archived', prUrl });
      } else if (state.kind === 'unmerged') {
        results.push({ year: edition.year, status: 'pr-open', prUrl });
      } else {
        // Left exactly as it was, for the next run. Not an error status for
        // the whole run: a rate limit is not a failed archive, and returning
        // 502 for one would make the cron's only failure signal fire on a
        // condition that fixes itself.
        results.push({ year: edition.year, status: 'merge-check-failed', prUrl, error: state.error });
      }
      continue;
    }
```

Add to the imports at the top of the file:

```ts
import { rowsToOverlay, archiveDecision } from '../../../_lib/symposium';
import { openContentPR, getFileOnBaseBranch, notifyNewSubmission, prState } from '../../../_lib/github';
```

(`rowsToOverlay` is already imported; add `archiveDecision` to that line and
`prState` to the `github` line rather than adding new import statements.)

- [ ] **Step 4: Correct the comment on the final UPDATE**

The comment at lines 186-195 says the next invocation's read guards on
`archived_pr_url`. It still does, through `archiveDecision`, but what it
means has changed. Replace the comment's first sentence with:

```ts
    // Written in the same statement the next run's archiveDecision reads, so
    // a Worker that runs this endpoint twice opens exactly one pull request
    // per edition. This stamps only that a pull request exists -- the
    // edition is not retired until archived_at, which the check-merge branch
    // above writes once GitHub says it merged.
```

- [ ] **Step 5: Type-check and run the whole suite**

Run: `npx tsc --noEmit -p tsconfig.json 2>/dev/null || npx astro check`
Then: `npm test`
Expected: no new failures. `tests/symposium-columns.test.ts` in particular
must still pass -- it reads the SELECTs.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/symposium/archive.ts
git commit -m "The archive run stamps the merge, not the pull request"
```

---

### Task 5: Retirement moves to archived_at

**Files:**
- Modify: `functions/api/symposium.ts:22-30`
- Modify: `functions/api/admin/symposium/edition.ts:18-24` and `:55-60`
- Modify: `functions/api/admin/symposium/[kind].ts:34`

**Interfaces:**
- Consumes: the `archived_at` column (Task 1), written by Task 4
- Produces: an edition with an open archive pull request stays the served edition

> Ordering: this task must land **after** Task 4 in the same branch. On its
> own it would mean nothing ever retires, because nothing writes
> `archived_at` yet.

- [ ] **Step 1: The public endpoint**

In `functions/api/symposium.ts`, replace the comment and the `WHERE`:

```ts
  // The upcoming edition: highest year not yet archived. "Archived" means the
  // archive pull request *merged* -- archived_pr_url only says one was
  // opened, and retiring on that emptied the programme for as long as it sat
  // unmerged.
  const edition = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public
     FROM symposium_edition
     WHERE archived_at IS NULL
     ORDER BY year DESC
     LIMIT 1`
  ).first<EditionRow>();
```

- [ ] **Step 2: Both queries in the admin edition route**

In `functions/api/admin/symposium/edition.ts`, change `WHERE archived_pr_url IS NULL`
to `WHERE archived_at IS NULL` in the GET's SELECT (line 21) and in the PUT's
year-resolving SELECT (line 57). The GET's comment already says it mirrors
the public endpoint's choice of row, which stays true.

- [ ] **Step 3: The kind route**

In `functions/api/admin/symposium/[kind].ts:34`:

```ts
    `SELECT year FROM symposium_edition WHERE archived_at IS NULL ORDER BY year DESC LIMIT 1`
```

- [ ] **Step 4: Verify no query still retires on the pull request**

Run: `grep -rn "archived_pr_url IS NULL" --include="*.ts" . | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/symposium.ts functions/api/admin/symposium/edition.ts functions/api/admin/symposium/[kind].ts
git commit -m "An edition is retired by a merge, not by a pull request"
```

---

### Task 6: The panel shows a pull request waiting to be merged

**Files:**
- Modify: `functions/api/admin/symposium/edition.ts` (GET: select and return the URL)
- Modify: `src/components/admin/panes/SymposiumPane.astro` (the edition section)
- Modify: `src/scripts/admin-panel.ts:997-1015` (`loadEdition`, and the `EditionData` interface at :984)
- Modify: `src/i18n/ui.ts` (both languages)

**Interfaces:**
- Consumes: `archived_pr_url` on the row the GET already reads
- Produces: `archivePrUrl: string | null` on the `/api/admin/symposium/edition` response

- [ ] **Step 1: Return the URL from the route**

In `functions/api/admin/symposium/edition.ts`, add `archived_pr_url` to the
GET's SELECT list, widen the local row type, give the no-row default
`archived_pr_url: null`, and return it:

```ts
  const edition = await env.DB.prepare(
    `SELECT year, registration_url, registration_deadline, abstract_url, abstract_deadline, venue_public, city_public, archived_pr_url
     FROM symposium_edition
     WHERE archived_at IS NULL
     ORDER BY year DESC
     LIMIT 1`
  ).first<EditionRow & { archived_pr_url: string | null }>();

  const row: EditionRow & { archived_pr_url: string | null } = edition ?? {
    year: new Date().getFullYear(),
    registration_url: '',
    registration_deadline: null,
    abstract_url: '',
    abstract_deadline: null,
    venue_public: null,
    city_public: null,
    archived_pr_url: null,
  };

  // archivePrUrl rides along rather than going through rowToEditionInput:
  // that function's output is exactly what PUT accepts back, and this is
  // read-only -- the panel displays it and never sends it.
  return jsonResponse({ year: row.year, ...rowToEditionInput(row), archivePrUrl: row.archived_pr_url });
```

- [ ] **Step 2: Add the two strings, in both languages**

In `src/i18n/ui.ts`, in the `en` block beside the other
`admin.symposium.edition.*` keys:

```ts
    'admin.symposium.edition.archivePrOpen': 'This edition has an archive pull request that has not been merged.',
    'admin.symposium.edition.archivePrLink': 'Review it',
```

and in the `tr` block:

```ts
    'admin.symposium.edition.archivePrOpen': 'Bu sürümün merge edilmemiş bir arşiv PR\'ı var.',
    'admin.symposium.edition.archivePrLink': 'İncele',
```

Neither string may contain an em dash.

- [ ] **Step 3: Add the line to the pane**

In `src/components/admin/panes/SymposiumPane.astro`, inside the edition
`<form id="symEditionForm">`, directly above the `<div class="sm:col-span-2 flex items-center gap-3">`
that holds the save button:

```astro
        <!--
          Hidden until the route reports one. An archive pull request that
          nobody merges used to be visible only in the database, while the
          site quietly served the edition's programme from an empty repo.
        -->
        <p id="symEditionArchivePr" class="hidden sm:col-span-2 text-xs text-gray-600">
          <span>{t('admin.symposium.edition.archivePrOpen')}</span>
          <a id="symEditionArchivePrLink" href="#" target="_blank" rel="noopener noreferrer" class="underline text-navy">
            {t('admin.symposium.edition.archivePrLink')}
          </a>
        </p>
```

- [ ] **Step 4: Fill it in from the client**

In `src/scripts/admin-panel.ts`, add to the `EditionData` interface at line 984:

```ts
  archivePrUrl: string | null;
```

and at the end of `loadEdition`, after the two tri-state selects:

```ts
  const archiveNote = document.getElementById('symEditionArchivePr')!;
  const archiveLink = document.getElementById('symEditionArchivePrLink') as HTMLAnchorElement;
  if (data.archivePrUrl) {
    archiveLink.href = data.archivePrUrl;
    archiveNote.classList.remove('hidden');
  } else {
    archiveNote.classList.add('hidden');
  }
```

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS, including `tests/admin-symposium-i18n.test.ts`, which fails
if either new key is missing from either language.

- [ ] **Step 6: Build the site**

Run: `npm run build`
Expected: completes. Then `grep -c "symEditionArchivePr" dist/admin/index.html`
and expect a non-zero count, so the markup actually shipped.

- [ ] **Step 7: Commit**

```bash
git add functions/api/admin/symposium/edition.ts src/components/admin/panes/SymposiumPane.astro src/scripts/admin-panel.ts src/i18n/ui.ts
git commit -m "Show an archive pull request that is waiting to be merged"
```

---

## Before the pull request

- [ ] `npm test` from the repository root passes.
- [ ] `npm test` inside `symposium_website` passes (this plan does not touch
      it, so it must be untouched by it).
- [ ] `npx astro check` reports no errors.
- [ ] The pull request body carries the two `wrangler d1 execute` commands
      from Task 1, and says they must be run **before** the branch is
      deployed. Every route in Task 5 will 500 with "no such column:
      archived_at" against a database that has not had them.
- [ ] Verified signed in, in a browser, on the admin panel: the edition form
      still loads and saves. A memory rule for this repository: auth UI is
      not verified until it has been seen signed in.
