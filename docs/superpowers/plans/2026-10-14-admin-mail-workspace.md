# Admin Mail Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move compose, the send queue and the inbox from `/account/mail` and `/account/conversations` into the admin panel's E-posta section, open the panel to senders, and add the small improvements in the spec.

**Architecture:** Builds on the part 1 shell:
- registry `src/scripts/admin/sections.ts`;
- router `router.ts`;
- shell `shell.ts`;
- ui-kit `ui-kit.ts`;
- context `context.ts`.

New per-sub-page modules live under `src/scripts/admin/sections/`, with markup in a new `src/components/admin/panes/MailPane.astro`. The server changes in only two places: `canSeeAdminPanel` adds `is_sender`, and the `email` count becomes per-user. The old account pages become forwarding pages.

**Tech Stack:** Astro, TypeScript, Cloudflare Pages Functions, D1, node:test + tsx, Playwright browser checks.

**Spec:** `docs/superpowers/specs/2026-10-14-admin-mail-workspace-design.md`

## Global Constraints

- Only `canSeeAdminPanel` changes its role check, adding `is_sender`. No mail endpoint changes its role check:
  - send, scheduled PATCH/DELETE and reply require `is_sender`;
  - senders and attachments POST/PATCH stay admin-only.
- Every new UI string exists in both `en` and `tr` in `src/i18n/ui.ts`. Strings moved from the account pages keep their current wording: copy the en text from `src/pages/account/*.astro` and the tr text from `src/pages/tr/account/*.astro`.
- No `text-gray-400`; secondary text is `text-gray-500`.
- No em dash (U+2014) in new code, comments or strings.
- Touch targets on phone are at least 44 px (`min-h-11`). No element may be wider than the viewport at 390 px or 1280 px.
- Escape every user-controlled string (subjects, recipients, snippets, names, filenames) with `escapeHtml` from `src/scripts/escape-html.ts` before it enters `innerHTML`. Message bodies from `/api/mail/conversations/[id]` arrive as server-rendered `body_html` and are inserted as today.
- Elements that toggle visibility use `startHidden`/`showInlineFlex` from ui-kit, or toggle `hidden` alone on block/flex/grid elements. Never put `hidden` and `inline-flex` together in static markup.
- Panel views stay audited: the shell already posts the section id.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Unit tests: `npm test`. Types: `npx astro check`. Build: `npm run build`. Browser checks: `npm run build`, then `npx astro preview --port 4329` in the background, then `BASE=http://localhost:4329 node tests/browser/<file>.mjs`. Stub `/api/**` with Playwright `page.route` (see `tests/browser/admin-shell.mjs`).

## Review Focus

1. **A sender-only account opens `/admin`.** It must land on E-posta, show only gelen, yaz and gonderilenler, and get no 403 from counts, health or audit-view. Test: Task 1 unit, Task 5 browser.
2. **An admin who is not a sender.** They must not see `yaz`, because the server would refuse the send. Test: Task 1 unit.
3. **Unsaved compose or reply, then navigating away.** The notice must show, and Discard must clear the form. Test: Task 3 and 4 browser.
4. **Old bookmarks and the reply-notification email.** They must land on the right sub-page or thread. Test: Task 4 deep link, Task 5 forwarding.
5. **A long subject, recipient or snippet on a phone.** It must not overflow the viewport. Test: Task 5 overflow with long fixtures.

---

### Task 1: Senders in the registry, router third segment, server gate and per-user count

**Files:**
- Modify: `src/scripts/admin/sections.ts`, `src/scripts/admin/router.ts`, `functions/_lib/auth.ts` (`canSeeAdminPanel`), `functions/api/admin/counts.ts`
- Test: `tests/admin-sections.test.ts`, `tests/admin-router.test.ts`, `tests/admin-counts.test.ts`, plus a test for `canSeeAdminPanel` where auth tests live (find with `grep -rln canSeeAdminPanel tests`; else add `tests/admin-panel-gate.test.ts`)

**Interfaces:**
- **Produces:**
  - `RoleFlags.sender: boolean`;
  - `SubPage.adminOnly?: boolean` and `SubPage.senderOnly?: boolean`;
  - `subsFor` filters them;
  - `parseHash` returns `{ section, sub, item: string | null }`, where `item` is the third segment only if it matches `^\d{1,12}$`, else null;
  - `Route` gains `item: string | null`, and `toHash` appends `/${item}` when set;
  - `resolveRoute` keeps `item` only when the resolved section and sub equal the wanted ones.

Steps:
- [ ] **Step 1: Write the failing unit tests.**
  - **sections:**
    - `rolesFromMe({ is_sender: 1 })` gives `sender: true`.
    - For `{ sender: true }` with all other flags false:
      - `visibleSections` ids are `['eposta']`;
      - `landing` is `'eposta'`;
      - `subsFor(eposta)` ids are `['gelen','yaz','gonderilenler']`.
    - For admin only (sender false): eposta subs are `['gelen','gonderilenler','yetki','gondericiler','ekler']`.
    - For admin and sender: `['gelen','yaz','gonderilenler','yetki','gondericiler','ekler']`.
    - Update the existing eposta expectations; eposta is still hidden for announcer-only.
  - **router:**
    - `parseHash('#eposta/gelen/42')` gives item `'42'`.
    - `'#eposta/gelen/x'` gives item null.
    - `toHash({section:'eposta',sub:'gelen',item:'42'})` is `'#eposta/gelen/42'`.
    - `resolveRoute` keeps item 42 for a sender, and drops it when the sub falls back.
  - **counts:**
    - A sender (not admin) gets `email` equal to their own unread threads only. Seed two unread threads for user A and one for user B; A gets 2.
    - An admin gets their own unread, not everyone's.
    - Senders no longer get a 403.
  - **gate:** `canSeeAdminPanel({ is_sender: 1, others 0 })` is true.
- [ ] **Step 2: Run the tests; confirm they fail.** Command: `node --import tsx --test tests/admin-sections.test.ts tests/admin-router.test.ts tests/admin-counts.test.ts`.
- [ ] **Step 3: Implement.**
  - **eposta entry:**
    - `visible: (r) => r.admin || r.sender`.
    - Subs in order:
      - `{ id: 'gelen', label: 'admin.mail.nav.inbox' }`;
      - `{ id: 'yaz', label: 'admin.mail.nav.compose', senderOnly: true }`;
      - `{ id: 'gonderilenler', label: 'admin.mail.nav.sent' }`;
      - `yetki`, `gondericiler` and `ekler` with `adminOnly: true`, keeping their labels.
    - `subsFor`: drop `adminOnly` unless `r.admin`, and `senderOnly` unless `r.sender`.
  - **i18n keys:**
    - `admin.mail.nav.inbox`: en "Inbox" / tr "Gelen kutusu";
    - `admin.mail.nav.compose`: en "New email" / tr "Yeni e-posta";
    - `admin.mail.nav.sent`: en "Sent" / tr "Gönderilenler".
  - **Remaining code:**
    - `canSeeAdminPanel`: add `is_sender` to the Pick and to the OR.
    - counts: `if (admin || user.is_sender === 1) await count('email', 'SELECT COUNT(*) AS n FROM mail_threads WHERE unread = 1 AND sender_user_id = ?', user.id)`. Update the header comment.
    - Fix every caller of `parseHash`/`Route` that constructs a Route, e.g. in `shell.ts`, so it passes `item`. In `shell.ts`, call `onSub(section, sub, item)`: extend the `onSub` hook signature to `(sub: string, item: string | null) => void`; existing hooks ignore the second argument.
    - The shell's navigation guard compares routes. Make sure a change of `item` alone counts as navigation, so the hook re-runs.
- [ ] **Step 4: Run the focused tests, then `npm test`, `npx astro check`, and the browser check `admin-shell.mjs`.** Its eposta sub-nav expectations change: the admin fixture is not a sender, so it shows gelen, gonderilenler, yetki, gondericiler and ekler. Update the expectations only.
- [ ] **Step 5: Commit** with the message "Admin panel: senders reach E-posta; thread segment in the route; per-user mail count".

### Task 2: MailPane component, admin sub-pages moved, and the Sent sub-page

**Files:**
- Create: `src/components/admin/panes/MailPane.astro`
- Modify: `src/components/admin/AdminShell.astro`, which keeps only `<MailPane lang={lang} />` where the `#rsgMailSection` markup was; `src/scripts/admin/sections/mail.ts`; `src/scripts/admin/main.ts`
- Create: `src/scripts/admin/sections/mail-sent.ts`
- Test: `tests/browser/admin-shell.mjs` (extend)

**Interfaces:**
- **Consumes:** Task 1 subs and `onSub(sub, item)`.
- **Produces:**
  - `<section id="rsgMailSection" data-section="eposta">` with six `data-sub` children: `gelen`, `yaz`, `gonderilenler`, `yetki`, `gondericiler`, `ekler`.
  - Tasks 3 and 4 fill `data-sub="yaz"` and `data-sub="gelen"`. Their container ids are `#mailComposeRoot` and `#mailInboxRoot`, each an empty `<div>` in this task.
  - `loadSent(): Promise<void>` in `mail-sent.ts`.

Steps:
- [ ] **Step 1: Move the markup** into MailPane.astro unchanged, following the shape of `SymposiumPane.astro` (props `lang`, uses `useTranslations`). Add the three new `data-sub` blocks:
  - `gelen`: `<div id="mailInboxRoot"></div>`;
  - `yaz`: `<div id="mailComposeRoot"></div>`;
  - `gonderilenler`: the old all-sends list, re-purposed.
- [ ] **Step 2: Build the Sent sub-page** in `mail-sent.ts`:
  - **Default view:** GET `/api/mail/history` shows the caller's own sends. Rows are rendered with ui-kit `row`:
    - title: subject;
    - subtitle: recipients and date (`formatDate`);
    - chips: attachment count when > 0.
  - **Admin toggle:** admins get a two-button segmented toggle, "Mine"/"Everyone" (`admin.mail.sent.mine` "Mine"/"Benim", `admin.mail.sent.everyone` "Everyone"/"Herkes"). "Everyone" fetches `?scope=all` and adds the sender's name to the subtitle.
  - **Empty state:** `emptyState(t('admin.mail.sent.empty'))`, en "Nothing sent yet." / tr "Henüz gönderilen yok."
  - **Cleanup:** remove `loadAllSends` from `mail.ts` and reuse its row rendering if it fits.
  - **Field names:** read them from `functions/api/mail/history.ts` and today's `loadAllSends`; do not guess.
- [ ] **Step 3: Wire `main.ts`.**
  - `const isSender = data.user.is_sender === true`.
  - Admin-only mail loaders keep running only for admins.
  - Add `eposta: onFirstShow(...)` to `onShow` to load the Sent list when it is first shown.
  - Better: add an `onSub` for eposta that loads `gonderilenler` the first time that sub-page is shown.
  - Senders and admins both get this.
- [ ] **Step 4: Extend the browser check.**
  - A sender-only `/api/me` fixture (`is_sender: true`, other roles false) lands on `#eposta/gelen` at 1280.
  - The sub-nav shows exactly gelen, yaz and gonderilenler.
  - `/api/admin/counts`, stubbed, is called and not refused.
  - `#eposta/gonderilenler` lists the stubbed history rows.
  - For the admin fixture, the "Everyone" toggle requests `scope=all`.
- [ ] **Step 5: Verify and commit.** Run `npm test`, astro check, build, and the browser checks admin-shell, admin-overflow and admin-users. Commit as "Admin panel: mail pane component; Sent sub-page for senders and admins".

### Task 3: Compose and queued mail (`yaz`)

**Files:**
- Create: `src/scripts/admin/sections/mail-compose.ts`
- Modify: `MailPane.astro` (markup inside the `yaz` block), `src/i18n/ui.ts`, `main.ts`
- Test: `tests/browser/admin-mail-compose.mjs` (new)

**Interfaces:**
- **Consumes:** ui-kit `guardUnsaved`, `armConfirm`, `toast`, `row`, `emptyState`, `BTN`; context `t`, `tf`, `lang`; `src/lib/istanbul-time`, as `src/pages/account/mail.astro` uses it.
- **Produces:** `setupCompose(opts: { isAdmin: boolean }): void` and `loadQueued(): Promise<void>`.

Steps:
- [ ] **Step 1: Port the compose form.** Read `src/pages/account/mail.astro` fully: its markup, lines 1-103, and its script, from line 104. Reproduce its behaviour in the panel:
  - the compose form (To, Subject, Body with the markdown-lite hint, attachment checkboxes from GET `/api/admin/mail-attachments` (active only), and the schedule datetime in Istanbul time);
  - the editing-queued-item banner;
  - the queued list with Edit and Cancel, plus the admin "show all" scope;
  - the same requests and payloads:
    - POST `/api/mail/send`;
    - PATCH `/api/mail/scheduled` while editing;
    - DELETE `/api/mail/scheduled`;
    - GET `/api/mail/scheduled[?scope=all]`.
  - the same server error-code map. Move it to i18n keys `admin.mail.error.<code>`, with en and tr text copied from the two account pages.
- [ ] **Step 2: Restyle and add the improvements.**
  - Use panel styles: `BTN` and the form field classes `SymposiumPane.astro` uses. Queued items are ui-kit rows.
  - Cancel uses `armConfirm(button, t('admin.mail.queued.cancelConfirm'), ...)`: en "Cancel this email?" / tr "Bu e-posta iptal edilsin mi?". `confirm()` is never used.
  - `guardUnsaved(form, '#eposta/yaz', resetForm)`. Discard clears the form and leaves edit mode.
  - After a successful send or schedule, reset the guard and the form, toast success with the existing message, and reload the queue. History is the Sent sub-page, which this task does not render.
  - The page script's own history list is not ported, because Sent covers it.
- [ ] **Step 3: Wire `main.ts`.** For senders: `setupCompose({ isAdmin })`, and `loadQueued()` the first time `yaz` is shown.
- [ ] **Step 4: Write the browser check** `admin-mail-compose.mjs`. Use the sender fixture with stubbed `/api/**`, en and tr, at 390 and 1280. Cases:
  - **Send:** fill and send. The POST body has the to, subject, body and attachment ids, and the form clears.
  - **Schedule:** a datetime is set, and POST carries `scheduled_at`.
  - **Edit queued:** Edit fills the form and shows the banner, and Save sends a PATCH.
  - **Cancel queued:** the first click arms and the second sends a DELETE. No dialog appears; fail on `page.on('dialog')`.
  - **Unsaved changes:** a dirty form, then a click on Gelen, shows the notice, and the route stays. Discard clears the form and navigates.
  - **Server error:** a 429 stub with code `rate_limited` (use a real code from `send.ts`) shows the mapped message.
- [ ] **Step 5: Verify and commit.** Run `npm test`, astro check, build, the new check, and admin-shell. Commit as "Admin panel: compose and queued mail in E-posta".

### Task 4: Inbox and threads (`gelen`)

**Files:**
- Create: `src/scripts/admin/sections/mail-inbox.ts`
- Modify: `MailPane.astro` (markup inside the `gelen` block), `src/i18n/ui.ts`, `main.ts`
- Test: `tests/browser/admin-mail-inbox.mjs` (new)

**Interfaces:**
- **Consumes:** Task 1 `onSub(sub, item)`; ui-kit; shell `refreshCounts`; `guardUnsaved`.
- **Produces:** `setupInbox(opts: { isAdmin: boolean; isSender: boolean }): void` and `showInbox(item: string | null): Promise<void>`.

Steps:
- [ ] **Step 1: Port the conversations page.** Read `src/pages/account/conversations.astro` fully. Reproduce:
  - the thread list from GET `/api/mail/conversations`, with the admin "all" scope when the response has `isAdmin`;
  - render-cache-then-refresh: POST `/api/mail/refresh`, then reload;
  - the Refresh button;
  - the thread view from GET `/api/mail/conversations/<id>`;
  - reply via POST `/api/mail/conversations/<id>/reply`, with the existing "reply blocked" case;
  - the error map, moved to `admin.mail.error.*`. Reuse Task 3's keys; add the missing ones.
- [ ] **Step 2: Add the improvements.**
  - **Thread ↔ URL:** selecting a thread sets the hash to `#eposta/gelen/<id>` via the shell's navigation, so back and forward work, and opening `#eposta/gelen/<id>` directly opens that thread.
  - **Unread:** when an unread thread opens, mark it read locally and call `refreshCounts()`.
  - **Laptop (≥ lg):** list and thread side by side.
  - **Phone:** the list alone, and a thread full width with a "‹" back button (`min-h-11`, label `admin.mail.inbox.back`: "Back to inbox" / "Gelen kutusuna dön") that navigates to `#eposta/gelen`.
  - **Reply form:** `guardUnsaved(replyForm, '#eposta/gelen', reset)`. Keep the scope `#eposta/gelen`, so switching threads with a dirty reply also warns.
  - **Unread rows:** a chip `admin.mail.inbox.unread` ("Unread"/"Okunmadı").
  - **Reply visibility:** hide the reply form for non-sender admins viewing others' threads. The server refuses those replies; show `#replyBlocked`-equivalent text.
- [ ] **Step 3: Wire `main.ts`.** eposta `onSub`: when sub is `gelen`, call `showInbox(item)`. Run `setupInbox` before `startShell`.
- [ ] **Step 4: Write the browser check** `admin-mail-inbox.mjs`. Use the sender and admin fixtures, en and tr, at 390 and 1280. Cases:
  - **Opening:** the list renders and opening a thread sets `#eposta/gelen/<id>`; the stub records the GET.
  - **Deep link:** a fresh load of `/admin#eposta/gelen/7` opens thread 7.
  - **Phone:** the list hides when a thread is open, and ‹ returns to the list with hash `#eposta/gelen`.
  - **Reply:** POSTs to the reply URL and clears the form.
  - **Dirty reply:** opening another thread shows the notice.
  - **Unread:** opening an unread thread calls `/api/admin/counts` again.
  - **Admin "all":** with the scope on, it requests `scope=all`.
  - **Escaping:** a subject `<img src=x onerror=alert(1)>` renders as text.
- [ ] **Step 5: Verify and commit.** Run `npm test`, astro check, build, the new check, and admin-shell. Commit as "Admin panel: inbox and threads in E-posta, with thread links and phone flow".

### Task 5: Forward the old pages, links, overflow, README

**Files:**
- Modify:
  - `src/pages/account/mail.astro`, `src/pages/account/conversations.astro` and both `/tr` twins: replace them with forwarding pages;
  - `src/pages/account/index.astro` and the tr twin: the card links;
  - `functions/_lib/conversations.ts` (~210): the notification link;
  - `tests/noindex-routes.test.ts` if needed;
  - `tests/browser/admin-overflow.mjs`: the new sub-pages and long fixtures;
  - the admin README (find it with `ls src/scripts/admin`).
- Test: `tests/browser/account-mail-forward.mjs` (new), a unit test for the notification link (find the existing `notifyThreadOwner` test in `tests/conversations.test.ts`, else add one).

Steps:
- [ ] **Step 1: Build the forwarding pages.** Each keeps the noindex the route has today (check how `tests/noindex-routes.test.ts` detects it). Each runs an inline `location.replace('/admin#eposta/yaz')` (en mail), `/admin#eposta/gelen` (en conversations), or `/tr/admin#...` for tr. Show a plain link with the text `account.mailMoved`: en "Mail has moved to the admin panel." / tr "E-posta yönetim paneline taşındı."
- [ ] **Step 2: Update the account index cards** so the sender card links to `/admin#eposta/yaz` and the conversations card to `/admin#eposta/gelen`, with tr equivalents. Keep the unread badge.
- [ ] **Step 3: Update the notification link.** `notifyThreadOwner` links to `${siteOrigin}/tr/admin#eposta/gelen/${threadId}`. Read the function for the thread id variable. Add or update the unit test asserting the link.
- [ ] **Step 4: Update the overflow check.**
  - `admin-overflow.mjs` covers gelen (list and an open thread), yaz and gonderilenler for admin and sender fixtures.
  - Fixtures use a 120-character subject, a 60-character recipient address and a long unbroken snippet.
  - Fix any overflow found, e.g. with `break-words` or `min-w-0`.
- [ ] **Step 5: Write the forwarding browser check** `account-mail-forward.mjs`. Each of the four old URLs ends on the right admin hash.
- [ ] **Step 6: Update the README** with the E-posta sub-pages and who sees them.
- [ ] **Step 7: Verify and commit.** Run `npm test`, astro check, build, and all admin browser checks: admin-shell, admin-users, admin-overflow, admin-mail-compose, admin-mail-inbox and account-mail-forward. Commit as "Mail: account pages forward to the panel; notification links to the thread; overflow coverage".
