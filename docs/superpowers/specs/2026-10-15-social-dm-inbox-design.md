# Social DM inbox: design

Date: 2026-10-15. Requested by the social media team. Brainstormed with the site admin.

## 1. Goal

Publishers read and answer the organisation's Instagram direct messages from
the admin panel, without anyone but the admin holding the account password.
The person on social media duty may not open the panel every day, so new
messages are noticed by the server on its own, and publishers are told by
e-mail before a message can no longer be answered.

Success looks like this: a DM arrives on @rsgturkey; within six hours (at once
if a publisher opens the tab) it is counted in the panel and a publisher gets
one short e-mail;
the e-mail's link opens that conversation (after sign-in if needed); the
publisher answers from the panel; the reply arrives in the sender's Instagram
inbox and the conversation is marked answered.

## 2. Scope

In v1:

- Instagram only: list conversations, read the latest messages, answer with
  text, read and answered marks, a digest e-mail, a last-call warning.
- A login return path, so links from any e-mail land where they point.

Not in v1:

- **X.** Reading DMs costs X credits and X is not connected. The adapter
  interface (§5) leaves room for it.
- **LinkedIn.** LinkedIn gives no API access to organisation page messages
  (Community Management API has no messaging). The tab shows an
  "Open LinkedIn messages" link only, and only when LinkedIn is connected.
- **Images, voice and stickers in replies.** Text only. Incoming shared media
  shows as an "Open attachment" link.
- **Answering after 24 hours.** Meta's HUMAN_AGENT tag (7 days) needs its own
  App Review; not requested.
- **Webhooks.** Polling every six hours is enough for a 24-hour window
  (§6). Webhooks can replace the poll later without changing the panel.
- **Storing message text.** See §4.

## 3. Who sees what

- The tab is `sosyal/dm`, registered with `publisherOnly: true` in
  `src/scripts/admin/sections.ts`. Admins and `is_social_publisher` users
  see it. Editors (`is_social` only) do not.
- Every DM endpoint checks `canSocialPublish(user)` (`functions/_lib/auth.ts`)
  on the server and returns 403 otherwise. The client check is for layout only.
- The Overview and the Sosyal sidebar count gain an unread DM figure for the
  same people. The count endpoint adds it only when `publisher` is true.

## 4. Data

Message text, names and media stay on Instagram. Each time the panel opens a
conversation, it fetches the messages live. The site keeps only what it needs
to count, notify and enforce the 24-hour window.

Migration (schema note in `db/schema.sql`, applied by the admin):

```sql
-- One row per Instagram (later X) conversation the poll has seen. No message
-- text is stored: the panel fetches messages live. id is our own random id,
-- used in URLs, so the platform's conversation id never appears in a link.
CREATE TABLE IF NOT EXISTS social_dm_threads (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL CHECK (platform IN ('instagram','x')),
  conversation_id   TEXT NOT NULL,
  peer_id           TEXT NOT NULL,          -- IGSID: the reply recipient
  peer_username     TEXT,                   -- shown in the list and the digest
  last_inbound_at   INTEGER,                -- their newest message
  last_outbound_at  INTEGER,                -- our newest message, panel or app
  read_at           INTEGER,                -- team-wide: someone opened it after last_inbound_at
  read_by           TEXT,
  digested_at       INTEGER,                -- last_inbound_at value already counted in a digest
  final_warned_at   INTEGER,                -- last_inbound_at value already warned about
  updated_at        INTEGER NOT NULL,
  UNIQUE (platform, conversation_id)
);

-- Per-person digest pacing (§7).
CREATE TABLE IF NOT EXISTS social_dm_digest_log (
  user_id   TEXT NOT NULL,
  sent_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_dm_digest_log_user ON social_dm_digest_log (user_id, sent_at);
```

Derived values, never stored:

- **unanswered:** `last_inbound_at > COALESCE(last_outbound_at, 0)`.
- **unread:** unanswered, and `COALESCE(read_at, 0) < last_inbound_at`.
- **window closes:** `last_inbound_at + 86400`. Past it, the thread is expired.

The digest log is pruned to 2 days on each poll.

The privacy policy (`/privacy/`, `/tr/privacy/`) gets a paragraph: messages
sent to our accounts are read by the social media team through the panel;
the site stores the sender's username and message times, not the messages.

## 5. Instagram adapter

New file `functions/_lib/social/instagram-dm.ts`. It reuses `IG_GRAPH` and
the token path the dispatcher uses (`usableToken(env, 'instagram', now)`).

- **Scopes.** `IG_SCOPES` gains `instagram_business_manage_messages`. The
  connection row's `scopes` tells the panel whether DMs are enabled. If the
  scope is missing, the tab shows "Reconnect Instagram to read messages" with
  the existing admin Connect button. Publishing keeps working until then.
- **List.** `GET /me/conversations?platform=instagram&fields=id,updated_time,participants`,
  newest first, one page of up to 25.
- **Messages.** `GET /<conversation>?fields=messages{id,created_time,from,to,message,attachments}`.
  Only the 20 newest messages have details; older ones are not shown. The
  thread view says so in one line.
- **Send.** `POST /me/messages`, JSON body
  `{ recipient: { id: peer_id }, message: { text } }`, Bearer token. Text is
  1 to 1000 bytes of UTF-8.
- **Errors** go through the existing `classifyGraphError`. An auth error
  marks the connection broken (`markBroken`), exactly as publishing does. A
  "window closed" refusal from Meta is reported as expired, whatever our
  clock says.
- Our own messages are recognised by `from.id === connection.account_id`.

Interface, so X can be added beside it:

```ts
export interface DmAdapter {
  listConversations(token: string): Promise<DmConversation[] | DmError>;
  thread(token: string, conversationId: string): Promise<DmMessage[] | DmError>;
  send(token: string, peerId: string, text: string): Promise<{ ok: true } | DmError>;
}
```

## 6. The poll

The existing social tick (`functions/api/social/dispatch.ts`, every minute
from `workers/mail-cron`) calls `pollDms(env, now)` after `dispatchSocial`.
Polling needs no Worker change and no new secret.

- **Pacing.** It runs only if six hours have passed since the last DM
  poll, recorded as a `dispatch_runs` row with kind `social_dm` (amended
  2026-10-15 at the admin's request; it was five minutes). Opening the DM
  tab, or Refresh, polls at once (at most every 30 seconds).
- **Notifications run every tick.** The digest and last call (§7) read only
  the database, so the tick runs them every minute, apart from the poll. A
  last call therefore goes out at 20 hours whatever the poll's timing.
- **Isolation.** The poll has its own try/catch. A DM failure never fails or
  delays publishing.
- **Steps:**
  1. List conversations.
  2. For each conversation whose `updated_time` is newer than our row's
     `updated_at`, fetch its messages. Set `last_inbound_at` (newest message
     not from us), `last_outbound_at` (newest from us) and `peer_username`.
     Upsert the row.
  3. Answers given in the Instagram app are seen here too, so the
     conversation is marked answered no matter where the reply came from.
- **Budget.** At most 10 conversation fetches per poll; the rest wait for
  the next poll. That is at most 11 Graph calls per poll.
- **Skip.** If Instagram is not connected or lacks the scope, skip quietly.

## 7. Notifications

Both use `notifyEach` / `sendSystemEmail` (`functions/_lib/social-notify.ts`),
Turkish then English in one message, like the other social notifications.
The e-mails contain usernames and times, never message text, so DM content
does not pile up in the organisation's Sent folder.

**Digest**

- Goes to `is_social_publisher` users. If there are none, it goes to admins.
- It goes out only if some thread is unanswered with
  `last_inbound_at > COALESCE(digested_at, 0)`, that is, there is something
  new since the last digest.
- Per person: at most one an hour and at most 6 per Istanbul day (from
  `social_dm_digest_log`). Nothing between 23:00 and 08:00 Istanbul time;
  the first poll after 08:00 sends what gathered overnight.
- **Content:** subject "Instagram: N cevaplanmamış mesaj / N unanswered
  messages". The body lists each unanswered thread: @username, when it
  arrived, how long is left to answer, and a link to that conversation.
  Expired threads are left out.
- After sending, `digested_at = last_inbound_at` for every listed thread.

**Last call**

- When an unanswered thread is past 20 hours (4 hours left) and
  `final_warned_at` is not equal to `last_inbound_at`, one e-mail goes to
  publishers and admins.
- Quiet hours and the digest caps do not apply.
- It is sent once per incoming message: set `final_warned_at = last_inbound_at`.

**Gmail load:** worst case about 4 people × 6 digests plus a few last calls,
about 30 a day, against Gmail's roughly 500 a day. These are system mails,
so they do not touch the 300-per-day member sending budget
(`functions/_lib/mail.ts`).

## 8. Panel

New sub-tab "DM" / "Mesajlar" under Sosyal, as in the mail inbox
(`sections/mail-inbox.ts`): a list on the left and the thread on the right at
lg and up; list then page on phones.

- **List rows:**
  - @username;
  - time of the last message;
  - one of three states:
    - unread (bold);
    - "Answered";
    - "N hours left", in amber under 4 hours, or "Expired".
- **Filter chips:** Unanswered (default), All.
- **Refresh.** A Refresh button runs the poll now for this user, rate
  limited to once in 30 seconds.
- **Thread:**
  - Live messages, ours right-aligned.
  - Attachments show as "Open attachment" links (`rel="noopener noreferrer"`).
  - A note that only the 20 newest messages are shown.
  - "Open in Instagram" link.
- **Reply box:**
  - A textarea with a byte counter (1000 bytes) and a Send button.
  - When the window has closed, the box is replaced by "24 hours have passed.
    Answer from the Instagram app." with the open-in-app link.
  - The reply box is a guarded form for `guardUnsaved` like the others.
- **Read state.** Opening a thread sets `read_at` and `read_by`. It is
  team-wide: one publisher reading it clears it for all.
- **Deep link.** `#sosyal/dm/<id>`, where `<id>` is our row id, so it matches
  the router's item pattern.
- **LinkedIn.** When LinkedIn is connected, a footer line reads "LinkedIn
  page messages cannot be read here" and links to the page inbox.
- All strings go in `src/i18n/ui.ts` in en and tr, under `admin.social.dm.*`.
  The usual UI rules apply: 44px touch targets on phones, no `text-gray-400`,
  no hidden plus inline-flex.

Endpoints, all `canSocialPublish` and CSRF-checked on writes:

| Method | Path | Does |
|---|---|---|
| GET | `/api/admin/social/dm` | thread rows and derived state, DM-enabled flag |
| GET | `/api/admin/social/dm/<id>` | live messages; marks read |
| POST | `/api/admin/social/dm/<id>/reply` | `{ text }`; window and length checked server-side |
| POST | `/api/admin/social/dm/refresh` | runs `pollDms` now, 30 s limit per user |

**Reply** checks:

- the window, using our clock and refusing if expired;
- the text length;
- the connection.

It then sends and sets `last_outbound_at = now`. It writes an audit row
`social.dm.reply` with the thread id and the actor, never the text. A
transient failure returns a retryable error and keeps the text in the box.

## 9. Login return path

Today `/auth/callback` always lands on `/account`. The URL fragment
(`#sosyal/dm/...`) never reaches the server, so:

- The signed-out admin prompt and other sign-in links send
  `/auth/login?next=<path+hash, URL-encoded>`.
- `login.ts` validates `next` and stores it in a 10-minute `HttpOnly`,
  `SameSite=Lax` cookie. Valid means it starts with `/`, does not start with
  `//` or `/\`, has no scheme, and its path is under `/admin`, `/tr/admin`,
  `/account` or `/tr/account`.
- `callback.ts` reads the cookie, clears it, and redirects there instead of
  `/account`. A new user still goes to `/account/setup` first.

The mail reply notifications (`threadLink()`) benefit from this as well.

## 10. Errors and edge cases

- **Instagram not connected, broken or missing the scope.** The tab says
  which one it is, and admins get the Connect button. The poll skips.
- **Two publishers answer at once.** Both replies are sent; Instagram allows
  it. The audit log shows both. No lock in v1.
- **The sender deletes a message, or blocks the account.** Thread fetch or
  send errors are shown as a short message. The row stays until the next
  poll updates it.
- **The Graph API is down.** The list still shows from our rows, with a
  "could not reach Instagram" note in the thread view.
- **Message requests.** Requests come through the same conversation list.
  Requests inactive for 30 days are not returned by Meta, which is fine,
  since they are past the window anyway.
- **Clock skew around the 24-hour edge.** Meta's refusal wins (§5).

## 11. Testing

- **Unit (`npm test`):**
  - adapter parsing (flat and nested shapes, our-vs-their messages);
  - derived state;
  - digest selection, caps and quiet hours, with Istanbul time fixed;
  - last-call once per message;
  - reply validation (bytes, window);
  - `next` validation (open-redirect cases);
  - role checks on every endpoint (editor 403, publisher 200);
  - the poll's per-run budget and isolation (a DM failure must not change
    `dispatchSocial`'s result).
- **Browser check `tests/browser/admin-social-dm.mjs`** with mocked
  endpoints:
  - the tab is hidden for an editor;
  - the list, thread and reply flow;
  - expired state;
  - the deep link;
  - phone layout.
- **Manual, signed in, after go-live:**
  1. Send a DM from a test account, open the DM tab and see it there.
  2. See the digest arrive.
  3. Answer from the panel and see it arrive.
  4. Answer from the Instagram app and see "Answered" after the next poll.

## 12. Go-live (admin, after merge)

1. Apply the migration in §4.
2. @rsgturkey switches to a Business account and is connected (already
   planned). In the Instagram app: Settings → Messages and story replies →
   Message controls → Connected tools → allow access to messages.
3. Reconnect Instagram from Connections, which grants the new scope.
4. No Worker redeploy and no new secret.
5. Run the manual pass in §11.

The Meta app's Standard Access covers accounts that hold a role on the app,
as @rsgturkey does for publishing. No App Review is needed for v1.
