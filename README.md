# RSG-Türkiye Website

The website of [RSG-Türkiye](https://rsg-turkiye.iscbsc.org), the ISCB Regional
Student Group for computational biology and bioinformatics in Türkiye.

| Site          | Address                                                                      |
| ------------- | ---------------------------------------------------------------------------- |
| **Main site** | [rsg-turkiye.iscbsc.org](https://rsg-turkiye.iscbsc.org)                     |
| **Symposium** | [symposium.rsg-turkiye.iscbsc.org](https://symposium.rsg-turkiye.iscbsc.org) |

Always share these addresses. The underlying `*.pages.dev`, `*.r2.dev` and
`*.workers.dev` addresses are blocked by ISPs in Türkiye.

**New here?** Read this file for how the site works and how to run it.
[CONTRIBUTING.md](CONTRIBUTING.md) covers adding blog posts, webinars and
translations without any coding. [CLAUDE.md](CLAUDE.md) lists the rules
that are never broken and the known traps; it is written for AI coding agents
and is just as useful for people.

---

## What the site is

Two Astro sites in one repository:

- **Main site** (repo root): public pages in Turkish and English (blog,
  webinars, learning paths, events, podcast), member accounts with Google
  sign-in, and an admin panel at `/admin`. The panel runs the organisation's
  e-mail, social media publishing, symposium content, certificates, blog
  submissions and announcements.
- **Symposium site** (`symposium_website/`): a separate static Astro project
  with its own Cloudflare Pages project. It reads its editable content from
  the main site's API at build time.

## Tech stack

| Tool                                             | Purpose                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [Astro 7](https://astro.build)                   | Pages, built mostly as static HTML                                                    |
| [Tailwind CSS v4](https://tailwindcss.com)       | Styling                                                                               |
| [Cloudflare Pages](https://pages.cloudflare.com) | Hosting; builds and deploys on every push to `main`                                   |
| Cloudflare Pages Functions (`functions/`)        | The API: sign-in, members, admin panel, mail, social                                  |
| Cloudflare D1 (`rsg-members`)                    | Database: users, roles, queues, logs                                                  |
| Cloudflare R2                                    | Files: `rsg-blog-images` (served via `/api/images`), `rsg-mail-attachments` (private) |
| Cloudflare Workers (`workers/`)                  | Cron jobs: `mail-cron` every minute, `symposium-cron` nightly                         |

Everything runs on the free plans, under the organisation's shared account
(`turkey.rsg@gmail.com`). No personal accounts.

## Project structure

```
/
├── src/
│   ├── pages/            Routes. English at the root, Turkish under tr/
│   ├── content/          Markdown (blog, webinars, learning paths) and JSON (events, workshops, resources, committees, pages)
│   ├── content.config.ts Content schemas
│   ├── data/             Schemas and helpers for the JSON collections, privacy text, podcast
│   ├── i18n/ui.ts        UI strings in both languages
│   ├── components/, layouts/, styles/
│   ├── lib/              Build-time helpers
│   └── scripts/admin/    Admin panel client code
├── functions/
│   ├── api/              API endpoints
│   ├── auth/             Google sign-in
│   └── _lib/             Shared server code (auth, mail, social, github, …)
├── db/schema.sql         D1 schema, with numbered migration notes at the top
├── workers/              mail-cron and symposium-cron Workers
├── tests/                Unit tests; tests/browser/ holds Playwright checks
├── symposium_website/    The symposium site
└── docs/superpowers/     Design specs and plans for past features
```

---

## Local development

**Prerequisites:** Node.js 22+ (see `.nvmrc`)

```bash
npm install
npm run dev          # dev server at http://localhost:4321
npm test             # unit tests
npx astro check      # type check
npm run build        # production build
npm run preview      # serve the production build
```

Pages that call the API need a local D1 and secrets; most static pages work
without them.

---

## How the site works

### Bilingual content (EN / TR)

Language is set by **directory**, not frontmatter:

- `src/content/blog/en/my-post.md` → `/blog/my-post`
- `src/content/blog/tr/my-post.md` → `/tr/blog/my-post`

UI strings (navigation, buttons, labels) live in `src/i18n/ui.ts`.

### Translation links

An English and a Turkish entry with the **same filename** are paired
automatically: each page shows a "Read in Turkish / Read in English" link and
the language switcher moves between them. When the Turkish file needs a
Turkish slug, put the same `translationKey` in both files instead.

```
blog/en/crispr-genome-editing.md   ←→   blog/tr/crispr-genome-editing.md
```

### Deployment

Pushing to `main` triggers a Cloudflare Pages build and deploy of both
sites. Two things are **not** part of a deploy and are done by hand:

- **Database changes.** New tables and columns are applied with `wrangler d1
  execute` as described in the numbered notes at the top of `db/schema.sql`.
  Apply them **before** merging code that needs them.
- **Secrets.** Set with `npx wrangler pages secret put <NAME> --project-name
  website` in your own terminal. Pages reads secrets only when it deploys, so
  redeploy after changing one.

> **Before going live with a new domain:** Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) and add the new domain's callback URL to the OAuth client's **Authorized redirect URIs**:
> ```
> https://rsg-turkiye.iscbsc.org/auth/callback
> ```
> Without this, Google login will fail with a `redirect_uri_mismatch` error. Remove any stale dev preview URLs (e.g. `website-dev-vi6.pages.dev`) from the same list.

#### Member blog submissions — required setup

The member blog submission feature (members write a post on `/account`, an admin approves it, and the site auto-opens a GitHub PR) needs three things configured that aren't part of a normal deploy:

1. **A GitHub secret**, `GITHUB_PAT` — a fine-grained Personal Access Token from a dedicated GitHub account, scoped to *only* this repo, with **Contents: Read and write**, **Pull requests: Read and write**, and **Issues: Read and write** permissions. Set via:
   ```
   wrangler pages secret put GITHUB_PAT --project-name website
   ```
2. **An R2 bucket**, `rsg-blog-images` (`wrangler r2 bucket create rsg-blog-images`). It does not need public access: images are served through the site's own `/api/images/<key>`, and `PUBLIC_BLOG_IMAGES_URL` in `wrangler.toml` points there. Do not use the bucket's `r2.dev` address; it is blocked in Türkiye.
3. **`GITHUB_NOTIFY_USERNAME`** in `wrangler.toml`'s `[vars]` — the GitHub username of whoever should be notified the moment a member submits a post (before any admin approves it, so nothing sits unnoticed). This **must be a different account than whoever `GITHUB_PAT` belongs to** — GitHub never sends a notification to an account for actions that account itself performed, so the PAT's own account can never be notified this way. **Update this whenever the person responsible for reviewing submissions changes** (e.g. a new committee president) — it's a plain config value, no code change needed.

#### Sending mail as RSG — required setup

Authorised members compose mail on `/account/mail` and it goes out from RSG's
address without any of them holding the mailbox password. Four things have to
be configured that are not part of a normal deploy.

**Why there is no service account here.** The obvious way to send as an
organisation is a Google Cloud service account with domain-wide delegation.
That requires a Google Workspace tenant, and RSG does not have one —
`turkey.rsg@gmail.com` is a consumer Gmail account (the paid subscription on it
is Google One, which is storage and AI, not a managed Google service).
`admin.google.com` will bounce it straight back to the account chooser. The
refresh-token flow below is the supported path for a consumer account. If RSG
ever buys a real Workspace, only `getAccessToken` in `functions/_lib/gmail.ts`
has to change.

1. **Publish the OAuth app.** In [Google Cloud Console → APIs & Services →
   OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent),
   the app must be in **Production**, not *Testing*. Refresh tokens issued by an
   app in Testing **expire after seven days**, after which sending stops working
   with no visible cause. Add the scope
   `https://www.googleapis.com/auth/gmail.send`. The manual path below needs
   only that scope. The admin panel's Reconnect button (see [Connections and
   the status banner](#connections-and-the-status-banner)) requests four at
   sign-in: `openid`, `email`, `gmail.send` and `gmail.readonly`. They do not
   have to be listed under Data access while the app is unverified. Because
   `gmail.send` is a sensitive scope, a published-but-unverified app shows an
   "unverified app" interstitial; only the one person doing step 2 ever sees it.

2. **Get a refresh token for the sending account.** Signed in as
   `turkey.rsg@gmail.com`, visit this URL (substituting the client ID from
   `wrangler.toml`), approve the consent screen, and copy the `code` parameter
   from the redirect:

   ```
   https://accounts.google.com/o/oauth2/v2/auth?client_id=<GOOGLE_CLIENT_ID>&redirect_uri=https://rsg-turkiye.iscbsc.org/auth/callback&response_type=code&scope=https://www.googleapis.com/auth/gmail.send&access_type=offline&prompt=consent
   ```

   `access_type=offline&prompt=consent` is what makes Google return a refresh
   token; without both, you get an access token that dies in an hour. Exchange
   the code:

   ```bash
   curl -s -X POST https://oauth2.googleapis.com/token \
     -d client_id=<GOOGLE_CLIENT_ID> \
     -d client_secret=<GOOGLE_CLIENT_SECRET> \
     -d code=<the code> \
     -d grant_type=authorization_code \
     -d redirect_uri=https://rsg-turkiye.iscbsc.org/auth/callback
   ```

   Keep the `refresh_token` from the response.

   **Shortcut once the admin panel is set up.** Doing this by hand is only
   needed for the very first token. After that, the admin panel's
   **Connections > Gmail > Reconnect** runs the same consent flow for you,
   stores the new token encrypted, and refuses any account other than
   `turkey.rsg@gmail.com`. See [Connections and the status
   banner](#connections-and-the-status-banner).

   **Where to get the client secret:** The OAuth client secret lives in [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials), under the same OAuth 2.0 Client ID. If Google will not display it (the console stopped showing secrets for newly created clients except at creation time), the only way forward is to add a new secret on that client in the Credentials UI. **This invalidates the existing secret — the same secret that member sign-in (`functions/auth/callback.ts`) also uses.** If you rotate it, you must immediately run `wrangler pages secret put GOOGLE_CLIENT_SECRET --project-name website` with the new value in the same sitting, or login will break for everyone.

   **Shell history warning.** The `curl` command above puts the secret on the command line, where it lands in your shell history and is visible to other users via `ps`. Run this command somewhere private (a private SSH session, or a machine where only you have access) and clear the shell history afterwards — it is a one-time admin action, not a recurring step.

3. **Set the secret and create the bucket:**

   ```
   wrangler pages secret put GMAIL_REFRESH_TOKEN --project-name website
   wrangler r2 bucket create rsg-mail-attachments
   ```

   Do **not** enable public access on `rsg-mail-attachments`. Attachment bytes
   are read server-side into the MIME message; no URL is ever exposed, and a
   public bucket would leak the sponsorship documents.

4. **Run the migrations** listed as items 4a and 4b at the top of
   `db/schema.sql`, before deploying. Skipping 4a breaks the existing admin
   user list.

**Changing the from address.** `RSG_MAIL_FROM` in `wrangler.toml`'s `[vars]`
holds the address mail is sent from. Gmail accepts any address verified as a
"send mail as" alias on the sending account, so once `rsg-turkey@iscbsc.org`
works in the Gmail UI, switching to it is an edit to that one line. It does not
work today: it fails with `535 5.7.8 BadCredentials`, most likely because it is
a Google Group or alias rather than a mailbox with a password — a group cannot
authenticate over SMTP.

**Limits.** Consumer Gmail caps sending at roughly 500 recipients per day, and
Google One does not raise it. The app's own limits (20/hour and 100/day per
member, 300/day across everyone, in `functions/_lib/mail.ts`) sit under that so
members hit a clean error rather than Gmail starting to reject mail. Raise them
only if the ceiling itself rises.

**Scheduled sending.** A member can pick a send time. The `rsg-mail-cron`
Worker (`workers/mail-cron/`) calls `/api/mail/dispatch` every minute to send
what is due; mail goes out only between 08:00 and 22:00 Istanbul time. The call
is authenticated with a shared secret, set to the same value in both places:

```
wrangler pages secret put MAIL_SYNC_SECRET --project-name website
cd workers/mail-cron && npx wrangler secret put MAIL_SYNC_SECRET
```

The same secret is also a repository secret (Settings → Secrets and variables
→ Actions) for `.github/workflows/mail-dispatch.yml`, which is a manual "run
now" button only. **Do not add a `schedule:` to that workflow.** GitHub's
scheduler never fired reliably for this repository, and two schedulers on one
queue send every message twice.

**Order matters.** The `scheduled_emails` table (migration item 5 at the top of
`db/schema.sql`) must exist and both copies of the secret must be set before the
Worker is deployed; until then every tick fails.

If mail stops going out at its scheduled time, the admin panel's status banner
says "The scheduler is not running". Check the `rsg-mail-cron` Worker in the
Cloudflare dashboard, then read `dispatch_runs` as described below.

### Reading replies (Conversations)

Reading replies needs one more OAuth scope than sending does, and Google
treats it as *restricted* rather than merely sensitive.

1. In Google Cloud → **Google Auth Platform → Data access**, add
   `https://www.googleapis.com/auth/gmail.readonly` alongside the existing
   `gmail.send` scope and save.
2. Re-run the refresh-token grant for `turkey.rsg@gmail.com`. An existing
   refresh token does **not** gain a scope that was added after it was
   issued — the old token keeps working for sending and fails for reading,
   which looks like a broken sync rather than a missing grant.
   The consent screen warns more sternly than it did for `gmail.send`;
   a single account granting access to its own mailbox proceeds through
   **Advanced → Go to RSG Turkiye (unsafe)**.
3. Replace the secret with the new token:
   ```
   npx wrangler pages secret put GMAIL_REFRESH_TOKEN
   ```
4. Apply the migrations from notes 6a and 6b in `db/schema.sql`.
5. Redeploy the cron Worker so it picks up `SYNC_URL`:
   ```
   cd workers/mail-cron && npx wrangler deploy
   ```

#### When the queue looks stuck

Every dispatch tick writes a row to `dispatch_runs`, and the row is written in
two parts: inserted when the tick starts, updated when it ends. Read it before
guessing:

```
npx wrangler d1 execute rsg-members --remote --command="SELECT datetime(started_at,'unixepoch','+3 hours') tr, finished_at IS NOT NULL done, candidates, planned, sent, failed, held, error FROM dispatch_runs ORDER BY started_at DESC LIMIT 20"
```

Three answers, three different problems:

| What you see                                    | What it means                                                                                             |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| No rows for the stalled period                  | The tick never ran. The cron Worker or its call to this endpoint is the problem, not the queue.           |
| Rows with `done = 0`                            | The tick started and was killed mid-way — a Worker over its 128 MB isolate limit looks exactly like this. |
| Rows with `candidates = 0` while mail is queued | The tick ran and found nothing due. The candidate query or the clock is wrong, not the sending.           |
| `held` set                                      | The tick deliberately did nothing, outside the 08:00–22:00 sending window.                                |

`phase` narrows a `done = 0` row down to where it stopped, in the order the
work happens: `planned` (the queue was read), `resolved` (the attachment came
out of R2 and was base64-encoded — the memory-hungry part), `claimed` (the row
was marked in flight, before any Gmail call), `sent`. A tick stuck at
`planned` and one stuck at `claimed` are dying in different places and need
different fixes.

A row is deleted only after every one of its recipients has been attempted, so
an invocation killed halfway leaves one whose log says something went out under
its id while most of the list is still waiting. The tick settles up before it
plans anything: delivered addresses are subtracted, a row with nobody left is
dequeued, and a narrowed one carries on. Reading that state either way round
has cost us both errors already — a duplicate delivery on 4 September, and a
row that would have written off two of its three recipients on the 5th.

This table exists because on 2026-09-05 the queue stalled for six and a half
hours and none of those three could be told apart: `wrangler tail` is the only
live window onto a Pages Function, and it would not connect.

**What the site can and cannot see.** The sync only ever fetches threads
recorded in `mail_threads`, and a row lands there only when the site itself
sends a message. No page, endpoint or helper lists the mailbox, so the rest
of `turkey.rsg@gmail.com` never reaches the website — for admins either.
Gmail's history feed does name the ids of unrelated messages; the sync
discards them without fetching or storing anything.

#### Symposium site — nightly rebuild

The symposium website is a static Astro build deployed to the `symposium-website`
Cloudflare Pages project (the main site's is plain `website` — neither matches
the `name` in its own `wrangler.toml`, so use these when reaching for a project
by name). Which edition is marked "upcoming" is derived from
the clock *at build time*, so the site does not automatically notice when a
date passes. Without a nightly rebuild, a symposium would stay "upcoming" for
weeks or months after it ended, until someone happened to push a commit.

A Cloudflare Worker (`workers/symposium-cron/`) runs at 01:17 UTC every day
(04:17 in Türkiye — after midnight local, so the day flips before the first
visitor arrives) and triggers a rebuild of both sites via deploy hooks. To set it up:

1. Create a deploy hook in the `symposium-website` Cloudflare Pages project's
   **Settings → Build, deployments, environment** → **Build settings → Deploy hooks**.
2. Set the hook URL as a secret in the Worker:
   ```
   cd workers/symposium-cron && npx wrangler secret put SYMPOSIUM_DEPLOY_HOOK
   ```
3. Do the same for the main site: its home page "Event" card and /events
   also decide "upcoming" at build time. Create a deploy hook on the `website`
   Pages project (branch `main`) and set it on the Worker:
   ```
   cd workers/symposium-cron && npx wrangler secret put WEBSITE_DEPLOY_HOOK
   ```
   A missing hook makes the tick fail on purpose, so set both secrets before
   deploying.
4. Deploy the Worker:
   ```
   npx wrangler deploy
   ```

The main site's admin panel (`functions/api/admin/symposium/edition.ts`) fires
this same deploy hook after every save, so the same URL must also be set as a
secret on the **main** (`website`) Pages project:
```
wrangler pages secret put SYMPOSIUM_DEPLOY_HOOK --project-name website
```
A save never fails because of this hook -- if it's missing or the endpoint is
down, the edit is still stored and the nightly rebuild above picks it up
regardless. The response just says whether the rebuild started, so a hook
that has quietly stopped working is visible in the panel rather than silent.

To test it without waiting for 01:17 UTC, invoke the scheduled handler
locally (see *Triggering either Worker by hand* below) — it should start a
build in the `symposium-website` project immediately.

**Archiving a finished edition.** Before the rebuild, the same Worker calls
`POST /api/admin/symposium/archive` on the **main** site. That endpoint reads
every edition that has a row in D1 at all (there only ever is one once an
organizer has edited it through the CMS), reads its `editions/<year>.md` off
the **repo** — the one place the symposium's own dates live — to work out
whether the event is over yet (the same rule the symposium site itself uses
to decide an edition is no longer upcoming: midnight after `endDate`, or
`startDate` if there's no `endDate`), and for any that have finished and
whose CMS overlay has not yet been folded in, renders its D1 rows to the
content collection's JSON shape and opens a pull request against this repo —
the same `GITHUB_PAT` used for blog submissions, so no separate GitHub
credential is needed. A human still reviews and merges that PR; nothing here
writes to `main` directly. Once the PR's URL is recorded (`archived_pr_url`),
that edition is reported as already archived rather than re-submitted — the
endpoint is safe to call every night, or twice in one night, without opening
a second PR for the same edition, and safe to retry after a crash mid-attempt
without a human reconciling anything by hand.

Like `/api/mail/dispatch`, this is a server-to-server call authenticated by a
shared secret rather than a session, so it needs that secret in both places,
the same value in each:
```
cd workers/symposium-cron && npx wrangler secret put SYMPOSIUM_ARCHIVE_SECRET
wrangler pages secret put SYMPOSIUM_ARCHIVE_SECRET --project-name website
```

Two things will make you think this is broken when it is not, and we lost an
hour to both on 2026-09-03:

1. **`wrangler dev --test-scheduled` reads the Worker's secrets from the local
   `.dev.vars`, not from the deployed Worker.** A stale value there makes every
   local tick report `archive: ERROR 403` while the deployed Worker is fine.
   Sync `.dev.vars` whenever you rotate the secret, or you are testing nothing.
2. **A newly set Pages secret takes a minute or two to reach the edge after the
   build goes Active.** Calling the endpoint the moment the deployment flips
   returns 403; the same call a minute later returns 200. Measured: 403 at
   +25s, 403 at +50s, 200 at +75s. Wait before concluding anything.

To check the whole path end to end, call the endpoint directly with the value
you just set -- an empty or mismatched secret both fail closed to 403, so a
403 alone never tells you which one you have.

#### Symposium certificates

After a symposium, organisers upload the certificate PDFs and a CSV in the
admin panel (Symposium → Certificates). Participants open
`/certificates/` on the symposium site, enter their email address and view or
download their PDFs. The files live in the private `rsg-mail-attachments`
bucket under `certificates/`, the rows in D1; both, email addresses included,
are deleted 30 days after upload by `POST /api/admin/certificates/purge`,
which the symposium-cron Worker above calls every night before it rebuilds.
The symposium home page shows a "certificates are ready" band while any
year has certificates left. Design:
`docs/superpowers/specs/2026-10-11-symposium-certificates-design.md`.

Setup, once:

1. Apply the tables: `npx wrangler d1 execute rsg-members --remote --file=db/schema.sql` (note 7l).
2. R2 lifecycle rule on bucket `rsg-mail-attachments`: Cloudflare dashboard → R2 → `rsg-mail-attachments` → Settings → Object lifecycle rules → Add rule: prefix `certificates/`, delete objects 31 days after upload.
3. No WAF rate-limiting rule: on this account's plan the dashboard offers it only as a paid add-on (checked 2026-10-12). The lookup enforces its own limit (20 per 10 minutes per IP, in D1), which is what slows email probing. What an edge rule would add is protection for the Functions quota: a flood could use up the free 100 000 requests/day, and the API would stop until 00:00 UTC -- nothing billed, static pages unaffected. Revisit only if that happens.
4. Redeploy the cron Worker so it has `PURGE_URL`: `cd workers/symposium-cron && npx wrangler deploy`.
5. Organisers: CSV columns `email,name,type,file`; types `participation|workshop|presentation|appreciation` or `katılım|workshop|sunum|teşekkür`; PDFs only; everything is deleted 30 days after upload.

The purge uses the same `SYMPOSIUM_ARCHIVE_SECRET` as the archive call, so no
new secret is needed. The browser checks live in `tests/browser/` and are run
by hand: `certificates-admin.mjs` (needs `npm run build && npm run preview`
running) and `certificates-page.mjs` (builds and serves the symposium site
itself, against a stub API).

#### How both cron Workers report failure

`workers/mail-cron/` and `workers/symposium-cron/` follow the same two rules,
and both exist because a scheduler that fails quietly is worse than none.

**A failed call fails the invocation.** Each Worker logs every attempt, then
raises, so a bad secret or an expired deploy hook shows up as a *failed*
invocation in the Cloudflare dashboard rather than a successful one with a log
nobody is tailing. Check `wrangler tail` for the response body behind a
failure.

**Neither is reachable from the internet.** Both set `workers_dev = false` and
bind no route, so the `fetch` handler — which performs the real action, sending
mail or starting a build — answers only under `wrangler dev`. If a remote
trigger is ever needed, give the handler a shared-secret header first; do not
simply re-enable the subdomain.

##### Triggering either Worker by hand

Run the Worker locally with its scheduled handler exposed, then call it:

```
cd workers/symposium-cron   # or workers/mail-cron
npx wrangler dev --test-scheduled
curl "http://localhost:8787/cdn-cgi/handler/scheduled"
```

`wrangler dev` does not have the deployed Worker's secrets, so put the ones it
needs in a local `.dev.vars` file in that Worker's directory
(`SYMPOSIUM_DEPLOY_HOOK=…`, or `MAIL_SYNC_SECRET=…`). That file is
gitignored — keep it that way. Note this fires the **real** action against the
real deploy hook or mailbox; there is no dry-run mode.

The Cloudflare dashboard may also offer a way to fire a Cron Trigger on
demand. If it does, it invokes the same `scheduled` handler as the schedule
does and is unaffected by `workers_dev` — but the local route above is the one
documented by Cloudflare, so prefer it unless you have checked.

## The admin panel

`/admin` (and `/tr/admin`) is one page with a grouped menu. Each person sees
only the sections their roles allow; the server still checks every request.
The address records where you are, so a link such as `/admin#sempozyum/komite`
opens that sub-page directly and reload and back keep working. A section with
sub-pages opens its first one on a laptop; on a phone it opens a list of them,
and a ‹ button returns from a sub-page to the list. Counts of waiting work
(e-mail, social approvals, blog posts) show next to the menu entries and on
Overview.

- **Overview** (`#genel`): what is waiting, plus the status banner. Shown when
  you can open two or more sections.
- **Communication**: E-posta (admins), Social media (editors, publishers,
  admins), Announcements (announcers, admins).
  E-posta sub-pages (`#eposta/...`): Inbox `gelen` (senders see their own
  threads, admins can switch to all members; `#eposta/gelen/<threadId>` opens
  one thread, and the reply notification mail links there), Compose `yaz`
  (senders), Sent `gonderilenler` (senders and admins), and admin-only `yetki`
  (grant sender access), `gondericiler` (senders) and `ekler` (attachments).
  Senders without admin rights see only the E-posta section. The old
  `/account/mail` and `/account/conversations` pages (and `/tr` twins) forward
  to `#eposta/yaz` and `#eposta/gelen`.
- **Content**: Blog (admins), Symposium (symposium editors, admins).
- **Community**: Users and roles (admins). Membership has an entry but stays
  hidden until it is built.
- **System**: Connections and Activity log (admins).

The section ids in the address are Turkish (`eposta`, `sosyal`, `duyurular`,
`blog`, `sempozyum`, `kullanicilar`, `baglantilar`, `kayit`). The routing table
is `src/scripts/admin/sections.ts`. `tests/browser/admin-overflow.mjs` opens
every section at 390 and 1280 px and checks for horizontal scroll and 44 px
touch targets.

## Connections and the status banner

The admin panel (`/admin`) shows a banner when something the site depends on is
broken, and a **Connections** pane (admins only) listing each
outside account the site uses. Every connection change, role change, audit
export and pane view is written to the **Log** pane, kept for a year.

### What each banner line means

- **Gmail needs to be reconnected.** The stored Gmail token was rejected, or has
  expired. Open Connections > Gmail > Reconnect and sign in as
  `turkey.rsg@gmail.com`. Any other account is refused. The
  `GMAIL_REFRESH_TOKEN` secret (see [Sending mail as
  RSG](#sending-mail-as-rsg--required-setup)) is only a fallback for when the
  stored token cannot be read at all, for example `TOKEN_ENC_KEY` is missing or
  was changed. After a password change Google revokes the grant, so mail stops
  until someone reconnects.
- **The scheduler is not running.** The mail dispatcher has not checked in for
  more than 10 minutes. In Cloudflare > Workers, open `rsg-mail-cron` and check
  that its cron trigger is enabled and look at its last invocations. If the
  Worker was deleted, redeploy it:
  `cd workers/mail-cron && npx wrangler deploy`. See [How both cron Workers
  report failure](#how-both-cron-workers-report-failure).

A connection also shows as "expiring" in the Connections pane when its token
runs out within 14 days.

### One-time setup

Do these in order. Steps 1 to 3 happen **before** the pull request is merged;
step 4 happens **after** it is merged and Pages has deployed.

1. **Before merging: generate and set the vault key.** Connection tokens are stored encrypted
   with this key:

   ```
   openssl rand -base64 32 | npx wrangler pages secret put TOKEN_ENC_KEY --project-name website
   ```

   Store the same value in the organisation's password manager. If it is lost,
   every stored token must be reconnected, but mail falls back to
   `GMAIL_REFRESH_TOKEN` in the meantime.
2. **Before merging: add the redirect URI and scopes in Google Cloud.** In APIs & Services > Credentials,
   open the OAuth client and add this authorised redirect URI:

   ```
   https://rsg-turkiye.iscbsc.org/api/admin/connections/gmail/callback
   ```

   Nothing has to change under Data access. While the app is unverified,
   Google grants the scopes the site asks for at sign-in (`openid`, `email`,
   `gmail.send`, `gmail.readonly`) whether or not they are listed there;
   the list only feeds Google's verification review. Adding a restricted
   scope to it starts asking for a justification and a demo video, so leave
   it as it is.
3. **Before merging: run the migrations** listed as 8a, 8b and 8c at the top
   of `db/schema.sql`. The new code reads these tables as soon as it deploys.

   Now merge, and wait for the Pages deploy to finish.
4. **After merging and the deploy: redeploy the daily Worker** so it picks up
   `AUDIT_PRUNE_URL`. Doing this earlier makes it call an endpoint that does
   not exist yet. It then prunes the audit log nightly:

   ```
   cd workers/symposium-cron && npx wrangler deploy
   ```

## Social media content (phase 2a)

The content backend for the social media panel is in place. Plans, posts and
the approval flow live under `/api/social/*` (plans, posts with submit,
approve, reject and cancel, event modes, editors).

### What exists now

- Plans and posts, including drafts and plan slots.
- The approval flow: submit, approve, reject, cancel.
- Event modes, which publishers open and close.
- Email notifications for the flow.
- Nightly plan reminders: `/api/admin/social/plan-reminders`, called by
  `workers/symposium-cron` through `SOCIAL_REMINDERS_URL`. It mails about
  plans that are still empty two days out.

### What does not exist yet

Publishing is described in the next section. The phone quick story and a
`/links` page are not built.

Caption length is counted conservatively on purpose: an emoji outside the
basic plane counts as two characters, so a post that passes here will not be
cut off by the platform.

### Roles

- **Editors** plan and draft, submit for approval, and edit and cancel their
  own posts.
- **Publishers** schedule directly, approve or send back with a note, cancel,
  and open event windows. Admins count as publishers.
- An editor's story skips approval only inside an open event window that
  names them.

### Using the panel

The panel is at `/admin` → Social media. Editors, publishers and admins see
it; nobody else does.

- **Calendar and board.** A plan slot is a dashed box. An empty slot due
  within two days turns red.
- **Composer.** Alt text is required on every image. Images must be JPEG or
  PNG and are stored as JPEG. Counters are shown per platform and count
  conservatively (UTF-16 units). The checklist uses the server's own
  readiness rule, so it matches the server exactly. Drafts autosave. Autosave
  stops if someone else changes the post, and pauses after any failed save
  until you press Save.
- **Text on images.** Every image card has a **Text** button. It opens an
  editor where you add up to five texts, drag them into place, resize them
  (pinch or slider) and pick colour, background and alignment. The text is
  drawn into the image itself, because Instagram does not let the panel add its
  own text stickers. The image without text is kept, so you can press **Text**
  again and edit or remove it, and **Crop** keeps the text on the new crop.
  Since the text is now part of the picture, the card suggests adding it to
  the alt text.
- **Editors** see only their own posts as editable; others' posts are
  read-only. Editing a scheduled post as an editor sends it back to approval.
- **Publishers** approve, send back with a note, cancel, and open or close
  event windows.

### Before deploying

1. **Before merging: run migration 8d** (see the top of `db/schema.sql`):

   ```
   wrangler d1 execute rsg-members --remote --file=db/schema.sql
   ```
2. **Merge and wait for the Pages deploy to finish.**
3. **After the deploy: redeploy the daily Worker** so it calls
   `SOCIAL_REMINDERS_URL`. Doing this before the merge makes the Worker call
   an endpoint that does not exist yet, and it gets a 404:

   ```
   cd workers/symposium-cron && npx wrangler deploy
   ```

### Notifications

Notification mail goes out from `RSG_MAIL_FROM` and is not recorded in sent
mail. When Gmail is broken they pause, and the status banner already says so.

## Social media publishing (phase 3a)

Instagram posts (feed, carousel, story) go out from the panel. LinkedIn and X
publish too, once connected (sections below). A platform that was never
connected is skipped (target `skipped`, reason `not_connected`), so Instagram
still publishes. A connected platform whose connection is broken waits for a
reconnect.

### One-time setup

Do these in order. Steps 1 to 3 happen **before** the pull request is merged.

1. **Meta app.** Under Instagram > API setup with Instagram login, add this
   redirect URI and note the Instagram app ID and secret:

   ```
   https://rsg-turkiye.iscbsc.org/api/admin/connections/instagram/callback
   ```
2. **Set the two Pages secrets** (`TOKEN_ENC_KEY` already exists). The social
   tick reuses `MAIL_SYNC_SECRET` and the daily refresh reuses
   `SYMPOSIUM_ARCHIVE_SECRET`, so there are no other new secrets. There are two
   new Worker vars, `SOCIAL_DISPATCH_URL` and `SOCIAL_REFRESH_URL`; they are in
   the Workers' `wrangler.toml` and arrive with the redeploy in step 6:

   ```
   npx wrangler pages secret put INSTAGRAM_APP_ID --project-name website
   npx wrangler pages secret put INSTAGRAM_APP_SECRET --project-name website
   ```

   Pages reads secrets only when it deploys. After adding or changing a Pages
   secret, redeploy (Cloudflare dashboard > Workers & Pages > website >
   Deployments > latest production > Retry deployment), or the running site
   keeps the old values. Connecting or reconnecting an account in the panel
   needs no redeploy: tokens live in D1.
3. **Run migration 8e**, the three commands at the top of `db/schema.sql`.
   Each `ALTER TABLE` runs once.
4. **Merge** and wait for the Pages deploy to finish.
5. **Clear out old scheduled posts.** Open the Scheduled list (calendar or
   board) and cancel or reschedule every test or stale post before the next
   step. From the first tick, every scheduled post with Instagram goes out, to
   whichever account is connected at the time. Each one already past its time
   is held instead, and emails the publishers once with a "needs a decision"
   mail. Do the test-account run in step 7 when no real post is due, or with
   the real posts unscheduled until it is done.
6. **Redeploy both Workers** after the deploy, so they pick up
   `SOCIAL_DISPATCH_URL` (`workers/mail-cron`) and `SOCIAL_REFRESH_URL`
   (`workers/symposium-cron`):

   ```
   cd workers/mail-cron && npx wrangler deploy
   cd workers/symposium-cron && npx wrangler deploy
   ```

   The banner's scheduler line will show until the `mail-cron` Worker is
   redeployed; mail is still going out.
7. **Test first.** Connect a **test** Business account added as an Instagram
   Tester and publish one of each type to it. Only then connect @rsgturkey.

Connections > Instagram can show these error codes after a failed connect:
`not_configured`, `not_professional`, `cancelled`, `token_exchange`,
`missing_scope`, `store_failed`, `bad_state`, `not_admin`.

### How a post goes out

- A tick runs every minute (`mail-cron`, authenticated with
  `MAIL_SYNC_SECRET`). It picks up due targets: first it creates the Instagram
  container, then publishes it.
- **Lateness.** A queued target more than 2 hours past its time is not sent.
  That includes one put back in the queue after waiting for the connection,
  even if it kept its container. It waits as `needs_confirmation` until a
  publisher presses **Publish anyway**. A target already retrying is not held
  to this: it runs out its own 2-hour retry window.
- **Retries.** A failed attempt is retried every minute for 2 hours. A target
  still retrying when that window ends fails, and the author and publishers
  get a mail. A target still "processing" at Instagram after 2 hours fails with
  a sentence saying so.
- **Never twice.** The Instagram container is kept between attempts. Only a
  successful status read of `EXPIRED` recreates it, and only `ERROR` lets a
  failed target drop it; any other failure keeps it, so a post is never
  published twice. While a target holds a container, or a tick is working on
  it, the post cannot be edited or cancelled (`publishing_started`): use
  **Retry** (or **Publish anyway** for a late one), which re-reads the
  container.
- **Retry and Publish anyway** are publisher actions, in the side panel and on
  the Published tab. They keep the container and re-read its status.
- **`waiting_connection`.** If the connection is broken, targets wait. A
  successful token refresh or a reconnect puts them back in the queue, and so
  does any tick that finds the connection working.
- **Stories need a Business account.** A Creator token is refused with
  "(#10) The user is not an Instagram Business". Feed posts and carousels work
  with Creator.
- The API cannot delete a published post. Remove it in Instagram.

### Banner lines and what to press

- **Instagram connection broken.** Open Connections > Instagram > Reconnect.
  Posts that were waiting are queued again.
- **Instagram expiring.** The token is near its end. The daily refresh
  normally handles it. If the line stays, reconnect.
- **The scheduler is not running.** The line now covers both the mail tick and
  the social tick (`dispatch_runs.kind`). Before migration 8e only mail is
  measured. Check `rsg-mail-cron` as described under [What each banner line
  means](#what-each-banner-line-means).

### Token

The Instagram token lasts 60 days. `symposium-cron` refreshes it daily once
fewer than 20 days are left. Only an Instagram auth refusal, or any failure
within 3 days of expiry, marks the connection broken and emails admins. A
temporary failure is logged and tried again the next day.

### LinkedIn

Posts go out as the RSG Page through LinkedIn's Community Management API.
Access is granted per app on application; the app is "RSG-Turkiye Social"
at developer.linkedin.com, verified by the Page.

Setup, once access is approved:

1. Products tab: Community Management API shows as granted. Auth tab: the
   redirect URL
   `https://rsg-turkiye.iscbsc.org/api/admin/connections/linkedin/callback`
   is listed, and the scopes `w_organization_social`, `r_organization_social`
   and `rw_organization_admin` appear under "OAuth 2.0 scopes". If LinkedIn
   names them differently, change `LI_SCOPES` in
   `functions/_lib/social/linkedin.ts`.
2. Pages secrets, entered in a separate terminal so they never reach a
   transcript:
   `npx wrangler pages secret put LINKEDIN_CLIENT_ID --project-name website`
   and the same for `LINKEDIN_CLIENT_SECRET`. Then redeploy (Pages secrets
   apply only to new deployments).
3. `LINKEDIN_ORGANIZATION` in `wrangler.toml` is the Page's vanity name
   (`linkedin.com/company/<this>`).
4. Connections, Connect LinkedIn, signed in as a Page Super admin.

Tokens last 60 days. The daily refresh (`symposium-cron`) renews the access
token inside its last 20 days when LinkedIn issued a refresh token; the
refresh token lasts a year from the connect. Either way the admins get a mail
14, 7, 3 and 1 days before a reconnect is needed.

### X

Posts go out as @rsgturkey through the X API, which is pay per use: about
$0.015 per post, $0.20 for a post with a link (October 2026 prices). Credits
are bought in advance at console.x.com; saving a card there gives a one-off
credit, and a spending limit per billing cycle can be set.

Setup:

1. console.x.com, the project's app, "User authentication settings": OAuth
   2.0, type "Web App" (confidential client), permissions "Read and write",
   callback URL
   `https://rsg-turkiye.iscbsc.org/api/admin/connections/x/callback`,
   website `https://rsg-turkiye.iscbsc.org`.
2. Pages secrets `X_CLIENT_ID` and `X_CLIENT_SECRET` (OAuth 2.0 Client ID
   and Secret, not the API key pair), entered as above; redeploy.
3. Connections, Connect X, signed in as @rsgturkey.

The access token lasts two hours and is renewed when a post needs it and once
a day; each renewal replaces the refresh token. "No API credits" on a failed
post means the balance ran out.

### Buffer (LinkedIn and X)

LinkedIn and X can post through Buffer instead of their own APIs: the panel
still decides what goes out and when, and at the scheduled minute it hands
the post to Buffer with "share now", then reads back the link (spec
`docs/superpowers/specs/2026-10-19-buffer-transport-design.md`). Instagram
always posts directly. Which way a platform posts is decided by its
connection, so going back is a reconnect, not a code change.

Instagram can go through Buffer too ("Connect through Buffer" on its row);
its direct connection stays the default. Through Buffer, Instagram has no
messages: the DM tab says so, and nothing that uses the Instagram token (the
daily refresh, the DM poll and endpoints) runs. "Connect directly" on the
Instagram row switches back.

Setup (the Buffer account is turkey.rsg@gmail.com, free plan, 3 channels):

1. In Buffer, connect the LinkedIn Page (choose "LinkedIn Page", not the
   profile), X and, if wanted, the Instagram professional account.
2. Buffer, Settings > API: create a key with `account:read`, `posts:read` and
   `posts:write` only. In a separate terminal:
   `npx wrangler pages secret put BUFFER_API_KEY --project-name website`.
3. `BUFFER_KEY_EXPIRES` in `wrangler.toml` is the day the key expires, as
   Buffer shows it (keys last a year). Deploy.
4. Connections: "Connect through Buffer" on LinkedIn and on X (and
   Instagram, if it should post through Buffer).

Buffer fetches the images from `PUBLIC_BLOG_IMAGES_URL`. The free plan allows
250 API calls a day; a post costs about seven per platform. The daily job
checks the channels once (a channel disconnected or locked in Buffer marks
the connection broken and mails the admins) and mails the admins 30, 14 and
3 days before the key expires. To renew it: a new key in Buffer, the
`wrangler pages secret put` above, the new date in `BUFFER_KEY_EXPIRES`,
deploy, then delete the old key in Buffer. `BUFFER_KEY_EXPIRES` is read
when it is used, so the new date counts as soon as it is deployed. Comments
are answered in Buffer's Community tab; Buffer's API has no comments or
messages yet.

If Buffer's answer to a create is lost, the target looks for the post in the
channel's list for ten minutes before sending it again. A target switched
between Buffer and a direct connection while a post was in flight ends
`failed` with "uncertain": check the account before pressing Retry.

### If a post's answer is lost

If a create call's answer is lost (a timeout, say), the next tick deals with it
before posting again. LinkedIn reads the Page's recent posts to find it. X
sends the post again and X's duplicate check stops a second copy; that is safe
while the text is unchanged (the panel requires text for X). A target that
cannot be confirmed ends `failed` with "uncertain" after two hours. Someone
should look at the LinkedIn Page or the X account before pressing Retry. If
the text of an "uncertain" X target was edited before Retry, check the X
account first. X media uploaded for a post expires after about a day, so an
"uncertain" X target held longer than that cannot succeed on Retry; check the
account and, if it did not go out, create the post again.

### Yearly upkeep

- LinkedIn retires each API version about a year after release: bump
  `LI_VERSION` in `functions/_lib/social/linkedin.ts` to a current `YYYYMM`
  once a year.
- Buffer API key: renew it before `BUFFER_KEY_EXPIRES` (the admins are
  mailed 30, 14 and 3 days before); see [Buffer](#buffer-linkedin-and-x).
- At handover: reconnect LinkedIn as one of the incoming Page Super admins,
  reconnect X if the account's password changed, and keep the X card or
  credits with the incoming lead.

## Statistics

Admin panel → **Statistics** (`#istatistik`, admins only) shows counts, never
who: visits, accounts, learning-path progress, published content and blog
submissions, e-mail, social posts and symposium certificates. Columns compare
this month, last month, this year and last year in Türkiye time; an earlier
year (the selector) compares itself with the year before. Every view is
written to the Log as `read.stats`. Code: `functions/api/admin/stats.ts`,
`functions/_lib/stats.ts`, `src/scripts/admin/sections/stats.ts`.

**Certificates** are counted when a participant opens one in the page
(`views`) or uses Download (`downloads`), columns on `symposium_certificates`
(migration 8h). The nightly purge folds a year's counts into
`certificate_stats`, which holds numbers only, before it deletes the
certificates, so the counts outlive them.

**Visits** come from Cloudflare Web Analytics: cookieless, no consent banner,
described on the privacy page. Setup, once:

1. Cloudflare dashboard → Web Analytics → Add a site, for
   `rsg-turkiye.iscbsc.org` and for `symposium.rsg-turkiye.iscbsc.org`, with
   the JS snippet option (the DNS is not on Cloudflare). Each gives a token.
   It is public, printed in every page.
2. Put the tokens in `src/data/web-analytics.ts` (main site) and
   `symposium_website/src/lib/web-analytics.ts`. The beacon is left out of
   `/admin` and `/account` pages.
3. Create an API token with **Account → Account Analytics → Read** only, and
   in your own terminal:
   `npx wrangler pages secret put CF_ANALYTICS_TOKEN --project-name website`.
4. Set `WEB_ANALYTICS_SINCE` in `wrangler.toml` to the day the beacon went
   live. Periods before it show a dash rather than a misleading zero.

Cloudflare samples these events and visitors with ad blockers are not
counted, so the numbers are somewhat low; the panel says so. For a local
preview, `CF_GRAPHQL_URL` can point the reader at a stand-in endpoint.

## Content (CMS)

The admin panel can edit the site's events, workshops and webinars. It does
not write to the live site directly. Every change is a draft, and a draft
reaches the site only as a pull request that an approver has approved and
that passes the same checks as any other change. Published content lives only
in git; the panel keeps just the drafts, in the `content_drafts` table.

The panel section is Content → Etkinlikler (`#icerik-etkinlikler`). The code
is in `src/lib/cms/` (types, serializing, the deployed index), the server
side is `functions/_lib/cms-*.ts` and `functions/api/cms/`.

### Who can do what

There are two roles, both for the Etkinlikler group:

- **Editor** (`content.etkinlikler.edit`) starts drafts, edits them and sends
  them for approval. An editor role lasts at most one month, then is renewed.
- **Approver** (`content.etkinlikler.approve`) does everything an editor can,
  and also approves or sends back drafts, stops a pull request that is
  running, and discards drafts. It is a leader role: up to 12 months, or
  permanent when an admin grants it. An approver may approve their own
  draft.

An admin has both without holding either. Admins grant either role. An
approver can also grant the editor role, for one month at most, so they can
cover for an editor but not widen access on their own. Grants are made in
Users and roles → Roles, like every other role. The rules are in
`functions/_lib/roles.ts`.

### From draft to live

1. An editor writes a draft. Nothing is public yet.
2. **Onaya gönder** (send for approval). The draft waits in the approval
   queue. While it waits (and until it is live or has failed), another draft
   of the same entry can be started and saved but not sent.
3. An approver approves it, or sends it back with a note. Approval first
   checks that the entry on the site is still what the draft started from.
   If it is not, the panel shows what changed and nothing is opened.
4. Approval opens a pull request on the branch `cms/<draft id>`, using the
   organisation's GitHub token.
5. The checks run. Once they are green, the minute-by-minute mail tick
   (`/api/mail/dispatch`, the same one that sends mail) merges the pull
   request. If the branch is behind main, the tick updates it first, and the
   checks run again.
6. Merging triggers the normal deploy. When the deployed `/cms-index.json`
   shows the new file versions, the draft becomes **Yayında** (live). Allow a
   few minutes.

No new Worker is involved: the tick already ran every minute, and the CMS
step in it (`functions/_lib/cms-shepherd.ts`) makes at most 12 GitHub
requests a minute, which moves about two pull requests a minute along (a pull
request costs up to five).

Content is changed through the CMS or a pull request. Only a person approves,
in the panel; the shepherd merges only what a person approved, and nobody
merges a `cms/*` pull request by hand. No agent or script approves.

A webinar that exists only in English is edited as a pair: the form shows an
empty Turkish side, and the draft cannot be sent until it is filled in. The
approved draft adds the Turkish file.

### What the statuses mean

The panel shows each draft with one of these (Turkish in `tr`, the words are
in `src/i18n/ui.ts` under `admin.cms.status.*`):

| Status | Meaning |
| --- | --- |
| Not on the site yet (Henüz sitede değil) | A draft, only saved. |
| Awaiting approval (Onay bekliyor) | Sent, waiting for an approver. |
| Approved, going live (Onaylandı, yayına çıkıyor) | The pull request is being opened. |
| Going live (Yayına çıkıyor) | The pull request is open or merged; checks and deploy are running. |
| Live (Yayında) | The deployed site shows the change. |
| Sent back (Geri gönderildi) | An approver returned it with a note. Change it and send it again. |
| Could not be published (Yayınlanamadı) | The reason follows. See the next section. |
| Deleted (Silindi) | Discarded. Finished drafts are removed from the table after 90 days; the activity log keeps their history. |

Two states show a warning: an approval that did not finish (older than five
minutes; approve again), and a draft that merged more than two hours ago but
is not on the site yet (tell an admin).

### When a draft fails

A failed draft keeps its content and its reason. The author can change it and
send it again, or delete it; an approver can discard it too. Either way the
entry is free. Approvers see every draft that is on its way or stuck under
Onay → "Süren ve takılanlar", each with its way out: stop a pull request that
is open, or discard a merge the site never showed, a failure, or an approval
that never finished.
A retry opens a new pull request. The shepherd closes the failed one, so
nobody should merge it by hand.

| Reason in the panel | What happened | What to do |
| --- | --- | --- |
| conflicts with a newer change (conflict) | The entry changed on main after the draft started, and the two cannot be combined. | Start a new draft from the site's version. |
| check failed: `<name>` | A required check rejected the change, for example a field the build does not accept. | Open the pull request's checks on GitHub, fix the field in the draft, send again. If the check itself is broken, an admin looks at CI. |
| checks did not finish (timeout) | Checks were still pending after six hours. | Look at GitHub Actions for a stuck run, then send again. |
| blocked by branch protection | Checks were green but GitHub refused the merge for six hours. | An owner checks the branch rules (a required review, or a required check that never reports on these branches). The CMS needs neither. |
| closed on GitHub | The pull request was closed without merging, by hand. | Send the draft again, or discard it. |
| cancelled | An approver stopped it on purpose. | Change the draft and send it again, or discard it. |
| merged but the site never showed it | The pull request merged, but 24 hours later the site still did not show the change. | Look at the Pages deploys and at `/cms-index.json`. The content is in git, so check whether the deploy failed. Then discard the draft and, if needed, start a new one. |
| no pull request on record | The draft says its pull request is open, but none is stored. | Send the draft again. If it repeats, an admin looks at the activity log. |
| GitHub did not answer | For twelve hours (twice the six-hour cap) GitHub answered nothing but errors about the pull request. The pull request is left as it is. | Look at the pull request on GitHub and at GitHub's status page. Close the pull request if it is still open, then send the draft again. |

The activity log has a row for every step (`cms.draft.*`, `cms.pr.*`).

If a draft says "changed since", the entry on the site was edited after the
draft was started. Hand edits on GitHub to the content files still work and
are never blocked, but a draft started before one will show "changed since"
and the panel lets the author compare and continue from the site's version.

### Owner steps (once, by the owner, never by an agent), in this order

1. **Before merging the pull request that adds the CMS**, create the table on
   the remote D1 (note 8j at the top of `db/schema.sql`):

   ```bash
   wrangler d1 execute rsg-members --remote --file=db/schema.sql
   ```

   It is safe to run twice. Until it has run, every `/api/cms/drafts` call
   fails with "no such table: content_drafts".
2. In Cloudflare Pages → website → Settings → Builds → Branch control,
   exclude `cms/*` from preview builds. Otherwise every draft queues a
   preview build ahead of production, and builds run one at a time on the
   free plan.
3. On GitHub → the repository's Settings → General, turn on "Automatically
   delete head branches". Otherwise every published draft leaves a `cms/*`
   branch behind.
4. Keep main's branch protection as it is: the two required checks and no
   required approvals (true on 2026-10-24). A required review would block
   every CMS pull request ("blocked by branch protection").
5. Run one trial draft end to end yourself: edit an entry, send it, approve
   it, watch it go to merged and then Yayında.
6. Then, in the Roles view, grant the first `content.etkinlikler.*` roles.

No Worker redeploy is needed.

## Yearly handover

When the committee changes:

- After changing the Gmail password, go to admin panel > Connections > Gmail >
  Reconnect.
- Grant the incoming team their roles in Users and roles → Roles, and remove
  the outgoing team's. Roles end on their own: each grant has an end date,
  and the hourly sweep takes the role away after it. Renew a role before its
  date in the same view; a renewed role starts a new grant.
- Make sure at least two people are admins.
- Change `GITHUB_NOTIFY_USERNAME` in `wrangler.toml` to the GitHub username of
  whoever now reviews blog submissions.
- Go through [Yearly upkeep](#yearly-upkeep) for the social accounts.
- Export the Log (JSON) from the Log pane and keep it with the year's records.
  The panel only keeps a year of history.
- Update the committees on `/about`: one file per committee in
  `src/content/committees/`. Add the incoming members (each with
  `consent: true`) and remove the outgoing ones. See `COMMITTEES_GUIDE.md`.

### How roles work

Every role is a grant in the `role_grants` table: who holds it, until when
(or permanently), and who granted or ended it. Leader roles (admin,
announcer, symposium, social publisher, content approver) can last up to 12
months, or be made permanent by an admin. Edit roles (writer, sender, social,
content editor) last up to one month, then are renewed. The end date a person picks is inclusive: the role
works through that whole day. The `users.is_*` columns are only a cache that
permission checks read; they are rewritten from the live grants in the same
batch as every change, and the hourly sweep in `/api/mail/dispatch` ends
expired grants and rewrites the cache, day and night. The rules (the catalog,
who may grant what, the allowed durations) are in `functions/_lib/roles.ts`;
the database side is in `functions/_lib/role-grants.ts`.

---

## Content Types

### Blog Posts (`src/content/blog/`)

General articles — tutorials, member spotlights, event recaps, research summaries.

**Schema** (frontmatter fields):

```yaml
title: "Your Post Title"
pubDate: 2025-01-15
description: "One or two sentence summary shown in listings."
author: "Your Name"
category: general          # or: tutorial, research, event, etc.
tags: [bioinformatics, python]
image: ""                  # Thumbnail shown in the blog listing. If empty, the first image in the post body is used automatically.
draft: false               # set true to hide from listings
```

### Webinars (`src/content/webinars/`)

Structured webinar pages with speaker info, YouTube embed, slides, and key takeaways.

**Schema** (frontmatter fields):

```yaml
title: "Webinar Title"
date: 2025-03-10
speaker: "Dr. Jane Smith"
speakerTitle: "Assistant Professor"
speakerAffiliation: "MIT"
description: "Brief summary of the talk."
youtubeUrl: "https://youtu.be/xxxx"
slidesUrl: ""              # optional
speakerPhoto: ""           # speaker photo URL (optional)
image: ""                  # card image (optional)
topic: "Structural Biology" # shown as a badge
keyTakeaways:
  - "First key point"
  - "Second key point"
year: 2025
type: bioinfonet           # or: student
domains: [genomics]        # learning path domains this talk belongs to (optional)
draft: false
```

### Events, workshops, resources, committees and page texts (`src/content/*/*.json`)

These are JSON collections, one file per entry (page texts: one file per page). No code change is needed to edit them. The admin panel edits events, workshops and webinars as pull requests (see [Content (CMS)](#content-cms)); the other collections are edited by hand.

| Collection | Where | Notes |
| --- | --- | --- |
| Events | `src/content/events/<id>.json` | The home page, the events page and the calendar. The file name is the event `id`. |
| Workshops | `src/content/workshops/` | The workshops page. `repo` is the GitHub repository name with its real case; the file name is the same name in lower case. |
| Resources | `src/content/resources/` | The `/resources` page, in both languages. Not the learning paths; those are Markdown (below). |
| Committees | `src/content/committees/` | `/about`. Published profiles, with the member's consent (`consent: true`). E-mail addresses are not allowed; the schema refuses them. |
| Page texts | `src/content/pages/{home,about,join,resources}.json` | The visible wording of those pages, as `{ en, tr }` pairs. |

The schemas and helpers are in `src/data/*.ts`; the loaders are in `src/lib/get-*.ts` and `src/lib/page-text.ts`. A file that does not match its schema fails the build; the schemas are strict, so a misspelt key fails too. File names are lowercase slugs (`[a-z0-9-]+.json`); `tests/content-file-names.test.ts` checks it. `tests/content-not-in-code.test.ts` fails if a data array comes back into `src/data/events.ts`, `src/data/workshops.ts` or `src/data/committees.ts`, or a literal resource list into `src/pages/resources.astro` or `src/pages/tr/resources.astro`.

### Learning Paths (`src/content/lp-domains/`, `lp-levels/`, `lp-roadmap/`)

Curated resource paths organised by domain and experience level. All content is Markdown — no code changes needed to add or update resources.

**Domains:** genomics, ml, structural, metagenomics (more can be added by creating a new `lp-domains/` file)

**Resource ids:** every resource has an `id`. It is the key under which members' progress is saved, so never change or reuse one; reorder, add and delete freely. `tests/lp-resource-ids.test.ts` checks this.

**Levels:** explorer → practitioner → researcher → specialist

**Routes:**
- `/learning-paths/` — index with two entry axes (sequential roadmap + domain grid)
- `/learning-paths/roadmap` — beginner path (8 stages, data from `lp-roadmap/`)
- `/learning-paths/[domain]` — domain pages with per-level tab switcher

See [CONTRIBUTING.md § Managing Learning Paths](CONTRIBUTING.md#6-managing-learning-paths) for the full member workflow.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for a full guide on writing blog posts, translating content, and adding webinars.

---

## CI / GitHub Actions

| Workflow                      | Trigger                               | What it does                                                                                                                                |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Build Check**               | Every PR to `main`                    | For both sites: `astro check`, build and unit tests. The PR cannot be merged if any of them fails.                                          |
| **Translation Check**         | PRs that touch blog posts or webinars | Comments when a new file has no translation in the other language. A reminder, not a blocker.                                               |
| **Learning Paths Link Check** | Mondays, plus manual                  | Checks every learning-path link and reports dead ones in an issue labelled `link-check`.                                                    |
| **Dispatch scheduled mail**   | Manual only                           | Sends due mail immediately. The real schedule is the `rsg-mail-cron` Worker; see [Scheduled sending](#sending-mail-as-rsg--required-setup). |
