# CMS Core and the Etkinlikler Group Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members with the Etkinlikler role add and edit events, workshops and webinars from the admin panel. An approver approves the change, the site opens a pull request, and the pull request merges itself once the checks pass. Nobody touches GitHub.

**Architecture:**
- A type registry (`src/lib/cms/types.ts`) describes each editable content type: its group, its folder, its file format (one JSON file, or a Markdown TR/EN pair), and its zod schema from `src/data/*.ts`.
- Serialisers turn an entry into exactly the bytes that are in the repo, and back again.
- Drafts and the review queue live in a new D1 table, `content_drafts`. Published content lives only in git.
- On approval, `openContentPR` commits the draft's files to a `cms/<draft id>` branch.
- A "shepherd" on the per-minute tick updates each such branch when `main` moves and squash-merges it once the required checks pass.
- The panel's form is generated from the schema's JSON Schema (`z.toJSONSchema(schema, { io: 'input' })`).
- Every action goes through a JSON API under `/api/cms/*`, so plan 5's agents use the same calls the panel does.

**Tech Stack:** Cloudflare Pages Functions, D1, the GitHub REST API (the rsgturkey token, `GITHUB_PAT`), zod 4 (`z.toJSONSchema`), `yaml` 2 (a new explicit dependency), and the existing admin panel client (`src/scripts/admin/*`).

**Spec:** `docs/superpowers/specs/2026-10-23-content-cms-design.md`. This is plan 3 of 5:
1. roles (#320)
2. content into collections (#321)
3. CMS core and the Etkinlikler group (this plan)
4. remaining groups, and moving blog onto the drafts table
5. agent access

## Global Constraints

- **Git is the only place published content lives.** D1 holds drafts and review state only. A draft never changes the site until its pull request is merged.
- **No silent overwrite.** A draft records the git blob sha of every file it started from. Approval refuses with `code: 'changed_since'` when any of those files changed on `main`, and returns what changed.
- **Rights.** `content.etkinlikler.edit` can create, edit and submit drafts. `content.etkinlikler.approve` can do the same and can also approve, send back and delete; an approver may publish their own draft. An admin can do everything. An approver may grant `content.etkinlikler.edit` for at most 1 month; only an admin grants approve.
- **Activity log:** every action writes an audit row in the same batch as its change (CLAUDE.md rule 9). New codes get names in both languages in `src/lib/audit-labels.ts`.
- **Public repository.**
  - Pull request titles, bodies and commit messages carry the content type, the entry id and the draft id. They never carry e-mail addresses or member names.
  - The branch name is `cms/<draft id>`.
- **The bytes a draft writes must match the repo's format exactly.**
  - JSON: 2-space indent, keys in schema order, a trailing newline.
  - Markdown: YAML frontmatter followed by the body.
  - Opening an existing entry and saving it unchanged produces a byte-identical file. Task 2 proves this for every existing file.
- **Content file names match `^[a-z0-9-]+\.(json|md)$`.**
  - JSON types check this already (plan 2).
  - Webinars keep their existing names. New webinar names follow the rule.
- **Images:** uploaded to R2 through the existing upload endpoint and served through `/api/images/<key>`. Schemas already reject `*.r2.dev`, `*.pages.dev` and `*.workers.dev`.
- **API-first.**
  - The panel uses only `/api/cms/*`.
  - Every endpoint answers JSON with `{ error, code }` on failure, and never echoes GitHub's response body.
- **D1 budget:** the shepherd's per-minute query is indexed and reads 0 rows when nothing is pending.
- **UI:**
  - Strings in both languages in `src/i18n/ui.ts`.
  - Before push, the visual change is shown to the owner at 1280×680, 1366×768, 1440×800, 1536×864, 1440×900, 1920×1080 and 390 px.
  - No horizontal scroll, no inner scrollbars, 44 px touch targets on phones.
  - No generic "AI-looking" design.
- **Migration** note **8j** at the top of `db/schema.sql`.

## Review Focus

1. **Two approvals close together.** `main` is strict (branches must be up to date), so the second pull request falls behind when the first merges. The shepherd must update it and merge it later, never leave it stuck. Task 6 test.
2. **A pull request whose checks fail.** For example, the schema rejects the content, which `astro check` or the build catches. The draft goes to `pr_failed` with a readable reason in the panel, and its author can fix and resubmit it. Nothing is merged. Task 6 test.
3. **An entry edited by hand on GitHub while someone's draft of it is open.** Approval refuses with `changed_since`; nothing is overwritten. Task 4 test.
4. **A webinar pair.** Editing a webinar edits its EN and TR files in one draft and one pull request. A new webinar creates both files with the same `translationKey`, or the same file name, so the existing pairing rule holds. Task 2 and Task 4 tests.
5. **Someone without rights calling the API directly**, for example an `edit` holder calling approve, or a user with no CMS role reading drafts. The call gets 403, and no draft content leaks in the error. Task 4 test.

---

### Task 1: Content-group roles and panel access

**Files:**
- Modify: `functions/_lib/roles.ts`. Add `content.etkinlikler.edit` (edit-level, `approverRole: 'content.etkinlikler.approve'`) and `content.etkinlikler.approve` (leader-level). No `column`. Widen `RoleKey` and `approverRole` to match.
- Create: `functions/_lib/cms-access.ts`:
  - `groupRights(db: D1Database, user: User, now: number): Promise<Record<CmsGroup, { edit: boolean; approve: boolean }>>`, read from `activeGrants` plus `is_admin`.
  - `type CmsGroup = 'etkinlikler'`. Plan 4 widens it.
- Modify: `functions/_lib/auth.ts` `canSeeAdminPanel`. It takes an optional `extra: boolean`, the result of `groupRights(...).some edit`, so a content-only member can open `/admin`. Update the call sites so they pass it.
- Modify: `functions/api/admin/users.ts` and the Roles view (`src/scripts/admin/sections/users.ts`) so the two new roles appear as cards with the same duration rules. Let a non-admin approver reach the grant call for edit-level roles of their group: the PATCH accepts it when `resolveExpiry` allows it with `isAdmin: false`.
- Modify: `src/lib/audit-labels.ts` if new codes appear (grants reuse `role.grant` and `role.revoke`).
- Test: `tests/cms-access.test.ts`, and extend `tests/roles-catalog.test.ts` and `tests/admin-users-roles.test.ts`.

**Interfaces:**
- Produces: `groupRights`, `CmsGroup`, and the role keys `content.etkinlikler.edit` and `content.etkinlikler.approve`.

- [ ] **Step 1: Write the failing tests.**
  - `groupRights` for an admin, an editor, an approver, and someone whose edit grant has expired.
  - A non-admin approver can grant `content.etkinlikler.edit` for 1 month, gets `too_long` for 2 months, and gets `not_allowed` for `content.etkinlikler.approve`.
  - A content-only editor passes `canSeeAdminPanel`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` and `npx astro check`.**
- [ ] **Step 5: Commit.** `git commit -m "Etkinlikler content roles"`

### Task 2: Type registry and byte-exact serialisers

**Files:**
- Create: `src/lib/cms/types.ts` (the registry), `src/lib/cms/serialize.ts` (JSON and Markdown serialisers), `src/lib/cms/json-schema.ts` (JSON Schema per type).
- Modify: `package.json`. Add `yaml` as a dependency, at the version already installed, 2.9.x.
- Test: `tests/cms-serialize.test.ts`

**Interfaces:**
- Produces:
  - `interface CmsType { key: 'events' | 'workshops' | 'webinars'; group: CmsGroup; dir: string; format: 'json' | 'markdown-pair'; schema: ZodType; idFrom: (data) => string; label: { en: string; tr: string } }`
  - `CMS_TYPES: readonly CmsType[]` and `cmsType(key): CmsType | null`.
  - `serializeJson(type, data): string` and `parseJson(type, text): data`.
  - `serializeMarkdown(type, { frontmatter, body }): string` and `parseMarkdown(type, text): { frontmatter, body }`.
  - `markdownPairPaths(type, id): { en: string; tr: string }`, i.e. `src/content/webinars/{en,tr}/<id>.md`.
  - `jsonSchemaFor(type): object`, which is `z.toJSONSchema(schema, { io: 'input' })`. For Markdown types this is the frontmatter schema plus a `body` string.

- [ ] **Step 1: Write the failing tests.**
  - For **every** existing file under `src/content/{events,workshops}` and `src/content/webinars/{en,tr}`, `serialize(parse(file)) === file` byte for byte.
  - `jsonSchemaFor` works for all three types and marks `start` as `{type:'string', format:'date'}`.
  - The registry's `dir` values exist.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
  - If a few existing files are not byte-stable because of quoting or key order quirks, normalise those files in this commit. Prove with `scripts/compare-builds.ts` that the rendered site is unchanged, and list the files in the report.
  - The Markdown serialiser keeps the frontmatter's key order and quoting style. Use the `yaml` Document API and keep the original document where the draft didn't change a key.
- [ ] **Step 4: Run `npm test` and `npx astro check`; run compare-builds if any file was normalised.**
- [ ] **Step 5: Commit.** `git commit -m "CMS type registry and byte-exact serialisers"`

### Task 3: GitHub multi-file commits with deletes and blob shas

**Files:**
- Modify: `functions/_lib/github.ts`:
  - `openContentPR` accepts `files: { path; content: string | null }[]`. `null` deletes the file through the contents API with the file's sha.
  - Add `fileShasOnBase(paths: string[], env): Promise<Record<string, string | null>>`, returning each file's blob sha on `main`, or `null` when the file is absent.
  - Add `prStatus(prNumber, env): Promise<{ state: 'open' | 'merged' | 'closed'; mergeable_state: string; checks: 'pending' | 'success' | 'failure'; headSha: string }>`, using the required-check names from branch protection.
  - Add `updateBranch(prNumber, env)` and `mergePr(prNumber, env)` (squash, with the PR title as the commit title).
- Test: `tests/github-cms.test.ts`, with a fake `fetch` in the style of the existing github tests (grep `tests/` for `openContentPR`).

**Interfaces:**
- Produces: the functions above, with no change to existing callers' behaviour (blog approval, symposium archive).

- [ ] **Step 1: Write the failing tests.**
  - A delete sends DELETE with the sha.
  - `fileShasOnBase` maps a 404 to `null`.
  - `prStatus` folds check runs into pending, success or failure, counting only the required checks.
  - `updateBranch` and `mergePr` hit the right endpoints.
  - Existing callers' tests still pass.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.**
- [ ] **Step 5: Commit.** `git commit -m "GitHub helpers for CMS pull requests"`

### Task 4: Drafts table and the CMS API

**Files:**
- Modify: `db/schema.sql`. Add the `content_drafts` table with indexes, and note **8j** (create table, IF NOT EXISTS).

```sql
CREATE TABLE IF NOT EXISTS content_drafts (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,          -- CmsType.key
  entry_id    TEXT NOT NULL,          -- the file id (new or existing)
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  data        TEXT NOT NULL,          -- JSON: the entry (or {en:{frontmatter,body}, tr:{...}} for markdown pairs)
  base_shas   TEXT NOT NULL DEFAULT '{}', -- JSON: path -> blob sha on main when the draft started (null = new file)
  status      TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','pr_open','pr_failed','published','rejected','discarded')),
  author_id   TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT,
  review_note TEXT,
  pr_url      TEXT,
  pr_number   INTEGER,
  failure     TEXT,                   -- short reason shown in the panel
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_content_drafts_author ON content_drafts(author_id, status);
```

- Create: `functions/api/cms/types.ts` (GET: the types this user can edit, with JSON Schema and labels), `functions/api/cms/entries.ts` (GET `?type=`: id plus title for every entry on `main`, read from a build-time index; see below), `functions/api/cms/entry.ts` (GET `?type=&id=`: the current file(s) from `main` through GitHub, parsed, plus their shas), `functions/api/cms/drafts.ts` (GET: my drafts, plus the approval queue for approvers; POST: create), `functions/api/cms/drafts/[id].ts` (GET; PATCH: save `data` while the draft is `draft`, `rejected` or `pr_failed`; DELETE: discard), `functions/api/cms/drafts/[id]/submit.ts`, `approve.ts` and `reject.ts`.
- Create: `src/pages/cms-index.json.ts`, a static build-time index `{ [type]: { id, title }[] }`. It holds published content only, which is public anyway.
- Create: `functions/_lib/cms-drafts.ts`, which does validation and transitions:
  - `validateDraft(type, data)` validates against the zod schema. It returns path → message errors, which the form shows next to each field.
  - `filesFor(draft)`: path → content, or `null` for a delete.
  - The state transition rules.
- Modify: `src/lib/audit-labels.ts`. Add `cms.draft.create`, `cms.draft.update`, `cms.draft.submit`, `cms.draft.approve`, `cms.draft.reject`, `cms.draft.discard`, `cms.pr.open`, `cms.pr.merged` and `cms.pr.failed` (both languages).
- Test: `tests/cms-api.test.ts`, on real SQLite with a fake GitHub.

**Interfaces:**
- Consumes: Task 1 `groupRights`; Task 2 the registry and serialisers; Task 3 `openContentPR`, `fileShasOnBase`.
- Produces:
  - The endpoints above.
  - Approve flow:
    1. Check rights.
    2. Re-read the base shas; if any changed, return 409 `changed_since` with the paths.
    3. Validate.
    4. Call `openContentPR` with branch `cms/<id>` and title `CMS: <action> <type> <entry_id>`.
    5. Set status `pr_open` with `pr_url`/`pr_number`, and write the `cms.draft.approve` and `cms.pr.open` audit rows.

- [ ] **Step 1: Write the failing tests.**
  - The full happy path: create, save, submit, approve, PR opened (fake).
  - Edit-only cannot approve (403).
  - Someone with no role gets 403 on every endpoint, and the error body carries no draft data.
  - Approving one's own draft as an approver is allowed.
  - `changed_since` when a base sha differs.
  - A webinar draft produces exactly two files.
  - A schema-invalid save returns per-field errors.
  - Delete produces `null` files.
  - Every transition writes its audit row.
  - The PR title and body contain no `@`.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test` and `npx astro check`; the audit-coverage and audit-labels tests stay green.**
- [ ] **Step 5: Commit.** `git commit -m "Drafts table and CMS API"`

### Task 5: Image uploads for content editors

**Files:**
- Modify: `functions/api/blog-submissions/upload-image.ts`. Content editors of any group may upload, using `groupRights`. Add an audit row if the endpoint lacks one.
- Test: extend that endpoint's tests.

- [ ] **Step 1: Write the failing test.** An Etkinlikler editor gets 200; a plain member gets 403.
- [ ] **Step 2: Run it to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.**
- [ ] **Step 5: Commit.** `git commit -m "Content editors can upload images"`

### Task 6: The pull-request shepherd

**Files:**
- Create: `functions/_lib/cms-shepherd.ts`, with `shepherd(env, now): Promise<{ merged: number; updated: number; failed: number }>`.
- Modify: `functions/api/mail/dispatch.ts`. Call `shepherd` on every tick, before the sending-window early return. It is wrapped like the role sweep, so it never blocks mail.
- Test: `tests/cms-shepherd.test.ts`

**Interfaces:**
- Consumes: Task 3 `prStatus`, `updateBranch`, `mergePr`; the `content_drafts` rows with `status='pr_open'` (index `idx_content_drafts_status`).
- Produces, per open draft:
  - Merged on GitHub → `published`, with audit `cms.pr.merged`.
  - Closed without merging → `pr_failed` with "closed on GitHub".
  - Checks failed → `pr_failed`, with a short reason naming the failed check. Audit `cms.pr.failed`.
  - Behind `main` → `updateBranch`, with no status change.
  - Checks green and up to date → `mergePr`.
  - Checks pending → nothing.
  - At most 5 GitHub calls per tick in total, oldest first, so a backlog can't exhaust the rate limit.

**Amendments (2026-10-24, from the GLM and DeepSeek review of this plan). These are binding:**
- **Conflicts.** `mergeable_state: 'dirty'`, or an `updateBranch` 422 caused by a conflict, sets the draft to `pr_failed` with the reason "conflicts with a newer change; start a new draft". Never loop on it.
- **Age cap.** If a draft has stayed `pr_open` for more than 6 hours (pending checks, `unknown`, or `blocked`), set it to `pr_failed` with "checks did not finish". `unknown` and `blocked` are only "ask again later" until the cap.
- **Retries make new checks.** Retrying a `pr_failed` draft goes through `openContentPR` with `resetBranch`. The branch is reset to `main` and the files are committed again, which creates a new head commit, so the checks run again. A test asserts that the head sha changes on retry.
- **One live draft per entry.** Submitting a draft is refused with 409 `entry_busy` while another draft of the same `(type, entry_id)` is `submitted`, `approved` or `pr_open`. This change goes in `cms-drafts.ts`, the submit endpoint and their tests. Otherwise a stale full-file rewrite could revert a newer merge.
- **Budget in fetches, round robin.**
  - Count HTTP requests, not helper calls: at most 12 GitHub fetches per tick, because Workers free has about 50 subrequests per invocation, shared with the mail work.
  - Run the shepherd after the mail work in the tick.
  - Add `last_checked_at INTEGER` to `CREATE TABLE content_drafts` (the table is unreleased, so this is not an ALTER). Pick drafts by `last_checked_at` ascending (nulls first), so slow PRs cannot starve newer ones.
- **Guarded writes.** Every shepherd state change uses the `write_nonce` pattern with `runGuardedWithAudit` (`WHERE status='pr_open' AND write_nonce=?`). Two overlapping ticks then write each change and audit row exactly once.
- **"Published" only when the site shows it.** Merging sets the new status `merged` ("Yayına çıkıyor, birkaç dakika"). The draft becomes `published` when the deployed site's `/cms-index.json` shows the draft's files, read through `env.ASSETS`.
  - Have `src/pages/cms-index.json.ts` include each file's git blob sha, computed at build as sha1 of `"blob <len>\0" + bytes`. Compare it with the PR's file shas.
  - For a delete, the entry is absent.
  - Add `merged` to the status CHECK list.
  - If `merged` lasts more than 2 hours, show "Birleşti ama site güncellenmedi, yöneticiye haber ver" and stay `merged`. Never claim `published` falsely.
- **Retention.** Once an hour, on the prune tick, delete `published`, `discarded` and `rejected` drafts older than 90 days. The audit log keeps the history. Leave `pr_failed` drafts alone.
- **Native GitHub auto-merge was considered and not used.** It needs an owner setting, and with strict up-to-date protection it still does not update behind branches, so `updateBranch` stays. Write a comment saying so.

- [ ] **Step 1: Write the failing tests.** Cover each branch above with a fake GitHub:
  - Two drafts where the second is behind after the first merges. It is updated on the next tick and merged on the one after (Review Focus 1).
  - Failing checks lead to `pr_failed` with a reason (Review Focus 2).
  - Nothing pending means one indexed SELECT and 0 GitHub calls.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run `npm test`.**
- [ ] **Step 5: Commit.** `git commit -m "Shepherd CMS pull requests to merge"`

### Task 7: The Etkinlikler panel

**Files:**
- Modify: `src/scripts/admin/sections.ts`. Add section `icerik-etkinlikler` under group `icerik`, visible to Etkinlikler editors, approvers and admins. Its sub-pages are `taslaklar` (my drafts), `onay` (the approval queue, for approvers only) and one sub-page per type: `etkinlikler`, `atolyeler`, `webinarlar`.
- Create: `src/scripts/admin/sections/cms.ts` (list, open, form, actions) and `src/scripts/admin/cms-form.ts`. The form renderer takes JSON Schema and handles:
  - `string`
  - `string` with `format: date` (a date input)
  - enum (a select)
  - boolean
  - number
  - arrays of strings, and arrays of objects (add, remove and reorder rows)
  - `{en,tr}` objects (two fields side by side, stacked on phones)
  - nested objects
  - a Markdown `body` (a textarea)
  - image fields (the existing upload and crop widget)
- Create: `src/components/admin/panes/CmsPane.astro`. Modify `AdminShell.astro` and `main.ts` to wire it.
- Modify: `src/i18n/ui.ts` (both languages).
- Test: `tests/browser/cms-etkinlikler.mjs` (Playwright with mocked `/api/cms/*`, in the style of `tests/browser/user-roles.mjs`) and `tests/cms-form.test.ts` (pure form-model logic: schema plus data → fields → data round trip).

What changes for the person using it:
- Open the Etkinlikler section, pick a type, and see the list of published entries (newest first) with a "New" button.
- Open an entry to get the form, with the current values from `main`.
- Save the draft, then send it for approval. Field errors show next to the field.
- My drafts list each draft's status in plain words: Taslak, Onay bekliyor, Yayına gidiyor, Yayında, Geri gönderildi (with the reason), Hata (with the reason).
- Approvers see the queue. For each entry they see the changes against the published version, field by field, old → new, and they approve or send back with a note.
- "Changed since you started" shows which file changed and offers "Reload and reapply my changes".
- A published draft links to the live page.

**Amendments (2026-10-24, from the GLM and DeepSeek review; binding):**
- **Labels say what happens.** Use "Kaydet (siteye gitmez)" and "Onaya gönder". A banner on every draft says "Bu taslak henüz sitede değil". After approval the panel says publishing takes a few minutes, and shows Yayına çıkıyor, then Yayında.
- **Don't lose work.** Autosave the draft at most every 20 s once it has changed. Add a `beforeunload` and in-panel navigation guard for unsaved changes. If the session has expired, say so and keep the form contents.
- **No silent re-apply.** Replace "Reload and reapply my changes" with a side-by-side view: what is on the site now on one side, the draft on the other. The editor copies across what they want and keeps the draft. No automatic merge.
- **Ids are not typed by people.** For a new entry, derive the id or file name from the title (or from `repo` for workshops) using the registry's `idFrom`, show it read-only, and let it change only while the draft is new.
- **Approver diff by item.** Arrays show added, removed and moved items, not "the whole list changed". `{en,tr}` fields show both languages.
- **Both languages are required on submit.** Before submitting, warn about any `{en,tr}` field where one language is empty. The schema already rejects empty required strings; this warning catches what reaches the server as valid but half-translated.
- **Errors in plain words.** Map API codes to Turkish and English sentences: `changed_since`, `entry_busy`, `superseded`, `github_failed`, a failed check name ("Sitenin otomatik kontrolü bu değişikliği kabul etmedi: …"), conflict, and timeout. Show field errors with the field's label, not a path like `links[0].url`.
- **Markdown preview.** The webinar `body` gets a simple rendered preview toggle. Use the site's own markdown renderer if one runs client-side; otherwise use plain paragraphs and links, and don't add a library just for this.
- **Delete flow.** An approver can delete an entry: a confirm step, then a delete draft, which goes through approval like any other change.
- **Badges.** The section's menu badge counts my drafts that need action (`rejected`, `pr_failed`), and for approvers the `submitted` queue. Wire it into the existing counts endpoint, `/api/admin/counts`.
- **Deep links.** Route `#icerik-etkinlikler/taslaklar/<id>`, the link the PR body uses, so it opens that draft.
- **Test the real schemas.** `tests/cms-form.test.ts` converts every `CMS_TYPES` schema with `jsonSchemaFor`, and asserts the renderer handles every keyword that appears in the output. A hand-built fixture alone is not enough.

- [ ] **Step 1: Write the failing tests.**
  - `cms-form.test.ts`: the event schema plus symposium-2026 → form model → data deep-equals the input. An edited `when.tr` comes back changed. A webinar `body` round-trips.
  - The browser check covers: the list renders, the form saves (a PATCH body has the edited field), submit and approve call the right endpoints, a 409 `changed_since` shows the reload prompt, and the phone layout has no horizontal scroll.
- [ ] **Step 2: Run them to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the browser check against a preview, `npm test` and `npx astro check`.** Check the seven sizes: no horizontal scroll, no inner scrollbars.
- [ ] **Step 5: Commit.** The controller shows the owner a local preview before push. `git commit -m "Etkinlikler content panel"`

### Task 8: Docs and the go-live steps

**Files:**
- Modify:
  - README: a new section "Content (CMS)" covering who can do what, the draft → approval → PR → auto-merge flow, what to do when a PR fails, and the owner steps below.
  - CLAUDE.md "Where things live": `src/lib/cms/`, `functions/_lib/cms-*.ts` and `/api/cms/*`. Add one rule line: content is changed through the CMS or a PR, and drafts never publish themselves.
- PR body (uncommitted): note 8j before the merge; no Worker redeploy, because the shepherd rides the existing tick; the owner's dashboard step.

Owner steps to document, done by the owner and never by an agent:
1. Run note 8j on the remote D1 before merging.
2. In Cloudflare Pages → website → Settings → Builds → Branch control, exclude `cms/*` from preview builds. Otherwise every CMS draft queues a preview build ahead of production; builds run one at a time on the free plan.
3. Grant the first `content.etkinlikler.*` roles in the Roles view.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run `npm test` and `npx astro check`.**
- [ ] **Step 3: Commit.** `git commit -m "Document the CMS"`
