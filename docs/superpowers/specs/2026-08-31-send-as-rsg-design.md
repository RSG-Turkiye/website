# Send as RSG — Design

## Problem

RSG Türkiye's outreach — inviting professors to the symposium's scientific
programme, approaching companies for sponsorship — has to go out from the
organisation's address, not from a student's personal Gmail. Today the only
way to do that is to hand the password for `turkey.rsg@gmail.com` to whoever
needs to send. That is roughly 21 people across two teams (4 sponsorship, 17
scientific programme), it cannot be revoked per-person, it leaves no record of
who wrote to whom, and it stays true after those people leave the committee.

The goal is to let an admin grant named members the ability to send mail *as*
RSG through the website, without any of them ever holding the mailbox
credentials, and to log every send so leadership can see who contacted whom.

## Constraints discovered during design

These are load-bearing — the design below follows from them, and they are
recorded here because they contradict the obvious approach.

- **There is no Google Workspace tenant.** `turkey.rsg@gmail.com` is a
  consumer Gmail account; the paid subscription on it is Google One / AI Plus
  (storage + AI), which is not a managed Google service. `admin.google.com`
  bounces the account straight back to the account chooser because no Admin
  Console exists for it.
- **Therefore domain-wide delegation is impossible.** A service account with
  DWD — the standard way to send as an organisation address — requires a
  super-admin to authorise the service account's client ID in the Admin
  Console. There is no such console here. This was the originally requested
  approach and it is ruled out, not deferred.
- **`rsg-turkey@iscbsc.org` does not currently work.** It is configured as a
  Gmail "Send mail as" alias and fails with `535 5.7.8 BadCredentials`, most
  likely because it is a Google Group or alias rather than a real mailbox with
  a password (a group cannot authenticate over SMTP). ISCB-SC has not resolved
  it. The feature must not depend on it, but must be able to adopt it later
  with no code change.
- **`rsgturkey.com` is registered until 2027 but its DNS is parked.** Its
  nameservers are the registrar's `EXPIRED1/2.DNSENABLE.COM`, which answer
  `SERVFAIL`. Unrelated to this feature (the mailbox is not on that domain),
  but it means no address on that domain can be used until the registrar
  delegation is fixed.
- **Consumer Gmail caps sending at roughly 500 recipients per day.** Google
  One does not raise it. Rate limits are sized against this ceiling.

## Goals

1. Let an admin grant and revoke a per-member `is_sender` permission, one at a
   time or in bulk by pasting a list of emails, with a record of who granted
   it and when.
2. Let a member holding that permission compose and send mail from the RSG
   address through a signed-in page on the site — free-form recipient, subject
   and body, like an ordinary mail client.
3. Log every attempt (success and failure) with sender, recipient, subject and
   a snapshot of the body, so a member can see their own history and an admin
   can see everyone's.
4. Keep the mailbox credential exclusively server-side, in a Cloudflare secret,
   never reachable from the browser and never stored in D1.
5. Make the *from* address a configuration value, so switching to
   `rsg-turkey@iscbsc.org` (or a future Workspace address) is a `wrangler.toml`
   edit rather than a code change.

## Out of scope

- **Email templates.** Explicitly not wanted: composing should feel like Gmail,
  free-form. No `email_templates` table, no placeholder substitution.
- **A recipient registry / assignment system.** Two members mailing the same
  professor is not considered a problem worth solving in software; the teams
  coordinate outside the system. The admin's "all sends" report gives whatever
  visibility is needed for free.
- **Receiving or reading mail.** Send only (`gmail.send`). No inbox view, no
  thread view, no `gmail.readonly`.
- **Bulk / mail-merge sending.** One composed message goes to a small set of
  named recipients. Queue infrastructure, retries and per-recipient
  personalisation are not built.
- **Rich text / HTML bodies.** Plain text only — see §5.
- **Domain-wide delegation and service accounts.** Ruled out by the constraints
  above.

## 1. Authentication to Gmail

A one-time OAuth authorisation, performed by hand by an admin, produces a
refresh token that is stored as a Cloudflare Pages secret:

```
wrangler pages secret put GMAIL_REFRESH_TOKEN --project-name website
```

The existing `GOOGLE_CLIENT_ID` (in `wrangler.toml` `[vars]`) and
`GOOGLE_CLIENT_SECRET` (already a secret, used by `/auth/callback`) are reused;
no second OAuth client is created. The scope requested is exactly
`https://www.googleapis.com/auth/gmail.send` — nothing broader.

Two operational facts govern this:

- The OAuth app must be **Published** in Google Cloud Console, not left in
  *Testing*. Refresh tokens issued by an app in Testing expire after seven
  days, after which sending fails silently from the members' point of view.
- `gmail.send` is a sensitive scope, so a Published-but-unverified app shows an
  "unverified app" interstitial on the consent screen. Only one person (the
  admin performing the one-time authorisation) ever sees it.

The from address lives in `wrangler.toml` `[vars]` as `RSG_MAIL_FROM`,
initially `turkey.rsg@gmail.com`. Gmail accepts a `From` header naming any
address verified as a "send mail as" alias on the account, so once
`rsg-turkey@iscbsc.org` works in the Gmail UI, changing this var is the whole
migration.

## 2. Permission model

Following the existing `is_admin` / `is_announcer` / `is_writer` pattern, the
permission itself is a column — cheap to check on every request and it slots
into the admin panel's existing per-user action switch:

```sql
ALTER TABLE users ADD COLUMN is_sender INTEGER NOT NULL DEFAULT 0;
```

The audit trail the request asked for (who granted, when, which team) does not
belong in that column, so it is a separate append-mostly table. The column is
the authority for *may this user send*; this table is the record of *how they
came to be allowed*:

```sql
CREATE TABLE IF NOT EXISTS sender_grants (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team        TEXT,                        -- e.g. 'sponsorship', 'scientific_program'
  granted_by  TEXT NOT NULL REFERENCES users(id),
  granted_at  INTEGER NOT NULL,
  revoked_by  TEXT REFERENCES users(id),
  revoked_at  INTEGER
);
```

Granting writes `is_sender = 1` and inserts a row. Revoking writes
`is_sender = 0` and stamps `revoked_by` / `revoked_at` on the newest unrevoked
row. A user who is granted, revoked and granted again has three rows and a
readable history.

## 3. Data model — sends and attachments

```sql
CREATE TABLE IF NOT EXISTS sent_emails (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id),
  recipient_email   TEXT NOT NULL,
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  body_snapshot     TEXT NOT NULL,
  attachment_ids    TEXT NOT NULL DEFAULT '[]',   -- JSON array of mail_attachments.id
  gmail_message_id  TEXT,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message     TEXT,
  sent_at           INTEGER NOT NULL
);

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
```

`sent_emails` holds **one row per recipient**, not per composed message: a
message addressed to three people writes three rows. That is what makes "has
anyone written to this professor?" and the per-user rate limit a plain
`COUNT(*)`, and it matches how the log will actually be read. It is exact
rather than approximate because each recipient genuinely receives its own
message — see §4.

`body_snapshot` stores what was sent, verbatim. It is deliberately a copy and
not a reference — the point of the log is that it stays true even if everything
else changes.

Attachments are an admin-curated library, not member uploads: the admin uploads
RSG's official documents (sponsorship pack, invitation letter) and members pick
from the list. This keeps arbitrary files from going out under RSG's name.
They live in a **new, non-public** R2 bucket `rsg-mail-attachments` — the
existing `BLOG_IMAGES` bucket is publicly readable, which is wrong for these.
Attachment bytes are read server-side and embedded in the MIME message; no URL
is ever exposed.

## 4. Send path — `functions/_lib/gmail.ts`

One module, three functions, so that the Gmail-specific parts stay in one place
and a future move to Workspace/DWD touches only `getAccessToken`:

- `getAccessToken(env)` — exchanges `GMAIL_REFRESH_TOKEN` for a short-lived
  access token at `https://oauth2.googleapis.com/token`, cached in module scope
  with its expiry so a burst of sends in one isolate does not re-fetch.
- `buildMime({ from, fromName, to, replyTo, subject, body, attachments })` —
  builds an RFC 2822 message, base64url-encoded. `multipart/mixed` only when
  there are attachments; a bare `text/plain` part otherwise. Headers are
  RFC 2047 encoded-word escaped so Turkish characters in names and subjects
  survive.
- `sendMail(env, raw)` — `POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send`,
  returning the Gmail message id.

**One message per recipient.** A compose addressed to ten professors sends ten
separate messages, each with a single address in `To:`. Putting them all on one
`To:` line would show every professor the whole outreach list — unacceptable
for this kind of correspondence, and the reason no `Cc`/`Bcc` recipient field
is offered either. With the ten-recipient cap this is at most ten sequential
API calls.

Because each send is independent, a compose can **partially** succeed. Each
recipient's `sent_emails` row records its own `status`, `gmail_message_id` and
`error_message`; the endpoint returns 200 with a per-recipient result array
whenever at least one send succeeded, and the UI reports exactly which
recipients failed. Retrying is composing again to the failed addresses — there
is no automatic retry.

Two header decisions:

- `From: "RSG Türkiye (Member Name) <turkey.rsg@gmail.com>"` — the sending
  member's display name appears in the from line. The recipient sees an
  institutional sender, and the member is nonetheless accountable for what they
  wrote.
- `Reply-To: <the member's own email>` — replies reach the person who actually
  followed up, immediately, rather than sitting in a shared inbox nobody is
  assigned to watch.

**No `Bcc` back to RSG.** Because the message is sent through the
`turkey.rsg@gmail.com` account itself, Gmail already files a copy in that
account's *Sent* folder. The archive requirement is satisfied without a
duplicate delivery.

## 5. Endpoints

| Path | Method | Behaviour |
|---|---|---|
| `functions/api/mail/send.ts` | POST | session → `checkCsrf` → `is_sender` (else 403) → validate → rate limit (else 429) → send → log |
| `functions/api/mail/history.ts` | GET | own sends; `?scope=all` returns everyone's, admin only |
| `functions/api/admin/senders.ts` | GET / POST / PATCH | list grants; bulk grant from a pasted email list; revoke |
| `functions/api/admin/mail-attachments.ts` | GET / POST / PATCH | list, upload to R2, deactivate |
| `functions/api/admin/users.ts` | PATCH | existing switch gains `make_sender` / `remove_sender`, which also write `sender_grants` |

Bulk grant takes a newline- or comma-separated list of email addresses plus an
optional team label, matches them against `users.email`, and returns both what
it granted and **which addresses matched no account** — silently dropping the
three people who typed their address differently is the failure mode worth
designing against.

Validation on send: at least one recipient, each syntactically valid and
de-duplicated, at most **10 recipients per message**; non-empty subject and
body; every referenced attachment exists and is `is_active = 1`; total
attachment size ≤ 18 MB (Gmail's limit is 25 MB and base64 inflates by a
third).

Body is **plain text**. Accepting HTML from a browser form and sending it under
RSG's name means owning an HTML sanitisation problem for no benefit the outreach
actually needs.

## 6. Rate limiting

Computed from `sent_emails` with `COUNT(*)` over a time window — no KV, no
Durable Object, nothing new to provision:

- 20 recipients per hour per user
- 100 recipients per day per user
- 300 recipients per day across all users

The global cap sits well under consumer Gmail's ~500/day so that hitting our
limit produces a clean 429 with a message, rather than Gmail starting to reject
mail and the account looking compromised. A rejected-by-rate-limit request
writes **no** `sent_emails` row: nothing was attempted, and logging it would
corrupt the count that produced the decision.

## 7. UI

Two new routes, `/account/mail` and `/tr/account/mail`. They are separate pages
rather than another section of `account/index.astro`, which is already 514
lines and visibly strained by the blog submission form.

The compose form is deliberately plain: **To** (comma-separated), **Subject**,
**Body** (textarea), and a checkbox list of active attachments. Below it, the
member's own send history with status and timestamp. `/account` and
`/tr/account` gain a card linking to it, rendered only when `is_sender` is set.

The admin panels (`admin/index.astro` and `tr/admin/index.astro`) gain one
section containing: the authorised-sender table with team, granter and grant
date; a per-user toggle; the bulk-grant box; attachment library upload and
deactivation; and the all-sends report.

Every user-facing string exists in both the English and Turkish page. Server
error messages are returned as codes the pages map to localised text, rather
than as English prose rendered into a Turkish page.

## 8. Manual setup (not doable from code)

1. Google Cloud Console → OAuth consent screen → **Publish app** (leaving it in
   Testing silently breaks sending after seven days).
2. Add the `gmail.send` scope; authorise once as `turkey.rsg@gmail.com` and
   capture the refresh token.
3. `wrangler pages secret put GMAIL_REFRESH_TOKEN --project-name website`
4. `wrangler r2 bucket create rsg-mail-attachments` — do **not** enable public
   access on it.
5. Apply the three migrations noted at the top of `db/schema.sql` against
   production before deploying.

## Testing / verification

No test framework exists in this repo; verification is `astro check`, a
production build, and manual scenarios against `wrangler pages dev`.

- A user with `is_sender = 0` POSTs to `/api/mail/send` → **403**, and no row
  appears in `sent_emails`.
- A user with `is_sender = 1` sends → 200; `sent_emails` has `status = 'sent'`
  and a non-null `gmail_message_id`; the message is in `turkey.rsg@gmail.com`'s
  Sent folder; its `Reply-To` is the sending member's address.
- With a deliberately invalid `GMAIL_REFRESH_TOKEN` → a clean JSON error, and a
  row with `status = 'failed'` and a populated `error_message`. Failures are
  logged, never silently dropped.
- The 21st recipient within an hour → **429**, and no new `sent_emails` row.
- A member requests `/api/mail/history?scope=all` → their own sends only; an
  admin gets everyone's.
- Bulk grant with a list containing two unknown addresses → the known users are
  granted and the two unknown addresses are reported back, not ignored.
- `/account/mail` loaded by a user without the permission → no compose form.
