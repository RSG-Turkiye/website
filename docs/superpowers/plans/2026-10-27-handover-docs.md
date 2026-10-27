# Handover Docs and In-Panel Help Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the incoming maintainer (who works through an AI agent) a troubleshooting guide, a start page and an accounts inventory in the repo, and give every panel user role guides in a new Help section of `/admin`.

**Architecture:** Repo docs live in `docs/handover/` and are linked from CLAUDE.md. Help guides are Markdown files in a new content collection `help` (`src/content/help/{tr,en}/<slug>.md`), rendered at build time into a new `HelpPane.astro`; client code shows the guides that match the person's live roles. A test keeps guides and the role catalog in step.

**Tech Stack:** Astro 7 content collections, zod (`src/data/`), the admin panel client (`src/scripts/admin/`), `node --test` with tsx, Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-10-27-handover-docs-design.md`

## Global Constraints

- Repo is public: no secret values, personal e-mail addresses, personal names, chat quotes; roles only ("an admin", "the social media publisher", "the website lead").
- Never a concrete `<name>.pages.dev`, `<name>.r2.dev`, `<name>.workers.dev` hostname. The wildcard patterns `*.pages.dev`, `*.r2.dev`, `*.workers.dev` may appear only as warnings.
- Agent docs (`troubleshooting.md`, `accounts.md`, `drill.md`) are English; `docs/handover/README.md` is Turkish.
- Help guides: Turkish written first, English translated from it; same slug in `tr/` and `en/`.
- Every service is on an organisation account (owner, 2026-10-27): Buffer, the Gmail connection and its Google Cloud project on the organisation's Google account; Instagram, LinkedIn, X admin rights with the organisation's accounts; PR token = the organisation's `rsgturkey` GitHub account; Cloudflare = the organisation's account; DNS at DreamHost, changed by the ISCB Student Council. Any fact not confirmed: write "confirm in the handover session".
- No em dashes in user-facing copy (panel strings, guides). Match surrounding code style and comment density.
- No agent tool or route changes; no D1 change; no migration.
- Visual change (Task 3) is shown to the owner before push. Nothing is pushed by implementers.
- Verify: `npm test`, `npx astro check` (0 errors), `npm run build`; also run the suite on Node 22: `/Users/bogrum/.npm/_npx/52027bd8fc0022aa/node_modules/node/bin/node --import tsx --test tests/*.test.ts`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. A person with several roles (e.g. social publisher + Etkinlikler editor) sees each matching guide once, not duplicates; covered in Task 3's `guidesFor` tests.
2. `#yardim/<unknown-slug>` or a slug for a guide the person cannot see opens the Help list, not a blank pane; Task 3 router test.
3. Implied roles: a `social_publisher` (implies `social`) and a content approver (implies edit) also see the editor guide; Task 3 tests.
4. A one-section editor keeps landing in their own section; Help is reached by a link, like Agent tokens, and does not create an Overview; Task 3 sections test.
5. A relative link in `docs/handover/*.md` or a guide pointing at a README anchor that does not exist; Task 1 link test.

---

### Task 1: `docs/handover/` and CLAUDE.md

**Files:**
- Create: `docs/handover/README.md` (TR), `docs/handover/troubleshooting.md`, `docs/handover/accounts.md`, `docs/handover/drill.md`
- Modify: `CLAUDE.md` (pointer near the top + "Working with a non-terminal maintainer" section before "Working style"), `README.md` ("Yearly handover": keep it, add one line linking `docs/handover/accounts.md`)
- Test: `tests/handover-docs.test.ts`

**Interfaces:**
- Produces: `docs/handover/troubleshooting.md` (Task 2's admin and connect-claude guides link to it by repo path, as text, not a site link).

- [ ] **Step 1: Write the failing test** `tests/handover-docs.test.ts`:
  - `the four handover files exist` (README.md, troubleshooting.md, accounts.md, drill.md).
  - `CLAUDE.md points agents at the troubleshooting guide`: CLAUDE.md contains `docs/handover/troubleshooting.md`.
  - `no concrete blocked hostname`: for every file in `docs/handover/` plus `CLAUDE.md`, no match of `/(?<![*\w-])[a-z0-9-]+\.(pages|r2|workers)\.dev/i` (the wildcard `*.pages.dev` passes).
  - `relative links resolve`: every Markdown link in `docs/handover/*.md` whose target is not `http(s):`/`#`/`mailto:` resolves to an existing file; when the target is `README.md#anchor` (or `../../README.md#anchor`), the anchor equals the GitHub slug of some heading in that file (lowercase, spaces → `-`, drop chars other than `[a-z0-9 _-]` and non-ASCII letters kept as GitHub keeps them; implement `githubSlug(heading: string): string` in the test file).
  - `every troubleshooting entry has the five parts`: each `## ` section of troubleshooting.md contains `**Symptom**`, `**Likely causes**`, `**Look at**`, `**Fix**`, `**Who acts**`.
- [ ] **Step 2: Run** `npx tsx --test tests/handover-docs.test.ts`. Expected: FAIL (files missing).
- [ ] **Step 3: Write `docs/handover/README.md`** (Turkish, "Buradan başla", for a person who knows little terminal). Sections exactly as the spec §A lists: site in five lines; one-time agent setup click by click (install Claude Code desktop app or CLI, sign in, open this repo folder; plus `git clone` given as a command to paste); first sentences to give the agent, in a copyable block ("CLAUDE.md ve docs/handover/troubleshooting.md dosyalarını oku, sonra şu konuda yardım et: …"); "Yalnızca senin yaptıkların" with one reason each (secrets, dashboard clicks, merging PRs with `! gh pr merge <n> --squash --repo RSG-Turkiye/website`, approving remote database commands, sending mail, posting); "Ajan sana komut verdiğinde" (`!` prefix runs it in the session; the agent must explain each command in one sentence; never run what was not explained; never paste a secret into chat, secrets go only into the terminal prompt `wrangler pages secret put` asks for); "Ne zaman durup sorarsın" (by role: another admin, the website lead).
- [ ] **Step 4: Write `docs/handover/troubleshooting.md`** (English, for agents). Opening paragraph: who reads it, the five-part entry format, and the rule that the agent hands every command that touches production to the person (CLAUDE.md "Working with a non-terminal maintainer"). One `## ` entry per symptom, each with the five bold parts; link the README section instead of repeating it. Seed entries and the facts to use (verify each against README/CLAUDE.md/code before writing):
  - *Saved in the panel / merged a PR, site unchanged*: Cloudflare Pages sometimes never builds a merge on main (seen 2026-10-26); look at Cloudflare → Pages → website → Deployments for the merge commit; fix = an empty-commit PR (`git commit --allow-empty`), merged by the person (main is protected: PR + 2 required checks). CMS drafts: PR waits for CI, the shepherd merges on the mail tick (README "From draft to live", "When a draft fails"); nobody merges a `cms/*` PR by hand. Symposium site: static, rebuilt by `SYMPOSIUM_DEPLOY_HOOK`; check `/api/symposium` first.
  - *A button does nothing / generic error*: browser console + network tab (the person can copy the failing response), Activity log pane, the person's roles and end dates (Users and roles → Roles), the status banner (README "Connections and the status banner").
  - *"Quota", D1 errors, the usage alert*: free tier 5M reads, 100k writes, 100k Worker requests per day, reset 00:00 UTC; Overview usage card; `wrangler d1 insights rsg-members --sort-type=sum --sort-by=reads --timePeriod=7d` (read-only, agent may run it after the person logs in); per-minute tick queries need an index (CLAUDE.md "Data and the free tier").
  - *CI red on a PR that passes locally*: CI runs Node 22; run the suite with Node 22 locally.
  - *wrangler errors*: 10042 "enable R2" = stale login scopes → `npx wrangler login`; 7403 on `d1 execute --remote` with `--json` → run without `--json`; `--file` needs an absolute path (the parent folder holds a stale `db/schema.sql`); a remote write is always given to the person to run.
  - *Mail stuck / reply not showing*: README "When the queue looks stuck", "Reading replies".
  - *Social post not sent, Buffer error, red banner line*: README "How a post goes out", "Banner lines and what to press", "If a post's answer is lost"; never post or retry a real post yourself.
  - *Claude/ChatGPT connector will not connect, token refused*: role ended or renewed (rights = scope ∩ live grants), token revoked or auto-revoked, daily limits (README "Agent access" → "Limits", "Auto-revoke", "Connecting Claude, ChatGPT and other apps").
  - *A content draft failed*: README "When a draft fails".
  - *Certificates not opening*: README "Symposium certificates" (purged after their window).
  - *Someone lost access*: the role's end date passed; renew in Roles (README "How roles work").
  - *Deleted content still renders locally*: Astro content cache (CLAUDE.md "Known traps").
- [ ] **Step 5: Write `docs/handover/accounts.md`** (English). A table: Service · What it is for · Owning account (kind) · Who holds access after handover (role) · Where its secrets/config live (secret or var NAMES only: read them from README, `wrangler.toml`, `.github/workflows/*.yml`) · Handover action. Rows at least: Cloudflare (Pages `website`, symposium Pages project, D1 `rsg-members`, R2 buckets, the two cron Workers), GitHub org repo + `rsgturkey` account token, Google account (Gmail connection, Google Cloud OAuth project, Drive, Forms/Sheets), Buffer, Instagram/LinkedIn/X, DreamHost DNS (via ISCB Student Council), ISCB yearly renewal. Then "Yearly items" (social tokens, ISCB renewal, Log export) linking README "Yearly upkeep" and "Yearly handover".
- [ ] **Step 6: Write `docs/handover/drill.md`** (English). Who (website lead, else a management-team member; the current chair only watches), when (December 2026), rules (faults set up off live: a branch or a never-merged PR or a local copy; never the live site or real accounts; every stuck point becomes a docs fix the same day), three scenarios each with setup / what the person is told / what "solved" looks like (red CI on a branch with a deliberately failing test; "I saved in the panel but the site did not change" walked through on a past CMS PR and the Deployments list; "the usage alert says 70%" read from the Overview card and `d1 insights`), and the handover-session checklist from the spec §D.
- [ ] **Step 7: Edit CLAUDE.md**: after the intro paragraph add: "When something is broken or a person reports an error, read `docs/handover/troubleshooting.md` first." Add section `## Working with a non-terminal maintainer` before `## Working style`: commands that touch production are handed to the person ready to paste with `!`, absolute paths, one sentence each on what it does; no `--json` on `wrangler d1 execute --remote`; the person merges PRs and runs remote-database writes; never post to real accounts or send mail; show visual changes before pushing (already in "Verifying a change": link, don't repeat).
- [ ] **Step 8: Edit README.md** "Yearly handover": one line under the heading: "The full account and access list is in `docs/handover/accounts.md`."
- [ ] **Step 9: Run** `npx tsx --test tests/handover-docs.test.ts` then `npm test`. Expected: PASS.
- [ ] **Step 10: Commit** `docs: handover start page, troubleshooting guide, accounts and drill`.

### Task 2: Help guides as a content collection

**Files:**
- Create: `src/data/help.ts`, `src/content/help/tr/*.md`, `src/content/help/en/*.md` (9 slugs each)
- Modify: `src/content.config.ts` (register `help`)
- Test: `tests/help-guides.test.ts`

**Interfaces:**
- Produces: `helpSchema` (zod) in `src/data/help.ts`: `{ title: string, roles: (RoleKey | 'all')[] (min 1), order: number }`; `HELP_SLUGS` not needed (files are the list). Collection name `help`, entry ids `tr/<slug>` and `en/<slug>`.
- Slugs (fixed): `connect-claude` (roles `['all']`, order 1), `social` (`['social']`), `social-publisher` (`['social_publisher']`), `content-editor` (all five `content.<g>.edit`), `content-approver` (all five `content.<g>.approve`), `announcer`, `sender`, `symposium`, `admin` (orders 2–9 in this list order).

- [ ] **Step 1: Write the failing test** `tests/help-guides.test.ts` (read files with `fs` and the repo's existing frontmatter parser if one exists, else a small `---` split + `yaml`, whichever `tests/cms-fixtures.test.ts` uses):
  - `every guide parses with helpSchema`.
  - `tr and en have the same slugs`.
  - `every role key in a guide is a real, non-retired role` (`roleDef(k)` non-null, not `retired`), or `all`.
  - `every non-retired role is covered by a guide` in both languages (iterate `ROLES`).
  - `no concrete blocked hostname` (same regex as Task 1) and `no em dash` in guide bodies.
  - `every guide has the four headings`: TR guides contain `## Bu rolle neler yaparsın`, `## Neler yapamazsın, kime sorarsın`, `## Sık yapılan işler`, `## Sık karşılaşılan sorunlar`; EN: `## What you can do`, `## What you cannot do, and who to ask`, `## Common tasks`, `## Common problems`. `connect-claude` is exempt and instead has TR `## Bağlamak`, `## Ne yaptırabilirsin`, `## Asla yapamayacakları`, `## Bağlantıyı kesmek` (EN `## Connecting`, `## What you can ask`, `## What it can never do`, `## Disconnecting`).
- [ ] **Step 2: Run** `npx tsx --test tests/help-guides.test.ts`. Expected: FAIL.
- [ ] **Step 3: Add `helpSchema`** to `src/data/help.ts` and register `help` in `src/content.config.ts` with `glob({ pattern: "**/*.md", base: "./src/content/help" })`, comment style as the neighbours.
- [ ] **Step 4: Write the 9 Turkish guides**, one screen each (aim ≤ 250 words). Facts come from README sections ("The admin panel", "Social media content", "Social media publishing", "Content (CMS)", "Who can do what", "From draft to live", "Agent access", "Connecting Claude, ChatGPT and other apps", "How roles work", "Statistics", "Connections and the status banner", mail sections) and from `src/i18n/ui.ts` for the exact panel labels (use the Turkish label the person sees, e.g. the tab names). Each "Sık yapılan işler" has 2–3 numbered step lists. "Kime sorarsın" names roles only. `connect-claude`: add the connector in claude.ai (steps from the Agent tokens pane strings `admin.tokens.connect.claude.step1..5`), what to ask (draft and submit content or social posts, read published items; approvers' Claude may also read the team's drafts), never (approve, publish, schedule, send mail or DMs), 3 example requests, disconnecting (claude.ai side and the panel's Agent tokens list), one paragraph on personal tokens for terminal agents. `admin` mentions `docs/handover/` in the repo for technical problems.
- [ ] **Step 5: Translate each to English** under `en/` with the same slug and the English panel labels from `src/i18n/ui.ts`.
- [ ] **Step 6: Run** `npx tsx --test tests/help-guides.test.ts`, `npx astro check`. Expected: PASS, 0 errors.
- [ ] **Step 7: Commit** `docs: role guides for the panel's Help section (tr, en)`.

### Task 3: Help section in the panel

**Files:**
- Create: `src/components/admin/panes/HelpPane.astro`, `src/scripts/admin/sections/help.ts`
- Modify: `src/scripts/admin/sections.ts` (section `yardim`, `LINKED_SECTIONS`), `src/scripts/admin/router.ts` (free slug sub for `yardim`), `src/scripts/admin/shell.ts` + `src/components/admin/AdminShell.astro` (a Help link beside the Agent tokens link, same pattern), `src/scripts/admin/main.ts` (wire the section), `src/i18n/ui.ts` (`admin.help.heading` "Help"/"Yardım", `admin.help.intro`, `admin.help.back`), `README.md` "The admin panel" (one bullet for Help), `tests/browser/admin-overflow.mjs` only if it lists sections by hand
- Test: `tests/admin-help.test.ts`, extend `tests/admin-sections.test.ts`, `tests/admin-router.test.ts`

**Interfaces:**
- Consumes: collection `help` (Task 2), `grantedRoles(u)`, `roleDef(key).implies`, `rightsFromRoles` from existing code.
- Produces: `guidesFor(guides: { slug: string; roles: string[] }[], held: readonly string[], admin: boolean): string[]` in `src/scripts/admin/sections/help.ts`: slugs in input order, each at most once; a guide matches if it has `all`, if `admin`, or if a role in `held` or implied by one (`social_publisher` → `social`; `content.<g>.approve` → `content.<g>.edit`) is in its roles.

- [ ] **Step 1: Write failing tests** `tests/admin-help.test.ts`:
  - `admin sees every guide`.
  - `a social editor sees connect-claude and social only`.
  - `a social publisher also sees the social editor guide`.
  - `an Etkinlikler approver sees content-approver and content-editor`.
  - `publisher + Etkinlikler editor: each guide once` (no duplicates; order = input order).
  - `no roles: connect-claude only`.
  Extend `admin-sections.test.ts`: `yardim` is in `LINKED_SECTIONS`; a social-only editor's `menuSections` has no `genel` and `landing` is `sosyal`; `visibleSections` includes `yardim` for anyone with a work section. Extend `admin-router.test.ts`: `#yardim/social` keeps `sub: 'social'`; `#yardim/../x` and `#yardim/NOPE!` give `sub: null`; a valid-looking unknown slug gives `sub` kept by the router and the pane falls back to the list (pane-level, see Step 4).
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement** `yardim` in `SECTIONS` (group `sistem`, `subs: []`, `visible: () => true`), add it to `LINKED_SECTIONS`; router: for section `yardim`, accept `sub` matching `/^[a-z0-9-]{1,64}$/`; `guidesFor` as specified; shell link `data-help-link` mirroring `data-tokens-link` (hidden while Help is open; shown when Help is not in the menu).
- [ ] **Step 4: Implement `HelpPane.astro`**: `<section data-section="yardim">`, heading, intro line, a list of guide titles (links `#yardim/<slug>`) and one `<article data-guide="<slug>" data-roles="...">` per guide of the panel's language, rendered with Astro `render()`; prose styles consistent with the panel (reuse existing prose classes if the site has them, else minimal: headings `text-navy font-semibold`, lists with markers, `max-w-prose`). Client (`sections/help.ts`): on show, compute `guidesFor` from `/api/me` data already in the panel context, hide non-matching list items and articles; with a sub that is a visible slug show only that article plus a `admin.help.back` link to `#yardim`; otherwise show the list. No inner scrollbars.
- [ ] **Step 5: Run** unit tests, `npx astro check`, `npm run build`, Node 22 suite. Expected: PASS, 0 errors.
- [ ] **Step 6: Browser check**: run `tests/browser/admin-overflow.mjs` (Help included) and take screenshots of `#yardim` and `#yardim/connect-claude` for an admin and a social-only editor, TR and EN, at 390 px and 1280×680, into the scratchpad. Expected: no horizontal scroll, 44 px touch targets.
- [ ] **Step 7: Commit** `feat(admin): Help section with role guides`.
