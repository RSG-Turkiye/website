# Conversations — Design

**Date:** 2026-09-02
**Branch:** `feat/conversations`
**Status:** approved

## Goal

Members who send mail as RSG can read the replies on the website and answer
them there, in a mailbox-shaped view with incoming and outgoing messages in
one thread.

## Scope decision

The system knows about **only the mail it sent itself and the replies to it.**
It never reads, stores, or displays the rest of `turkey.rsg@gmail.com`. This
holds for admins too: an admin sees every site-originated conversation and
nothing else.

Visibility: a member sees their own conversations; an admin sees all of them
via `?scope=all`, matching the existing convention in
`functions/api/mail/scheduled.ts`.

### Honest limitation

`users.history.list` returns identifiers for *every* change in the mailbox,
including unrelated mail. It returns no content. The sync intersects those
identifiers with `mail_threads` and discards the rest without fetching or
persisting anything. The "never reads the rest of the mailbox" guarantee is
exact at the content level; at the identifier level the sync momentarily sees
that unrelated messages exist and ignores them.

## Non-goals (v1)

- Downloading inbound attachments. The UI reports "N attachments — see Gmail".
  This keeps malware surface and R2 cost out of the feature.
- Rendering inbound HTML. Plain text only (see Security).
- Any mailbox operation that mutates Gmail state (labels, archive, delete).
  `gmail.modify` is a broader restricted scope and buys nothing here.
- Search across conversations.

## Architecture

Three moving parts on top of the existing mail feature:

1. **Thread registration** — the send path records the Gmail `threadId` it
   already receives, creating the set of conversations the system may read.
2. **Sync** — a secret-gated endpoint, driven by the existing Cloudflare cron
   Worker and by page load, that pulls new messages in registered threads
   into a local cache.
3. **Reply** — the existing send path with threading headers.

`sent_emails` stays exactly as it is: the permanent audit log, including
failures, never rewritten. The two new tables are a **rebuildable cache of
Gmail**; dropping and resyncing them loses nothing of record.

## Data model

Added to `db/schema.sql`, with the non-idempotent migration commands recorded
in the header comment block per repo convention.

```sql
-- sent_emails gains the thread it belongs to (NULL for rows written before
-- this feature, and for sends that failed before Gmail assigned a thread).
ALTER TABLE sent_emails ADD COLUMN gmail_thread_id TEXT;

CREATE TABLE IF NOT EXISTS mail_threads (
  id                TEXT PRIMARY KEY,          -- Gmail threadId
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email   TEXT NOT NULL,
  recipient_name    TEXT,
  subject           TEXT NOT NULL,             -- subject of the first outgoing message
  last_message_at   INTEGER NOT NULL,
  last_direction    TEXT NOT NULL CHECK (last_direction IN ('out', 'in')),
  unread            INTEGER NOT NULL DEFAULT 0,
  last_notified_at  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_sender
  ON mail_threads(sender_user_id, last_message_at DESC);

CREATE TABLE IF NOT EXISTS mail_messages (
  id                 TEXT PRIMARY KEY,         -- Gmail messageId
  thread_id          TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  rfc822_message_id  TEXT,                     -- Message-ID header, for In-Reply-To
  from_email         TEXT NOT NULL,
  from_name          TEXT,
  subject            TEXT,
  body_text          TEXT NOT NULL,
  attachment_count   INTEGER NOT NULL DEFAULT 0,
  sent_at            INTEGER NOT NULL,         -- Gmail internalDate, epoch seconds
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON mail_messages(thread_id, sent_at);

-- Single-row store for the Gmail history cursor.
CREATE TABLE IF NOT EXISTS mail_sync_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  history_id    TEXT,
  last_synced_at INTEGER,
  backfill_cursor TEXT      -- last_message_at of the last thread processed by a
                            -- running backfill, as text; NULL when no backfill
                            -- is in progress
);
```

`unread` is a per-thread boolean, not a count: the member either has seen the
latest inbound message or has not. It is cleared when the thread is opened.

### Why a thread per recipient

`compose.ts:127` builds and sends one MIME per recipient, so a ten-recipient
compose produces ten Gmail threads and ten `mail_threads` rows. This is the
behaviour we want — each correspondent's reply lands in its own conversation.
The UI must therefore not promise "one conversation per compose".

## Gmail transport changes

`functions/_lib/gmail.ts` is the single seam to Gmail and stays that way.

- `sendMail` currently returns `id`. Change it to return
  `{ id: string; threadId: string }`. The API response already carries both;
  no extra call.
- `sendMail` gains an optional `threadId` to attach a reply to its thread.
- `MimeMessage` gains optional `inReplyTo` and `references`.
- New: `getThread(env, threadId)` and `listHistory(env, startHistoryId)` and
  `getProfile(env)` (for the initial `historyId`).
- New guard: every read helper takes a thread id that the caller has already
  verified against `mail_threads`. A single `assertKnownThread(db, threadId)`
  used at each entry point enforces it; the Gmail read helpers are not
  exported to anything but the sync module.

## Sync algorithm

`POST /api/mail/sync`, gated by `X-Dispatch-Secret` exactly like
`/api/mail/dispatch`.

```
state = SELECT * FROM mail_sync_state WHERE id = 1

if state.history_id IS NULL:
    # first run: adopt the current cursor, do not walk history backwards
    state.history_id = getProfile().historyId
    return { ok: true, initialised: true }

if state.backfill_cursor IS NOT NULL:
    run one backfill batch (below) and return

try:
    changes = listHistory(state.history_id)
except HistoryTooOld (HTTP 404):
    # Gmail keeps roughly a week of history
    state.backfill_cursor = '99999999999'   # sentinel: start from the newest thread
    return { ok: true, backfillStarted: true }

ids = { threadId of every messageAdded in changes }
known = ids INTERSECT (SELECT id FROM mail_threads)

for threadId in known:            # typically empty
    ingestThread(threadId)

state.history_id = changes.historyId
state.last_synced_at = now
```

`ingestThread(threadId)` fetches the thread, upserts every message it contains
(both directions — the outgoing copy comes back too, and that is how the
conversation view gets its outgoing side), recomputes the thread's
`last_message_at` / `last_direction` / `unread`, and queues a notification if
a new inbound message appeared.

**Backfill** replaces the history walk when the cursor is stale. Each
invocation runs one batch:

```sql
SELECT id FROM mail_threads
 WHERE last_message_at < CAST(:backfill_cursor AS INTEGER)
 ORDER BY last_message_at DESC
 LIMIT 15
```

It ingests those threads, sets `backfill_cursor` to the `last_message_at` of
the last one, and returns. When a batch comes back empty the backfill is
exhausted: take a fresh `historyId` from `getProfile`, clear the cursor, and
resume normal history syncing. Batching keeps each invocation inside the
Workers subrequest budget, and the cursor makes the walk resumable across
cron ticks.

### Replies sent from Gmail directly

If someone at RSG answers a correspondent from the Gmail app instead of the
site, that message comes back in the thread like any other and is ingested as
an `out` row. The member who started the conversation therefore sees that it
was answered, even though the answer never passed through the website. This
falls out of ingesting whole threads and is worth keeping: the alternative is
a conversation view that silently disagrees with the mailbox.

Such a message has no corresponding `sent_emails` row, which is correct —
`sent_emails` logs what the *site* sent, and nothing else.

**Triggers:** the existing `workers/mail-cron` Worker calls `/api/mail/sync`
after `/api/mail/dispatch` on its `*/5` schedule; the conversations page calls
an authenticated refresh on load; a manual refresh button calls the same. The
page-driven path is throttled to at most one Gmail round trip per 60 seconds
globally, read from `mail_sync_state.last_synced_at`.

## API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/mail/sync` | POST | Secret-gated. Runs the algorithm above. |
| `/api/mail/conversations` | GET | Thread list for the caller; `?scope=all` for admins. |
| `/api/mail/conversations/[id]` | GET | One thread with its messages; clears `unread`. |
| `/api/mail/conversations/[id]/reply` | POST | Sends a reply into the thread. |
| `/api/mail/conversations/refresh` | POST | Authenticated, throttled, triggers a sync. |

Opening a thread clears its `unread` flag as a deliberate side effect of the
GET, the way a mail client marks a message read on open. It is the only
mutating GET in the feature.

Ownership lives in the SQL predicate itself
(`WHERE sender_user_id = ?` unless the caller is an admin), never in an
`if` above the query. CSRF handling matches `/auth/callback`, as with every
other mutating endpoint in this feature.

## Reply path

Reuses `sendAndLog` from `functions/_lib/compose.ts`, with:

- subject `Re: <thread subject>` (not doubled if it already starts with `Re:`)
- `In-Reply-To: <rfc822_message_id of the latest inbound message>`
- `References: <chain of the thread's message ids>`
- Gmail `threadId` on the send request

The reply is written to `sent_emails` like any other send, so the audit log
stays complete, and to `mail_messages` as an `out` row so the thread reads
correctly before the next sync. Rate limits, the recipient cap, Markdown
rendering and attachment rules are unchanged.

## Notifications

When `ingestThread` records a new inbound message, it mails the thread's
`sender_user_id` at their own address, from RSG, telling them who replied and
linking to the conversation.

- One notification per thread per hour, enforced by `last_notified_at`.
- Notification sends never create a `mail_threads` row. Only
  `/api/mail/send` and `/api/mail/dispatch` register threads. Without this
  rule the notification would become a conversation and the system would
  notify itself.
- A failed notification is logged and does not fail the sync.

## Security

- **Inbound HTML is never rendered.** Only the `text/plain` part is stored and
  displayed; if a message has no plain part, the HTML is stripped to text at
  ingest. Links are made clickable by the existing renderer in
  `functions/_lib/markdown.ts`, which escapes the whole input before inserting
  any tag it produced. A correspondent cannot inject markup into the page.
- **Inbound attachments are not downloaded** (see Non-goals).
- **Read access is thread-scoped by construction** — `assertKnownThread`
  precedes every Gmail read.
- **Ownership is enforced in SQL**, so a crafted thread id cannot read another
  member's conversation.
- Header values derived from inbound mail (names, subjects) pass through the
  existing `safeDisplayName` encoding before they are ever written into an
  outgoing header.

## Times

Every timestamp stored as epoch seconds, every timestamp displayed in
Istanbul time through `src/lib/istanbul-time.ts`.

## UI

New pages `src/pages/account/mail/conversations.astro` and its Turkish twin,
linked from `/account/mail` under a "Conversations" heading with an unread
badge. The mail page is already 366 lines carrying three sections; a mailbox
belongs on its own screen.

Layout: thread list on the left (correspondent, subject, snippet, Istanbul
time, unread in bold), the selected conversation on the right with messages
oldest to newest, outgoing and incoming visually distinguished, and a reply
box at the bottom. Admins get a "all conversations" toggle.

Both language versions stay in sync; message content itself is single-language,
as decided for the compose form.

## Testing

`node --test` via the existing `tsx` loader, matching `tests/mail.test.ts`:

- thread registration from a send response
- history filtering: unrelated thread ids are discarded
- stale `historyId` starts a backfill; batches resume from the cursor;
  exhaustion re-adopts a fresh cursor
- `ingestThread` upserts idempotently — syncing the same thread twice
  produces no duplicate messages and no second notification
- notification throttle honours `last_notified_at`
- `Re:` is not doubled; `In-Reply-To` and `References` carry the right ids
- inbound HTML never survives into the stored body
- ownership predicate denies another member's thread and allows an admin's

## Operational steps (outside the code)

1. Add `https://www.googleapis.com/auth/gmail.readonly` to the OAuth client's
   scopes in Google Cloud.
2. Re-run the refresh-token grant for `turkey.rsg@gmail.com` and replace the
   `GMAIL_REFRESH_TOKEN` secret. The old token does not gain the new scope.
   The consent screen warns harder than it did for `gmail.send` because
   `readonly` is a restricted scope; a single self-grant proceeds through
   "Advanced".
3. Apply the migrations to the remote D1 database.

No new Cloudflare resources are required. The cron Worker gains one line.
