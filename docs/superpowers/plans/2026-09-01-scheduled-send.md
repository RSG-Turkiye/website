# Scheduled Sending — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member choose when a composed message goes out, see and edit and cancel what is queued, and have it sent reliably with nobody present.

**Architecture:** Queued messages live in their own `scheduled_emails` table — one row per compose, holding a recipient list — because SQLite cannot alter `sent_emails`'s CHECK constraint and a queued message is a different entity anyway. The send path is first extracted from the endpoint into a shared module so the dispatcher reuses it rather than duplicating it. A 15-minute GitHub Actions cron calls a secret-protected dispatch endpoint, which fans a due row out into ordinary per-recipient `sent_emails` rows.

**Tech Stack:** TypeScript, Cloudflare Pages Functions, D1, R2, Astro 5 pages with inline scripts, GitHub Actions. Tests: `node --test` via the existing `tsx` loader. No new npm dependency.

**Spec:** `docs/superpowers/specs/2026-09-01-scheduled-send-design.md`

## Global Constraints

- Queued messages go in a **new `scheduled_emails` table**, never as a new `sent_emails.status` — the existing `CHECK (status IN ('sent','failed'))` cannot be altered in SQLite without rebuilding the table.
- A queued row is **one row per compose** with a JSON recipient list. It fans out into **one `sent_emails` row per recipient** only when it actually sends.
- Cancelling **deletes** the row. `sent_emails` is the permanent record; a message cancelled before sending was never sent.
- Maximum **60 days** ahead (`60 * 24 * 3600` seconds). A time in the past is rejected, not silently sent now.
- Times are stored as **unix seconds UTC**. The browser converts to and from the member's local time.
- **Rate limit is consumed at send time, not schedule time.**
- Failure handling is asymmetric: **rate limit full** is transient — retry for **6 hours** (`6 * 3600`), then give up; **permission revoked or attachment deactivated** is terminal — fail immediately. Either way, write `failed` rows into `sent_emails` with the reason. Nothing disappears.
- `/api/mail/dispatch` requires `MAIL_SYNC_SECRET`; without it, 403.
- Edit and cancel verify the row's `sender_user_id` against the session.
- The cron workflow must be committed by **RSG's shared bot account** — GitHub runs a scheduled workflow as whoever last committed its cron, and a personal account leaving the org stops the schedule.
- Every user-facing string exists in both `src/pages/account/mail.astro` and `src/pages/tr/account/mail.astro`.

## File Structure

**Create:**
- `functions/_lib/schedule.ts` — pure scheduling rules: validation and the retry/give-up decision. No I/O.
- `functions/_lib/compose.ts` — the shared send path, extracted from `send.ts`: attachment resolution, the per-recipient send-and-log loop, and failure logging. Used by both the endpoint and the dispatcher.
- `functions/api/mail/dispatch.ts` — the cron target.
- `functions/api/mail/scheduled.ts` — list, edit, cancel.
- `.github/workflows/mail-dispatch.yml` — the 15-minute cron.
- `tests/schedule.test.ts`

**Modify:**
- `db/schema.sql` — the new table, indexes, and a migration note.
- `functions/_lib/auth.ts` — `Env.MAIL_SYNC_SECRET`.
- `functions/api/mail/send.ts` — use `compose.ts`; accept an optional `scheduled_at`.
- `src/pages/account/mail.astro`, `src/pages/tr/account/mail.astro` — the Send-at field, the Queued list, and edit mode.
- `README.md` — the new secret, the cron's bot-account requirement, and the 60-day inactivity note.

---

### Task 1: Schema and config

**Files:**
- Modify: `db/schema.sql`
- Modify: `functions/_lib/auth.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: table `scheduled_emails`; `Env.MAIL_SYNC_SECRET: string`.

- [ ] **Step 1: Add the migration note**

`db/schema.sql` opens with a block of numbered `-- REQUIRED:` notes, currently ending at item 4b. Append after it:

```sql
--
-- 5.  This file's `scheduled_emails` table below is NOT applied by any deploy
--     step -- run it by hand before deploying (`IF NOT EXISTS` makes it safe
--     to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, /api/mail/scheduled and /api/mail/dispatch 500 with
--     "no such table: scheduled_emails".
```

- [ ] **Step 2: Add the table**

Append at the end of `db/schema.sql`:

```sql
-- Mail composed now and sent later. Deliberately NOT a new status on
-- sent_emails: SQLite cannot alter that table's CHECK constraint, and a queued
-- message is a different thing anyway -- one row holding a recipient list, no
-- sent_at, no gmail_message_id, and cancellable. It fans out into one
-- sent_emails row per recipient only when it actually goes.
--
-- Cancelling deletes the row. The queue is transient; sent_emails is the
-- permanent record, and a message cancelled before sending was never sent.
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id              TEXT PRIMARY KEY,
  sender_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipients      TEXT NOT NULL,
  recipient_name  TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  attachment_ids  TEXT NOT NULL DEFAULT '[]',
  scheduled_at    INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due ON scheduled_emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_sender ON scheduled_emails(sender_user_id);
```

`recipients` and `attachment_ids` hold JSON arrays, matching how `sent_emails.attachment_ids` already stores one.

- [ ] **Step 3: Add the secret to `Env`**

In `functions/_lib/auth.ts`, in the `Env` interface, after `RSG_MAIL_FROM`:

```ts
  MAIL_SYNC_SECRET: string;
```

- [ ] **Step 4: Verify**

Run: `npx astro check` — 0 errors, 0 warnings, 21 hints.
Run: `npx wrangler d1 execute rsg-members --local --file=db/schema.sql` — completes.
Run: `npx wrangler d1 execute rsg-members --local --command="SELECT name FROM sqlite_master WHERE name='scheduled_emails'"` — one row.

- [ ] **Step 5: Commit**

```bash
git add db/schema.sql functions/_lib/auth.ts
git commit -m "Add the scheduled_emails table and the dispatch secret binding"
```

---

### Task 2: Pure scheduling rules

**Files:**
- Create: `functions/_lib/schedule.ts`
- Create: `tests/schedule.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_SCHEDULE_AHEAD_SECONDS = 60 * 24 * 3600`, `RETRY_WINDOW_SECONDS = 6 * 3600`
  - `validateScheduledAt(value: unknown, now: number): { ok: true; scheduledAt: number } | { ok: false; code: string }` — codes `invalid_schedule_time`, `schedule_in_past`, `schedule_too_far`
  - `shouldGiveUp(firstTriedAt: number | null, now: number): boolean`

This task is **TDD**.

- [ ] **Step 1: Write the failing test**

Create `tests/schedule.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateScheduledAt,
  shouldGiveUp,
  MAX_SCHEDULE_AHEAD_SECONDS,
  RETRY_WINDOW_SECONDS,
} from '../functions/_lib/schedule';

const NOW = 1_800_000_000;

test('accepts a time in the future and returns it', () => {
  assert.deepEqual(validateScheduledAt(NOW + 3600, NOW), { ok: true, scheduledAt: NOW + 3600 });
});

test('rejects a non-integer or absent value', () => {
  for (const bad of [undefined, null, 'tomorrow', 1.5, NaN, {}, []]) {
    assert.deepEqual(
      validateScheduledAt(bad, NOW),
      { ok: false, code: 'invalid_schedule_time' },
      String(bad) + ' must be rejected',
    );
  }
});

test('rejects a time in the past', () => {
  assert.deepEqual(validateScheduledAt(NOW - 1, NOW), { ok: false, code: 'schedule_in_past' });
});

test('accepts exactly now, and exactly the far limit', () => {
  assert.equal(validateScheduledAt(NOW, NOW).ok, true);
  assert.equal(validateScheduledAt(NOW + MAX_SCHEDULE_AHEAD_SECONDS, NOW).ok, true);
});

test('rejects one second beyond the far limit', () => {
  assert.deepEqual(
    validateScheduledAt(NOW + MAX_SCHEDULE_AHEAD_SECONDS + 1, NOW),
    { ok: false, code: 'schedule_too_far' },
  );
});

test('the far limit is 60 days and the retry window is 6 hours', () => {
  assert.equal(MAX_SCHEDULE_AHEAD_SECONDS, 60 * 24 * 3600);
  assert.equal(RETRY_WINDOW_SECONDS, 6 * 3600);
});

test('a row that has never been tried is never given up on', () => {
  assert.equal(shouldGiveUp(null, NOW), false);
});

test('gives up only after the retry window has fully elapsed', () => {
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS + 1, NOW), false);
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS, NOW), false);
  assert.equal(shouldGiveUp(NOW - RETRY_WINDOW_SECONDS - 1, NOW), true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/schedule'`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/schedule.ts`:

```ts
/**
 * When a queued message may be sent, and when to stop trying.
 *
 * Pure and free of I/O so the arithmetic can be tested exhaustively; the
 * dispatcher supplies `now` rather than reading the clock here.
 */

/** Unbounded scheduling means a forgotten message surfacing months later. */
export const MAX_SCHEDULE_AHEAD_SECONDS = 60 * 24 * 3600;

/** How long a rate-limited message keeps trying before it is recorded failed. */
export const RETRY_WINDOW_SECONDS = 6 * 3600;

export type ScheduleValidation =
  | { ok: true; scheduledAt: number }
  | { ok: false; code: string };

export function validateScheduledAt(value: unknown, now: number): ScheduleValidation {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return { ok: false, code: 'invalid_schedule_time' };
  }
  if (value < now) return { ok: false, code: 'schedule_in_past' };
  if (value > now + MAX_SCHEDULE_AHEAD_SECONDS) return { ok: false, code: 'schedule_too_far' };
  return { ok: true, scheduledAt: value };
}

/**
 * A message is only abandoned once the whole retry window has elapsed since
 * the first attempt. Late is better than silent; forever is worse than a
 * recorded failure.
 */
export function shouldGiveUp(firstTriedAt: number | null, now: number): boolean {
  if (firstTriedAt === null) return false;
  return now - firstTriedAt > RETRY_WINDOW_SECONDS;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test` — all pass.
Run: `npx astro check` — baseline.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/schedule.ts tests/schedule.test.ts
git commit -m "Add pure scheduling rules for queued mail"
```

---

### Task 3: Extract the send path into a shared module

Behaviour must not change. This is a refactor whose only purpose is that the dispatcher in Task 4 reuses this code instead of duplicating attachment resolution, MIME assembly, the per-recipient loop and the logging.

**Files:**
- Create: `functions/_lib/compose.ts`
- Modify: `functions/api/mail/send.ts`

**Interfaces:**
- Consumes: `buildMime`, `sendMail`, `GmailError`, `encodeAttachmentBody`, `MimeAttachment` from `gmail.ts`; `renderBody` from `markdown.ts`; `MAX_ATTACHMENT_BYTES` from `mail.ts`; `generateId` from `auth.ts`.
- Produces:
  - `interface ComposeInput { senderUserId: string; recipients: string[]; recipientName: string | null; subject: string; body: string; attachmentIds: string[] }`
  - `interface RecipientResult { recipient: string; status: 'sent' | 'failed'; error?: string }`
  - `resolveAttachments(env: Env, attachmentIds: string[]): Promise<{ ok: true; attachments: MimeAttachment[] } | { ok: false; code: string }>`
  - `sendAndLog(env: Env, input: ComposeInput, attachments: MimeAttachment[]): Promise<RecipientResult[]>`
  - `logFailure(env: Env, input: ComposeInput, reason: string): Promise<void>`

- [ ] **Step 1: Create the module**

Create `functions/_lib/compose.ts`:

```ts
import type { Env } from './auth';
import { generateId } from './auth';
import { buildMime, sendMail, GmailError, encodeAttachmentBody, type MimeAttachment } from './gmail';
import { MAX_ATTACHMENT_BYTES } from './mail';
import { renderBody } from './markdown';

/**
 * The send path, shared by the compose endpoint and the scheduled dispatcher.
 *
 * It lives here rather than in the endpoint so the dispatcher does not have to
 * reimplement attachment resolution, MIME assembly, the per-recipient fan-out
 * and the logging — four things that must stay identical whether mail goes now
 * or in three days.
 */

export interface ComposeInput {
  senderUserId: string;
  recipients: string[];
  recipientName: string | null;
  subject: string;
  /** Markdown source, exactly as the member wrote it. */
  body: string;
  attachmentIds: string[];
}

export interface RecipientResult {
  recipient: string;
  status: 'sent' | 'failed';
  error?: string;
}

interface AttachmentRow {
  id: string;
  filename: string;
  r2_key: string;
  content_type: string;
  size_bytes: number;
}

export type AttachmentResolution =
  | { ok: true; attachments: MimeAttachment[] }
  | { ok: false; code: string };

export async function resolveAttachments(
  env: Env,
  attachmentIds: string[],
): Promise<AttachmentResolution> {
  if (attachmentIds.length === 0) return { ok: true, attachments: [] };

  const placeholders = attachmentIds.map(() => '?').join(',');
  const rows = await env.DB.prepare(
    `SELECT id, filename, r2_key, content_type, size_bytes
     FROM mail_attachments
     WHERE is_active = 1 AND id IN (${placeholders})`
  ).bind(...attachmentIds).all<AttachmentRow>();

  if (rows.results.length !== attachmentIds.length) {
    return { ok: false, code: 'unknown_attachment' };
  }

  const total = rows.results.reduce((sum, r) => sum + r.size_bytes, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    return { ok: false, code: 'attachments_too_large' };
  }

  const attachments: MimeAttachment[] = [];
  for (const row of rows.results) {
    const object = await env.MAIL_ATTACHMENTS.get(row.r2_key);
    if (!object) return { ok: false, code: 'unknown_attachment' };
    // Encode once here, not inside buildMime: buildMime runs once per
    // recipient below, and re-encoding the same bytes for every recipient is
    // both wasted work and, at the attachment size ceiling, a real risk of
    // exhausting the Worker isolate's memory mid-loop.
    attachments.push({
      filename: row.filename,
      contentType: row.content_type,
      base64Body: encodeAttachmentBody(new Uint8Array(await object.arrayBuffer())),
    });
  }

  return { ok: true, attachments };
}

async function insertLog(
  env: Env,
  input: ComposeInput,
  recipient: string,
  gmailId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sent_emails
      (id, sender_user_id, recipient_email, recipient_name, subject, body_snapshot,
       attachment_ids, gmail_message_id, status, error_message, sent_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    generateId(),
    input.senderUserId,
    recipient,
    input.recipients.length === 1 ? input.recipientName : null,
    input.subject,
    input.body,
    JSON.stringify(input.attachmentIds),
    gmailId,
    gmailId ? 'sent' : 'failed',
    errorMessage,
    Math.floor(Date.now() / 1000),
  ).run();
}

export async function sendAndLog(
  env: Env,
  input: ComposeInput,
  attachments: MimeAttachment[],
): Promise<RecipientResult[]> {
  const results: RecipientResult[] = [];

  // One Gmail message per recipient: putting ten professors on one To: line
  // would show each of them the entire outreach list.
  for (const recipient of input.recipients) {
    let gmailId: string | null = null;
    let errorMessage: string | null = null;

    try {
      const raw = buildMime({
        fromAddress: env.RSG_MAIL_FROM,
        // The recipient sees the organisation, not the individual. The member
        // identifies themselves in the body; sent_emails records who sent what.
        fromName: 'RSG Türkiye',
        to: recipient,
        // Replies go to the RSG mailbox so the team's correspondence stays in
        // one place.
        replyTo: env.RSG_MAIL_FROM,
        subject: input.subject,
        body: renderBody(input.body),
        attachments,
      });
      gmailId = await sendMail(env, raw);
    } catch (err) {
      errorMessage = err instanceof GmailError ? err.message : String(err);
    }

    await insertLog(env, input, recipient, gmailId, errorMessage);

    results.push(
      gmailId
        ? { recipient, status: 'sent' }
        : { recipient, status: 'failed', error: errorMessage ?? 'unknown error' },
    );
  }

  return results;
}

/**
 * Record a compose that was never attempted — a queued message whose sender
 * lost permission, or whose attachment was retired. It belongs in the log as a
 * failure with a reason, not nowhere.
 */
export async function logFailure(env: Env, input: ComposeInput, reason: string): Promise<void> {
  for (const recipient of input.recipients) {
    await insertLog(env, input, recipient, null, reason);
  }
}
```

- [ ] **Step 2: Rewrite `send.ts` to use it**

In `functions/api/mail/send.ts`, replace the three imports of `buildMime`/`sendMail`/`GmailError`/`encodeAttachmentBody`/`MimeAttachment`, `MAX_ATTACHMENT_BYTES`, and `renderBody` with:

```ts
import { validateCompose, checkRateLimit } from '../../_lib/mail';
import { resolveAttachments, sendAndLog, type ComposeInput } from '../../_lib/compose';
```

Keep the `auth` import; `generateId` is no longer used here, so drop it from that import if nothing else needs it. Delete the local `AttachmentRow` interface.

Replace everything from the `const attachmentIds = ...` line through the end of the handler with:

```ts
  const attachmentIds = Array.isArray(input.attachment_ids)
    ? [...new Set(input.attachment_ids)]
    : [];

  const resolved = await resolveAttachments(env, attachmentIds);
  if (!resolved.ok) {
    return jsonResponse({ error: 'Attachment problem', code: resolved.code }, 400);
  }

  const composeInput: ComposeInput = {
    senderUserId: user.id,
    recipients,
    recipientName: input.recipient_name?.trim() || null,
    subject: input.subject.trim(),
    body: input.body.trim(),
    attachmentIds,
  };

  const results = await sendAndLog(env, composeInput, resolved.attachments);
  const anySent = results.some(r => r.status === 'sent');
  return jsonResponse({ ok: anySent, results }, anySent ? 200 : 502);
```

The rate-limit check stays exactly where it was, before this block.

- [ ] **Step 3: Verify nothing changed**

Run: `npx astro check` — 0 errors, 0 warnings, 21 hints.
Run: `npm test` — all pass.
Run: `npm run build` — succeeds.

Then confirm the endpoint still behaves. The old seed file was deleted with its
workspace, so create a sender and a session by hand first:

```bash
npx wrangler d1 execute rsg-members --local --command="INSERT OR IGNORE INTO users (id,google_id,email,is_member,is_admin,is_announcer,is_writer,is_sender,created_at,last_login) VALUES ('u-s','g-s','s@test.local',1,0,0,0,1,1700000000,1700000000),('u-n','g-n','n@test.local',1,0,0,0,0,1700000000,1700000000)"

npx wrangler d1 execute rsg-members --local --command="INSERT OR IGNORE INTO sessions (id,user_id,expires_at,created_at) VALUES ('sess-s','u-s',9999999999,1700000000),('sess-n','u-n',9999999999,1700000000)"
```

The session ids double as the `rsg_session` cookie value. With `npm run build && npx wrangler pages dev dist` running: a non-sender gets 403, `{"to":"not-an-email",...}` gets `invalid_email`, and a valid compose with no `GMAIL_REFRESH_TOKEN` configured locally produces a 502 with per-recipient `failed` results and matching `sent_emails` rows. Record the actual output.

- [ ] **Step 4: Commit**

```bash
git add functions/_lib/compose.ts functions/api/mail/send.ts
git commit -m "Extract the send path so the dispatcher can reuse it"
```

---

### Task 4: The dispatch endpoint

**Files:**
- Create: `functions/api/mail/dispatch.ts`

**Interfaces:**
- Consumes: `resolveAttachments`, `sendAndLog`, `logFailure`, `ComposeInput` from Task 3; `shouldGiveUp` from Task 2; `checkRateLimit` from `mail.ts`.
- Produces: `POST /api/mail/dispatch` → `{ ok: true, processed: number, sent: number, failed: number, retried: number }`.

- [ ] **Step 1: Write the endpoint**

Create `functions/api/mail/dispatch.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { checkRateLimit } from '../../_lib/mail';
import { shouldGiveUp } from '../../_lib/schedule';
import { resolveAttachments, sendAndLog, logFailure, type ComposeInput } from '../../_lib/compose';

interface ScheduledRow {
  id: string;
  sender_user_id: string;
  recipients: string;
  recipient_name: string | null;
  subject: string;
  body: string;
  attachment_ids: string;
  first_tried_at: number | null;
}

/** At most this many queued messages per call, so one tick cannot run long. */
const BATCH = 20;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // Without this, anyone could drain the queue early or burn the Gmail quota
  // by hammering the endpoint.
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  const now = Math.floor(Date.now() / 1000);

  const due = await env.DB.prepare(
    `SELECT id, sender_user_id, recipients, recipient_name, subject, body,
            attachment_ids, first_tried_at
     FROM scheduled_emails
     WHERE scheduled_at <= ?
     ORDER BY scheduled_at ASC
     LIMIT ?`
  ).bind(now, BATCH).all<ScheduledRow>();

  let sent = 0;
  let failed = 0;
  let retried = 0;

  for (const row of due.results) {
    const recipients: string[] = JSON.parse(row.recipients);
    const attachmentIds: string[] = JSON.parse(row.attachment_ids);

    const input: ComposeInput = {
      senderUserId: row.sender_user_id,
      recipients,
      recipientName: row.recipient_name,
      subject: row.subject,
      body: row.body,
      attachmentIds,
    };

    const drop = async (reason: string) => {
      await logFailure(env, input, reason);
      await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
      failed++;
    };

    // Revoking someone's permission has to stop mail they queued before it was
    // revoked, or revocation means nothing. Terminal: it will not resolve.
    const sender = await env.DB.prepare('SELECT is_sender FROM users WHERE id = ?')
      .bind(row.sender_user_id).first<{ is_sender: number }>();
    if (!sender || sender.is_sender !== 1) {
      await drop('Sender no longer authorised when the scheduled time arrived');
      continue;
    }

    // An admin who retires an attachment should not have the old version go
    // out later. Also terminal.
    const resolved = await resolveAttachments(env, attachmentIds);
    if (!resolved.ok) {
      await drop('Attachment unavailable when the scheduled time arrived: ' + resolved.code);
      continue;
    }

    // A full rate limit is transient — wait for the next tick, up to the
    // retry window.
    const limit = await checkRateLimit(env.DB, row.sender_user_id, recipients.length, now);
    if (!limit.ok) {
      if (shouldGiveUp(row.first_tried_at, now)) {
        await drop('Rate limit still full after the retry window: ' + limit.code);
      } else {
        await env.DB.prepare(
          `UPDATE scheduled_emails
           SET attempts = attempts + 1,
               first_tried_at = COALESCE(first_tried_at, ?),
               last_error = ?,
               updated_at = ?
           WHERE id = ?`
        ).bind(now, limit.code, now, row.id).run();
        retried++;
      }
      continue;
    }

    const results = await sendAndLog(env, input, resolved.attachments);
    await env.DB.prepare('DELETE FROM scheduled_emails WHERE id = ?').bind(row.id).run();
    if (results.some(r => r.status === 'sent')) sent++; else failed++;
  }

  return jsonResponse({ ok: true, processed: due.results.length, sent, failed, retried });
};
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx astro check` — 0 errors, 0 warnings, 21 hints.
Run: `npm test` — all pass.

- [ ] **Step 3: Verify the scenarios against a local dev server**

Start `npm run build && npx wrangler pages dev dist`. Seed a sender and a due row by hand:

```bash
npx wrangler d1 execute rsg-members --local --command="INSERT OR IGNORE INTO users (id,google_id,email,is_member,is_admin,is_announcer,is_writer,is_sender,created_at,last_login) VALUES ('u-s','g-s','s@test.local',1,0,0,0,1,1700000000,1700000000)"

npx wrangler d1 execute rsg-members --local --command="INSERT INTO scheduled_emails (id,sender_user_id,recipients,recipient_name,subject,body,attachment_ids,scheduled_at,created_at,updated_at) VALUES ('sch-1','u-s','[\"a@b.com\"]',NULL,'Test','Body','[]',strftime('%s','now')-60,strftime('%s','now'),strftime('%s','now'))"
```

Then, recording actual output for each:

1. No secret: `curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8788/api/mail/dispatch` → **403**, and the row is still in `scheduled_emails`.
2. With the secret (set `MAIL_SYNC_SECRET` in a local `.dev.vars` file containing `MAIL_SYNC_SECRET=localtest`): `curl -s -X POST -H 'X-Dispatch-Secret: localtest' http://localhost:8788/api/mail/dispatch` → JSON with `processed: 1`. There is no real Gmail token locally, so the send fails — expect a `sent_emails` row with `status='failed'` and a populated `error_message`, and the `scheduled_emails` row gone.
3. Re-insert the row, then `UPDATE users SET is_sender = 0 WHERE id='u-s'` and dispatch → a `failed` row whose `error_message` mentions authorisation, and the queue row gone.
4. Re-insert the row and `UPDATE users SET is_sender = 1`, insert 20 `sent_emails` rows for `u-s` in the last hour to fill the limit, then dispatch → `retried: 1`, the queue row **still present** with `attempts = 1` and `first_tried_at` set. Then set `first_tried_at` to seven hours ago and dispatch again → a `failed` row and the queue row gone.

If you cannot start a dev server, say so explicitly and name what you could not run.

- [ ] **Step 4: Commit**

```bash
git add functions/api/mail/dispatch.ts
git commit -m "Add the dispatch endpoint that sends queued mail"
```

---

### Task 5: Queue, list, edit and cancel

**Files:**
- Modify: `functions/api/mail/send.ts`
- Create: `functions/api/mail/scheduled.ts`

**Interfaces:**
- Consumes: `validateScheduledAt` from Task 2; `validateCompose` from `mail.ts`.
- Produces:
  - `POST /api/mail/send` with an optional integer `scheduled_at` → `{ ok: true, scheduled: true, id }` (201) instead of sending.
  - `GET /api/mail/scheduled` → `{ scheduled: [{ id, recipients, recipient_name, subject, body, attachment_ids, scheduled_at, sender_email? }] }` — own rows; an admin gets everyone's, each with `sender_email`.
  - `PATCH /api/mail/scheduled` with `{ id, to, recipient_name?, subject, body, attachment_ids?, scheduled_at }` → `{ ok: true }`.
  - `DELETE /api/mail/scheduled` with `{ id }` → `{ ok: true }`.

- [ ] **Step 1: Let `send.ts` queue instead of sending**

In `functions/api/mail/send.ts`, add to the imports:

```ts
import { validateScheduledAt } from '../../_lib/schedule';
```

Add `scheduled_at?: number;` to the `ComposeBody` interface.

Immediately **after** the `validateCompose` block and **before** the rate-limit check, insert:

```ts
  // Queue instead of sending. The rate limit is deliberately NOT consumed
  // here: it is checked when the message actually goes out, so one member
  // cannot queue a hundred messages and lock the shared quota in advance.
  if (input.scheduled_at !== undefined) {
    const when = validateScheduledAt(input.scheduled_at, Math.floor(Date.now() / 1000));
    if (!when.ok) return jsonResponse({ error: 'Invalid schedule time', code: when.code }, 400);

    const attachmentIds = Array.isArray(input.attachment_ids)
      ? [...new Set(input.attachment_ids)]
      : [];
    const nowSec = Math.floor(Date.now() / 1000);
    const id = generateId();

    await env.DB.prepare(
      `INSERT INTO scheduled_emails
        (id, sender_user_id, recipients, recipient_name, subject, body,
         attachment_ids, scheduled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      user.id,
      JSON.stringify(recipients),
      input.recipient_name?.trim() || null,
      input.subject.trim(),
      input.body.trim(),
      JSON.stringify(attachmentIds),
      when.scheduledAt,
      nowSec,
      nowSec,
    ).run();

    return jsonResponse({ ok: true, scheduled: true, id }, 201);
  }
```

This needs `generateId` from `'../../_lib/auth'`; add it back to that import if Task 3 removed it.

- [ ] **Step 2: Write the queue endpoint**

Create `functions/api/mail/scheduled.ts`:

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { validateCompose } from '../../_lib/mail';
import { validateScheduledAt } from '../../_lib/schedule';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1 && user.is_admin !== 1) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }

  // An admin sees every member's queue, matching how the send log already works.
  const result = user.is_admin === 1
    ? await env.DB.prepare(
        `SELECT s.id, s.recipients, s.recipient_name, s.subject, s.body,
                s.attachment_ids, s.scheduled_at, u.email AS sender_email
         FROM scheduled_emails s
         JOIN users u ON u.id = s.sender_user_id
         ORDER BY s.scheduled_at ASC LIMIT 200`
      ).all()
    : await env.DB.prepare(
        `SELECT id, recipients, recipient_name, subject, body,
                attachment_ids, scheduled_at
         FROM scheduled_emails
         WHERE sender_user_id = ?
         ORDER BY scheduled_at ASC LIMIT 200`
      ).bind(user.id).all();

  return jsonResponse({ scheduled: result.results });
};

/** Knowing an id is not authorisation: the row must belong to this member. */
async function ownRow(env: Env, id: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT id FROM scheduled_emails WHERE id = ? AND sender_user_id = ?'
  ).bind(id, userId).first<{ id: string }>();
  return row !== null;
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const body = parsed as Record<string, unknown>;

  if (typeof body.id !== 'string' || typeof body.to !== 'string'
      || typeof body.subject !== 'string' || typeof body.body !== 'string'
      || (body.recipient_name !== undefined && typeof body.recipient_name !== 'string')) {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  if (!(await ownRow(env, body.id, user.id))) {
    return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  }

  const validation = validateCompose({ to: body.to, subject: body.subject, body: body.body });
  if (!validation.ok) return jsonResponse({ error: 'Invalid compose', code: validation.code }, 400);

  const when = validateScheduledAt(body.scheduled_at, Math.floor(Date.now() / 1000));
  if (!when.ok) return jsonResponse({ error: 'Invalid schedule time', code: when.code }, 400);

  const attachmentIds = Array.isArray(body.attachment_ids)
    ? [...new Set(body.attachment_ids.filter((v): v is string => typeof v === 'string'))]
    : [];

  await env.DB.prepare(
    `UPDATE scheduled_emails
     SET recipients = ?, recipient_name = ?, subject = ?, body = ?,
         attachment_ids = ?, scheduled_at = ?, updated_at = ?
     WHERE id = ? AND sender_user_id = ?`
  ).bind(
    JSON.stringify(validation.recipients),
    (body.recipient_name as string | undefined)?.trim() || null,
    body.subject.trim(),
    body.body.trim(),
    JSON.stringify(attachmentIds),
    when.scheduledAt,
    Math.floor(Date.now() / 1000),
    body.id,
    user.id,
  ).run();

  return jsonResponse({ ok: true });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.id !== 'string') {
    return jsonResponse({ error: 'Malformed body', code: 'malformed_request' }, 400);
  }

  // Cancelling deletes the row: the queue is transient, and a message
  // cancelled before sending was never sent, so it has no place in the log.
  const res = await env.DB.prepare(
    'DELETE FROM scheduled_emails WHERE id = ? AND sender_user_id = ?'
  ).bind(body.id, user.id).run();

  if (res.meta.changes === 0) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 3: Verify**

Run: `npx astro check` — baseline. Run: `npm test` — passes. Run: `npm run build` — succeeds.

Against the dev server as a sender session, recording actual output:

1. POST `/api/mail/send` with `scheduled_at` one hour ahead → **201** `{ok:true,scheduled:true,id}`, one `scheduled_emails` row, **no** `sent_emails` row.
2. POST with `scheduled_at` in the past → 400 `schedule_in_past`. With `scheduled_at` 61 days ahead → 400 `schedule_too_far`. With `scheduled_at: "tomorrow"` → 400 `invalid_schedule_time`.
3. GET `/api/mail/scheduled` → the row. As a *different* sender → not the row.
4. PATCH with another member's id → **404**, and that row unchanged.
5. DELETE with own id → 200 and the row gone; again → 404.

- [ ] **Step 4: Commit**

```bash
git add functions/api/mail/send.ts functions/api/mail/scheduled.ts
git commit -m "Queue, list, edit and cancel scheduled mail"
```

---

### Task 6: The cron, and the documentation that keeps it alive

**Files:**
- Create: `.github/workflows/mail-dispatch.yml`
- Modify: `README.md`

**Interfaces:**
- Consumes: `POST /api/mail/dispatch` from Task 4.
- Produces: nothing in code.

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/mail-dispatch.yml`:

```yaml
name: Dispatch scheduled mail

# Every 15 minutes. The odd minute is deliberate: everyone schedules on the
# hour, and GitHub's scheduler is most delayed there.
#
# TWO THINGS KEEP THIS ALIVE, and both are easy to break by accident:
#   1. GitHub runs a scheduled workflow as whoever last committed its cron.
#      This must be RSG's shared bot account -- if a personal account owns it
#      and later leaves the organisation, the schedule stops silently.
#   2. On a public repository, scheduled workflows are disabled after 60 days
#      with no repository activity. GitHub emails the owner; someone has to
#      re-enable it. A quiet stretch after the symposium is when this bites.
on:
  schedule:
    - cron: '2,17,32,47 * * * *'
  workflow_dispatch:

jobs:
  dispatch:
    name: Send due mail
    runs-on: ubuntu-latest
    steps:
      - name: Call the dispatch endpoint
        run: |
          code=$(curl -s -o /tmp/out.json -w '%{http_code}' \
            -X POST https://rsg-turkiye.iscbsc.org/api/mail/dispatch \
            -H "X-Dispatch-Secret: ${{ secrets.MAIL_SYNC_SECRET }}")
          cat /tmp/out.json
          echo
          if [ "$code" != "200" ]; then
            echo "dispatch returned HTTP $code"
            exit 1
          fi
```

The job fails loudly on a non-200 so a broken secret or a 500 surfaces as a red workflow rather than a queue that quietly stops draining.

- [ ] **Step 2: Document the setup**

In `README.md`, at the end of the "Sending mail as RSG — required setup" section (after the "Limits" paragraph), add:

```markdown
**Scheduled sending.** A member can pick a send time; a GitHub Actions workflow
(`.github/workflows/mail-dispatch.yml`) calls `/api/mail/dispatch` every 15
minutes to send what is due. It needs a shared secret in two places, the same
value in both:

```
wrangler pages secret put MAIL_SYNC_SECRET --project-name website
```

and as a repository secret named `MAIL_SYNC_SECRET` under Settings → Secrets and
variables → Actions.

Two things silently stop the queue, and neither produces an error anyone sees:

- **GitHub runs a scheduled workflow as whoever last committed its cron.** Commit
  changes to that file from RSG's shared bot account. If a personal account owns
  the schedule and that person later leaves the organisation, it stops.
- **On a public repository, scheduled workflows are disabled after 60 days of
  repository inactivity.** GitHub emails the owner and someone must re-enable
  them. A quiet stretch after a symposium is exactly when this happens.

If mail stops going out at its scheduled time, check the workflow's run history
first — a disabled schedule shows as no runs at all.
```

- [ ] **Step 3: Verify**

Run: `npx astro check` — baseline.

Check the workflow parses:

```bash
python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/mail-dispatch.yml')); print('yaml ok')"
```

Confirm the README's nested code fences still render inside the section (read the raw text and check every opening fence has a close).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/mail-dispatch.yml README.md
git commit -m "Dispatch scheduled mail on a 15-minute cron"
```

---

### Task 7: The interface (EN + TR)

**Files:**
- Modify: `src/pages/account/mail.astro`
- Modify: `src/pages/tr/account/mail.astro`

**Interfaces:**
- Consumes: `POST /api/mail/send` (with `scheduled_at`), `GET|PATCH|DELETE /api/mail/scheduled`.
- Produces: no exports.

- [ ] **Step 1: Add the markup to the English page**

In `src/pages/account/mail.astro`, immediately **after** the `</form>` that closes `composeForm`, insert:

```html
        <div id="queuedCard" class="hidden bg-white rounded-2xl border border-border shadow-sm p-6">
          <h2 class="text-sm font-semibold text-navy mb-3">Queued</h2>
          <div id="queuedList" class="flex flex-col gap-2"></div>
        </div>
```

Inside the form, immediately **before** the submit button's wrapping `div`, insert:

```html
          <div class="border-t border-border pt-3">
            <label for="mailSchedule" class="text-xs font-semibold text-navy block mb-1">
              Send at (leave empty to send now)
            </label>
            <input id="mailSchedule" type="datetime-local"
              class="px-3 py-2 rounded-xl border border-border text-sm text-navy focus:outline-none focus:border-navy-mid" />
          </div>

          <div id="editingBanner" class="hidden text-xs bg-amber-50 text-amber-800 rounded-xl px-3 py-2">
            Editing a queued message.
            <button type="button" id="cancelEditBtn" class="underline ml-1">Cancel editing</button>
          </div>
```

- [ ] **Step 2: Add the script to the English page**

Add these `ERRORS` entries to the existing map:

```ts
    invalid_schedule_time: 'That send time is not valid.',
    schedule_in_past: 'That send time is in the past.',
    schedule_too_far: 'You can only schedule up to 60 days ahead.',
    not_found: 'That queued message no longer exists.',
```

Add, before `init()`:

```ts
  // The member picks a local time; the server stores UTC seconds.
  function localToEpoch(value: string): number | undefined {
    if (!value) return undefined;
    const ms = new Date(value).getTime();
    return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
  }

  function epochToLocalInput(epoch: number): string {
    const d = new Date(epoch * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  let editingId: string | null = null;

  function setEditing(id: string | null) {
    editingId = id;
    document.getElementById('editingBanner')!.classList.toggle('hidden', id === null);
    (document.getElementById('sendBtn') as HTMLButtonElement).textContent = id ? 'Update' : 'Send';
  }

  async function loadQueued() {
    const res = await fetch('/api/mail/scheduled');
    if (!res.ok) return;
    const data: any = await res.json();
    const card = document.getElementById('queuedCard')!;
    const list = document.getElementById('queuedList')!;
    if (!data.scheduled.length) {
      card.classList.add('hidden');
      list.innerHTML = '';
      return;
    }
    card.classList.remove('hidden');
    list.innerHTML = data.scheduled.map((s: any) => `
      <div class="flex items-start justify-between gap-3 text-sm border-b border-border last:border-0 py-2">
        <div class="min-w-0">
          <div class="text-navy truncate">${escapeHtml(s.subject)}</div>
          <div class="text-xs text-gray-400">
            ${escapeHtml(JSON.parse(s.recipients).join(', '))} · ${formatDate(s.scheduled_at)}
          </div>
        </div>
        <div class="shrink-0 flex gap-2">
          <button data-id="${escapeHtml(s.id)}" class="edit-queued-btn text-xs px-3 py-1.5 rounded-lg border border-border text-navy hover:bg-gray-50">Edit</button>
          <button data-id="${escapeHtml(s.id)}" class="cancel-queued-btn text-xs px-3 py-1.5 rounded-lg border border-border text-red-500 hover:bg-red-50">Cancel</button>
        </div>
      </div>`).join('');

    list.querySelectorAll<HTMLButtonElement>('.edit-queued-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const s = data.scheduled.find((x: any) => x.id === btn.dataset.id);
        if (!s) return;
        (document.getElementById('mailTo') as HTMLInputElement).value = JSON.parse(s.recipients).join(', ');
        (document.getElementById('mailRecipientName') as HTMLInputElement).value = s.recipient_name ?? '';
        (document.getElementById('mailSubject') as HTMLInputElement).value = s.subject;
        (document.getElementById('mailBody') as HTMLTextAreaElement).value = s.body;
        (document.getElementById('mailSchedule') as HTMLInputElement).value = epochToLocalInput(s.scheduled_at);
        setEditing(s.id);
        document.getElementById('composeForm')!.scrollIntoView({ behavior: 'smooth' });
      });
    });

    list.querySelectorAll<HTMLButtonElement>('.cancel-queued-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        const res = await fetch('/api/mail/scheduled', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: btn.dataset.id }),
        });
        if (res.ok) {
          showToast('Cancelled');
          if (editingId === btn.dataset.id) setEditing(null);
          await loadQueued();
        } else {
          btn.disabled = false;
          showToast('Could not cancel', true);
        }
      });
    });
  }
```

Wire the Cancel-editing button inside `setupForm`:

```ts
    document.getElementById('cancelEditBtn')!.addEventListener('click', () => {
      form.reset();
      setEditing(null);
    });
```

In the submit handler, replace the single `fetch('/api/mail/send', …)` call and the block that follows it with:

```ts
      const scheduledAt = localToEpoch((document.getElementById('mailSchedule') as HTMLInputElement).value);

      const payload = {
        to: (document.getElementById('mailTo') as HTMLInputElement).value,
        recipient_name: (document.getElementById('mailRecipientName') as HTMLInputElement).value,
        subject: (document.getElementById('mailSubject') as HTMLInputElement).value,
        body: (document.getElementById('mailBody') as HTMLTextAreaElement).value,
        attachment_ids,
        ...(scheduledAt !== undefined ? { scheduled_at: scheduledAt } : {}),
      };

      const res = editingId
        ? await fetch('/api/mail/scheduled', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, id: editingId }),
          })
        : await fetch('/api/mail/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

      const data: any = await res.json().catch(() => null);
      btn.disabled = false;
      status.textContent = '';

      if (!data) {
        showToast('Something went wrong. Please try again.', true);
        return;
      }
      if (!res.ok && data.code) {
        showToast(ERRORS[data.code] ?? 'Send failed.', true);
        return;
      }
      if (editingId) {
        showToast('Queued message updated.');
        setEditing(null);
        form.reset();
        await loadQueued();
        return;
      }
      if (data.scheduled) {
        showToast('Queued.');
        form.reset();
        await loadQueued();
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
```

Finally, add `loadQueued()` to the `Promise.all` at the end of `init()`.

- [ ] **Step 3: Mirror it into the Turkish page**

Same markup, same script, with these strings translated:

| English | Turkish |
|---|---|
| Queued | Bekleyen gönderimler |
| Send at (leave empty to send now) | Gönderim zamanı (boş bırakırsanız hemen gider) |
| Editing a queued message. | Bekleyen bir mesajı düzenliyorsunuz. |
| Cancel editing | Düzenlemeyi bırak |
| Edit | Düzenle |
| Cancel | İptal |
| Update | Güncelle |
| Send | Gönder |
| Cancelled | İptal edildi |
| Could not cancel | İptal edilemedi |
| Queued. | Kuyruğa alındı. |
| Queued message updated. | Bekleyen mesaj güncellendi. |
| That send time is not valid. | Bu gönderim zamanı geçerli değil. |
| That send time is in the past. | Bu gönderim zamanı geçmişte. |
| You can only schedule up to 60 days ahead. | En fazla 60 gün ileriye zamanlayabilirsiniz. |
| That queued message no longer exists. | Bu bekleyen mesaj artık mevcut değil. |

- [ ] **Step 4: Verify**

Run: `npx astro check`, `npm test`, `npm run build` — all clean.

Against the dev server as a sender, recording what you observed:

1. Compose with an empty Send-at → sends as before.
2. Compose with a time one hour ahead → "Queued." toast, the message appears under Queued, and no new row in "My sent mail".
3. Edit it → the fields repopulate, the banner appears, the button reads Update; changing the subject and pressing Update changes the queued row.
4. Cancel-editing returns the form to composing.
5. Cancel removes it from the list.
6. A time in the past → the localised `schedule_in_past` message, not a raw code.
7. The Turkish page shows every one of the above in Turkish.

Confirm the two pages differ only in language:

```bash
diff <(grep -c 'queuedCard\|mailSchedule\|editingBanner' src/pages/account/mail.astro) \
     <(grep -c 'queuedCard\|mailSchedule\|editingBanner' src/pages/tr/account/mail.astro)
```

Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/pages/account/mail.astro src/pages/tr/account/mail.astro
git commit -m "Schedule, review, edit and cancel queued mail from the compose page (EN + TR)"
```

---

## Final verification

- [ ] `npm test` passes, output pristine.
- [ ] `npx astro check` reports 0 errors, 0 warnings, 21 hints.
- [ ] `npm run build` succeeds.
- [ ] `/api/mail/dispatch` without the secret returns 403 and sends nothing.
- [ ] A queued row whose sender lost `is_sender`, and one whose attachment was deactivated, each become `failed` rows in `sent_emails` and leave the queue.
- [ ] A rate-limited row survives one tick with `attempts` incremented, and becomes `failed` once past the 6-hour window.
- [ ] After deploying: set `MAIL_SYNC_SECRET` in both Cloudflare and GitHub, run the workflow manually via `workflow_dispatch`, and confirm it returns 200. Then queue a real message two minutes ahead and confirm it arrives.
- [ ] The cron's commit is authored by RSG's shared bot account, not a personal one.
