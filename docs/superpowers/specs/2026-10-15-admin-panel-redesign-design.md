# Admin panel redesign: shell, navigation and shared components

Date: 2026-10-15. Status: agreed in conversation (with clickable mockups),
written for review.

## Why

The panel grew one pane at a time and is now hard to use. It has:

- **11 sidebar entries in three navigation styles:**
  - the sidebar;
  - a "Send as RSG" group of four tiny mail panes;
  - Social media's own internal tab bar.
- **No URL state:** a refresh returns to the first pane, and no pane can be
  linked.
- **Roles that do not match panes:**
  - writers and senders hold roles but cannot reach Blog or the mail panes,
    which are admin-only;
  - role management hides in a per-row dropdown of a 7-column users table
    that scrolls sideways.
- **One 1,735-line script** for users, mail, blog and symposium.
- **Every section styled and saved differently.**
- **Five stacked sections** on the Symposium pane.
- **Header stats** that only reflect the users list.
- **On a phone:** every nav entry before any content, and sideways-scrolling
  tables.

## Who uses it

| Who | Device | What |
| --- | --- | --- |
| The chair (admin, announcer) | Laptop | Everything, daily |
| Symposium team | Laptop | Symposium, in season |
| Social media team (coming) | Phone, mostly | Social media only |
| Membership reviewers (coming) | Laptop | Membership, twice a year |
| Mail senders | Laptop | E-posta (from part 2) |

## Decisions

### 1. Navigation (layout A)

One grouped sidebar. The panel opens on **Overview** (Genel bakış).

- **İletişim:** E-posta, Sosyal medya, Duyurular.
- **İçerik:** Blog, Sempozyum.
- **Topluluk:** Üyelik, Kullanıcılar ve yetkiler.
- **Sistem:** Bağlantılar, İşlem kaydı (was "Log").

Rules:

- **Entries follow roles.**
  - Everyone sees only the sections their roles grant. A group with no
    visible entries is not shown.
  - Server authorization is unchanged in this part, so Blog (reviewing
    submissions) and the E-posta management sub-pages stay admin-only.
    Senders reach E-posta in part 2, when sending and the inbox move into
    the panel. `is_writer` is the right to submit a post, not to review
    one; a writers' section is separate future work.
  - A user with a single section lands on it directly, without Overview.
- **Counts.** Each entry carries a count of waiting work:
  - unread mail;
  - posts awaiting approval;
  - blog submissions;
  - membership applications.
- **The header stats strip is removed.**
- **The URL holds the place,** for example `/admin#eposta/gelen` or
  `/tr/admin#eposta/gelen`.
  - A refresh stays put, links can be shared, and back and forward work.
  - The `?connected=` / `?connection_error=` OAuth returns keep working and
    land on Bağlantılar.
- **Sub-pages.** A section with sub-pages (E-posta, Sosyal medya, Sempozyum,
  Üyelik, Kullanıcılar ve yetkiler) shows them as tabs at the top of the
  section on a laptop.

### 2. Phone

- **Menu.** The menu is a drawer behind ☰.
- **Sections with sub-pages** open on a list of large rows, one per
  sub-page, with its count. Tapping one opens it; ‹ returns. It works like
  phone settings.
- **Touch targets** are at least 44 px.
- **No sideways scrolling anywhere.** Lists are rows or cards; detail opens
  full screen.
- **Toasts** fit the screen width and stack.

### 3. Overview

- **Waiting work:** one card per item, linking to its page. Only the cards
  the user's roles allow.
- **Health.** System health, which today is the banner, moves into a card.
  A problem still also shows as a banner on every page.
- **Coming up:**
  - this week's scheduled posts;
  - an open admission round;
  - the next symposium date.

### 4. Kullanıcılar ve yetkiler (layout 2)

Two tabs:

- **Kullanıcılar.**
  - **The list:** search, then filters (all, members, followers, has a
    role), then plain rows. Each row shows avatar initials, name, email,
    membership state and role chips.
  - **Detail.** Selecting a row opens it in a right-hand panel on a laptop,
    full screen on a phone. It shows:
    - membership state, which is read-only here and changed in Üyelik;
    - every role as a labelled switch with a one-line description.
- **Yetkiler.** One card per role, listing who holds it: × removes, "+ Kişi
  ekle" adds by search. It answers "who is on the social media team" at a
  glance and serves the yearly handover.

Roles shown, with their descriptions:

- Admin;
- Duyurular;
- Blog;
- E-posta;
- Sempozyum;
- Sosyal medya;
- Sosyal medya yayıncısı;
- Üyelik değerlendirici (once the membership work lands).

### 5. Sections moved into the shell

- **E-posta.** Sub-tabs: Toplu yetki, Göndericiler, Ekler, Gönderilenler. These
  are today's four mail panes. The inbox move and mail improvements are a
  separate piece (part 2).
- **Sempozyum.** Sub-tabs: Baskı, Konuşmacılar, Oturumlar, Komite,
  Sertifikalar. These are today's five stacked sections.
- **Sosyal medya.** Its internal tabs become the shell's sub-tabs:
  - Takvim;
  - Onay bekleyen (publishers only);
  - Taslaklar;
  - Yayınlananlar;
  - Etkinlik modu.

  The composer overlay is unchanged.
- **Duyurular, Blog, Bağlantılar, İşlem kaydı** are redrawn with the shared
  components. Their behaviour is unchanged.
- **Üyelik** gets its menu slot and route now. Its content arrives with the
  membership work (part 3); until then the slot is hidden.

### 6. Shared components and patterns

- **List row / card, detail panel, form field, button, switch, badge, empty
  state:** one implementation each, used everywhere. Tables go.
- **Save.** Forms save with an explicit "Kaydet". Leaving with unsaved
  changes warns. Social media keeps its autosave.
- **Confirm.**
  - The browser's `confirm()` is replaced by an in-place two-step
    confirmation, the pattern Bağlantılar already uses.
  - Irreversible bulk actions keep the typed confirmation, for example
    deleting all certificates.
- **Style.** The site's current navy and red style, applied consistently.
  No new visual language.

### 7. Code structure

- **A section registry.** One table defines each section: id, group,
  labels in both languages, roles that see it, sub-pages, count source,
  loader. The menu, routing, role visibility and Overview read it. A new
  section is one entry.
- **Each section** gets its own component and script. `admin-panel.ts` is
  split by section; Social, Connections, Audit, Health and Certificates
  already are.
- **Unchanged on the server.** Authorization is untouched; this work only
  reorganises the client. Panel views are still audited per section opened,
  as today.
- **Counts** come from the existing endpoints where possible. One small
  `GET /api/admin/counts` endpoint returns the waiting-work numbers the user
  may see, so the menu does not load every section.

## Out of scope

- **Part 2:** the mail workspace (inbox and conversations moved from
  `/account`, mail improvements).
- **Part 3:** membership, which already has its own spec.
- Any change to what a role may do on the server.
- A new visual design.

## Testing

- **Unit tests:**
  - the registry: which sections each role combination sees, and the
    single-section landing;
  - routing: hash to section and sub-page, unknown hash, the OAuth return
    params;
  - the counts endpoint: each count only for the roles that may see it.
- **i18n parity** for every new label.
- **Browser checks** in both languages, at laptop width and phone width:
  - every section and sub-page opens;
  - the drawer opens and closes;
  - the list-then-page flow works with ‹;
  - no element wider than the viewport.
- **Signed in:** a manual pass through the real panel.
