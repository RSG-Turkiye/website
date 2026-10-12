# Social media panel: Design

## Problem

RSG-Türkiye's Instagram is run by a social media lead who changes every year,
with posts made by hand from a phone. Looking at the account through the API
(448 posts since March 2021) shows the shape of the work:

- About 80 posts a year, but bursty: 20 to 40 a month in the weeks before the
  October/November symposium, 1 to 3 a month the rest of the year.
- Posts cluster at 17:00 to 19:00 Istanbul time, and a noticeable number go out
  between midnight and 01:00, which is someone at a phone late at night.
- Almost everything is a single image or a carousel. Reels are rare (16 in five
  years) though they draw the most engagement.

The designs are made ahead of time. What the team lacks is a way to put
finished content on a calendar and have it go out at the planned time, on
Instagram and LinkedIn together, without anyone sharing an account password.

Two neighbouring problems surfaced while designing this and are folded in,
because the panel depends on them:

- **The Gmail connection breaks every year.** The organisation changes the
  `turkey.rsg@gmail.com` password at the end of each year for security. Google
  revokes refresh tokens with Gmail scopes on a password change, so site mail
  and reply sync stop the next day, silently. Renewing it today needs a
  terminal and `wrangler`.
- **The Linktree page shows third-party ads.** The free `linktr.ee/rsgturkey`
  page appends sponsored offers below the organisation's links.

## Goals

1. The social team plans the month on a calendar, uploads finished designs into
   the plan, and the site publishes them to Instagram and LinkedIn at the
   planned time.
2. Nobody but the site admin holds platform credentials. Accounts are connected
   once through OAuth; the team works through the site's own login and roles.
3. New team members' posts go through approval; trusted members publish
   directly.
4. Every image carries alt text. Captions are counted against each platform's
   limits before they can be submitted.
5. **The system runs for years without a developer.** Anything that breaks
   (a connection, the scheduler, a rejected post) shows up inside the panel,
   says what is affected, and can be fixed from the panel without code.
6. A detailed, exportable, tamper-evident audit log of who did what.
7. Replace Linktree with a site-hosted `/links` page that updates itself.

## Out of scope for the first implementation

- **X.** The account was recovered as @rsgturkey, but the X API is pay per use
  and the free Web Intent route needs the poster logged into the account,
  which conflicts with goal 2. X is a disabled third adapter; the data model
  and adapter interface already account for it (§4).
- **Video** (reels, video stories). Media items carry a `type` so video slots
  in later without a schema change (§3).
- **Templates and post duplication.** Designs arrive finished; the site's job
  is to publish them on time.
- **Comments, DMs, analytics.** Read-only insights can come later.

## Constraints discovered before designing

- **Instagram (API with Instagram Login).**
  - Works with Business and Creator accounts and needs no Facebook Page.
  - A business publishing to its own account needs no App Review: Standard
    Access suffices when the account has a role on the app.
  - The app ("RSG-Türkiye Social", contact `turkey.rsg@gmail.com`, no business
    portfolio) exists, and @rsgturkey was added as an Instagram Tester to read
    the post history above.
- **Instagram publishing limits.**
  - JPEG only for images.
  - Feed images 4:5 to 1.91:1; stories 9:16.
  - Carousels have at most 10 items.
  - 50 published posts per rolling 24 hours.
  - Media is fetched by Meta from a public URL at publish time.
  - Publishing is two steps: create a container, wait for it to finish
    processing, then publish it.
- **Instagram stories via API are Business-only.** Meta's docs say so, and a
  Creator token gets "(#10) The user is not an Instagram Business".
  - @rsgturkey is currently `MEDIA_CREATOR`.
  - The organisation agreed to switch to Business, accepting the narrower reels
    music library; it rarely posts reels.
  - The switch happens when stories are first tested.
- **Instagram captions never render links as clickable.** This is a platform
  rule, not an API one. Link stickers on stories are not available through the
  API either.
- **LinkedIn company page posting needs the Community Management API.**
  - Access is granted on application, requires a verified page, and takes weeks
    or more.
  - The person authorising must be a page admin.
  - Access tokens last about 60 days.
  - LinkedIn has no service accounts, and fake person accounts are banned.
  - Nobody on the current team is a page admin yet; the user is asking the
    current lead to add them as Super admin.
- **Cloudflare Pages Functions have no cron.** The existing `workers/mail-cron`
  Worker calls Pages Functions every minute with a shared secret. The social
  dispatcher rides the same tick.
- **Pages secrets cannot be written by the running site.** That is why the
  Gmail refresh token has to move into D1 for in-panel reconnection to work
  (§4).
- **The repository is public.** No token, secret or account identifier beyond
  public handles lands in code or docs.

## 1. Roles

Two new flags on `users`, following `is_announcer` / `is_symposium`:

| Flag | Name in UI | Can |
|---|---|---|
| `is_social` | Editor | See the Social tab; create plans and drafts; submit for approval; edit or withdraw own unapproved posts |
| `is_social_publisher` | Publisher | Everything an editor can; schedule or publish directly; approve or reject (with a note) others' posts; cancel any queued post; manage `/links` |
| `is_admin` | Admin | Everything a publisher can; connect, disconnect and reconnect accounts (Instagram, LinkedIn, X, Gmail); view and export the audit log |

- Granting publisher also sets editor. Removing editor also removes publisher.
- Roles are granted in the existing Users pane through new
  `make_social` / `make_social_publisher` actions in
  `functions/api/admin/users.ts`.
- Permission checks live in two helpers in `functions/_lib/auth.ts`:
  `canSocialEdit(user)` and `canSocialPublish(user)`.
- Every endpoint enforces them server side. Pane hiding in `admin-panel.ts` is
  presentation only.

## 2. Interface

The Social tab is a new pane, `src/components/admin/panes/SocialPane.astro`,
with client code in `src/scripts/admin-social.ts`. It follows the
`admin-certificates.ts` module pattern and uses vanilla TypeScript like the
rest of the admin panel. All strings are in `src/i18n/ui.ts` with EN/TR
parity.

**Status banner.** It sits above every admin pane, not just Social, and lists
what is broken or about to break:

- a connection expired, expiring within 14 days, or revoked;
- the scheduler has not run for 10 minutes;
- posts waiting on a connection;
- overdue empty plans.

Each line says what stops working and what keeps working. Admins get the fix
button; other roles see "the admin has been notified".

**Sub-tabs:**

- **Calendar** (default). A month grid with a Calendar/Board toggle, remembered
  per viewer.
  - Plans are dashed boxes and turn red when content is overdue.
  - Pending approval is amber, scheduled is blue, published is green, failed
    is red.
  - Clicking an entry opens a side panel with its details and actions.
  - The board view groups the same entries into Plan, Pending approval,
    Scheduled, and Published/Failed columns.
- **Pending approval** (publishers). Each card shows thumbnail, type,
  platforms, requested time, alt-text completeness and character counts, with
  Approve and schedule, Preview, Edit, and Reject with note.
- **Published.** One row per post with a column per platform: a link to the
  live post, or the failure reason in plain language with "Fix and retry"
  (retries only the failed platform). "Skipped (not connected)" is shown as
  such.
- **Links (/links).** Pinned links (add, reorder, hide) with 7-day click
  counts.
- **Connections** (admin). One row per account: status, who connected it and
  when, last successful use, and Connect / Reconnect / Disconnect.
- **Log** (admin). A searchable table with Export (CSV, JSON) and
  Verify integrity.

**Composer.** It opens from "+ Post" or from a plan's "Upload content", which
pre-fills the time and platforms.

- **Type.** Single image, carousel, or story.
- **Platforms.** Instagram and LinkedIn are checkboxes; X shows as disabled
  "not connected".
- **Images.** Drag to reorder; the first image is the cover; up to 10.
  - Each image shows its dimensions and ratio check and has a required alt-text
    box.
  - Uploads are converted to JPEG client side. The existing uploader converts
    to WebP and is reused with an output-type option.
- **Caption.** A shared caption plus optional Instagram-only and LinkedIn-only
  overrides. An empty override falls back to the shared caption.
- **Live counters.** Instagram 2,200 characters and 30 hashtags; LinkedIn 3,000
  characters.
- **Link (optional).**
  - LinkedIn: appended as a clickable link.
  - Instagram: the line "🔗 Link profilde" is appended, and the link goes to
    `/links` under Current for 30 days.
- **When.** Date and time in Türkiye time, defaulting to 18:00. Publishers also
  get "Publish now".
- **Checklist.** All alt texts present, ratios valid for the chosen type and
  platforms, limits respected, at least one platform. The submit button stays
  disabled until it passes.
- **Submit button.** Reads "Submit for approval" for editors and "Schedule" or
  "Publish now" for publishers.
- **Autosave.** Drafts autosave to the server.
- **Live preview.** An Instagram feed card (first ~125 characters, then
  "more"), a story frame, and a LinkedIn card with the clickable link.

Character and hashtag counting is one shared module (`src/lib/social-limits.ts`)
imported by the composer and by the server. The two can never disagree.

**`/links` page.** It has its own minimal layout: no site header, footer or
nav.

- Solid site navy, Inter, the real logo, red only as an accent rule.
- A "Current" section shows link-bearing posts from the last 30 days, newest
  first.
- A "Links" section lists pinned links as divided rows, not cards.
- Social links in the footer.
- `noindex`, excluded from the sitemap via `noindex-routes.ts`, and linked from
  nowhere on the site. It is reached only from the Instagram profile.
- Clicks go through `/links/go/<id>`, which increments a daily counter and
  redirects. No visitor data is stored.

## 3. Data model

New tables in `db/schema.sql` (`CREATE TABLE IF NOT EXISTS`) plus numbered notes
for the two `ALTER TABLE users` columns.

**`platform_connections`**: one row per platform (`instagram`, `linkedin`,
`x`, `gmail`).

- Account fields: account id and display name.
- Tokens: `access_token_enc`, `refresh_token_enc`, `scopes`, `expires_at`,
  `refresh_expires_at`.
- Provenance: `connected_by`, `connected_at`.
- Health: `last_ok_at`, `last_error`, `last_error_at`.
- Status is derived (connected / expiring / broken / unused), never stored, so
  it cannot go stale.

**`social_plans`**: title, `scheduled_at`, platforms (JSON), intended type,
assignee user id, note, `created_by`, `post_id` (set when content is attached).

**`social_posts`**:

- `type` (`image | carousel | story`) and `caption`.
- `caption_overrides` (JSON keyed by platform) and `link`.
- `media` (JSON array of `{type: 'image', key, width, height, alt}`, ordered).
  Video adds `type: 'video'` later.
- `platforms` (JSON) and `scheduled_at`.
- `status`: `draft | pending_approval | scheduled | published | partially_published | failed | rejected | cancelled`.
- People and timestamps: `created_by`, `approved_by`, `approved_at`,
  `review_note`, `created_at`, `updated_at`.

**`social_post_targets`**: one row per post per platform, the unit the
dispatcher works on.

- `status`: `queued | waiting_connection | needs_confirmation | publishing | published | failed | skipped`.
- Queue fields: `attempts`, `first_tried_at`, `claimed_at`, `last_error`.
- Platform state: `container_id` (Instagram's in-flight state), `remote_id`,
  `permalink`, `published_at`.

**`social_links`**: pinned links (title, subtitle, url, sort, hidden).

**`social_link_clicks`**: (link id or post id, day, count).

**`audit_log`**: `id`, `at`, `user_id` (null for system), `action`,
`target_type`, `target_id`, `details` (JSON with before/after for edits),
`prev_hash`, `hash`.

- `hash = SHA-256(prev_hash || canonical JSON of the row)`.
- Rows older than one year are pruned by the daily job, which records a
  checkpoint row carrying the last pruned hash so the chain stays verifiable.

**Media storage.** Images go to the existing public `BLOG_IMAGES` bucket with
UUID keys and are served by `/api/images/<key>`. That gives the public HTTPS
URL Meta fetches from, on the site's own domain (`r2.dev` is blocked in
Türkiye). The upload endpoint accepts the social roles and `image/jpeg` for
social uploads.

## 4. Connections and token storage

**Encryption.** Tokens are encrypted with AES-GCM (`crypto.subtle`, 256-bit key,
random 96-bit IV per write) using a new Pages secret, `TOKEN_ENC_KEY`.

- The platform name is bound as additional authenticated data, so a ciphertext
  cannot be moved between rows.
- A leaked database alone reveals no usable token.
- Lives in `functions/_lib/token-vault.ts`.

**Adapters.** `functions/_lib/social/` holds one adapter per platform behind a
common interface:

```ts
interface PlatformAdapter {
  platform: 'instagram' | 'linkedin' | 'x';
  supports: { types: PostType[]; maxItems: number; video: boolean };
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refresh(tokens: TokenSet): Promise<TokenSet | null>;   // null: cannot refresh
  publish(post: PostForPlatform, tokens: TokenSet, state: TargetState): Promise<PublishStep>;
}
```

`PublishStep` is one of the following:

- `{ done, remoteId, permalink }`
- `{ pending, state }`: Instagram container still processing; resume next tick.
- `{ retry, reason }`: transient.
- `{ fail, reason }`: content problem, permanent.
- `{ auth, reason }`: token invalid.

X is added later as one more adapter.

**Connect flow.**

1. An admin presses Connect.
2. `/api/social/connect/<platform>` creates a signed, short-lived `state` and
   redirects to the provider.
3. `/api/social/callback/<platform>` verifies `state` and the session, exchanges
   the code, and stores the encrypted tokens.
4. Every step is logged.

**Gmail.** Gmail uses the same table and flow, with the existing
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` and scopes `gmail.send` and
`gmail.readonly`. The exact scope list is copied from the current README grant.

- `getAccessToken` in `functions/_lib/gmail.ts` prefers the D1 row and falls
  back to the `GMAIL_REFRESH_TOKEN` secret when no row exists. Deploying this
  changes nothing until the first in-panel reconnect.
- An `invalid_grant` from Google marks the connection broken immediately.

## 5. Publishing, failures, and self-monitoring

**Tick.** `workers/mail-cron` gains a third call, to `/api/social/dispatch`,
with a new `SOCIAL_DISPATCH_SECRET` header, compared in constant time. The
Worker stays logic-free. The dispatcher:

1. Records the run in `dispatch_runs` (reused, with a `kind` column), which the
   scheduler health check reads.
2. Claims due targets (`queued`, `scheduled_at <= now`) with the same lease and
   conditional-update pattern as `scheduled_emails`.
3. Calls the adapter step and applies the result.
   - **Instagram.** The first tick creates the container(s) with caption and
     alt text and stores `container_id`. Later ticks poll its status and
     publish once it is `FINISHED`. Before publishing, if the container is
     already `PUBLISHED`, it records the result instead of publishing again.
     This makes a crash between "publish" and "record" safe.
   - **LinkedIn.** Upload image(s) via the Images API, then create the post as
     the organisation, with alt text.

**Failure classes:**

- **Transient** (rate limit, 5xx, network): retried every tick for up to 2
  hours from the first attempt, then `failed` with the last reason.
- **Content** (invalid ratio, unsupported image, caption rejected): `failed`
  at once, with a plain-language TR/EN reason mapped from the provider error
  and "Fix and retry" in the UI.
- **Auth** (expired or revoked token): the target becomes `waiting_connection`
  and is not failed. The connection is marked broken, the banner appears and
  the admin is emailed. Reconnecting re-queues every waiting target.

**Lateness rule.** A target that would go out more than 2 hours after its
scheduled time (for example after a day-long outage) becomes
`needs_confirmation` instead of publishing. Publishers see "Publish anyway /
Cancel". A "tomorrow at 18:00" announcement never appears a day late
unattended.

**Post status** is derived from its targets: all published means `published`,
some means `partially_published`, all failed means `failed`.

**Daily job** (the existing `workers/symposium-cron` daily tick gains a call):

- Refresh Instagram tokens with under 20 days left.
- Warn about LinkedIn tokens at 14, 7, 3 and 1 days left, if they cannot be
  refreshed.
- Email assignees and publishers about plans due within 48 hours with no
  content (the job runs at 04:17 Türkiye time, so the mail is waiting in the
  morning).
- Prune the audit log.
- Check the audit hash chain and flag a break on the banner.

**Scheduler health.** The banner shows "The scheduler is not running; posts and
scheduled mail are not going out" when the newest `dispatch_runs` row is more
than 10 minutes old. It links to the README runbook for redeploying the
Worker.

**Notifications** go by email through the existing Gmail path:

- submitted for approval: to publishers;
- approved or rejected: to the author;
- failed, or waiting on a connection: to the author and publishers;
- connection expiring or broken: to admins;
- empty plan due: to the assignee and publishers.

When Gmail itself is broken, the banner says email notifications are paused too.

## 6. Audit log

Every mutating endpoint writes an `audit_log` row: create, edit (with a field
diff), submit, approve, reject, schedule, cancel, publish result, connect,
disconnect, role change, export.

Reads are logged as well:

- every API read in the Social and admin panes (opening a post, listing pending
  posts, viewing the log);
- tab switches, via a small `POST /api/audit/view` beacon. This one is
  client-reported, so it can be suppressed by a determined user; the
  server-side read entries cannot.

Public pages (`/links`, the blog) are never logged per visitor.

The Log tab filters by person, action and date range and exports CSV or JSON,
including `prev_hash`/`hash` so an exported file can be checked against the
chain. The export itself is logged. No endpoint edits or deletes log rows.
"Verify integrity" recomputes the chain and reports the first broken link, if
any.

Retention is one year, chosen as a reasonable KVKK posture for operational
logs.

## 7. Testing

Testing uses the existing `node:test` setup: in-memory SQLite loaded from
`db/schema.sql`, `fakeR2`, and handlers called directly.

**Pure logic:**

- the lateness rule;
- failure classification from provider responses;
- `social-limits` counting (including emoji and Turkish characters);
- ratio checks;
- token-vault round trip and AAD binding;
- audit hash chain (append, verify, tamper detection, prune checkpoint).

**Handler and lifecycle**, with `fetch` stubbed per provider:

- an Instagram publish spread over two ticks;
- a crash after publish produces no duplicate;
- an auth error moves the target to `waiting_connection`, and a reconnect
  re-queues it;
- lateness becomes `needs_confirmation`;
- an editor cannot schedule or approve;
- a publisher can;
- the dispatcher rejects a wrong secret.

**Existing hygiene tests** cover the new code: translations parity, no em
dashes, inline scripts, functions hygiene, api-input.

**Live verification:**

- A separate test Instagram account (Business, added as a Tester) is connected
  first, and every post type is published to it before @rsgturkey is
  connected.
- Signed-in browser checks for each role at each phase.

## 8. Delivery phases

Each phase is its own PR and is useful on its own.

1. **Foundation.** Roles; `platform_connections` and the token vault;
   Connections tab; **Gmail reconnect** with the D1 fallback; status banner
   and scheduler health; audit log with export and verification. Solves the
   yearly Gmail outage by itself.
2. **Content.** Plans, calendar and board, composer with preview and
   checklist, approval flow, notifications. Nothing publishes yet; posts can
   be planned and approved.
3. **Instagram.** Adapter, dispatcher, daily token refresh. Image, carousel
   and story. Test account first, then @rsgturkey (switched to Business).
4. **`/links`.** Page, pinned links, auto-added post links, click counter. The
   Instagram bio link moves to it.
5. **LinkedIn.** Adapter and connect flow, once page admin access and
   Community Management API approval exist.
6. **Later.** The X adapter; video and reels.

## 9. Operations and handover

A README section, "Social media and connections", covers:

- what each banner line means and the button that fixes it;
- the Worker redeploy steps for a stopped scheduler;
- the yearly handover checklist:
  - after changing the Gmail password, reconnect Gmail in Connections;
  - have the new LinkedIn page admin reconnect LinkedIn;
  - grant the incoming team their roles and remove the outgoing ones;
  - keep at least two LinkedIn page Super admins.

Every banner line links to its paragraph.

## Open points to verify during implementation

- Whether the Instagram API accepts `alt_text` on image and carousel items
  published with Instagram Login. If it does not, alt text is still required
  in the composer, used on LinkedIn and `/links`, and the gap is surfaced to
  the user.
- Whether LinkedIn issues refresh tokens to this app once approved; this
  decides between silent refresh and reminders.
- Current Instagram carousel item limit (10 at the time of writing).
- Exact story behaviour after the switch to Business.
