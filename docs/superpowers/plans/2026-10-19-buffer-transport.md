# Buffer transport: implementation plan

Spec: docs/superpowers/specs/2026-10-19-buffer-transport-design.md.
Everything stays local until the admin has seen the plan, the diff and the
screenshots of the Connections card.

## Task 0 (live, by the admin or with the admin's key file): confirm the (live) items

One read-only probe before go-live: `account { organizations { id } }`,
`channels` (service and type spelling for LinkedIn Page and X), then after
deploy one test post to read `PostStatus` values, multi-image on LinkedIn and
four images on X. The code below is written defensively around these.

## Task 1: Buffer client and publish step

- `functions/_lib/social/buffer.ts`: `bufferGraphql` (one POST, parses the
  RateLimit/RateLimit-Policy headers into the lowest remaining fraction,
  classifies 401/429/5xx/network/GraphQL error codes), the state codec,
  `bufferPublishStep` (spec §5: create with checkpoint, DuplicateError and
  lost answers go to the recovery read, status reads backed off
  1/2/5/10/20 min, rate_low guard), `listBufferChannels`,
  `pickBufferChannel`.
- `functions/_lib/social/reasons.ts`: `buffer_refused`, `limit`.
- Tests: `tests/buffer-publish.test.ts` with `stubHttp` for api.buffer.com.

## Task 2: connections

- `connections.ts`: `isBufferRow`, `BUFFER_SCOPE_PREFIX`, `connectionStatus`
  counts a Buffer row as having a token; `bufferKeyExpiry(env)` parses
  `BUFFER_KEY_EXPIRES`.
- `social/tokens.ts`: a Buffer row returns `env.BUFFER_API_KEY` (missing →
  `unreadable`), the organisation id, `via: 'buffer'`; never runs X's
  refresh-on-use.
- `social/registry.ts`: `publisherFor(platform, via)`; the dispatcher uses
  it and passes the organisation id.
- `api/admin/connections/index.ts`: `via`, Buffer rows count as stored
  (Disconnect shown); DM tab's LinkedIn link also for a Buffer row.
- Tests: `tests/buffer-connect.test.ts`.

## Task 3: connect endpoint

- `functions/api/admin/connections/[platform]/buffer.ts` is not possible
  next to the existing `[platform].ts`, so `linkedin/buffer.ts` and
  `x/buffer.ts` share `functions/_lib/buffer-connect.ts`: admin, CSRF,
  audited, LinkedIn Page only, `{ choose: [...] }` when more than one,
  `channelId` in the body to pick, re-queues waiting targets, sets
  `expires_at` from `BUFFER_KEY_EXPIRES`.

## Task 4: daily job

- `refresh-tokens.ts`: `checkBuffer` - one `channels` call when any Buffer
  row exists; a gone/disconnected/locked channel marks the row broken and
  mails the admins once; `expires_at` re-synced from `BUFFER_KEY_EXPIRES`;
  key-expiry mails at 30, 14 and 3 days (`buffer_key_expiring`, with the
  rotation steps).
- `social-notify.ts`: the new kind.
- `wrangler.toml` `[vars]`: `BUFFER_KEY_EXPIRES = "2027-10-19"`; `Env`.

## Task 5: panel

- `admin-connections.ts`: "Connect through Buffer" / "Buffer üzerinden bağla"
  for LinkedIn and X, a small picker when the server returns choices, the
  account line "· through Buffer", and "key end date unknown" when the date
  is missing. i18n keys in both languages.
- Screenshots of the card at 1280x680, 1366x768, 1440x800, 1536x864,
  1440x900, 1920x1080 and 375 wide.

## Checks

`npm test`, `npx astro check`, self-review of the diff.
