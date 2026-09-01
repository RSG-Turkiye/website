# Scheduled sending — Design

## Problem

Mail sent from `/account/mail` goes out the moment the member presses Send. The
people writing it are students; the people receiving it are professors and
company contacts. Those two groups keep different hours, and an invitation that
lands at 02:00 reads as carelessness before it reads as anything else.

The team also needs to spread a campaign — fifty professors contacted over
several days rather than all at once, both so the outreach does not look
automated and so it does not consume the account's daily sending quota in one
burst.

## Goals

1. Let a member choose when a composed message goes out, up to 60 days ahead,
   in their own local time.
2. Let them see what is queued, edit it, and cancel it before it sends.
3. Send it reliably without a person present, and record the result in the same
   log as everything else.
4. Fail loudly. A scheduled message that cannot be sent must end up in
   `sent_emails` as `failed` with a reason, never disappear.

## Out of scope for the first implementation

- **Campaign spreading** (N recipients at M per day). The data model below is
  built to accommodate it — see §7 — but the first implementation schedules one
  compose at one time.
- **Recurring sends.** Outreach is not a newsletter.
- **Per-recipient send times** within one compose.
- **A separate edit form.** Editing reuses the compose form in a different mode;
  see §5.

## Constraints discovered before designing

- **`sent_emails.status` is `CHECK (status IN ('sent', 'failed'))`**, and SQLite
  cannot alter a CHECK constraint — adding a `'scheduled'` value would mean
  rebuilding the table. Verified against the live database, which currently
  holds five rows.
- **Cloudflare Pages Functions have no cron trigger.** Only Workers do. A
  scheduled job needs a trigger from outside.
- **Cloudflare Queues cap `delaySeconds` at 12 hours**, so queue-native delayed
  delivery cannot express "next Tuesday". Ruled out.

## 1. Where the schedule lives

A **separate `scheduled_emails` table**, not a new status on `sent_emails`.

A queued message is a different thing from a sent one: it has no `sent_at`, no
`gmail_message_id`, it can be edited, and it can be cancelled. It is also *one
row per compose* holding a recipient list, whereas `sent_emails` is one row per
recipient — a scheduled compose fans out at send time, exactly as an immediate
one does today.

Keeping them apart means no migration touches existing data, `sent_emails`
keeps meaning "mail that was actually attempted", and the rate limiter and the
history view need no new filtering to avoid counting things that have not
happened yet.

```sql
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id              TEXT PRIMARY KEY,
  sender_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipients      TEXT NOT NULL,           -- JSON array of addresses
  recipient_name  TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,           -- Markdown source, as sent_emails stores it
  attachment_ids  TEXT NOT NULL DEFAULT '[]',
  scheduled_at    INTEGER NOT NULL,        -- unix seconds, UTC
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due ON scheduled_emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_sender ON scheduled_emails(sender_user_id);
```

Cancelling deletes the row. The queue is transient by nature; `sent_emails` is
the permanent record, and a message that was cancelled before sending has no
place in a log of what was sent.

## 2. What triggers the send

A GitHub Actions workflow on a 15-minute cron calls `POST /api/mail/dispatch`
with a shared secret.

GitHub Actions rather than a second Cloudflare Worker: the repo is public so
Actions minutes are free and unmetered, the workflow is a few seconds of `curl`,
and the alternative means a second deployable with its own `wrangler.toml`,
secrets and deploy path — permanent maintenance for scheduling precision this
feature does not need. The dispatch logic stays in the site's own codebase with
the same D1 and R2 bindings.

Fifteen minutes rather than hourly: "Tuesday 09:00" drifting to 10:00 is
noticeable in an invitation. Fifteen minutes absorbs GitHub's scheduling drift
and still costs nothing.

Two operational facts this carries:

- **A public repository's scheduled workflows are disabled after 60 days of
  inactivity.** GitHub emails the owner. This repo is active, but a quiet
  post-symposium stretch could silently stop the queue. It goes in the README.
- **Scheduled workflows run as whoever last committed the cron.** If that is a
  personal account that later leaves the organisation, the schedule stops. The
  cron must be committed by RSG's shared bot account.

The same endpoint and the same secret will carry the reply-sync job in the
Conversations feature, which is why both are named generically.

## 3. What the dispatcher does

Selects rows where `scheduled_at <= now`, oldest first, and for each one checks
three things before sending:

1. **The sender still holds `is_sender`.** Revoking someone's permission has to
   stop mail they queued before it was revoked, or revocation means nothing.
2. **Every selected attachment is still `is_active = 1`.** An admin who retires
   the old sponsorship pack should not have last week's version go out.
3. **The sender's rate limit has room** for the recipient count.

Failures are not alike, and are not treated alike:

- **Permission or attachment problem** — terminal. Write one `failed` row per
  recipient into `sent_emails` with the reason, delete the scheduled row. There
  is no future in which this resolves itself.
- **Rate limit full** — transient. Increment `attempts`, stamp `first_tried_at`
  if unset, leave the row for the next tick. After **6 hours** of this, give up:
  write `failed` rows with the reason and delete. Late is better than silent;
  forever is worse than a recorded failure.

When all three checks pass, the send takes exactly the path an immediate send
takes today — the same MIME assembly, the same per-recipient fan-out, the same
`sent_emails` rows.

## 4. Time

All times are **Europe/Istanbul**, everywhere. The member picks a wall-clock
time, the page converts it to a UTC unix timestamp before sending, and the queue
list renders it back in Istanbul time. The field's label names the timezone, so
a bare `09:00` is never ambiguous.

> **Revised during implementation.** This section originally said the member
> picks a time in *their browser's* local timezone, on the reasoning that a
> member travelling abroad should see their own clock. That was wrong for this
> organisation: the team, the recipients and the events are all in Turkey, so a
> member on a machine set to another zone would have scheduled mail for the
> wrong hour with nothing on screen to reveal it. The offset is derived from
> `Intl` in `src/lib/istanbul-time.ts` rather than hardcoded — Turkey has had no
> DST since 2016, but a constant buried in a page is what nobody finds if that
> changes.

Maximum **60 days** ahead. Unbounded scheduling means a forgotten message
surfacing months later, addressed to a professor about an event that has passed.

A time in the past is rejected at the endpoint rather than silently sent now.

## 5. Interface

The compose form gains one field: **Send at** (a `datetime-local` input), empty
meaning send immediately. Nothing else about composing changes.

Below it, **Queued** lists the member's pending messages with recipient, subject,
scheduled time, and two actions: **Edit** and **Cancel**.

**Edit reuses the compose form.** Pressing Edit loads the queued message back
into the same fields, shows a banner saying which message is being edited, and
turns Send into Update. There is no second form: this repo keeps every page in
two languages, so a separate edit form would mean a second set of labels,
buttons and error strings to maintain in both, for a form that already exists.
A Cancel-editing control returns the form to composing.

An admin sees every member's queue, matching how the send log already works.

## 6. Security

- `/api/mail/dispatch` requires `MAIL_SYNC_SECRET`; without it, 403. Otherwise
  anyone could drain the queue early or burn the Gmail quota by hammering it.
- Edit and cancel verify the row's `sender_user_id` against the session. Knowing
  an id is not authorisation.
- **Rate limit is consumed at send time, not at schedule time.** The reverse
  would let one member queue a hundred messages and lock out the shared quota
  for everyone before a single mail existed.
- Scheduling is gated by the same `is_sender` check as sending, and re-checked
  when the message actually goes out.

## 7. What campaign spreading will need

Recorded now because the table above is shaped for it, not because it is being
built: a `batch_id` column and one row per recipient rather than a recipient
list, with the dispatcher taking at most M rows per batch per day. Nothing in
this design blocks that; the recipient-list column becomes a single-element
array and the fan-out moves earlier.

## Testing

No test framework covers endpoints in this repo; unit tests cover pure logic and
handlers are verified by scenario against `wrangler pages dev`.

Unit-testable, and tested:

- the due-row selection predicate and the retry/give-up decision, as a pure
  function of (`scheduled_at`, `attempts`, `first_tried_at`, now)
- rejection of a past time and of a time beyond 60 days

By scenario, against a local dev server:

- a row scheduled one minute in the past is sent by a dispatch call, produces
  `sent_emails` rows, and disappears from the queue
- a row whose sender lost `is_sender` produces `failed` rows and disappears
- a row whose attachment was deactivated produces `failed` rows and disappears
- with the hourly limit full, a due row survives the call with `attempts`
  incremented; past six hours it becomes `failed`
- `/api/mail/dispatch` without the secret returns 403 and sends nothing
- editing a queued message changes the row; cancelling deletes it; neither
  works against another member's row

## Manual setup this adds

- `wrangler pages secret put MAIL_SYNC_SECRET --project-name website`, and the
  same value as a GitHub Actions repository secret.
- The cron workflow committed **by RSG's shared bot account**, not a personal one.
- One migration, run before deploy: the `CREATE TABLE` above.
