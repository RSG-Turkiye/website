# RSG Turkey Website

Official website of [RSG-Türkiye](https://rsg-turkiye.iscbsc.org) — the ISCB Regional Student Group for computational biology and bioinformatics in Turkey.

Built with [Astro](https://astro.build) and [Tailwind CSS v4](https://tailwindcss.com). Deployed automatically via Cloudflare Pages on every push.

| | |
|---|---|
| **Production** | [rsg-turkiye.iscbsc.org](https://rsg-turkiye.iscbsc.org) |
| **Stable (Cloudflare)** | [website-dkh.pages.dev](https://website-dkh.pages.dev) |
| **Dev branch** | [website-dev-vi6.pages.dev](https://website-dev-vi6.pages.dev) |
| **Symposium** | [symposium.rsg-turkiye.iscbsc.org](https://symposium.rsg-turkiye.iscbsc.org) |

---

## Tech Stack

| Tool | Purpose |
|------|---------|
| [Astro 5](https://astro.build) | Static site generator |
| [Tailwind CSS v4](https://tailwindcss.com) | Styling |
| [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/) | Blog posts and webinars as Markdown files |
| [Cloudflare Pages](https://pages.cloudflare.com) | Hosting and CI/CD |

---

## Project Structure

```
/
├── public/                  Static assets (images, flags, logo)
├── src/
│   ├── components/
│   │   ├── learning-paths/  ResourceCard, ProgressBar, LevelSwitcher, DomainCard
│   │   └── …                Other reusable components
│   ├── content/
│   │   ├── blog/
│   │   │   ├── en/          English blog posts
│   │   │   └── tr/          Turkish blog posts
│   │   ├── webinars/
│   │   │   ├── en/          English webinar pages
│   │   │   └── tr/          Turkish webinar pages
│   │   ├── lp-domains/      Learning path domain metadata (one file per domain)
│   │   ├── lp-levels/       Learning path content (one file per domain × level)
│   │   └── lp-roadmap/      Beginner roadmap stages (one file per stage)
│   ├── data/                Static data (committees, announcements)
│   ├── i18n/                Translation strings (ui.ts)
│   ├── layouts/             Page layouts (BaseLayout.astro)
│   ├── pages/
│   │   ├── blog/[slug].astro
│   │   ├── webinars/[slug].astro
│   │   ├── learning-paths/
│   │   │   ├── index.astro         Learning paths hub
│   │   │   ├── roadmap.astro       Sequential beginner path
│   │   │   └── [domain].astro      Dynamic domain pages
│   │   └── tr/              Turkish routes (mirrors pages/)
│   └── styles/              Global CSS
├── astro.config.mjs
├── content.config.ts        Content collection schemas
└── package.json
```

---

## Local Development

**Prerequisites:** Node.js 18+

```bash
# Install dependencies
npm install

# Start dev server at http://localhost:4321
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## How the Site Works

### Bilingual Content (EN / TR)

The site supports English and Turkish. Language is determined by **directory**, not frontmatter:

- `src/content/blog/en/my-post.md` → `/blog/my-post`
- `src/content/blog/tr/my-post.md` → `/tr/blog/my-post`

UI strings (navigation, buttons, labels) are translated in `src/i18n/ui.ts`.

### Automatic Translation Links

If an English article and a Turkish article share the **same filename**, the site automatically shows a "Read in Turkish / Read in English" button on each article page, and the language switcher navigates between them directly.

Example:
```
blog/en/crispr-genome-editing.md   ←→   blog/tr/crispr-genome-editing.md
```

### Deployment

Pushing to `main` triggers an automatic Cloudflare Pages build and deploy. No manual steps needed.

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
2. **An R2 bucket**, `rsg-blog-images`, with public access enabled (`wrangler r2 bucket create rsg-blog-images` then `wrangler r2 bucket dev-url enable rsg-blog-images`) — its public URL goes in `wrangler.toml`'s `PUBLIC_BLOG_IMAGES_URL`.
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
   `https://www.googleapis.com/auth/gmail.send` — nothing broader. Because
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

**Scheduled sending.** A member can pick a send time; a GitHub Actions workflow
(`.github/workflows/mail-dispatch.yml`) calls `/api/mail/dispatch` every 15
minutes to send what is due. It needs a shared secret in two places, the same
value in both:

```
wrangler pages secret put MAIL_SYNC_SECRET --project-name website
```

and as a repository secret named `MAIL_SYNC_SECRET` under Settings → Secrets and
variables → Actions.

**Order matters.** The `scheduled_emails` table (migration item 5 at the top of
`db/schema.sql`) must exist before this deploys, and the cron starts firing the
moment `mail-dispatch.yml` is on the default branch — not when you get around
to finishing setup. Run the migration and set both copies of the secret before
that happens; every run in between fails, since `/api/mail/scheduled` and
`/api/mail/dispatch` both 500 without the table, and dispatch 403s without the
secret.

Two things silently stop the queue, and neither produces an error anyone sees:

- **GitHub runs a scheduled workflow as whoever last committed its cron.** Commit
  changes to that file from RSG's shared bot account. If a personal account owns
  the schedule and that person later leaves the organisation, it stops.
- **On a public repository, scheduled workflows are disabled after 60 days of
  repository inactivity.** GitHub emails the owner and someone must re-enable
  them. A quiet stretch after a symposium is exactly when this happens.

If mail stops going out at its scheduled time, check the workflow's run history
first — a disabled schedule shows as no runs at all.

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
visitor arrives) and triggers a rebuild via a deploy hook. To set it up:

1. Create a deploy hook in the `symposium-website` Cloudflare Pages project's
   **Settings → Build, deployments, environment** → **Build settings → Deploy hooks**.
2. Set the hook URL as a secret in the Worker:
   ```
   cd workers/symposium-cron && npx wrangler secret put SYMPOSIUM_DEPLOY_HOOK
   ```
3. Deploy the Worker:
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
image: ""                  # speaker photo URL (optional)
topic: "Structural Biology" # shown as a badge
keyTakeaways:
  - "First key point"
  - "Second key point"
year: 2025
type: bioinfonet           # or: student
```

### Learning Paths (`src/content/lp-domains/`, `lp-levels/`, `lp-roadmap/`)

Curated resource paths organised by domain and experience level. All content is Markdown — no code changes needed to add or update resources.

**Domains:** genomics, ml, structural, metagenomics (more can be added by creating a new `lp-domains/` file)

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

Three workflows run in this repository. Two run automatically on every pull request; the third runs on a schedule, not on PRs.

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| **Build Check** | All PRs to `main` | Runs `astro check` (type checking) then `npm run build`. The PR cannot be merged if either fails. |
| **Translation Check** | PRs that touch `src/content/` | Detects newly added content files that don't have a matching translation in the other language, and posts a reminder comment. Not a blocker — just a nudge for the Translation Committee. |
| **Dispatch scheduled mail** | Every 15 minutes (`schedule`), plus manual `workflow_dispatch` | Calls `/api/mail/dispatch` to send queued mail that is due. See [Scheduled sending](#sending-mail-as-rsg--required-setup) above. |
