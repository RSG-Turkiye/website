# 13th Symposium (2026) and pre-indexing SEO — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present the 13th RSG-Türkiye Student Symposium (10 October 2026) correctly in both languages while nearly every detail is unannounced, keep it correct without human action once the date passes, and make both sites safe to submit to Google Search Console.

**Architecture:** Delete the hand-maintained `src/data/editions.ts` and make the Astro content collection the only source of edition data. Derive the upcoming/past split from a real `startDate` instead of an `isLatest` boolean, with the derivation living in pure, unit-tested functions in `symposium_website/src/lib/` that Astro pages call. A nightly Cloudflare Cron Worker rebuilds the static site so the derivation stays true.

**Tech Stack:** Astro 5 (static output), Tailwind 4, `@astrojs/sitemap`, Zod (via `astro:content`), `node:test` + `tsx` for unit tests, Cloudflare Pages + Cron Workers.

**Spec:** `docs/superpowers/specs/2026-09-02-symposium-2026-and-seo-design.md`

## Execution order

Tasks run **1, 2, 3, 4, 5, 7, 6, 8, 9, 10, 11**. Task 6's `BaseLayout` imports
`getCommitteeByEdition`, which Task 7 creates, so Task 7 goes first and Task 6
needs no stub. Task 7 does not depend on Task 6: its verification greps for a nav
link the pre-Task-6 header never emitted anyway.

## Global Constraints

- **Two projects, one repo.** The main site is the repo root (`rsg-website` Pages project, `https://rsg-turkiye.iscbsc.org`). The symposium site is `symposium_website/` (`rsg-symposium` Pages project, `https://symposium.rsg-turkiye.iscbsc.org`). Paths in this plan are relative to the repo root; `cd symposium_website` where a command targets that project.
- **Symposium canonical host is exactly `https://symposium.rsg-turkiye.iscbsc.org`** — no `www`, no trailing slash in the origin.
- **`rsgturkey.com` and `iscbrsgturkey.wordpress.com` are dead.** No new reference to either may enter the repo.
- **The hall must not leak.** While `venuePublic: false`, the string `U3` must not appear in built output. The city (`Ankara`) may.
- **Theme wording, verbatim:** EN `Immunoinformatics and mRNA Therapeutics`; TR `İmmünoinformatik ve mRNA Terapötikleri`.
- **Edition identity, verbatim:** EN `13th RSG-Türkiye Student Symposium`; TR `13. RSG-Türkiye Öğrenci Sempozyumu`. Date `2026-10-10`.
- **Every page exists twice** — `src/pages/x.astro` and `src/pages/tr/x.astro`, differing only in import depth and `translationUrl`. Follow that pattern; do not introduce a second one.
- **Pure logic goes in `src/lib/`, is exported, and is unit-tested.** Astro components consume it. This mirrors `src/lib/hreflang.ts` on the main site. Do not put branching logic in `.astro` frontmatter that could live in a tested function.
- **Tests are `node:test` + `assert/strict`**, run with `node --import tsx --test`. No new test framework.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `symposium_website/tests/editions.test.ts` | Lifecycle split, location visibility, CTA and nav rules |
| `symposium_website/tests/hreflang.test.ts` | EN/TR pairing for the symposium site |
| `symposium_website/src/lib/editions.ts` | Pure lifecycle + visibility rules, and the `astro:content` wrappers |
| `symposium_website/src/lib/hreflang.ts` | `alternatesFor()` for the symposium URL space |
| `symposium_website/src/content/editions/2026.md` | The 13th edition |
| `symposium_website/src/data/committee.ts` | Committee roster (ships empty) |
| `symposium_website/src/pages/committee.astro`, `tr/committee.astro` | Committee page |
| `symposium_website/src/components/EventJsonLd.astro` | schema.org `Event` |
| `symposium_website/src/components/EditionCta.astro` | Registration / abstract CTA block |
| `symposium_website/public/robots.txt`, `public/robots.txt` (main) | Crawl directives + sitemap pointer |
| `workers/symposium-cron/` | Nightly deploy-hook trigger |

**Deleted:** `symposium_website/src/data/editions.ts`, `src/content/blog/tr/rsg-turkiyeden-haberler-2017-2018.md`.

**Modified:** `symposium_website/src/content.config.ts`, `astro.config.mjs`, `package.json`, `src/layouts/BaseLayout.astro`, `src/components/Header.astro`, `src/i18n/ui.ts`, `src/data/sessions.ts`, and the six page pairs (`index`, `venue`, `schedule`, `speakers`, `editions/index`, `editions/[year]`). On the main site: `src/layouts/BaseLayout.astro`, plus the nine blog files in issue #68.

---

## Task 1: Test harness, canonical host, and robots.txt

The urgent, self-contained SEO fix. `symposium_website` has no test script; this task adds one, because every later task needs it.

**Files:**
- Modify: `symposium_website/package.json`
- Modify: `symposium_website/astro.config.mjs:5`
- Modify: `src/layouts/BaseLayout.astro:31` (main site)
- Create: `symposium_website/public/robots.txt`
- Create: `public/robots.txt` (main site)
- Create: `symposium_website/tests/seo.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test` inside `symposium_website`, used by every later task.

- [ ] **Step 1: Install dependencies and add the test script**

`symposium_website/node_modules` does not exist — nothing in that project has been run locally. Install first, or every later command in this plan fails:

```bash
cd symposium_website && npm install
```

Then add to its `package.json` `scripts` (`tsx` is already in `devDependencies`):

```json
"test": "node --import tsx --test tests/*.test.ts",
```

- [ ] **Step 2: Write the failing test**

Create `symposium_website/tests/seo.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const HOST = 'https://symposium.rsg-turkiye.iscbsc.org';

// Read as text, not imported. Importing astro.config.mjs under node:test pulls
// in Astro's config machinery and dies with ERR_PACKAGE_PATH_NOT_EXPORTED from
// a transitive dependency.
const config = readFileSync('astro.config.mjs', 'utf8');

test('the canonical host is the live symposium domain', () => {
  // Astro derives every canonical tag, og:url and sitemap entry from `site`.
  // Pointing it at the parked rsgturkey.com would hand Google a sitemap of
  // dead URLs.
  assert.ok(config.includes(`site: '${HOST}'`), 'site must be the live host');
});

test('no dead domain survives in the config', () => {
  assert.ok(!config.includes('rsgturkey.com'), 'rsgturkey.com is parked');
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `site` is `'https://symposium.rsgturkey.com'`.

- [ ] **Step 4: Fix the host**

In `symposium_website/astro.config.mjs`, line 5:

```js
  site: 'https://symposium.rsg-turkiye.iscbsc.org',
```

- [ ] **Step 5: Run it and watch it pass**

```bash
cd symposium_website && npm test
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Remove the dead fallback on the main site**

`src/layouts/BaseLayout.astro` line 31 currently falls back to the parked domain:

```js
const canonicalURL = new URL(Astro.url.pathname, Astro.site || 'https://rsgturkey.com');
```

`Astro.site` is always set in `astro.config.mjs`, so the fallback is unreachable today — but it is a landmine that would silently publish a dead canonical if anyone ever removed `site`. Replace with:

```js
const canonicalURL = new URL(Astro.url.pathname, Astro.site);
```

- [ ] **Step 7: Write both robots.txt files**

`symposium_website/public/robots.txt`:

```
User-agent: *
Allow: /

Sitemap: https://symposium.rsg-turkiye.iscbsc.org/sitemap-index.xml
```

`public/robots.txt` (main site) — the sign-in-gated pages already carry `noindex` via `isNoindexPath`, so this only advertises the sitemap:

```
User-agent: *
Allow: /

Sitemap: https://rsg-turkiye.iscbsc.org/sitemap-index.xml
```

- [ ] **Step 8: Verify the built sitemap**

```bash
cd symposium_website && npm run build && grep -c "symposium.rsg-turkiye.iscbsc.org" dist/sitemap-0.xml && grep -c "rsgturkey" dist/sitemap-0.xml || echo "no dead domain: good"
```

Expected: a positive count for the live host, and `grep` finding nothing for `rsgturkey`.

- [ ] **Step 9: Commit**

```bash
git add symposium_website/package.json symposium_website/astro.config.mjs \
        symposium_website/public/robots.txt symposium_website/tests/seo.test.ts \
        public/robots.txt src/layouts/BaseLayout.astro
git commit -m "fix: point the symposium site's canonical host at the live domain

Astro builds every canonical tag, og:url and sitemap entry from \`site\`,
which still read symposium.rsgturkey.com -- a domain whose DNS is parked.
Submitting that to Search Console would have handed Google a sitemap of
dead URLs.

Also drops the same dead domain as an unreachable fallback in the main
site's BaseLayout, and gives both sites a robots.txt pointing at their
sitemap."
```

---

## Task 2: Edition lifecycle, derived from a date

The heart of the design. Pure functions first, no page touched yet.

**Files:**
- Modify: `symposium_website/src/content.config.ts`
- Create: `symposium_website/src/lib/editions.ts` (pure — no astro imports)
- Create: `symposium_website/src/lib/editions-content.ts` (the `astro:content` wrappers)
- Create: `symposium_website/tests/editions.test.ts`

**Why two modules:** `astro:content` is a virtual module that exists only inside an Astro build. A test importing anything that *calls* `getCollection` dies with `Cannot find module 'astro:content'`. So every rule worth testing lives in `editions.ts` with no astro import, and the thin collection wrappers live beside it in `editions-content.ts`. The main site's `src/lib/hreflang.ts` is pure for the same reason.

**Interfaces:**
- Consumes: Task 1's test script.
- Produces, from `src/lib/editions.ts` (pure):
  - `interface EditionLike` — the structural shape the logic needs; the collection's `data` satisfies it.
  - `splitEditions(all: EditionLike[], now: Date): { upcoming: EditionLike | null; past: EditionLike[] }`
- Produces, from `src/lib/editions-content.ts`:
  - `getUpcomingEdition(now?: Date): Promise<CollectionEntry<'editions'> | null>`
  - `getPastEditions(now?: Date): Promise<CollectionEntry<'editions'>[]>`
  - `getEditionByYear(year: number): Promise<CollectionEntry<'editions'> | undefined>`

- [ ] **Step 1: Extend the collection schema**

In `symposium_website/src/content.config.ts`, add to the `editions` schema object, after `speakers`:

```ts
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    titleTr: z.string().default(""),
    subtitleTr: z.string().default(""),
    venuePublic: z.boolean().default(true),
    cityPublic: z.boolean().default(true),
    registrationUrl: z.string().default(""),
    abstractUrl: z.string().default(""),
    registrationDeadline: z.coerce.date().optional(),
    abstractDeadline: z.coerce.date().optional(),
```

`startDate` is optional on purpose: only the year is known for 2018–2023, and a required field would force fabricated dates into the repo. An edition without one is by definition an archive entry.

- [ ] **Step 2: Write the failing test**

Create `symposium_website/tests/editions.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitEditions, type EditionLike } from '../src/lib/editions';

function edition(year: number, startDate?: string, endDate?: string): EditionLike {
  return {
    year,
    title: `${year} symposium`,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
  } as EditionLike;
}

const ALL = [
  edition(2024),
  edition(2023),
  edition(2025, '2025-10-30', '2025-11-02'),
  edition(2026, '2026-10-10'),
];

test('the nearest future edition is the upcoming one', () => {
  const { upcoming } = splitEditions(ALL, new Date('2026-09-02T09:00:00Z'));
  assert.equal(upcoming?.year, 2026);
});

test('editions with no startDate are archive entries, never upcoming', () => {
  // 2018-2023 only ever recorded a year. Inventing a day for them so a
  // required field validates would put made-up data in the repo.
  const { upcoming, past } = splitEditions([edition(2024), edition(2023)], new Date('2020-01-01'));
  assert.equal(upcoming, null);
  assert.deepEqual(past.map(e => e.year), [2024, 2023]);
});

test('an edition stays current for the whole of its last day', () => {
  // The single most important case: on the afternoon of the symposium the
  // site must not have already archived it.
  const duringTheEvent = new Date('2026-10-10T14:00:00Z');
  assert.equal(splitEditions(ALL, duringTheEvent).upcoming?.year, 2026);
});

test('a multi-day edition stays current through its endDate', () => {
  const duringDayThree = new Date('2025-11-01T12:00:00Z');
  assert.equal(splitEditions(ALL, duringDayThree).upcoming?.year, 2025);
});

test('the morning after the last day, it has moved to the archive', () => {
  const { upcoming, past } = splitEditions(ALL, new Date('2026-10-11T09:00:00Z'));
  assert.equal(upcoming, null);
  assert.equal(past[0].year, 2026, 'the just-finished edition leads the archive');
});

test('past editions are newest first', () => {
  const { past } = splitEditions(ALL, new Date('2027-01-01'));
  assert.deepEqual(past.map(e => e.year), [2026, 2025, 2024, 2023]);
});

test('nothing is both upcoming and past', () => {
  for (const now of ['2026-09-02', '2026-10-10T14:00:00Z', '2026-10-11T09:00:00Z']) {
    const { upcoming, past } = splitEditions(ALL, new Date(now));
    if (upcoming) {
      assert.ok(!past.some(e => e.year === upcoming.year), `${upcoming.year} duplicated at ${now}`);
    }
    assert.equal(past.length + (upcoming ? 1 : 0), ALL.length, `an edition vanished at ${now}`);
  }
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `Cannot find module '../src/lib/editions'`.

- [ ] **Step 4: Implement the lifecycle**

Create `symposium_website/src/lib/editions.ts` — pure, no astro imports:

```ts
/**
 * The shape the edition rules need.
 *
 * Declared structurally rather than as CollectionEntry<"editions">["data"] so
 * this module stays importable from a plain node:test run: anything that
 * reaches astro:content cannot be unit tested, because that module only
 * exists inside an Astro build.
 */
export interface EditionLike {
  year: number;
  title: string;
  titleTr?: string;
  subtitle?: string;
  subtitleTr?: string;
  startDate?: Date;
  endDate?: Date;
  venue?: string;
  venueCity?: string;
  venuePublic?: boolean;
  cityPublic?: boolean;
  registrationUrl?: string;
  abstractUrl?: string;
  registrationDeadline?: Date;
  abstractDeadline?: Date;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The moment an edition stops being current: midnight after its last day.
 *
 * Comparing `startDate` against the clock directly would archive the
 * symposium at one minute past midnight on the morning it happens, so the
 * site would advertise it as over while people were still in the room.
 */
function endOfEvent(e: EditionLike): number {
  const last = e.endDate ?? e.startDate!;
  return last.getTime() + ONE_DAY_MS;
}

/**
 * Splits editions into the one we are currently announcing and the archive.
 *
 * Pure and `now`-injected so the transition can be tested without touching
 * the system clock. An edition with no `startDate` is always archive: only
 * the year is recorded for 2018-2023.
 */
export function splitEditions(
  all: EditionLike[],
  now: Date
): { upcoming: EditionLike | null; past: EditionLike[] } {
  const current = all
    .filter((e) => e.startDate && endOfEvent(e) > now.getTime())
    .sort((a, b) => a.startDate!.getTime() - b.startDate!.getTime());

  const upcoming = current[0] ?? null;

  const past = all
    .filter((e) => e !== upcoming)
    .sort((a, b) => b.year - a.year);

  return { upcoming, past };
}

```

Then create `symposium_website/src/lib/editions-content.ts` — the only file that touches the collection:

```ts
import { getCollection, type CollectionEntry } from "astro:content";
import { splitEditions } from "./editions";

export type EditionEntry = CollectionEntry<"editions">;

export async function getUpcomingEdition(now = new Date()): Promise<EditionEntry | null> {
  const entries = await getCollection("editions");
  const { upcoming } = splitEditions(entries.map((e) => e.data), now);
  return upcoming ? entries.find((e) => e.data.year === upcoming.year) ?? null : null;
}

export async function getPastEditions(now = new Date()): Promise<EditionEntry[]> {
  const entries = await getCollection("editions");
  const { past } = splitEditions(entries.map((e) => e.data), now);
  return past.map((d) => entries.find((e) => e.data.year === d.year)!);
}

export async function getEditionByYear(year: number): Promise<EditionEntry | undefined> {
  const entries = await getCollection("editions");
  return entries.find((e) => e.data.year === year);
}
```

Pages import the pure rules from `./editions` and the collection wrappers from `./editions-content`.

- [ ] **Step 5: Run the tests**

```bash
cd symposium_website && npm test
```

Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add symposium_website/src/content.config.ts symposium_website/src/lib/editions.ts \
        symposium_website/src/lib/editions-content.ts symposium_website/tests/editions.test.ts
git commit -m "feat: derive the current edition from a date, not a flag

/venue and /schedule froze on 2024 because they read a hand-set
isLatest boolean that nobody moved when 2025 was added. A flag in a CMS
form would only move the forgotten step somewhere else, so the split is
derived from a real startDate instead.

An edition stays current until midnight after its last day -- comparing
against startDate alone would archive the symposium at 00:01 on the
morning it happens."
```

---

## Task 3: Retire `data/editions.ts` and repoint every page

This is the task that stops the site serving 2024.

**Files:**
- Delete: `symposium_website/src/data/editions.ts`
- Modify: `symposium_website/src/pages/venue.astro`, `tr/venue.astro`, `schedule.astro`, `tr/schedule.astro`, `index.astro`, `tr/index.astro`, `editions/index.astro`, `tr/editions/index.astro`, `editions/[year].astro`, `tr/editions/[year].astro`
- Modify: `symposium_website/src/i18n/ui.ts`

**Interfaces:**
- Consumes: `getUpcomingEdition`, `getPastEditions` from Task 2.
- Produces: no page imports `../data/editions` any more.

- [ ] **Step 1: Find every consumer**

```bash
cd symposium_website && grep -rn "data/editions\|latestEdition" src/
```

Note each hit; every one must be gone by the end of this task.

- [ ] **Step 2: Repoint `venue.astro`**

Replace the import and the data source. Frontmatter becomes:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { useTranslations, getLangFromUrl } from "../i18n/ui";
import { getUpcomingEdition } from "../lib/editions-content";

const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
const edition = await getUpcomingEdition();
---
```

Every `latestEdition.x` in the body becomes `edition.data.x`, wrapped so a null edition (no upcoming symposium) renders the "check back" copy rather than crashing:

```astro
{edition ? (
  <!-- existing card markup, with edition.data.* -->
) : (
  <p class="text-gray-500 text-center py-12">{t("venue.none")}</p>
)}
```

Apply the same change to `tr/venue.astro`, adjusting import depth to `../../`.

- [ ] **Step 3: Repoint `schedule.astro` and kill the hardcoded year**

Same import swap. Then in `src/i18n/ui.ts`, `"schedule.subtitle"` is the literal string `"2024 Symposium Schedule"` — a second place 2024 is nailed down. Replace both language entries with a year-free string:

```ts
    "schedule.subtitle": "Programme",
```

```ts
    "schedule.subtitle": "Program",
```

and render the edition's own title and date beside it from `edition.data`.

- [ ] **Step 4: Repoint the remaining pages**

`index.astro` and `editions/index.astro` call `getCollection("editions")` and sort by year themselves, which would list the upcoming edition among the archive. In `index.astro` replace:

```astro
const allEditions = (await getCollection("editions")).sort(
  (a, b) => b.data.year - a.data.year
);
const recentEditions = allEditions.slice(0, 3);
```

with:

```astro
const recentEditions = (await getPastEditions()).slice(0, 3);
```

and drop the now-unused `getCollection` import. `editions/index.astro` becomes:

```astro
const pastEditions = await getPastEditions();
```

`editions/[year].astro` keeps using `getCollection` for `getStaticPaths` — every edition needs a page, archive or not — so it is left alone apart from removing any `latestEdition` reference.

Mirror all three into their `tr/` counterparts.

- [ ] **Step 5: Delete the old source**

```bash
cd symposium_website && rm src/data/editions.ts
grep -rn "data/editions\|latestEdition\|isLatest" src/ && echo "STILL REFERENCED -- fix before continuing" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 6: Build and confirm 2024 is gone from the live pages**

```bash
cd symposium_website && npm run build
grep -l "Mehmet Akif Ersoy" dist/venue/index.html dist/schedule/index.html 2>/dev/null \
  && echo "FAIL: 2024 venue still served" || echo "2024 no longer served as current"
```

- [ ] **Step 7: Commit**

```bash
git add -A symposium_website/src
git commit -m "fix: stop serving the 2024 symposium as the current one

/venue and /schedule read latestEdition from data/editions.ts, which was
frozen on 2024, while the homepage read the content collection and knew
about 2025. Two sources, and the pages people check for date and place
were reading the stale one.

data/editions.ts is deleted; the content collection is now the only
source. Also removes the hardcoded '2024 Symposium Schedule' subtitle."
```

---

## Task 4: The 13th edition, with the hall withheld

**Files:**
- Create: `symposium_website/src/content/editions/2026.md`
- Modify: `symposium_website/src/content/editions/2025.md`
- Modify: `symposium_website/src/lib/editions.ts`
- Modify: `symposium_website/tests/editions.test.ts`

**Interfaces:**
- Consumes: the Task 2 schema.
- Produces: `locationFor(data: EditionLike): LocationDisplay`, where

```ts
type LocationDisplay =
  | { kind: "full"; venue: string; city: string }
  | { kind: "city-only"; city: string }
  | { kind: "hidden" };
```

- [ ] **Step 1: Write the failing test**

Append to `symposium_website/tests/editions.test.ts`:

```ts
import { locationFor } from '../src/lib/editions';

const withVenue = (venuePublic: boolean, cityPublic: boolean) =>
  ({ venue: 'METU U3 Amphitheatre', venueCity: 'Ankara', venuePublic, cityPublic }) as EditionLike;

test('both public: hall and city are shown', () => {
  assert.deepEqual(locationFor(withVenue(true, true)),
    { kind: 'full', venue: 'METU U3 Amphitheatre', city: 'Ankara' });
});

test('city announced, hall withheld: the city goes out alone', () => {
  // People need "Ankara" to book travel weeks before we name the hall.
  assert.deepEqual(locationFor(withVenue(false, true)), { kind: 'city-only', city: 'Ankara' });
});

test('neither announced: nothing at all', () => {
  assert.deepEqual(locationFor(withVenue(false, false)), { kind: 'hidden' });
});

test('the hall never leaks through the city-only branch', () => {
  const shown = locationFor(withVenue(false, true));
  assert.ok(!JSON.stringify(shown).includes('U3'), 'the hall must not appear');
});

test('an edition with no venue recorded is hidden even when public', () => {
  assert.deepEqual(locationFor({ venue: '', venueCity: '', venuePublic: true, cityPublic: true } as EditionLike),
    { kind: 'hidden' });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `locationFor` is not exported.

- [ ] **Step 3: Implement `locationFor`**

Append to `symposium_website/src/lib/editions.ts`:

```ts
export type LocationDisplay =
  | { kind: "full"; venue: string; city: string }
  | { kind: "city-only"; city: string }
  | { kind: "hidden" };

/**
 * What a page may say about where the symposium is.
 *
 * Two independent flags because they answer different questions: the city
 * can be announced so people can plan travel while the hall is still
 * unannounced. Every page and the JSON-LD go through this one function, so
 * there is a single place the hall can leak from -- and one place to test.
 */
export function locationFor(e: EditionLike): LocationDisplay {
  const venue = e.venue?.trim() ?? "";
  const city = e.venueCity?.trim() ?? "";

  if (e.venuePublic && venue) {
    return { kind: "full", venue, city };
  }
  if (e.cityPublic && city) {
    return { kind: "city-only", city };
  }
  return { kind: "hidden" };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd symposium_website && npm test
```

Expected: PASS, 14 tests.

- [ ] **Step 5: Write the edition**

Create `symposium_website/src/content/editions/2026.md`:

```markdown
---
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
cityPublic: true
posterImage: ""
galleryImages: []
speakers: []
---

The 13th RSG-Türkiye Student Symposium takes place on 10 October 2026, on the theme
of immunoinformatics and mRNA therapeutics.

Speakers, the programme and the call for abstracts will be announced here.
```

`registrationUrl` and `abstractUrl` are deliberately absent: the forms do not exist yet, and the schema defaults them to `""`, which Task 5 reads as "render no button".

- [ ] **Step 6: Backfill 2025's real dates**

`2025.md` already carries `date: "October 30 – November 2, 2025"`, so its start and end are known exactly and can be recorded without inventing anything. Add to its frontmatter:

```yaml
startDate: 2025-10-30
endDate: 2025-11-02
```

Leave 2018–2024 alone — only their year is known.

- [ ] **Step 7: Build and confirm the hall is not in the output**

```bash
cd symposium_website && npm run build
grep -ri "U3" dist/ && echo "FAIL: the hall leaked" || echo "hall withheld"
grep -rl "Ankara" dist/ | head -3
```

Expected: no `U3` anywhere; `Ankara` present.

- [ ] **Step 8: Commit**

```bash
git add symposium_website/src/content/editions/2026.md \
        symposium_website/src/content/editions/2025.md \
        symposium_website/src/lib/editions.ts symposium_website/tests/editions.test.ts
git commit -m "feat: add the 13th symposium, with the hall withheld

The venue is decided but not being announced yet, while the city is
useful now -- people book travel weeks ahead. One boolean could not
express that, so visibility is two independent flags and every page
reads the location through a single locationFor(), which is where the
test asserts the hall cannot leak.

2025's start and end dates are backfilled from the date string it
already carried. 2018-2024 are left alone: only their year is known,
and inventing days to satisfy a schema would put fiction in the repo."
```

---

## Task 5: Hero — the upcoming edition, and CTAs that only exist when real

**Files:**
- Create: `symposium_website/src/components/EditionCta.astro`
- Modify: `symposium_website/src/pages/index.astro:47-70`, `tr/index.astro`
- Modify: `symposium_website/src/i18n/ui.ts`
- Modify: `symposium_website/tests/editions.test.ts`

**Interfaces:**
- Consumes: `getUpcomingEdition`, `locationFor`.
- Produces: `ctasFor(e: EditionLike): Array<{ kind: 'registration' | 'abstract'; url: string; deadline?: Date }>`

- [ ] **Step 1: Write the failing test**

Append to `symposium_website/tests/editions.test.ts`:

```ts
import { ctasFor } from '../src/lib/editions';

test('no CTA is offered while no form exists', () => {
  // A greyed-out "Register (soon)" button sitting there for five weeks
  // reads as broken, so the button is absent until the URL is real.
  assert.deepEqual(ctasFor({ registrationUrl: '', abstractUrl: '' } as EditionLike), []);
});

test('each CTA appears independently as its URL is filled in', () => {
  const only = ctasFor({ registrationUrl: '', abstractUrl: 'https://forms.gle/abs' } as EditionLike);
  assert.equal(only.length, 1);
  assert.equal(only[0].kind, 'abstract');
  assert.equal(only[0].url, 'https://forms.gle/abs');
});

test('registration is listed before abstracts when both are open', () => {
  const both = ctasFor({
    registrationUrl: 'https://forms.gle/reg',
    abstractUrl: 'https://forms.gle/abs',
  } as EditionLike);
  assert.deepEqual(both.map(c => c.kind), ['registration', 'abstract']);
});

test('a deadline rides along with its CTA', () => {
  const [cta] = ctasFor({
    registrationUrl: 'https://forms.gle/reg',
    registrationDeadline: new Date('2026-10-01'),
    abstractUrl: '',
  } as EditionLike);
  assert.equal(cta.deadline?.toISOString().slice(0, 10), '2026-10-01');
});

test('whitespace is not a URL', () => {
  assert.deepEqual(ctasFor({ registrationUrl: '   ', abstractUrl: '' } as EditionLike), []);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `ctasFor` is not exported.

- [ ] **Step 3: Implement `ctasFor`**

Append to `symposium_website/src/lib/editions.ts`:

```ts
export interface Cta {
  kind: "registration" | "abstract";
  url: string;
  deadline?: Date;
}

/**
 * The calls to action an edition can currently offer.
 *
 * A CTA exists only when its URL does. For the weeks between announcing
 * the symposium and opening the forms, the hero shows a single "opens
 * soon" line instead of disabled buttons -- and the day the URL lands, the
 * button appears with no template change.
 */
export function ctasFor(e: EditionLike): Cta[] {
  const ctas: Cta[] = [];
  const reg = e.registrationUrl?.trim();
  const abs = e.abstractUrl?.trim();
  if (reg) ctas.push({ kind: "registration", url: reg, deadline: e.registrationDeadline });
  if (abs) ctas.push({ kind: "abstract", url: abs, deadline: e.abstractDeadline });
  return ctas;
}
```

- [ ] **Step 4: Run the tests**

```bash
cd symposium_website && npm test
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Add the copy**

In `src/i18n/ui.ts`, English block:

```ts
    "cta.register": "Register",
    "cta.abstract": "Submit an Abstract",
    "cta.soon": "Registration and the call for abstracts open soon.",
    "cta.deadline": "Deadline: {date}",
    "venue.tba": "Venue to be announced",
    "venue.none": "The next symposium will be announced here.",
```

Turkish block:

```ts
    "cta.register": "Kayıt Ol",
    "cta.abstract": "Bildiri Gönder",
    "cta.soon": "Kayıt ve bildiri çağrısı yakında açılacak.",
    "cta.deadline": "Son tarih: {date}",
    "venue.tba": "Yer yakında açıklanacak",
    "venue.none": "Bir sonraki sempozyum burada duyurulacak.",
```

Note `hero.cta.register` already exists in `ui.ts` and is referenced nowhere; delete it rather than leaving two keys for one button.

- [ ] **Step 6: Build the CTA component**

Create `symposium_website/src/components/EditionCta.astro`:

```astro
---
import { ctasFor, type EditionLike } from "../lib/editions";
import { useTranslations, type Lang } from "../i18n/ui";

interface Props { edition: EditionLike; lang: Lang }
const { edition, lang } = Astro.props;
const t = useTranslations(lang);
const ctas = ctasFor(edition);
const locale = lang === "tr" ? "tr-TR" : "en-GB";
---

{ctas.length === 0 ? (
  <p class="text-white/70 text-sm mt-2">{t("cta.soon")}</p>
) : (
  <div class="flex flex-wrap justify-center gap-4 mt-2">
    {ctas.map((cta) => (
      <a
        href={cta.url}
        target="_blank"
        rel="noopener noreferrer"
        class:list={[
          "px-6 py-3 rounded-lg font-semibold text-sm transition-colors",
          cta.kind === "registration"
            ? "bg-red text-white hover:bg-red/90"
            : "bg-white text-navy hover:bg-navy-light",
        ]}
      >
        {t(cta.kind === "registration" ? "cta.register" : "cta.abstract")}
        {cta.deadline && (
          <span class="block text-xs font-normal opacity-80">
            {t("cta.deadline").replace("{date}", cta.deadline.toLocaleDateString(locale))}
          </span>
        )}
      </a>
    ))}
  </div>
)}
```

- [ ] **Step 7: Rework the hero**

Add to `index.astro`'s frontmatter:

```astro
import EditionCta from "../components/EditionCta.astro";
import { getUpcomingEdition, getPastEditions } from "../lib/editions-content";
import { locationFor } from "../lib/editions";

const upcoming = await getUpcomingEdition();
const heading = upcoming
  ? (lang === "tr" && upcoming.data.titleTr) || upcoming.data.title
  : "";
const theme = upcoming
  ? (lang === "tr" && upcoming.data.subtitleTr) || upcoming.data.subtitle
  : "";
const place = upcoming ? locationFor(upcoming.data) : { kind: "hidden" as const };
const startsAt = upcoming?.data.startDate?.toISOString() ?? "";
```

Replace the hardcoded badge block (lines 47–70, the `<!-- 2026 TBA badge -->` div) with:

```astro
{upcoming && (
  <div class="flex flex-col items-center gap-3 mt-2">
    <h2 class="text-2xl sm:text-3xl font-bold">{heading}</h2>
    {theme && <p class="text-white/80 text-lg max-w-2xl">{theme}</p>}
    <p class="text-white/90 font-medium">
      {upcoming.data.startDate?.toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB", {
        day: "numeric", month: "long", year: "numeric",
      })}
    </p>
    <p class="text-white/70 text-sm">
      {place.kind === "full" && `${place.venue}, ${place.city}`}
      {place.kind === "city-only" && `${place.city} · ${t("venue.tba")}`}
    </p>
    <p id="countdown" class="text-white/60 text-sm tabular-nums" data-starts-at={startsAt}></p>
    <EditionCta edition={upcoming.data} lang={lang} />
  </div>
)}
```

The countdown is progressive enhancement — the date above it is already in the HTML, so a reader with no JavaScript loses nothing. At the end of the file:

```astro
<script>
  const el = document.getElementById("countdown");
  const startsAt = el?.dataset.startsAt;
  if (el && startsAt) {
    const target = new Date(startsAt).getTime();
    const tick = () => {
      const days = Math.ceil((target - Date.now()) / 86_400_000);
      el.textContent = days > 0 ? `${days}` : "";
    };
    tick();
    setInterval(tick, 60_000);
  }
</script>
```

Wrap the day count in the localised label of your choice via a `data-` attribute rather than hardcoding English in the script.

When `upcoming` is null the block renders nothing and the existing about-and-archive sections carry the page — no CTA, no countdown, no stale event.

Mirror into `tr/index.astro` with `../../` import depth.

- [ ] **Step 8: Verify in the browser**

```bash
cd symposium_website && npm run dev
```

Check `/` and `/tr/`: the 13th symposium, its theme, 10 October 2026, a countdown, "Ankara · venue to be announced", and one "opens soon" line with **no buttons**.

- [ ] **Step 9: Commit**

```bash
git add symposium_website/src/components/EditionCta.astro symposium_website/src/pages/index.astro \
        symposium_website/src/pages/tr/index.astro symposium_website/src/i18n/ui.ts \
        symposium_website/src/lib/editions.ts symposium_website/tests/editions.test.ts
git commit -m "feat: put the 13th symposium in the hero

Replaces a hardcoded '2026 - To be announced' badge with the real
edition: theme, date, countdown, city, and a CTA block that renders
nothing but an 'opens soon' line until the form URLs exist.

For the next five weeks almost everything about this symposium is
unannounced, so that state is the design rather than a fallback -- no
disabled buttons waiting to be enabled."
```

---

## Task 6: Conditional navigation and honest empty states

**Files:**
- Modify: `symposium_website/src/components/Header.astro:17-22`
- Modify: `symposium_website/src/pages/schedule.astro`, `tr/schedule.astro`, `speakers.astro`, `tr/speakers.astro`
- Modify: `symposium_website/src/data/sessions.ts`
- Modify: `symposium_website/src/components/SessionRow.astro`
- Modify: `symposium_website/src/i18n/ui.ts`
- Create: `symposium_website/tests/nav.test.ts`

**Interfaces:**
- Consumes: `getUpcomingEdition`.
- Produces: `navItemsFor(state: NavState, lang: Lang): NavItem[]` where `NavState = { hasSchedule: boolean; hasSpeakers: boolean; hasCommittee: boolean }` and `NavItem = { href: string; labelKey: string }`. `Lang` is imported from `../i18n/ui` — do not redeclare it, or the two definitions will drift.

- [ ] **Step 1: Write the failing test**

Create `symposium_website/tests/nav.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { navItemsFor } from '../src/lib/nav';

const EMPTY = { hasSchedule: false, hasSpeakers: false, hasCommittee: false };
const FULL = { hasSchedule: true, hasSpeakers: true, hasCommittee: true };

test('home, editions, venue and sponsors are always offered', () => {
  const hrefs = navItemsFor(EMPTY, 'en').map(i => i.href);
  assert.deepEqual(hrefs, ['/', '/editions', '/venue', '/sponsors']);
});

test('no nav item points at a page with nothing on it', () => {
  const hrefs = navItemsFor(EMPTY, 'en').map(i => i.href);
  for (const empty of ['/schedule', '/speakers', '/committee']) {
    assert.ok(!hrefs.includes(empty), `${empty} is empty and must not be linked`);
  }
});

test('a section appears in the nav as soon as it has content', () => {
  const hrefs = navItemsFor(FULL, 'en').map(i => i.href);
  for (const filled of ['/schedule', '/speakers', '/committee']) {
    assert.ok(hrefs.includes(filled), `${filled} has content and must be linked`);
  }
});

test('sections appear independently of one another', () => {
  const hrefs = navItemsFor({ ...EMPTY, hasSpeakers: true }, 'en').map(i => i.href);
  assert.ok(hrefs.includes('/speakers'));
  assert.ok(!hrefs.includes('/schedule'));
});

test('turkish nav is the same set under the /tr prefix', () => {
  const en = navItemsFor(FULL, 'en').map(i => i.href);
  const tr = navItemsFor(FULL, 'tr').map(i => i.href);
  assert.deepEqual(tr, en.map(h => (h === '/' ? '/tr/' : '/tr' + h)));
});

test('schedule and speakers are reachable once filled -- they are built either way', () => {
  // Both pages already existed and were built, but Header.astro never
  // linked them: reachable only by typing the URL.
  assert.ok(navItemsFor(FULL, 'en').some(i => i.href === '/schedule'));
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — `Cannot find module '../src/lib/nav'`.

- [ ] **Step 3: Implement**

Create `symposium_website/src/lib/nav.ts`:

```ts
import type { Lang } from "../i18n/ui";

export interface NavState {
  hasSchedule: boolean;
  hasSpeakers: boolean;
  hasCommittee: boolean;
}

export interface NavItem {
  href: string;
  labelKey: string;
}

/**
 * The header links, derived from what actually has content.
 *
 * /schedule and /speakers were built but never linked, so they were
 * reachable only by typing the URL. Listing them unconditionally would
 * swap that for three nav items leading to empty pages, which is worse.
 * Deriving from content means the item appears by itself the moment the
 * first speaker or session lands -- the same "derive, don't flag" rule
 * the edition lifecycle follows.
 */
export function navItemsFor(state: NavState, lang: Lang): NavItem[] {
  const items: NavItem[] = [
    { href: "/", labelKey: "nav.home" },
    { href: "/editions", labelKey: "nav.editions" },
  ];
  if (state.hasSchedule) items.push({ href: "/schedule", labelKey: "nav.schedule" });
  if (state.hasSpeakers) items.push({ href: "/speakers", labelKey: "nav.speakers" });
  items.push({ href: "/venue", labelKey: "nav.venue" });
  if (state.hasCommittee) items.push({ href: "/committee", labelKey: "nav.committee" });
  items.push({ href: "/sponsors", labelKey: "nav.sponsors" });

  if (lang === "tr") {
    return items.map((i) => ({ ...i, href: i.href === "/" ? "/tr/" : "/tr" + i.href }));
  }
  return items;
}
```

Note the test asserts the base four in the order `/`, `/editions`, `/venue`, `/sponsors`; the conditional items slot in between, so with `EMPTY` the result is exactly that list.

- [ ] **Step 4: Run the tests**

```bash
cd symposium_website && npm test
```

Expected: PASS.

- [ ] **Step 5: Wire the header**

`BaseLayout.astro` computes the state once and passes it down. In its frontmatter:

```astro
import { getUpcomingEdition } from "../lib/editions-content";
import { getSessionsByEdition } from "../data/sessions";
import { getSpeakersByEdition } from "../data/speakers";
import { getCommitteeByEdition } from "../data/committee";
import type { NavState } from "../lib/nav";

const upcoming = await getUpcomingEdition();
const year = upcoming?.data.year ?? 0;
const navState: NavState = {
  hasSchedule: getSessionsByEdition(year).length > 0,
  hasSpeakers: getSpeakersByEdition(year).length > 0,
  hasCommittee: getCommitteeByEdition(year).length > 0,
};
```

and pass it through: `<Header lang={lang} translationUrl={translationUrl} navState={navState} />`.

In `Header.astro`, replace the hardcoded `navLinks` array (lines 17–22) with:

```astro
import { navItemsFor, type NavState } from "../lib/nav";

interface Props {
  lang: Lang;
  translationUrl?: string;
  navState: NavState;
}

const { lang, translationUrl, navState } = Astro.props;
const navLinks = navItemsFor(navState, lang);
```

Both the desktop nav and the mobile menu then map over `navLinks` using `t(link.labelKey)` for the label and `link.href` for the target, dropping the `anchor` field — nothing uses it. Add `"nav.committee": "Committee"` / `"Komite"` to `ui.ts`.

`getCommitteeByEdition` comes from Task 7, which runs before this task — import it directly. Do not stub `hasCommittee`: a stub here would ship, because nothing later in the plan removes it.

- [ ] **Step 6: Give sessions a time**

In `src/data/sessions.ts`, add to the `Session` interface:

```ts
  /** Clock time, e.g. "09:30". Empty on archived editions where it was never recorded. */
  time: string;
  endTime?: string;
```

Add `time: ""` to all sixteen 2024 rows. In `SessionRow.astro`, render the time only when non-empty — nothing displays a time it does not have.

- [ ] **Step 7: Empty states**

`schedule.astro` and `speakers.astro` render, when the upcoming edition has no sessions or speakers:

```astro
<p class="text-gray-500 text-center py-16">{t("schedule.tba")}</p>
```

with `"schedule.tba": "The programme will be published closer to the date."` / `"Program, tarihe yaklaştıkça yayınlanacak."` and the speakers equivalent. Never a bare empty container: these pages stay reachable by URL and by old links.

- [ ] **Step 8: Verify**

```bash
cd symposium_website && npm run build
grep -o 'href="/schedule"' dist/index.html && echo "FAIL: empty page linked" || echo "empty pages unlinked"
test -f dist/schedule/index.html && echo "still built and reachable: good"
```

- [ ] **Step 9: Commit**

```bash
git add -A symposium_website/src symposium_website/tests
git commit -m "feat: derive the nav from what has content, and add session times

/schedule and /speakers were built but missing from Header.astro's
navLinks -- reachable only by typing the URL. Listing them
unconditionally would have replaced that with nav items leading to
empty pages, so the header is derived from content instead: an item
appears the moment its section has something in it.

Session gains a time field; a programme without clock times is not a
programme. The 2024 rows keep empty times and render none."
```

---

## Task 7: Committee page

**Files:**
- Create: `symposium_website/src/data/committee.ts`
- Create: `symposium_website/src/pages/committee.astro`, `tr/committee.astro`
- Modify: `symposium_website/src/i18n/ui.ts`

**Interfaces:**
- Consumes: `navItemsFor` (Task 6) reads `hasCommittee`.
- Produces: `committee: CommitteeMember[]`, `getCommitteeByEdition(year: number): CommitteeMember[]`.

- [ ] **Step 1: Create the data module**

The roster is not available yet, so it ships empty — which, by Task 6's rule, keeps the page out of the nav until it is filled.

```ts
export interface CommitteeMember {
  name: string;
  role: string;
  roleTr: string;
  affiliation: string;
  photo: string;
  linkedin?: string;
  /** Which edition year(s) this person served for. */
  editions: number[];
}

/**
 * Empty until the 2026 roster is confirmed. The page and its nav item stay
 * hidden while this is empty -- see src/lib/nav.ts -- so adding the first
 * entry publishes the section with no other change.
 */
export const committee: CommitteeMember[] = [];

export function getCommitteeByEdition(year: number): CommitteeMember[] {
  return committee.filter((m) => m.editions.includes(year));
}
```

- [ ] **Step 2: Build the page**

Create `symposium_website/src/pages/committee.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import { useTranslations, getLangFromUrl } from "../i18n/ui";
import { getUpcomingEdition } from "../lib/editions-content";
import { getCommitteeByEdition } from "../data/committee";

const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
const edition = await getUpcomingEdition();
const members = getCommitteeByEdition(edition?.data.year ?? 0);
---

<BaseLayout
  pageTitle={t("committee.title")}
  translationUrl={lang === "en" ? "/tr/committee" : "/committee"}
>
  <section class="bg-navy text-white py-16">
    <div class="max-w-7xl mx-auto px-6 text-center">
      <h1 class="text-3xl sm:text-4xl font-bold mb-3">{t("committee.title")}</h1>
      <p class="text-white/70 text-lg">{t("committee.subtitle")}</p>
    </div>
  </section>

  <div class="max-w-5xl mx-auto px-6 py-16">
    {members.length === 0 ? (
      <p class="text-gray-500 text-center py-16">{t("committee.tba")}</p>
    ) : (
      <div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {members.map((m) => (
          <div class="bg-white rounded-xl border border-border p-5 text-center">
            {m.photo && (
              <img src={m.photo} alt={m.name} loading="lazy"
                   class="w-24 h-24 rounded-full object-cover mx-auto mb-3" />
            )}
            <h3 class="font-semibold text-navy">{m.name}</h3>
            <p class="text-sm text-navy-mid">{(lang === "tr" && m.roleTr) || m.role}</p>
            {m.affiliation && <p class="text-xs text-gray-500 mt-1">{m.affiliation}</p>}
            {m.linkedin && (
              <a href={m.linkedin} target="_blank" rel="noopener noreferrer"
                 class="text-xs text-navy-mid hover:text-navy mt-2 inline-block">LinkedIn</a>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
</BaseLayout>
```

`tr/committee.astro` is the same file with `../../` import depth and `translationUrl="/committee"`.

Add to `ui.ts`:

```ts
    "committee.title": "Organising Committee",
    "committee.subtitle": "The team behind the symposium.",
    "committee.tba": "The organising committee will be announced soon.",
```

```ts
    "committee.title": "Düzenleme Kurulu",
    "committee.subtitle": "Sempozyumun arkasındaki ekip.",
    "committee.tba": "Düzenleme kurulu yakında duyurulacak.",
```

- [ ] **Step 3: Verify**

```bash
cd symposium_website && npm run build
test -f dist/committee/index.html && test -f dist/tr/committee/index.html && echo "both built"
grep -o 'href="/committee"' dist/index.html && echo "FAIL: linked while empty" || echo "unlinked while empty: correct"
```

- [ ] **Step 4: Commit**

```bash
git add symposium_website/src/data/committee.ts symposium_website/src/pages/committee.astro \
        symposium_website/src/pages/tr/committee.astro symposium_website/src/i18n/ui.ts
git commit -m "feat: add the committee page (issue #43)

Ships with an empty roster because the 2026 list is not confirmed yet.
The nav rule from the previous commit keeps the page unlinked until
someone adds the first member, at which point the section publishes
itself."
```

---

## Task 8: hreflang and `Event` structured data

**Files:**
- Create: `symposium_website/src/lib/hreflang.ts`, `symposium_website/tests/hreflang.test.ts`
- Create: `symposium_website/src/components/EventJsonLd.astro`
- Modify: `symposium_website/src/layouts/BaseLayout.astro:19,44`
- Modify: `symposium_website/src/pages/index.astro`, `tr/index.astro`

**Interfaces:**
- Consumes: `locationFor` (Task 4), `ctasFor` (Task 5).
- Produces: `alternatesFor(pathname: string): { en: string; tr: string } | null`

- [ ] **Step 1: Write the failing test**

Create `symposium_website/tests/hreflang.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alternatesFor } from '../src/lib/hreflang';

test('every mirrored page is paired with its counterpart', () => {
  assert.deepEqual(alternatesFor('/venue/'), { en: '/venue/', tr: '/tr/venue/' });
  assert.deepEqual(alternatesFor('/schedule/'), { en: '/schedule/', tr: '/tr/schedule/' });
  assert.deepEqual(alternatesFor('/committee/'), { en: '/committee/', tr: '/tr/committee/' });
  assert.deepEqual(alternatesFor('/editions/2024/'), { en: '/editions/2024/', tr: '/tr/editions/2024/' });
});

test('the pairing is reciprocal, or Google ignores it', () => {
  for (const [en, tr] of [['/', '/tr/'], ['/venue/', '/tr/venue/'], ['/sponsors/', '/tr/sponsors/']]) {
    assert.deepEqual(alternatesFor(en), alternatesFor(tr), `${en} and ${tr} must agree`);
  }
});

test('the home pages pair with each other', () => {
  assert.deepEqual(alternatesFor('/'), { en: '/', tr: '/tr/' });
  assert.deepEqual(alternatesFor('/tr'), { en: '/', tr: '/tr/' });
});

test('404 has no counterpart', () => {
  assert.equal(alternatesFor('/404'), null);
});

test('trailing slashes do not change the answer', () => {
  assert.deepEqual(alternatesFor('/venue'), alternatesFor('/venue/'));
});

test('a path merely starting with tr is not the turkish prefix', () => {
  assert.deepEqual(alternatesFor('/transcriptomics/'), { en: '/transcriptomics/', tr: '/tr/transcriptomics/' });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd symposium_website && npm test
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `symposium_website/src/lib/hreflang.ts`. Every symposium page except `/404` is mirrored, so the rule is simpler than the main site's:

```ts
/**
 * The EN/TR pair for a page, for hreflang link tags.
 *
 * BaseLayout previously emitted <meta name="translation-url">, which is
 * not a standard and which Google ignores entirely -- so the two language
 * versions were never linked as alternates and were candidates to be read
 * as duplicates of each other.
 */
const UNPAIRED_PATHS: readonly string[] = ["/404"];

export interface Alternates {
  en: string;
  tr: string;
}

function bare(pathname: string): string {
  return pathname.replace(/\/$/, "") || "/";
}

function withSlash(path: string): string {
  return path === "/" ? "/" : path + "/";
}

export function alternatesFor(pathname: string): Alternates | null {
  const path = bare(pathname);
  const en = path.replace(/^\/tr(?=\/|$)/, "") || "/";
  if (UNPAIRED_PATHS.includes(en)) return null;
  return { en: withSlash(en), tr: withSlash(en === "/" ? "/tr" : "/tr" + en) };
}
```

- [ ] **Step 4: Run the tests**

```bash
cd symposium_website && npm test
```

Expected: PASS.

- [ ] **Step 5: Replace the fake tag in BaseLayout**

Delete line 44 (`{translationUrl && <meta name="translation-url" … />}`) and emit real alternates. `translationUrl` stays as a prop — `Header.astro` uses it for the language switcher — but it no longer pretends to be an SEO signal:

```astro
{alternates && (
  <>
    <link rel="alternate" hreflang="en" href={new URL(alternates.en, Astro.site).href} />
    <link rel="alternate" hreflang="tr" href={new URL(alternates.tr, Astro.site).href} />
    <link rel="alternate" hreflang="x-default" href={new URL(alternates.en, Astro.site).href} />
  </>
)}
```

- [ ] **Step 6: Fix the default og:image**

Line 19 falls back to the **2023** poster. There is no 2026 poster, so fall back to the banner the homepage hero already uses:

```ts
const ogImage = image || "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606559/rsgturkey/symposium/2021/05/RSG_symposium_banner-scaled.jpg";
```

- [ ] **Step 7: Add the Event JSON-LD**

Create `symposium_website/src/components/EventJsonLd.astro`:

```astro
---
import { locationFor, ctasFor, type EditionLike } from "../lib/editions";
import type { Lang } from "../i18n/ui";

interface Props { edition: EditionLike; url: string; lang: Lang }
const { edition, url, lang } = Astro.props;

// The Turkish page must not publish English structured data, so name and
// description follow the same titleTr/subtitleTr preference the hero uses.
const name = (lang === "tr" && edition.titleTr) || edition.title;
const description = (lang === "tr" && edition.subtitleTr) || edition.subtitle;

const place = locationFor(edition);
const registration = ctasFor(edition).find((c) => c.kind === "registration");

const location =
  place.kind === "full"
    ? { "@type": "Place", name: place.venue, address: { "@type": "PostalAddress", addressLocality: place.city, addressCountry: "TR" } }
    : place.kind === "city-only"
      ? { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: place.city, addressCountry: "TR" } }
      : undefined;

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "Event",
  name,
  ...(description && { description }),
  inLanguage: lang,
  startDate: edition.startDate?.toISOString().slice(0, 10),
  ...(edition.endDate && { endDate: edition.endDate.toISOString().slice(0, 10) }),
  eventStatus: "https://schema.org/EventScheduled",
  eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
  organizer: { "@type": "Organization", name: "ISCB SC RSG-Türkiye", url: "https://rsg-turkiye.iscbsc.org" },
  url,
  ...(location && { location }),
  ...(registration && { offers: { "@type": "Offer", url: registration.url, availability: "https://schema.org/InStock" } }),
};
---

<script type="application/ld+json" set:html={JSON.stringify(jsonLd)} />
```

`location` goes through `locationFor`, so the hall cannot leak into structured data either — while `venuePublic` is false Google gets `addressLocality: "Ankara"` and no `name`.

Render it from `index.astro` and `tr/index.astro` when an upcoming edition exists, passing `lang`:

```astro
{upcoming && <EventJsonLd edition={upcoming.data} url={canonical} lang={lang} />}
```

- [ ] **Step 8: Verify**

```bash
cd symposium_website && npm run build
grep -o 'hreflang="[a-z-]*"' dist/venue/index.html | sort -u
grep -o '"@type":"Event"' dist/index.html
grep -ri "U3" dist/ && echo "FAIL: hall leaked into structured data" || echo "hall still withheld"
grep -o "Ankara" dist/index.html | head -1
```

Also confirm the Turkish page publishes Turkish structured data:

```bash
grep -o '"name":"[^"]*"' dist/tr/index.html | head -1
```

Expected: `en`, `tr`, `x-default`; one `Event`; no `U3`; `Ankara` present; the TR page's JSON-LD `name` is the Turkish title. Paste `dist/index.html`'s JSON-LD into Google's Rich Results Test and confirm it validates as an Event.

- [ ] **Step 9: Commit**

```bash
git add symposium_website/src/lib/hreflang.ts symposium_website/tests/hreflang.test.ts \
        symposium_website/src/components/EventJsonLd.astro symposium_website/src/layouts/BaseLayout.astro \
        symposium_website/src/pages/index.astro symposium_website/src/pages/tr/index.astro
git commit -m "feat: real hreflang and Event structured data for the symposium

BaseLayout emitted <meta name=\"translation-url\">, which is not a
standard and which Google ignores, so the EN and TR pages were never
linked as alternates and were candidates to be read as duplicates.

Adds schema.org Event so a search for the symposium can show its date,
city and -- once the form exists -- its registration link. The location
goes through locationFor(), so the unannounced hall cannot leak into
structured data either. Also stops defaulting og:image to the 2023
poster."
```

---

## Task 9: Nightly rebuild

Without this, the derivation in Task 2 is only true as of the last push: 10 October would pass and the static site would keep advertising an upcoming event.

**Files:**
- Create: `workers/symposium-cron/wrangler.toml`, `workers/symposium-cron/src/index.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: a Cloudflare Pages deploy hook URL for the `rsg-symposium` project, stored as the secret `SYMPOSIUM_DEPLOY_HOOK`.
- Produces: nothing other tasks read.

- [ ] **Step 1: Read the existing worker**

```bash
cat workers/mail-cron/wrangler.toml workers/mail-cron/src/index.ts
```

Follow its structure — naming, error handling and secret conventions come from there, not from this plan.

- [ ] **Step 2: Write the worker**

`workers/symposium-cron/src/index.ts`:

```ts
export interface Env {
  SYMPOSIUM_DEPLOY_HOOK: string;
}

/**
 * Rebuilds the symposium site once a day.
 *
 * The site is static, and which edition is "upcoming" is derived from the
 * clock at build time. Without a scheduled rebuild the site would keep
 * advertising the symposium as upcoming for as long as nobody pushed --
 * potentially months after it happened.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const res = await fetch(env.SYMPOSIUM_DEPLOY_HOOK, { method: "POST" });
        if (!res.ok) {
          console.error(`symposium rebuild failed: ${res.status} ${await res.text()}`);
        }
      })()
    );
  },
};
```

`workers/symposium-cron/wrangler.toml`:

```toml
name = "rsg-symposium-cron"
main = "src/index.ts"
compatibility_date = "2024-11-01"

[triggers]
crons = ["17 1 * * *"]
```

01:17 UTC is 04:17 in Türkiye — after midnight local, so the day flips before the first visitor, and off the hour to avoid Cloudflare's busiest cron minute.

- [ ] **Step 3: Document the setup**

Add a short README section, matching the existing mail-cron one: create the deploy hook in the Pages project's Build settings, then

```bash
cd workers/symposium-cron && npx wrangler secret put SYMPOSIUM_DEPLOY_HOOK && npx wrangler deploy
```

- [ ] **Step 4: Verify**

```bash
cd workers/symposium-cron && npx wrangler deploy --dry-run
```

Expected: compiles clean. After the real deploy, trigger once from the Cloudflare dashboard and confirm a build starts in the `rsg-symposium` project.

- [ ] **Step 5: Commit**

```bash
git add workers/symposium-cron README.md
git commit -m "feat: rebuild the symposium site nightly

Which edition is upcoming is derived from the clock at build time, and a
static site does not notice a date passing. Without this, 10 October
would come and go with the site still counting down to it until somebody
happened to push."
```

---

## Task 10: Blog content cleanup (issue #68)

**Files:**
- Delete: `src/content/blog/tr/rsg-turkiyeden-haberler-2017-2018.md`
- Modify: nine blog files listed below
- Create: `tests/dead-links.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `tests/dead-links.test.ts` (main site):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DEAD_DOMAINS = ['rsgturkey.com', 'iscbrsgturkey.wordpress.com'];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no content links to a domain we no longer control', () => {
  const offenders: string[] = [];
  for (const file of walk('src/content')) {
    const text = readFileSync(file, 'utf8');
    for (const domain of DEAD_DOMAINS) {
      if (text.includes(domain)) offenders.push(`${file} -> ${domain}`);
    }
  }
  assert.deepEqual(offenders, [], 'dead links found');
});

test('the 2017-2018 news post exists exactly once', () => {
  const matches = readdirSync('src/content/blog/tr')
    .filter((f) => f.replace(/-/g, '').startsWith('rsgturkiyedenhaberler'));
  assert.equal(matches.length, 1, `found ${matches.join(', ')}`);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test -- tests/dead-links.test.ts
```

Expected: FAIL — 19 offenders and 2 copies of the news post.

- [ ] **Step 3: Delete the duplicate**

```bash
git rm src/content/blog/tr/rsg-turkiyeden-haberler-2017-2018.md
```

The kept copy, `rsg-turkiye-den-haberler-2017-2018.md`, is the richer one: it has `author: RSG Turkiye`, a full `description` and an `image`, where the deleted one had an empty author, an empty image and a description truncated after one sentence.

- [ ] **Step 4: Repoint the recoverable links**

Each target below already exists on this site with its slug intact:

| File:line | Replace | With |
|---|---|---|
| `blog/en/a-genuine-type-of-plotting-with-ggplot2-part-1.md:13` | `https://rsgturkey.com/tr/plot-plot-veri-gorsellestirme-volkan-plot/` | `/tr/blog/plot-plot-veri-gorsellestirme-volkan-plot` |
| `blog/tr/a-genuine-type-of-plotting-with-ggplot2-part-1.md:13` | same | same |
| `blog/en/call-for-contributions.md:17` | `http://rsgturkey.com/en/call-for-student-presentations/` | `/blog/call-for-student-presentations` |
| `blog/en/resources-to-learn-computational-biology.md:13` | `http://rsgturkey.com/resources/` | `/resources` |
| `blog/tr/2018-rsg-turkiye-etkinlikleri.md:15` | `http://rsgturkey.com/tr/hibit-2018-ardindan/` | `/tr/blog/hibit-2018-ardindan` |
| `blog/tr/2018-rsg-turkiye-etkinlikleri.md:17` | `http://rsgturkey.com/tr/kaynaklar/` | `/tr/resources` |
| `blog/tr/rsg-turkiye-den-haberler-2017-2018.md:20` | `https://iscbrsgturkey.wordpress.com/2017/07/03/hibit-2017-ardindan/` | `/tr/blog/hibit-2017-ardindan` |
| `blog/tr/sunum-cagrilari.md:17` | `https://iscbrsgturkey.wordpress.com/2015/01/31/call-for-student-presentations/` | `/blog/call-for-student-presentations` |

The TR resources route is `/tr/resources`; there is no `/tr/kaynaklar`.

- [ ] **Step 5: Repoint the old symposium sites at the new archive**

Both standalone sites are gone, but the new symposium site has archive pages for those years:

| File:line | Replace | With |
|---|---|---|
| `blog/en/student-symposium-2019.md:13` | `http://symposium.rsgturkey.com/` | `https://symposium.rsg-turkiye.iscbsc.org/editions/2019` |
| `blog/en/student-symposium-2020.md:13` | `https://symposium2020.rsgturkey.com/` | `https://symposium.rsg-turkiye.iscbsc.org/editions/2020` |

- [ ] **Step 6: Resolve the two uncertain ones**

- `blog/en/qpcr-primer-design-tutorial.md:457` → `https://rsgturkey.com/tr/primer-dizayna-giris-tutorial-101/`. The closest surviving post is `blog/tr/orneklerle-primer-dizayni.md`, but the slug differs. Open both, confirm they are the same tutorial, and either repoint to `/tr/blog/orneklerle-primer-dizayni` or drop the link. Record which, and why, in the commit message.
- `blog/tr/sunum-cagrilari.md:13` → `https://iscbrsgturkey.wordpress.com/webinars/presentation-calls/`. Candidate is `blog/en/call-for-abstracts-student-webinars.md`. Same check.

- [ ] **Step 7: Strip the unrecoverable gallery links**

In `blog/en/ismb2018-26th-conference-on-intelligent-systems-for-molecular-biology.md`, lines **17, 19, 21, 31, 33, 35** are bare links whose text is just a photo filename, e.g. `[20180707\_201000](https://rsgturkey.com/...)`. The photos were never migrated and the URLs pointed at WordPress attachment pages. Delete each line entirely — the filename carries nothing for a reader.

- [ ] **Step 8: Run the tests**

```bash
npm test
```

Expected: PASS, including the two new tests.

- [ ] **Step 9: Commit**

```bash
git add -A src/content tests/dead-links.test.ts
git commit -m "fix: remove a duplicated post and 19 links to dead domains

Closes #68.

The 2017-2018 news post shipped under two slugs, publishing identical
body text on two canonical URLs -- duplicate content, days before we
submit the site to Search Console. The richer copy is kept.

Most of the 19 dead links turned out to be old internal links whose
targets survived the migration with their slugs intact, so they become
relative. The two dead standalone symposium sites now point at the new
archive pages. Six WordPress gallery permalinks had nothing to point at
and are removed.

A test now fails if either domain reappears in src/content."
```

---

## Task 11: Close out

- [ ] **Step 1: Full verification**

```bash
npm test && npm run build
cd symposium_website && npm test && npm run build
```

- [ ] **Step 2: Confirm the transition works**

The one behaviour that cannot be checked by reading code — that the site heals itself on 11 October:

```bash
cd symposium_website && faketime '2026-10-11 09:00:00' npm run build
grep -c "13th RSG-Türkiye" dist/editions/index.html   # now in the archive
grep -o "cta.register\|Register" dist/index.html || echo "CTAs gone: correct"
```

If `faketime` is unavailable, temporarily pass a fixed `now` into `getUpcomingEdition()` in `index.astro`, build, check, and revert.

- [ ] **Step 3: Update the issues**

Comment on #43 noting venue-on-homepage, committee page and programme schedule are done, and close it. Close #68.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/symposium-2026
gh pr create --title "13th symposium (2026) and pre-indexing SEO" --body "$(cat <<'BODY'
The symposium site advertised the **2024** edition as current, five weeks
before the 2026 one. It no longer does, and it will not need anyone to
remember anything on 11 October either.

## What changed

- **The 13th symposium is on the site** — 10 October 2026, theme
  *Immunoinformatics and mRNA Therapeutics*, in both languages. The hall is
  recorded but withheld (`venuePublic: false`); the city is public, so
  people can plan travel.
- **The lifecycle is derived, not flagged.** `data/editions.ts` and its
  hand-set `isLatest` are gone. An edition is upcoming until midnight after
  its last day, computed from a real `startDate`. A nightly rebuild keeps
  that true on a static site.
- **New:** committee page (empty roster until the list is confirmed),
  session times, a CTA block that renders nothing until the form URLs exist,
  and a header derived from what actually has content — `/schedule` and
  `/speakers` were built but had never been linked from anywhere.
- **Ready for Search Console.** The symposium site's canonical host was
  still the parked `symposium.rsgturkey.com`, which poisoned every canonical
  tag, `og:url` and sitemap entry. Fixed, plus `robots.txt`, real `hreflang`
  (the old `<meta name="translation-url">` is not a standard and Google
  ignored it), and schema.org `Event`.
- **Content cleanup:** a TR post published under two slugs, and 19 links to
  domains we no longer control.

## Closes

Closes #43. Closes #68.

## Design and plan

- Spec: `docs/superpowers/specs/2026-09-02-symposium-2026-and-seo-design.md`
- Plan: `docs/superpowers/plans/2026-09-02-symposium-2026-and-seo.md`

## Needs a human after merge

Deploy the cron worker and set `SYMPOSIUM_DEPLOY_HOOK`; submit both
sitemaps; flip `venuePublic` when the hall is announced; fill the form URLs
and the committee roster.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

- [ ] **Step 5: Post-merge checklist for a human**

- [ ] Deploy the cron worker and set `SYMPOSIUM_DEPLOY_HOOK`
- [ ] Submit both sitemaps in Google Search Console
- [ ] Validate the homepage in Google's Rich Results Test
- [ ] Flip `venuePublic: true` in `2026.md` when the hall is announced
- [ ] Fill `registrationUrl` / `abstractUrl` and their deadlines when the forms exist
- [ ] Add the committee roster to `src/data/committee.ts`
