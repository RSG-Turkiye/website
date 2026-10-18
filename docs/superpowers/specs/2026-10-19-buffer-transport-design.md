# Buffer as the LinkedIn and X transport: design

Date: 2026-10-19. Decided with the site admin after Meta and LinkedIn did not
answer the API access requests.

## 1. Goal

Posts scheduled in the admin panel reach the RSG-Türkiye LinkedIn Page and
@rsgturkey on X, without LinkedIn Community Management API approval and
without paying for the X API. The panel stays the one place where posts are
written, scheduled and tracked; Buffer only carries them.

Success looks like this: a publisher schedules a post for Instagram, LinkedIn
and X; at the scheduled minute Instagram goes out through the direct
connection as today, and the LinkedIn and X halves go to Buffer; within a few
minutes each target shows "published" with a link to the live post, or a
readable reason if Buffer or the network refused it.

## 2. Scope

In v1:

- A Buffer publish step for LinkedIn and X (`functions/_lib/social/buffer.ts`).
- Connecting LinkedIn and X "through Buffer" from the existing Connections
  card: no OAuth on our side, one button per platform.
- Reading the result back from Buffer: published link, or Buffer's error.

Not in v1:

- **Instagram through Buffer.** Instagram keeps the direct connection (it
  works, and the DM inbox needs it). The Instagram channel in Buffer is a
  manual fallback and the place to answer comments (Buffer Community).
- **Comments and DMs.** Buffer's API has neither. Comments are answered in
  Buffer Community; DMs in each platform's own inbox (separate decision).
- **Buffer's queue and scheduling.** Our dispatcher decides when; Buffer is
  told to share now.
- **Video, documents, link cards, X threads.** Images only, as today.

The direct LinkedIn and X adapters are kept unchanged. Which one runs is
decided per connection (§4), so going back is a reconnect, not a code change.

## 3. Buffer API facts this design relies on

Checked at developers.buffer.com on 2026-10-19; items marked (live) are
confirmed by the first live call in the plan's first task, before anything
else is built on them.

- One GraphQL endpoint, `POST https://api.buffer.com`, header
  `Authorization: Bearer <key>`. The key is account-wide, has no stated
  expiry, and is created by the organisation owner (turkey.rsg@gmail.com).
- Free plan: 3 channels (now: LinkedIn Page, Instagram, X), 100 requests per
  15 min, 250 per day, 3000 per 30 days per key. Over the limit: HTTP 429,
  `Retry-After`, `errors[0].extensions.code = RATE_LIMIT_EXCEEDED`.
- `channels(input: { organizationId })` → `id, name, service, type,
  isDisconnected, isLocked, isQueuePaused, organizationId`.
- `createPost(input: { channelId, text, schedulingType: automatic,
  mode: shareNow, assets: [{ image: { url, metadata: { altText } } }] })`
  → `PostActionSuccess { post { id } }` or a `MutationError` /
  `InvalidInputError` / `LimitReachedError` with `message`.
- No upload: Buffer fetches each image from a public URL. Ours is
  `PUBLIC_BLOG_IMAGES_URL/<key>` = `https://rsg-turkiye.iscbsc.org/api/images/…`,
  the same address Instagram already fetches.
- `post(input: { id })` → `status, sentAt, externalLink, error { message }`.
  The `PostStatus` values are not on the reference page (live).
- No idempotency key on `createPost`; a lost answer can mean a post exists.
- Buffer refuses a LinkedIn post with no image? Multi-image on LinkedIn and
  up to 4 on X through Buffer? (live)

## 4. Connections

A Buffer-backed connection is an ordinary `platform_connections` row for
`linkedin` or `x`, so the panel, the banner, `waiting_connection` and the
requeue on reconnect all work unchanged:

- `account_id` = the Buffer channel id, `account_name` = the channel name,
  `scopes` = `buffer:<organizationId>`. No token is stored: the key stays in
  the `BUFFER_API_KEY` Pages secret, so rotating it never needs a reconnect.
- `connectionStatus` counts a row with `scopes` starting `buffer:` as having
  a token (today it needs `access_token_enc`); `expires_at` stays null, so it
  never shows "expiring".
- `usableToken` returns `env.BUFFER_API_KEY` for such a row; a missing
  secret is `unreadable` (admins are told, as for a broken token).
- The registry picks the step per row: `scopes` starts with `buffer:` →
  `bufferPublishStep`, otherwise the direct adapter. The dispatcher passes
  `account.id` (the channel id) and the token as today.

Connecting: `POST /api/admin/connections/{linkedin|x}/buffer` (admin, CSRF,
audited). The server asks Buffer for the organisation's channels, keeps those
whose `service` matches (LinkedIn: `type` Page only, never a personal
profile), and:

- exactly one → saves it and re-queues waiting targets (as a reconnect does);
- none → `no_channel` ("connect it in Buffer first");
- more than one → returns the list; the panel shows a short picker and posts
  again with `channelId`.

The Connections card gets a second button next to "Connect" for LinkedIn and
X: "Connect through Buffer". Once connected the row reads, e.g.,
"ISCB SC RSG-Türkiye · through Buffer". Disconnect works as today (drops our
row; Buffer is untouched). Screenshots of this card at the six window sizes
are shown to the admin before it is pushed.

A daily health read (the existing daily job): one `channels` call; a channel
that is gone, `isDisconnected` or `isLocked` marks the connection broken and
mails the admins, as a failed token refresh does. One call a day.

## 5. The publish step

State lives in `container_id` as JSON, like LinkedIn's:
`{ buf: 1, attempt: <unix> | null, postId: <buffer id> | null, next: <unix> }`.

1. **No state.** Refuse what Buffer cannot carry before calling it: `story`
   (`not_available`), no image, more than 4 images on X. Then
   `checkpoint({ attempt: now })` (lease lost → stop), then `createPost` with
   `mode: shareNow`, the caption from `captionFor` (plain text: Buffer
   formats hashtags itself, so LinkedIn's "little" escaping is not applied),
   and each image as `{ url, metadata: { altText } }`.
   - success → `pending` with `{ postId, next: now + 60 }`;
   - `UNAUTHORIZED` → `auth`; 429 / 5xx / network → `retry` (attempt cleared
     only when the request provably did not arrive: 429, 401, or a 4xx
     validation error); `InvalidInputError` / `MutationError` → `fail` with
     Buffer's message; `LimitReachedError` → `fail` (`limit:` + message).
2. **postId known.** If `now < next`, return `pending` unchanged (no call).
   Otherwise `post(id)`:
   - sent, with `externalLink` → `done` (remoteId = Buffer id, permalink =
     `externalLink`);
   - error → `fail` with `error.message` (Buffer has given up; nothing went
     out);
   - still sending → `pending` with `next` backed off: 1, 2, 5, 10, 20 min.
     The dispatcher's 2-hour window still ends it.
3. **attempt set, no postId** (the create call's answer was lost). Read the
   channel's posts created since `attempt` (`posts`, filter `channelIds`,
   `createdAt ≥ attempt`, sorted newest first) and take the one whose text
   equals ours: found → continue as 2; not found and less than 2 minutes
   since `attempt` → `pending`; otherwise clear `attempt` and let the next
   tick create it. A failed read never clears `attempt` (same rule as
   LinkedIn: it is the only record that a create was sent).

Request budget: a post costs one create plus at most 6 status reads, so
about 7 calls per platform. Two platforms × a few posts a day stays far under
250 a day. The step reads the `RateLimit` header and, under 10 % left in any
window, returns `retry` (`rate_low`) instead of creating.

## 6. Errors as people see them

Reasons use the existing keys (`reasons.ts`), so the panel and e-mails need
no new strings except: `buffer_refused` (Buffer's message shown verbatim,
e.g. a LinkedIn rule) and `limit` (Buffer's posting or plan limit). A
Buffer-wide outage is `unavailable`, retried for two hours like any other.

## 7. Security and privacy

- The key is never logged, returned to the browser, or stored in D1.
- Only post text, image URLs and alt text go to Buffer; nothing about
  members. Images are already public.
- Buffer holds the LinkedIn and X authorisations; the Buffer account is the
  organisation's (turkey.rsg@gmail.com), not a person's. The LinkedIn
  authorisation is the admin's personal account acting for the Page: the
  Page should keep at least two super admins so it survives a handover.

## 8. Testing

- Unit: the step against a fake `fetch` (each branch of §5, the state codec,
  header parsing), connection status and token lookup for a `buffer:` row,
  the connect endpoint's channel choice.
- Live, once, by hand after deploy: connect LinkedIn and X through Buffer,
  schedule one test post with one image to both, see both published with
  working links, then delete them on LinkedIn and X.

## 9. Go-live

1. Admin: Buffer API key → Pages secret `BUFFER_API_KEY` (Production). Done
   outside this repo; never pasted in chat.
2. Merge and deploy.
3. Panel → Connections → "Connect through Buffer" for LinkedIn and X.
4. The live test in §8.
