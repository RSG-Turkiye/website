# The panel owns the upcoming edition

**Date:** 2026-09-14
**Status:** design, approved in chat; not yet planned

## The problem

`/admin/` edits six edition settings (the registration and abstract links
and their deadlines, and the two publicity flags), plus speakers, sessions,
committee and announcements. Everything else a visitor reads on the
symposium site lives in `symposium_website/src/`, reachable only by a pull
request:

| What | Where it lives now |
| --- | --- |
| `title`, `titleTr`, `subtitle`, `subtitleTr` | `src/content/editions/<year>.md` |
| `date`, `dateTr`, `startDate`, `endDate` | same |
| `venue`, `venueTr`, `venueCity`, `venueCityTr` | same, and deliberately excluded from the overlay |
| `posterImage`, `galleryImages`, `recordingsUrl` | same |
| The edition page's prose, English and Turkish | `editions/<year>.md` body, `editions-tr/<year>.md` |
| Sponsors | `src/data/sponsors.ts`, not even a content collection |

An organiser who wants to correct the subtitle, announce the hall, or add a
sponsor has to open a pull request against a repository they may not have.

## Scope

The **upcoming edition only**. `symposium_edition` stays one row per year
with the newest unarchived one served; past editions stay in git, where the
archiver puts them. Editing 2018's title remains a pull request.

## Approach

**The overlay grows.** The repo stays the source of a working site and D1
stays a layer on top of it: empty means "no opinion", so a build survives
the API being gone with whatever the repo holds. This is the property
6e0a280 was built for and nothing here gives it up.

Two alternatives were considered and rejected:

- *D1 becomes authoritative for the upcoming edition, the markdown becomes a
  stub.* A cleaner mental model, but with a stub there is no title to fall
  back to: an unreachable API stops being a degraded page and becomes a
  blank one.
- *The panel opens pull requests instead of writing D1.* `openContentPR`
  already exists and the archiver already uses it, so this costs no archive
  work. It is disqualified by venue: this repository is public, and a public
  pull request is a public repository. That is exactly the incident
  `symposium_website/tests/withheld-venue.test.ts` was written about.

## Phases

Each phase is its own pull request. Phase 0 is a prerequisite, not a
nice-to-have: it is what stops the later phases from making an existing
failure mode more expensive.

### Phase 0 -- an edition retires on merge, not on a pull request being opened

Nothing deletes CMS rows. The only `DELETE` against the four symposium
tables is the panel's own row button (`functions/api/admin/symposium/[kind]/[id].ts:153`);
`archive.ts` only stamps `archived_pr_url` (`archive.ts:197`), and `year` is
a primary key, so starting 2027 inserts a row beside 2026's rather than
replacing it.

What can be lost is not the rows but the reader. `/api/symposium` serves
"highest year where `archived_pr_url IS NULL`", which produces two bad
states:

1. **The cron never runs.** 2026 is never stamped, so the API serves it
   forever, and the site stays stuck on a finished edition. The moment
   somebody opens 2027, the API switches and 2026's rows are orphaned:
   still in D1, read by nothing, and absent from git because no pull request
   was ever opened. The 2026 page falls back to the repo, which for a
   CMS-only edition is an empty programme.
2. **The cron runs and the pull request is never merged.** `archived_pr_url`
   is stamped when the pull request is *opened*. So a perfectly healthy cron
   retires the edition from the API while its content sits unmerged in
   somebody's tab, and `loadCurrentContent` treats the resulting year
   mismatch as the ordinary "nobody has programmed this yet" state --
   `console.info`, green build, empty programme
   (`symposium_website/src/lib/content.ts:136`).

Both are recoverable only by clearing the column by hand, because an
edition with `archived_pr_url` set is reported `already-archived` and
skipped.

Today the cost of either is "the programme disappears". After the phases
below it is "the title, the date, the hall and the page's prose disappear
too". So:

- Split the column: `archive_pr_url` (a pull request exists) and
  `archived_at` (it was merged). The public endpoint retires an edition on
  `archived_at`, not on the pull request existing.
- The cron already runs daily and `openContentPR` converges on the same pull
  request, so checking whether it merged costs no extra round trip.
- The panel shows, for an edition with a pull request, its URL and whether
  it has been merged, so one waiting for review is visible to a human rather
  than only to the database.
- `archived_pr_url` is renamed, so the migration carries its existing values
  into `archive_pr_url` and backfills `archived_at` for editions already
  archived and merged. Until it is backfilled, a merged edition would be
  served again by the public endpoint, which is the one way this phase can
  itself cause the problem it is fixing.

### Phase 0b -- the edition is snapshotted into git while it is still running

Phase 0 makes retirement honest, but it does not answer "what if something
happens to the CMS". Between the day an edition is entered and the day it
finishes, its content exists in exactly one place: D1.

`renderArchive` and `openContentPR` already do the work; what they do not do
is run before the edition is over. So:

- A daily snapshot. The cron already runs; for the upcoming edition it
  renders the same files the archiver would and calls `openContentPR`, which
  converges on the same branch and the same pull request when called again
  with the same arguments (`functions/_lib/github.ts:263`). One long-lived
  pull request per edition, refreshed, merged when the edition ends.
- A "send to git now" button in the panel, on the same code path, for an
  organiser who has just entered something they do not want to lose.

A snapshot never sets `archived_at`: the edition is still upcoming and the
public endpoint must go on serving it from D1. Writing to git and retiring
from the API are two different acts, which is the same separation phase 0
makes.

Three things this must respect:

- **The hall does not go through it.** While `venue_public != 1` the
  snapshot writes no `venue`/`venueTr` into the markdown, on the same rule
  the public endpoint follows. A snapshot that ignored this would hand back
  everything phase 2 wins, through a button, into a public repository. This
  is what `withheld-venue.test.ts` exists to catch, and it will.
- **A merged snapshot changes what an outage looks like, for the better.**
  Today an unreachable API leaves the 2026 page saying "announced soon",
  because the repo holds nothing for that year. With a snapshot merged, the
  same outage shows the last known programme. `repoCanStandAlone` starts
  returning true for the upcoming edition, which is the behaviour its
  refusal branch was written to protect.
- **And it gives an emptied list somewhere to fall back to.** In
  `mergeOverlay` an empty list means "no opinion", so deleting the last
  speaker in the panel would let a merged snapshot's roster reappear.
  Harmless today because the repo has nothing; real as soon as snapshots are
  merged. Either the overlay distinguishes "empty" from "absent" for the
  upcoming edition, or the panel refuses to delete the last row. Decide when
  phase 0b is planned, not while implementing it.

Worth checking before any of this is built: Cloudflare D1's Time Travel is a
thirty-day point-in-time restore. If it is available on this account it
covers "something happened to the CMS" more completely than any snapshot,
and phase 0b becomes what it should be -- content in git, reviewable, where
the rest of the site's content lives -- rather than the only backup there is.

### Phase 1 -- the edition's own details, and its images

New columns: `title`, `title_tr`, `subtitle`, `subtitle_tr`, `date_text`,
`date_text_tr`, `start_date`, `end_date`, `poster_image`, `gallery_images`
(a JSON array), `recordings_url`.

Bilingual fields follow the committee pane's `role`/`roleTr` pairing, which
is the shape the panel already teaches. Images reuse the committee photo
upload route, so a file is chosen rather than hosted elsewhere first, and
the URL it returns is `/api/images/...` -- never an `r2.dev` hostname, which
is blocked for this audience.

`mergeOverlay` keeps the rule it applies to `registrationUrl` today: an
empty string is "no opinion" and the repo's value stands. The consequence,
stated rather than discovered: a field cannot be *cleared* from the panel,
only overwritten. That is already true of the six fields the panel edits.

### Phase 2 -- the hall and the city

The public endpoint omits `venue`/`venueTr` from the payload entirely while
`venue_public != 1`, and the city fields while `city_public != 1`. The flags
always travel, so `locationFor` still reaches its "withheld" branch and the
page still says "Ankara, venue to be announced".

The point of the phase is only realised when the hall is **removed from
`editions/<year>.md`** and lives in D1 alone; that deletion is part of this
phase. `withheld-venue.test.ts` stays exactly as it is -- somebody can still
type a hall into markdown, and the test is what catches it.

The panel is unaffected by the withholding: it reads the authenticated
`/api/admin/symposium/edition` (`src/scripts/admin-panel.ts:999`), not the
public endpoint, so the editor's own form still shows the hall they typed.

If D1 is unreachable the hall simply does not arrive and `locationFor` falls
to the city. The page is then incomplete, not wrong.

The "the overlay is not allowed to introduce venue" comments in
`symposium_website/src/lib/overlay.ts` are rewritten with this reasoning
rather than deleted.

### Phase 3 -- the page's prose

New columns: `body_en`, `body_tr`, holding markdown.

The edition pages render `render(edition)` today, which only works on a
collection entry. When the overlay carries a body for the upcoming year it
is compiled with `createMarkdownProcessor` from `@astrojs/markdown-remark`
-- Astro's own, already in `node_modules`, no new dependency -- and printed;
otherwise the repo body is rendered as now. `astro.config.mjs` sets no
markdown options, so the processor's defaults are what the rest of the site
already uses (verified: `--` renders as an em dash either way).

Two decisions:

- **Raw HTML passthrough is off for CMS prose.** This is the first user
  text on the site to reach a page through `set:html`; today only the
  JSON-LD block and the wordmark use it. Administrators are trusted, but a
  script compiled into a static build is permanent in a way an
  administrator's mistake should not be.
- **Em dashes are refused on save.** `--` and `--` (smartypants turns the
  second into the first) return 422 with the reason shown in the panel. The
  house style forbids them, and `tests/no-em-dashes.test.ts` reads `src/`
  and `dist/` -- neither of which contains CMS text -- so the check has to
  happen where the text is written. Failing a deploy instead would turn an
  organiser's typo into a broken site.

The archiver gains the body: the part of `editions/<year>.md` after the
frontmatter, and `editions-tr/<year>.md`, created with a `year:` frontmatter
if it does not exist.

### Phase 4 -- sponsors

Prerequisite, its own pull request with no user-visible change:
`src/data/sponsors.ts` becomes a per-year JSON collection
(`src/content/sponsors/2023.json`) with the same shape as speakers,
sessions and committee. The current `editions: number[]` field disappears;
a sponsor appears in the file for each year it supported.

The shape is the point. Once it matches, the archiver writes sponsors as a
fourth kind for free and the panel repeats the form-above-a-table pattern it
already has three of. Any other shape means bespoke code on both sides.
`sponsors.test.ts` and `sponsors-per-edition.test.ts` are rewritten against
the new files.

Then: a `symposium_sponsors` table (`id`, `year`, `name`, `url`, `logo`,
`description`, `tier`, `sort`), a fourth panel section, a fourth overlay
list under the same "an empty list is no opinion" rule, and a fourth
`*ToJson` in the archiver.

## What every new field touches

Listed once, because it is the reason the work is phased rather than done at
once. Per field: a D1 column and the `wrangler d1 execute` line `db/schema.sql`
documents for it, `EditionRow`, `editionRowFromInput`, `rowToEditionInput`,
the public payload, `OverlaySchema`, `RepoContent`, `mergeOverlay`,
`withOverlayContent`, the panel markup, `admin-panel.ts`, i18n on **both**
sites, and the archiver. A bilingual field doubles the panel and i18n
entries.

## Deploy order

The two sites deploy independently and neither waits for the other. Zod
strips unknown keys rather than rejecting them, and every new field is
declared with a default, so a payload can gain a field before the symposium
site knows about it and the symposium site can learn a field before the
payload carries it. No ordering is required, in either direction.

## The archiver rewrites frontmatter

Today `renderArchive` only creates JSON files. From phase 1 it must also
update `editions/<year>.md`'s frontmatter, key by key, in the regex style
`extractDateField` already uses -- `^title:.*$` replaced in place, a missing
key appended.

Regenerating the YAML is not an option: `2026.md`'s frontmatter is mostly
hand-written comments explaining why `endDate` is set explicitly and why the
hall was absent until it was announced, and regeneration deletes all of it.

Without this, every detail typed into the panel is lost the day its edition
is archived.

## Starting a new edition

`loadCurrentContent` picks the upcoming year from the repo's own collection,
so a year with no `<year>.md` has nothing for the overlay to sit on, and
`archive.ts` already names `missing-edition-markdown` as a state. Creating
an edition therefore stays one committed stub carrying `year` and
`startDate`; everything after that is the panel.

## Testing

- `EditionLike` in `editions.ts` is a hand-written mirror of the schema in
  `content.config.ts`, and that file's own comment says nothing enforces the
  pairing. Half the new fields arrive through both. A test compares the two
  key lists.
- The same for the overlay: `symposium_edition`'s columns against
  `OverlaySchema` and `mergeOverlay`.
- The frontmatter rewrite is a pure function, tested against the real text of
  `2026.md`. Its real assertion is that the comments survive.
- A test that the public payload carries no hall while `venue_public = 0`.
- The rules in `symposium_website/src/lib/` must stay loadable under plain
  `node --test`, so nothing added there may import `astro:content`.
