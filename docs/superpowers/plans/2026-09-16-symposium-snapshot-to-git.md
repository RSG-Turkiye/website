# Phase 0b: the edition is snapshotted into git while it is still running

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the upcoming edition's CMS content into git every day, as one long-lived pull request, so it exists somewhere other than D1 before the edition ends.

**Architecture:** The archive endpoint already runs daily from the cron Worker and already renders the CMS overlay into the repository's JSON files. Today it skips an edition that has not finished (`not-yet-over`). It stops skipping: it renders the same files and refreshes the same pull request, without stamping anything. Writing to git and retiring from the public endpoint stay two different acts, exactly as phase 0 separated them. A panel button calls the same path on demand.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1 (SQLite), GitHub REST API, Cloudflare Workers cron, `node --test` with `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-14-symposium-cms-edition-design.md` (phase 0b)

**Depends on:** phase 0, merged. This plan calls `archiveDecision` and extends the result union phase 0 introduced.

## Global Constraints

- Prose that reaches a page must contain no em dash. `tests/no-em-dashes.test.ts`
  reads `src/` and `dist/` on both sites; code comments are exempt.
- Every `admin.symposium.*` i18n key must exist and be non-empty in **both**
  `en` and `tr` in `src/i18n/ui.ts`. `tests/admin-symposium-i18n.test.ts` fails
  otherwise, in both directions.
- Run tests from the repository root with `npm test`, and separately inside
  `symposium_website`. Type check with `npx astro check`.
- A snapshot must never write `archived_at`. Only a merged archive pull request
  does, and only through the path phase 0 built.

## What this phase does NOT touch, and why that matters

`renderArchive` writes three JSON files and nothing else: speakers, sessions,
committee (`functions/_lib/archive.ts`). It does not write edition frontmatter,
so **the hall cannot travel through a snapshot in this phase**. The spec's
warning about `venue` reaching a public repository through this button becomes
live in phase 1, when the frontmatter starts being written, and the guard
belongs in that plan. `symposium_website/tests/withheld-venue.test.ts` remains
the net either way.

## The behaviour change this forces, and why it is here

Once a snapshot is merged, the repository holds real content for the upcoming
edition. Measured against the real `mergeOverlay`: editing through the panel
still wins, and deleting one speaker of three still wins, but **clearing a
field or deleting the last row does not** -- an empty string and an empty list
both mean "no opinion", so the merged snapshot's value comes back.

The spec settles this: the overlay is authoritative when present, and the
switch is made per field group as each moves into the CMS. The groups this
phase puts into git are speakers, sessions and committee, so those three
switch here. The six edition fields are not snapshotted by `renderArchive` and
do not switch in this plan.

## File Structure

| File | Responsibility after this plan |
| --- | --- |
| `functions/_lib/archive.ts` | Gains `snapshotPrBody`, the text a not-yet-finished edition's pull request carries |
| `functions/api/admin/symposium/archive.ts` | Snapshots an unfinished edition instead of skipping it; still stamps nothing for one |
| `functions/api/admin/symposium/snapshot.ts` | New: the admin-authenticated "send to git now" route |
| `symposium_website/src/lib/overlay.ts` | The three lists become authoritative when the overlay is present |
| `src/components/admin/panes/SymposiumPane.astro` | The button |
| `src/scripts/admin-panel.ts` | Calls it, reports the result |
| `src/i18n/ui.ts` | Its strings, both languages |
| `symposium_website/tests/overlay.test.ts` | Extended: the deletion cases |
| `tests/snapshot-body.test.ts` | New: the two pull request bodies are distinguishable |

---

### Task 1: The three lists become authoritative when the overlay is present

**Files:**
- Modify: `symposium_website/src/lib/overlay.ts` (`mergeOverlay`)
- Test: `symposium_website/tests/overlay.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `mergeOverlay` with the list rule inverted. Its signature does not change.

> This task lands FIRST, before anything writes a snapshot into git. In the
> other order there is a window where a merged snapshot is live and deleting
> the last speaker silently resurrects the old roster.

- [ ] **Step 1: Write the failing tests**

Append to `symposium_website/tests/overlay.test.ts`:

```ts
test('deleting the last speaker in the CMS actually empties the page', () => {
  // The repo holds a merged snapshot, which is the state phase 0b creates and
  // that this project has never been in before. Under the old rule an empty
  // overlay list meant "no opinion" and this roster came back from the dead.
  const repo = { ...emptyRepo(), speakers: [{ slug: 'a' }, { slug: 'b' }] as any };
  const merged = mergeOverlay(repo, { ...emptyOverlay(), speakers: [] } as any);
  assert.deepEqual(merged.speakers, []);
});

test('an overlay that is absent still falls back to the repo', () => {
  // The whole point of the snapshot: an unreachable API renders what git holds.
  const repo = { ...emptyRepo(), speakers: [{ slug: 'a' }] as any };
  assert.equal(mergeOverlay(repo, null).speakers.length, 1);
});

test('a non-empty overlay list still replaces the repo, as before', () => {
  const repo = { ...emptyRepo(), speakers: [{ slug: 'a' }, { slug: 'b' }] as any };
  const merged = mergeOverlay(repo, { ...emptyOverlay(), speakers: [{ slug: 'c' }] } as any);
  assert.deepEqual(merged.speakers.map((s: any) => s.slug), ['c']);
});
```

Add `emptyRepo()` and `emptyOverlay()` helpers at the top of the file if the
file does not already have equivalents; read it first and reuse what is there.

- [ ] **Step 2: Run them and watch the first one fail**

Run: `cd symposium_website && node --import tsx --test tests/overlay.test.ts`
Expected: the deletion test FAILS with the repo's two speakers still present.
The other two pass already.

- [ ] **Step 3: Invert the rule for the three lists**

In `mergeOverlay`, replace the three `if (overlay.X && overlay.X.length > 0)`
blocks with unconditional assignment, and replace the comment above them:

```ts
  // Assigned, not merged-if-non-empty. These three are snapshotted into the
  // repo daily now (see the archive route), so the repo holds a copy of what
  // the CMS last said rather than an independent source -- and under the old
  // "an empty list means no opinion" rule, deleting the last speaker in the
  // panel let that copy come back from the dead. A reachable overlay is the
  // answer, empty included; an unreachable one is `null` and still falls back
  // to the repo, which is what the snapshot is for.
  merged.speakers = overlay.speakers as unknown as Speaker[];
  merged.sessions = overlay.sessions as unknown as Session[];
  merged.committee = overlay.committee as unknown as CommitteeMember[];
```

Update `repoCanStandAlone`'s doc comment if it claims the overlay is additive
for these lists; read it and correct only what is now false.

- [ ] **Step 4: Run the symposium suite**

Run: `cd symposium_website && npm test`
Expected: PASS. If an existing test asserted the old "empty means no opinion"
behaviour for these lists, it encoded the bug; update it and say so in the
commit message rather than deleting it silently.

- [ ] **Step 5: Commit**

```bash
git add symposium_website/src/lib/overlay.ts symposium_website/tests/overlay.test.ts
git commit -m "A reachable overlay is the answer, empty included"
```

---

### Task 2: A snapshot's pull request says what it is

**Files:**
- Modify: `functions/_lib/archive.ts`
- Test: `tests/snapshot-body.test.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces:

```ts
export function snapshotPrTitle(year: number): string;
export function snapshotPrBody(year: number): string;
export function archivePrTitle(year: number): string;
export function archivePrBody(year: number): string;
```

The archive route's existing title and body text moves into the last two
unchanged, so there is one place each string lives.

- [ ] **Step 1: Write the failing test**

Create `tests/snapshot-body.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotPrTitle, snapshotPrBody, archivePrTitle, archivePrBody } from '../functions/_lib/archive';

test('a snapshot does not tell the reader the symposium has ended', () => {
  // The same branch carries both, for a year. The archive body says "merge
  // this promptly" because the programme is missing from the live site; a
  // snapshot opened ten months early must not say that, or it trains everyone
  // to ignore the one that means it.
  const body = snapshotPrBody(2026);
  assert.ok(!/has ended/i.test(body), 'a snapshot must not claim the edition is over');
  assert.ok(!/promptly/i.test(body), 'a snapshot is not urgent');
  assert.ok(/2026/.test(body));
});

test('a snapshot says merging is optional and what merging buys', () => {
  assert.ok(/optional/i.test(snapshotPrBody(2026)));
});

test('the archive body still says the edition has ended', () => {
  assert.ok(/has ended/i.test(archivePrBody(2026)));
});

test('the two titles are distinguishable at a glance in a pull request list', () => {
  assert.notEqual(snapshotPrTitle(2026), archivePrTitle(2026));
  assert.ok(snapshotPrTitle(2026).includes('2026'));
  assert.ok(archivePrTitle(2026).includes('2026'));
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node --import tsx --test tests/snapshot-body.test.ts`
Expected: FAIL, the four functions are not exported.

- [ ] **Step 3: Write the four functions**

In `functions/_lib/archive.ts`, after `renderArchive`:

```ts
/**
 * The pull request text for an edition that has not happened yet.
 *
 * Deliberately not the archive's wording. The same branch carries both for as
 * long as a year, and the archive body tells a reviewer the live site's
 * programme is missing and to merge promptly. A snapshot opened ten months
 * before the symposium that said the same thing would train everyone to
 * ignore the one that means it.
 */
export function snapshotPrTitle(year: number): string {
  return `Snapshot the ${year} symposium CMS content`;
}

export function snapshotPrBody(year: number): string {
  return (
    `A daily copy of what the CMS holds for the ${year} symposium, so its ` +
    `content exists somewhere other than the database while the edition is ` +
    `still being prepared.\n\n` +
    `**Merging is optional and nothing breaks if this sits here.** The live ` +
    `site reads the CMS directly, so merging changes nothing a visitor sees ` +
    `today. What it buys is the fallback: with this merged, an unreachable ` +
    `CMS leaves the site rendering the last known programme instead of ` +
    `"announced soon".\n\n` +
    `This pull request is refreshed every day. Merging it does not stop that; ` +
    `a new one opens with the next day's changes.`
  );
}

export function archivePrTitle(year: number): string {
  return `Archive the ${year} symposium`;
}

export function archivePrBody(year: number): string {
  return (
    `The ${year} symposium has ended. This folds its CMS overlay ` +
    `into the content collection permanently.\n\n` +
    `**Merge this promptly.** The site decides an edition is over from its dates ` +
    `alone, so ${year} stopped being the upcoming edition the moment it ` +
    `ended, and the pages that render its programme have gone back to reading the ` +
    `repo -- which does not have this content until you merge. Until then ` +
    `/schedule, /speakers and /committee are empty for ${year}.\n\n` +
    `Also worth doing in the same pass: editions/${year}.md still has an ` +
    `empty \`speakers:\` list, so that edition's own page shows no speaker grid.`
  );
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `node --import tsx --test tests/snapshot-body.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/archive.ts tests/snapshot-body.test.ts
git commit -m "A snapshot's pull request is not an archive's"
```

---

### Task 3: The daily run snapshots an edition that has not finished

**Files:**
- Modify: `functions/api/admin/symposium/archive.ts`

**Interfaces:**
- Consumes: `snapshotPrTitle`, `snapshotPrBody`, `archivePrTitle`, `archivePrBody` (Task 2); `archiveDecision`, `openContentPR` (already present)
- Produces: a new `ArchiveResult` status, `{ year: number; status: 'snapshotted'; prUrl: string }`, replacing `'not-yet-over'` for an edition that has overlay content

- [ ] **Step 1: Extract the pull request call**

The handler currently builds `overlay`, calls `renderArchive`, returns early on
`files.length === 0`, then calls `openContentPR` with inline title and body.
Replace the inline strings with the Task 2 functions so both paths share one
call. Read the file and make the smallest edit that achieves it.

- [ ] **Step 2: Snapshot instead of skipping**

Replace the `if (endOfEvent > now)` block that pushes `'not-yet-over'`. The
edition is still ahead of us, so: render its files, and if there are any, open
or refresh its pull request with the snapshot wording, then `continue` WITHOUT
touching either archived column.

```ts
    if (endOfEvent > now) {
      // Still ahead of us. Its content lives only in D1 until the day it
      // ends, which is the whole window this snapshot exists to cover: a
      // pull request refreshed daily means the CMS is never the only copy.
      //
      // Nothing is stamped. archived_pr_url means "the archive pull request
      // exists" and archived_at means "it merged and this edition is
      // retired"; a snapshot is neither, and writing either one here would
      // retire an edition that has not happened.
      const snapshot = await snapshotEdition(edition, env);
      results.push(snapshot);
      continue;
    }
```

with a helper alongside the handler that gathers the rows, renders, and opens
the pull request, returning `{ year, status: 'snapshotted', prUrl }`,
`{ year, status: 'no-overlay-content' }` or `{ year, status: 'error', error }`.
Factor the row-gathering the finished path already does into that helper too,
so the two paths cannot drift on which columns they read -- `tests/symposium-columns.test.ts`
reads those SELECTs and there must remain exactly one of each.

- [ ] **Step 3: Confirm a snapshot failure does not raise the run's alarm**

A snapshot is best effort; the cron's alarm is for the archive. At the bottom
of the handler, `anyError` must treat a `'snapshotted'` path's `'error'`
distinctly from a finished edition's. Read the `anyError` computation phase 0
left and decide: the simplest correct answer is a separate status,
`'snapshot-failed'`, that is NOT in `anyError`. Use that rather than widening
`'error'`.

- [ ] **Step 4: Type check and test**

Run: `npx astro check` then `npm test`
Expected: clean, and `tests/symposium-columns.test.ts` still passing.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/symposium/archive.ts
git commit -m "The daily run copies an unfinished edition into git too"
```

---

### Task 4: A panel button that snapshots on demand

**Files:**
- Create: `functions/api/admin/symposium/snapshot.ts`
- Modify: `src/components/admin/panes/SymposiumPane.astro`, `src/scripts/admin-panel.ts`, `src/i18n/ui.ts`

**Interfaces:**
- Consumes: the helper Task 3 extracted
- Produces: `POST /api/admin/symposium/snapshot` returning `{ ok: boolean, prUrl?: string, reason?: string }`

- [ ] **Step 1: The route**

Create `functions/api/admin/symposium/snapshot.ts`. Gate it exactly as
`edition.ts`'s PUT does -- `checkCsrf`, `getSessionUser`, `canManageSymposium`,
in that order, with the same responses. It resolves the current edition the
same way `edition.ts`'s GET does (`WHERE archived_at IS NULL ORDER BY year DESC LIMIT 1`),
calls the Task 3 helper, and returns its result. It does NOT call
`triggerRebuild`: a snapshot changes nothing the site renders.

Read `functions/api/admin/symposium/edition.ts` and copy its gate verbatim
rather than writing a new one.

- [ ] **Step 2: The strings, both languages**

In `src/i18n/ui.ts`, beside the other `admin.symposium.edition.*` keys:

```ts
    'admin.symposium.edition.snapshot': 'Send a copy to git now',
    'admin.symposium.edition.snapshotHint': 'Opens or refreshes a pull request holding what the CMS has for this edition. The site is unaffected.',
    'admin.symposium.edition.snapshotDone': 'Copy sent. Review it:',
    'admin.symposium.edition.snapshotEmpty': 'Nothing to copy yet.',
    'admin.symposium.edition.snapshotFailed': 'Could not send the copy. Try again later.',
```

and in `tr`:

```ts
    'admin.symposium.edition.snapshot': 'Şimdi git\'e bir kopya gönder',
    'admin.symposium.edition.snapshotHint': 'CMS\'te bu etkinlik için ne varsa onu taşıyan bir PR açar ya da tazeler. Siteyi etkilemez.',
    'admin.symposium.edition.snapshotDone': 'Kopya gönderildi. İncele:',
    'admin.symposium.edition.snapshotEmpty': 'Henüz kopyalanacak bir şey yok.',
    'admin.symposium.edition.snapshotFailed': 'Kopya gönderilemedi. Sonra tekrar dene.',
```

No em dash in any of them. Both keys in both languages, or
`tests/admin-symposium-i18n.test.ts` fails.

- [ ] **Step 3: The button**

In the edition section of `SymposiumPane.astro`, in the same
`<div class="sm:col-span-2 flex items-center gap-3">` as the save button, after
it, a `type="button"` with id `symEditionSnapshotBtn` styled as the secondary
buttons elsewhere in the pane are (`border border-border text-gray-500`), plus
a `<p id="symEditionSnapshotStatus" class="hidden text-xs text-gray-500">` for
the result. Put the hint under the row as a `text-xs text-gray-500` line.

Read how `symEditionSaveBtn` and `symEditionStatus` are laid out and match
them rather than inventing a second shape.

- [ ] **Step 4: The client**

In `src/scripts/admin-panel.ts`, inside `setupEditionForm`, wire the button.
Use the existing `whileSaving(btn, fn)` helper so the button disables while the
request is in flight, exactly as the save button does. On success with a
`prUrl`, show `snapshotDone` and the URL as a link; on `ok: false` with a
reason of no content, show `snapshotEmpty`; otherwise `snapshotFailed`.

- [ ] **Step 5: Everything**

Run: `npx astro check`, `npm test`, `npm run build`.
Then: `grep -c "symEditionSnapshotBtn" dist/admin/index.html` and expect
non-zero.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/symposium/snapshot.ts src/components/admin/panes/SymposiumPane.astro src/scripts/admin-panel.ts src/i18n/ui.ts
git commit -m "Send a copy of the edition to git, on demand"
```

---

## Before the pull request

- [ ] `npm test` at the root and inside `symposium_website` both pass.
- [ ] `npx astro check` reports no errors.
- [ ] Verified signed in, in a browser: the button runs, reports a pull request
      URL, and that pull request contains the expected JSON files. This repo's
      rule is that auth UI is not verified until it has been seen signed in,
      and this task adds a button that writes to a public repository.
- [ ] The pull request body says that merging a snapshot is what makes the repo
      a real fallback, and that Task 1 changed what deleting the last row does.
- [ ] No database migration is needed for this phase. Say so in the pull
      request, because the previous one did need two commands and a reviewer
      will be looking for them.
