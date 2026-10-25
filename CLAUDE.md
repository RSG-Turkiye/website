# CLAUDE.md

Guidance for AI coding agents (and the humans steering them) working on this
repository. Read it before changing anything. It holds the decisions and traps
that the code alone does not explain.

## What this is

The website of RSG-Türkiye, the ISCB Regional Student Group for computational
biology and bioinformatics in Türkiye. It is two sites in one repository:

- **Main site** (repo root) at `rsg-turkiye.iscbsc.org`. It has public pages
  in Turkish and English, member accounts (Google sign-in) and an admin panel
  at `/admin` that runs the organisation's mail, social media, symposium,
  certificates, site content (a CMS, blog posts included) and announcements.
- **Symposium site** (`symposium_website/`) at
  `symposium.rsg-turkiye.iscbsc.org`. It is a separate Astro project and a
  separate Cloudflare Pages project.

The site is maintained by volunteers who change every year. Prefer the boring,
documented solution, one that a new maintainer can understand without asking
anyone.

## Rules that are never broken

1. **This repository is public.** No personal data, e-mail addresses,
   internal meeting notes or internal assessments go into code, commits, PRs
   or issues. Member names appear only in published committee profiles
   (rule 4). Write issues around the work, not around people. Use roles
   ("social media team"), never names, everywhere else.
2. **Never publish a `*.pages.dev`, `*.r2.dev` or `*.workers.dev` URL to
   users.** All three are blocked by ISPs in Türkiye. Always use the custom
   domains. R2 files are served through the site's own `/api/images/<key>`.
3. **Forms are Google Forms.** Membership, applications and other intake from
   people go through Google Forms, and the response Sheet is the source of
   truth. If the site needs that data, it imports it from the Sheet on a
   schedule. Never build a form whose only copy of a submission is in D1: when
   D1 hits its daily limit, writes fail and the submission is lost.
4. **Personal data never goes into git**, not even a private repo, because git
   history cannot be deleted. It lives in D1 or in the organisation's Google
   Drive, where deleting actually deletes. Published committee profiles,
   with the member's consent, are content and may be in git
   (`src/content/committees`); their e-mail addresses are not.
5. **Nothing leaves the organisation without a human pressing send.** E-mails
   to faculty, speakers and members, social posts and DMs are drafted by the
   site and approved by a person.
6. **Original content only.** Tutorials, notebooks and examples use our own
   material and synthetic or properly licensed data. Link to other people's
   workshops; never copy them. No invented quotes, testimonials, people or
   numbers.
7. **Secrets are never pasted into chat, code or commits.** A maintainer sets
   them with `wrangler pages secret put <NAME>` (or as a GitHub Actions
   secret). An agent may say which secret is needed but never handles its
   value.
8. **Learning-path resource `id`s never change and are never reused.** They
   are the keys under which members' progress is saved. Reorder, add and
   delete freely. The panel generates new ids; never type one by hand.
   `tests/lp-resource-ids.test.ts` enforces this, and the CMS server refuses
   a draft that changes or invents one.
9. **Everything done in the admin panel goes in the activity log.** Write
   the change and its audit row together with `runWithAudit`
   (`functions/_lib/audit.ts`). `tests/audit-coverage.test.ts` fails on a
   new admin endpoint that changes something without logging it. Log rows
   are kept a year, so they carry ids and counts, never data that is
   deleted sooner, such as a certificate holder's name or address.
10. **Content is changed through the CMS or a PR. Only a person approves,
    in the panel**; the shepherd merges only what a person approved, and
    nobody merges a `cms/*` pull request by hand. No agent or script
    approves. Agent tokens draft and submit only; the route table in
    `functions/_lib/agent-routes.ts` is the complete list, and a new panel
    feature adds its draft-level routes there or nothing.

## Where things live

| Path                              | What                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/pages/`                      | Routes. English at the root, Turkish under `src/pages/tr/`, mirroring each other.                                                                     |
| `src/content/`                    | Content. Markdown: blog, webinars, learning paths. JSON, one file per entry: workshops, events, resources, committees, pages (page texts), privacy (the notice). Schemas in `src/data/`, wired up in `src/content.config.ts`. |
| `src/data/`                       | Zod schemas and helpers for every collection (no data arrays; `tests/content-not-in-code.test.ts`), plus the privacy contact and loader, and podcast. |
| `src/i18n/ui.ts`                  | UI strings in both languages.                                                                                                                         |
| `src/lib/`                        | Build-time helpers (feeds, tags, hreflang, learning paths), the `get-*.ts` collection loaders and `page-text.ts`.                                     |
| `scripts/compare-builds.ts`       | `npx tsx scripts/compare-builds.ts <before> <after>`: diffs two builds' .html/.xml/.txt (exit 1 on a difference). Normalises hashed asset names, entity spelling and whitespace runs. Use it for any change that should not alter pages. |
| `src/scripts/admin/`              | The admin panel's client code.                                                                                                                        |
| `functions/api/`                  | Cloudflare Pages Functions, the site's API.                                                                                                           |
| `functions/_lib/`                 | Shared server code: `auth.ts` (session and permission checks), `mail*.ts`, `social-*.ts`, `github.ts` (opens PRs), `symposium.ts`, `certificates.ts`. |
| `functions/_lib/roles.ts`         | The role catalog and the duration rules: who may grant which role, and for how long. Pure, no database.                                               |
| `functions/_lib/role-grants.ts`   | `grantRole`, `revokeRole`, `activeGrants`, `expireGrants`: the only code that changes who holds a role.                                               |
| `src/lib/cms/`, `functions/_lib/cms-*.ts`, `functions/api/cms/` | The panel CMS: types and serializing, draft rules, the PR shepherd (runs on the mail tick), and the `/api/cms/*` endpoints. Content types are grouped (Etkinlikler, Yazılar, Öğrenme, Topluluk, Sayfalar); a group's rights are the roles `content.<group>.edit` and `.approve` in `roles.ts`. |
| `functions/_lib/agent-*.ts`, `functions/api/_middleware.ts`, `functions/api/mcp.ts`, `functions/_lib/mcp-tools.ts`, `functions/api/agent-tokens/` | Agent access (README, "Agent access"): `agent-tokens.ts` checks a personal token and works out its rights (scope intersected with live grants, never approve); `agent-routes.ts` is the complete list of routes a token may call; `agent-limits.ts` holds the rate limits, quotas and auto-revoke; `agent-instructions.ts` is what an agent is told; `_middleware.ts` refuses every other `/api/*` route to a bearer request before a handler runs; `mcp.ts` and `mcp-tools.ts` are the MCP server, which calls the same REST handlers; `agent-tokens/` makes, lists and revokes tokens, for a signed-in person only. |
| `db/schema.sql`                   | The D1 schema plus the numbered migration notes at its top.                                                                                           |
| `workers/mail-cron/`              | Worker whose cron (every minute) drives mail dispatch, inbox sync and social publishing.                                                              |
| `workers/symposium-cron/`         | Nightly Worker: archives a finished symposium edition (via a PR), rebuilds the symposium site, purges expired certificates and prunes the audit log.  |
| `tests/`                          | Unit tests (`*.test.ts`); browser checks in `tests/browser/*.mjs` (Playwright).                                                                       |
| `docs/superpowers/specs`, `plans` | Design documents and implementation plans for past features. Read the spec before changing a feature it covers.                                       |

Infrastructure: Cloudflare Pages (project `website`), D1 database
`rsg-members` (binding `DB`), R2 buckets `rsg-blog-images` and
`rsg-mail-attachments`. All organisation services run on the shared
organisation account, never a personal one.

## Commands

```bash
npm install
npm run dev          # http://localhost:4321
npm test             # unit tests (node --test)
npx astro check      # type check, must report 0 errors
npm run build
npm run preview      # serve the production build locally
```

CI (`.github/workflows/build-check.yml`) runs `astro check`, build and tests
for both sites on every PR. Keep it green.

## Data and the free tier

- **D1 is on the free plan: 5 million rows read per day.** Going over blocks
  every D1 read until 00:00 UTC. Traffic is small; what uses up the budget is
  the per-minute cron. **Any query that runs on the tick needs an index that
  covers its `WHERE`.** Diagnose with
  `wrangler d1 insights rsg-members --sort-type=sum --sort-by=reads --timePeriod=7d`.
- **Schema changes are applied by hand.** Add the table or column to
  `db/schema.sql` and add a numbered note at its top with the exact `wrangler
  d1 execute rsg-members --remote ...` command. `ALTER TABLE` is not
  idempotent, so it stays a note and is not a statement in the file. A deploy
  whose code expects a column that production does not have yet breaks the
  admin panel. Apply the migration first.
- **`users.is_*` columns are a cache of `role_grants`.** Never write them
  directly; always `grantRole` / `revokeRole` (`functions/_lib/role-grants.ts`),
  which rewrite the columns from live grants in the same batch.
- **There is no paid WAF rate limiting** on this account. Enforce rate limits
  inside the Function, as `functions/_lib/certificates.ts` does.
- Mail limits: up to 10 recipients per compose; 20 sends per user an hour,
  100 per user and 300 for the whole site in any 24 hours
  (`functions/_lib/mail.ts`). Scheduled mail goes out only between 08:00
  and 22:00 Istanbul time (`functions/_lib/schedule.ts`).

## Scheduled jobs

- The Cloudflare Worker crons are the schedulers. **Do not add a `schedule:`
  to `.github/workflows/mail-dispatch.yml`.** GitHub's scheduler never fired
  reliably here, and two schedulers on one queue send every message twice.
- Scheduled GitHub workflows on a public repo are disabled after 60 days with
  no activity, and run as whoever last committed the cron. That has to be the
  organisation's bot account, not a person.
- The symposium site is static. A panel save triggers a rebuild through the
  `SYMPOSIUM_DEPLOY_HOOK` secret. If saved content does not appear, check
  `/api/symposium` first: if the data is there, the problem is the build.

## Verifying a change

- A check that cannot fail is not verification. Assert what the user would
  see.
- **Header, auth and navigation changes are checked in a real browser while
  signed in.** The auth header is rendered by script after `/api/me`, so a
  signed-out check never tests it. `tests/browser/*.mjs` mock `/api/me` with
  `page.route`.
- **Visual changes are shown to a maintainer, as a link to a local preview,
  and approved before they are pushed.** Check layouts at 1280×680, 1366×768,
  1440×800, 1536×864, 1440×900 and 1920×1080. Never ship an inner scrollbar
  on page chrome such as sticky sidebars.
- Avoid generic AI-looking design: emoji headings, rows of identical rounded
  cards, big-number tiles. Prefer elements that come from the real content,
  such as real photos, dates and counts.
- Bilingual pages come in pairs. A change to an English page usually needs
  the same change in its `tr/` twin, and the other way round.

## Known traps

- **View transitions (`<ClientRouter />`) were tried and reverted.** They stop
  `DOMContentLoaded` from firing after the first page, which silently breaks
  the signed-in header. Do not turn them back on without rebinding those
  scripts to `astro:page-load` and testing while signed in.
- **Astro's content cache keeps deleted files** in
  `node_modules/.astro/data-store.json`. After removing a content file, run
  `rm -rf node_modules/.astro .astro dist` before trusting a local build.
- **The root `tsconfig.json` deliberately has no `extends`.** Vite reads it
  while building `symposium_website`, whose build installs only its own
  packages. On an Astro upgrade, compare it with `astro/tsconfigs`.
- **Markdown rehype plugins need the `unified` processor** set in the Astro
  config. The default processor does not run them.
- **wrangler error 10042, "enable R2"**, means the login has lost its R2
  scopes. Run `npx wrangler login` again; R2 is not disabled.

## Working style

- One change per PR, with a description of what changed and why. Each PR is
  merged by a maintainer.
- Pushing, merging, running migrations on the remote D1, setting secrets and
  sending anything to real people are done only with a maintainer's explicit
  approval, each time.
- Write code that matches the surrounding code. Comments explain why, not
  what.
