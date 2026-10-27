# Handover docs and in-panel help: design

Date: 2026-10-27. Roadmap item 7 (handover, January 2027).

## Why

In January 2027 the chair who built most of this site hands it over. The
person who takes it over will be the website lead if there is one, otherwise
someone from the management team. They know little terminal and will do the
technical work through an AI coding agent (Claude Code or similar).

The moment the docs are for: a month after the handover something breaks
(an error, a button that does nothing, a panel save that never reaches the
site, a GitHub or Cloudflare problem, an AI connector that will not connect)
and today they would have to call the former chair. Success is that they, with
their agent, fix it from the docs, and know which steps only a person may do.

Second audience: the members who use the panel (social media, content
editors and approvers, announcers, senders, symposium, admins). They need to
know what their role lets them do, what it does not, and how to do the usual
tasks, including through Claude.

## Goals

1. An agent-readable troubleshooting guide, by symptom, that an AI agent
   opened in this repo finds and follows on its own.
2. A short Turkish start page for the human maintainer: set up the agent,
   what to tell it, what only a person does, how to run the commands the agent
   hands over, when to stop and ask.
3. An accounts-and-access inventory: which services exist, which account owns
   each, where each secret is set (names and places, never values), and how
   each is handed over.
4. Role guides inside the admin panel (a new Help section), one per role,
   bilingual, each person seeing the guides for the roles they hold.
5. A "Connect Claude to the panel" guide in the same Help section, for everyone.
6. A crash drill and a handover-session checklist, run in December with the
   incoming maintainer.

## Non-goals

- No new panel features beyond the Help section. Scope is closed (owner,
  2026-10-23).
- No video tutorials, no external wiki, no Drive or PDF copies (owner: the
  guides live in the panel).
- No rewrite of the README. The troubleshooting guide indexes into README
  sections and adds only what is missing.
- Not the whole-admin design pass. The Help section uses the existing panel
  styles; the later design pass restyles it with everything else.

## Anti-goals (would make this a failure even if it ships)

- A guide that tells the human to type terminal commands from memory. Every
  command reaches the human from the agent, ready to paste.
- An agent that, following the guide, pushes, merges, writes the remote
  database, sets secrets, sends mail or posts to social accounts without a
  person approving that one action.
- Any secret value, personal e-mail, personal name, or `*.pages.dev`,
  `*.r2.dev`, `*.workers.dev` hostname in the docs (public repo, CLAUDE.md
  rules 1, 2, 7).
- Role guides that drift from what the roles actually allow.
- A drill run against the live site or real accounts.

## Constraints

- Repo is public. Service and account kinds may be named ("the organisation's
  Google account", "the rsgturkey GitHub account"); secret values, personal
  addresses and personal names may not.
- Repo docs for agents are English, like the rest of the repo. The human start
  page is Turkish (my call: the incoming maintainer reads Turkish first; an
  English twin is cheap to add later if needed).
- Role guides are Turkish and English, shown in the panel's current language
  (my call, owner did not object).
- Content edits to Help guides should be possible through a normal PR. Help
  guides are NOT a CMS content type (my call: they describe the panel itself
  and change with code, so they belong with the code; adding them to the CMS
  is scope the owner closed).
- Show-before-push for the Help section (screenshots or live local links, six
  window sizes, no inner scrollbars), as for every visual change.

## What gets built

### A. `docs/handover/` (repo, markdown)

- `README.md` (Turkish, human): "Buradan başla". Sections:
  - What this site runs on, in five lines (Astro site, Cloudflare Pages and
    its Functions, D1 database, GitHub repo, Buffer, Google account).
  - One-time setup: install the agent, sign in, open it in this repo; written
    click by click for a non-terminal user.
  - First sentences to give the agent, copy-paste ready (e.g. "Read
    CLAUDE.md and docs/handover/troubleshooting.md, then help me with: …").
  - What only you do: secrets, dashboard clicks (Cloudflare, GitHub, Google,
    Buffer), merging PRs, approving remote database commands, sending mail,
    posting. Why each one.
  - When the agent gives you a command: what `!` does, read the one-line
    explanation the agent must give, never paste something the agent did not
    explain, never paste secrets into chat.
  - When to stop and ask a person, and who (role, not name).
- `troubleshooting.md` (English, agent): one entry per symptom. Every entry:
  **Symptom** (what the person sees, in their words), **Likely causes** in
  order, **Look at** (panel pane, Cloudflare deployment, GitHub Actions run,
  activity log, usage card, a read-only D1 query), **Fix**, **Who acts** (the
  agent, or the person with the exact command or click). Links to the README
  section where one exists instead of repeating it. Seed list, from real
  incidents in this repo's history (a builder may add more found in the README
  and Known traps):
  - A panel save or a merged PR never appears on the site (Pages missed the
    build → empty-commit PR; CMS PR waiting on CI or stuck; symposium site
    needs its rebuild).
  - A button does nothing or shows a generic error (open the browser console
    and the network tab; check the activity log; check role and its end date;
    check the status banner).
  - "Quota" / D1 errors / the usage alert fired (5M reads/day, which query,
    `d1 insights`).
  - CI red on a PR that passes locally (Node 22 vs local Node).
  - wrangler errors: 10042 (fresh login), 7403 (`--json` on remote execute),
    and running `--file` with an absolute path.
  - Mail queue stuck; a reply not showing.
  - Social post not sent / Buffer error / a connection banner line red.
  - Claude or ChatGPT connector will not connect, or a token is refused
    (expired role, revoked, limits, auto-revoke).
  - A content draft failed (README "When a draft fails").
  - Certificates not opening.
  - Someone lost access (role ended; renew in Roles).
- `accounts.md` (English, agent and human): table of services: what it is
  for, which account owns it (kind, not address), who should hold access after
  the handover (role), where its secrets live (Cloudflare Pages secret name,
  GitHub secret name, `wrangler.toml` var) and what to do at handover. Also:
  yearly-renewal items (social tokens, ISCB, domain/DNS which needs ISCB SC).
  The existing README "Yearly handover" section links here, or is moved here
  with a pointer left behind (builder decides which is less duplication).
- `drill.md` (English, for whoever runs the drill): see D.
- `CLAUDE.md` gets a short pointer near the top: on any error or "it doesn't
  work" report, read `docs/handover/troubleshooting.md` first; and a
  "Working with a non-terminal maintainer" rule set: commands are given to the
  person ready to paste, with absolute paths, each with one sentence on what it
  does; no `--json` on `wrangler d1 execute --remote`; the person merges PRs
  and runs remote-database writes; never post to real accounts; show visual
  changes before pushing. (These are the habits the current maintainer's own
  agent follows today; they move into the repo so the next agent inherits
  them.)

### B. Help section in the admin panel

- New section `yardim` (label "Yardım" / "Help"), group System or no group
  (builder decides with the routing table), visible to everyone who can open
  the panel.
- Content: Markdown files in a new content collection, e.g.
  `src/content/help/{tr,en}/<slug>.md`, frontmatter `title`, `roles`
  (a list of role keys from `functions/_lib/roles.ts`, or `all`), `order`.
  Rendered at build time into the Help pane; client code shows the guides
  whose roles the person holds, plus the `all` ones. Admins see every guide.
  Filtering is for relevance, not security: the text is public in the repo
  anyway.
- Guides (each one page, same headings: Bu rolle neler yaparsın · Neler
  yapamazsın, kime sorarsın · Sık yapılan işler adım adım (2–3) · Sık
  karşılaşılan sorunlar):
  - Social media editor (`social`)
  - Social media publisher (`social_publisher`)
  - Content editor (`content.<group>.edit`, one guide for all groups, with a
    short per-group note; the groups are Etkinlikler, Yazılar, Öğrenme,
    Topluluk, Sayfalar)
  - Content approver (`content.<group>.approve`)
  - Announcer (`announcer`)
  - E-mail sender (`sender`)
  - Symposium (`symposium`)
  - Admin (`admin`): includes granting and renewing roles, the activity log,
    connections, statistics, usage card, and a pointer to `docs/handover/`.
  - Connect Claude to the panel (`all`): adding the connector in claude.ai,
    what to ask it (draft, read, submit for approval), what it can never do
    (approve, publish, schedule, send), the reviewer read access for
    approvers, example requests, how to disconnect; one paragraph on personal
    tokens for terminal agents.
- Deep links: `#yardim/<slug>` opens one guide; other panes may link to
  their guide (e.g. a small "?" in the Social pane header) if cheap.
- A test guards drift: every non-retired role in the roles catalog is covered
  by at least one guide in both languages; every guide's `roles` are real
  role keys; each TR guide has an EN twin with the same slug.
- Existing test that bans forbidden hostnames in content (if one exists)
  covers the new files; otherwise the drift test also checks for them.

### C. Agent access

No change. Agents do not get the Help guides as a tool (YAGNI); the guides
are in the repo for terminal agents and the connector guide is for humans.

### D. Crash drill and handover sessions (`docs/handover/drill.md`)

- Who: the website lead if there is one, otherwise a management-team member
  (owner, 2026-10-27). The current chair only watches.
- When: December 2026, before the handover.
- How: 2–3 realistic faults, each set up off live (a branch, a PR that is
  never merged, or a local copy); never on the live site or real accounts.
  The incoming maintainer fixes each using only the docs and their agent.
  Every place they get stuck becomes a docs fix the same day. Candidate
  scenarios: a build broken on a branch (red CI), "I saved in the panel but
  the site did not change" (reproduced locally or explained against a past
  PR), "the usage alert says 70%" (read the usage card and explain).
- Handover-session checklist: account and access transfer per `accounts.md`;
  where secrets are set (places, not values); admin role granted to the
  incoming people (at least two admins); `GITHUB_NOTIFY_USERNAME`; merging one
  real PR together in the first week; feature freeze in the last weeks of
  January.

## Calls made after the builder check (mine; owner may override)

- Hostnames: the wildcard patterns `*.pages.dev`, `*.r2.dev`,
  `*.workers.dev` may appear as warnings; a concrete hostname under them may
  not. The drift test checks the new files for concrete ones.
- `drill.md` is a script only. Fault fixtures are prepared in December,
  right before the drill, never merged.
- One content-editor guide and one content-approver guide, each with short
  per-group notes (not one per group).
- Turkish is written first, English translated from it; the owner reviews
  both in the Help pane before push.
- "Who to ask" names roles only: an admin, the group's approver, the social
  media publisher, the website lead. No mailbox or person.
- Ownership (owner, 2026-10-27): every service is on an organisation
  account, none on a personal one. Buffer, the Gmail connection and its
  Google Cloud project are the organisation's Google account; Instagram,
  LinkedIn and X admin rights sit with the organisation's accounts; the
  PR-opening GitHub token is the organisation's `rsgturkey` GitHub account;
  Cloudflare is the organisation's account; DNS is at DreamHost and changed
  by the ISCB Student Council.
- `accounts.md` records account kinds, never addresses; any fact not yet
  confirmed is written as "confirm in the handover session", never guessed.

## Left to the builder

- Exact wording of guides (the owner reviews; show the Help pane before
  push).
- Whether README's "Yearly handover" moves to `accounts.md` or stays and
  links.
- Collection vs. a plain glob import for the Help files, as long as the
  drift test can read them from node.
- Where Help sits in the menu.

## Order

1. `docs/handover/` files + CLAUDE.md pointer (no visual change).
2. Help section + guides + drift test (visual: show before push).
3. Drill in December; docs fixed from what it finds.
