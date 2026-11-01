# Graduate Programme and Lab Guide Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A bilingual, searchable guide that tells a student which professor in Türkiye works on a topic and which MSc programme, in which window, leads to them.

**Architecture:** Universities, programmes and related terms are git content collections (institutional, CMS group "Rehber"). Professors and labs are D1 rows edited by approvers in the panel; every change republishes one search index JSON to R2, served through the site's own domain. The browser joins that index with a build-time programmes JSON and searches locally. Corrections arrive by Google Form → Sheet, imported nightly into a panel queue; a person applies them.

**Tech Stack:** Astro 7 content collections + zod, Cloudflare Pages Functions, D1, R2, the `rsg-symposium-cron` Worker, Google service account (Sheets read, Drive write), OpenAlex REST API, `node --test` with tsx.

**Spec:** `docs/superpowers/specs/2026-11-01-grad-lab-guide-design.md` (read it first; it carries the why and the legal basis).

## Global Constraints

- No professor or lab record, name, e-mail, phone, Drive-sheet note or "RSG İlgi Düzeyi" value in git, PR bodies, commit messages, test fixtures or issues (CLAUDE.md rules 1, 4). Test fixtures use invented names ("Örnek Hoca A").
- Published professor fields are exactly: title, name, university id, department, lab id, profile URL, OpenAlex id, topics, checkedAt, source. Nothing else may reach the index.
- Search runs in the browser from static files; no Function call or D1 read per keystroke.
- Never a `*.pages.dev`, `*.r2.dev` or `*.workers.dev` URL in anything a reader sees.
- Intake is a Google Form; the Sheet is the source of truth; import is idempotent, keyed by response timestamp + row number (rule 3).
- Nothing is applied from a form row automatically; a person applies it. A removal is one click.
- Every panel write uses `runWithAudit` with a label in `src/lib/audit-labels.ts`; audit details carry ids and counts, never a professor's name.
- Scheduled work runs from `workers/symposium-cron` via secret-gated POST endpoints (`X-Archive-Secret`); no GitHub `schedule:`; nothing new on the per-minute tick.
- Agent tokens get no guide routes (`functions/_lib/agent-routes.ts` unchanged).
- Bilingual: UI strings in `src/i18n/ui.ts`; English pages at root, Turkish under `src/pages/tr/`.
- Secrets are set by the owner: `GOOGLE_SA_KEY` (service-account JSON, piped from a file: `cat key.json | npx wrangler pages secret put GOOGLE_SA_KEY`). Plain var: `GUIDE_SHEET_ID`. New bindings/vars go in `Env` in `functions/_lib/auth.ts`.
- Professor and lab ids are opaque (`p_` / `l_` + 12 hex), never a name slug (rule 9: audit rows keep ids a year). University and programme ids are slugs and, like learning-path ids, never change or get reused.
- Turkish URLs mirror English ones under `/tr` (`/guide` ↔ `/tr/guide`, `src/lib/hreflang.ts`); "Rehber" is the label only.
- MSc only; programme `type` field exists with the single value `"msc"`.
- Backups: last 30 nightly files in a private R2 bucket `rsg-guide-backups` (binding `GUIDE_BACKUPS`, created by the owner), older deleted; never the public `BLOG_IMAGES` bucket.
- Every nightly job reports into the cron's `Tick`/`failed()`/`summarise()` in `workers/symposium-cron/src/index.ts`; every outbound fetch has a 10 s timeout (`AbortSignal.timeout`).
- Visual work: live local preview link to the owner, checked at 1280×680, 1366×768, 1440×800, 1536×864, 1440×900, 1920×1080, no inner scrollbars, before any push.

## Review Focus

1. Turkish case folding: "İstanbul", "istanbul", "ISTANBUL", "sistem biyolojisi"/"Sistem Biyolojisi" must match (İ→i, I→ı handled). Test in Task 6.
2. A professor whose university has no programme, or whose `programmeIds` is empty: card still renders with the "which programme? suggest a correction" box. Test in Task 6 (`joinCard`).
3. Removal: after delete, the name is absent from D1, the published index, and the queue row. Test in Task 4 and Task 8.
4. Index publish while D1 is over its daily limit: the previous R2 object must stay (publish writes only on a successful read). Test in Task 5.
5. Re-running the nightly import, or deleting a row in the Sheet between runs, must not duplicate queue rows. Test in Task 8.
6. Turkish suffixes: "biyoloji" must find "sistem biyolojisi"; tokenising must not split "ışık". Test in Task 6.
7. Dangling ids: a `programmeIds` entry or `universityId` missing from the catalog must not produce an empty, silent card. Test in Task 6; counted at publish in Task 4.

---

### Task 0: Seed research (no code, nothing in git)

**Files:**
- Create (outside the repo, in the session scratchpad, then the owner's Drive): `guide-seed/professors.csv`, `guide-seed/labs.csv`, `guide-seed/open-questions.md`
- Create (git, later tasks consume): `guide-seed/universities.json`, `guide-seed/programmes.json`, also in the scratchpad until Task 1 copies them in

**Interfaces:**
- Produces: CSV columns exactly the D1 columns of Task 3 (`professors.csv`: `id,title,name,university_id,department,lab_id,profile_url,openalex_id,hand_topics,programme_ids,source,checked_at`; `labs.csv`: `id,name,university_id,url,checked_at`). JSON shapes are Task 1's schemas.

- [ ] **Step 1:** Export `RSG_Turkey/Chair/RSG_Turkey_Akademisyenler_Kapsamli` with rclone to the scratchpad; keep only Ünvan, Ad Soyad, Üniversite, Bölüm/Birim, Araştırma Alanları. Delete the full export immediately after.
- [ ] **Step 2:** For each of the 40 universities: find bioinformatics or closely related MSc programmes (name TR/EN, institute, announcement URL, usual application months), city and official URL. Record the source URL of each fact.
- [ ] **Step 3:** For each professor: lab name and URL, official profile URL, OpenAlex author id (match on name + institution via `https://api.openalex.org/authors?search=`). Ambiguous or missing → `open-questions.md`, not guessed.
- [ ] **Step 4:** Owner reviews `open-questions.md` and the two JSON files. Check: owner's OK in chat.

### Task 1: "Rehber" group and the git content types

**Files:**
- Modify: `functions/_lib/roles.ts` (add `'rehber'` to `CMS_GROUPS`)
- Create: `src/data/guide.ts` (schemas only; `tests/content-not-in-code.test.ts` forbids data arrays)
- Modify: `src/content.config.ts`, `src/lib/cms/types.ts` (`CmsTypeKey` += `"guide-universities" | "guide-programmes" | "guide-terms"`, three `defineType` entries, group `"rehber"`)
- Modify: `src/i18n/ui.ts`, `src/lib/audit-labels.ts`
- Create: `src/content/guide-universities/*.json`, `src/content/guide-programmes/*.json`, `src/content/guide-terms/*.json` (from Task 0)
- Test: `tests/content-guide.test.ts`; existing `tests/cms-access.test.ts`, `tests/admin-users-roles.test.ts`, `tests/audit-labels.test.ts` must pass; update `tests/roles-catalog.test.ts:104` (group list) and add the three dirs to `tests/content-file-names.test.ts`

**Interfaces:**
- Produces in `src/data/guide.ts`:
  - `universitySchema`: `{ id: string (slug), name: {en,tr}, city: string, url: string(url) }`
  - `programmeSchema`: `{ id, universityId, type: z.literal("msc"), name: {en,tr}, institute: {en,tr}, usualMonths: number[] (1–12), window?: { opens: "YYYY-MM-DD", closes: "YYYY-MM-DD" } (only when reported), announcementUrl?: url, calendarUrl?: url, sourceUrl: url, checkedAt: "YYYY-MM-DD" }`
  - `relatedTermSchema`: `{ id, terms: string[] (min 2; TR and EN spellings of one concept), related: string[] (ids of other term groups) }`
  - Types `University`, `Programme`, `RelatedTerm`.

- [ ] **Step 1: Failing tests** in `tests/content-guide.test.ts`: `every programme's universityId names a university file`; `every related id names a term file`; `programme window opens <= closes`; `university ids do not collide with reserved route names (universities, catalog, index)`; `usualMonths are 1–12`; `no guide content file contains '@'` (no e-mail slipped in).
- [ ] **Step 2:** Run `node --import tsx --test tests/content-guide.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement schemas, collections, CMS types (`format: "json"`, `idFrom` slugify of `id`, `indexTitle` the TR/EN name, `indexDate` = `checkedAt` for programmes), the group in `roles.ts`, its UI labels (`Rehber` / `Guide`) and audit labels. Seed content from Task 0.
- [ ] **Step 4:** `npm test && npx astro check` → all pass, 0 errors.
- [ ] **Step 5:** Commit `feat(guide): Rehber group, universities, programmes and related terms`.

### Task 2: Build-time programmes JSON

**Files:**
- Create: `src/pages/guide/catalog.json.ts`
- Test: `tests/guide-catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 collections.
- Produces: `GET /guide/catalog.json` → `GuideCatalog = { universities: University[], programmes: Programme[], terms: RelatedTerm[] }`, and an exported pure `buildCatalog(u, p, t): GuideCatalog` (sorted by id) for the test.

- [ ] **Step 1: Failing test:** `buildCatalog sorts by id and keeps only schema keys`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test`, `npm run build`, then `ls dist/guide/catalog.json` exists → PASS.
- [ ] **Step 5:** Commit.

### Task 3: D1 tables and the guide store

**Files:**
- Modify: `db/schema.sql` (tables + migration note **8o** with the exact `wrangler d1 execute rsg-members --remote --file=<absolute path>` command)
- Create: `functions/_lib/guide-db.ts`
- Test: `tests/guide-db.test.ts` (uses the repo's existing D1 test harness, as `tests/audit-prune.test.ts` does)

**Interfaces:**
- Ids: `newProfessorId()` / `newLabId()` → `p_`/`l_` + 12 hex from `crypto.getRandomValues`.
- Tables: `guide_labs(id TEXT PK, name, university_id, url, checked_at INTEGER)`; `guide_professors(id TEXT PK, title, name, university_id, department, lab_id NULL, profile_url, openalex_id NULL, hand_topics TEXT JSON '[]', hidden_topics TEXT JSON '[]', openalex_topics TEXT JSON '[]', topics_refreshed_at INTEGER NULL, topics_failures INTEGER DEFAULT 0, programme_ids TEXT JSON '[]', source TEXT, checked_at INTEGER)`; index on `guide_professors(topics_refreshed_at)`; `guide_index_state(id INTEGER PK CHECK(id=1), published_at, count, unresolved INTEGER, error TEXT)`.
- Produces in `guide-db.ts`:
  - `type ProfessorRow`, `type LabRow` (camelCase, JSON columns parsed)
  - `listProfessors(db): Promise<ProfessorRow[]>`, `listLabs(db): Promise<LabRow[]>`
  - `upsertProfessor(db, row, actorId, now)`, `upsertLab(db, row, actorId, now)`, `deleteProfessor(db, id, actorId, now)`, `deleteLab(db, id, actorId, now)` — each one `runWithAudit` batch; actions `guide.professor.save|delete`, `guide.lab.save|delete`; details `{ id }` only.
  - `staleRecords(db, now): Promise<{professors: string[], labs: string[]}>` — ids with `checked_at < now - 365 days`.

- [ ] **Step 1: Failing tests:** `upsert then list round-trips JSON columns`; `deleteProfessor removes the row and its audit details hold only the id`; `staleRecords returns ids checked over a year ago`; `deleteLab refuses while a professor references it` (returns `{ok:false, code:'lab_in_use'}`); `new ids are opaque and never contain the name`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `tests/audit-labels.test.ts` passes.
- [ ] **Step 5:** Commit. (Owner applies migration 8o before Task 4 deploys.)

### Task 4: The search index and its publication

**Files:**
- Create: `functions/_lib/guide-index.ts`, `functions/api/guide/index.json.ts`
- Test: `tests/guide-index.test.ts`

**Interfaces:**
- Consumes: Task 3 `listProfessors`, `listLabs`.
- Produces:
  - `type GuideIndex = { generatedAt: string; professors: IndexProfessor[]; labs: IndexLab[] }`; `IndexProfessor = { id, title, name, universityId, department, labId?, profileUrl, openalexId?, topics: string[], programmeIds: string[], checkedAt: string, source: string }` (topics = hand topics first, then OpenAlex topics not in `hidden_topics`, deduped case-insensitively).
  - `buildGuideIndex(profs, labs, now): GuideIndex` (pure).
  - `publishGuideIndex(env, now): Promise<{ok: true, count: number, unresolved: number} | {ok: false, reason: string}>` — writes R2 key `guide/index.json` in `BLOG_IMAGES` (the index is public data); on any D1 error returns `ok:false` and writes nothing; always records the outcome in `guide_index_state`. `unresolved` counts `programmeIds`/`universityId`/`labId` not in the catalog (read via `env.ASSETS.fetch('/guide/catalog.json')`). Labs with no professors are left out.
  - `GET /api/guide/index.json` serves that object through `caches.default` (key includes the R2 `etag`; publish deletes the cache entry), `Cache-Control: public, max-age=300, stale-while-revalidate=3600`, honours `If-None-Match`, 404 if absent.

- [ ] **Step 1: Failing tests:** `index keys of a professor are exactly the allowlist` (assert `Object.keys` deep-equals the published field list); `hand topics come first and hidden OpenAlex topics are dropped`; `a deleted professor is absent after republish`; `publish writes nothing when the D1 read throws` (stub R2 `put` never called) and records the error in `guide_index_state`; `a lab whose only professor is removed leaves the index`; `unresolved counts a programme id missing from the catalog`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 5: Panel editor for professors and labs

**Files:**
- Create: `functions/api/guide/professors.ts`, `functions/api/guide/labs.ts`, `src/scripts/admin/sections/guide.ts`
- Modify: `src/scripts/admin/sections.ts` (a "Rehber" section under `icerik`, visible with `content.rehber.edit`), `src/i18n/ui.ts`
- Test: `tests/guide-api.test.ts`; `tests/audit-coverage.test.ts` must pass

**Interfaces:**
- Consumes: Tasks 3, 4.
- The POST response carries the publish result ("saved; index not republished — retry" on failure); the Rehber section header shows "index published N hours ago", the `unresolved` count and pending-queue/removal counts. The nightly job republishes when the last state has an error.
- Endpoints (session + CSRF as other panel endpoints): `GET` list (edit or approve rights; `?stale=1` → `staleRecords`); `POST` upsert and `DELETE ?id=` require `content.rehber.approve` or admin; each successful write calls `publishGuideIndex`. `POST /api/guide/professors?republish=1` (approver) republishes without a change, audit `guide.republish`.
- Panel: lists with search box; a form whose fields are Task 3's columns (topics as tag inputs; OpenAlex topics shown with a "hide" toggle that writes `hidden_topics`); a "Stale (1 year)" filter; a "Mute watch" toggle per watched URL (Task 9). No sending from the site; no address field.

- [ ] **Step 1: Failing tests:** `editor without approve gets 403 on POST and DELETE`; `approver POST writes the row, an audit row and republishes`; `GET without edit rights is 403`; `body with an unknown key (e.g. email) is rejected 400`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `npm test` (incl. audit-coverage) → PASS.
- [ ] **Step 5:** Show the owner the panel on a local preview (signed in, mocked roles as in `tests/browser`); get OK. **Step 6:** Commit.

### Task 6: Client search

**Files:**
- Create: `src/lib/guide-search.ts`
- Test: `tests/guide-search.test.ts`

**Interfaces:**
- Consumes: `GuideCatalog` (Task 2), `GuideIndex` (Task 4).
- Produces:
  - `fold(s: string): string` — NFC, then explicit `İ→i`, `I→ı`, lower-case, strip combining marks, then ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u.
  - `tokens(s): string[]` — `fold`, split on `/[^\p{L}\p{N}]+/u`, then drop one suffix from `leri, lari, si, i, de, da, te, ta, in, un, ye, ya, nin, nun` when the stem left is ≥ 5 letters. Matching is equality or a shared prefix of ≥ 6 letters.
  - `expandQuery(q: string, terms: RelatedTerm[]): { tokens: string[]; alsoSearched: string[] }` — the term groups whose any spelling matches `q`, plus their `related` groups.
  - `search(q: string, city: string | null, index: GuideIndex, catalog: GuideCatalog): SearchResult[]` — `SearchResult = { professor: IndexProfessor; matched: string[]; score: number }`, sorted by score desc, then name. Exact topic match > related-term match > name match; city filters by the professor's university city.
  - `joinCard(p: IndexProfessor, catalog, today: string): { university: University; lab?: IndexLab; programmes: (Programme & { showWindow: boolean })[]; programmeUnknown: boolean }` — `programmeIds` filtered to those in the catalog, falling back to all programmes of the university when none remain; `programmeUnknown` when the result is empty; `showWindow` false once `window.closes < today`, `today` being the Istanbul date (`src/lib/istanbul-time.ts`).

- [ ] **Step 1: Failing tests:** `fold("İSTANBUL") === fold("istanbul")`; `"protein yapısı" finds a professor tagged "protein structure" via a term group and lists it in alsoSearched`; `city filter keeps only that city`; `name search finds "Örnek Hoca A" by "ornek"`; `joinCard falls back to all university programmes`; `joinCard ignores a programme id missing from the catalog`; `"biyoloji" finds "sistem biyolojisi"`; `fold("IŞIK") === fold("ışık") and a decomposed ş folds like ş`; `tokens("ışık") is ["isik"]`; `equal scores sort by name with localeCompare 'tr'`; `a reported window is hidden the day after it closes`; `joinCard sets programmeUnknown for a university with none`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit.

### Task 7: Guide pages

**Files:**
- Create: `src/pages/guide/index.astro`, `src/pages/guide/universities.astro`, `src/pages/guide/[university].astro`, and Turkish twins `src/pages/tr/guide/index.astro`, `src/pages/tr/guide/universities.astro`, `src/pages/tr/guide/[university].astro`; `src/scripts/guide.ts` (client; keeps the index in `sessionStorage` keyed by `generatedAt`, wrapped in try/catch)
- Modify: `src/i18n/ui.ts`, site navigation, `src/data/privacy.ts` content (`src/content/privacy`) with the guide paragraph
- Test: `tests/browser/guide.mjs` (Playwright, `page.route` mocks for both JSON files)

**Interfaces:**
- Consumes: Tasks 2, 4, 6.
- Search page: purpose line at top (spec "Legal basis" 1), search box, city select (cities from catalog), "also searched" line, professor cards per spec ("How a student uses it"); the programme box reads "usually takes applications in <months>" + announcement link, plus the exact window only when `showWindow`, "Suggest a correction" link on each card pre-filling the Form with `?entry.<id>=<professor id>` (field id from Task 8's form), "Remove me" link in the footer of the guide.
- University page: built statically from the catalog (programmes, windows, links, "no MSc found yet — suggest one" when none); professors/labs filled in the browser from the index.
- Privacy paragraph: purpose, fields, sources (OpenAlex, university pages), removal on request (live within minutes), D1's 7-day recovery window and backups deleted within 30 days, queue entries deleted 90 days after handling. Extend `tests/privacy-page.test.ts` to pin the 30 and 90.

- [ ] **Step 1: Failing browser test:** `typing "protein structure" shows the tagged professor's card with programme box`; `unknown window shows "suggest a correction"`; `city filter empties results for a city with none`; `university page with no programme shows the suggest line`; TR twin renders Turkish labels.
- [ ] **Step 2:** Run `node tests/browser/guide.mjs` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npx astro check` 0 errors.
- [ ] **Step 5:** Owner reviews a live local preview at the six window sizes; OK before push. **Step 6:** Commit.

### Task 8: Sheet import and the suggestion queue

**Files:**
- Create: `functions/_lib/google-sa.ts`, `functions/_lib/sheet-import.ts`, `functions/api/admin/guide/import.ts`, `functions/api/guide/suggestions.ts`
- Modify: `db/schema.sql` (table in note 8o's batch, or **8p** if 8o is already applied), `src/scripts/admin/sections/guide.ts` (queue tab), `src/lib/audit-labels.ts`
- Test: `tests/sheet-import.test.ts`, `tests/guide-suggestions.test.ts`

**Interfaces:**
- `google-sa.ts`: `getGoogleToken(keyJson: string, scopes: string[], now): Promise<string>` (RS256 JWT via WebCrypto, token cached in memory until expiry).
- `sheet-import.ts` (generic, reused by membership/speaker forms later): `type SheetMapping = { source: string; columns: Record<string, number> }`; `readSheetRows(token, sheetId, range): Promise<string[][]>`; `importRows(db, rows, mapping, now): Promise<{added: number}>` — inserts into `intake_rows(source, row_key UNIQUE, record_id, payload TEXT JSON, kind, status 'new'|'done'|'discarded', count INTEGER DEFAULT 1, created_at, handled_at)` with `INSERT OR IGNORE`, `row_key = source + ':' + timestamp + ':' + sha256(answers joined)`; row numbers are never part of a key. E-mail-looking strings in free text become `[e-posta]` on import. Identical suggestions (`record_id`, kind, normalised text) collapse into one row with `count` + 1.
- Form fields (the owner creates the Form under turkey.rsg from this list): Kind (correct / add professor or lab / add or update programme / remove me), Record id (hidden, pre-filled), What should change (paragraph), Source link (optional). No e-mail field.
- `POST /api/admin/guide/import` (secret-gated like `audit/prune.ts`): reads `GUIDE_SHEET_ID` with `GOOGLE_SA_KEY`, imports, audit `guide.import` `{added}`.
- Queue: `GET/POST /api/guide/suggestions` for `content.rehber.edit`; "remove me" rows sorted first and marked urgent; actions `done`, `discard` (blanks payload) and `applyRemoval` (approver: calls `deleteProfessor`, deletes every queue row with that `record_id`, republishes). Several removal rows from one import are shown as one batch to review, never applied in bulk. Panel shows the suggestion beside the record's editor. A new removal row adds a line to the admins' internal alert mail (same mechanism as `functions/_lib/usage-alert.ts`; internal notice, not outbound mail). Handled/discarded rows are deleted 90 days after `handled_at` by the existing `functions/api/admin/audit/prune.ts` run.
- The import endpoint returns `{sheet: 'ok'|'no_access'|'error', added}` and the panel shows the last result.

- [ ] **Step 1: Failing tests:** `importing the same rows twice adds them once`; `deleting a middle Sheet row between imports adds nothing`; `an e-mail address in free text is masked`; `identical suggestions collapse with count 2`; `removal rows sort first`; `applyRemoval deletes the professor, republishes and leaves no row with that record_id`; `prune deletes handled rows after 90 days`; `import endpoint 403 without secret`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit. Hand the owner: the Form field list, the rule that an approver deletes a handled removal request's response row from the Sheet, "share the response Sheet with the service account (viewer)", and `! npx wrangler pages secret put GOOGLE_SA_KEY` (they paste the value).

### Task 9: OpenAlex refresh, change watch, Drive backup, nightly wiring

**Files:**
- Create: `functions/_lib/openalex.ts`, `functions/_lib/page-watch.ts`, `functions/_lib/guide-backup.ts`, `functions/api/admin/guide/refresh-topics.ts`, `functions/api/admin/guide/watch.ts`, `functions/api/admin/guide/backup.ts`, `docs/handover/guide-restore.md` (restore runbook)
- Modify: `wrangler.toml` (`GUIDE_BACKUPS` R2 binding)
- Modify: `db/schema.sql` (`guide_page_watch(url TEXT PK, programme_ids TEXT JSON, fingerprints TEXT JSON (last 3), last_text TEXT, checked_at INTEGER, failures INTEGER DEFAULT 0, muted INTEGER DEFAULT 0, state 'ok'|'unreadable')`, index on `checked_at`; same migration note as Task 8)
- Modify: `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml` (URLs as vars), `src/lib/audit-labels.ts`
- Test: `tests/guide-openalex.test.ts`, `tests/guide-backup.test.ts`

**Interfaces:**
- `fetchAuthorTopics(openalexId, fetchFn): Promise<string[]>` — `GET https://api.openalex.org/authors/<id>`, `topics[].display_name`, top 15 by count; `mailto=` param uses the organisation address from config, not a person's.
- `refresh-topics` (secret-gated): the 20 professors `WHERE openalex_id IS NOT NULL` with the oldest `topics_refreshed_at` (NULLs first) per night; a failed fetch still bumps `topics_refreshed_at` and `topics_failures`, so one bad id cannot block the queue — stays under the Worker subrequest limit; writes `openalex_topics`, then one `publishGuideIndex`. A failed fetch leaves that row unchanged.
- `backupGuide(env, now)`: writes `guide-backup-YYYY-MM-DD.json` (professors + labs) to `GUIDE_BACKUPS`, lists `guide-backup-*`, deletes all but the newest 30 (at most 20 deletes a night). Audit `guide.backup` `{kept, deleted}`. `docs/handover/guide-restore.md` gives the one restore command (file → INSERT SQL → `wrangler d1 execute --remote --file`).
- `pageText(html: string, contentType: string): string` — decode with the response charset (`windows-1254`/`iso-8859-9` via `TextDecoder`); drop `script`, `style`, `nav`, `header`, `footer`, `form`; strip tags; collapse whitespace; remove times (`\d{1,2}:\d{2}`), dates (`\d{1,2}[./]\d{1,2}[./]\d{2,4}`) and digit runs of ≥ 4. `fingerprint(text): Promise<string>` SHA-256 hex. A non-200 response or text under 1,000 characters is `unreadable`: `failures` + 1, `checked_at` bumped, baseline unchanged.
- `watch` (secret-gated): every programme's `announcementUrl` and `calendarUrl` from `/guide/catalog.json` is upserted into `guide_page_watch`; URLs are deduplicated; each night `ceil(unmutedCount / 7)` (max 25) unmuted URLs with the oldest `checked_at` are fetched, so each page is seen weekly; a fingerprint not among the last 3 (and not the first sighting) inserts an `intake_rows` row `kind='page_changed'`, `row_key='watch:'+url+':'+fingerprint`, carrying the changed lines (diff of `last_text` and the new text, at most 40 lines) for the approver to read in the queue. URLs with `failures ≥ 3` are listed as "unreadable" in the panel. Audit `guide.watch` `{checked, changed}`.
- Cron order after the existing jobs: import → refresh-topics → watch → backup.

- [ ] **Step 1: Failing tests:** `fetchAuthorTopics returns at most 15 names, highest count first`; `refresh picks oldest 20 and keeps a row unchanged when its fetch fails`; `backup keeps the newest 30 and deletes the rest`; `pageText ignores a changed clock and script`; `first sighting of a URL raises no queue item, a changed one raises exactly one`; `muted URLs are not fetched`; `a flip back to one of the last 3 fingerprints raises nothing`; `a short or non-200 body is unreadable and raises nothing`; `a windows-1254 page decodes ş correctly`; `a failed OpenAlex fetch still moves the professor to the back of the queue`; `backup file contains no key outside the D1 columns`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS; `npm test` all green.
- [ ] **Step 5:** Commit. Hand the owner: create the `rsg-guide-backups` bucket and redeploy the cron worker, both as `!` commands. Each new job is added to the cron's `Tick`, `failed()` and `summarise()`.

### Task 10: Launch

- [ ] **Step 1:** Owner applies migration(s) 8o/8p (`!` command from `db/schema.sql`).
- [ ] **Step 2:** Owner loads Task 0's CSVs into D1 (generated `INSERT` file kept in the scratchpad, `!` command with absolute path). Call `publishGuideIndex` through the panel's "Republish" action (part of Task 5's section).
- [ ] **Step 3:** Verify on the live site: search "protein structure", a city filter, one university page, the privacy paragraph; `curl -sI https://rsg-turkiye.iscbsc.org/api/guide/index.json` → 200.
- [ ] **Step 4:** Courtesy e-mails: the agent prepares a mail-merge sheet in the owner's Drive (outside the repo): address from the private Drive sheet, name, the professor's card text, correction and removal links, and the TR template. The owner sends it with a Gmail mail merge in three batches of about 35 over a week. The agent never sends. The merge sheet is deleted after the last batch.
- [ ] **Step 5:** Delete the scratchpad seed files.
