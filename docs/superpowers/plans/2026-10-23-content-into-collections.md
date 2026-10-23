# Content Into Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every piece of main-site content that today lives in TypeScript arrays or inside `.astro` pages moves into content-collection files with a zod schema, so plan 3's schema-driven CMS can edit it. The built site stays byte-for-byte the same, apart from the one intended change listed in Task 4.

**Architecture:**
- Each content type becomes an Astro content collection under `src/content/<type>/`. There is one JSON file per entry, or one per page for page texts, and a zod schema in `src/content.config.ts`. Translatable strings are `{ en, tr }` objects inside one entry, so a single CMS draft edits both languages.
- Helper logic stays in `src/data/*.ts` and works on the loaded entries (`statusOf`, `groupEvents`, `FOUNDED_YEAR`, `workshopUrl`).
- Pages and components load with `getCollection`.
- Every task proves "no visible change" by diffing the built HTML before and after.

**Tech Stack:** Astro 7 content collections (glob loader), zod (`astro/zod`), TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-10-23-content-cms-design.md`, section "Architecture": TypeScript data moves to content files first, and the rendered pages must not change. This is plan 2 of 5:
1. roles (merged, #320)
2. content into collections (this plan)
3. CMS core and the Etkinlikler group
4. remaining groups
5. agent access

## Global Constraints

- **No visible change.** After each task, the HTML diff against the previous build is empty. The only exception is Task 4's removal of committee e-mail links. Asset hash names (`/_astro/*.{css,js}`) are normalised before diffing.
- One JSON file per entry. File names are stable ids such as `symposium-2026.json`, never positional ones, because plan 3 opens PRs that touch single files.
- Translatable text is `{ en: string, tr: string }` in one entry. Shared fields (URLs, dates, images) appear once.
- Dates in JSON are ISO `YYYY-MM-DD` strings, read with `z.coerce.date()`, exactly as `new Date("2026-10-10")` reads them today.
- Committee profiles: no `email` field, and each member carries `consent: true`. Rule 4 in CLAUDE.md is updated to say that published, consented profiles are the exception to "no personal data in git". Owner decision, 2026-10-23.
- Keep the existing comment style: comments explain why. Move the existing why-comments from the `.ts` files into the schema or the helper file. Don't lose them.
- After every task: `npm test`, and `npx astro check` with 0 errors. A clean build means removing `node_modules/.astro .astro dist` first (CLAUDE.md known trap: the content cache keeps deleted files).

## Review Focus

1. **Event dates shifting by a day.** `new Date("2026-10-10")` is UTC midnight. A loader or schema that parses the date in local time would move events across the upcoming/completed line. The Task 2 test pins `start` to the exact epoch.
2. **Order changes.** Arrays had a hand-chosen order: events newest first, committees in a fixed order, workshops newest first. Collections come back in file-system order. Each type needs an explicit `order` field or a sort, and the build diff catches any slip.
3. **TR/EN drift.** Today committees and resources are two parallel arrays. Merging them into `{ en, tr }` must keep each language's exact text, including fields that differ only in one language. The diff covers both `/` and `/tr/` pages.
4. **Leftover imports.** `src/pages/llms.txt.ts` and every component listed in each task must read the collection. A stale import of a deleted export fails `astro check`. Any copy of the data left behind fails the Task 7 guard test.
5. **The content cache.** A deleted `.ts` export can keep rendering from `node_modules/.astro`. Always diff a clean build.

---

### Task 1: Build-diff tool and the workshops collection

**Files:**
- Create: `scripts/compare-builds.ts`
- Create: `src/content/workshops/*.json` (6 files, named after `repo`)
- Modify: `src/content.config.ts` (`workshops` collection), `src/data/workshops.ts` (keep the type and `workshopUrl`, drop the array), `src/components/WorkshopsAside.astro`, `src/pages/llms.txt.ts`
- Test: `tests/compare-builds.test.ts`, `tests/content-workshops.test.ts`

**Interfaces:**
- Produces:
  - `compareBuilds(before: string, after: string): { changed: string[]; added: string[]; removed: string[] }`. It covers HTML, XML and TXT files under each dir, and before comparing it replaces `/_astro/<name>.<hash>.<ext>` with `/_astro/<name>.<ext>`.
  - CLI: `npx tsx scripts/compare-builds.ts <before> <after>` prints the lists and the first differing line of each changed file, and exits 1 if anything differs.
  - `workshops` collection: `{ year: number; title: string; topics: string; repo: string }`. Sort by year descending, then by title, which reproduces today's order exactly; check this against the array.

- [ ] **Step 1: Write the failing tests.**
  - compare-builds: two temp dirs whose files differ only by an asset hash → no changes. A changed `<p>` → listed. A file in only one dir → added or removed.
  - workshops: the collection loaded through the same schema (validate each JSON with the zod schema directly) has 6 entries, and `repo` values are unique.
- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement.** Take a "before" build first:
  `rm -rf node_modules/.astro .astro dist && npm run build && cp -R dist <scratch>/before`
- [ ] **Step 4: Rebuild clean and compare.**
  `npx tsx scripts/compare-builds.ts <scratch>/before dist` → exit 0. Then run `npm test` and `npx astro check`.
- [ ] **Step 5: Commit.** `git commit -m "Workshops as a content collection; compare-builds tool"`

### Task 2: Events collection

**Files:**
- Create: `src/content/events/<id>.json`, one per event, named by its `id`.
- Modify: `src/content.config.ts` (`events`). In `src/data/events.ts`, keep the types, `statusOf`, `groupEvents`, `FOUNDED_YEAR` and `yearsSinceFounding`; drop the array; add `loadEvents(): Promise<CommunityEvent[]>`.
- Modify: the consumers `src/components/WorkshopsPage.astro`, `YearRail.astro`, `EventRow.astro`, `EventsAside.astro`, `WorkshopsAside.astro`, `EventList.astro`, `src/pages/index.astro`, `src/pages/tr/index.astro`, `src/pages/llms.txt.ts`.
- Test: `tests/content-events.test.ts`. Update existing event tests (grep `tests/` for `data/events`).

**Interfaces:**
- Produces:
  - `loadEvents(): Promise<CommunityEvent[]>`, newest `start` first, ties broken by `id`. It returns the same `CommunityEvent` shape as before, with `start` and `end` as `Date`.
  - The JSON fields mirror `CommunityEvent`: `start` and `end` as ISO dates; `title`, `when`, `location` and `description` as `{en, tr}`; optional `links`, `nfcore` and `image`.

- [ ] **Step 1: Write the failing tests.**
  - Every event JSON validates.
  - `symposium-2026` has `start.getTime() === Date.UTC(2026, 9, 10)` and `end` equal to `Date.UTC(2026, 9, 11)`.
  - Ids are unique and equal the file names.
  - `loadEvents()` order equals the old array's id order. Paste that list into the test as a literal.
- [ ] **Step 2: Run the tests to verify they fail.**
- [ ] **Step 3: Implement.** Generate the JSON from the current array with a throwaway script and don't commit the script. Keep the why-comments, for example the one about the 2026 symposium's second day.
- [ ] **Step 4: Run a clean build against Task 1's "after", then `npm test` and `npx astro check`.** `compare-builds` must exit 0.
- [ ] **Step 5: Commit.** `git commit -m "Events as a content collection"`

### Task 3: Resources collection

**Files:**
- Create: `src/content/resources/<slug>.json`, one per resource. The slug comes from the title. When the same link appears in two sections (TeachOpenCADD is in two), use one file per placement with distinct slugs. Section and order fields keep each placement.
- Modify: `src/content.config.ts` (`resources`), `src/pages/resources.astro` and `src/pages/tr/resources.astro`. Move the section headings to the page-texts collection in Task 6, or keep them in the page until then.
- Test: `tests/content-resources.test.ts`

**Interfaces:**
- Produces: `resources` entries `{ section: 'learning' | 'md' | 'databases' | 'tools' | 'community'; order: number; title: string; description: { en, tr }; url: string; tags: string[]; opensource: boolean }`. Read the two pages to confirm the section keys, and use the arrays' own names.

- [ ] **Step 1: Write the failing test.** The entry count equals the 37 `url:` entries per page today. Per section, order and titles match the old arrays (literal lists in the test). Every description has both languages.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement.** Diff the EN and TR arrays first. Any field that differs other than description, for example a TR-only tag, becomes `{en, tr}` too. Note it in the report.
- [ ] **Step 4: Run a clean build, `compare-builds` (exit 0), `npm test` and `npx astro check`.**
- [ ] **Step 5: Commit.** `git commit -m "Resources as a content collection"`

### Task 4: Committees collection

**Files:**
- Create: `src/content/committees/<id>.json`, one per committee. Each holds `order`, `name {en,tr}`, `description {en,tr}` and `members[]`.
- Modify: `src/content.config.ts` (`committees`), `src/data/committees.ts` (keep the types; `getCommittees(lang)` becomes async and maps `{en,tr}` to the old flat `Committee` shape), `src/pages/about.astro`, `src/pages/tr/about.astro`, `src/pages/llms.txt.ts`, `src/layouts/CommitteeCard.astro` (drop the `email` prop), `CLAUDE.md` (rule 4 exception).
- Test: `tests/content-committees.test.ts`

**Interfaces:**
- Produces:
  - `getCommittees(lang: 'en' | 'tr'): Promise<Committee[]>`, with the same `Committee`/`CommitteeMember` shape minus `email`.
  - Member JSON: `{ name: string; role: {en,tr}; image: string; education?: { degree: {en,tr}; field: {en,tr}; institution: {en,tr}; year?: string }[]; socialMedia?: {...}[]; consent: true }`. Merge the EN and TR arrays member by member, by position, and assert the names match.

- [ ] **Step 1: Write the failing tests.**
  - Every committee JSON validates.
  - No member has an `email` key, and every member has `consent: true`.
  - `getCommittees('en')` and `getCommittees('tr')` return the same committees, members and order as the old arrays, minus email. Snapshot names and roles as literals in the test.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
  - Update CLAUDE.md rule 4 with one sentence: published committee profiles, with the member's consent, are content and may be in git. E-mail addresses are not.
- [ ] **Step 4: Run a clean build and `compare-builds`.** The ONLY differences allowed are the removed e-mail links on `/about/` and `/tr/about/`, and `llms.txt` if it listed e-mails. Record the diff output in the report. Then run `npm test` and `npx astro check`.
- [ ] **Step 5: Commit.** `git commit -m "Committees as a content collection, without e-mail addresses"`

### Task 5: Page texts for about and join

**Files:**
- Create: `src/content/pages/about.json` and `src/content/pages/join.json`. Each maps a key to `{en, tr}`, and only text the reader sees changes: headings, paragraphs, button labels, FAQ questions and answers. Layout, classes and links stay in the page.
- Modify: `src/content.config.ts` (`pages`: `z.record(z.string(), z.object({ en: z.string(), tr: z.string() }))`), `src/pages/about.astro`, `src/pages/tr/about.astro`, `src/pages/join.astro`, `src/pages/tr/join.astro`.
- Create: `src/lib/page-text.ts`, with `pageText(page: string, lang: 'en' | 'tr'): Promise<(key: string) => string>`. It throws at build time on an unknown key, so a typo fails the build instead of rendering an empty string.
- Test: `tests/page-text.test.ts`

**Interfaces:**
- Produces: `pageText(page, lang)`. Plan 3's "Sayfalar" group edits these files.

- [ ] **Step 1: Write the failing tests.**
  - An unknown key throws, with the page and key in the message.
  - A known key returns the right language.
  - Every value in every `pages/*.json` file has non-empty `en` and `tr`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.** Keep inline markup (links, `<strong>`) in the page. Where a sentence contains a link, split the text around it into keys (`intro_before_link`, `intro_link_label`, `intro_after_link`) rather than storing HTML.
- [ ] **Step 4: Run a clean build, `compare-builds` (exit 0), `npm test` and `npx astro check`.**
- [ ] **Step 5: Commit.** `git commit -m "About and join texts as page-text content"`

### Task 6: Page texts for home and resources

**Files:**
- Create: `src/content/pages/home.json` and `src/content/pages/resources.json`.
- Modify: `src/pages/index.astro`, `src/pages/tr/index.astro`, `src/pages/resources.astro`, `src/pages/tr/resources.astro`.
- Test: extend `tests/page-text.test.ts`. Every key a page uses exists, checked by grepping the `.astro` sources for `t('…')`-style page-text calls and comparing them with the JSON keys.

**Interfaces:**
- Consumes: `pageText` from Task 5.

- [ ] **Step 1: Extend the test so it fails for missing keys.**
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement.** Only hand-written prose, headings and labels move. Data-driven sections (events, webinars, stats) already come from content.
- [ ] **Step 4: Run a clean build, `compare-builds` (exit 0), `npm test` and `npx astro check`.**
- [ ] **Step 5: Commit.** `git commit -m "Home and resources texts as page-text content"`

### Task 7: Guard and docs

**Files:**
- Create: `tests/content-not-in-code.test.ts`. It fails if `src/data/events.ts`, `workshops.ts` or `committees.ts` export a data array again, or if the resources pages define a literal `Resource[]` array.
- Modify:
  - README.md "Content Types": add events, workshops, resources, committees and page texts. Say where each lives and that the panel will edit them (plan 3).
  - CLAUDE.md "Where things live": a `src/content/` row listing the new collections, and `scripts/compare-builds.ts`.
- Modify: the PR body. It must say this needs no migration and no secrets, and that it is display-neutral apart from the removed committee e-mail links.

- [ ] **Step 1: Write the guard test and see it pass on this branch.** Then check that it fails on a copy of `main`, so you know it detects the old arrays.
- [ ] **Step 2: Write the docs.**
- [ ] **Step 3: Run `npm test` and `npx astro check`.**
- [ ] **Step 4: Commit.** `git commit -m "Guard content-in-code; document collections"`
