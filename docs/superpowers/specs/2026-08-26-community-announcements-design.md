# Community Announcements — Design

## Problem

The homepage's "Latest from Our Community" section (`src/pages/index.astro`) shows three fixed cards: Webinar, Event, Blog. Today:

- **Blog card** is already dynamic — pulls the latest published post from the `blog` collection at build time.
- **Event card** is already dynamic — fetches upcoming events from a public Google Calendar client-side, falling back to "New events coming soon!" when empty.
- **Webinar card** is fully static — hardcoded i18n strings, never reflects the actual latest webinar.

There is no way for a non-developer (e.g. the social media team) to post a timely, homepage-visible announcement — for example a volunteer call — without a developer editing code and opening a PR. The site is a static build (Cloudflare Pages), so even a content-collection edit requires a rebuild to go live.

## Goals

1. Let a small set of trusted, non-admin users ("announcers") post/edit/expire short announcements from the existing admin panel, with no code change or rebuild required for an announcement to appear or disappear.
2. Announcements appear as homepage cards, displacing the default Webinar/Event/Blog cards from the right as needed, and automatically revert when they expire.
3. An announcement can optionally also appear as a dismissible popup on page load.
4. Fix the Webinar card to be dynamic (pull the latest published webinar), matching the existing Blog card pattern, while this section is being touched anyway.

## Out of scope

- Inline/embedded registration forms (e.g. an iframe form). Announcements link out via a button URL (e.g. to a Google Form) — confirmed sufficient for the driving use case (volunteer calls).
- A general-purpose roles/permissions engine. `is_announcer` is a single-purpose boolean flag, matching the existing `is_admin`/`is_member` pattern — not a role table.
- Announcement scheduling (start date). Only an expiry (`expires_at`) is supported; an announcement is active from creation until expiry.

## 1. Permission model

Add one column to `users`:

```sql
ALTER TABLE users ADD COLUMN is_announcer INTEGER NOT NULL DEFAULT 0;
```

- A full admin (`is_admin = 1`) can grant/revoke `is_announcer` on any user from the existing admin panel's user table, via two new actions on the existing endpoint (`functions/api/admin/users.ts`): `make_announcer` / `remove_announcer`, mirroring the existing `make_admin`/`remove_admin` actions exactly (same auth check: only `is_admin` may call this).
- `is_announcer` alone does not grant `is_admin` capabilities and vice versa; they are independent flags. A user can hold both, either, or neither.

## 2. Data model

New table:

```sql
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  button_text   TEXT NOT NULL,
  button_url    TEXT NOT NULL,
  show_as_popup INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,        -- unix ms; row is "active" while now < expires_at
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL
);
```

No `is_active` flag — "active" is purely derived from `expires_at > now`. Deleting an announcement early (before its natural expiry) is a hard delete via the admin UI, not a soft-disable.

## 3. API surface

All new endpoints live under `functions/api/`, following the existing `_lib/auth.ts` session-cookie pattern.

- **`GET /api/announcements`** — public, no auth. Returns all rows where `expires_at > now()`, ordered by `created_at DESC` (newest announcement takes the leftmost slot). This is what the homepage fetches client-side.
- **`GET /api/admin/announcements`** — auth: `is_admin OR is_announcer`. Returns all rows (including expired, for the management table) ordered by `created_at DESC`.
- **`POST /api/admin/announcements`** — auth: `is_admin OR is_announcer`. Body: `{ title, description, button_text, button_url, show_as_popup, expires_at }`. Inserts a row with `created_by` = the caller's user id.
- **`DELETE /api/admin/announcements/:id`** — auth: `is_admin OR is_announcer`. Hard delete.
- No `PATCH`/edit endpoint in v1 — editing a mistake is delete + recreate. (Flagged in self-review below; confirm this is acceptable.)

## 4. Admin UI

Extend `src/pages/admin/index.astro`:

- The page's auth gate changes from `is_admin` to `is_admin OR is_announcer`.
- Render logic branches on the caller's flags:
  - `is_admin` sees the full existing page (user table with verify/admin/announcer actions) **plus** a new "Announcements" section.
  - `is_announcer` (and not `is_admin`) sees **only** the "Announcements" section — no user table, no member/rank/badge controls.
- Announcements section: a simple table of existing announcements (title, expires date, popup y/n, delete button) plus a form to create a new one (title, description, button text, button URL, expiry date, "also show as popup" checkbox).
- The existing user table gains two new action buttons per row (admin-only, same style as the current verify/make-admin buttons): "Make announcer" / "Remove announcer".

## 5. Homepage integration

The card section itself (`src/pages/index.astro`) keeps rendering the three default cards server-side exactly as it does today (Webinar becomes dynamic per §6 below, Event and Blog unchanged). A new client-side script — same pattern as the existing `loadCalendar()` block already in this file — runs on load:

1. `fetch('/api/announcements')`.
2. If the result is empty, do nothing; the three default cards stand as already rendered.
3. If N announcements are returned (N capped at 3 by the slice below), build the final card list as `[...announcements, defaultWebinarCardEl, defaultEventCardEl, defaultBlogCardEl].slice(0, 3)` and replace the section's card grid contents with it. This naturally drops (3 − N) default cards from the end (rightmost first) — e.g. 1 announcement replaces the Webinar slot and Event/Blog remain; 2 announcements replace Webinar+Event and only Blog remains.
4. Each announcement renders as a card with a generic "Announcement" tag pill (matching the visual style of the existing Webinar/Event/Blog tag pills), title, description, and a single button (`button_text` → `button_url`, opens normally, same tab — consistent with the other cards' internal links; external Google Form links will naturally navigate away, which is fine).

## 6. Webinar card fix (bundled)

Mirror the existing Blog card's build-time approach exactly:

```js
const latestWebinar = (await getCollection('webinars', ({ id, data }) => id.startsWith('en/') && !data.draft))
  .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())[0];
```

Render the same way the Blog card does (title, date, truncated description, "Read More" link to `/webinars/<slug>`), falling back to the current static copy only if no webinar exists (defensive, shouldn't happen in practice).

## 7. Popup

Same client-side script that fetches `/api/announcements`:

- Find the first (newest) result with `show_as_popup = 1`.
- Check `localStorage` for a dismissal record: key `dismissed_announcement_<id>`. If present, skip.
- If not dismissed, render a centered modal (title, description, button, an X close button) on top of the page.
- Closing the modal (X, or clicking the backdrop) sets `localStorage['dismissed_announcement_<id>'] = '1'` and hides it. A *different* announcement (different id) is unaffected by a prior dismissal.
- No auto-show timer/delay — appears as soon as the fetch resolves, once per page load (subject to the dismissal check).

## Testing / verification

- Build the site locally after the schema/API changes; confirm the homepage still renders 3 cards with zero announcements in the DB (baseline, unchanged look).
- Manually insert a test announcement row (via the new admin form, using a real test admin account), confirm it takes the leftmost card slot and the Blog card drops off, without a rebuild.
- Confirm an announcer-only test account can reach `/admin`, sees only the announcements section, and a plain member (`is_announcer=0, is_admin=0`) hitting `/admin` or the admin API still gets 403/redirected exactly as today.
- Let a test announcement's `expires_at` pass; confirm the default card set reappears on next page load with no manual action.
- Confirm popup dismissal persists across a reload in the same browser, and that a second, different announcement still pops up after the first is dismissed.

## Open question flagged during self-review

No edit/PATCH endpoint exists in v1 — fixing a typo means deleting and recreating the announcement (which also resets its `created_at`, potentially changing its slot order relative to other active announcements). This seemed acceptable given how small/simple these entries are, but flagging explicitly in case that's not fine in practice.
