# 13th Symposium (2026) and pre-indexing SEO — design

**Date:** 2026-09-02
**Status:** approved, ready for planning
**Scope:** parts A and B. Parts C and D are described only far enough to prove A does not block them; each gets its own spec.

## Context

The 13th RSG-Türkiye Student Symposium is on **10 October 2026** — 38 days from this
document. The symposium site (`symposium_website/`, Astro, static, deployed as the
`rsg-symposium` Cloudflare Pages project at `symposium.rsg-turkiye.iscbsc.org`)
currently advertises the **2024** event as if it were current, and we are about to
submit the site to Google Search Console.

### Why the site is stuck on 2024

There are two competing sources of edition data:

- `src/data/editions.ts` — a TypeScript array covering 2018–2024, with a hand-set
  `isLatest: true` boolean, exported as `latestEdition`.
- `src/content/editions/*.md` — an Astro content collection covering 2018–**2025**.

`index.astro` and `editions/` read the content collection, so they know about 2025.
`venue.astro` and `schedule.astro` read `latestEdition`, so they are frozen on 2024.
Someone added `2025.md` and did not move the `isLatest` flag; nothing failed, nothing
warned, and `/venue` served the wrong venue for a year.

**The flag is the bug.** Replacing it with a flag in a CMS form would only move the
step someone forgets from a file to a web page. The fix is to derive the lifecycle
from a real date so there is no step to forget.

## Goals

1. The site presents the 13th symposium correctly, in both languages, while nearly
   every detail is still unannounced — and keeps presenting it correctly, without
   human action, once 10 October passes.
2. Both sites are safe to submit to Google Search Console.
3. Close issue #43 (venue on homepage, committee page, program schedule).
4. Leave a data model that part C (CMS) extends rather than replaces.

## Non-goals

- The CMS itself (part C) and the automated archive PR (part D).
- Taking registration or abstract submissions on our own site. These go to an
  external form; the site holds only a link and a deadline.
- Redesigning the symposium site's visual language.
- Fixing the TR/EN page duplication (every page exists twice, differing only in
  import depth and `translationUrl`). Real, but out of scope; new pages follow the
  existing pattern rather than introducing a second one.

---

## Part A — the 13th edition

### A1. One source of truth, with a derived lifecycle

**Delete `src/data/editions.ts`.** The content collection becomes the only source of
edition data. Extend the schema in `src/content.config.ts`:

```ts
startDate: z.coerce.date().optional(),         // 2026-10-10
endDate: z.coerce.date().optional(),           // second workshop day, if it happens
titleTr: z.string().default(""),               // falls back to `title` when empty
subtitleTr: z.string().default(""),            // falls back to `subtitle` when empty
venuePublic: z.boolean().default(true),        // venue is known but not yet announced
registrationUrl: z.string().default(""),
abstractUrl: z.string().default(""),
registrationDeadline: z.coerce.date().optional(),
abstractDeadline: z.coerce.date().optional(),
```

`date` (the free-text string, e.g. `"October 2024"`) stays for display on archive
pages, because all eight existing files use it and it carries wording we do not want
to lose. `startDate` becomes the field anything computed reads. The theme goes in the
existing `subtitle` field rather than a new `theme` one — all eight archived
editions already carry their theme there, and a second field for the same thing
would immediately drift.

**`startDate` is optional on purpose.** Only the year is known for 2018–2023, and
inventing a day for them so a required field validates would put fabricated data in
the repo to satisfy a schema. Instead, an edition with no `startDate` is by
definition an archive entry. Only an edition we are actively announcing needs one.
2025 can be backfilled accurately (`2025-10-30`, `endDate: 2025-11-02`) from the date
string it already carries; the rest are left alone.

`isLatest` exists only in `src/data/editions.ts` — it was never part of the content
collection schema, and no markdown file sets it. Deleting that file removes it.

New helper, `src/lib/editions.ts`:

```ts
getUpcomingEdition()   // nearest edition whose startDate is today or later, else null
getPastEditions()      // everything else — past startDate, or none at all — newest year first
getEditionByYear(year)
```

"Today" is build time. A static build cannot notice a date passing on its own, so a
**nightly rebuild** keeps the derivation honest — see A5.

The moment 10 October passes, `2026` leaves `getUpcomingEdition()` and appears in
`getPastEditions()`. The homepage stops advertising an upcoming event, the CTAs
disappear, and the edition shows up in the archive. Nobody edits anything.

### A2. `content/editions/2026.md`

```yaml
year: 2026
title: "13th RSG-Türkiye Student Symposium"
titleTr: "13. RSG-Türkiye Öğrenci Sempozyumu"
subtitle: "Immunoinformatics and mRNA Therapeutics"
subtitleTr: "İmmünoinformatik ve mRNA Terapötikleri"
startDate: 2026-10-10
date: "10 October 2026"
venue: "METU U3 Amphitheatre"
venueCity: "Ankara"
venuePublic: false
posterImage: ""
```

The venue is recorded but `venuePublic: false`, so no page renders `venue` or
`venueCity` until the flag flips. This keeps the real value in version control
instead of in someone's memory, and announcing it is a one-word change.

`registrationUrl` and `abstractUrl` are left empty: the forms do not exist yet.

### A3. Empty states are the primary state, not a fallback

For the next month almost everything about this symposium is unannounced. Two rules
keep that from looking broken:

**A CTA renders only when its URL is set.** No greyed-out "Register (soon)" button
sitting there for five weeks. While `registrationUrl` and `abstractUrl` are both
empty, the hero shows one line — *"Registration and the call for abstracts open
soon"* / *"Kayıt ve bildiri çağrısı yakında açılacak"* — and nothing else. The
buttons appear the day the URLs are filled in, with no template change.

**A nav item renders only when its page has content.** Program and Speakers appear
in the header once the upcoming edition has at least one session or speaker;
Committee appears once committee data exists. This solves an existing bug in the
same stroke: `/schedule` and `/speakers` are built today but absent from
`Header.astro`'s `navLinks`, reachable only by typing the URL. It also means that
when part C lands, adding the first speaker through the CMS makes the nav item
appear by itself.

Pages that are reachable but empty (via direct URL, or a stale link) render an
explicit "announced closer to the date" state, never a bare empty container.

### A4. Pages

| Page | Change |
|---|---|
| `index.astro`, `tr/index.astro` | Hero stops showing the hardcoded "2026 · To be announced" badge and renders the upcoming edition: number, theme (`subtitle`), date, countdown, CTA block per A3. Adds a **venue block** (issue #43/1) that reads "to be announced" while `venuePublic` is false. |
| `venue.astro`, `tr/venue.astro` | Read `getUpcomingEdition()` instead of `latestEdition`. Respect `venuePublic`. Replace the placeholder pin SVG and the one-line "email us" travel section with real content once the venue is public. |
| `schedule.astro`, `tr/schedule.astro` | Read `getUpcomingEdition()`. Empty state while no sessions exist. `"schedule.subtitle"` in `i18n/ui.ts` is currently the hardcoded string `"2024 Symposium Schedule"` — it becomes derived from the edition. |
| `speakers.astro`, `tr/speakers.astro` | Same treatment. |
| `committee.astro`, `tr/committee.astro` | **New** (issue #43/2), backed by a new `src/data/committee.ts`. Ships with an empty roster — the list is not available yet — so the page and its nav item stay hidden until it is filled. |
| `Header.astro` | Conditional nav per A3. |

`Session` in `src/data/sessions.ts` gains `time: string` and optional `endTime`
(issue #43/3). A program without clock times is not a program. The 2024 rows keep
empty times; nothing displays a time it does not have.

### A5. Nightly rebuild

A Cloudflare Cron Worker, following `workers/mail-cron/`, calls the
`rsg-symposium` Pages deploy hook once a day. This is what makes the derivation in
A1 real rather than "correct as of the last time somebody pushed". It is also the
hook part C reuses to publish CMS edits.

---

## Part B — before submitting to Google

**B1. The stale `site` value (most important).** `symposium_website/astro.config.mjs`
line 5 reads `site: 'https://symposium.rsgturkey.com'`. `BaseLayout.astro` builds
`canonicalURL` from `Astro.site`, and `@astrojs/sitemap` builds every sitemap entry
from it. As it stands, every canonical tag, every `og:url`, and every sitemap URL
points at a domain whose DNS is parked (see
`docs/superpowers/specs/2026-08-31-send-as-rsg-design.md`). Submitting this to Search
Console would hand Google a sitemap of dead URLs. Change it to
`https://symposium.rsg-turkiye.iscbsc.org`.

**B2. `robots.txt`.** Neither site ships one; `symposium_website/public/` contains
only the logo directory. Add one per site, each pointing at its sitemap.

**B3. Real `hreflang`.** `BaseLayout.astro` line 44 emits
`<meta name="translation-url">`, which is not a standard and which Google ignores
entirely. The EN and TR pages are therefore not linked as alternates and are
candidates to be read as duplicates. Replace it with proper
`<link rel="alternate" hreflang="…">` pairs plus `x-default`. The main site solved
this on the `feat/hreflang-alternates` branch; reuse that approach.

**B4. `Event` structured data.** Add schema.org `Event` JSON-LD to the symposium
homepage, driven by the same edition data: name, `startDate`, `eventStatus`, and —
once `venuePublic` is true — `location`, plus `offers` pointing at the registration
URL once it exists. This is what produces the date/place/registration rich result
for an event query, and it costs one component.

**B5. Default `og:image`.** `BaseLayout.astro` line 19 falls back to the **2023**
poster. There is no 2026 poster yet, so the fallback becomes the neutral symposium
banner already used by the homepage hero, and switches to the poster when one exists.

**B6. Blog content cleanup — issue #68.** One duplicated TR post published under two
slugs, and 19 links to domains we no longer control (15 to the parked
`rsgturkey.com`, 4 to `iscbrsgturkey.wordpress.com`). Most are old internal links
whose targets survived the migration with their slugs intact, so they become
relative links; the two old symposium sites repoint at the new archive pages
(`/editions/2019`, `/editions/2020`); six unrecoverable WordPress gallery permalinks
are removed. Full mapping table lives in issue #68.

---

## Parts C and D — deferred, and why A does not block them

**C (symposium CMS).** Admin UI at `rsg-turkiye.iscbsc.org/admin/symposium`, reusing
the main site's Google OAuth, `sessions` table and `is_admin` / `is_announcer` roles
— no second login, no second user table. It holds only the **volatile** fields:
announcements, registration and abstract URLs and deadlines, speakers, program
times, committee. Archive editions stay as markdown in the repo, where their git
history is a feature and a CMS would be pure overhead for content written once a
year.

The symposium site fetches this at **build time** and inlines it into static HTML;
saving in the admin triggers the A5 deploy hook, so an edit is live in about a
minute. Build-time rather than runtime because a client-side fetch would leave the
speakers and the programme — the most-searched content on a conference site —
invisible to Google, which is the opposite of what part B is for.

**D (automated archive).** After 10 October, the nightly worker renders the merged
D1 state into `symposium_website/src/content/editions/2026.md`, opens a PR, and
marks the row archived. `functions/_lib/github.ts` already creates a branch, commits
files and opens a PR for blog submissions; generalising `openBlogPostPR` into
`openContentPR` is a small change. Merging the PR makes the archive permanent in
git and frees the CMS for the 14th symposium.

**The seam:** A writes these fields into markdown now. C moves the volatile subset
into D1 and overlays it on the markdown at build time. D writes the merged result
back to markdown and clears D1. A ships today without waiting for either.

## Open questions

1. **May the city be shown while the venue is not?** Decided for now: `venuePublic:
   false` hides `venue` and `venueCity` together, so no page says anything about
   location. This is the conservative reading of "we are not announcing the venue
   yet". Showing "Ankara" alone would help people plan travel without revealing the
   hall — if that is wanted, split the flag into `venuePublic` / `cityPublic`. One
   word to confirm either way.
2. **Second day.** A workshop day after the 10th is possible but unconfirmed, so
   `endDate` is left unset. Setting it later is a one-line change.
3. **Deadlines** for registration and abstracts are not yet decided.

## Acceptance

- [ ] `src/data/editions.ts` is deleted and nothing imports it
- [ ] No `isLatest` anywhere in the repo
- [ ] `/venue`, `/schedule`, `/speakers` show the 2026 edition, in both languages
- [ ] With the system clock set past 2026-10-10, a build moves 2026 into the archive
      and removes the CTAs, with no file edited
- [ ] No CTA button renders while its URL is empty
- [ ] No nav item links to a page with no content
- [ ] Built `sitemap-index.xml` contains only `symposium.rsg-turkiye.iscbsc.org` URLs
- [ ] Every page emits a canonical and reciprocal `hreflang` alternates
- [ ] The homepage validates as an `Event` in Google's Rich Results Test
- [ ] `grep -r "rsgturkey\.com" src/content/` returns nothing
