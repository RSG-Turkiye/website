# Conversations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members who send mail as RSG can read the replies on the website and answer them there, in a mailbox-shaped view.

**Architecture:** The send path records the Gmail `threadId` it already receives, which defines the set of conversations the system is allowed to read. A secret-gated sync endpoint, driven by the existing Cloudflare cron Worker, walks Gmail's history cursor, keeps only changes belonging to registered threads, and caches their messages in D1. Replies reuse the existing send path with threading headers.

**Tech Stack:** Astro 5, Cloudflare Pages Functions, Cloudflare D1 (SQLite), Cloudflare Workers cron, Gmail REST API v1, `node --test` via `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-02-conversations-design.md`

## Global Constraints

- The system reads **only** Gmail threads registered in `mail_threads` — threads it started itself. No endpoint, helper, or query may list the mailbox. This holds for admins.
- Visibility: a member sees their own conversations; an admin sees all via `?scope=all`, matching `functions/api/mail/history.ts` and `functions/api/mail/scheduled.ts`.
- Ownership is enforced **inside the SQL predicate** (`WHERE sender_user_id = ?`), never in an `if` above the query.
- Inbound HTML is never rendered. Only `text/plain` is stored and displayed; links are made clickable by `functions/_lib/markdown.ts`, which escapes the whole input before inserting any tag it produced.
- Inbound attachments are never downloaded. The UI reports the count only.
- Every timestamp is stored as **epoch seconds** and displayed in Istanbul time via `src/lib/istanbul-time.ts`.
- Mutating endpoints call `checkCsrf(request)` first and return `{ error, code }` with a 403 on failure, matching `functions/api/mail/scheduled.ts`.
- Secret-gated endpoints check `X-Dispatch-Secret` against `env.MAIL_SYNC_SECRET`, matching `functions/api/mail/dispatch.ts`.
- `sent_emails` remains the permanent audit log and is never rewritten. `mail_threads` and `mail_messages` are a rebuildable cache of Gmail.
- Non-idempotent migrations live as `wrangler d1 execute` commands in the `db/schema.sql` header comment block, never as statements in the file. This is the repo's established convention.
- Every user-facing page exists in both languages: `src/pages/<x>` and `src/pages/tr/<x>`.
- Tests run with `npm test` (`node --import tsx --test tests/*.test.ts`).

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `functions/_lib/gmail-read.ts` | Every Gmail *read* call and the pure parsing of its payloads. Separate from `gmail.ts` so the read surface — the part that touches a restricted scope — is auditable in one place. |
| `functions/_lib/conversations.ts` | Domain layer: thread registration, thread ingest, and the pure decisions around them (thread state, notification throttle, reply subject and `References` chain). |
| `functions/api/mail/sync.ts` | Secret-gated sync endpoint. |
| `functions/api/mail/refresh.ts` | Authenticated, throttled, page-driven sync trigger. |
| `functions/api/mail/conversations.ts` | `GET /api/mail/conversations` — the thread list. |
| `functions/api/mail/conversations/[id].ts` | `GET /api/mail/conversations/:id` — one thread with its messages; clears `unread`. |
| `functions/api/mail/conversations/[id]/reply.ts` | `POST` — sends a reply into the thread. |
| `src/pages/account/conversations.astro` | The mailbox page (English). |
| `src/pages/tr/account/conversations.astro` | The mailbox page (Turkish). |
| `tests/gmail-read.test.ts` | Parsing of Gmail thread and history payloads. |
| `tests/conversations.test.ts` | Thread state, notification throttle, reply subject, `References` chain. |

**Modify:**

| File | Change |
|---|---|
| `db/schema.sql` | `mail_threads`, `mail_messages`, `mail_sync_state`, the `sent_emails.gmail_thread_id` column, and migration notes 6a/6b in the header. |
| `functions/_lib/gmail.ts` | `sendMail` returns `{ id, threadId }` and accepts an optional `threadId`; `MimeMessage` gains `inReplyTo` and `references`. |
| `functions/_lib/compose.ts` | `ComposeInput` gains threading fields; `insertLog` writes `gmail_thread_id`; `sendAndLog` registers the thread. |
| `workers/mail-cron/src/index.ts` | Calls `/api/mail/sync` after `/api/mail/dispatch`. |
| `src/pages/account/index.astro` + `src/pages/tr/account/index.astro` | Conversations entry point with an unread badge. |
| `src/pages/account/mail.astro` + `src/pages/tr/account/mail.astro` | Link across to Conversations. |
| `tests/gmail.test.ts` | Cover the new `sendMail` return shape and the reply headers. |
| `README.md` | The `gmail.readonly` setup step. |

### Deviation from the spec, and why

The spec's endpoint table lists the page-driven refresh at `/api/mail/conversations/refresh`. This plan puts it at **`/api/mail/refresh`** instead. In Cloudflare Pages Functions, `conversations/refresh.ts` and `conversations/[id].ts` both match the path `/api/mail/conversations/refresh`; static segments do take precedence, but relying on that precedence for a security-relevant route is a needless risk. A sibling route has no ambiguity to reason about. Nothing else about the endpoint changes.

---

### Task 1: Schema and migrations

**Files:**
- Modify: `db/schema.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `mail_threads`, `mail_messages`, `mail_sync_state`; column `sent_emails.gmail_thread_id`. Every later task depends on these names.

- [ ] **Step 1: Add the tables to `db/schema.sql`**

Append after the `scheduled_emails` table definition:

```sql
-- Conversations: the threads the site started, and their messages.
--
-- These two tables are a rebuildable cache of Gmail, not a record. Dropping
-- and resyncing them loses nothing: sent_emails remains the audit log of what
-- the site sent, including the failures Gmail never saw.
--
-- A row appears in mail_threads only when the site sends a message. That set
-- is the complete list of threads the system is permitted to read; nothing
-- else can add to it.
CREATE TABLE IF NOT EXISTS mail_threads (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email   TEXT NOT NULL,
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  last_message_at   INTEGER NOT NULL,
  last_direction    TEXT NOT NULL CHECK (last_direction IN ('out', 'in')),
  unread            INTEGER NOT NULL DEFAULT 0,
  last_notified_at  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_sender
  ON mail_threads(sender_user_id, last_message_at DESC);

-- The primary key is Gmail's own message id, which is what makes ingest
-- idempotent: re-syncing a thread re-inserts the same ids and INSERT OR
-- IGNORE discards them. Idempotency is a schema guarantee here, not something
-- the sync code has to get right.
CREATE TABLE IF NOT EXISTS mail_messages (
  id                 TEXT PRIMARY KEY,
  thread_id          TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  rfc822_message_id  TEXT,
  from_email         TEXT NOT NULL,
  from_name          TEXT,
  subject            TEXT,
  body_text          TEXT NOT NULL,
  attachment_count   INTEGER NOT NULL DEFAULT 0,
  sent_at            INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON mail_messages(thread_id, sent_at);

-- Single-row store for the Gmail history cursor.
CREATE TABLE IF NOT EXISTS mail_sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  history_id      TEXT,
  last_synced_at  INTEGER,
  backfill_cursor TEXT
);

INSERT OR IGNORE INTO mail_sync_state (id, history_id, last_synced_at, backfill_cursor)
VALUES (1, NULL, NULL, NULL);
```

- [ ] **Step 2: Add the migration notes to the `db/schema.sql` header**

Append inside the header comment block, after note 5:

```
-- 6a. functions/_lib/compose.ts now writes sent_emails.gmail_thread_id on
--     every send. Deploying that without this column first makes EVERY send
--     fail with D1 "no such column: gmail_thread_id" -- the mail goes out and
--     the log row is lost. ALTER TABLE ADD COLUMN is NOT idempotent -- do not
--     re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE sent_emails ADD COLUMN gmail_thread_id TEXT"
--
-- 6b. This file's mail_threads / mail_messages / mail_sync_state tables below
--     are NOT applied by any deploy step -- run them by hand (`IF NOT EXISTS`
--     and `INSERT OR IGNORE` make this safe to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, /api/mail/sync and /api/mail/conversations 500 with
--     "no such table: mail_threads", and every send fails when compose.ts
--     tries to register its thread.
```

- [ ] **Step 3: Verify the SQL parses by applying it to the local D1**

Run: `npx wrangler d1 execute rsg-members --local --file=db/schema.sql`
Expected: completes without a syntax error and reports the executed commands.

- [ ] **Step 4: Verify the new tables exist locally**

Run: `npx wrangler d1 execute rsg-members --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mail_%'"`
Expected: rows for `mail_attachments`, `mail_messages`, `mail_sync_state`, `mail_threads`.

- [ ] **Step 5: Verify the seed row exists and is single**

Run: `npx wrangler d1 execute rsg-members --local --command="SELECT id, history_id FROM mail_sync_state"`
Expected: exactly one row, `id = 1`, `history_id` NULL.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql
git commit -m "db: tables for conversation threads, messages and the sync cursor"
```

---

### Task 2: Thread id and reply headers in the Gmail transport

**Files:**
- Modify: `functions/_lib/gmail.ts:33-42` (`MimeMessage`), `functions/_lib/gmail.ts:114-184` (`buildMime`), `functions/_lib/gmail.ts:220-253` (`postSend`, `sendMail`)
- Modify: `functions/_lib/compose.ts:145` (the one call site of `sendMail`)
- Test: `tests/gmail.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface MimeMessage` gains `inReplyTo?: string` and `references?: string[]`.
  - `sendMail(env: Env, raw: string, threadId?: string): Promise<{ id: string; threadId: string }>` — **the return type changes from `string`**. Task 6 depends on this.

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail.test.ts`:

```ts
test('buildMime omits threading headers when none are given', () => {
  const raw = decodeMime(buildMime({
    fromAddress: 'turkey.rsg@gmail.com',
    fromName: 'RSG Türkiye',
    to: 'someone@example.com',
    replyTo: 'turkey.rsg@gmail.com',
    subject: 'Hello',
    body: { text: 'hi', html: '<p>hi</p>' },
    attachments: [],
  }));
  assert.ok(!raw.includes('In-Reply-To:'));
  assert.ok(!raw.includes('References:'));
});

test('buildMime writes In-Reply-To and a space-joined References chain', () => {
  const raw = decodeMime(buildMime({
    fromAddress: 'turkey.rsg@gmail.com',
    fromName: 'RSG Türkiye',
    to: 'someone@example.com',
    replyTo: 'turkey.rsg@gmail.com',
    subject: 'Re: Hello',
    body: { text: 'hi', html: '<p>hi</p>' },
    attachments: [],
    inReplyTo: '<b@mail.example>',
    references: ['<a@mail.example>', '<b@mail.example>'],
  }));
  assert.ok(raw.includes('In-Reply-To: <b@mail.example>\r\n'));
  assert.ok(raw.includes('References: <a@mail.example> <b@mail.example>\r\n'));
});

test('buildMime strips CR/LF from a crafted In-Reply-To', () => {
  const raw = decodeMime(buildMime({
    fromAddress: 'turkey.rsg@gmail.com',
    fromName: 'RSG Türkiye',
    to: 'someone@example.com',
    replyTo: 'turkey.rsg@gmail.com',
    subject: 'Re: Hello',
    body: { text: 'hi', html: '<p>hi</p>' },
    attachments: [],
    inReplyTo: '<a@x>\r\nBcc: victim@example.com',
  }));
  assert.ok(!raw.includes('Bcc:'));
});

test('sendMail returns both the message id and the thread id', async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: 'm1', threadId: 'th1' }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    const result = await sendMail(fakeEnv(), 'cmF3');
    assert.deepEqual(result, { id: 'm1', threadId: 'th1' });
  } finally {
    globalThis.fetch = original;
  }
});

test('sendMail passes threadId to Gmail when replying', async () => {
  let sendBody: Record<string, unknown> = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    sendBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: 'm2', threadId: 'th1' }), { status: 200 });
  }) as unknown as typeof fetch;

  try {
    await sendMail(fakeEnv(), 'cmF3', 'th1');
    assert.deepEqual(sendBody, { raw: 'cmF3', threadId: 'th1' });
  } finally {
    globalThis.fetch = original;
  }
});
```

Add these helpers near the top of `tests/gmail.test.ts` if the file does not already have equivalents:

```ts
function decodeMime(base64url: string): string {
  const padded = base64url.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function fakeEnv() {
  return {
    GOOGLE_CLIENT_ID: 'cid',
    GOOGLE_CLIENT_SECRET: 'secret',
    GMAIL_REFRESH_TOKEN: 'refresh',
  } as never;
}
```

Import `sendMail` alongside the existing imports from `../functions/_lib/gmail`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/gmail.test.ts`
Expected: FAIL — the threading-header tests find no `In-Reply-To:`, and the `sendMail` tests fail on `assert.deepEqual` because `sendMail` returns the string `'m1'`.

- [ ] **Step 3: Extend `MimeMessage` and `buildMime`**

In `functions/_lib/gmail.ts`, add to the `MimeMessage` interface:

```ts
  /**
   * Threading, set only when this message is a reply. Gmail groups by its own
   * threadId, but the recipient's mail client groups by these headers -- set
   * only one of the two and the reply looks like a new subject to whichever
   * side was left out.
   */
  inReplyTo?: string;
  references?: string[];
```

In `buildMime`, replace the `headers` array construction with:

```ts
  const headers = [
    `From: ${safeDisplayName(msg.fromName)} <${msg.fromAddress}>`,
    `To: ${headerSafe(msg.to)}`,
    `Reply-To: ${headerSafe(msg.replyTo)}`,
    `Subject: ${encodeHeader(headerSafe(msg.subject))}`,
    'MIME-Version: 1.0',
  ];

  // headerSafe on each id, not on the joined string: a crafted id carrying a
  // newline would otherwise inject a header of the attacker's choosing. These
  // ids come from inbound mail, so they are attacker-controlled by definition.
  if (msg.inReplyTo) {
    headers.push(`In-Reply-To: ${headerSafe(msg.inReplyTo)}`);
  }
  if (msg.references && msg.references.length > 0) {
    headers.push(`References: ${msg.references.map(headerSafe).join(' ')}`);
  }
```

- [ ] **Step 4: Change `postSend` and `sendMail`**

Replace `postSend` and `sendMail` in `functions/_lib/gmail.ts` with:

```ts
async function postSend(token: string, raw: string, threadId?: string): Promise<Response> {
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
}

export interface SentMessage {
  id: string;
  /**
   * Gmail assigns every message a thread, so this is always present -- for a
   * new conversation it is a thread of one. It is what registers the
   * conversation the sync is later allowed to read.
   */
  threadId: string;
}

export async function sendMail(env: Env, raw: string, threadId?: string): Promise<SentMessage> {
  const token = await getAccessToken(env);
  let res = await postSend(token, raw, threadId);

  // A revoked/expired token can still pass the isolate's own expiry check
  // (Google may invalidate it early) and come back 401 from Gmail itself.
  // Without clearing the cache here, every send for up to an hour of this
  // isolate's life reuses the same bad token and fails the same way. Clear
  // it and retry once with a freshly fetched token before giving up.
  if (res.status === 401) {
    cachedToken = null;
    const freshToken = await getAccessToken(env);
    res = await postSend(freshToken, raw, threadId);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail send failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ id: string; threadId: string }>();
  return { id: data.id, threadId: data.threadId };
}
```

- [ ] **Step 5: Fix the call site in `compose.ts`**

In `functions/_lib/compose.ts:145`, replace `gmailId = await sendMail(env, raw);` with:

```ts
      const sent = await sendMail(env, raw, input.threadId);
      gmailId = sent.id;
      gmailThreadId = sent.threadId;
```

and declare `let gmailThreadId: string | null = null;` beside `let gmailId` at line 128. Add `threadId?: string;` to `ComposeInput`. Task 6 uses `gmailThreadId`; leaving it unused here for now is expected and TypeScript will not complain about an assigned-but-unread local.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx tsx --test tests/gmail.test.ts`
Expected: PASS, all cases.

- [ ] **Step 7: Verify the whole suite and the type check still pass**

Run: `npm test && npx astro check`
Expected: all tests pass; `astro check` reports 0 errors.

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/gmail.ts functions/_lib/compose.ts tests/gmail.test.ts
git commit -m "feat: return the thread id from a send and support reply headers"
```

---

### Task 3: Parsing Gmail payloads

**Files:**
- Create: `functions/_lib/gmail-read.ts`
- Test: `tests/gmail-read.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions only; the network calls arrive in Task 4).
- Produces:
  - `interface GmailPart { mimeType?: string; filename?: string; headers?: GmailHeader[]; body?: { data?: string; size?: number; attachmentId?: string }; parts?: GmailPart[] }`
  - `interface GmailMessage { id: string; threadId: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart }`
  - `interface GmailThread { id: string; messages?: GmailMessage[] }`
  - `interface ParsedMessage { id: string; direction: 'out' | 'in'; rfc822MessageId: string | null; fromEmail: string; fromName: string | null; subject: string | null; bodyText: string; attachmentCount: number; sentAt: number }`
  - `decodeBase64Url(data: string): string`
  - `decodeEncodedWords(value: string): string`
  - `pickHeader(headers: GmailHeader[], name: string): string | null`
  - `parseFrom(value: string | null): { email: string; name: string | null }`
  - `htmlToText(html: string): string`
  - `extractPlainText(payload: GmailPart | undefined): string`
  - `countAttachments(payload: GmailPart | undefined): number`
  - `parseMessage(msg: GmailMessage, rsgAddress: string): ParsedMessage`
  - `parseThread(thread: GmailThread, rsgAddress: string): ParsedMessage[]`
  - `threadIdsFromHistory(payload: HistoryPayload): string[]`

  Tasks 5, 6 and 7 all depend on `ParsedMessage` exactly as spelled above.

- [ ] **Step 1: Write the failing tests**

Create `tests/gmail-read.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBase64Url,
  decodeEncodedWords,
  pickHeader,
  parseFrom,
  htmlToText,
  extractPlainText,
  countAttachments,
  parseMessage,
  parseThread,
  threadIdsFromHistory,
} from '../functions/_lib/gmail-read';

const RSG = 'turkey.rsg@gmail.com';

function b64url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

test('decodeBase64Url restores UTF-8 text and tolerates missing padding', () => {
  assert.equal(decodeBase64Url(b64url('Merhaba dünya')), 'Merhaba dünya');
  assert.equal(decodeBase64Url(b64url('a')), 'a');
  assert.equal(decodeBase64Url(b64url('ab')), 'ab');
  assert.equal(decodeBase64Url(b64url('abc')), 'abc');
});

test('decodeEncodedWords decodes base64 and quoted-printable encoded-words', () => {
  const b = '=?UTF-8?B?' + Buffer.from('Emre Çevik', 'utf8').toString('base64') + '?=';
  assert.equal(decodeEncodedWords(b), 'Emre Çevik');
  assert.equal(decodeEncodedWords('=?UTF-8?Q?Emre_=C3=87evik?='), 'Emre Çevik');
});

test('decodeEncodedWords leaves plain text alone and survives a broken word', () => {
  assert.equal(decodeEncodedWords('Plain subject'), 'Plain subject');
  assert.equal(decodeEncodedWords('=?NOSUCHSET?B?zzz?='), '=?NOSUCHSET?B?zzz?=');
});

test('pickHeader matches case-insensitively and returns null when absent', () => {
  const headers = [{ name: 'Message-Id', value: '<a@x>' }];
  assert.equal(pickHeader(headers, 'Message-ID'), '<a@x>');
  assert.equal(pickHeader(headers, 'Subject'), null);
});

test('parseFrom splits a display name from an address and lowercases the address', () => {
  assert.deepEqual(parseFrom('"Emre Çevik" <Emre@Example.COM>'), {
    email: 'emre@example.com',
    name: 'Emre Çevik',
  });
  assert.deepEqual(parseFrom('bare@example.com'), { email: 'bare@example.com', name: null });
  assert.deepEqual(parseFrom(null), { email: '', name: null });
});

test('htmlToText drops scripts and tags, keeps line structure, unescapes once', () => {
  const text = htmlToText('<style>a{}</style><p>Hi<br>there</p><script>x()</script><p>&amp;lt; ok</p>');
  assert.ok(!text.includes('a{}'));
  assert.ok(!text.includes('x()'));
  assert.ok(!text.includes('<'), 'no markup may survive: ' + text);
  assert.ok(text.includes('Hi\nthere'));
  // &amp;lt; must become "&lt;", not "<" -- entities are unescaped exactly once.
  assert.ok(text.includes('&lt; ok'));
});

test('extractPlainText prefers the text/plain part', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('plain version') } },
      { mimeType: 'text/html', body: { data: b64url('<p>html version</p>') } },
    ],
  };
  assert.equal(extractPlainText(payload), 'plain version');
});

test('extractPlainText falls back to converting the HTML part', () => {
  const payload = {
    mimeType: 'multipart/alternative',
    parts: [{ mimeType: 'text/html', body: { data: b64url('<p>only html</p>') } }],
  };
  assert.equal(extractPlainText(payload), 'only html');
});

test('extractPlainText ignores a text/plain part that is an attachment', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'text/plain', body: { data: b64url('real body') } },
      { mimeType: 'text/plain', filename: 'notes.txt', body: { data: b64url('attached notes') } },
    ],
  };
  assert.equal(extractPlainText(payload), 'real body');
});

test('extractPlainText returns an empty string when there is no text at all', () => {
  assert.equal(extractPlainText(undefined), '');
  assert.equal(extractPlainText({ mimeType: 'image/png', filename: 'a.png', body: {} }), '');
});

test('countAttachments counts named parts at any depth', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: b64url('x') } }] },
      { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'z' } },
      { mimeType: 'multipart/related', parts: [{ mimeType: 'image/png', filename: 'b.png', body: {} }] },
    ],
  };
  assert.equal(countAttachments(payload), 2);
});

test('parseMessage marks a SENT-labelled message as outgoing', () => {
  const parsed = parseMessage({
    id: 'm1',
    threadId: 't1',
    labelIds: ['SENT'],
    internalDate: '1756000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'RSG Türkiye <turkey.rsg@gmail.com>' },
        { name: 'Subject', value: 'Davet' },
        { name: 'Message-ID', value: '<out1@mail.gmail.com>' },
      ],
      body: { data: b64url('Merhaba') },
    },
  }, RSG);

  assert.equal(parsed.direction, 'out');
  assert.equal(parsed.sentAt, 1756000000);
  assert.equal(parsed.rfc822MessageId, '<out1@mail.gmail.com>');
  assert.equal(parsed.bodyText, 'Merhaba');
  assert.equal(parsed.fromEmail, 'turkey.rsg@gmail.com');
});

test('parseMessage marks a message from anyone else as incoming', () => {
  const parsed = parseMessage({
    id: 'm2',
    threadId: 't1',
    labelIds: ['INBOX'],
    internalDate: '1756000100000',
    payload: {
      mimeType: 'text/plain',
      headers: [{ name: 'From', value: 'Prof <prof@uni.edu>' }],
      body: { data: b64url('Tesekkurler') },
    },
  }, RSG);

  assert.equal(parsed.direction, 'in');
  assert.equal(parsed.fromName, 'Prof');
});

test('parseMessage treats an unlabelled message from the RSG address as outgoing', () => {
  const parsed = parseMessage({
    id: 'm3',
    threadId: 't1',
    internalDate: '1756000200000',
    payload: { headers: [{ name: 'From', value: '<TURKEY.RSG@GMAIL.COM>' }] },
  }, RSG);

  assert.equal(parsed.direction, 'out');
});

test('parseThread returns every message in ascending time order', () => {
  const messages = parseThread({
    id: 't1',
    messages: [
      { id: 'b', threadId: 't1', internalDate: '2000', payload: { headers: [{ name: 'From', value: 'x@y.z' }] } },
      { id: 'a', threadId: 't1', internalDate: '1000', payload: { headers: [{ name: 'From', value: 'x@y.z' }] } },
    ],
  }, RSG);

  assert.deepEqual(messages.map((m) => m.id), ['a', 'b']);
});

test('parseThread on an empty thread returns an empty array', () => {
  assert.deepEqual(parseThread({ id: 't1' }, RSG), []);
});

test('threadIdsFromHistory collects added messages and deduplicates', () => {
  const ids = threadIdsFromHistory({
    history: [
      { messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }, { message: { id: 'm2', threadId: 't1' } }] },
      { messagesAdded: [{ message: { id: 'm3', threadId: 't2' } }] },
      { labelsAdded: [{ message: { id: 'm4', threadId: 't9' } }] },
    ],
  });

  // t9 changed labels only -- no new message, nothing to ingest.
  assert.deepEqual(ids.sort(), ['t1', 't2']);
});

test('threadIdsFromHistory on an empty history returns an empty array', () => {
  assert.deepEqual(threadIdsFromHistory({}), []);
  assert.deepEqual(threadIdsFromHistory({ history: [] }), []);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/gmail-read.test.ts`
Expected: FAIL — `Cannot find module '../functions/_lib/gmail-read'`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/gmail-read.ts`:

```ts
/**
 * Reading the RSG mailbox.
 *
 * Separate from gmail.ts on purpose: sending needs `gmail.send`, reading needs
 * `gmail.readonly`, and readonly is a *restricted* scope that grants the token
 * the whole mailbox. Keeping every read in one file means the blast radius of
 * that scope is one auditable module rather than a habit spread across the
 * codebase.
 *
 * This file holds the pure parsing; the network calls live beside it and are
 * reachable only through conversations.ts, which checks the thread against
 * mail_threads first.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  /** Milliseconds since the epoch, as a string. Gmail's own field. */
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

export interface HistoryPayload {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

export interface ParsedMessage {
  id: string;
  direction: 'out' | 'in';
  rfc822MessageId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  attachmentCount: number;
  /** Epoch seconds. */
  sentAt: number;
}

export function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * RFC 2047 encoded-words in a header value. Gmail returns header values raw,
 * so a Turkish name or subject arrives as `=?UTF-8?B?...?=` and would
 * otherwise be shown to members as gibberish.
 */
export function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        const decoder = new TextDecoder(charset.toLowerCase());
        if (encoding.toUpperCase() === 'B') {
          const binary = atob(text);
          return decoder.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
        }
        const unquoted = text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        return decoder.decode(Uint8Array.from(unquoted, (c) => c.charCodeAt(0)));
      } catch {
        // An unknown charset or malformed payload: show the raw word rather
        // than throwing away the header.
        return whole;
      }
    },
  );
}

export function pickHeader(headers: GmailHeader[], name: string): string | null {
  const wanted = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === wanted) return header.value;
  }
  return null;
}

export function parseFrom(value: string | null): { email: string; name: string | null } {
  if (!value) return { email: '', name: null };
  const angle = value.match(/^(.*)<([^>]+)>\s*$/);
  if (!angle) return { email: value.trim().toLowerCase(), name: null };
  const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
  return { email: angle[2].trim().toLowerCase(), name: name || null };
}

/**
 * Best-effort text from HTML, used only when a message has no text/plain part.
 * This is not a sanitiser and its output is never inserted as markup -- the
 * page renders it as text. Its only job is to stop a member from being shown
 * a wall of tags.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    // &amp; last: doing it first would turn `&amp;lt;` into `<` instead of
    // the `&lt;` the sender actually wrote.
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectText(part: GmailPart | undefined, out: { plain: string[]; html: string[] }): void {
  if (!part) return;
  // A part with a filename is an attachment, even when its type is text/plain.
  // Folding an attached .txt into the body would misrepresent the message.
  if (!part.filename && part.body?.data) {
    const mime = (part.mimeType ?? '').toLowerCase();
    if (mime === 'text/plain') out.plain.push(decodeBase64Url(part.body.data));
    else if (mime === 'text/html') out.html.push(decodeBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) collectText(child, out);
}

export function extractPlainText(payload: GmailPart | undefined): string {
  const out = { plain: [] as string[], html: [] as string[] };
  collectText(payload, out);
  if (out.plain.length > 0) return out.plain.join('\n').trim();
  if (out.html.length > 0) return htmlToText(out.html.join('\n'));
  return '';
}

export function countAttachments(payload: GmailPart | undefined): number {
  let count = 0;
  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.filename) count += 1;
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return count;
}

export function parseMessage(msg: GmailMessage, rsgAddress: string): ParsedMessage {
  const headers = msg.payload?.headers ?? [];
  const rawFrom = pickHeader(headers, 'From');
  const from = parseFrom(rawFrom === null ? null : decodeEncodedWords(rawFrom));
  const rawSubject = pickHeader(headers, 'Subject');

  // Gmail's SENT label is the reliable signal. The address comparison is the
  // fallback for a payload that arrives without labels.
  const isOutgoing =
    (msg.labelIds ?? []).includes('SENT') || from.email === rsgAddress.trim().toLowerCase();

  return {
    id: msg.id,
    direction: isOutgoing ? 'out' : 'in',
    rfc822MessageId: pickHeader(headers, 'Message-ID'),
    fromEmail: from.email,
    fromName: from.name,
    subject: rawSubject === null ? null : decodeEncodedWords(rawSubject),
    bodyText: extractPlainText(msg.payload),
    attachmentCount: countAttachments(msg.payload),
    sentAt: msg.internalDate ? Math.floor(Number(msg.internalDate) / 1000) : 0,
  };
}

export function parseThread(thread: GmailThread, rsgAddress: string): ParsedMessage[] {
  return (thread.messages ?? [])
    .map((msg) => parseMessage(msg, rsgAddress))
    .sort((a, b) => a.sentAt - b.sentAt);
}

/**
 * Thread ids of messages that were *added* since the cursor. Label changes and
 * deletions are deliberately ignored: they cannot introduce a reply, and
 * acting on them would mean reading threads for no reason.
 */
export function threadIdsFromHistory(payload: HistoryPayload): string[] {
  const ids = new Set<string>();
  for (const entry of payload.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      const id = added.message?.threadId;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/gmail-read.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/gmail-read.ts tests/gmail-read.test.ts
git commit -m "feat: parse Gmail thread and history payloads"
```

---

### Task 4: Gmail read calls

**Files:**
- Modify: `functions/_lib/gmail.ts` (export a cache reset)
- Modify: `functions/_lib/gmail-read.ts` (append the network calls)
- Test: `tests/gmail-read.test.ts` (append)

**Interfaces:**
- Consumes: `getAccessToken(env)` and `GmailError` from `functions/_lib/gmail.ts`; the types and parsers from Task 3.
- Produces:
  - `class GmailHistoryExpired extends Error` — thrown when Gmail rejects the stored cursor.
  - `getProfileHistoryId(env: Env): Promise<string>`
  - `listHistory(env: Env, startHistoryId: string): Promise<{ threadIds: string[]; historyId: string }>`
  - `fetchThread(env: Env, threadId: string): Promise<GmailThread>`
  - `resetAccessToken(): void` from `functions/_lib/gmail.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/gmail-read.test.ts`:

```ts
import { getProfileHistoryId, listHistory, fetchThread, GmailHistoryExpired } from '../functions/_lib/gmail-read';

function stubFetch(handler: (url: string) => Response): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    if (String(url).includes('oauth2')) {
      return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    }
    return handler(String(url));
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = original; };
}

const READ_ENV = {
  GOOGLE_CLIENT_ID: 'cid',
  GOOGLE_CLIENT_SECRET: 'secret',
  GMAIL_REFRESH_TOKEN: 'refresh',
} as never;

test('getProfileHistoryId returns the cursor from the profile', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({ historyId: '4242' }), { status: 200 }));
  try {
    assert.equal(await getProfileHistoryId(READ_ENV), '4242');
  } finally {
    restore();
  }
});

test('listHistory returns thread ids and the new cursor', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({
    history: [{ messagesAdded: [{ message: { id: 'm1', threadId: 't1' } }] }],
    historyId: '5000',
  }), { status: 200 }));
  try {
    assert.deepEqual(await listHistory(READ_ENV, '4242'), { threadIds: ['t1'], historyId: '5000' });
  } finally {
    restore();
  }
});

test('listHistory follows pages and merges their thread ids', async () => {
  let call = 0;
  const restore = stubFetch(() => {
    call += 1;
    if (call === 1) {
      return new Response(JSON.stringify({
        history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
        historyId: '5000',
        nextPageToken: 'p2',
      }), { status: 200 });
    }
    return new Response(JSON.stringify({
      history: [{ messagesAdded: [{ message: { threadId: 't2' } }] }],
      historyId: '5001',
    }), { status: 200 });
  });
  try {
    const result = await listHistory(READ_ENV, '4242');
    assert.deepEqual(result.threadIds.sort(), ['t1', 't2']);
    assert.equal(result.historyId, '5001');
  } finally {
    restore();
  }
});

test('listHistory throws GmailHistoryExpired on a 404', async () => {
  const restore = stubFetch(() => new Response('{"error":{"code":404}}', { status: 404 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), GmailHistoryExpired);
  } finally {
    restore();
  }
});

test('listHistory throws GmailHistoryExpired rather than paging forever', async () => {
  const restore = stubFetch(() => new Response(JSON.stringify({
    history: [{ messagesAdded: [{ message: { threadId: 't1' } }] }],
    historyId: '5000',
    nextPageToken: 'always-another',
  }), { status: 200 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), GmailHistoryExpired);
  } finally {
    restore();
  }
});

test('listHistory surfaces any other Gmail failure as an error', async () => {
  const restore = stubFetch(() => new Response('boom', { status: 500 }));
  try {
    await assert.rejects(() => listHistory(READ_ENV, '1'), /Gmail history failed \(500\)/);
  } finally {
    restore();
  }
});

test('fetchThread asks for the full format and returns the thread', async () => {
  let seen = '';
  const restore = stubFetch((url) => {
    seen = url;
    return new Response(JSON.stringify({ id: 't1', messages: [] }), { status: 200 });
  });
  try {
    const thread = await fetchThread(READ_ENV, 't1');
    assert.equal(thread.id, 't1');
    assert.ok(seen.includes('/threads/t1'));
    assert.ok(seen.includes('format=full'));
  } finally {
    restore();
  }
});

test('fetchThread rejects a thread id that is not a plain Gmail id', async () => {
  await assert.rejects(() => fetchThread(READ_ENV, '../messages/secret'), /invalid thread id/i);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/gmail-read.test.ts`
Expected: FAIL — `getProfileHistoryId`, `listHistory`, `fetchThread` and `GmailHistoryExpired` are not exported.

- [ ] **Step 3: Export a token-cache reset from `gmail.ts`**

Add to `functions/_lib/gmail.ts`, immediately after the `cachedToken` declaration at line 188:

```ts
/**
 * Drop the cached access token. Exported for gmail-read.ts, which has to
 * recover from the same early-invalidation case sendMail handles inline: a
 * token Google revoked before its stated expiry passes the isolate's own
 * check and then comes back 401 from Gmail.
 */
export function resetAccessToken(): void {
  cachedToken = null;
}
```

- [ ] **Step 4: Append the network calls to `gmail-read.ts`**

```ts
import type { Env } from './auth';
import { getAccessToken, resetAccessToken, GmailError } from './gmail';

/**
 * The stored history cursor is older than Gmail's retention (roughly a week).
 * The caller's answer is a bounded, resumable backfill -- not a retry.
 */
export class GmailHistoryExpired extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailHistoryExpired';
  }
}

/** Gmail ids are opaque, but they are always plain hex-ish tokens. */
function assertGmailId(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new GmailError(`Invalid thread id: ${id.slice(0, 40)}`);
  }
}

async function gmailGet(env: Env, path: string): Promise<Response> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`;
  const token = await getAccessToken(env);
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    resetAccessToken();
    const fresh = await getAccessToken(env);
    res = await fetch(url, { headers: { Authorization: `Bearer ${fresh}` } });
  }

  return res;
}

export async function getProfileHistoryId(env: Env): Promise<string> {
  const res = await gmailGet(env, 'profile');
  if (!res.ok) {
    throw new GmailError(`Gmail profile failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const data = await res.json<{ historyId: string }>();
  return String(data.historyId);
}

/**
 * At most this many history pages per sync. Hitting the cap means the mailbox
 * has moved further than one tick can reasonably walk, which is the same
 * situation as an expired cursor: hand it to the backfill, which is bounded
 * and resumable, instead of looping here.
 */
const MAX_HISTORY_PAGES = 10;

export async function listHistory(
  env: Env,
  startHistoryId: string,
): Promise<{ threadIds: string[]; historyId: string }> {
  const ids = new Set<string>();
  let pageToken: string | undefined;
  let historyId = startHistoryId;

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const query = new URLSearchParams({
      startHistoryId,
      historyTypes: 'messageAdded',
      maxResults: '500',
    });
    if (pageToken) query.set('pageToken', pageToken);

    const res = await gmailGet(env, `history?${query.toString()}`);

    // 404 is Gmail's specific answer for "that cursor is older than I keep".
    if (res.status === 404) {
      throw new GmailHistoryExpired(`History cursor ${startHistoryId} is no longer valid`);
    }
    if (!res.ok) {
      throw new GmailError(`Gmail history failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }

    const data = await res.json<HistoryPayload>();
    for (const id of threadIdsFromHistory(data)) ids.add(id);
    if (data.historyId) historyId = String(data.historyId);

    if (!data.nextPageToken) return { threadIds: [...ids], historyId };
    pageToken = data.nextPageToken;
  }

  throw new GmailHistoryExpired(`History from ${startHistoryId} exceeded ${MAX_HISTORY_PAGES} pages`);
}

/**
 * Fetch one thread in full.
 *
 * Call this only through `ingestThread` in conversations.ts, which checks the
 * id against `mail_threads` first. Reading a thread the site did not start
 * would break the guarantee this whole feature is built on.
 */
export async function fetchThread(env: Env, threadId: string): Promise<GmailThread> {
  assertGmailId(threadId);
  const res = await gmailGet(env, `threads/${threadId}?format=full`);
  if (!res.ok) {
    throw new GmailError(`Gmail thread fetch failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res.json<GmailThread>();
}
```

Move the two `import` lines to the top of the file, beside the existing imports — TypeScript allows imports only at module scope.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx tsx --test tests/gmail-read.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Verify the whole suite and the type check**

Run: `npm test && npx astro check`
Expected: all tests pass; `astro check` reports 0 errors.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/gmail.ts functions/_lib/gmail-read.ts tests/gmail-read.test.ts
git commit -m "feat: Gmail history and thread read calls"
```

---

### Task 5: Conversation decisions

**Files:**
- Create: `functions/_lib/conversations.ts`
- Test: `tests/conversations.test.ts`

**Interfaces:**
- Consumes: `type ParsedMessage` from `functions/_lib/gmail-read.ts`.
- Produces:
  - `const NOTIFY_THROTTLE_SECONDS = 3600`
  - `const MAX_REFERENCES = 10`
  - `const SNIPPET_LENGTH = 140`
  - `interface ThreadState { lastMessageAt: number; lastDirection: 'out' | 'in' }`
  - `replySubject(subject: string): string`
  - `buildReferences(messageIds: Array<string | null>): string[]`
  - `computeThreadState(messages: ParsedMessage[]): ThreadState | null`
  - `shouldNotify(lastNotifiedAt: number | null, now: number): boolean`
  - `snippet(bodyText: string, max?: number): string`

  Tasks 6, 7 and 9 depend on these signatures.

- [ ] **Step 1: Write the failing tests**

Create `tests/conversations.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  replySubject,
  buildReferences,
  computeThreadState,
  shouldNotify,
  snippet,
  NOTIFY_THROTTLE_SECONDS,
  MAX_REFERENCES,
} from '../functions/_lib/conversations';
import type { ParsedMessage } from '../functions/_lib/gmail-read';

function msg(over: Partial<ParsedMessage>): ParsedMessage {
  return {
    id: 'm',
    direction: 'in',
    rfc822MessageId: null,
    fromEmail: 'a@b.c',
    fromName: null,
    subject: null,
    bodyText: '',
    attachmentCount: 0,
    sentAt: 0,
    ...over,
  };
}

test('replySubject prefixes a plain subject', () => {
  assert.equal(replySubject('Sempozyum daveti'), 'Re: Sempozyum daveti');
});

test('replySubject does not double an existing prefix, in any case or spacing', () => {
  assert.equal(replySubject('Re: Sempozyum'), 'Re: Sempozyum');
  assert.equal(replySubject('re: Sempozyum'), 're: Sempozyum');
  assert.equal(replySubject('RE : Sempozyum'), 'RE : Sempozyum');
  assert.equal(replySubject('  Re: Sempozyum  '), 'Re: Sempozyum');
});

test('replySubject handles an empty subject', () => {
  assert.equal(replySubject('   '), 'Re:');
});

test('buildReferences drops nulls, deduplicates, and keeps order', () => {
  assert.deepEqual(
    buildReferences(['<a@x>', null, '<b@x>', '<a@x>']),
    ['<a@x>', '<b@x>'],
  );
});

test('buildReferences keeps only the most recent ids', () => {
  const ids = Array.from({ length: MAX_REFERENCES + 5 }, (_, i) => `<m${i}@x>`);
  const built = buildReferences(ids);
  assert.equal(built.length, MAX_REFERENCES);
  assert.equal(built[built.length - 1], `<m${ids.length - 1}@x>`);
  assert.equal(built[0], `<m${ids.length - MAX_REFERENCES}@x>`);
});

test('buildReferences on nothing usable returns an empty array', () => {
  assert.deepEqual(buildReferences([null, null]), []);
});

test('computeThreadState reports the newest message and its direction', () => {
  const state = computeThreadState([
    msg({ id: 'a', sentAt: 100, direction: 'out' }),
    msg({ id: 'b', sentAt: 300, direction: 'in' }),
    msg({ id: 'c', sentAt: 200, direction: 'out' }),
  ]);
  assert.deepEqual(state, { lastMessageAt: 300, lastDirection: 'in' });
});

test('computeThreadState on an empty thread returns null', () => {
  assert.equal(computeThreadState([]), null);
});

test('computeThreadState prefers the later entry when timestamps tie', () => {
  const state = computeThreadState([
    msg({ id: 'a', sentAt: 100, direction: 'out' }),
    msg({ id: 'b', sentAt: 100, direction: 'in' }),
  ]);
  assert.deepEqual(state, { lastMessageAt: 100, lastDirection: 'in' });
});

test('shouldNotify allows a first notification', () => {
  assert.equal(shouldNotify(null, 1_800_000_000), true);
});

test('shouldNotify blocks inside the throttle window and allows on its edge', () => {
  const now = 1_800_000_000;
  assert.equal(shouldNotify(now - NOTIFY_THROTTLE_SECONDS + 1, now), false);
  assert.equal(shouldNotify(now - NOTIFY_THROTTLE_SECONDS, now), true);
});

test('shouldNotify blocks a timestamp in the future rather than trusting it', () => {
  const now = 1_800_000_000;
  assert.equal(shouldNotify(now + 600, now), false);
});

test('snippet collapses whitespace and leaves a short body whole', () => {
  assert.equal(snippet('  Merhaba\n\n  dünya \t'), 'Merhaba dünya');
});

test('snippet truncates a long body with an ellipsis', () => {
  const long = 'x'.repeat(500);
  const out = snippet(long);
  assert.equal(out.length, 140);
  assert.ok(out.endsWith('…'));
});

test('snippet on an empty body returns an empty string', () => {
  assert.equal(snippet(''), '');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/conversations.test.ts`
Expected: FAIL — `Cannot find module '../functions/_lib/conversations'`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/conversations.ts`:

```ts
import type { ParsedMessage } from './gmail-read';

/**
 * Conversations: the threads the site started, and what to do with them.
 *
 * The decisions live here as pure functions so they can be tested without a
 * database or a Gmail account; the SQL and the network calls that use them sit
 * below in the same file (Task 6) with nothing clever in them.
 */

/** One notification per thread per hour, however many replies arrive. */
export const NOTIFY_THROTTLE_SECONDS = 3600;

/**
 * A References header naming every message in a long thread would run past
 * the line length mail servers are willing to accept. Clients only need
 * enough of the tail to place the reply.
 */
export const MAX_REFERENCES = 10;

export const SNIPPET_LENGTH = 140;

export interface ThreadState {
  lastMessageAt: number;
  lastDirection: 'out' | 'in';
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  // `RE :` and `re:` are both prefixes a real client produces; matching only
  // the exact string `Re: ` would give "Re: RE : Sempozyum" after two rounds.
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`.trim();
}

export function buildReferences(messageIds: Array<string | null>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of messageIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered.slice(-MAX_REFERENCES);
}

export function computeThreadState(messages: ParsedMessage[]): ThreadState | null {
  if (messages.length === 0) return null;
  let latest = messages[0];
  // `>=` rather than `>`: on a tie the later entry wins, which matches the
  // ascending order parseThread produces and keeps the answer stable.
  for (const message of messages) {
    if (message.sentAt >= latest.sentAt) latest = message;
  }
  return { lastMessageAt: latest.sentAt, lastDirection: latest.direction };
}

export function shouldNotify(lastNotifiedAt: number | null, now: number): boolean {
  if (lastNotifiedAt === null) return true;
  // A stamp in the future (clock skew between D1 and the isolate) fails this
  // comparison and suppresses the mail, which is the safe direction to err.
  return now - lastNotifiedAt >= NOTIFY_THROTTLE_SECONDS;
}

export function snippet(bodyText: string, max = SNIPPET_LENGTH): string {
  const flat = bodyText.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/conversations.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/conversations.ts tests/conversations.test.ts
git commit -m "feat: conversation thread state, reply subject and notify throttle"
```

---

### Task 6: Registering and ingesting threads, and notifying the owner

**Files:**
- Modify: `functions/_lib/conversations.ts` (append the storage layer)
- Modify: `functions/_lib/compose.ts:91-116` (`insertLog`), `functions/_lib/compose.ts:118-180` (`sendAndLog`)

**Interfaces:**
- Consumes: the pure functions from Task 5; `fetchThread`, `parseThread`, `type ParsedMessage` from Task 3/4; `buildMime`, `sendMail` from Task 2; `renderBody` from `functions/_lib/markdown.ts`; `generateId` from `functions/_lib/auth.ts`.
- Produces:
  - `registerThread(env: Env, params: RegisterThreadParams): Promise<void>` where `interface RegisterThreadParams { threadId: string; senderUserId: string; recipientEmail: string; recipientName: string | null; subject: string; sentAt: number }`
  - `interface IngestResult { newInbound: number; total: number }`
  - `ingestThread(env: Env, threadId: string, now: number): Promise<IngestResult>`
  - `notifyThreadOwner(env: Env, threadId: string, siteOrigin: string, now: number): Promise<boolean>`

  Tasks 7, 9 and 10 depend on these signatures.

- [ ] **Step 1: Append the storage layer to `functions/_lib/conversations.ts`**

Add these imports at the top of the file, beside the existing `import type { ParsedMessage }`:

```ts
import type { Env } from './auth';
import { fetchThread, parseThread } from './gmail-read';
import { buildMime, sendMail } from './gmail';
import { renderBody } from './markdown';
```

Append to the end of the file:

```ts
export interface RegisterThreadParams {
  threadId: string;
  senderUserId: string;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  sentAt: number;
}

/**
 * Record that the site sent into this thread.
 *
 * This is the only way a row enters mail_threads, and mail_threads is the only
 * set of threads the sync is permitted to read. Everything the feature
 * promises about not touching the rest of the mailbox rests on that.
 *
 * Called for replies too, where the row already exists: the INSERT is ignored
 * and the UPDATE moves the thread up the list.
 */
export async function registerThread(env: Env, params: RegisterThreadParams): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO mail_threads
      (id, sender_user_id, recipient_email, recipient_name, subject,
       last_message_at, last_direction, unread, last_notified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'out', 0, NULL, ?, ?)`
  ).bind(
    params.threadId,
    params.senderUserId,
    params.recipientEmail,
    params.recipientName,
    params.subject,
    params.sentAt,
    params.sentAt,
    params.sentAt,
  ).run();

  // Guarded by the timestamp so an out-of-order call cannot drag a thread
  // backwards in the list.
  await env.DB.prepare(
    `UPDATE mail_threads
     SET last_message_at = ?, last_direction = 'out', updated_at = ?
     WHERE id = ? AND last_message_at < ?`
  ).bind(params.sentAt, params.sentAt, params.threadId, params.sentAt).run();
}

export interface IngestResult {
  newInbound: number;
  total: number;
}

/**
 * Pull one thread from Gmail into the local cache.
 *
 * The lookup at the top IS the `assertKnownThread` guard the spec calls for.
 * It lives here rather than as a separate exported function because this is
 * the only place a Gmail read is ever issued from: an id that is not in
 * mail_threads is never fetched, so no request this feature can be made to
 * serve will read a message the site did not start. A standalone helper called
 * from one caller would only make it easier to add a second caller that
 * forgets it.
 */
export async function ingestThread(env: Env, threadId: string, now: number): Promise<IngestResult> {
  const known = await env.DB.prepare(
    'SELECT id FROM mail_threads WHERE id = ?'
  ).bind(threadId).first<{ id: string }>();
  if (!known) return { newInbound: 0, total: 0 };

  const messages = parseThread(await fetchThread(env, threadId), env.RSG_MAIL_FROM);

  let newInbound = 0;
  for (const message of messages) {
    // INSERT OR IGNORE against Gmail's own message id as the primary key is
    // what makes re-syncing a thread harmless. `meta.changes` then tells us
    // truthfully whether this message is new, which is what the notification
    // decision needs -- counting parsed messages instead would re-notify on
    // every sync.
    const res = await env.DB.prepare(
      `INSERT OR IGNORE INTO mail_messages
        (id, thread_id, direction, rfc822_message_id, from_email, from_name,
         subject, body_text, attachment_count, sent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      message.id,
      threadId,
      message.direction,
      message.rfc822MessageId,
      message.fromEmail,
      message.fromName,
      message.subject,
      message.bodyText,
      message.attachmentCount,
      message.sentAt,
      now,
    ).run();

    if (res.meta.changes > 0 && message.direction === 'in') newInbound += 1;
  }

  const state = computeThreadState(messages);
  if (state) {
    await env.DB.prepare(
      `UPDATE mail_threads
       SET last_message_at = ?, last_direction = ?, updated_at = ?,
           unread = CASE WHEN ? > 0 THEN 1 ELSE unread END
       WHERE id = ?`
    ).bind(state.lastMessageAt, state.lastDirection, now, newInbound, threadId).run();
  }

  return { newInbound, total: messages.length };
}

/**
 * Tell the member who started a thread that it has a reply waiting.
 *
 * Returns whether a mail actually went out, so the caller can report it.
 */
export async function notifyThreadOwner(
  env: Env,
  threadId: string,
  siteOrigin: string,
  now: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT t.subject, t.recipient_email, t.last_notified_at, u.email AS owner_email
     FROM mail_threads t
     JOIN users u ON u.id = t.sender_user_id
     WHERE t.id = ?`
  ).bind(threadId).first<{
    subject: string;
    recipient_email: string;
    last_notified_at: number | null;
    owner_email: string;
  }>();

  if (!row) return false;
  if (!shouldNotify(row.last_notified_at, now)) return false;

  const link = `${siteOrigin}/tr/account/conversations`;
  const body = [
    `${row.recipient_email} adlı kişi "${row.subject}" konulu e-postanıza cevap verdi.`,
    '',
    // The member answers on the site, not by replying to this mail: a reply to
    // this address opens a thread the site never started and therefore cannot
    // see. The sentence has to carry that, because the Reply-To cannot.
    `Cevabı okumak ve yanıtlamak için siteye gidin: ${link}`,
    '',
    'RSG Türkiye',
  ].join('\n');

  const raw = buildMime({
    fromAddress: env.RSG_MAIL_FROM,
    fromName: 'RSG Türkiye',
    to: row.owner_email,
    replyTo: env.RSG_MAIL_FROM,
    subject: `Yeni cevap: ${row.subject}`,
    body: renderBody(body),
    attachments: [],
  });

  // Deliberately not sendAndLog. That helper registers a thread and writes to
  // sent_emails, and neither is right here: registering would make the system
  // a correspondent of itself and start notifying about its own notifications,
  // and logging would bury members' real sends under machine mail.
  await sendMail(env, raw);

  await env.DB.prepare(
    'UPDATE mail_threads SET last_notified_at = ?, updated_at = ? WHERE id = ?'
  ).bind(now, now, threadId).run();

  return true;
}
```

- [ ] **Step 2: Record the thread id on every send**

In `functions/_lib/compose.ts`, add the import:

```ts
import { registerThread } from './conversations';
```

Change `insertLog` to take and store the thread id — replace its signature and statement with:

```ts
async function insertLog(
  env: Env,
  input: ComposeInput,
  recipient: string,
  gmailId: string | null,
  gmailThreadId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sent_emails
      (id, sender_user_id, recipient_email, recipient_name, subject, body_snapshot,
       attachment_ids, gmail_message_id, gmail_thread_id, status, error_message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(),
    input.senderUserId,
    recipient,
    input.recipients.length === 1 ? input.recipientName : null,
    input.subject,
    input.body,
    JSON.stringify(input.attachmentIds),
    gmailId,
    gmailThreadId,
    gmailId ? 'sent' : 'failed',
    errorMessage,
    Math.floor(Date.now() / 1000),
  ).run();
}
```

Update the call in `logFailure` to pass `null` for the new argument:

```ts
    await insertLog(env, input, recipient, null, null, reason);
```

- [ ] **Step 3: Register the thread inside the send loop**

In `sendAndLog`, after the existing `insertLog` try/catch block and before `results.push(...)`, add:

```ts
    // Registering gets its own try/catch for the same reason insertLog does:
    // a D1 failure here must not abort the recipients still waiting in this
    // loop. The cost of losing it is that this conversation never appears on
    // the site -- bad, but not as bad as silently skipping recipients.
    if (gmailId && gmailThreadId) {
      try {
        await registerThread(env, {
          threadId: gmailThreadId,
          senderUserId: input.senderUserId,
          recipientEmail: recipient,
          recipientName: input.recipients.length === 1 ? input.recipientName : null,
          subject: input.subject,
          sentAt: Math.floor(Date.now() / 1000),
        });
      } catch {
        logFailed = true;
      }
    }
```

and change the `insertLog` call inside the loop to pass the thread id:

```ts
      await insertLog(env, input, recipient, gmailId, gmailThreadId, errorMessage);
```

- [ ] **Step 4: Verify the type check passes**

Run: `npx astro check`
Expected: 0 errors. In particular `gmailThreadId`, declared in Task 2, is now read.

- [ ] **Step 5: Verify the whole suite still passes**

Run: `npm test`
Expected: all tests pass — nothing in the suite stubs D1, so this is a regression check on the modules Task 6 touched.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/conversations.ts functions/_lib/compose.ts
git commit -m "feat: register threads on send, ingest them from Gmail, notify the owner"
```

---

### Task 7: The sync endpoint

**Files:**
- Create: `functions/api/mail/sync.ts`
- Modify: `docs/superpowers/specs/2026-09-02-conversations-design.md` (record the cursor change described below)

**Interfaces:**
- Consumes: `ingestThread`, `notifyThreadOwner` from Task 6; `listHistory`, `getProfileHistoryId`, `GmailHistoryExpired` from Task 4.
- Produces: `runSync(env: Env, siteOrigin: string): Promise<Response>` — exported so Task 10's refresh endpoint reuses it rather than duplicating the algorithm.

#### Deviation from the spec: the backfill cursor is a thread id, not a timestamp

The spec walks the backfill with `WHERE last_message_at < :cursor ORDER BY last_message_at DESC`. That is wrong when two threads share a `last_message_at`: setting the cursor to the batch's last timestamp skips every other thread holding the same second, and those threads are never backfilled. Timestamps are epoch **seconds**, and a compose to several recipients registers all its threads inside the same second, so the collision is the normal case here, not a rare one.

Walking by primary key has no ties: `WHERE id > :cursor ORDER BY id ASC` visits every row exactly once. Order does not matter for a backfill — only completeness does. `backfill_cursor` therefore holds the last thread **id** processed, and the sentinel that starts a fresh backfill is the empty string, which sorts before every Gmail id.

Update the spec's "Backfill" paragraph and its `mail_sync_state` comment to match, and commit that change with this task.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/mail/sync.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { listHistory, getProfileHistoryId, GmailHistoryExpired } from '../../_lib/gmail-read';
import { ingestThread, notifyThreadOwner } from '../../_lib/conversations';

/**
 * Pull replies into the local cache.
 *
 * Driven by the Cloudflare cron Worker (workers/mail-cron) every five minutes
 * and by the conversations page on load. Secret-gated exactly like
 * /api/mail/dispatch: without that, anyone could burn the Gmail read quota.
 */

/** Threads per backfill invocation, chosen to stay inside the subrequest budget. */
const BACKFILL_BATCH = 15;

/** Sorts before every Gmail id, so a fresh backfill starts at the first row. */
const BACKFILL_START = '';

/** SQLite caps bound parameters per statement; chunk the id lookup well under it. */
const ID_CHUNK = 100;

interface SyncState {
  history_id: string | null;
  last_synced_at: number | null;
  backfill_cursor: string | null;
}

interface IngestSummary {
  ingested: number;
  notified: number;
  failed: number;
  firstError: string | null;
}

async function knownThreadIds(env: Env, ids: string[]): Promise<string[]> {
  const known: string[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id FROM mail_threads WHERE id IN (${placeholders})`
    ).bind(...chunk).all<{ id: string }>();
    for (const row of rows.results) known.push(row.id);
  }
  return known;
}

async function ingestAll(
  env: Env,
  threadIds: string[],
  siteOrigin: string,
  now: number,
): Promise<IngestSummary> {
  const summary: IngestSummary = { ingested: 0, notified: 0, failed: 0, firstError: null };

  for (const threadId of threadIds) {
    try {
      const result = await ingestThread(env, threadId, now);
      summary.ingested += 1;

      if (result.newInbound > 0) {
        // A failed notification must not discard the ingest that already
        // succeeded. The messages are stored either way; the member finds them
        // on the page, and the next reply notifies.
        try {
          if (await notifyThreadOwner(env, threadId, siteOrigin, now)) summary.notified += 1;
        } catch (err) {
          summary.failed += 1;
          summary.firstError ??= `notify ${threadId}: ${String(err).slice(0, 200)}`;
        }
      }
    } catch (err) {
      // One unreadable thread must not stop the rest of the batch. Counted and
      // reported rather than swallowed, so a systematic failure is visible in
      // the Worker log instead of looking like a quiet no-op.
      summary.failed += 1;
      summary.firstError ??= `ingest ${threadId}: ${String(err).slice(0, 200)}`;
    }
  }

  return summary;
}

async function runBackfillBatch(
  env: Env,
  cursor: string,
  siteOrigin: string,
  now: number,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id FROM mail_threads WHERE id > ? ORDER BY id ASC LIMIT ?`
  ).bind(cursor, BACKFILL_BATCH).all<{ id: string }>();

  if (rows.results.length === 0) {
    const historyId = await getProfileHistoryId(env);
    await env.DB.prepare(
      'UPDATE mail_sync_state SET history_id = ?, backfill_cursor = NULL, last_synced_at = ? WHERE id = 1'
    ).bind(historyId, now).run();
    return jsonResponse({ ok: true, backfillComplete: true, historyId });
  }

  const ids = rows.results.map((row) => row.id);
  const summary = await ingestAll(env, ids, siteOrigin, now);
  const nextCursor = ids[ids.length - 1];

  await env.DB.prepare(
    'UPDATE mail_sync_state SET backfill_cursor = ?, last_synced_at = ? WHERE id = 1'
  ).bind(nextCursor, now).run();

  return jsonResponse({ ok: true, backfill: true, ...summary, nextCursor });
}

export async function runSync(env: Env, siteOrigin: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);

  const state = await env.DB.prepare(
    'SELECT history_id, last_synced_at, backfill_cursor FROM mail_sync_state WHERE id = 1'
  ).first<SyncState>();

  if (!state) {
    return jsonResponse({ error: 'Sync state row is missing', code: 'no_sync_state' }, 500);
  }

  // `!== null`, not a truthiness test: the sentinel that starts a fresh
  // backfill is the empty string, and `if (state.backfill_cursor)` would skip
  // straight past it into a history walk, abandoning the backfill on its very
  // first tick.
  if (state.backfill_cursor !== null) {
    return runBackfillBatch(env, state.backfill_cursor, siteOrigin, now);
  }

  // First run ever: adopt Gmail's current cursor and stop. Walking backwards
  // from here would pull in the whole mailbox's history, which is precisely
  // what this feature promises not to do.
  if (!state.history_id) {
    const historyId = await getProfileHistoryId(env);
    await env.DB.prepare(
      'UPDATE mail_sync_state SET history_id = ?, last_synced_at = ? WHERE id = 1'
    ).bind(historyId, now).run();
    return jsonResponse({ ok: true, initialised: true, historyId });
  }

  let threadIds: string[];
  let historyId: string;
  try {
    const result = await listHistory(env, state.history_id);
    threadIds = result.threadIds;
    historyId = result.historyId;
  } catch (err) {
    if (err instanceof GmailHistoryExpired) {
      await env.DB.prepare(
        'UPDATE mail_sync_state SET backfill_cursor = ?, last_synced_at = ? WHERE id = 1'
      ).bind(BACKFILL_START, now).run();
      return jsonResponse({ ok: true, backfillStarted: true, reason: err.message });
    }
    throw err;
  }

  // The filter that makes the scope promise real: Gmail told us about every
  // thread that changed, and only the ones the site started survive this line.
  const known = await knownThreadIds(env, threadIds);
  const summary = await ingestAll(env, known, siteOrigin, now);

  await env.DB.prepare(
    'UPDATE mail_sync_state SET history_id = ?, last_synced_at = ? WHERE id = 1'
  ).bind(historyId, now).run();

  return jsonResponse({ ok: true, seen: threadIds.length, known: known.length, ...summary, historyId });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  return runSync(env, new URL(request.url).origin);
};
```

- [ ] **Step 2: Update the spec's backfill description**

In `docs/superpowers/specs/2026-09-02-conversations-design.md`, replace the `backfill_cursor` column comment with:

```
  backfill_cursor TEXT      -- id of the last thread processed by a running
                            -- backfill; NULL when no backfill is in progress
```

replace the pseudocode line `state.backfill_cursor = '99999999999'   # sentinel: start from the newest thread` with:

```
    state.backfill_cursor = ''              # sentinel: sorts before every thread id
```

and replace the backfill batch SQL with:

```sql
SELECT id FROM mail_threads
 WHERE id > :backfill_cursor
 ORDER BY id ASC
 LIMIT 15
```

adding this sentence beneath it: "Walking by primary key rather than by timestamp is deliberate: epoch-second timestamps tie whenever one compose registers several threads, and a timestamp cursor silently skips every thread sharing the batch's last second."

- [ ] **Step 3: Verify the type check passes**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Verify the endpoint rejects an unauthenticated call**

Run: `npx wrangler pages dev --port 8788 -- npm run build` is not needed; instead confirm by reading that `onRequestPost` returns 403 before touching `env.DB` when `X-Dispatch-Secret` is absent, mirroring `functions/api/mail/dispatch.ts:29-33`.
Expected: the secret check is the first statement in the handler.

- [ ] **Step 5: Commit**

```bash
git add functions/api/mail/sync.ts docs/superpowers/specs/2026-09-02-conversations-design.md
git commit -m "feat: sync endpoint pulling replies for registered threads only"
```

---

### Task 8: Reading conversations

**Files:**
- Create: `functions/api/mail/conversations.ts`
- Create: `functions/api/mail/conversations/[id].ts`

**Interfaces:**
- Consumes: `snippet` from Task 5; `getSessionUser`, `jsonResponse` from `functions/_lib/auth.ts`.
- Produces: the two JSON shapes Task 11's page renders:
  - list: `{ threads: Array<{ id, recipient_email, recipient_name, subject, last_message_at, last_direction, unread, snippet, sender_email?, sender_name? }>, unreadCount: number, scope: 'own' | 'all', isAdmin: boolean }` — `isAdmin` is added in Task 12 step 1, which is where the page that needs it is written.
  - thread: `{ thread: { id, recipient_email, recipient_name, subject, sender_email }, messages: Array<{ id, direction, from_email, from_name, subject, body_text, attachment_count, sent_at }> }`

- [ ] **Step 1: Write the list endpoint**

Create `functions/api/mail/conversations.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';
import { snippet } from '../../_lib/conversations';

interface ThreadRow {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  last_message_at: number;
  last_direction: string;
  unread: number;
  last_body: string | null;
  sender_email?: string;
  sender_name?: string | null;
}

function present(rows: ThreadRow[]) {
  return rows.map(({ last_body, ...rest }) => ({
    ...rest,
    snippet: snippet(last_body ?? ''),
  }));
}

// The newest message's text, for the list preview. A correlated subquery keeps
// this to one round trip; joining mail_messages and filtering afterwards would
// pull every message of every thread across the wire to show 140 characters.
const LAST_BODY = `(SELECT m.body_text FROM mail_messages m
                     WHERE m.thread_id = t.id
                     ORDER BY m.sent_at DESC, m.id DESC LIMIT 1) AS last_body`;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('scope') === 'all' && user.is_admin === 1;

  // The account page wants only the badge number; sending it 300 threads to
  // count them client-side would make every profile view expensive.
  if (url.searchParams.get('only') === 'count') {
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM mail_threads WHERE sender_user_id = ? AND unread = 1'
    ).bind(user.id).first<{ n: number }>();
    return jsonResponse({ unreadCount: row?.n ?? 0 });
  }

  const rows = wantsAll
    ? await env.DB.prepare(
        `SELECT t.id, t.recipient_email, t.recipient_name, t.subject,
                t.last_message_at, t.last_direction, t.unread,
                u.email AS sender_email, p.display_name AS sender_name,
                ${LAST_BODY}
         FROM mail_threads t
         JOIN users u ON u.id = t.sender_user_id
         LEFT JOIN profiles p ON p.user_id = t.sender_user_id
         ORDER BY t.last_message_at DESC
         LIMIT 300`
      ).all<ThreadRow>()
    : await env.DB.prepare(
        `SELECT t.id, t.recipient_email, t.recipient_name, t.subject,
                t.last_message_at, t.last_direction, t.unread,
                ${LAST_BODY}
         FROM mail_threads t
         WHERE t.sender_user_id = ?
         ORDER BY t.last_message_at DESC
         LIMIT 300`
      ).bind(user.id).all<ThreadRow>();

  const unread = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM mail_threads WHERE sender_user_id = ? AND unread = 1'
  ).bind(user.id).first<{ n: number }>();

  return jsonResponse({
    threads: present(rows.results),
    // Always the caller's own unread count, even in the admin-wide view: it is
    // the number on their own badge, and it should not change meaning because
    // they toggled a filter.
    unreadCount: unread?.n ?? 0,
    scope: wantsAll ? 'all' : 'own',
  });
};
```

- [ ] **Step 2: Write the single-thread endpoint**

Create `functions/api/mail/conversations/[id].ts`:

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== 'string' || id === '') {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  const isAdmin = user.is_admin === 1;

  // Ownership lives in the predicate: an admin's query has no owner clause, a
  // member's does. Knowing a thread id is never authorisation on its own.
  const thread = isAdmin
    ? await env.DB.prepare(
        `SELECT t.id, t.sender_user_id, t.recipient_email, t.recipient_name, t.subject,
                u.email AS sender_email
         FROM mail_threads t JOIN users u ON u.id = t.sender_user_id
         WHERE t.id = ?`
      ).bind(id).first<ThreadRecord>()
    : await env.DB.prepare(
        `SELECT t.id, t.sender_user_id, t.recipient_email, t.recipient_name, t.subject,
                u.email AS sender_email
         FROM mail_threads t JOIN users u ON u.id = t.sender_user_id
         WHERE t.id = ? AND t.sender_user_id = ?`
      ).bind(id, user.id).first<ThreadRecord>();

  if (!thread) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const messages = await env.DB.prepare(
    `SELECT id, direction, from_email, from_name, subject, body_text,
            attachment_count, sent_at
     FROM mail_messages
     WHERE thread_id = ?
     ORDER BY sent_at ASC, id ASC`
  ).bind(id).all();

  // Only the owner opening their own thread clears the flag. An admin reading
  // it must not mark it read for the member who has not seen it yet.
  if (thread.sender_user_id === user.id) {
    await env.DB.prepare(
      'UPDATE mail_threads SET unread = 0, updated_at = ? WHERE id = ? AND sender_user_id = ?'
    ).bind(Math.floor(Date.now() / 1000), id, user.id).run();
  }

  return jsonResponse({
    thread: {
      id: thread.id,
      recipient_email: thread.recipient_email,
      recipient_name: thread.recipient_name,
      subject: thread.subject,
      sender_email: thread.sender_email,
      can_reply: thread.sender_user_id === user.id,
    },
    messages: messages.results,
  });
};

interface ThreadRecord {
  id: string;
  sender_user_id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  sender_email: string;
}
```

- [ ] **Step 3: Verify the type check passes**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add functions/api/mail/conversations.ts functions/api/mail/conversations/
git commit -m "feat: endpoints for the conversation list and a single thread"
```

---

### Task 9: Replying into a thread

**Files:**
- Create: `functions/api/mail/conversations/[id]/reply.ts`

**Interfaces:**
- Consumes: `replySubject`, `buildReferences`, `ingestThread` from Tasks 5-6; `sendAndLog`, `type ComposeInput` from `functions/_lib/compose.ts`; `checkRateLimit`, `MAX_BODY_LENGTH` from `functions/_lib/mail.ts`; `checkCsrf` from `functions/_lib/auth.ts`.
- Produces: `POST /api/mail/conversations/:id/reply` returning `{ ok: true, results: RecipientResult[] }`.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/mail/conversations/[id]/reply.ts`:

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../../_lib/auth';
import { checkRateLimit, MAX_BODY_LENGTH } from '../../../../_lib/mail';
import { sendAndLog, type ComposeInput } from '../../../../_lib/compose';
import { replySubject, buildReferences, ingestThread } from '../../../../_lib/conversations';

interface ThreadRecord {
  id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  if (typeof id !== 'string' || id === '') {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const input = parsed as Record<string, unknown>;
  if (typeof input.body !== 'string') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  const body = input.body.trim();
  if (body === '') return jsonResponse({ error: 'Invalid compose', code: 'empty_body' }, 400);
  if (body.length > MAX_BODY_LENGTH) {
    return jsonResponse({ error: 'Invalid compose', code: 'body_too_long' }, 400);
  }

  // Only the member who owns the conversation may answer in it. An admin can
  // read every thread, but writing as someone else's correspondent would make
  // the audit log say something untrue about who spoke.
  const thread = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, subject
     FROM mail_threads WHERE id = ? AND sender_user_id = ?`
  ).bind(id, user.id).first<ThreadRecord>();

  if (!thread) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  const limit = await checkRateLimit(env.DB, user.id, 1, now);
  if (!limit.ok) return jsonResponse({ error: 'Rate limit exceeded', code: limit.code }, 429);

  const history = await env.DB.prepare(
    `SELECT rfc822_message_id, direction FROM mail_messages
     WHERE thread_id = ? ORDER BY sent_at ASC, id ASC`
  ).bind(id).all<{ rfc822_message_id: string | null; direction: string }>();

  const references = buildReferences(history.results.map((row) => row.rfc822_message_id));
  // Reply to the newest message in the thread, whichever side sent it: that is
  // what a mail client does, and it keeps the chain intact when the last word
  // was ours.
  const inReplyTo = references.length > 0 ? references[references.length - 1] : undefined;

  const composeInput: ComposeInput = {
    senderUserId: user.id,
    recipients: [thread.recipient_email],
    recipientName: thread.recipient_name,
    subject: replySubject(thread.subject),
    body,
    attachmentIds: [],
    threadId: thread.id,
    inReplyTo,
    references,
  };

  const results = await sendAndLog(env, composeInput, []);

  // Re-read the thread so the member sees their reply immediately instead of
  // waiting for the next cron tick. Failing here costs nothing permanent: the
  // mail is sent and the next sync fills the gap.
  try {
    await ingestThread(env, thread.id, Math.floor(Date.now() / 1000));
  } catch {
    // Deliberately ignored -- see above.
  }

  const anySent = results.some((r) => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
```

- [ ] **Step 2: Pass the threading fields through `compose.ts`**

`ComposeInput` gained `threadId` in Task 2. Add the two remaining fields to the interface in `functions/_lib/compose.ts`:

```ts
  /** Set only for a reply; see functions/_lib/conversations.ts. */
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
```

and pass them into `buildMime` inside `sendAndLog`:

```ts
        subject: input.subject,
        body: renderBody(input.body),
        attachments,
        inReplyTo: input.inReplyTo,
        references: input.references,
```

- [ ] **Step 3: Verify the type check and the suite**

Run: `npm test && npx astro check`
Expected: all tests pass; 0 type errors.

- [ ] **Step 4: Commit**

```bash
git add functions/api/mail/conversations functions/_lib/compose.ts
git commit -m "feat: reply into a conversation from the site"
```

---

### Task 10: Rendering inbound text safely

**Files:**
- Modify: `functions/_lib/markdown.ts` (append one export)
- Modify: `functions/api/mail/conversations/[id].ts` (return rendered HTML per message)
- Test: `tests/markdown.test.ts` (append)

**Interfaces:**
- Consumes: the private `stripControls`, `escapeHtml`, `BARE_URL`, `PLACEHOLDER` already in `functions/_lib/markdown.ts`.
- Produces:
  - `renderPlainWithLinks(text: string): string`
  - the thread endpoint's `messages[]` entries gain `body_html: string`. Task 12's page renders that field and never `body_text`.

Rendering happens on the server, not in the page, for two reasons: the page is static, so it has no way to reach a tested renderer; and the renderer whose safety argument has already been reviewed lives here.

- [ ] **Step 1: Write the failing tests**

Append to `tests/markdown.test.ts` (add `renderPlainWithLinks` to the existing import from `../functions/_lib/markdown`):

```ts
test('renderPlainWithLinks escapes markup a correspondent sent', () => {
  const html = renderPlainWithLinks('<script>alert(1)</script> & "quoted"');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;quoted&quot;'));
});

test('renderPlainWithLinks turns a bare URL into a link', () => {
  const html = renderPlainWithLinks('See https://rsg-turkiye.iscbsc.org for details');
  assert.ok(html.includes('<a href="https://rsg-turkiye.iscbsc.org"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('target="_blank"'));
});

test('renderPlainWithLinks does not linkify a non-http scheme', () => {
  const html = renderPlainWithLinks('javascript:alert(1) and file:///etc/passwd');
  assert.ok(!html.includes('<a '));
});

test('renderPlainWithLinks leaves Markdown syntax literal', () => {
  const html = renderPlainWithLinks('**not bold** and [not a link](https://x.example)');
  assert.ok(!html.includes('<strong>'));
  assert.ok(html.includes('**not bold**'));
  // The bare URL inside the parentheses still becomes a link, but the label
  // syntax around it stays visible exactly as the correspondent typed it.
  assert.ok(html.includes('[not a link]('));
});

test('renderPlainWithLinks does not turn dashes into a list', () => {
  const html = renderPlainWithLinks('- one\n- two');
  assert.ok(!html.includes('<ul>'));
  assert.ok(html.includes('- one<br>- two'));
});

test('renderPlainWithLinks keeps paragraphs and line breaks', () => {
  assert.equal(renderPlainWithLinks('a\nb\n\nc'), '<p>a<br>b</p><p>c</p>');
});

test('renderPlainWithLinks on empty input returns an empty string', () => {
  assert.equal(renderPlainWithLinks(''), '');
  assert.equal(renderPlainWithLinks('   \n\n  '), '');
});

test('renderPlainWithLinks strips a forged anchor placeholder', () => {
  // A correspondent who knows how this renderer works cannot borrow its
  // internal marker: control characters are stripped before anything runs.
  const forged = 'x \u00000\u0000 https://a.example';
  const html = renderPlainWithLinks(forged);
  assert.ok(!html.includes('\u0000'));
  assert.ok(html.includes('<a href="https://a.example"'));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx tsx --test tests/markdown.test.ts`
Expected: FAIL — `renderPlainWithLinks` is not exported.

- [ ] **Step 3: Add the renderer**

Append to `functions/_lib/markdown.ts`:

```ts
/**
 * Inbound mail, rendered for the conversations page.
 *
 * Not renderBody: that one applies Markdown semantics, and a correspondent did
 * not write Markdown. Their literal asterisks would silently become emphasis
 * and their leading dashes a bullet list -- a quiet misquotation of someone
 * else's words.
 *
 * Same safety argument as the rest of this module: escape every character
 * first, then insert only the tags this function produced, with hrefs that had
 * to match the https?:// allowlist to get there.
 */
export function renderPlainWithLinks(text: string): string {
  let s = escapeHtml(stripControls(text));

  const anchors: string[] = [];
  const park = (html: string) => {
    anchors.push(html);
    return '\u0000' + (anchors.length - 1) + '\u0000';
  };

  s = s.replace(BARE_URL, (_m, lead: string, url: string) =>
    lead + park('<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + url + '</a>'));

  const blocks = s.split(/\n{2,}/).filter(block => block.trim() !== '');
  s = blocks.map(block => '<p>' + block.split('\n').join('<br>') + '</p>').join('');

  return s.replace(PLACEHOLDER, (_m, i: string) => anchors[Number(i)]);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx tsx --test tests/markdown.test.ts`
Expected: PASS, all cases including the ones that were already there.

- [ ] **Step 5: Return rendered HTML from the thread endpoint**

In `functions/api/mail/conversations/[id].ts`, add the import:

```ts
import { renderPlainWithLinks } from '../../../_lib/markdown';
```

Declare the row type beside the existing `ThreadRecord`:

```ts
interface MessageRow {
  id: string;
  direction: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  body_text: string;
  attachment_count: number;
  sent_at: number;
}
```

Type the message query as `.all<MessageRow>()`, then build the response list:

```ts
  const rendered = messages.results.map(({ body_text, ...rest }) => ({
    ...rest,
    body_html: renderPlainWithLinks(body_text),
  }));
```

and return `messages: rendered`. `body_text` is deliberately dropped from the response: the page has no use for it, and not shipping it removes any chance of a later edit rendering the raw text by mistake.

- [ ] **Step 6: Verify the type check and the suite**

Run: `npm test && npx astro check`
Expected: all tests pass; 0 type errors.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/markdown.ts functions/api/mail/conversations tests/markdown.test.ts
git commit -m "feat: render inbound mail as escaped text with clickable links"
```

---

### Task 11: Scheduling the sync and the page-driven refresh

**Files:**
- Create: `functions/api/mail/refresh.ts`
- Modify: `workers/mail-cron/src/index.ts`
- Modify: `workers/mail-cron/wrangler.toml`

**Interfaces:**
- Consumes: `runSync` from Task 7.
- Produces: `POST /api/mail/refresh` returning either `runSync`'s body or `{ ok: true, skipped: true, retryAfter: number }`. Task 12's page calls this on load and from its refresh button.

- [ ] **Step 1: Write the refresh endpoint**

Create `functions/api/mail/refresh.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { runSync } from './sync';

/**
 * The page-driven half of the sync.
 *
 * The cron Worker runs every five minutes; this is what makes opening the page
 * feel immediate. It is throttled globally rather than per member, because the
 * thing being protected is one shared Gmail quota, not one member's patience.
 */
const MIN_REFRESH_SECONDS = 60;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);
  const state = await env.DB.prepare(
    'SELECT last_synced_at FROM mail_sync_state WHERE id = 1'
  ).first<{ last_synced_at: number | null }>();

  const last = state?.last_synced_at ?? null;
  if (last !== null && now - last < MIN_REFRESH_SECONDS) {
    // Two members opening the page in the same minute is the normal case, not
    // an abuse to punish: answer 200 and let them read the cache.
    return jsonResponse({ ok: true, skipped: true, retryAfter: MIN_REFRESH_SECONDS - (now - last) });
  }

  return runSync(env, new URL(request.url).origin);
};
```

- [ ] **Step 2: Make the cron Worker call the sync too**

Replace the whole of `workers/mail-cron/src/index.ts` with:

```ts
export interface Env {
  /** Same value as the Pages project's MAIL_SYNC_SECRET. */
  MAIL_SYNC_SECRET: string;
  DISPATCH_URL: string;
  SYNC_URL: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },

  /**
   * A plain GET returns the same call's result, so the schedule can be tested
   * by hand without waiting for a tick. It carries no secret of its own -- it
   * simply forwards the one this Worker holds, exactly as the cron does.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await tick(env);
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
  },
};

async function tick(env: Env): Promise<{ dispatch: string; sync: string }> {
  // Dispatch first: a message queued for this minute should go out before the
  // sync spends the tick's budget reading replies. Sequential rather than
  // raced, so one failing does not cancel the other's logging.
  const dispatch = await call(env, 'dispatch', env.DISPATCH_URL);
  const sync = await call(env, 'sync', env.SYNC_URL);

  // Throw only after both have run: a scheduled Worker's single failure signal
  // is the invocation status, and throwing earlier would have skipped the
  // second call entirely.
  if (dispatch.startsWith('ERROR') || sync.startsWith('ERROR')) {
    throw new Error(`tick failed -- dispatch: ${dispatch.slice(0, 120)} sync: ${sync.slice(0, 120)}`);
  }

  return { dispatch, sync };
}

async function call(env: Env, label: string, url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Dispatch-Secret': env.MAIL_SYNC_SECRET },
    });
    const body = await res.text();

    // Log both ways: a silent scheduler is the failure mode this Worker exists
    // to end, so a bad secret or a 500 must be visible in `wrangler tail`.
    console.log(`${label} ${res.status}: ${body.slice(0, 300)}`);
    return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
  } catch (err) {
    console.log(`${label} threw: ${String(err).slice(0, 300)}`);
    return `ERROR: ${String(err).slice(0, 200)}`;
  }
}
```

- [ ] **Step 3: Add the sync URL to the Worker's configuration**

In `workers/mail-cron/wrangler.toml`, add to the existing `[vars]` block:

```toml
SYNC_URL = "https://rsg-turkiye.iscbsc.org/api/mail/sync"
```

- [ ] **Step 4: Verify the Worker builds**

Run: `cd workers/mail-cron && npx wrangler deploy --dry-run; cd -`
Expected: the dry run reports the bundled Worker size with no errors. It does not deploy.

- [ ] **Step 5: Verify the site type check and suite**

Run: `npm test && npx astro check`
Expected: all tests pass; 0 type errors.

- [ ] **Step 6: Commit**

```bash
git add functions/api/mail/refresh.ts workers/mail-cron/src/index.ts workers/mail-cron/wrangler.toml
git commit -m "feat: run the reply sync from the cron Worker and on page load"
```

---

### Task 12: The conversations page

**Files:**
- Modify: `functions/api/mail/conversations.ts` (one field)
- Create: `src/pages/account/conversations.astro`
- Create: `src/pages/tr/account/conversations.astro`

**Interfaces:**
- Consumes: the endpoints from Tasks 8-11; `formatIstanbul` from `src/lib/istanbul-time.ts`.
- Produces: the pages `/account/conversations` and `/tr/account/conversations`, which Task 13 links to.

- [ ] **Step 1: Tell the page whether the caller is an admin**

The page needs this to decide whether to show the "all conversations" toggle, and it must not be inferred from a probe request. In `functions/api/mail/conversations.ts`, add `isAdmin: user.is_admin === 1,` to the object returned by the main `jsonResponse` (the list branch, not the `only=count` branch).

- [ ] **Step 2: Create the English page**

Create `src/pages/account/conversations.astro`:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---

<BaseLayout
  pageTitle="Conversations — RSG Turkiye"
  description="Replies to mail sent from the RSG Turkiye address."
  translationUrl="/tr/account/conversations"
>
  <div class="min-h-screen bg-[#F7F7F6] py-12 px-4">
    <div class="max-w-5xl mx-auto">

      <div id="loadingState" class="flex items-center justify-center py-24">
        <div class="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin"></div>
      </div>

      <div id="notAllowed" class="hidden text-center py-24">
        <p class="text-gray-500 mb-4">You are not authorised to see RSG conversations.</p>
        <a href="/account" class="text-navy-mid hover:underline text-sm">Back to my profile</a>
      </div>

      <div id="content" class="hidden flex flex-col gap-4">
        <div class="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 class="text-xl font-bold text-navy">Conversations</h1>
            <p class="text-sm text-gray-500 mt-1">
              Replies to mail you sent as RSG. Only threads started from this site appear here.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <label id="scopeWrap" class="hidden items-center gap-2 text-xs text-gray-500">
              <input id="scopeAll" type="checkbox" class="rounded border-border" />
              All members
            </label>
            <button type="button" id="refreshBtn"
              class="px-4 py-2 rounded-xl border border-border bg-white text-navy text-sm font-medium hover:border-navy-mid transition-colors">
              Refresh
            </button>
            <a href="/account/mail" class="text-sm text-navy-mid hover:underline">Compose</a>
          </div>
        </div>

        <div class="grid md:grid-cols-[320px_1fr] gap-4 items-start">
          <div class="bg-white rounded-2xl border border-border shadow-sm p-3">
            <div id="threadList" class="flex flex-col gap-1"></div>
            <p id="threadsEmpty" class="hidden text-sm text-gray-400 px-2 py-4">
              No replies yet.
            </p>
          </div>

          <div class="bg-[#F0F0EE] rounded-2xl border border-border p-4 min-h-[420px]">
            <p id="threadEmpty" class="text-sm text-gray-400 text-center py-24">
              Select a conversation to read it.
            </p>

            <div id="threadView" class="hidden flex flex-col gap-4">
              <div class="border-b border-border pb-3">
                <h2 id="threadSubject" class="text-sm font-semibold text-navy"></h2>
                <p id="threadWith" class="text-xs text-gray-500 mt-0.5"></p>
              </div>

              <div id="messageList" class="flex flex-col gap-3"></div>

              <p id="replyBlocked" class="hidden text-xs text-gray-500 border-t border-border pt-3">
                You are reading this as an admin. Only the member who started the conversation can reply.
              </p>

              <form id="replyForm" class="hidden border-t border-border pt-3 flex flex-col gap-2">
                <textarea id="replyBody" rows="5" required maxlength="20000"
                  placeholder="Write your reply"
                  class="px-3 py-2 rounded-xl border border-border text-sm text-navy bg-white focus:outline-none focus:border-navy-mid"></textarea>
                <p class="text-xs text-gray-400 -mt-1">
                  Sent from the RSG address. Sign off with your name so the recipient knows who answered.
                </p>
                <div class="flex items-center gap-3">
                  <button type="submit" id="replyBtn"
                    class="px-5 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors disabled:opacity-50">
                    Reply
                  </button>
                  <span id="replyStatus" class="text-xs text-gray-400"></span>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>

      <div id="toast" class="hidden fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50"></div>
    </div>
  </div>
</BaseLayout>

<style is:global>
  /* Message bodies are injected as HTML, so scoped styles would not reach them. */
  .mail-body a { text-decoration: underline; }
  .mail-body p { margin: 0 0 0.5rem; }
  .mail-body p:last-child { margin-bottom: 0; }
</style>

<script>
  import { formatIstanbul } from '../../lib/istanbul-time';

  interface ThreadSummary {
    id: string;
    recipient_email: string;
    recipient_name: string | null;
    subject: string;
    last_message_at: number;
    last_direction: string;
    unread: number;
    snippet: string;
    sender_email?: string;
    sender_name?: string | null;
  }

  interface Message {
    id: string;
    direction: string;
    from_email: string;
    from_name: string | null;
    body_html: string;
    attachment_count: number;
    sent_at: number;
  }

  const ERRORS: Record<string, string> = {
    empty_body: 'Write something before sending.',
    body_too_long: 'The reply is too long (max 20000 characters).',
    not_found: 'This conversation is no longer available.',
    rate_limit_hour: 'You have reached the hourly send limit (20). Try again later.',
    rate_limit_day: 'You have reached the daily send limit (100).',
    rate_limit_global: 'RSG has reached its daily send limit (300). Try again tomorrow.',
    forbidden: 'You are not allowed to do that.',
  };

  let scopeAll = false;
  let currentThreadId: string | null = null;

  function escapeHtml(s: unknown): string {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  function formatDate(ts: number) {
    return formatIstanbul(ts, 'en-GB');
  }

  function showToast(message: string, isError = false) {
    const toast = document.getElementById('toast')!;
    toast.textContent = message;
    toast.className = `fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50 ${
      isError ? 'bg-red-500' : 'bg-navy'
    }`;
    setTimeout(() => toast.classList.add('hidden'), 6000);
  }

  /** Ask the server to look for new mail. Best-effort: the cron does this too. */
  async function refresh(): Promise<void> {
    try {
      await fetch('/api/mail/refresh', { method: 'POST' });
    } catch {
      // Not worth a message. The list below still renders what is cached, and
      // the cron Worker keeps that cache moving regardless of this page.
    }
  }

  async function loadThreads(): Promise<boolean> {
    const res = await fetch(scopeAll ? '/api/mail/conversations?scope=all' : '/api/mail/conversations');

    if (res.status === 401) {
      window.location.href = '/account';
      return false;
    }
    if (res.status === 403) {
      document.getElementById('notAllowed')!.classList.remove('hidden');
      return false;
    }
    if (!res.ok) {
      showToast('Conversations could not be loaded.', true);
      return false;
    }

    const data: any = await res.json();
    document.getElementById('content')!.classList.remove('hidden');
    document.getElementById('scopeWrap')!.classList.toggle('hidden', data.isAdmin !== true);
    if (data.isAdmin === true) document.getElementById('scopeWrap')!.classList.add('flex');

    renderThreads(data.threads as ThreadSummary[]);
    return true;
  }

  function renderThreads(threads: ThreadSummary[]) {
    const list = document.getElementById('threadList')!;
    const empty = document.getElementById('threadsEmpty')!;

    if (threads.length === 0) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    list.innerHTML = threads.map(t => `
      <button type="button" data-thread="${escapeHtml(t.id)}"
        class="thread-item w-full text-left px-3 py-2 rounded-xl border transition-colors ${
          t.id === currentThreadId ? 'border-navy bg-[#F7F7F6]' : 'border-transparent hover:bg-[#F7F7F6]'
        }">
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm truncate ${t.unread ? 'font-bold text-navy' : 'text-navy'}">${
            escapeHtml(t.recipient_name || t.recipient_email)
          }</span>
          <span class="text-[11px] text-gray-400 shrink-0">${formatDate(t.last_message_at)}</span>
        </div>
        <div class="text-xs truncate ${t.unread ? 'font-semibold text-navy' : 'text-gray-500'}">${escapeHtml(t.subject)}</div>
        <div class="text-xs text-gray-400 truncate">${t.last_direction === 'out' ? '&uarr; ' : '&darr; '}${escapeHtml(t.snippet)}</div>
        ${t.sender_email ? `<div class="text-[11px] text-gray-400 mt-1">${escapeHtml(t.sender_name || t.sender_email)}</div>` : ''}
      </button>`).join('');

    list.querySelectorAll<HTMLElement>('.thread-item').forEach(el => {
      el.addEventListener('click', () => { void openThread(el.dataset.thread!); });
    });
  }

  async function openThread(id: string): Promise<void> {
    const path = `/api/mail/conversations/${encodeURIComponent(id)}`;
    const res = await fetch(scopeAll ? `${path}?scope=all` : path);
    if (!res.ok) {
      showToast('The conversation could not be opened.', true);
      return;
    }

    const data: any = await res.json();
    currentThreadId = id;
    renderThread(data.thread, data.messages as Message[]);

    // Opening cleared the unread flag server-side; reload so the list stops
    // showing this thread in bold.
    await loadThreads();
  }

  function renderThread(thread: any, messages: Message[]) {
    document.getElementById('threadEmpty')!.classList.add('hidden');
    document.getElementById('threadView')!.classList.remove('hidden');

    document.getElementById('threadSubject')!.textContent = thread.subject;
    document.getElementById('threadWith')!.textContent = thread.recipient_name
      ? `${thread.recipient_name} <${thread.recipient_email}>`
      : thread.recipient_email;

    document.getElementById('messageList')!.innerHTML = messages.map(m => `
      <div class="flex ${m.direction === 'out' ? 'justify-end' : 'justify-start'}">
        <div class="max-w-[85%] rounded-2xl px-4 py-3 ${
          m.direction === 'out' ? 'bg-navy text-white' : 'bg-white border border-border text-navy'
        }">
          <div class="text-[11px] mb-1 ${m.direction === 'out' ? 'text-white/70' : 'text-gray-400'}">
            ${escapeHtml(m.direction === 'out' ? 'RSG Türkiye' : (m.from_name || m.from_email))}
            &middot; ${formatDate(m.sent_at)}
          </div>
          <!-- body_html is produced by renderPlainWithLinks on the server: the
               correspondent's text is escaped there and only tags that
               function emitted survive. It is the one field on this page that
               must not be escaped again, and the only one inserted as HTML. -->
          <div class="mail-body text-sm leading-relaxed">${m.body_html}</div>
          ${m.attachment_count > 0 ? `<div class="text-[11px] mt-2 ${
            m.direction === 'out' ? 'text-white/70' : 'text-gray-400'
          }">${m.attachment_count} attachment(s) &mdash; open the RSG mailbox in Gmail to download.</div>` : ''}
        </div>
      </div>`).join('');

    const canReply = thread.can_reply === true;
    document.getElementById('replyForm')!.classList.toggle('hidden', !canReply);
    document.getElementById('replyBlocked')!.classList.toggle('hidden', canReply);
    (document.getElementById('replyBody') as HTMLTextAreaElement).value = '';
  }

  async function submitReply(event: Event): Promise<void> {
    event.preventDefault();
    if (!currentThreadId) return;

    const textarea = document.getElementById('replyBody') as HTMLTextAreaElement;
    const button = document.getElementById('replyBtn') as HTMLButtonElement;
    const status = document.getElementById('replyStatus')!;
    const body = textarea.value.trim();
    if (body === '') return;

    button.disabled = true;
    status.textContent = 'Sending…';

    try {
      const res = await fetch(`/api/mail/conversations/${encodeURIComponent(currentThreadId)}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      const data: any = await res.json().catch(() => null);

      if (!res.ok || data?.ok !== true) {
        showToast(ERRORS[data?.code] ?? 'The reply could not be sent.', true);
        return;
      }

      // Clear the box only once the reply has definitely gone. The member's
      // words exist nowhere else, so emptying it on a failed send would
      // destroy the only copy.
      textarea.value = '';
      showToast('Reply sent.');
      await openThread(currentThreadId);
    } catch {
      showToast('The reply could not be sent.', true);
    } finally {
      button.disabled = false;
      status.textContent = '';
    }
  }

  async function init(): Promise<void> {
    document.getElementById('replyForm')!.addEventListener('submit', e => { void submitReply(e); });

    document.getElementById('refreshBtn')!.addEventListener('click', async () => {
      await refresh();
      await loadThreads();
      if (currentThreadId) await openThread(currentThreadId);
    });

    document.getElementById('scopeAll')!.addEventListener('change', async event => {
      scopeAll = (event.target as HTMLInputElement).checked;
      currentThreadId = null;
      document.getElementById('threadView')!.classList.add('hidden');
      document.getElementById('threadEmpty')!.classList.remove('hidden');
      await loadThreads();
    });

    // Render the cache first so the page is useful immediately, then go to
    // Gmail and render again. Refreshing before the first paint would make
    // every visit wait on a network round trip to Google.
    const allowed = await loadThreads();
    document.getElementById('loadingState')!.classList.add('hidden');
    if (!allowed) return;

    await refresh();
    await loadThreads();
  }

  document.addEventListener('DOMContentLoaded', () => { void init(); });
</script>
```

- [ ] **Step 3: Create the Turkish page**

Copy `src/pages/account/conversations.astro` to `src/pages/tr/account/conversations.astro`, then make exactly these changes:

1. The layout import path gains one level: `import BaseLayout from '../../../layouts/BaseLayout.astro';`
2. The script import path gains one level: `import { formatIstanbul } from '../../../lib/istanbul-time';`
3. `formatDate` uses the Turkish locale: `return formatIstanbul(ts, 'tr-TR');`
4. The `<BaseLayout>` attributes become:
   ```
   pageTitle="Yazışmalar — RSG Türkiye"
   description="RSG Türkiye adresinden gönderilen e-postalara gelen cevaplar."
   translationUrl="/account/conversations"
   ```
5. Every link to `/account/mail` becomes `/tr/account/mail`, and every link to `/account` becomes `/tr/account`.
6. Translate the visible strings exactly as follows:

| English | Turkish |
|---|---|
| You are not authorised to see RSG conversations. | RSG yazışmalarını görme yetkiniz yok. |
| Back to my profile | Profilime dön |
| Conversations | Yazışmalar |
| Replies to mail you sent as RSG. Only threads started from this site appear here. | RSG adına gönderdiğiniz e-postalara gelen cevaplar. Burada yalnızca bu siteden başlatılan yazışmalar görünür. |
| All members | Tüm üyeler |
| Refresh | Yenile |
| Compose | Yeni e-posta |
| No replies yet. | Henüz cevap yok. |
| Select a conversation to read it. | Okumak için bir yazışma seçin. |
| You are reading this as an admin. Only the member who started the conversation can reply. | Bunu yönetici olarak görüyorsunuz. Yalnızca yazışmayı başlatan üye cevap yazabilir. |
| Write your reply | Cevabınızı yazın |
| Sent from the RSG address. Sign off with your name so the recipient knows who answered. | RSG adresinden gönderilir. Alıcının kimin cevapladığını bilmesi için sonuna adınızı yazın. |
| Reply | Cevapla |
| Write something before sending. | Göndermeden önce bir şeyler yazın. |
| The reply is too long (max 20000 characters). | Cevap çok uzun (en fazla 20000 karakter). |
| This conversation is no longer available. | Bu yazışma artık mevcut değil. |
| You have reached the hourly send limit (20). Try again later. | Saatlik gönderim sınırına ulaştınız (20). Daha sonra tekrar deneyin. |
| You have reached the daily send limit (100). | Günlük gönderim sınırına ulaştınız (100). |
| RSG has reached its daily send limit (300). Try again tomorrow. | RSG günlük gönderim sınırına ulaştı (300). Yarın tekrar deneyin. |
| You are not allowed to do that. | Buna izniniz yok. |
| Conversations could not be loaded. | Yazışmalar yüklenemedi. |
| The conversation could not be opened. | Yazışma açılamadı. |
| The reply could not be sent. | Cevap gönderilemedi. |
| Reply sent. | Cevap gönderildi. |
| Sending… | Gönderiliyor… |
| attachment(s) — open the RSG mailbox in Gmail to download. | ek var — indirmek için RSG posta kutusunu Gmail'den açın. |

- [ ] **Step 4: Verify both pages build and type-check**

Run: `npx astro check && npm run build`
Expected: 0 type errors; the build emits both `/account/conversations` and `/tr/account/conversations`.

- [ ] **Step 5: Prove the new pages stay out of Google's index**

`src/lib/noindex-routes.ts` lists `/account` as a prefix, so both new pages are already excluded and no code change is needed. Pin that with a test rather than trusting it: in `tests/noindex-routes.test.ts`, add `'/account/conversations/'` to the first test's path list and `'/tr/account/conversations/'` to the second's.

Run: `npx tsx --test tests/noindex-routes.test.ts`
Expected: PASS. A future edit narrowing the prefix rule now fails here instead of quietly publishing members' correspondence to search engines.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account/conversations.astro src/pages/tr/account/conversations.astro functions/api/mail/conversations.ts
git commit -m "feat: the conversations page in both languages"
```

---

### Task 13: Entry points and setup documentation

**Files:**
- Modify: `src/pages/account/index.astro:86-93`, `src/pages/tr/account/index.astro` (the matching block)
- Modify: `src/pages/account/mail.astro`, `src/pages/tr/account/mail.astro`
- Modify: `README.md`
- Modify: `tests/noindex-routes.test.ts` (if Task 12 step 5 has not already done so)

**Interfaces:**
- Consumes: `GET /api/mail/conversations?only=count` from Task 8.
- Produces: nothing other tasks depend on. This is the last task.

- [ ] **Step 1: Add the Conversations card to the account page**

In `src/pages/account/index.astro`, immediately after the `senderCard` block that ends at line 93, add:

```astro
        <!-- Conversations (only for authorised senders) -->
        <div id="conversationsCard" class="hidden bg-white rounded-2xl border border-border shadow-sm p-6 flex items-start justify-between gap-4">
          <div>
            <h2 class="text-sm font-semibold text-navy mb-1">
              Conversations
              <span id="conversationsBadge" class="hidden ml-1 px-2 py-0.5 rounded-full bg-navy text-white text-[11px] align-middle"></span>
            </h2>
            <p class="text-sm text-gray-500">Replies to mail you sent as RSG.</p>
          </div>
          <a href="/account/conversations" class="shrink-0 px-4 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors">Open</a>
        </div>
```

In the same file's script, extend the existing `if (data.user.is_sender) { ... }` block at line 261 so it also reveals the new card and fills the badge:

```ts
      if (data.user.is_sender) {
        document.getElementById('senderCard')!.classList.remove('hidden');
        document.getElementById('conversationsCard')!.classList.remove('hidden');

        // Best-effort: a profile page that fails to load a badge is still a
        // working profile page, so this never blocks or reports.
        try {
          const res = await fetch('/api/mail/conversations?only=count');
          if (res.ok) {
            const counts: any = await res.json();
            if (counts.unreadCount > 0) {
              const badge = document.getElementById('conversationsBadge')!;
              badge.textContent = String(counts.unreadCount);
              badge.classList.remove('hidden');
            }
          }
        } catch {
          // Ignored on purpose -- see above.
        }
      }
```

If the enclosing function is not already `async`, make it so.

- [ ] **Step 2: Add the same card to the Turkish account page**

Make the identical change in `src/pages/tr/account/index.astro`, with the link pointing at `/tr/account/conversations` and these strings:

| English | Turkish |
|---|---|
| Conversations | Yazışmalar |
| Replies to mail you sent as RSG. | RSG adına gönderdiğiniz e-postalara gelen cevaplar. |
| Open | Aç |

- [ ] **Step 3: Link the two mail pages to their conversations page**

In `src/pages/account/mail.astro`, inside the header block that ends with the `<p class="text-sm text-gray-500 mt-1">` paragraph (around line 24-30), append after that paragraph:

```astro
          <a href="/account/conversations" class="text-sm text-navy-mid hover:underline">Conversations &rarr;</a>
```

Do the same in `src/pages/tr/account/mail.astro` with `href="/tr/account/conversations"` and the text `Yazışmalar &rarr;`.

- [ ] **Step 4: Document the setup in the README**

In `README.md`, inside the existing "Sending mail as RSG — required setup" section, append:

```markdown
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
```

- [ ] **Step 5: Verify the build, the suite and the type check**

Run: `npm test && npx astro check && npm run build`
Expected: all tests pass; 0 type errors; the build succeeds and emits `/account/conversations` and `/tr/account/conversations`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account src/pages/tr/account README.md tests/noindex-routes.test.ts
git commit -m "feat: link conversations from the account and mail pages, document the setup"
```

---

## After the plan

The feature cannot be tested end to end until the operator has done README steps 1-4: without the `gmail.readonly` scope on a freshly granted refresh token, `/api/mail/sync` returns a Gmail 403 and every conversation stays empty. Everything up to that point — sending, thread registration, the pages, the endpoints' authorisation — is testable without it.

Manual verification once the scope is in place:

1. Send a message to your own address from `/account/mail`. Confirm a row appears in `mail_threads` and that `sent_emails.gmail_thread_id` is populated.
2. Reply to it from that mailbox. Within five minutes the conversation shows the reply, the thread is bold in the list, and a notification arrives from RSG.
3. Reply from the site. Confirm the correspondent's client threads it under the original subject rather than starting a new one.
4. Sign in as a member who is not the sender and confirm the thread is absent; as an admin, confirm it is visible under "All members" and that the reply box is replaced by the admin notice.
5. Confirm every timestamp on the page matches Istanbul time.

## Known follow-ups, deliberately out of scope

- Inbound attachments are counted but not downloadable.
- No search across conversations.
- `ingestThread`, `runSync` and the endpoints have no unit coverage; their pure decision logic does. This matches the existing posture for `compose.ts` and `dispatch.ts` and is worth revisiting if this area grows.
- Four items on the spec's testing list are therefore covered by argument rather than by a test, and a reviewer should judge them as such:
  - **idempotent ingest** rests on `mail_messages.id` being Gmail's own message id under a `PRIMARY KEY` with `INSERT OR IGNORE`. That is a schema guarantee, not something `ingestThread` has to get right, which is why it was built that way.
  - **history filtering** is tested at the parsing boundary (`threadIdsFromHistory`); the `knownThreadIds` intersection that enforces it is a single `IN` query.
  - **backfill batching and resume** is tested only where it can fail silently — `listHistory` raising `GmailHistoryExpired` — not in the loop that consumes it.
  - **the ownership predicate** is enforced in SQL and read by review; there is no D1 stub in this repo to exercise it against.
  Adding a small in-memory D1 stub would close all four at once and is the obvious next investment if this area grows.
- A member who leaves takes their conversations with them: `mail_threads.sender_user_id` cascades on delete, as `scheduled_emails` already does.
