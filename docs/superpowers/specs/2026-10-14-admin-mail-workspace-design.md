# Admin panel part 2: the mail workspace

Date: 2026-10-14. Status: decided by the controller on the user's instruction
("durmadan devam et ... 2'yi yap"); every decision below is a ruling the user
can overturn. Part 1: `2026-10-15-admin-panel-redesign-design.md`.

## Why

Sending as RSG lives in two places today:

- **Senders (`is_sender`)** compose, schedule and read replies on two
  `/account` pages, `mail.astro` and `conversations.astro`. Each is an inline
  script duplicated per language with its own toast and escaper.
- **Admins** manage senders, attachments and the list of all sends in the
  panel's E-posta section, which senders cannot reach. `canSeeAdminPanel` and
  the panel's `RoleFlags` have no sender role.

Part 1 promised that senders reach E-posta in part 2, when sending and the
inbox move into the panel.

## Decisions

### 1. Senders enter the panel

- `RoleFlags` gains `sender`, read from `is_sender`.
- `canSeeAdminPanel` (server) adds `is_sender`. That gate covers only the
  counts, health and audit-view endpoints. No endpoint that acts on mail
  changes its role check: send, schedule edits and reply still require
  `is_sender`, and the sender and attachment management endpoints stay
  admin-only.
- E-posta becomes visible to `admin || sender`.

### 2. E-posta sub-pages

| Sub-page | id | Who sees it |
| --- | --- | --- |
| Gelen kutusu | `gelen` | sender or admin |
| Yeni e-posta (compose and queued mail) | `yaz` | sender (the server refuses non-senders) |
| Gönderilenler | `gonderilenler` | sender or admin. Shows your own sends; admins get a "Herkes" toggle (`scope=all`), which replaces the old all-sends pane |
| Toplu yetki | `yetki` | admin |
| Göndericiler | `gondericiler` | admin |
| Ekler | `ekler` | admin |

`SubPage` gains `adminOnly` and `senderOnly` flags, and `subsFor` filters on
them.

### 3. Count

The `email` count becomes the caller's own unread threads, the same number
as `/api/mail/conversations?only=count`. It is returned to senders and
admins. Before, admins saw every user's unread threads, which is work they
cannot act on, since a reply works only on your own thread.

### 4. The old pages

- `/account/mail` and `/account/conversations` (and their `/tr` twins) become
  forwarding pages. They `location.replace` to `/admin#eposta/yaz` and
  `/admin#eposta/gelen` (or the `/tr/admin` equivalents), with a plain link
  for no-JS. They stay noindex.
- The account page cards link to the panel.
- The reply notification email links to `/tr/admin#eposta/gelen/<threadId>`.

### 5. Improvements

These come with the move:

- **Deep link to a thread:** `#eposta/gelen/<id>`. The router accepts an
  optional numeric third segment.
- **Phone:** a list-then-thread flow. The thread opens full screen with ‹
  back. Laptop keeps two panes.
- **Unsaved warning:** the compose and reply forms warn on leaving
  (`guardUnsaved`).
- **Confirmations:** cancelling a queued mail uses the in-place two-step
  confirm, not `confirm()`.
- **Counts refresh:** opening an unread thread refreshes the menu counts.
- **Shared code:** one script per sub-page under
  `src/scripts/admin/sections/`, with strings in `src/i18n/ui.ts`, shared
  `escapeHtml`, `toast` and ui-kit rows.

## Out of scope

- Part 3 (membership).
- Any change to mail sending, rate limits, the queue, sync or dispatch.
- Making admins senders automatically.

## Testing

- **Unit:**
  - registry: sender-only roles see E-posta with gelen, yaz and gonderilenler
    only, and an admin who is not a sender does not get yaz;
  - router: third segment;
  - `canSeeAdminPanel` with a sender;
  - counts: per-user email.
- **Browser** (stubbed `/api/**`, en/tr, 390/1280):
  - compose, schedule, edit and cancel queued mail;
  - inbox list, open a thread, reply;
  - deep link;
  - phone back;
  - the forwarding pages;
  - the overflow check covers the new sub-pages.
