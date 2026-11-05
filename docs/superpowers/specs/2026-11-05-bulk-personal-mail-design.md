# Bulk personal mail (Panel › E-posta › Toplu gönderim)

Owner decisions, 2026-11-05. Status: design, waiting for the owner's OK.

## Why

The organisation sends the same letter to many people, one by one, with their
name in it: the "you are listed in the graduate guide" notice to ~116
professors now, membership renewal and sponsorship letters later. Today this
lives in a Slack bot (`/outreach`) on the chair's personal Raspberry Pi, which
will not survive the handover. A plain BCC mail reads like a newsletter and is
less likely to be read or to reach the inbox. The site already has the hard
parts: one Gmail message per recipient, a queue that holds a row when a quota
is full instead of dropping it, the 08:00–22:00 Istanbul send window, replies
landing in the panel inbox, and the activity log. What is missing is
per-recipient text and a quota that fits a mail-out.

## What the person does

1. Opens Panel › E-posta › **Toplu gönderim** (new sub-page `#eposta/toplu`).
2. Pastes a table copied from a Google Sheet (tab-separated; comma or
   semicolon also accepted). The first row is the header. One column must be
   the address (`e-posta`, `eposta`, `email` or `mail`, any case). Every other
   column becomes a placeholder: header `unvan` → `{unvan}`, `ad` → `{ad}`.
3. Writes the subject and the text, using the placeholders.
4. Sees the check: how many rows, which rows are refused and why (bad or
   repeated address, an empty value for a placeholder the text uses), unknown
   placeholders in the text, and the first three letters exactly as they will
   arrive. It also says roughly how many days the mail-out takes at the daily
   limit.
5. Presses **Gönder (N kişi)**. Nothing goes until this click (rule 5).
6. Follows progress on the same page: sent / waiting / failed per campaign,
   with **Kalanları iptal et** to drop what has not gone yet.

## Rules

- **Who:** members holding the mail-sender role, and admins. Same check on
  every endpoint. No agent route (rule 10: sending is not drafting).
- **Limits:** a mail-out may send at most **200 messages in any 24 hours**
  across all campaigns, and at most 60 in any hour so Gmail does not see a
  burst (the hourly figure is my call). It still counts toward the site's
  existing 300 a day, so ordinary mail keeps 100 a day of headroom. Campaign
  messages do NOT count toward the sender's personal 20/hour and 100/day:
  those exist to stop one member's ad hoc mail eating the shared quota, and
  the campaign cap does that job here.
- **Size:** at most 500 recipients per campaign; no attachments in this
  version (one less way to kill a tick; links work).
- **Delivery:** one `scheduled_emails` row per recipient, carrying that
  person's subject and text with the placeholders already filled, due now.
  The existing dispatcher sends them inside the send window, holds them when
  a quota is full (no attempt spent), and logs each send to `sent_emails`.
  Each message gets a thread, so replies show in the panel inbox.
- **Text:** placeholders are replaced as plain text; the body is rendered the
  way compose renders it today. `{{` is not special; an unknown `{x}` blocks
  sending rather than going out literally.
- **Personal data:** the pasted list exists only in the queue rows and in
  `sent_emails` (as any panel mail does today); nothing goes into git. The
  campaign row keeps the subject template and counts, not addresses.
- **Log (rule 9):** `mail.campaign.create` {campaign id, recipients} and
  `mail.campaign.cancel` {campaign id, dropped}. Addresses are not logged.

## Data (migration 8p)

- New table `mail_campaigns (id, sender_user_id, subject, total, created_at,
  cancelled_at)`.
- `scheduled_emails.campaign_id TEXT` and `sent_emails.campaign_id TEXT`
  (nullable; existing rows unaffected). `sent_emails` gets an index on
  `(campaign_id, sent_at)` so the campaign quota is one indexed count per row
  on the tick.

## Not in this version

Attachments, reading a Sheet by link, scheduling a campaign for later, HTML
formatting, per-campaign unsubscribe links.

## How it is checked

Unit tests for parsing the pasted table, filling placeholders, the refusals,
the quota split (campaign vs personal vs site), permissions and the audit
rows; a browser check of the page at the six window sizes and on a phone; a
local run of a campaign against the mocked Gmail used by the existing mail
tests. No real mail is sent while building it.
