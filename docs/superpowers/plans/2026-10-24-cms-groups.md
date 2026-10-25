# CMS: the Remaining Groups and Blog on Drafts — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything on the main site that the spec lists becomes editable from the panel, not only events, workshops and webinars:
- committees and the podcast (Topluluk);
- learning paths and the resource links (Öğrenme);
- page texts and the privacy notice (Sayfalar);
- blog posts (Yazılar), with blog's own submission flow retired in favour of the CMS drafts.

**Architecture:** Plan 3's engine is extended rather than copied.
- The panel gets **one "İçerik" section**. Its tabs are the types the person can edit, grouped by group, plus Taslaklarım and Onay. This replaces the single Etkinlikler section, and the old `#icerik-etkinlikler/...` links keep working.
- The field model gains one recursive kind: **`objects`, a repeatable row of fields**. Fields inside a row can be `perLang` for pair types. That covers committee members, learning-path sections and resources, and privacy sections.
- **New type options on `CmsType`:**
  - `idField`, which replaces the hard-coded `ID_FIELD`;
  - `title`/`date` extractors for the build index;
  - `pairBy: 'translationKey' | 'filename'`;
  - `sides: 'both' | 'either'`;
  - `fixedKeys`, which allows values only;
  - `noCreate`/`noDelete`;
  - `approve: 'group' | 'admin'`;
  - `generated`, meaning no form and the server builds the data.
- The podcast is a `generated` type: "Yeni bölümleri çek" fetches the RSS on the server and makes an update draft.
- Blog moves onto `content_drafts` as a markdown-pair type with `pairBy: 'filename'` and `sides: 'either'`. The writer's `/account` form forwards to the panel.

**Tech Stack:** as plan 3. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-23-content-cms-design.md`. This is plan 4 of 5:
1. roles (#320)
2. collections (#321)
3. core and Etkinlikler (#322)
4. this plan
5. agent access

Facts gathered for this plan: `plan4-inventory` (controller scratchpad); every claim below was checked against the code on `main` at 605653c.

## Calls made in this plan (decided here; the spec left them open)

1. **One İçerik section, not five.** The spec asks for rights per group, not one sidebar entry per group. One section avoids duplicating the 1,300-line panel module, and its editor ids, five times. A person sees only the tabs of the groups they edit, which satisfies "edit rights on Yazılar open /admin with only that group visible". `#icerik-etkinlikler/<rest>` redirects to `#icerik/<rest>`, because PR #325's body links there.
2. **Resource links (`src/content/resources`) join Öğrenme.** The spec's inventory leaves them out.
3. **Learning-path files are normalised once.** A preparatory commit re-renders every `lp-*` file through the CMS serialiser, so later panel edits touch only the lines that changed. `scripts/compare-builds.ts` proves the rendered pages are unchanged. The ids stay double-quoted and stay the first key of each resource, as `tests/lp-resource-ids.test.ts` requires.
4. **A new learning-path resource gets the id `<slug of the English title>-<6 random hex>`.** CLAUDE.md rule 8 says ids are never reused, and git history cannot be checked from a Function. A random suffix makes reuse practically impossible without keeping a list of retired ids. Once saved, an id is read-only.
5. **Committee order uses steps of 10** (0, 10, 20, …), set in a preparatory commit. Then a new committee, or a move, is one file and one draft. `tests/content-committees.test.ts` changes from "contiguous from 0" to "unique, non-negative". The submit step refuses an order that another committee already uses.
6. **The privacy notice becomes `src/content/privacy/privacy.json`** with the shape `{ updated, en, tr }`. The contact address stays in code as `PRIVACY_CONTACT` and is written `{contact}` in the text; the renderer expands it. The form sets `updated` to today whenever another field changes. Only an admin can approve a privacy draft (`approve: 'admin'`).
7. **Blog moves onto the CMS. The old flow is retired, not migrated.**
   - Production has 4 `blog_submissions` rows, all `approved` (PR opened): nothing is in flight.
   - The table stays for the statistics history. Its endpoints and the admin "Blog" section are removed.
   - The one active `writer` grant moves to `content.yazilar.edit` (migration note 8k, run by the owner).
   - `writer` stays in the role catalog as a retired key: it can no longer be granted, and it is shown in role history.
   - The GitHub issue that announced a new submission, which carried the submitter's e-mail, is removed. The panel badge replaces it.
8. **Page texts are values only.** Each `src/content/pages/*.json` is a `fixedKeys` type with no create and no delete. Its form is built from the file's own keys, one bilingual textarea per key, labelled with the key. The server refuses any key that is added or missing compared with `main`.

## Amendments after the GLM and DeepSeek plan review (2026-10-24; binding, and they override the text below where they conflict)

**A1. A file name never changes on update.**
- `idFrom` runs only when an entry is created.
- An update keeps `entry_id`, whatever the data says. 7 of the 8 committee files, and both TeachOpenCADD resources, do not match the slug of their title.
- `checkSameId` applies only to types whose id is itself a data field (`idInData: true`, which today is events only).
- Page texts take their id from the file.

**A2. No test may depend on the text of real content.** A panel edit once broke CI this way (#323).
- Task 3 starts with a sweep of every test that reads `src/content/**`, `src/data/podcast.json` or `src/data/privacy.ts`.
- Assertions about wording, contiguous orders, or exact counts that a legitimate edit can change become structural ones: schema-valid, unique, non-negative, en/tr parity.
- Known cases:
  - `tests/content-committees.test.ts:43-45, 93-96`: contiguous orders.
  - `tests/content-resources.test.ts`: contiguous orders per section.
  - `tests/privacy-page.test.ts:48-64`: the DM wording and the banned old sentences.
- Retention pins that read code constants stay.
- `sortCommittees` and `sortResources` break ties by name or title, so a duplicate order can never fail anything.
- The sweep's report lists every test changed and why.

**A3. Order fields need no cross-file check.**
- Committees and resources are renumbered in steps of 10, in Task 3.
- With A2, a duplicate order only sorts by name. Drop the "order unused" submit check: it raced the deploy lag.

**A4. Rule 8 is enforced from main, not from the index.**
- On save (POST and PATCH), the server assigns an id to every learning-path resource whose `id` is empty: `<slug of the English title, cut to 90 characters>-<6 random hex>`, lower case, matching `^[a-z0-9_-]+$` and at most 110 characters.
- The client never sends a new id.
- At submit, and again at approve against the pinned head, the server reads the entry's two files from main and refuses:
  - any id that is neither on main in this entry nor assigned by the server to this draft (a hand-typed or reused id);
  - ids that differ between en and tr, or are in a different order;
  - a shared field that differs between en and tr.
- This needs no uniqueness check against other files: the only new ids are fresh random ones, and a moved resource keeps its id.
- To record which ids the server assigned, the draft keeps `data._assigned: string[]`. `serialize` strips it, it is never written to git, and the unknown-key check allows it for these types only.

**A5. `sides: 'either'` is handled end to end.**
- `newEntryId` reads whichever side exists, English first.
- `entryPaths`, `base_shas`, `filesFor` and `newPaths` skip an absent side, so no phantom file is written.
- `validateDraft` checks the sides present.
- Pairing keeps the existing rule (same file name unless `translationKey` says otherwise). Drop `pairBy`.
- `pairClash` treats a missing `translationKey` field (the lp schemas have none) as "paired by file name".

**A6. New field kinds:** `objects` (Task 2) and `bilingualStrings`, which is `{ en: string[], tr: string[] }`, two string lists side by side. Privacy paragraphs and items, and resource tags, use it.

**A7. A model can be built from data.** `TypeModel` may carry `fieldsFor(data)` instead of a static `fields`; page texts use it.
- `fixedKeys` compares a PATCH's keys with the draft's own stored data, which the server read from main at create. So it costs no GitHub read per autosave.

**A8. The privacy `updated` date is set by the server at approval** (today, Istanbul time) before the files are written, not by the form. Shape: `{ updated, en: { title, description, intro: string[], sections: [{ heading, paragraphs: string[], items: string[] }] }, tr: { ... } }`. Submit enforces en/tr parity structurally: the same number of intro paragraphs and sections, and the same number of paragraphs and items per section.

**A9. Blog fixes.**
- `/account`'s writer card is shown to anyone with `content.yazilar.edit` or approve (read from `/api/me`'s CMS rights), not `is_writer`.
- `functions/_lib/stats.ts` counts blog posts published through the CMS (`content_drafts` with `type = 'blog'`, `status = 'published'`) plus the old `blog_submissions` history.
- The upload endpoint is not moved; it keeps its path (`/api/blog-submissions/upload-image`), so symposium, social and CMS callers are untouched.
- Also remove `functions/_lib/blog-submission.ts` and its tests, `tests/blog-approval.test.ts`, and any `pull-number` test used only by the removed code. Check each before deleting.
- Update `tests/admin-sections.test.ts`, `tests/role-grants.test.ts`, `tests/me.test.ts` and `tests/atomic-writes.test.ts` for the removed `writer` and blog section.

**A10. Migration 8k.**
- The moved grant ends at the earlier of the old grant's end and 30 days from now. An edit-level role is at most one month.
- The owner renews it in the panel.
- The `writer` grant is ended, with a `role.revoke` audit row.

**A11. Learning-path roadmap.**
- A new stage is appended: `number` = the highest + 1, and the file is `NN-slug`.
- A deleted stage leaves a gap in the numbers, so the test asserts unique numbers, not contiguous ones (A2).

**A12. Normalisation (Task 3) re-renders with `renderNew`, dropping `source`.** `serializeMarkdown` with `source` is byte-identical by design, so it would change nothing.

**A13. Task splits.**
- Task 1 becomes 1a (rights, registry options, the index) and 1b (the İçerik section in the panel).
- Task 6 becomes 6a (resources) and 6b (the three lp types).
- Task 8 becomes 8a (the blog type and `sides: 'either'`) and 8b (retiring the old flow, the /account card, 8k, stats).

**A14. Every task that changes the panel re-runs `admin-overflow.mjs` and `admin-fit-viewport.mjs`.**

**A15. Sub-page ids.** The old ones (`etkinlikler`, `atolyeler`, `webinarlar`) stay, so the `#icerik-etkinlikler/...` alias is a prefix swap. New tabs get Turkish slugs:
- `blog`
- `komiteler`
- `podcast`
- `ogrenme-alanlari`
- `ogrenme-seviyeleri`
- `yol-haritasi`
- `kaynaklar`
- `sayfa-metinleri`
- `gizlilik`

**A16. Podcast.**
- The schema mirrors `tests/podcast.test.ts`'s checks (audio URL, guid, newest first after sort), so a pulled feed cannot fail that test.
- `npm run podcast:sync` stays as the fallback. README says the panel is the normal way.

## Global Constraints

- Everything in plan 3's Global Constraints still holds:
  - git is the source of truth;
  - no silent overwrite;
  - every action is audited;
  - no e-mail addresses or names in PRs;
  - the bytes a draft writes match the repo's format;
  - file names match `^[a-z0-9-]+\.(json|md)$`;
  - images go through `/api/images`;
  - API-first;
  - the D1 budget;
  - UI rules (both languages, the six window sizes plus 390 px, no inner scrollbars, no AI-looking design).
- **Roles.** Four new groups:
  - `yazilar`
  - `ogrenme`
  - `topluluk`
  - `sayfalar`

  Each gets `content.<group>.edit` (edit level, ≤1 month, granted by that group's approver or an admin) and `content.<group>.approve` (leader level, ≤12 months or permanent, admin only). The privacy notice also needs `is_admin` to approve.
- **Rule 8 (learning-path ids) is enforced on the server.**
  - A draft may not change or reuse an id.
  - An id must be unique across every `lp-levels` and `lp-roadmap` file, checked against the build index.
  - The English and Turkish files must carry the same ids, in the same order, with the same `tag`, `url`, `webinarSlug`, `youtubeUrl`, `speaker` and `year` (a Turkish `url` may add a `/tr` prefix).
- **Committee profiles:**
  - `consent: true` is required for every member and shown as a required checkbox.
  - An e-mail address anywhere in the file is refused, by the same `@` rule the test uses.
- **Migration notes 8k (roles) and 8l (if any table change)** go at the top of `db/schema.sql`. The owner runs them before the merge.

## Review Focus

1. **A learning-path edit that would break rule 8.** Examples: a resource deleted from English but not Turkish, two resources swapped in one language only, an id typed by hand through the API, an id that already exists in another file. Every one of these is refused at submit with a field error, and nothing reaches git. Task 6 test.
2. **A blog post in one language only.** It creates, edits and publishes with no empty-twin error, and adding the twin later writes the second file with the same name. Task 8 test.
3. **The podcast feed is down, empty or returns garbage.** "Yeni bölümleri çek" answers in plain words, creates no draft and changes nothing. A feed with no new episodes answers "Yeni bölüm yok". Task 5 test.
4. **A page-text draft that adds or drops a key**, sent directly to the API. It is refused, so CI cannot fail on an unused or missing key after a merge. Task 7 test.
5. **Someone with Yazılar rights only.** They see only the Blog tab, cannot read or approve other groups' drafts, and the Onay list shows only their own group. Task 1 test.

---

### Task 1: One İçerik section and per-group rights

**Files:**
- Modify:
  - `functions/_lib/roles.ts`: `CMS_GROUPS`, `RoleKey`, `ROLES`, eight new roles, and `writer` marked retired (cannot be granted).
  - `src/scripts/admin/sections/users.ts` and `src/i18n/ui.ts`: role rows and labels.
  - `src/lib/cms/types.ts`: new `CmsType` options from Architecture, with defaults so Etkinlikler is unchanged.
  - `functions/_lib/cms-drafts.ts`: `ID_FIELD` replaced by `type.idField`; `PANEL` becomes `#icerik/taslaklar/<id>`.
  - `functions/_lib/cms-api.ts`: `mayApprove` honours `approve: 'admin'`; `fixedKeys`/`noCreate`/`noDelete` enforced in POST, PATCH and DELETE.
  - `src/lib/cms/cms-index.ts` and `src/pages/cms-index.json.ts`: the index is built from `CMS_TYPES` (dir, format, title/date extractors), not per-type branches.
  - `src/scripts/admin/sections.ts`, `src/components/admin/panes/CmsPane.astro`, `src/scripts/admin/main.ts`, `src/scripts/admin/overview.ts`, `src/scripts/admin/sections/cms.ts`:
    - section id `icerik`;
    - tabs = types the person can edit, under group headings;
    - `taslaklar` and `onay` as before;
    - the alias redirect;
    - `setupCms` takes the full rights.
  - `functions/api/admin/counts.ts`: counts across all of a person's groups (the keys stay `cmsMine`/`cmsQueue`/`cmsTotal`).
- Test:
  - `tests/roles-catalog.test.ts`, `tests/admin-users-roles.test.ts`, `tests/cms-api.test.ts`, `tests/cms-access.test.ts`, `tests/admin-counts.test.ts`, `tests/cms-index` (wherever plan 3 tests the index);
  - `tests/browser/cms-etkinlikler.mjs`, renamed `cms-icerik.mjs`;
  - `admin-overflow.mjs`, `admin-fit-viewport.mjs`.

**Interfaces (Produces):**
- `CmsType` gains:
  - `idField: string`, a dotted path into the draft data used for the id error and `newEntryId`;
  - `indexTitle(data, lang): string`;
  - `indexDate?(data): string`;
  - `pairBy`, `sides`, `fixedKeys`, `noCreate`, `noDelete`, `approve`, `generated` (defaults: `'translationKey'`, `'both'`, `false`, `false`, `false`, `'group'`, `false`).
- `rightsFromRoles` covers all five groups.

- [ ] **Step 1: Write the failing tests.**
  - A Yazılar-only editor's `/api/cms/types` lists only Yazılar types; their drafts list and Onay queue contain no Etkinlikler drafts; GET of an Etkinlikler draft is 403.
  - An `approve: 'admin'` type refuses approval by a group approver who is not an admin.
  - A `noCreate` type refuses POST with `action: 'create'`.
  - A `fixedKeys` type refuses a PATCH whose top-level keys differ from `main`'s.
  - The index for Etkinlikler is byte-identical to today's `/cms-index.json` output for the same files.
  - `#icerik-etkinlikler/taslaklar/<id>` opens the same draft as `#icerik/taslaklar/<id>`.
  - Granting `writer` is refused.
- [ ] **Step 2: Implement until green.** `npm test`, `npx astro check`, and the three browser checks pass.
- [ ] **Step 3: Commit.**

### Task 2: The `objects` field kind

**Files:**
- Modify:
  - `src/scripts/admin/cms-form.ts`:
    - `Kind` adds `objects`;
    - `FieldDef` adds `fields?: FieldDef[]` and `rowLabel?`;
    - `readOne`, `writeOne`, `isEmptyValue`, `halfTranslated` and `applyValues` recurse;
    - `placeOf` parses any depth (`sections.0.resources.2.title` → field path, row indices, part, lang);
    - per-lang fields inside rows of a pair type read and write `frontmatter` of each side at the same index.
  - `src/scripts/admin/cms-render.ts`: a repeatable row block with add, remove and up/down (no drag), nested to any depth, and a collapsed one-line summary per row (`rowLabel`) so long lists fit one screen.
  - `src/scripts/admin/cms-diff.ts`: object lists diff by an identity key when one exists (`id` for learning-path resources, `name` for committee members), otherwise by position. Each row shows Eklendi, Çıkarıldı, Taşındı or the changed fields inside it.
- Test: `tests/cms-form.test.ts`.
  - The coverage test walks nested `objects` and accepts `z.record` schemas when the type is `fixedKeys`.
  - Round trips of nested data.
  - `placeOf` at depth 3.
  - Diffs for moved, added and changed rows.

- [ ] **Step 1: Failing tests.** Use synthetic schemas, not real types, for the kind itself. Task 4 and Task 6 add the real models.
- [ ] **Step 2: Implement.** Error messages show the path as labels ("Bölüm 2 › Kaynak 3 › Başlık").
- [ ] **Step 3: Commit.**

### Task 3: Schemas out of `content.config.ts`; one-time normalisations

**Files:**
- Create:
  - `src/data/learning-paths.ts`: `lpDomainSchema`, `lpLevelSchema`, `lpRoadmapSchema`, `lpResourceSchema`. Make `lpResourceSchema` strict, so unknown keys are refused, as the CMS's unknown-key pass expects. First check no file has an unknown key.
  - `src/data/blog.ts`: `blogSchema`.
- Modify:
  - `src/content.config.ts` imports the new schemas.
  - `src/lib/cms/serialize.ts`: Markdown frontmatter keys are written in schema order at every depth (`inSchemaOrder`), not only top level.
  - Every `src/content/lp-*/**/*.md` file is re-rendered by `serializeMarkdown`, in its own commit.
  - Every `src/content/committees/*.json` file gets `order` in steps of 10, in its own commit.
  - `tests/content-committees.test.ts`: orders are unique and non-negative.
- Test:
  - `tests/cms-serialize.test.ts`: after the normalisation, every `lp-*` file round-trips byte for byte.
  - `tests/lp-resource-ids.test.ts` stays green.
  - `scripts/check-lp-links.ts` still finds the same number of URLs: record the count before and after in the report.

- [ ] **Step 1:** Build before (`npm run build`, copy `dist`). Extract the schemas. Normalise the files. Build after.
- [ ] **Step 2:** `npx tsx scripts/compare-builds.ts <before> <after>` reports no difference.
- [ ] **Step 3:** Commit the extraction, the lp normalisation and the committee orders as three commits.

### Task 4: Topluluk — committees

**Files:**
- Modify:
  - `src/lib/cms/types.ts`: `committees` type, group `topluluk`, json, `idField: 'name.en'`, `idFrom` the slug of `name.en`.
  - `src/scripts/admin/cms-form.ts`: the committees model.
  - `functions/_lib/cms-drafts.ts`: the submit checks.
  - `COMMITTEES_GUIDE.md`: the panel is now the way; the steps in the guide become the fallback.
- Model:
  - **main:** name, description, members.
  - **members** (`objects`, `rowLabel` = name): name, role, image (`image: 'url'`, the existing upload), consent (a required checkbox, true only), education, socialMedia.
  - **education** (`objects`): degree, field, institution, year.
  - **socialMedia** (`objects`): platform (select), url.
  - **more:** order.
- Server submit checks:
  - no `@` anywhere in the serialised file;
  - `order` is unused by any other committee in the build index (the index gains `order` for committees).
- Test:
  - `tests/cms-form.test.ts`: every committee file round-trips.
  - `tests/cms-api.test.ts`:
    - an e-mail address is refused;
    - a duplicate order is refused;
    - a member without consent is refused.

- [ ] Steps: failing tests → implement → `npm test`, `astro check` → commit.

### Task 5: Topluluk — podcast ("Yeni bölümleri çek")

**Files:**
- Create:
  - `src/lib/podcast-feed.ts`: the pure parser moved out of `scripts/sync-podcast.ts`. The script imports it and behaves as before.
  - `src/data/podcast.ts`: `podcastSchema`, with keys in the order of today's `podcast.json`.
  - `functions/api/cms/podcast/pull.ts`: `POST`, needs Topluluk edit, has CSRF and the rate limit pattern from `functions/_lib/certificates.ts`.
- Modify:
  - `src/lib/cms/types.ts`: `podcast` type, group `topluluk`, json, `dir: 'src/data'`, fixed id `podcast`, `generated: true`, `noCreate`, `noDelete`.
  - The panel: the Podcast tab shows the episodes on the site and one button.
- Behaviour of `pull`:
  - fetch the feed (10 s timeout, one request) and parse it;
  - validate the result with `podcastSchema`;
  - compare it with `src/data/podcast.json` on `main`.
  - **No change in the episodes:** answer `{ code: 'no_new_episodes' }`. A `syncedAt` difference alone does not count.
  - **A change:** create an `update` draft with the new data, author = the caller, audit `cms.draft.create` with `{ generated: 'podcast' }`.
  - **The feed fails, is empty, or any episode lacks audio or a title:** answer `502 { code: 'feed_failed' }`.
  - The draft then goes through the normal submit, approve and PR flow. The approver sees the episode diff.
- Test: `tests/cms-podcast.test.ts`.
  - The parser on a fixed RSS fixture gives today's `podcast.json` episodes.
  - Feed down → `feed_failed`, no draft row.
  - Same episodes → `no_new_episodes`.
  - One new episode → a draft whose diff is that episode.
  - A rights check.

- [ ] Steps: failing tests → implement → commit.

### Task 6: Öğrenme — learning paths and resource links

**Files:**
- Modify:
  - `src/lib/cms/types.ts`, four types:
    - `lp-domains`: markdown-pair, `pairBy: 'filename'`, id = slug of `name` (en).
    - `lp-levels`: markdown-pair, `pairBy: 'filename'`, id = `${domain}-${level}`; domain and level are locked after create.
    - `lp-roadmap`: markdown-pair, `pairBy: 'filename'`, id = `${NN}-${slug}`, where `NN` is `number` zero-padded.
    - `resources`: json, id = slug of `title.en`.
  - `src/scripts/admin/cms-form.ts`: the four models.
    - lp-levels:
      - sections (`objects`, `rowLabel` = type) → resources (`objects`, `rowLabel` = title);
      - per-lang fields: title, description;
      - shared fields: id (read-only once saved), tag, url, webinarSlug, youtubeUrl, speaker, year;
      - the Webinar-only fields appear when `tag` is Webinar.
    - resources: `tags` is `{ en: string[], tr: string[] }`, shown as two string lists.
  - `functions/_lib/cms-drafts.ts`: a `validatePair` hook per type. For the `lp-levels` and `lp-roadmap` types it enforces the rule 8 checks in Global Constraints; the build index lists every lp id for the uniqueness check. A new resource gets its id from the server when its id is empty (Call 4). The client never invents one.
- Test:
  - `tests/cms-form.test.ts`: round trips of every lp and resources file.
  - `tests/cms-api.test.ts`: every case in Review Focus 1, plus "a new resource gets a fresh unique id on both sides".

- [ ] Steps: failing tests → implement → commit.

### Task 7: Sayfalar — page texts and the privacy notice

**Files:**
- Create:
  - `src/content/privacy/privacy.json`, converted from `src/data/privacy.ts` (Call 6). Run `compare-builds` before and after: no difference.
  - `src/data/privacy-schema.ts`.
- Modify:
  - `src/data/privacy.ts` keeps `PRIVACY_CONTACT` and reads the JSON.
  - `src/components/PrivacyPolicy.astro` expands `{contact}`.
  - `tests/privacy-page.test.ts` reads the JSON.
  - `src/lib/cms/types.ts`:
    - `pages`: json, `fixedKeys`, `noCreate`, `noDelete`, id = the file name;
    - `privacy`: json, `approve: 'admin'`, `noCreate`, `noDelete`.
  - `src/scripts/admin/cms-form.ts`:
    - the page-text model is built from the loaded entry's keys (each key a bilingual textarea, label = the key);
    - the privacy model is `intro` (strings per lang) and sections (`objects`: heading, paragraphs, items, per lang), with `updated` set to today on any change.
- Test:
  - `tests/cms-api.test.ts`: Review Focus 4; privacy approve by a non-admin approver is 403.
  - `tests/cms-form.test.ts`: every page file and the privacy file round-trip.

- [ ] Steps: failing tests → implement → commit.

### Task 8: Yazılar — blog on drafts; the old flow retired

**Files:**
- Modify:
  - `src/lib/cms/types.ts`: `blog`, markdown-pair, `pairBy: 'filename'`, `sides: 'either'`, id = slug of the title of whichever side exists (English first).
  - `functions/_lib/cms-drafts.ts` and `functions/api/cms/*`:
    - `sides: 'either'` lets a draft carry one language;
    - adding the second language later writes `<dir>/<other lang>/<id>.md`;
    - `validateDraft` checks only the sides present.
  - `src/scripts/admin/cms-form.ts`: the blog model.
    - main: title, description, pubDate (default today), author (free text), category, tags, image, body (markdown) per side;
    - more: type, youtubeUrl, speaker, speakerAffiliation, speakerTitle, topic, keyTakeaways, slidesUrl, draft;
    - a "Türkçesini ekle / İngilizcesini ekle" control.
  - `src/pages/account/index.astro` and `src/pages/tr/account/index.astro`: the writer card links to `/admin#icerik/blog` (or `/tr/admin#icerik/blog`) instead of the form; the form and its script are removed.
  - Remove:
    - `functions/api/blog-submissions.ts` (POST and GET);
    - `functions/api/blog-submissions/[id].ts`;
    - `functions/api/admin/blog-submissions.ts` and `[id].ts`;
    - the admin `blog` section and pane;
    - `notifyNewSubmission`;
    - their tests.
  - Keep:
    - `functions/api/blog-submissions/upload-image.ts`, which the CMS uses (move it to `functions/api/cms/upload-image.ts` with a redirect-free rename of the callers);
    - the `blog_submissions` table, read by `functions/_lib/stats.ts`;
    - the `blog.*` audit labels for history.
  - `functions/api/admin/counts.ts` drops the `blog` key. Update the shape test.
  - `db/schema.sql`: note 8k. It inserts a `content.yazilar.edit` grant for each active `writer` grant, with the same end date, then ends the `writer` grants. It is one transaction. Write it as one `--command` with the exact SQL, and run it on a local copy in the test.
- Test:
  - `tests/cms-api.test.ts`: Review Focus 2.
  - The 8k SQL on an in-memory D1 moves one writer and leaves the other roles alone.
  - `tests/atomic-writes.test.ts` and `tests/audit-coverage.test.ts` updated for the removed endpoints.

- [ ] Steps: failing tests → implement → commit.

### Task 9: Docs and go-live

- Modify:
  - README "Content (CMS)": the groups and their types, the one İçerik section, the generated podcast draft, page texts being values only, privacy admin-only, the learning-path id rule, and blog's move.
  - Owner steps:
    1. run 8k before the merge;
    2. after the merge, a trial draft in a second group;
    3. then the grants.
  - CLAUDE.md "Where things live": no new paths beyond the existing row. Rule 8: "the panel generates new ids; never type one by hand".
  - `COMMITTEES_GUIDE.md` (Task 4).
- PR body in the controller's scratchpad, as in plan 3.
- [ ] `npm test`, `npx astro check`, the browser checks; commit "Document the CMS groups".
