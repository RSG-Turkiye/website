# Send as RSG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin-authorised members compose and send mail from RSG's address through the website, without any of them holding the mailbox password, logging every send.

**Architecture:** A one-time OAuth refresh token for `turkey.rsg@gmail.com`, held as a Cloudflare Pages secret, is exchanged for short-lived access tokens inside a single transport module (`functions/_lib/gmail.ts`); domain rules (recipient parsing, limits, rate limiting) live in a separate module (`functions/_lib/mail.ts`); Pages Functions under `functions/api/mail/` and `functions/api/admin/` enforce the `is_sender` permission and write one `sent_emails` row per recipient. Every send is an individual Gmail message so recipients never see each other.

**Tech Stack:** Astro 5 (static pages + inline `<script>`), Cloudflare Pages Functions, D1 (SQLite), R2, Gmail REST API v1, TypeScript. Tests: Node's built-in `node --test` run through the already-present `tsx` loader — no new dependency.

**Spec:** `docs/superpowers/specs/2026-08-31-send-as-rsg-design.md`

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the spec.

- Sending account is `turkey.rsg@gmail.com`; the from address is **never hardcoded** — always read from `env.RSG_MAIL_FROM`.
- OAuth scope is exactly `https://www.googleapis.com/auth/gmail.send`. Nothing broader, no read scopes.
- `GMAIL_REFRESH_TOKEN` is a Cloudflare secret. It must never be returned in a response, logged to a response body, or referenced in any file under `src/`.
- **Bodies are plain text only.** No HTML body part, no HTML sanitisation, no rich editor.
- **One Gmail message per recipient.** Never put more than one address on a `To:` line. No `Cc` or `Bcc` fields are offered anywhere in the UI or accepted by any endpoint.
- Maximum **10 recipients** per compose.
- Rate limits: **20 recipients/hour/user**, **100 recipients/day/user**, **300 recipients/day globally**.
- Total attachment size per message ≤ **18 MB** (`18 * 1024 * 1024` bytes).
- Attachments are admin-uploaded only, stored in the **non-public** R2 bucket bound as `MAIL_ATTACHMENTS`. Members select from the list; members never upload.
- Every message sets `Reply-To:` to the sending member's own email, and a `From:` display name of `RSG Türkiye (<member display name>)`.
- **No `Bcc` back to RSG** — Gmail already files a copy in the sending account's Sent folder.
- A request rejected by the rate limiter writes **no** `sent_emails` row.
- `sent_emails` holds **one row per recipient**.
- Every user-facing string exists in both `src/pages/...` (English) and `src/pages/tr/...` (Turkish). Endpoints return machine-readable `code` values; pages map codes to localised text.
- Repo convention: `db/schema.sql` is idempotent, but `ALTER TABLE ADD COLUMN` is not — non-idempotent migrations go in the header comment as `wrangler d1 execute` commands, never as statements in the file.

---

## File Structure

**Create:**
- `functions/_lib/gmail.ts` — Gmail transport only: access-token acquisition, MIME assembly, send call. The one place that knows Gmail exists.
- `functions/_lib/mail.ts` — domain rules only: recipient parsing/validation, compose validation, rate-limit accounting. No network, no Gmail.
- `functions/api/mail/send.ts` — the send endpoint.
- `functions/api/mail/history.ts` — send log reads.
- `functions/api/admin/senders.ts` — grant/revoke/list authorised senders.
- `functions/api/admin/mail-attachments.ts` — attachment library.
- `src/pages/account/mail.astro`, `src/pages/tr/account/mail.astro` — compose pages.
- `tests/gmail.test.ts`, `tests/mail.test.ts` — unit tests for the two `_lib` modules.

**Modify:**
- `db/schema.sql` — three new tables + migration header notes.
- `functions/_lib/auth.ts` — `Env` and `User` additions.
- `functions/api/me.ts` — expose `is_sender`.
- `functions/api/admin/users.ts` — `is_sender` in SELECT, `make_sender`/`remove_sender` actions.
- `src/pages/account/index.astro`, `src/pages/tr/account/index.astro` — link card.
- `src/pages/admin/index.astro`, `src/pages/tr/admin/index.astro` — admin section.
- `wrangler.toml` — `RSG_MAIL_FROM` var, `MAIL_ATTACHMENTS` bucket binding.
- `package.json` — `test` script.
- `tsconfig.json` — exclude `tests/` from `astro check`.
- `README.md` — setup section.

---

### Task 1: Schema, config and types

Nothing in this task changes behaviour. It puts the columns, tables, bindings and TypeScript types in place so every later task compiles.

**Files:**
- Modify: `db/schema.sql`
- Modify: `functions/_lib/auth.ts:1-30`
- Modify: `wrangler.toml`

**Interfaces:**
- Consumes: nothing.
- Produces: `Env.GMAIL_REFRESH_TOKEN: string`, `Env.RSG_MAIL_FROM: string`, `Env.MAIL_ATTACHMENTS: R2Bucket`, `User.is_sender: number`; tables `sender_grants`, `sent_emails`, `mail_attachments`; column `users.is_sender`.

- [ ] **Step 1: Add the migration notes to the `db/schema.sql` header**

Open `db/schema.sql`. The file already opens with a block of `-- REQUIRED: run ALL THREE ...` notes ending at item `3b`. Append a fourth item immediately after `3b`'s last line and before the blank line preceding `CREATE TABLE IF NOT EXISTS users`:

```sql
--
-- 4a. functions/api/admin/users.ts (Task 6) unconditionally SELECTs
--     is_sender; deploying that without this first breaks the admin user
--     list with D1 "no such column: is_sender". ALTER TABLE ADD COLUMN is
--     NOT idempotent -- do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_sender INTEGER NOT NULL DEFAULT 0"
--
-- 4b. This file's sender_grants / sent_emails / mail_attachments tables
--     below are NOT applied by any deploy step -- run them by hand
--     (`IF NOT EXISTS` makes these safe to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, every /api/mail/* and /api/admin/senders request 500s
--     with "no such table: sent_emails".
```

- [ ] **Step 2: Add `is_sender` to the `users` table definition**

In the `CREATE TABLE IF NOT EXISTS users` block, add the column after `is_writer`:

```sql
  is_sender     INTEGER NOT NULL DEFAULT 0,
```

- [ ] **Step 3: Add the three new tables**

Append at the end of `db/schema.sql`, after the existing index declarations:

```sql
-- Send-as-RSG: which members may send mail from the organisation's address.
-- users.is_sender is the authority for "may this user send" (checked on every
-- request); this table is the record of how they came to be allowed. Granting
-- inserts a row; revoking stamps revoked_by/revoked_at on the newest unrevoked
-- row, so a granted -> revoked -> granted user has a readable three-row history.
CREATE TABLE IF NOT EXISTS sender_grants (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team        TEXT,
  granted_by  TEXT NOT NULL REFERENCES users(id),
  granted_at  INTEGER NOT NULL,
  revoked_by  TEXT REFERENCES users(id),
  revoked_at  INTEGER
);

-- One row per RECIPIENT, not per composed message: a compose addressed to
-- three people writes three rows, because each recipient genuinely receives
-- its own Gmail message. This is what makes the per-user rate limit and
-- "has anyone written to this professor?" a plain COUNT(*).
-- body_snapshot is deliberately a copy, not a reference -- the log has to stay
-- true after everything else changes.
CREATE TABLE IF NOT EXISTS sent_emails (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id),
  recipient_email   TEXT NOT NULL,
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  body_snapshot     TEXT NOT NULL,
  attachment_ids    TEXT NOT NULL DEFAULT '[]',
  gmail_message_id  TEXT,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message     TEXT,
  sent_at           INTEGER NOT NULL
);

-- Admin-curated attachment library (sponsorship pack, invitation letter).
-- Members pick from this list; members never upload. Bytes live in the
-- non-public R2 bucket bound as MAIL_ATTACHMENTS and are read server-side
-- into the MIME message -- no URL is ever exposed.
CREATE TABLE IF NOT EXISTS mail_attachments (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  uploaded_at   INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_sender_sent_at ON sent_emails(sender_user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_sender_grants_user_id ON sender_grants(user_id);
```

The two `sent_emails` indexes are not decoration: the rate limiter runs three `COUNT(*)` queries on every send, two of them filtered by `sender_user_id` + `sent_at` and one by `sent_at` alone.

- [ ] **Step 4: Extend `Env` and `User` in `functions/_lib/auth.ts`**

In the `Env` interface, add after `PUBLIC_BLOG_IMAGES_URL`:

```ts
  GMAIL_REFRESH_TOKEN: string;
  RSG_MAIL_FROM: string;
  MAIL_ATTACHMENTS: R2Bucket;
```

In the `User` interface, add after `is_writer`:

```ts
  is_sender: number;
```

- [ ] **Step 5: Add the config to `wrangler.toml`**

Add a second `[[r2_buckets]]` block after the existing one:

```toml
[[r2_buckets]]
binding = "MAIL_ATTACHMENTS"
bucket_name = "rsg-mail-attachments"
```

And inside the existing `[vars]` block:

```toml
# The address members' mail is sent from. Gmail accepts any address verified
# as a "send mail as" alias on the sending account, so switching to
# rsg-turkey@iscbsc.org once that alias works is a change to this line only --
# no code change. See README, "Sending mail as RSG".
RSG_MAIL_FROM = "turkey.rsg@gmail.com"
```

- [ ] **Step 6: Verify it compiles and the schema applies locally**

Run: `npx astro check`
Expected: no new errors (the pre-existing baseline count is unchanged).

Run: `npx wrangler d1 execute rsg-members --local --file=db/schema.sql`
Expected: completes without error.

Now check whether the local `users` table already has the column — a **fresh**
local database was just created from `schema.sql`, which now includes
`is_sender`, so the `ALTER` would fail with "duplicate column name". An
older local database created before this task still needs it. Production is
always the older case, which is why note 4a exists.

Run: `npx wrangler d1 execute rsg-members --local --command="SELECT is_sender FROM users LIMIT 1"`

If that errors with "no such column", run the migration; if it succeeds (or
returns no rows), skip it:

```
npx wrangler d1 execute rsg-members --local --command="ALTER TABLE users ADD COLUMN is_sender INTEGER NOT NULL DEFAULT 0"
```

Run: `npx wrangler d1 execute rsg-members --local --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sender_grants','sent_emails','mail_attachments')"`
Expected: three rows.

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql functions/_lib/auth.ts wrangler.toml
git commit -m "Add schema, bindings and types for sending mail as RSG"
```

---

### Task 2: Gmail transport module

**Files:**
- Create: `functions/_lib/gmail.ts`
- Create: `tests/gmail.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `Env` from Task 1.
- Produces:
  - `class GmailError extends Error`
  - `buildMime(msg: MimeMessage): string` where
    `MimeMessage = { fromAddress: string; fromName: string; to: string; replyTo: string; subject: string; body: string; attachments: MimeAttachment[] }`
    and `MimeAttachment = { filename: string; contentType: string; bytes: Uint8Array }`.
    Returns the base64url-encoded RFC 2822 message, ready for the Gmail API's `raw` field.
  - `getAccessToken(env: Env): Promise<string>`
  - `sendMail(env: Env, raw: string): Promise<string>` — returns the Gmail message id.

- [ ] **Step 1: Add the test script and exclude `tests/` from `astro check`**

The repo has no test runner. `tsx` is already a devDependency, and Node 18+ ships a test runner, so this adds no dependency. In `package.json`'s `"scripts"` block, add:

```json
    "test": "node --import tsx --test tests/*.test.ts",
```

`tsconfig.json` has `"include": ["**/*"]` with `"types": ["@cloudflare/workers-types"]`, so without a change `astro check` would try to type-check the test files against Workers globals and fail on `node:test`, `node:assert` and `Buffer`. Add `"tests"` to its `exclude` array:

```json
  "exclude": [
    "dist",
    "symposium_website",
    "tests"
  ],
```

Do not add `@types/node` instead — pulling Node's globals into the same program as `@cloudflare/workers-types` produces conflicting definitions for `fetch`, `Response` and `crypto` across the whole project. The tests are run by `npm test`, which is where their failures show up.

Only the two `_lib` modules are unit-tested — they are pure enough to run outside Workers. Request handlers are verified manually against `wrangler pages dev`, matching how the rest of this repo is verified.

- [ ] **Step 2: Write the failing test**

Create `tests/gmail.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMime } from '../functions/_lib/gmail';

function decode(raw: string): string {
  const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64, 'base64').toString('utf8');
}

const base = {
  fromAddress: 'turkey.rsg@gmail.com',
  fromName: 'RSG Türkiye (Emre Çevik)',
  to: 'hoca@uni.edu.tr',
  replyTo: 'emre@example.com',
  subject: 'Sempozyum daveti',
  body: 'Sayın Hocam,\n\nSizi davet etmek isteriz.\n',
  attachments: [],
};

test('emits the required headers with a single recipient', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^To: hoca@uni\.edu\.tr$/m);
  assert.match(mime, /^Reply-To: emre@example\.com$/m);
  assert.match(mime, /^MIME-Version: 1\.0$/m);
  assert.doesNotMatch(mime, /^(Cc|Bcc):/m);
});

test('RFC 2047 encodes non-ASCII display name and subject, never the address', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <turkey\.rsg@gmail\.com>$/m);
  assert.match(mime, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/m);

  const subjectLine = mime.split(/\r\n/).find(l => l.startsWith('Subject: '))!;
  const encoded = subjectLine.slice('Subject: =?UTF-8?B?'.length, -'?='.length);
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'Sempozyum daveti');
});

test('leaves a pure-ASCII subject unencoded', () => {
  const mime = decode(buildMime({ ...base, subject: 'Invitation' }));
  assert.match(mime, /^Subject: Invitation$/m);
});

test('round-trips a UTF-8 body through base64 without corruption', () => {
  const mime = decode(buildMime(base));
  assert.match(mime, /^Content-Transfer-Encoding: base64$/m);
  const payload = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  assert.equal(Buffer.from(payload, 'base64').toString('utf8'), base.body);
});

test('wraps base64 payload lines at 76 characters', () => {
  const mime = decode(buildMime({ ...base, body: 'x'.repeat(5000) }));
  const payload = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n').trim();
  for (const line of payload.split('\r\n')) {
    assert.ok(line.length <= 76, `line of ${line.length} chars exceeds 76`);
  }
});

test('builds multipart/mixed with an attachment part', () => {
  const mime = decode(buildMime({
    ...base,
    attachments: [{
      filename: 'sponsorluk.pdf',
      contentType: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3, 4]),
    }],
  }));
  const boundary = mime.match(/boundary="([^"]+)"/)![1];
  assert.match(mime, /^Content-Type: multipart\/mixed; boundary="/m);
  assert.match(mime, /^Content-Type: application\/pdf$/m);
  assert.match(mime, /^Content-Disposition: attachment; filename="sponsorluk\.pdf"$/m);
  assert.ok(mime.includes(`--${boundary}--`), 'missing closing boundary');
  assert.equal(mime.split(`--${boundary}`).length - 1, 3, 'expected two parts plus the closing boundary');
});

test('produces base64url output with no padding or unsafe characters', () => {
  assert.doesNotMatch(buildMime(base), /[+\/=]/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/gmail.ts'`.

- [ ] **Step 4: Write `functions/_lib/gmail.ts`**

```ts
import type { Env } from './auth';

/**
 * Sending mail as RSG.
 *
 * Everything Gmail-specific lives here. The account is a consumer Gmail
 * account (`turkey.rsg@gmail.com`), so there is no Workspace tenant and no
 * domain-wide delegation available -- authentication is a one-time OAuth
 * refresh token held as a Cloudflare secret. If RSG ever moves to a real
 * Workspace, `getAccessToken` is the only function that has to change.
 */

export class GmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailError';
  }
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MimeMessage {
  fromAddress: string;
  fromName: string;
  to: string;
  replyTo: string;
  subject: string;
  body: string;
  attachments: MimeAttachment[];
}

function base64(bytes: Uint8Array): string {
  // btoa takes a binary string; chunk it so a large attachment does not blow
  // the argument limit of String.fromCharCode.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wrap76(s: string): string {
  return (s.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * RFC 2047 encoded-word. Applied to display names and subjects only -- never
 * to an email address, which must stay literal for Gmail to parse it.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

/** Strip CR/LF so a crafted subject or filename cannot inject extra headers. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildMime(msg: MimeMessage): string {
  const encoder = new TextEncoder();
  const bodyB64 = wrap76(base64(encoder.encode(msg.body)));

  const headers = [
    `From: ${encodeHeader(headerSafe(msg.fromName))} <${msg.fromAddress}>`,
    `To: ${headerSafe(msg.to)}`,
    `Reply-To: ${headerSafe(msg.replyTo)}`,
    `Subject: ${encodeHeader(headerSafe(msg.subject))}`,
    'MIME-Version: 1.0',
  ];

  let mime: string;

  if (msg.attachments.length === 0) {
    mime = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
      '',
    ].join('\r\n');
  } else {
    const boundary = `rsg_${crypto.randomUUID()}`;
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
    ];
    for (const a of msg.attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${headerSafe(a.contentType)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${headerSafe(a.filename).replace(/"/g, '')}"`,
        '',
        wrap76(base64(a.bytes)),
      );
    }
    parts.push(`--${boundary}--`, '');

    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      ...parts,
    ].join('\r\n');
  }

  return base64Url(encoder.encode(mime));
}

// Access tokens last an hour; cache per isolate so a compose to ten
// recipients does not perform ten token refreshes.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  if (!env.GMAIL_REFRESH_TOKEN) {
    throw new GmailError('GMAIL_REFRESH_TOKEN is not configured');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    cachedToken = null;
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Token refresh failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

export async function sendMail(env: Env, raw: string): Promise<string> {
  const token = await getAccessToken(env);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail send failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ id: string }>();
  return data.id;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 7 tests.

- [ ] **Step 6: Verify it type-checks**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/gmail.ts tests/gmail.test.ts package.json
git commit -m "Add Gmail transport module for sending as RSG"
```

---

### Task 3: Domain rules module

Recipient parsing, compose validation and rate-limit accounting. No network, no Gmail, no knowledge of HTTP.

**Files:**
- Create: `functions/_lib/mail.ts`
- Create: `tests/mail.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately — it must stay unit-testable outside Workers).
- Produces:
  - `MAX_RECIPIENTS = 10`, `MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024`, `MAX_SUBJECT_LENGTH = 200`, `MAX_BODY_LENGTH = 20000`
  - `parseRecipients(input: string): string[]`
  - `isValidEmail(value: string): boolean`
  - `validateCompose(input: { to: string; subject: string; body: string }): { ok: true; recipients: string[] } | { ok: false; code: string }`
  - `interface RateLimitDb` (structurally satisfied by `D1Database`)
  - `checkRateLimit(db: RateLimitDb, userId: string, recipientCount: number, now: number): Promise<{ ok: true } | { ok: false; code: string }>`

Error `code` values, which the pages localise: `no_recipients`, `too_many_recipients`, `invalid_email`, `empty_subject`, `subject_too_long`, `empty_body`, `body_too_long`, `rate_limit_hour`, `rate_limit_day`, `rate_limit_global`.

- [ ] **Step 1: Write the failing test**

Create `tests/mail.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseRecipients,
  isValidEmail,
  validateCompose,
  checkRateLimit,
  MAX_RECIPIENTS,
} from '../functions/_lib/mail';

test('parseRecipients splits on commas, semicolons and newlines', () => {
  assert.deepEqual(
    parseRecipients('a@x.com, b@x.com; c@x.com\nd@x.com'),
    ['a@x.com', 'b@x.com', 'c@x.com', 'd@x.com'],
  );
});

test('parseRecipients trims, drops empties and de-duplicates case-insensitively', () => {
  assert.deepEqual(parseRecipients('  A@x.com , a@X.com ,, '), ['A@x.com']);
});

test('isValidEmail accepts ordinary addresses and rejects malformed ones', () => {
  for (const good of ['hoca@uni.edu.tr', 'a.b+tag@sub.example.co.uk']) {
    assert.ok(isValidEmail(good), `${good} should be valid`);
  }
  for (const bad of ['', 'nope', 'a@', '@b.com', 'a b@c.com', 'a@b', 'a@b .com']) {
    assert.ok(!isValidEmail(bad), `${bad} should be invalid`);
  }
});

const good = { to: 'hoca@uni.edu.tr', subject: 'Davet', body: 'Sayın Hocam' };

test('validateCompose accepts a well-formed compose', () => {
  assert.deepEqual(validateCompose(good), { ok: true, recipients: ['hoca@uni.edu.tr'] });
});

test('validateCompose rejects each malformed field with its own code', () => {
  const cases: Array<[Partial<typeof good>, string]> = [
    [{ to: '   ' }, 'no_recipients'],
    [{ to: 'hoca@uni.edu.tr, broken' }, 'invalid_email'],
    [{ subject: '  ' }, 'empty_subject'],
    [{ subject: 'x'.repeat(201) }, 'subject_too_long'],
    [{ body: '\n  ' }, 'empty_body'],
    [{ body: 'x'.repeat(20001) }, 'body_too_long'],
  ];
  for (const [patch, code] of cases) {
    assert.deepEqual(validateCompose({ ...good, ...patch }), { ok: false, code });
  }
});

test('validateCompose rejects more than MAX_RECIPIENTS addresses', () => {
  const to = Array.from({ length: MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@uni.edu.tr`).join(',');
  assert.deepEqual(validateCompose({ ...good, to }), { ok: false, code: 'too_many_recipients' });
});

/** Minimal stand-in for D1: returns queued counts in call order. */
function fakeDb(counts: number[]) {
  const queue = [...counts];
  const queries: string[] = [];
  return {
    queries,
    prepare(query: string) {
      queries.push(query);
      return {
        bind: () => ({ first: async () => ({ n: queue.shift() ?? 0 }) }),
      };
    },
  };
}

const NOW = 1_700_000_000;

test('checkRateLimit passes when all three windows have room', async () => {
  const db = fakeDb([0, 0, 0]);
  assert.deepEqual(await checkRateLimit(db, 'u1', 1, NOW), { ok: true });
});

test('checkRateLimit rejects when the hourly window would be exceeded', async () => {
  const db = fakeDb([19, 0, 0]);
  assert.deepEqual(await checkRateLimit(db, 'u1', 2, NOW), { ok: false, code: 'rate_limit_hour' });
});

test('checkRateLimit counts the pending recipients, not just history', async () => {
  // 15 already sent this hour; a 5-recipient compose exactly fills the window.
  assert.deepEqual(await checkRateLimit(fakeDb([15, 0, 0]), 'u1', 5, NOW), { ok: true });
  assert.deepEqual(
    await checkRateLimit(fakeDb([15, 0, 0]), 'u1', 6, NOW),
    { ok: false, code: 'rate_limit_hour' },
  );
});

test('checkRateLimit rejects on the daily and global windows', async () => {
  assert.deepEqual(await checkRateLimit(fakeDb([0, 100, 0]), 'u1', 1, NOW), { ok: false, code: 'rate_limit_day' });
  assert.deepEqual(await checkRateLimit(fakeDb([0, 0, 300]), 'u1', 1, NOW), { ok: false, code: 'rate_limit_global' });
});

test('checkRateLimit only counts successful sends', async () => {
  const db = fakeDb([0, 0, 0]);
  await checkRateLimit(db, 'u1', 1, NOW);
  for (const q of db.queries) {
    assert.match(q, /status = 'sent'/, 'rate limit must not count failed attempts');
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/mail.ts'`.

- [ ] **Step 3: Write `functions/_lib/mail.ts`**

```ts
/**
 * Domain rules for sending mail as RSG: who may send how much, and what
 * counts as a well-formed compose. Deliberately free of Gmail and HTTP so it
 * can be unit-tested outside the Workers runtime.
 */

export const MAX_RECIPIENTS = 10;
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024; // Gmail allows 25MB; base64 inflates by a third
export const MAX_SUBJECT_LENGTH = 200;
export const MAX_BODY_LENGTH = 20000;

export const RATE_LIMITS = {
  perUserPerHour: 20,
  perUserPerDay: 100,
  globalPerDay: 300, // consumer Gmail caps around 500/day; leave headroom
} as const;

export function parseRecipients(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,;\n\r]+/)) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export type ComposeValidation =
  | { ok: true; recipients: string[] }
  | { ok: false; code: string };

export function validateCompose(input: { to: string; subject: string; body: string }): ComposeValidation {
  const recipients = parseRecipients(input.to ?? '');
  if (recipients.length === 0) return { ok: false, code: 'no_recipients' };
  if (recipients.length > MAX_RECIPIENTS) return { ok: false, code: 'too_many_recipients' };
  if (!recipients.every(isValidEmail)) return { ok: false, code: 'invalid_email' };

  const subject = (input.subject ?? '').trim();
  if (!subject) return { ok: false, code: 'empty_subject' };
  if (subject.length > MAX_SUBJECT_LENGTH) return { ok: false, code: 'subject_too_long' };

  const body = (input.body ?? '').trim();
  if (!body) return { ok: false, code: 'empty_body' };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, code: 'body_too_long' };

  return { ok: true, recipients };
}

/** The slice of D1Database this module needs; D1Database satisfies it structurally. */
export interface RateLimitDb {
  prepare(query: string): {
    bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null> };
  };
}

export type RateLimitResult = { ok: true } | { ok: false; code: string };

/**
 * `now` is unix seconds. `recipientCount` is how many rows this compose is
 * about to write -- it is added to each window before comparing, so a compose
 * can never push a window past its limit.
 *
 * Only rows with status = 'sent' count: a failed send consumed no Gmail quota,
 * so it must not consume ours either.
 */
export async function checkRateLimit(
  db: RateLimitDb,
  userId: string,
  recipientCount: number,
  now: number,
): Promise<RateLimitResult> {
  const hourAgo = now - 3600;
  const dayAgo = now - 86400;

  const perUserHour = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE sender_user_id = ? AND status = 'sent' AND sent_at > ?")
    .bind(userId, hourAgo)
    .first<{ n: number }>();
  if ((perUserHour?.n ?? 0) + recipientCount > RATE_LIMITS.perUserPerHour) {
    return { ok: false, code: 'rate_limit_hour' };
  }

  const perUserDay = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE sender_user_id = ? AND status = 'sent' AND sent_at > ?")
    .bind(userId, dayAgo)
    .first<{ n: number }>();
  if ((perUserDay?.n ?? 0) + recipientCount > RATE_LIMITS.perUserPerDay) {
    return { ok: false, code: 'rate_limit_day' };
  }

  const globalDay = await db
    .prepare("SELECT COUNT(*) AS n FROM sent_emails WHERE status = 'sent' AND sent_at > ?")
    .bind(dayAgo)
    .first<{ n: number }>();
  if ((globalDay?.n ?? 0) + recipientCount > RATE_LIMITS.globalPerDay) {
    return { ok: false, code: 'rate_limit_global' };
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 18 tests total across both files (7 in `gmail.test.ts`, 11 here).

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/mail.ts tests/mail.test.ts
git commit -m "Add recipient validation and rate limiting for RSG mail"
```

---

### Task 4: Send endpoint

**Files:**
- Create: `functions/api/mail/send.ts`

**Interfaces:**
- Consumes: `getSessionUser`, `jsonResponse`, `checkCsrf`, `generateId`, `Env` (`functions/_lib/auth.ts`); `buildMime`, `sendMail`, `GmailError` (Task 2); `validateCompose`, `checkRateLimit`, `MAX_ATTACHMENT_BYTES` (Task 3).
- Produces: `POST /api/mail/send`. Request body:
  `{ to: string; recipient_name?: string; subject: string; body: string; attachment_ids?: string[] }`.
  Response on success (200): `{ ok: true, results: Array<{ recipient: string; status: 'sent' | 'failed'; error?: string }> }`.
  Response when every recipient failed (502): the same shape with `ok: false`.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/mail/send.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { buildMime, sendMail, GmailError, type MimeAttachment } from '../../_lib/gmail';
import { validateCompose, checkRateLimit, MAX_ATTACHMENT_BYTES } from '../../_lib/mail';

interface ComposeBody {
  to: string;
  recipient_name?: string;
  subject: string;
  body: string;
  attachment_ids?: string[];
}

interface AttachmentRow {
  id: string;
  filename: string;
  r2_key: string;
  content_type: string;
  size_bytes: number;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const input = await request.json<ComposeBody>();

  const validation = validateCompose({
    to: input.to ?? '',
    subject: input.subject ?? '',
    body: input.body ?? '',
  });
  if (!validation.ok) return jsonResponse({ error: 'Invalid compose', code: validation.code }, 400);
  const recipients = validation.recipients;

  const now = Math.floor(Date.now() / 1000);

  // Checked before anything is sent, and a rejection writes no sent_emails
  // row -- logging a blocked attempt would corrupt the count that blocked it.
  const limit = await checkRateLimit(env.DB, user.id, recipients.length, now);
  if (!limit.ok) return jsonResponse({ error: 'Rate limit exceeded', code: limit.code }, 429);

  // Resolve attachments once; the same bytes go to every recipient.
  // De-duplicated so a repeated id cannot trip the count check below and
  // surface as a misleading "unknown attachment" error.
  const attachmentIds = Array.isArray(input.attachment_ids)
    ? [...new Set(input.attachment_ids)]
    : [];
  const attachments: MimeAttachment[] = [];
  if (attachmentIds.length > 0) {
    const placeholders = attachmentIds.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id, filename, r2_key, content_type, size_bytes
       FROM mail_attachments
       WHERE is_active = 1 AND id IN (${placeholders})`
    ).bind(...attachmentIds).all<AttachmentRow>();

    if (rows.results.length !== attachmentIds.length) {
      return jsonResponse({ error: 'Unknown attachment', code: 'unknown_attachment' }, 400);
    }

    const total = rows.results.reduce((sum, r) => sum + r.size_bytes, 0);
    if (total > MAX_ATTACHMENT_BYTES) {
      return jsonResponse({ error: 'Attachments too large', code: 'attachments_too_large' }, 400);
    }

    for (const row of rows.results) {
      const object = await env.MAIL_ATTACHMENTS.get(row.r2_key);
      if (!object) return jsonResponse({ error: 'Attachment missing', code: 'unknown_attachment' }, 400);
      attachments.push({
        filename: row.filename,
        contentType: row.content_type,
        bytes: new Uint8Array(await object.arrayBuffer()),
      });
    }
  }

  const profile = await env.DB.prepare(
    'SELECT display_name FROM profiles WHERE user_id = ?'
  ).bind(user.id).first<{ display_name: string }>();
  const senderName = profile?.display_name ?? user.email;
  const attachmentIdsJson = JSON.stringify(attachmentIds);
  const subject = input.subject.trim();
  const body = input.body.trim();
  const recipientName = input.recipient_name?.trim() || null;

  // One Gmail message per recipient: putting ten professors on one To: line
  // would show each of them the entire outreach list.
  const results: Array<{ recipient: string; status: 'sent' | 'failed'; error?: string }> = [];

  for (const recipient of recipients) {
    let gmailId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const raw = buildMime({
        fromAddress: env.RSG_MAIL_FROM,
        fromName: `RSG Türkiye (${senderName})`,
        to: recipient,
        replyTo: user.email,
        subject,
        body,
        attachments,
      });
      gmailId = await sendMail(env, raw);
    } catch (err) {
      errorMessage = err instanceof GmailError ? err.message : String(err);
    }

    await env.DB.prepare(
      `INSERT INTO sent_emails
        (id, sender_user_id, recipient_email, recipient_name, subject, body_snapshot,
         attachment_ids, gmail_message_id, status, error_message, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      generateId(),
      user.id,
      recipient,
      recipients.length === 1 ? recipientName : null,
      subject,
      body,
      attachmentIdsJson,
      gmailId,
      gmailId ? 'sent' : 'failed',
      errorMessage,
      Math.floor(Date.now() / 1000),
    ).run();

    results.push(
      gmailId
        ? { recipient, status: 'sent' }
        : { recipient, status: 'failed', error: errorMessage ?? 'unknown error' },
    );
  }

  const anySent = results.some(r => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
};
```

`recipient_name` is only stored when there is exactly one recipient — a single free-text name cannot describe five different people, and writing it onto all five rows would make the log lie.

- [ ] **Step 2: Verify it type-checks**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 3: Verify the 403 path against a local dev server**

The real Gmail path cannot be exercised until an operator sets `GMAIL_REFRESH_TOKEN` (see Task 10). The permission and validation gates are fully verifiable now.

Run: `npx wrangler pages dev -- npm run dev`

In a second shell, with the session cookie of a user whose `is_sender` is 0:

```bash
curl -i -X POST http://localhost:8788/api/mail/send \
  -H 'Content-Type: application/json' \
  -H "Cookie: rsg_session=<session id of a non-sender user>" \
  -d '{"to":"test@example.com","subject":"x","body":"y"}'
```

Expected: `HTTP/1.1 403` and body `{"error":"Forbidden","code":"forbidden"}`.

Then confirm nothing was logged:

```bash
npx wrangler d1 execute rsg-members --local --command="SELECT COUNT(*) FROM sent_emails"
```

Expected: `0`.

- [ ] **Step 4: Verify the validation and rate-limit gates**

Flip a local test user to a sender and repeat with a malformed body:

```bash
npx wrangler d1 execute rsg-members --local --command="UPDATE users SET is_sender = 1 WHERE email = '<your test user email>'"

curl -s -X POST http://localhost:8788/api/mail/send \
  -H 'Content-Type: application/json' -H "Cookie: rsg_session=<session id>" \
  -d '{"to":"not-an-email","subject":"x","body":"y"}'
```

Expected: `{"error":"Invalid compose","code":"invalid_email"}` with status 400.

Seed the hourly window past its limit and confirm the 429 writes nothing:

```bash
npx wrangler d1 execute rsg-members --local --command="INSERT INTO sent_emails (id, sender_user_id, recipient_email, subject, body_snapshot, status, sent_at) SELECT hex(randomblob(16)), id, 'x@y.com', 's', 'b', 'sent', strftime('%s','now') FROM users WHERE is_sender = 1"
```

Repeat that insert until the user has 20 rows, then POST a valid compose.
Expected: status 429, `code: "rate_limit_hour"`, and `SELECT COUNT(*) FROM sent_emails` unchanged.

- [ ] **Step 5: Commit**

```bash
git add functions/api/mail/send.ts
git commit -m "Add send endpoint for mail sent as RSG"
```

---

### Task 5: Send history endpoint

**Files:**
- Create: `functions/api/mail/history.ts`

**Interfaces:**
- Consumes: `getSessionUser`, `jsonResponse`, `Env`.
- Produces: `GET /api/mail/history` → `{ sends: SendRow[] }` where
  `SendRow = { id, recipient_email, recipient_name, subject, status, error_message, sent_at, sender_email?, sender_name? }`.
  `?scope=all` returns every user's sends and includes `sender_email`/`sender_name`; admin only.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/mail/history.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);

  const url = new URL(request.url);
  const wantsAll = url.searchParams.get('scope') === 'all';

  // Only an admin may widen the scope. A non-admin asking for everyone's sends
  // silently gets their own -- there is nothing here to warn them about.
  if (wantsAll && user.is_admin === 1) {
    const result = await env.DB.prepare(
      `SELECT s.id, s.recipient_email, s.recipient_name, s.subject, s.status,
              s.error_message, s.sent_at,
              u.email AS sender_email, p.display_name AS sender_name
       FROM sent_emails s
       JOIN users u ON u.id = s.sender_user_id
       LEFT JOIN profiles p ON p.user_id = s.sender_user_id
       ORDER BY s.sent_at DESC
       LIMIT 500`
    ).all();
    return jsonResponse({ sends: result.results });
  }

  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const result = await env.DB.prepare(
    `SELECT id, recipient_email, recipient_name, subject, status, error_message, sent_at
     FROM sent_emails
     WHERE sender_user_id = ?
     ORDER BY sent_at DESC
     LIMIT 200`
  ).bind(user.id).all();

  return jsonResponse({ sends: result.results });
};
```

`body_snapshot` is deliberately not returned by the list endpoint: it is the bulkiest column, it is not shown in either table, and the log's job is to record it, not to republish it.

- [ ] **Step 2: Verify it type-checks**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 3: Verify scope isolation**

With the dev server running and two local users (one sender, one admin), insert a row for each:

```bash
npx wrangler d1 execute rsg-members --local --command="SELECT sender_user_id, COUNT(*) FROM sent_emails GROUP BY 1"

curl -s -H "Cookie: rsg_session=<sender session>" 'http://localhost:8788/api/mail/history?scope=all'
curl -s -H "Cookie: rsg_session=<admin session>"  'http://localhost:8788/api/mail/history?scope=all'
```

Expected: the sender's request returns only their own rows and no `sender_email` field; the admin's returns every row with `sender_email` populated.

- [ ] **Step 4: Commit**

```bash
git add functions/api/mail/history.ts
git commit -m "Add send history endpoint for RSG mail"
```

---

### Task 6: Sender permission API

Grants the permission, records the audit trail, exposes the flag to the frontend. **This task contains the change that requires the `is_sender` migration to have been run** — see Task 1, note 4a.

**Files:**
- Create: `functions/api/admin/senders.ts`
- Modify: `functions/api/admin/users.ts:16-18` (the SELECT) and its `onRequestPatch` action switch
- Modify: `functions/api/me.ts:37`

**Interfaces:**
- Consumes: `getSessionUser`, `jsonResponse`, `checkCsrf`, `generateId`, `Env`.
- Produces:
  - `grantSender(env, userId, team, grantedBy)` and `revokeSender(env, userId, revokedBy)` exported from `functions/api/admin/senders.ts`, reused by `users.ts`.
  - `GET /api/admin/senders` → `{ senders: Array<{ user_id, email, display_name, team, granted_at, granted_by_email }> }`
  - `POST /api/admin/senders` with `{ emails: string, team?: string }` → `{ ok: true, granted: string[], unknown: string[] }`
  - `PATCH /api/admin/senders` with `{ user_id: string, action: 'revoke' }` → `{ ok: true }`
  - `/api/me` gains `is_sender: boolean`.

- [ ] **Step 1: Write `functions/api/admin/senders.ts`**

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { parseRecipients } from '../../_lib/mail';

/**
 * users.is_sender is the authority for "may this user send"; sender_grants is
 * the record of how they came to be allowed. Both are written together, here,
 * so no caller can set one without the other.
 */
export async function grantSender(
  env: Env,
  userId: string,
  team: string | null,
  grantedBy: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET is_sender = 1 WHERE id = ?').bind(userId),
    env.DB.prepare(
      'INSERT INTO sender_grants (id, user_id, team, granted_by, granted_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(generateId(), userId, team, grantedBy, now),
  ]);
}

export async function revokeSender(env: Env, userId: string, revokedBy: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('UPDATE users SET is_sender = 0 WHERE id = ?').bind(userId),
    env.DB.prepare(
      `UPDATE sender_grants SET revoked_by = ?, revoked_at = ?
       WHERE id = (
         SELECT id FROM sender_grants
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY granted_at DESC LIMIT 1
       )`
    ).bind(revokedBy, now, userId),
  ]);
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT u.id AS user_id, u.email, p.display_name, g.team, g.granted_at,
            gb.email AS granted_by_email
     FROM users u
     LEFT JOIN profiles p ON p.user_id = u.id
     LEFT JOIN sender_grants g
       ON g.id = (SELECT id FROM sender_grants s
                  WHERE s.user_id = u.id AND s.revoked_at IS NULL
                  ORDER BY s.granted_at DESC LIMIT 1)
     LEFT JOIN users gb ON gb.id = g.granted_by
     WHERE u.is_sender = 1
     ORDER BY g.granted_at DESC`
  ).all();

  return jsonResponse({ senders: result.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{ emails: string; team?: string }>();
  const emails = parseRecipients(body.emails ?? '');
  if (emails.length === 0) return jsonResponse({ error: 'No emails given', code: 'no_emails' }, 400);
  if (emails.length > 200) return jsonResponse({ error: 'Too many emails', code: 'too_many_emails' }, 400);

  const team = body.team?.trim() || null;
  const granted: string[] = [];
  const unknown: string[] = [];

  for (const email of emails) {
    const row = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = lower(?)')
      .bind(email).first<{ id: string }>();
    if (!row) {
      unknown.push(email);
      continue;
    }
    await grantSender(env, row.id, team, user.id);
    granted.push(email);
  }

  // `unknown` is the point of this endpoint's response shape: silently
  // dropping the three people who typed their address differently is the
  // failure mode worth designing against.
  return jsonResponse({ ok: true, granted, unknown });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{ user_id: string; action: 'revoke' }>();
  if (!body.user_id || body.action !== 'revoke') {
    return jsonResponse({ error: 'Unknown action' }, 400);
  }

  await revokeSender(env, body.user_id, user.id);
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 2: Wire the per-user toggle into `functions/api/admin/users.ts`**

Add the import at the top of the file, after the `rank` import:

```ts
import { grantSender, revokeSender } from './senders';
```

In `onRequestGet`, add `u.is_sender` to the SELECT list — change the line

```ts
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.is_writer, u.created_at, u.last_login,
```

to

```ts
      u.id, u.email, u.is_member, u.is_admin, u.is_announcer, u.is_writer, u.is_sender, u.created_at, u.last_login,
```

In `onRequestPatch`, extend the `action` union type with `| 'make_sender' | 'remove_sender'`, and add two cases before `default:`:

```ts
    case 'make_sender':
      await grantSender(env, body.user_id, body.value?.trim() || null, user.id);
      break;
    case 'remove_sender':
      await revokeSender(env, body.user_id, user.id);
      break;
```

- [ ] **Step 3: Expose the flag in `functions/api/me.ts`**

In the returned `user` object, add after `is_writer`:

```ts
      is_sender: user.is_sender === 1,
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 5: Verify grant, bulk grant and revoke locally**

With the dev server running and an admin session:

```bash
curl -s -X POST http://localhost:8788/api/admin/senders \
  -H 'Content-Type: application/json' -H "Cookie: rsg_session=<admin session>" \
  -d '{"emails":"<a real local user email>, ghost@nowhere.invalid","team":"sponsorship"}'
```

Expected: `{"ok":true,"granted":["<real email>"],"unknown":["ghost@nowhere.invalid"]}`.

```bash
curl -s -H "Cookie: rsg_session=<admin session>" http://localhost:8788/api/admin/senders
```

Expected: one row, with `team: "sponsorship"` and `granted_by_email` set to the admin's address.

```bash
npx wrangler d1 execute rsg-members --local --command="SELECT user_id, team, granted_at, revoked_at FROM sender_grants"
```

Expected: one row with `revoked_at` null.

Revoke, then re-grant, and confirm the history reads correctly:

```bash
curl -s -X PATCH http://localhost:8788/api/admin/senders \
  -H 'Content-Type: application/json' -H "Cookie: rsg_session=<admin session>" \
  -d '{"user_id":"<that user id>","action":"revoke"}'

npx wrangler d1 execute rsg-members --local --command="SELECT is_sender FROM users WHERE id = '<that user id>'"
npx wrangler d1 execute rsg-members --local --command="SELECT granted_at, revoked_at FROM sender_grants WHERE user_id = '<that user id>'"
```

Expected: `is_sender` is 0; the grant row now has `revoked_at` set.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/senders.ts functions/api/admin/users.ts functions/api/me.ts
git commit -m "Add sender permission grant, revoke and audit trail"
```

---

### Task 7: Attachment library API

**Files:**
- Create: `functions/api/admin/mail-attachments.ts`

**Interfaces:**
- Consumes: `getSessionUser`, `jsonResponse`, `checkCsrf`, `generateId`, `Env` (`MAIL_ATTACHMENTS` binding from Task 1).
- Produces:
  - `GET /api/admin/mail-attachments` → `{ attachments: Array<{ id, filename, content_type, size_bytes, uploaded_at, is_active }> }`. Admins see all; a member with `is_sender` sees active ones only.
  - `POST /api/admin/mail-attachments` — raw body upload, `Content-Type` and `X-Filename` headers. Admin only. → `{ ok: true, id }`
  - `PATCH /api/admin/mail-attachments` with `{ id, is_active: boolean }`. Admin only.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/admin/mail-attachments.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { MAX_ATTACHMENT_BYTES } from '../../_lib/mail';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  // Senders need the list to pick from; only admins see deactivated entries.
  if (!user.is_admin && user.is_sender !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const query = user.is_admin
    ? `SELECT id, filename, content_type, size_bytes, uploaded_at, is_active
       FROM mail_attachments ORDER BY uploaded_at DESC`
    : `SELECT id, filename, content_type, size_bytes, uploaded_at, is_active
       FROM mail_attachments WHERE is_active = 1 ORDER BY uploaded_at DESC`;

  const result = await env.DB.prepare(query).all();
  return jsonResponse({ attachments: result.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (!ALLOWED_TYPES[contentType]) {
    return jsonResponse({ error: 'Unsupported file type', code: 'unsupported_type' }, 400);
  }

  // Header-borne filenames are attacker-adjacent input even from an admin
  // form: strip path separators, quotes and CR/LF before it reaches a
  // Content-Disposition header.
  const rawName = request.headers.get('X-Filename') ?? '';
  const filename = decodeURIComponent(rawName).replace(/[\r\n"\\/]+/g, '_').trim().slice(0, 120);
  if (!filename) return jsonResponse({ error: 'Missing filename', code: 'missing_filename' }, 400);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return jsonResponse({ error: 'Empty file', code: 'empty_file' }, 400);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'File too large', code: 'attachments_too_large' }, 400);
  }

  const id = generateId();
  const key = `${id}.${ALLOWED_TYPES[contentType]}`;
  await env.MAIL_ATTACHMENTS.put(key, bytes, { httpMetadata: { contentType } });

  await env.DB.prepare(
    `INSERT INTO mail_attachments
      (id, filename, r2_key, content_type, size_bytes, uploaded_by, uploaded_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, filename, key, contentType, bytes.byteLength, user.id, Math.floor(Date.now() / 1000)).run();

  return jsonResponse({ ok: true, id });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<{ id: string; is_active: boolean }>();
  if (!body.id || typeof body.is_active !== 'boolean') {
    return jsonResponse({ error: 'Missing id or is_active' }, 400);
  }

  // Deactivate rather than delete: sent_emails rows reference these ids, and
  // the log has to stay readable.
  await env.DB.prepare('UPDATE mail_attachments SET is_active = ? WHERE id = ?')
    .bind(body.is_active ? 1 : 0, body.id).run();

  return jsonResponse({ ok: true });
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx astro check`
Expected: no new errors.

- [ ] **Step 3: Verify upload, listing and deactivation locally**

```bash
printf '%%PDF-1.4 test' > /tmp/test.pdf

curl -s -X POST http://localhost:8788/api/admin/mail-attachments \
  -H 'Content-Type: application/pdf' -H 'X-Filename: sponsorluk.pdf' \
  -H "Cookie: rsg_session=<admin session>" --data-binary @/tmp/test.pdf
```

Expected: `{"ok":true,"id":"..."}`.

```bash
curl -s -H "Cookie: rsg_session=<admin session>" http://localhost:8788/api/admin/mail-attachments
```

Expected: one entry, `is_active: 1`, `filename: "sponsorluk.pdf"`.

Confirm a non-admin, non-sender is refused, and that a path-traversal filename is neutralised:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Cookie: rsg_session=<plain member session>" \
  http://localhost:8788/api/admin/mail-attachments

curl -s -X POST http://localhost:8788/api/admin/mail-attachments \
  -H 'Content-Type: application/pdf' -H 'X-Filename: ../../etc/passwd' \
  -H "Cookie: rsg_session=<admin session>" --data-binary @/tmp/test.pdf

npx wrangler d1 execute rsg-members --local --command="SELECT filename FROM mail_attachments"
```

Expected: `403` for the member; the stored filename contains no `/` or `..` path segments.

- [ ] **Step 4: Commit**

```bash
git add functions/api/admin/mail-attachments.ts
git commit -m "Add admin-curated attachment library for RSG mail"
```

---

### Task 8: Compose page (EN + TR)

Both language versions ship together, as the blog submission form did — they are translations of one page, and splitting them means reviewing the same markup twice.

**Files:**
- Create: `src/pages/account/mail.astro`
- Create: `src/pages/tr/account/mail.astro`
- Modify: `src/pages/account/index.astro` (add link card near `writerCard`, around line 87)
- Modify: `src/pages/tr/account/index.astro` (same)

**Interfaces:**
- Consumes: `GET /api/me` (`user.is_sender`), `POST /api/mail/send`, `GET /api/mail/history`, `GET /api/admin/mail-attachments`.
- Produces: no exports; two routes, `/account/mail` and `/tr/account/mail`.

- [ ] **Step 1: Create `src/pages/account/mail.astro`**

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
---

<BaseLayout
  pageTitle="Send mail as RSG — RSG Turkiye"
  description="Send mail from the RSG Turkiye address."
  translationUrl="/tr/account/mail"
>
  <div class="min-h-screen bg-[#F7F7F6] py-12 px-4">
    <div class="max-w-3xl mx-auto">

      <div id="loadingState" class="flex items-center justify-center py-24">
        <div class="w-8 h-8 border-2 border-navy border-t-transparent rounded-full animate-spin"></div>
      </div>

      <div id="notAllowed" class="hidden text-center py-24">
        <p class="text-gray-500 mb-4">You are not authorised to send mail as RSG.</p>
        <a href="/account" class="text-navy-mid hover:underline text-sm">Back to my profile</a>
      </div>

      <div id="composeContent" class="hidden flex flex-col gap-6">
        <div>
          <h1 class="text-xl font-bold text-navy">Send mail as RSG</h1>
          <p class="text-sm text-gray-500 mt-1">
            Sent from <span id="fromAddress" class="font-medium text-navy"></span>.
            Replies come to your own address. Each recipient receives a separate
            message and never sees the others.
          </p>
        </div>

        <div id="toast" class="hidden fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50"></div>

        <form id="composeForm" class="bg-white rounded-2xl border border-border shadow-sm p-6 flex flex-col gap-3">
          <input id="mailTo" type="text" required placeholder="To (comma separated, max 10)"
            class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
          <input id="mailRecipientName" type="text" placeholder="Recipient name (optional, single recipient only)"
            class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
          <input id="mailSubject" type="text" required maxlength="200" placeholder="Subject"
            class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
          <textarea id="mailBody" required rows="14" maxlength="20000" placeholder="Write your message"
            class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid"></textarea>

          <div id="attachmentsWrap" class="hidden border-t border-border pt-3">
            <p class="text-xs font-semibold text-navy mb-2">Attachments</p>
            <div id="attachmentsList" class="flex flex-col gap-1"></div>
          </div>

          <div class="flex items-center gap-3 pt-1">
            <button type="submit" id="sendBtn"
              class="px-5 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors disabled:opacity-50">
              Send
            </button>
            <span id="sendStatus" class="text-xs text-gray-400"></span>
          </div>
        </form>

        <div class="bg-white rounded-2xl border border-border shadow-sm p-6">
          <h2 class="text-sm font-semibold text-navy mb-3">My sent mail</h2>
          <div id="historyList" class="flex flex-col gap-2"></div>
          <p id="historyEmpty" class="hidden text-sm text-gray-400">Nothing sent yet.</p>
        </div>
      </div>
    </div>
  </div>
</BaseLayout>

<script>
  const ERRORS: Record<string, string> = {
    no_recipients: 'Add at least one recipient.',
    too_many_recipients: 'At most 10 recipients per message.',
    invalid_email: 'One of the addresses is not a valid email.',
    empty_subject: 'Subject cannot be empty.',
    subject_too_long: 'Subject is too long (max 200 characters).',
    empty_body: 'Message body cannot be empty.',
    body_too_long: 'Message is too long (max 20000 characters).',
    unknown_attachment: 'One of the selected attachments is no longer available.',
    attachments_too_large: 'Attachments exceed the 18MB limit.',
    rate_limit_hour: 'You have reached the hourly send limit (20). Try again later.',
    rate_limit_day: 'You have reached the daily send limit (100).',
    rate_limit_global: 'RSG has reached its daily send limit (300). Try again tomorrow.',
    forbidden: 'You are not authorised to send mail as RSG.',
    not_authenticated: 'Your session expired. Please sign in again.',
  };

  function showToast(message: string, isError = false) {
    const toast = document.getElementById('toast')!;
    toast.textContent = message;
    toast.className = `fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white z-50 ${
      isError ? 'bg-red-500' : 'bg-navy'
    }`;
    setTimeout(() => toast.classList.add('hidden'), 6000);
  }

  function escapeHtml(s: unknown): string {
    return String(s ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  }

  function formatDate(ts: number) {
    return new Date(ts * 1000).toLocaleString('en-GB');
  }

  async function loadHistory() {
    const res = await fetch('/api/mail/history');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('historyList')!;
    const empty = document.getElementById('historyEmpty')!;
    if (!data.sends.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = data.sends.map((s: any) => `
      <div class="flex items-start justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
        <div class="min-w-0">
          <div class="text-navy truncate">${escapeHtml(s.subject)}</div>
          <div class="text-xs text-gray-400">${escapeHtml(s.recipient_email)} · ${formatDate(s.sent_at)}</div>
          ${s.status === 'failed' ? `<div class="text-xs text-red-600 mt-0.5">${escapeHtml(s.error_message)}</div>` : ''}
        </div>
        <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${
          s.status === 'sent' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }">${s.status === 'sent' ? 'Sent' : 'Failed'}</span>
      </div>`).join('');
  }

  async function loadAttachments() {
    const res = await fetch('/api/admin/mail-attachments');
    if (!res.ok) return;
    const data = await res.json();
    const active = data.attachments.filter((a: any) => a.is_active === 1);
    if (!active.length) return;
    document.getElementById('attachmentsWrap')!.classList.remove('hidden');
    document.getElementById('attachmentsList')!.innerHTML = active.map((a: any) => `
      <label class="flex items-center gap-2 text-sm text-gray-600">
        <input type="checkbox" class="attachment-box rounded border-border" value="${escapeHtml(a.id)}" />
        ${escapeHtml(a.filename)}
        <span class="text-xs text-gray-400">${Math.round(a.size_bytes / 1024)} KB</span>
      </label>`).join('');
  }

  function setupForm() {
    const form = document.getElementById('composeForm') as HTMLFormElement;
    const btn = document.getElementById('sendBtn') as HTMLButtonElement;
    const status = document.getElementById('sendStatus')!;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      btn.disabled = true;
      status.textContent = 'Sending…';

      const attachment_ids = Array.from(
        document.querySelectorAll<HTMLInputElement>('.attachment-box:checked')
      ).map(b => b.value);

      const res = await fetch('/api/mail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: (document.getElementById('mailTo') as HTMLInputElement).value,
          recipient_name: (document.getElementById('mailRecipientName') as HTMLInputElement).value,
          subject: (document.getElementById('mailSubject') as HTMLInputElement).value,
          body: (document.getElementById('mailBody') as HTMLTextAreaElement).value,
          attachment_ids,
        }),
      });

      // A non-JSON body means the Worker threw; say so rather than crashing
      // the handler and leaving the button stuck on "Sending…".
      const data = await res.json().catch(() => null);
      btn.disabled = false;
      status.textContent = '';

      if (!data) {
        showToast('Something went wrong. Please try again.', true);
        return;
      }
      if (!res.ok && data.code) {
        showToast(ERRORS[data.code] ?? 'Send failed.', true);
        if (data.results) await loadHistory();
        return;
      }

      const failed = (data.results ?? []).filter((r: any) => r.status === 'failed');
      const sent = (data.results ?? []).length - failed.length;
      if (failed.length === 0) {
        showToast(`Sent to ${sent} recipient(s).`);
        form.reset();
      } else {
        showToast(`Sent to ${sent}, failed for: ${failed.map((r: any) => r.recipient).join(', ')}`, true);
      }
      await loadHistory();
    });
  }

  async function init() {
    const res = await fetch('/api/me');
    document.getElementById('loadingState')!.classList.add('hidden');

    if (!res.ok) {
      document.getElementById('notAllowed')!.classList.remove('hidden');
      return;
    }
    const data = await res.json();
    if (!data.user?.is_sender) {
      document.getElementById('notAllowed')!.classList.remove('hidden');
      return;
    }

    document.getElementById('composeContent')!.classList.remove('hidden');
    document.getElementById('fromAddress')!.textContent = 'the RSG Turkiye address';
    setupForm();
    await Promise.all([loadHistory(), loadAttachments()]);
  }

  init();
</script>
```

The page never learns the actual from address — there is no endpoint that returns `RSG_MAIL_FROM`, and adding one would put configuration on a public surface for no gain.

- [ ] **Step 2: Create `src/pages/tr/account/mail.astro`**

Copy the file from Step 1 and translate every user-facing string. The import path becomes `../../../layouts/BaseLayout.astro`, `translationUrl` becomes `/account/mail`, the back link becomes `/tr/account`, and `toLocaleString('en-GB')` becomes `toLocaleString('tr-TR')`.

The translated strings:

| English | Turkish |
|---|---|
| Send mail as RSG — RSG Turkiye | RSG Adına Mail Gönder — RSG Türkiye |
| Send mail from the RSG Turkiye address. | RSG Türkiye adresinden mail gönderin. |
| You are not authorised to send mail as RSG. | RSG adına mail gönderme yetkiniz yok. |
| Back to my profile | Profilime dön |
| Send mail as RSG | RSG Adına Mail Gönder |
| Sent from … Replies come to your own address. Each recipient receives a separate message and never sees the others. | … adresinden gönderilir. Cevaplar sizin kendi adresinize gelir. Her alıcı ayrı bir mesaj alır ve diğerlerini görmez. |
| the RSG Turkiye address | RSG Türkiye adresi |
| To (comma separated, max 10) | Kime (virgülle ayırın, en fazla 10) |
| Recipient name (optional, single recipient only) | Alıcı adı (opsiyonel, yalnızca tek alıcıda) |
| Subject | Konu |
| Write your message | Mesajınızı yazın |
| Attachments | Ekler |
| Send | Gönder |
| Sending… | Gönderiliyor… |
| My sent mail | Gönderdiklerim |
| Nothing sent yet. | Henüz gönderim yok. |
| Sent | Gönderildi |
| Failed | Başarısız |
| Sent to N recipient(s). | N alıcıya gönderildi. |
| Sent to N, failed for: … | N alıcıya gönderildi, şunlarda başarısız: … |
| Something went wrong. Please try again. | Bir hata oluştu. Lütfen tekrar deneyin. |
| Send failed. | Gönderim başarısız. |
| Add at least one recipient. | En az bir alıcı ekleyin. |
| At most 10 recipients per message. | Mesaj başına en fazla 10 alıcı. |
| One of the addresses is not a valid email. | Adreslerden biri geçerli bir e-posta değil. |
| Subject cannot be empty. | Konu boş olamaz. |
| Subject is too long (max 200 characters). | Konu çok uzun (en fazla 200 karakter). |
| Message body cannot be empty. | Mesaj gövdesi boş olamaz. |
| Message is too long (max 20000 characters). | Mesaj çok uzun (en fazla 20000 karakter). |
| One of the selected attachments is no longer available. | Seçilen eklerden biri artık mevcut değil. |
| Attachments exceed the 18MB limit. | Ekler 18MB sınırını aşıyor. |
| You have reached the hourly send limit (20). Try again later. | Saatlik gönderim sınırına (20) ulaştınız. Daha sonra tekrar deneyin. |
| You have reached the daily send limit (100). | Günlük gönderim sınırına (100) ulaştınız. |
| RSG has reached its daily send limit (300). Try again tomorrow. | RSG günlük gönderim sınırına (300) ulaştı. Yarın tekrar deneyin. |
| Your session expired. Please sign in again. | Oturumunuz sona erdi. Lütfen tekrar giriş yapın. |

- [ ] **Step 3: Add the link card to `src/pages/account/index.astro`**

Immediately before the `<div id="writerCard" ...>` element (around line 87), insert:

```html
        <!-- Send as RSG (only for authorised senders) -->
        <div id="senderCard" class="hidden bg-white rounded-2xl border border-border shadow-sm p-6 flex items-start justify-between gap-4">
          <div>
            <h2 class="text-sm font-semibold text-navy mb-1">Send mail as RSG</h2>
            <p class="text-sm text-gray-500">You are authorised to send mail from the RSG Turkiye address.</p>
          </div>
          <a href="/account/mail" class="shrink-0 px-4 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors">Open</a>
        </div>
```

In the page's `<script>`, find the existing `if (data.user.is_writer) {` block (around line 253) and add immediately before it:

```ts
      if (data.user.is_sender) {
        document.getElementById('senderCard')!.classList.remove('hidden');
      }
```

- [ ] **Step 4: Add the same card to `src/pages/tr/account/index.astro`**

Same insertion points, with `href="/tr/account/mail"` and:

- heading: `RSG Adına Mail Gönder`
- description: `RSG Türkiye adresinden mail gönderme yetkiniz var.`
- button: `Aç`

- [ ] **Step 5: Verify the build and both routes**

Run: `npx astro check`
Expected: no new errors.

Run: `npm run build`
Expected: build succeeds and lists `account/mail/index.html` and `tr/account/mail/index.html` among the built pages.

With `npx wrangler pages dev -- npm run dev` running, open `http://localhost:8788/account/mail`:
- Signed out, or signed in as a user with `is_sender = 0` → the "not authorised" panel, no compose form.
- With `is_sender = 1` → the compose form, and the language switcher in the header goes to `/tr/account/mail`.

- [ ] **Step 6: Commit**

```bash
git add src/pages/account/mail.astro src/pages/tr/account/mail.astro \
        src/pages/account/index.astro src/pages/tr/account/index.astro
git commit -m "Add compose page for sending mail as RSG (EN + TR)"
```

---

### Task 9: Admin panel section (EN + TR)

**Files:**
- Modify: `src/pages/admin/index.astro` (markup after `blogSubmissionsSection`, around line 126; script additions before the closing `</script>`)
- Modify: `src/pages/tr/admin/index.astro` (same)

**Interfaces:**
- Consumes: `GET/POST/PATCH /api/admin/senders`, `GET/POST/PATCH /api/admin/mail-attachments`, `GET /api/mail/history?scope=all`, `PATCH /api/admin/users` with `make_sender` / `remove_sender`.
- Produces: no exports.

- [ ] **Step 1: Add the per-user toggle to the existing action menu**

In `src/pages/admin/index.astro`, inside `renderUsers`'s `moreActions` template, after the `is_writer` ternary block, add:

```ts
            ${u.is_sender
              ? `<button data-id="${u.id}" data-action="remove_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Remove RSG sender</button>`
              : `<button data-id="${u.id}" data-action="make_sender" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50">Make RSG sender</button>`
            }
```

Next to `writerBadge` (defined around line 327), add a `senderBadge` following the same shape, and append it to the badges cell:

```ts
      const senderBadge = u.is_sender
        ? '<span class="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 ml-1">mail</span>'
        : '';
```

Change the badges cell from `${writerBadge}${privateBadge}` to `${writerBadge}${senderBadge}${privateBadge}`.

The existing `doAction` helper already reloads the user list after a successful PATCH, so no extra wiring is needed. Add a call to `loadSenders()` (Step 3) at the end of `doAction` so the senders table below stays in step.

- [ ] **Step 2: Add the section markup**

After the `blogSubmissionsSection` div (which closes around line 127) and before the closing `</div>` of `adminContent`, insert:

```html
        <!-- Send as RSG -->
        <div id="rsgMailSection" class="mt-8">
          <h2 class="text-lg font-semibold text-navy mb-4">Send as RSG</h2>

          <div class="bg-white rounded-2xl border border-border shadow-sm p-6 mb-4">
            <h3 class="text-sm font-semibold text-navy mb-3">Grant in bulk</h3>
            <form id="bulkGrantForm" class="flex flex-col gap-3">
              <textarea id="bulkEmails" rows="4" required
                placeholder="Paste member emails, separated by commas or newlines"
                class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid"></textarea>
              <div class="flex items-center gap-3">
                <input id="bulkTeam" type="text" placeholder="Team (optional, e.g. sponsorship)"
                  class="flex-1 px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
                <button type="submit" class="px-5 py-2 rounded-xl bg-navy text-white text-sm font-medium hover:bg-navy-mid transition-colors">Grant</button>
              </div>
              <p id="bulkResult" class="hidden text-xs"></p>
            </form>
          </div>

          <div class="bg-white rounded-2xl border border-border shadow-sm p-6 mb-4">
            <h3 class="text-sm font-semibold text-navy mb-3">Authorised senders</h3>
            <div id="sendersList" class="flex flex-col gap-2"></div>
            <p id="sendersEmpty" class="hidden text-sm text-gray-400">No authorised senders.</p>
          </div>

          <div class="bg-white rounded-2xl border border-border shadow-sm p-6 mb-4">
            <h3 class="text-sm font-semibold text-navy mb-3">Attachment library</h3>
            <input id="attachmentFile" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx,.pptx"
              class="text-sm text-gray-500 mb-3 block" />
            <div id="attachmentAdminList" class="flex flex-col gap-2"></div>
          </div>

          <div class="bg-white rounded-2xl border border-border shadow-sm p-6">
            <h3 class="text-sm font-semibold text-navy mb-3">All sent mail</h3>
            <div id="allSendsList" class="flex flex-col gap-2"></div>
            <p id="allSendsEmpty" class="hidden text-sm text-gray-400">Nothing sent yet.</p>
          </div>
        </div>
```

- [ ] **Step 3: Add the script**

Inside the page's existing `<script>`, before the final initialisation call, add:

```ts
  async function loadSenders() {
    const res = await fetch('/api/admin/senders');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('sendersList')!;
    const empty = document.getElementById('sendersEmpty')!;
    if (!data.senders.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = data.senders.map((s: any) => `
      <div class="flex items-center justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
        <div>
          <div class="text-navy">${escapeHtml(s.display_name ?? s.email)}</div>
          <div class="text-xs text-gray-400">
            ${escapeHtml(s.email)}${s.team ? ` · ${escapeHtml(s.team)}` : ''}
            ${s.granted_at ? ` · granted ${formatDate(s.granted_at)}` : ''}
            ${s.granted_by_email ? ` by ${escapeHtml(s.granted_by_email)}` : ''}
          </div>
        </div>
        <button data-id="${escapeHtml(s.user_id)}" class="revoke-sender-btn text-xs px-3 py-1.5 rounded-lg border border-border text-red-500 hover:bg-red-50">Revoke</button>
      </div>`).join('');

    list.querySelectorAll<HTMLButtonElement>('.revoke-sender-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await fetch('/api/admin/senders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: btn.dataset.id, action: 'revoke' }),
        });
        if (res.ok) {
          showToast('Sender revoked');
          await Promise.all([loadSenders(), loadUsers()]);
        } else {
          btn.disabled = false;
          showToast('Could not revoke', true);
        }
      });
    });
  }

  function setupBulkGrant() {
    const form = document.getElementById('bulkGrantForm') as HTMLFormElement;
    const result = document.getElementById('bulkResult')!;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/api/admin/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          emails: (document.getElementById('bulkEmails') as HTMLTextAreaElement).value,
          team: (document.getElementById('bulkTeam') as HTMLInputElement).value,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        showToast('Bulk grant failed', true);
        return;
      }
      // Unmatched addresses are shown, never swallowed: a typo'd address is
      // a person who silently will not be able to send.
      result.classList.remove('hidden');
      result.className = data.unknown.length ? 'text-xs text-red-600' : 'text-xs text-green-700';
      result.textContent = data.unknown.length
        ? `Granted ${data.granted.length}. No account found for: ${data.unknown.join(', ')}`
        : `Granted ${data.granted.length}.`;
      form.reset();
      await Promise.all([loadSenders(), loadUsers()]);
    });
  }

  async function loadAdminAttachments() {
    const res = await fetch('/api/admin/mail-attachments');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('attachmentAdminList')!;
    list.innerHTML = data.attachments.map((a: any) => `
      <div class="flex items-center justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
        <div>
          <div class="text-navy ${a.is_active ? '' : 'line-through text-gray-400'}">${escapeHtml(a.filename)}</div>
          <div class="text-xs text-gray-400">${Math.round(a.size_bytes / 1024)} KB · ${formatDate(a.uploaded_at)}</div>
        </div>
        <button data-id="${escapeHtml(a.id)}" data-active="${a.is_active}"
          class="toggle-attachment-btn text-xs px-3 py-1.5 rounded-lg border border-border text-gray-600 hover:bg-gray-50">
          ${a.is_active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>`).join('');

    list.querySelectorAll<HTMLButtonElement>('.toggle-attachment-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        await fetch('/api/admin/mail-attachments', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: btn.dataset.id, is_active: btn.dataset.active !== '1' }),
        });
        await loadAdminAttachments();
      });
    });
  }

  function setupAttachmentUpload() {
    const input = document.getElementById('attachmentFile') as HTMLInputElement;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const res = await fetch('/api/admin/mail-attachments', {
        method: 'POST',
        headers: {
          'Content-Type': file.type,
          'X-Filename': encodeURIComponent(file.name),
        },
        body: file,
      });
      const data = await res.json().catch(() => null);
      input.value = '';
      if (res.ok && data?.ok) {
        showToast('Attachment uploaded');
        await loadAdminAttachments();
      } else {
        showToast(data?.error ?? 'Upload failed', true);
      }
    });
  }

  async function loadAllSends() {
    const res = await fetch('/api/mail/history?scope=all');
    if (!res.ok) return;
    const data = await res.json();
    const list = document.getElementById('allSendsList')!;
    const empty = document.getElementById('allSendsEmpty')!;
    if (!data.sends.length) {
      list.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    list.innerHTML = data.sends.map((s: any) => `
      <div class="flex items-start justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
        <div class="min-w-0">
          <div class="text-navy truncate">${escapeHtml(s.subject)}</div>
          <div class="text-xs text-gray-400">
            ${escapeHtml(s.sender_name ?? s.sender_email)} → ${escapeHtml(s.recipient_email)} · ${formatDate(s.sent_at)}
          </div>
          ${s.status === 'failed' ? `<div class="text-xs text-red-600 mt-0.5">${escapeHtml(s.error_message)}</div>` : ''}
        </div>
        <span class="shrink-0 text-xs px-2 py-0.5 rounded-full ${
          s.status === 'sent' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
        }">${s.status === 'sent' ? 'Sent' : 'Failed'}</span>
      </div>`).join('');
  }
```

Then call the four loaders wherever the page already calls `loadAnnouncements()` and `loadBlogSubmissions()` after confirming the user is an admin:

```ts
    setupBulkGrant();
    setupAttachmentUpload();
    await Promise.all([loadSenders(), loadAdminAttachments(), loadAllSends()]);
```

- [ ] **Step 4: Mirror everything into `src/pages/tr/admin/index.astro`**

Same markup and script, with these strings translated:

| English | Turkish |
|---|---|
| Send as RSG | RSG Adına Gönderim |
| Grant in bulk | Toplu yetkilendirme |
| Paste member emails, separated by commas or newlines | Üye e-postalarını virgül veya satır sonuyla ayırarak yapıştırın |
| Team (optional, e.g. sponsorship) | Ekip (opsiyonel, örn. sponsorluk) |
| Grant | Yetki ver |
| Authorised senders | Yetkili göndericiler |
| No authorised senders. | Yetkili gönderici yok. |
| Revoke | Yetkiyi al |
| Sender revoked | Yetki alındı |
| Could not revoke | Yetki alınamadı |
| Granted N. | N kişiye yetki verildi. |
| Granted N. No account found for: … | N kişiye yetki verildi. Şu adreslere ait hesap bulunamadı: … |
| Bulk grant failed | Toplu yetkilendirme başarısız |
| Attachment library | Ek kütüphanesi |
| Deactivate / Reactivate | Pasifleştir / Aktifleştir |
| Attachment uploaded | Ek yüklendi |
| Upload failed | Yükleme başarısız |
| All sent mail | Tüm gönderimler |
| Nothing sent yet. | Henüz gönderim yok. |
| Sent / Failed | Gönderildi / Başarısız |
| Make RSG sender / Remove RSG sender | RSG göndericisi yap / RSG gönderici yetkisini al |
| granted … by … | … tarihinde … tarafından verildi |

Use `toLocaleString('tr-TR')` in the Turkish page's `formatDate` if it does not already.

- [ ] **Step 5: Verify both admin panels**

Run: `npx astro check` — no new errors.
Run: `npm run build` — succeeds.

With the dev server running, signed in as an admin, open `/admin` and `/tr/admin`:
- The "Send as RSG" section renders with all four cards.
- Bulk-granting a list containing one real and one fake address reports both, and the granted user appears in "Authorised senders" with the team and granter shown.
- The user row's `⋯` menu shows "Remove RSG sender" for that user, and the `mail` badge appears in their badges cell.
- Revoking removes them from the table and flips the menu item back.
- Uploading a PDF adds it to the library; deactivating strikes it through and removes it from the compose page's checkbox list.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/index.astro src/pages/tr/admin/index.astro
git commit -m "Add Send as RSG admin section (EN + TR)"
```

---

### Task 10: Operator documentation

**Files:**
- Modify: `README.md` (new subsection after "Member blog submissions — required setup", around line 126)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

- [ ] **Step 1: Add the README section**

Insert after the "Member blog submissions — required setup" list and before the `---` that precedes `## Content Types`:

````markdown
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
````

- [ ] **Step 2: Verify the links and code fences render**

Run: `npx astro check`
Expected: no new errors (README is not part of the build, but this confirms nothing else broke).

Read the rendered section on GitHub after pushing, or preview locally, and confirm the nested code fences inside the numbered list display correctly.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the setup required to send mail as RSG"
```

---

## Final verification

After all ten tasks, with `GMAIL_REFRESH_TOKEN` set by an operator, walk the spec's acceptance scenarios end to end:

- [ ] A user with `is_sender = 0` POSTs `/api/mail/send` → **403**, and `SELECT COUNT(*) FROM sent_emails` is unchanged.
- [ ] A user with `is_sender = 1` sends to one real address → 200; `sent_emails` has `status = 'sent'` and a non-null `gmail_message_id`; the message appears in `turkey.rsg@gmail.com`'s **Sent** folder; the received mail's `Reply-To` is the sending member's address and its `From` display name reads `RSG Türkiye (<their name>)`.
- [ ] Send to three addresses in one compose → three separate messages arrive, each showing only its own address in `To:`, and three `sent_emails` rows exist.
- [ ] Temporarily set `GMAIL_REFRESH_TOKEN` to a bad value → the UI shows a clean error, and a row exists with `status = 'failed'` and a populated `error_message`. Nothing is silently dropped.
- [ ] Exceed 20 recipients in an hour → **429**, `code: "rate_limit_hour"`, and no new row.
- [ ] A member requests `/api/mail/history?scope=all` → only their own sends. An admin gets everyone's.
- [ ] Bulk grant with two unknown addresses → the known users are granted; the two unknown addresses are listed back in the UI.
- [ ] A Turkish subject and body with `ş ğ ı ç ö ü İ` arrive uncorrupted in the received mail.
- [ ] `/account/mail` loaded without the permission → no compose form.
- [ ] `npm test` passes; `npx astro check` reports no new errors; `npm run build` succeeds.
