# Troubleshooting

For the AI agent (and the person steering it) when something is broken or a
person reports an error. The person reading along may know little terminal:
see the Turkish start page, [README.md](README.md).

Each entry has five parts: **Symptom** (what the person sees), **Likely
causes** (in order of how often they happen), **Look at** (where to read the
evidence), **Fix**, **Who acts** (the agent, or the person with the exact
command or click).

One rule covers every entry: **the agent hands every command that touches
production to the person**, ready to paste with `!`, with an absolute path and
one sentence on what it does. See "Working with a non-terminal maintainer" in
[CLAUDE.md](../../CLAUDE.md). Read-only commands, including remote reads such as
`wrangler d1 insights` or a SELECT, may be run by the agent once the person has
logged in to wrangler; anything that writes is handed to the person. Never paste a secret into chat, and never post or send
anything to a real account while testing.

## A panel save or a merged PR never shows on the site

**Symptom**: "I saved in the panel" or "the PR is merged", and the public page
is unchanged.

**Likely causes**:
1. Cloudflare Pages sometimes never builds a merge on `main` (seen 2026-10-26).
2. A content draft is still waiting: its pull request waits for the checks,
   and the mail tick merges it once they are green. A draft is live only when
   it shows **Yayında**.
3. The symposium site is static and is rebuilt through the
   `SYMPOSIUM_DEPLOY_HOOK` secret; a panel save there needs that rebuild.

**Look at**: Cloudflare dashboard, Workers & Pages, `website`, Deployments:
is there a deployment for the merge commit? For a draft, the draft's status in
the panel and the PR's checks on GitHub; see [From draft to
live](../../README.md#from-draft-to-live). For the symposium site, open
`/api/symposium` first: if the data is there, the problem is the build, not
the save (CLAUDE.md, "Scheduled jobs").

**Fix**: For a missed build, open an empty-commit PR (`git commit
--allow-empty`); once its two required checks pass, the person merges it
(`main` is protected). Nobody merges a `cms/*` pull request by hand. For a
stuck draft, see [A content draft failed](#a-content-draft-failed). For the symposium site,
the save is stored either way and the nightly rebuild (01:17 UTC) picks it
up. The save response says whether the rebuild started; if it did not, check
that `SYMPOSIUM_DEPLOY_HOOK` is set on the `website` Pages project ([Symposium
site, nightly rebuild](../../README.md#symposium-site--nightly-rebuild)).

**Who acts**: the agent prepares the empty-commit branch and the PR only after
the person OKs the push; the person merges it and checks the Deployments list.

## A button does nothing, or a generic error appears

**Symptom**: pressing a button in the panel has no visible effect, or the page
says something went wrong.

**Likely causes**:
1. The person's role has ended or never covered this action.
2. A connection is broken (the banner says so).
3. The request failed on the server (a D1 limit, a code error).

**Look at**: the browser console and network tab (the person can copy the
failing response and paste it to the agent); the Activity log pane (Log); the
person's roles and their end dates in Users and roles, Roles; the status
banner, see [Connections and the status
banner](../../README.md#connections-and-the-status-banner).

**Fix**: Renew an ended role in Roles ([How roles
work](../../README.md#how-roles-work)). For a banner line, follow its entry in
the README. For a failed request, the response body usually names the cause;
the agent reads it and goes to the matching entry here.

**Who acts**: the agent reads the pasted evidence; an admin renews roles; the
person does any reconnect click.

## "Quota", D1 errors, or the usage alert

**Symptom**: an e-mail says usage passed 70% or 90%, or API calls and the panel
fail with D1 or quota errors until the next day.

**Likely causes**:
1. The free plan's daily limits were used up: 5 million D1 rows read, 100,000
   rows written, 100,000 Worker requests. All reset at 00:00 UTC.
2. A query on the per-minute tick without an index covering its `WHERE`.
3. A client or agent loop (agents have their own budget, see [A Claude or ChatGPT connector will
   not connect](#a-claude-or-chatgpt-connector-will-not-connect-or-a-token-is-refused)).

**Look at**: the Overview card (System block) for today's numbers and when the
check last ran; the Log for `usage.alert` rows; and the read-only
`wrangler d1 insights rsg-members --sort-type=sum --sort-by=reads
--timePeriod=7d` (use `--sort-by=writes` for writes). See CLAUDE.md, "Data and
the free tier", and README "Statistics" for the alert.

**Fix**: Over the limit, nothing to do until 00:00 UTC; static pages stay up.
For a slow leak, find the query in the insights output and add an index
that covers its `WHERE`; a schema change is applied by hand as a numbered note
in `db/schema.sql`.

**Who acts**: the agent may run `d1 insights` after the person has logged in
(`npx wrangler login`); it is read-only. The person runs any remote write.

## CI is red on a PR that passes locally

**Symptom**: the Build Check fails on GitHub, but the tests pass on the
person's machine.

**Likely causes**:
1. CI runs Node 22; the local Node is a different version.
2. A stale local content cache hides a deleted or renamed file (see [Deleted content still renders
   locally](#deleted-content-still-renders-locally)).

**Look at**: the failing step in GitHub Actions, Build Check (`astro check`,
build or tests, for the main site or the symposium site).

**Fix**: Run the suite on Node 22 locally (`npm test`, `npx astro check`,
`npm run build`), reproduce, fix, push to the same branch.

**Who acts**: the agent; the person approves the push.

## wrangler errors

**Symptom**: a `wrangler` command fails with an error code.

**Likely causes**:
1. Error 10042, "enable R2": the login lost its R2 scopes. R2 is not disabled
   (CLAUDE.md, "Known traps").
2. Error 7403 on `d1 execute --remote`, when `--json` was used.
3. `--file` was given a relative path and picked up a stale `db/schema.sql`
   from a parent folder.

**Look at**: the error text and the exact command that was run.

**Fix**: For 10042, `npx wrangler login` again. For 7403, run the same command
without `--json`. For `--file`, give an absolute path.

**Who acts**: the person runs `wrangler login` (a browser sign-in) and every
`--remote` write. The agent never runs a remote write itself.

## Mail is stuck, or a reply does not show

**Symptom**: queued mail does not leave, the scheduler banner line shows, or a
reply is missing from the inbox.

**Likely causes**:
1. The scheduler did not run (the `rsg-mail-cron` Worker), the tick died
   mid-way, or it ran outside the 08:00 to 22:00 sending window.
2. The Gmail connection was revoked, for example after a password change.
3. The reply belongs to a thread the site did not send (the site reads only
   threads it started).

**Look at**: the `dispatch_runs` query and its three-answer table in [When the
queue looks stuck](../../README.md#when-the-queue-looks-stuck); the banner; for
replies, [Reading replies
(Conversations)](../../README.md#reading-replies-conversations).

**Fix**: As the README table says, by what the rows show. For a Gmail banner
line, Connections, Gmail, Reconnect.

**Who acts**: the agent may run the read-only `dispatch_runs` query only after
the person is logged in to wrangler (`npx wrangler login`); otherwise it hands
the query to the person, who pastes the result back. The person does the
reconnect click and any Worker redeploy.

## A social post did not go out, or a Buffer or banner line is red

**Symptom**: a scheduled post is `failed`, `needs_confirmation` or waits, or a
connection line in the banner is red.

**Likely causes**:
1. The connection is broken or expiring (Instagram, LinkedIn, X, or the Buffer
   key, which expires yearly).
2. A target was more than 2 hours late and waits for **Publish anyway**.
3. The answer to a create call was lost ("uncertain").
4. X has no credits, or Buffer's daily call limit was reached.

**Look at**: the Connections pane and the post's side panel; [How a post goes
out](../../README.md#how-a-post-goes-out), [Banner lines and what to
press](../../README.md#banner-lines-and-what-to-press) and [If a post's answer
is lost](../../README.md#if-a-posts-answer-is-lost).

**Fix**: Follow the README entry. For "uncertain", someone looks at the
account before **Retry**, so nothing is posted twice.

**Who acts**: the social media publisher presses Retry or Publish anyway; an
admin reconnects the account in Connections (only admins can). The agent never
posts or retries a real post.

## A Claude or ChatGPT connector will not connect, or a token is refused

**Symptom**: the connector shows an error, or calls come back 401, 403 or 429.

**Likely causes**:
1. The member's role ended or was renewed; a token's rights are its scope
   intersected with the member's live grants.
2. The token was revoked, or auto-revoked (a request flood, repeated
   human-only refusals, a reused refresh value, its own value pasted into
   content).
3. A daily limit or the agents' shared budget is used up (`agent_budget`,
   `rate_limited`).

**Look at**: the person's roles, the Agent tokens pane (Connected apps), and
the Log for `agent_token.auto_revoke`; [Limits](../../README.md#limits),
[Auto-revoke](../../README.md#auto-revoke) and [Connecting Claude, ChatGPT and
other apps](../../README.md#connecting-claude-chatgpt-and-other-apps).

**Fix**: Renew the role, remove the cause of an auto-revoke, then make a new
token or reconnect the app. A budget resets at 00:00 UTC.

**Who acts**: the person makes the token or signs in to the app; the agent
never handles a token value.

## A content draft failed

**Symptom**: a draft in the panel shows a failure reason, or sits in "Süren ve
takılanlar".

**Likely causes**: a conflict with a newer change, a failed or unfinished
check, branch protection, a pull request closed by hand, or a merge the site
never showed. The panel names the reason.

**Look at**: the reason table in [When a draft
fails](../../README.md#when-a-draft-fails), the PR's checks on GitHub, and the
Log rows `cms.draft.*` and `cms.pr.*`.

**Fix**: As the README table says. Never merge a `cms/*` pull request by hand.

**Who acts**: the author or an approver in the panel; an admin looks at CI when
a check itself is broken.

## Certificates do not open

**Symptom**: a participant's certificate is not found.

**Likely causes**: the files and rows are purged 30 days after upload, by the
nightly job; or the e-mail address differs from the CSV; or the lookup limit
(20 per 10 minutes per IP) was reached.

**Look at**: [Symposium certificates](../../README.md#symposium-certificates)
and the upload date.

**Fix**: After the window, organisers upload the files again. Otherwise correct
the address in the CSV and re-upload.

**Who acts**: a symposium organiser in the panel.

## Someone lost access

**Symptom**: a person who could use a pane yesterday cannot today.

**Likely causes**: the role's end date passed. The hourly sweep removes an
expired grant, and the end date is inclusive.

**Look at**: Users and roles, Roles, for the person's grants and end dates.

**Fix**: Renew the role in the same view; a renewed role starts a new grant
([How roles work](../../README.md#how-roles-work)).

**Who acts**: an admin, in the panel. Keep at least two people as admins.

## Deleted content still renders locally

**Symptom**: a removed content file is still on the local site or in the local
build.

**Likely causes**: Astro's content cache keeps deleted files in
`node_modules/.astro/data-store.json` (CLAUDE.md, "Known traps").

**Look at**: whether the file is really gone from `src/content/`.

**Fix**: `rm -rf node_modules/.astro .astro dist`, then build again.

**Who acts**: the agent, in the local copy only.
