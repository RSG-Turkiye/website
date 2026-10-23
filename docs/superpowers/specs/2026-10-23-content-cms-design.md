# Content CMS in the admin panel

Status: design, agreed in conversation on 2026-10-23. Not started.

## Why

Today every piece of content on the main site gets there the same way: the
chair collects the facts, asks an AI assistant to write the Markdown or
TypeScript file, and commits it to GitHub. It works because one person holds
every link of that chain. The chair hands over in January 2027, and the next
team must be able to keep the site current **without touching GitHub unless
they are forced to**.

So: members with the right role add and edit content from the admin panel,
someone with approval rights approves it, and the site publishes it. Nobody
needs Git, Markdown or an AI tool to do it.

## Goals

- **Every kind of content now on the main site** can be added and edited
  from the panel, plus notebooks. The owner explicitly refuses to pick a
  subset ("you can't choose, I can't either"). Webinars may not even
  continue next year, so nothing in the design may be webinar-shaped. The CMS
  is generic, and each content type is a schema plugged into it.
- New content types arrive later as one schema each, not as new features:
  graduate programmes, labs, the community noticeboard, opportunities
  (roadmap items 8, 10 and 12).
- Git stays the source of truth for published content. What is on the site
  is what is in the repository.
- Every action is in the activity log (CLAUDE.md rule 9).
- **API-first, so AI agents can use it.** Everything the panel does goes
  through a documented JSON API that the panel itself is a client of: list
  types and their schemas, list and read entries, save a draft, submit,
  approve, send back. A member's own AI agent (roadmap item 11) can then do
  the same work through the same API, within the same role rights. The last
  phase of this work adds this. Rules for that phase:
  - Personal API tokens per member, scoped to their groups and levels. A
    token expires with the role, can be revoked, and appears in the log, with
    "via agent" on every action it takes.
  - A remote MCP server wraps the API, so agents such as Claude can use it
    without custom code.
  - Agents can draft and submit. Approval and publishing stay with a person,
    even when that person holds approve rights.
  - **Not only content.** The same tokens and MCP server cover every panel
    role, not just the CMS groups. Example: an agent working for someone with
    the social media role can plan, draft posts, attach images and alt text,
    and submit for approval through the existing `/api/social/*` endpoints.
    It cannot approve, schedule directly, publish, or send DMs or e-mails.
    Anything that reaches people outside the panel needs a human to press the
    button (CLAUDE.md rule 5). Each panel area exposes its draft-level actions
    to agents, and only those. New panel features follow the same rule.
  - Enforcement is server-side, never by instructions: token scopes, per-token
    and per-IP rate limits and quotas in the Function (there is no paid WAF),
    size limits, generic errors with no internal details, and content from
    agents treated as data. A good instruction set for agents is welcome, but
    it only guides well-meaning agents; it is not the protection.

## Non-goals

- The symposium site's content and announcements. Both already have their
  own panel editors that work. Folding them into this system is a later
  decision, not part of this work.
- Member-submitted forms from the public: applications, event submissions
  and speaker details. Those are Google Forms by standing decision (CLAUDE.md
  rule 3), imported from Sheets. This CMS is for people working inside the
  panel.
- Editing notebook *code*. A notebook's code lives in its own repository with
  its own CI. The CMS manages the notebook's page on the site (title,
  authors, summary, links, status); the code side is a separate conversation.
- A WYSIWYG page builder. Content has fixed shapes; forms fill them.

## Anti-goals

These would make the result a failure even if it technically works.

- **Content that exists only in D1.** If D1 stops (the free tier's read cap
  was hit on 2026-10-18), published content must still be there and
  rebuildable. D1 holds drafts and the review queue only.
- **A silent overwrite.** Two people editing the same entry, or an edit made
  against an old copy, must never quietly replace someone else's change.
- **A second state machine next to blog submissions.** The existing blog
  submission flow (`blog_submissions`, approve, open PR) is the first version
  of this. It is extended and generalised, not duplicated.
- **Per-type hand-written forms.** Forms come from the schemas, so a schema
  change cannot leave a form behind.
- **Generic "AI-looking" design** in the panel UI (see CLAUDE.md, Verifying
  a change).

## Content inventory

Everything below must be editable when this is finished.

| Content | Today | Notes |
|---|---|---|
| Blog posts, TR/EN | `src/content/blog/{en,tr}` Markdown (70 files) | Member writer flow already exists (`blog_submissions`). |
| Webinars | `src/content/webinars` Markdown (164 files) | |
| Learning paths: domains, levels, roadmap | `src/content/lp-*` Markdown with YAML lists (50 files) | Resource `id`s are progress keys and must never change (CLAUDE.md rule 8). |
| Events | `src/data/events.ts` (TypeScript) | Must move to a content collection first. |
| Workshops | `src/data/workshops.ts` (TypeScript) | Same. |
| Committees | `src/data/committees.ts` (TypeScript) | Same. |
| Podcast | `src/data/podcast.json`, pulled from the RSS feed by `scripts/sync-podcast.ts` | A "pull new episodes" action, not a form. |
| Notebooks | `src/data/notebooks/` on the unmerged `feat/notebooks-demo` branch | Page metadata only (see non-goals). |
| Page texts: home, about, join, resources | Hard-coded in `.astro` pages | Must move to content files first. |
| Privacy notice | `src/data/privacy.ts` | Must state what the code does; see Permissions. |

## Decided

### Publishing flow

1. A member with **edit** rights on a group opens an entry, or a blank one,
   fills the form and saves a draft. Drafts are private to their author until
   submitted.
2. They **submit for approval**.
3. Someone with **approve** rights on that group, or an admin, approves it or
   sends it back with a reason. A sent-back draft returns to its author with
   the reason, as blog submissions do today.
4. On approval the site opens a pull request with the change, using the
   existing `openContentPR` in `functions/_lib/github.ts` (the rsgturkey
   account's token, the same one blog approvals and the symposium archive
   use).
5. When the required checks pass, the pull request is **merged
   automatically** and Cloudflare deploys it.
6. An approver may publish their own edit without a second person. This is
   the owner's call, so a one-person month does not block the site. The log
   shows who published what.

### Permissions

Rights are given per **group**, at two levels, **edit** and **approve**.
Admins can do everything.

| Group (TR name in the panel) | Content |
|---|---|
| Etkinlikler | events, workshops, webinars |
| Yazılar | blog |
| Öğrenme | learning paths, notebooks |
| Topluluk | committees, podcast |
| Sayfalar | page texts. The privacy notice is admin-only. |

Rights can be given for a limited time, for example "one month of edit on
Etkinlikler". They lapse on their own (roadmap item 9, expirable roles). A
new content type joins an existing group or gets a new one.

The privacy notice states facts about what the site does, so only an admin
can approve a change to it.

### Architecture

- **Schema-driven.** Every content type is a content collection with a zod
  schema in `src/content.config.ts`. The panel builds its forms from these
  schemas: field types, required fields, lists, nested objects, TR/EN pairs.
  That one form engine is what lets new types be cheap.
- **TypeScript data moves to content files first.** `events.ts`,
  `workshops.ts` and `committees.ts` become collections (JSON or Markdown),
  and the pages read them through `getCollection`. Hard-coded page texts move
  the same way into text-block files. This refactor lands before the CMS
  edits those types, and the rendered pages must not change. Diff the built
  HTML before and after.
- **Git is the source of truth; D1 is the queue.** D1 holds drafts, review
  state and who did what. Published content lives only in the repository.
- **Edits start from the current published file.** Opening an entry reads
  it from `main` (`getFileOnBaseBranch` exists). A draft records the version
  it started from. If `main` has changed since then, approval refuses with a
  clear "this changed since you started" and shows what changed, instead of
  overwriting.
- **Bilingual.** Content with TR/EN twins edits both languages in one draft
  and publishes them in one pull request, as paired blog submissions do now.
  The existing `translationKey` rule (`src/lib/translations.ts`) decides
  pairing.
- **Images** upload to R2 and are served through `/api/images`, as blog
  images already are. Never an `r2.dev` URL (CLAUDE.md rule 2).
- **Activity log.** Draft saved, submitted, approved, sent back, PR opened,
  merged, and merge failed all write audit rows. The labels go in
  `src/lib/audit-labels.ts`; its test fails otherwise.

### Owner's answers to the builder check (2026-10-23)

- **Committee profiles stay in git.** They are published profiles that
  promote the people on them, not private records. Committee members may
  enter their own details. The e-mail field is dropped, and each profile
  carries a consent to be shown on the site. CLAUDE.md rule 4 should say that
  published, consented profile content is the exception to "no personal data
  in git"; update it in the same change.
- **A person may approve a draft their own agent wrote.** The click is a
  human decision. The draft shows "written by an agent" wherever it is
  reviewed, and the log records it.
- **An approver of a group may grant edit rights in that group for at most
  one month.** Only an admin grants approve rights, and only an admin grants
  anything longer.

### Calls made while writing this (check these)

- **The general role model is built first, as part of this work.** Roadmap
  item 9 (expirable roles) is the foundation, not a later replacement. Today's
  `users.is_*` columns stay readable during the move, and the existing roles
  migrate into the new model without anyone losing access. Duration rules
  already agreed for item 9: 1, 2, 3, 6 or 12 months, or a custom period; up
  to 12 months only for leaders, and up to 1 month, renewable, for others.
- **Agent sign-in: personal bearer tokens first.** That covers Claude Code,
  scripts and most agent tools. OAuth for claude.ai-style connectors is added
  only if someone needs it. The MCP endpoint lives in the existing Pages
  project on `rsg-turkiye.iscbsc.org`, because `*.workers.dev` is blocked in
  Türkiye and DNS is not in our hands.
- **The draft model also takes imported submissions with no signed-in
  author.** Google Form and Sheet imports for roadmap items 8, 10 and 12 each
  carry a source, a nullable author and an idempotent import key (response
  timestamp plus row). The model is designed for this from the start, so blog
  is migrated onto it once.
- **Blog writers work in the panel.** Edit rights on Yazılar open `/admin`
  with only that group visible, through the same role check as everything
  else. `/account`'s writer form forwards there, as `/account/mail` already
  does for e-mail. One editor, not two.
- **Page texts are editable text, not layout.** Paragraphs, headings and
  button labels become text blocks. Section order and structure stay in code.
  The shared UI strings in `src/i18n/ui.ts` are out of scope.

## Constraints

- Cloudflare free tier: D1 5M row reads a day, so panel lists must not scan
  large tables per keystroke. Pages builds run **one at a time**: on
  2026-10-23 three queued preview builds held a production deploy for about
  20 minutes.
- `main` is protected. The required checks are "Build & Type Check" and
  "Symposium Build & Type Check", with **strict** up-to-date checking. Repo
  setting `allow_auto_merge` is currently **false**.
- Public repository: pull request bodies and commit messages written by the
  CMS must not include personal data (e-mail addresses, member names beyond
  the published content's own author fields). Today's blog approval PR body
  contains the submitter's and approver's e-mail addresses; stop doing that.
- Secrets are set by a maintainer, never handled by an agent.
- Everything bilingual in the panel (TR/EN UI strings in `src/i18n/ui.ts`).

## Left to the builder

- How auto-merge is achieved: GitHub's auto-merge (needs the repo setting
  turned on by the owner), a merge queue, or the site merging through the
  API once checks are green. With strict up-to-date checks, two approvals
  close together will leave the second branch behind. Whatever is chosen
  must update and retry it without a person.
- How to keep CMS branches from each taking a Pages preview build. One
  option is excluding `cms/*` in Pages branch deployment controls, which is a
  dashboard setting the owner changes.
- The draft table's shape: generalise `blog_submissions` (content type plus
  a JSON payload) or add a table and migrate blog onto it. Either way it is
  one model, and blog's writer flow keeps working throughout.
- File format per migrated type (JSON or Markdown with frontmatter) and the
  text-block format for page texts.
- The order in which types are switched on. Suggested: start with the
  Etkinlikler group, because events, workshops and webinars cover a list
  type, a migrated `.ts` type and a large Markdown type; then Topluluk,
  Öğrenme, Yazılar (moving blog's flow over) and Sayfalar. Notebooks go when
  `feat/notebooks-demo` merges.
- Preview: showing the rendered entry before submitting is wanted. Whether
  it renders in the panel or relies on the Pages preview build is the
  builder's call, in light of the build-queue constraint above.
- Deleting content: allowed, as its own reviewed change. For learning-path
  resources, rule 8 applies: ids are never reused.
