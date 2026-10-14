# Admin Panel Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the admin panel's shell (grouped navigation, Overview, URL state, phone layout, users and roles, shared components) and move every existing section into it without changing what any role may do.

**Architecture:** A section registry (pure data plus role predicates) drives the sidebar, the phone drawer, routing and Overview. A hash router maps `#section/sub` to the visible section and sub-page. Existing panes keep their DOM ids and logic, now split out of the 1,735-line `admin-panel.ts` into one module per section, and are wrapped as sections with sub-pages. A small string-template UI kit replaces tables with rows, and a `GET /api/admin/counts` endpoint feeds the waiting-work numbers.

**Tech Stack:** Astro 5 components, TypeScript client scripts bundled by Astro, Tailwind 4 utility classes, Cloudflare Pages Functions with D1, `node:test` + `tsx` for unit tests, Playwright for browser checks (`tests/browser/*.mjs`, run by hand).

**Spec:** `docs/superpowers/specs/2026-10-15-admin-panel-redesign-design.md`

## Global Constraints

- Server authorization does not change in this plan. No endpoint's role check is modified. The only new endpoint is `GET /api/admin/counts`.
- Blog and every E-posta sub-page stay admin-only, as on the server today.
- Membership (Üyelik) has a registry entry whose `visible` returns false in this plan; part 3 fills it.
- Every new UI string exists in both `en` and `tr` in `src/i18n/ui.ts`.
- No `text-gray-400` (`tests/contrast.test.ts`); secondary text is `text-gray-500`.
- No em dash (U+2014) in new code, comments or strings.
- Touch targets on phone are at least 44 px (`min-h-11`).
- No element may be wider than the viewport at 390 px or at 1280 px.
- Panel views stay audited: every section shown posts `/api/audit/view` with the section id, which must match `^[a-z][a-z-]{0,39}$`.
- Escape every user-controlled string with `escapeHtml` (`src/scripts/escape-html.ts`) before it enters `innerHTML`.
- Commit messages end with a blank line and `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Unit tests: `npm test`. Types: `npx astro check`. Build: `npm run build`. Browser checks: `npm run build`, then `npx astro preview --port 4329` in the background, then `BASE=http://localhost:4329 node tests/browser/<file>.mjs`.

## Review Focus

1. A role that sees exactly one section (social team, symposium team, announcer) must land in it and see no empty groups, no Overview, and no menu toggle that leads nowhere. Test: Task 1 (registry) and Task 5 (browser, as a social-only user).
2. An unknown or forbidden hash (`#kayit` for a symposium user, `#nonsense/x`, an old bookmark) must fall back to the landing section, not a blank page. Test: Task 1.
3. Returning from an OAuth connect (`?connected=x` or `?connection_error=...`) must still open Bağlantılar and show the toast, then clean the URL. Test: Task 1 (router) and Task 5 (browser).
4. On a phone, opening a section with sub-pages shows the list, a sub-page shows ‹, and ‹ returns to the list. Browser back must do the same. Test: Task 5.
5. Nothing scrolls sideways at 390 px on any section, including users, audit and symposium. Test: Task 9.

---

## File Structure

| Path | Responsibility |
| --- | --- |
| `src/scripts/admin/sections.ts` (create) | Registry: groups, sections, sub-pages, role predicates, landing |
| `src/scripts/admin/router.ts` (create) | Hash ⇄ route, resolution against roles and device |
| `src/scripts/admin/ui-kit.ts` (create) | String templates: row, chip, switch, empty state, button classes; two-step confirm; toast stack |
| `src/scripts/admin/shell.ts` (create) | Boot: roles from `/api/me`, render nav, route, show sections, counts, drawer |
| `src/scripts/admin/overview.ts` (create) | Overview section rendering |
| `src/scripts/admin/context.ts` (create) | Shared `lang`, `t`, `tf`, `showToast`, `formatDate` |
| `src/scripts/admin/sections/*.ts` (create) | One module per section, moved out of `admin-panel.ts` |
| `src/scripts/admin-panel.ts` (delete at end of Task 4) | Replaced by the modules above |
| `src/components/admin/AdminShell.astro` (modify) | New layout: sidebar, drawer, header, section containers |
| `src/components/admin/AdminNav.astro` (rewrite) | Grouped nav rendered from the registry |
| `src/components/admin/panes/*.astro` (modify/create) | Section markup with `data-section` and `data-sub` |
| `functions/api/admin/counts.ts` (create) | Waiting-work counts per role |
| `tests/admin-sections.test.ts`, `tests/admin-router.test.ts`, `tests/admin-counts.test.ts`, `tests/admin-ui-kit.test.ts` (create) | Unit tests |
| `tests/browser/admin-shell.mjs` (create) | Browser checks with stubbed APIs |

---

### Task 1: Section registry and hash router

**Files:**
- Create: `src/scripts/admin/sections.ts`, `src/scripts/admin/router.ts`
- Test: `tests/admin-sections.test.ts`, `tests/admin-router.test.ts`

**Interfaces:**
- Produces:
  - `type RoleFlags = { admin: boolean; announcer: boolean; symposium: boolean; social: boolean; socialPublisher: boolean }`
  - `type SectionId = 'genel' | 'eposta' | 'sosyal' | 'duyurular' | 'blog' | 'sempozyum' | 'uyelik' | 'kullanicilar' | 'baglantilar' | 'kayit'`
  - `type CountKey = 'email' | 'social' | 'blog' | 'membership'`
  - `interface SubPage { id: string; label: string; publisherOnly?: boolean }` (`label` is an i18n key)
  - `interface Section { id: SectionId; group: GroupId | null; label: string; subs: SubPage[]; count?: CountKey; visible(r: RoleFlags): boolean }`
  - `type GroupId = 'iletisim' | 'icerik' | 'topluluk' | 'sistem'`
  - `GROUPS: { id: GroupId; label: string }[]`, `SECTIONS: Section[]`
  - `visibleSections(r: RoleFlags): Section[]` (registry order; Overview included only when 2 or more non-Overview sections are visible)
  - `subsFor(s: Section, r: RoleFlags): SubPage[]`
  - `landing(r: RoleFlags): SectionId | null` (null: no access)
  - `rolesFromMe(u: Record<string, unknown>): RoleFlags`
  - `interface Route { section: SectionId; sub: string | null }`
  - `parseHash(hash: string): { section: string; sub: string | null } | null`
  - `toHash(r: Route): string`
  - `resolveRoute(raw: { section: string; sub: string | null } | null, roles: RoleFlags, phone: boolean, oauthReturn: boolean): Route`

- [ ] **Step 1: Write the failing tests**

`tests/admin-sections.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SECTIONS, GROUPS, visibleSections, subsFor, landing, rolesFromMe, type RoleFlags } from '../src/scripts/admin/sections';
import { ui } from '../src/i18n/ui';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false };
const ids = (r: RoleFlags) => visibleSections(r).map((s) => s.id);

test('an admin sees every section except membership, which part 3 fills', () => {
  assert.deepEqual(ids({ ...none, admin: true }), ['genel', 'eposta', 'sosyal', 'duyurular', 'blog', 'sempozyum', 'kullanicilar', 'baglantilar', 'kayit']);
});

test('one section: no Overview, and the panel lands in it', () => {
  for (const [flag, id] of [['social', 'sosyal'], ['symposium', 'sempozyum'], ['announcer', 'duyurular']] as const) {
    const r = { ...none, [flag]: true };
    assert.deepEqual(ids(r), [id], flag);
    assert.equal(landing(r), id, flag);
  }
});

test('two sections: Overview appears and is where the panel lands', () => {
  const r = { ...none, announcer: true, symposium: true };
  assert.deepEqual(ids(r), ['genel', 'duyurular', 'sempozyum']);
  assert.equal(landing(r), 'genel');
});

test('no role, no panel', () => {
  assert.deepEqual(ids(none), []);
  assert.equal(landing(none), null);
});

test('blog and e-mail stay admin-only, as on the server', () => {
  const r = { ...none, announcer: true, symposium: true, social: true, socialPublisher: true };
  assert.ok(!ids(r).includes('blog'));
  assert.ok(!ids(r).includes('eposta'));
});

test('the approval sub-page is for publishers', () => {
  const social = SECTIONS.find((s) => s.id === 'sosyal')!;
  assert.ok(!subsFor(social, { ...none, social: true }).some((s) => s.id === 'onay'));
  assert.ok(subsFor(social, { ...none, social: true, socialPublisher: true }).some((s) => s.id === 'onay'));
  assert.ok(subsFor(social, { ...none, admin: true }).some((s) => s.id === 'onay'));
});

test('roles come from /api/me; a publisher is also a social editor', () => {
  assert.deepEqual(rolesFromMe({ is_admin: true, is_social_publisher: true }), { admin: true, announcer: false, symposium: false, social: true, socialPublisher: true });
  assert.deepEqual(rolesFromMe({ is_admin: 1 }), { ...none, admin: true });
});

test('every label exists in both languages and ids are safe for the audit log', () => {
  const keys = [...GROUPS.map((g) => g.label), ...SECTIONS.flatMap((s) => [s.label, ...s.subs.map((x) => x.label)])];
  for (const k of keys) {
    assert.ok(k in ui.en, `en ${k}`);
    assert.ok(k in ui.tr, `tr ${k}`);
  }
  for (const s of SECTIONS) assert.match(s.id, /^[a-z][a-z-]{0,39}$/);
});
```

`tests/admin-router.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, toHash, resolveRoute } from '../src/scripts/admin/router';
import type { RoleFlags } from '../src/scripts/admin/sections';

const none: RoleFlags = { admin: false, announcer: false, symposium: false, social: false, socialPublisher: false };
const admin = { ...none, admin: true };

test('hash round trip', () => {
  assert.deepEqual(parseHash('#eposta/ekler'), { section: 'eposta', sub: 'ekler' });
  assert.deepEqual(parseHash('#kayit'), { section: 'kayit', sub: null });
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(toHash({ section: 'eposta', sub: 'ekler' }), '#eposta/ekler');
  assert.equal(toHash({ section: 'kayit', sub: null }), '#kayit');
});

test('desktop: a section with sub-pages opens its first allowed sub-page', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null }, admin, false, false), { section: 'eposta', sub: 'yetki' });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, false, false), { section: 'eposta', sub: 'ekler' });
});

test('phone: a section with sub-pages and no sub shows the list (sub null)', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: null }, admin, true, false), { section: 'eposta', sub: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, true, false), { section: 'eposta', sub: 'ekler' });
});

test('unknown or forbidden routes fall back to landing', () => {
  const sym = { ...none, symposium: true };
  assert.deepEqual(resolveRoute({ section: 'kayit', sub: null }, sym, false, false), { section: 'sempozyum', sub: 'baski' });
  assert.deepEqual(resolveRoute({ section: 'nonsense', sub: 'x' }, admin, false, false), { section: 'genel', sub: null });
  assert.deepEqual(resolveRoute(null, admin, false, false), { section: 'genel', sub: null });
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'nope' }, admin, false, false), { section: 'eposta', sub: 'yetki' });
});

test('a forbidden sub-page falls back to the first allowed one', () => {
  const editor = { ...none, social: true };
  assert.deepEqual(resolveRoute({ section: 'sosyal', sub: 'onay' }, editor, false, false), { section: 'sosyal', sub: 'takvim' });
});

test('an OAuth return always lands on Bağlantılar for an admin', () => {
  assert.deepEqual(resolveRoute({ section: 'eposta', sub: 'ekler' }, admin, false, true), { section: 'baglantilar', sub: null });
  assert.deepEqual(resolveRoute(null, { ...none, social: true }, false, true), { section: 'sosyal', sub: 'takvim' }, 'not for someone who cannot see it');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/admin-sections.test.ts tests/admin-router.test.ts`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`src/scripts/admin/sections.ts`:

```ts
/**
 * The admin panel's sections: one table that the sidebar, the phone drawer,
 * routing and Overview all read. Visibility mirrors the server's role checks;
 * it never grants anything the server would refuse.
 */
export type RoleFlags = { admin: boolean; announcer: boolean; symposium: boolean; social: boolean; socialPublisher: boolean };
export type GroupId = 'iletisim' | 'icerik' | 'topluluk' | 'sistem';
export type SectionId = 'genel' | 'eposta' | 'sosyal' | 'duyurular' | 'blog' | 'sempozyum' | 'uyelik' | 'kullanicilar' | 'baglantilar' | 'kayit';
export type CountKey = 'email' | 'social' | 'blog' | 'membership';

export interface SubPage { id: string; label: string; publisherOnly?: boolean }
export interface Section {
  id: SectionId;
  group: GroupId | null;
  label: string;
  subs: SubPage[];
  count?: CountKey;
  visible(r: RoleFlags): boolean;
}

export const GROUPS: { id: GroupId; label: string }[] = [
  { id: 'iletisim', label: 'admin.nav.group.communication' },
  { id: 'icerik', label: 'admin.nav.group.content' },
  { id: 'topluluk', label: 'admin.nav.group.community' },
  { id: 'sistem', label: 'admin.nav.group.system' },
];

const adminOnly = (r: RoleFlags) => r.admin;

export const SECTIONS: Section[] = [
  { id: 'genel', group: null, label: 'admin.nav.overview', subs: [], visible: () => true },
  {
    id: 'eposta', group: 'iletisim', label: 'admin.nav.email', count: 'email', visible: adminOnly,
    subs: [
      { id: 'yetki', label: 'admin.mail.bulkGrant.heading' },
      { id: 'gondericiler', label: 'admin.mail.senders.heading' },
      { id: 'ekler', label: 'admin.mail.attachments.heading' },
      { id: 'gonderilenler', label: 'admin.mail.allSends.heading' },
    ],
  },
  {
    id: 'sosyal', group: 'iletisim', label: 'admin.social.heading', count: 'social', visible: (r) => r.admin || r.social,
    subs: [
      { id: 'takvim', label: 'admin.social.tab.calendar' },
      { id: 'onay', label: 'admin.social.tab.pending', publisherOnly: true },
      { id: 'taslaklar', label: 'admin.social.tab.drafts' },
      { id: 'yayinlananlar', label: 'admin.social.tab.published' },
      { id: 'etkinlik', label: 'admin.social.tab.events' },
    ],
  },
  { id: 'duyurular', group: 'iletisim', label: 'admin.announcements.heading', subs: [], visible: (r) => r.admin || r.announcer },
  { id: 'blog', group: 'icerik', label: 'admin.blog.heading', count: 'blog', subs: [], visible: adminOnly },
  {
    id: 'sempozyum', group: 'icerik', label: 'admin.symposium.heading', visible: (r) => r.admin || r.symposium,
    subs: [
      { id: 'baski', label: 'admin.symposium.edition.heading' },
      { id: 'konusmacilar', label: 'admin.symposium.speakers.heading' },
      { id: 'oturumlar', label: 'admin.symposium.sessions.heading' },
      { id: 'komite', label: 'admin.symposium.committee.heading' },
      { id: 'sertifikalar', label: 'admin.symposium.certificates.heading' },
    ],
  },
  // Part 3 (membership) makes this visible.
  { id: 'uyelik', group: 'topluluk', label: 'admin.nav.membership', count: 'membership', subs: [], visible: () => false },
  {
    id: 'kullanicilar', group: 'topluluk', label: 'admin.nav.users', visible: adminOnly,
    subs: [
      { id: 'liste', label: 'admin.nav.usersList' },
      { id: 'yetkiler', label: 'admin.nav.roles' },
    ],
  },
  { id: 'baglantilar', group: 'sistem', label: 'admin.connections.heading', subs: [], visible: adminOnly },
  { id: 'kayit', group: 'sistem', label: 'admin.nav.audit', subs: [], visible: adminOnly },
];

export function visibleSections(r: RoleFlags): Section[] {
  const work = SECTIONS.filter((s) => s.id !== 'genel' && s.visible(r));
  if (work.length === 0) return [];
  return work.length >= 2 ? [SECTIONS[0], ...work] : work;
}

export function subsFor(s: Section, r: RoleFlags): SubPage[] {
  return s.subs.filter((x) => !x.publisherOnly || r.admin || r.socialPublisher);
}

export function landing(r: RoleFlags): SectionId | null {
  return visibleSections(r)[0]?.id ?? null;
}

const yes = (v: unknown) => v === true || v === 1;
export function rolesFromMe(u: Record<string, unknown>): RoleFlags {
  const socialPublisher = yes(u.is_social_publisher);
  return {
    admin: yes(u.is_admin), announcer: yes(u.is_announcer), symposium: yes(u.is_symposium),
    social: yes(u.is_social) || socialPublisher, socialPublisher,
  };
}
```

`src/scripts/admin/router.ts`:

```ts
/**
 * Where the panel is, kept in the address (`#section/sub`), so a refresh stays
 * put and a link opens the same page. On a phone a section with sub-pages and
 * no sub shows the list of sub-pages first.
 */
import { SECTIONS, visibleSections, subsFor, landing, type RoleFlags, type SectionId } from './sections';

export interface Route { section: SectionId; sub: string | null }

export function parseHash(hash: string): { section: string; sub: string | null } | null {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return null;
  const [section, sub] = raw.split('/');
  return section ? { section, sub: sub || null } : null;
}

export function toHash(r: Route): string {
  return `#${r.section}${r.sub ? `/${r.sub}` : ''}`;
}

export function resolveRoute(
  raw: { section: string; sub: string | null } | null,
  roles: RoleFlags,
  phone: boolean,
  oauthReturn: boolean,
): Route {
  const visible = visibleSections(roles);
  const want = oauthReturn && visible.some((s) => s.id === 'baglantilar') ? { section: 'baglantilar', sub: null } : raw;
  const section = visible.find((s) => s.id === want?.section) ?? SECTIONS.find((s) => s.id === landing(roles))!;
  const subs = subsFor(section, roles);
  if (subs.length === 0) return { section: section.id, sub: null };
  const sub = subs.find((s) => s.id === want?.sub && section.id === want?.section);
  if (sub) return { section: section.id, sub: sub.id };
  return { section: section.id, sub: phone ? null : subs[0].id };
}
```

Note the last two lines: on a phone an unknown sub resolves to the list (sub null); the test `'eposta','nope'` is a desktop case.

Add i18n keys to `src/i18n/ui.ts` in both languages (place them with the other `admin.` keys):

English:
```ts
    'admin.nav.group.communication': 'Communication',
    'admin.nav.group.content': 'Content',
    'admin.nav.group.community': 'Community',
    'admin.nav.group.system': 'System',
    'admin.nav.overview': 'Overview',
    'admin.nav.email': 'E-mail',
    'admin.nav.membership': 'Membership',
    'admin.nav.users': 'Users and roles',
    'admin.nav.usersList': 'Users',
    'admin.nav.roles': 'Roles',
    'admin.nav.audit': 'Activity log',
    'admin.nav.menu': 'Menu',
    'admin.nav.back': 'Back',
```

Turkish:
```ts
    'admin.nav.group.communication': 'İletişim',
    'admin.nav.group.content': 'İçerik',
    'admin.nav.group.community': 'Topluluk',
    'admin.nav.group.system': 'Sistem',
    'admin.nav.overview': 'Genel bakış',
    'admin.nav.email': 'E-posta',
    'admin.nav.membership': 'Üyelik',
    'admin.nav.users': 'Kullanıcılar ve yetkiler',
    'admin.nav.usersList': 'Kullanıcılar',
    'admin.nav.roles': 'Yetkiler',
    'admin.nav.audit': 'İşlem kaydı',
    'admin.nav.menu': 'Menü',
    'admin.nav.back': 'Geri',
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/admin-sections.test.ts tests/admin-router.test.ts`
Expected: PASS. Then `npm test` and `npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/admin/sections.ts src/scripts/admin/router.ts src/i18n/ui.ts tests/admin-sections.test.ts tests/admin-router.test.ts
git commit -m "Admin panel: section registry and hash router"
```

---

### Task 2: Waiting-work counts endpoint

**Files:**
- Create: `functions/api/admin/counts.ts`
- Test: `tests/admin-counts.test.ts`

**Interfaces:**
- Produces: `GET /api/admin/counts` → `200 { email?: number; social?: number; blog?: number; scheduledThisWeek?: number }`. A key is present only when the caller may see it: `email` and `blog` for admins; `social` (posts awaiting approval) for admins and social publishers; `scheduledThisWeek` (posts scheduled in the next 7 days) for admins and anyone with social access. 401 when signed out, 403 when `canSeeAdminPanel` is false.

- [ ] **Step 1: Write the failing test**

`tests/admin-counts.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { onRequestGet } from '../functions/api/admin/counts';

function seed(db: import('node:sqlite').DatabaseSync) {
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO mail_threads (id, sender_user_id, recipient_email, subject, last_message_at, last_direction, unread, created_at, updated_at) VALUES ('t1','admin','x@example.org','s',1,'in',1,1,1), ('t2','admin','y@example.org','s',1,'out',0,1,1)`).run();
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES
    ('p1','image','a','[]','["instagram"]',?,'pending_approval',1,'ed',1,1),
    ('p2','image','b','[]','["instagram"]',?,'scheduled',1,'ed',1,1),
    ('p3','image','c','[]','["instagram"]',?,'scheduled',1,'ed',1,1)`).run(now + 3600, now + 2 * 86400, now + 30 * 86400);
  db.prepare(`INSERT INTO blog_submissions (id, submitted_by, lang, title, description, category, author, body, slug, status, created_at) VALUES ('b1','mem','en','t','d','c','a','x','s','pending',1), ('b2','mem','en','t','d','c','a','x','s2','approved',1)`).run();
}

test('an admin gets every count', async () => {
  const { env, db } = setupSocial();
  seed(db);
  const res = await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'admin' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { email: 1, social: 1, blog: 1, scheduledThisWeek: 1 });
});

test('a social publisher gets only the social counts; an editor only what is scheduled', async () => {
  const { env, db } = setupSocial();
  seed(db);
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'pub' })).json(), { social: 1, scheduledThisWeek: 1 });
  assert.deepEqual(await (await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'ed' })).json(), { scheduledThisWeek: 1 });
});

test('a member without a panel role is refused; signed out is 401', async () => {
  const { env } = setupSocial();
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env, as: 'mem' })).status, 403);
  assert.equal((await call(onRequestGet, 'GET', '/api/admin/counts', { env })).status, 401);
});
```

(`tests/lib/social.ts` seeds users `admin`, `pub` (publisher and editor), `ed` (editor), `mem` (member). If the `blog_submissions` columns differ from the insert above, match `db/schema.sql`.)

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/admin-counts.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `functions/api/admin/counts.ts`:

```ts
/**
 * The numbers beside the admin panel's menu entries and on Overview. Each
 * count is returned only to someone whose role lets them act on it, so the
 * menu never hints at work a person cannot see.
 */
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, canSeeAdminPanel } from '../../_lib/auth';

const WEEK = 7 * 86400;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  const admin = user.is_admin === 1;
  const publisher = admin || user.is_social_publisher === 1;
  const social = publisher || user.is_social === 1;
  const now = Math.floor(Date.now() / 1000);
  const n = async (sql: string, ...b: (string | number)[]) =>
    ((await env.DB.prepare(sql).bind(...b).first<{ n: number }>())?.n ?? 0);

  const out: Record<string, number> = {};
  if (admin) out.email = await n('SELECT COUNT(*) AS n FROM mail_threads WHERE unread = 1');
  if (publisher) out.social = await n(`SELECT COUNT(*) AS n FROM social_posts WHERE status = 'pending_approval'`);
  if (admin) out.blog = await n(`SELECT COUNT(*) AS n FROM blog_submissions WHERE status = 'pending'`);
  if (social) out.scheduledThisWeek = await n(`SELECT COUNT(*) AS n FROM social_posts WHERE status = 'scheduled' AND scheduled_at BETWEEN ? AND ?`, now, now + WEEK);
  return jsonResponse(out);
};
```

- [ ] **Step 4: Run tests** (`node --import tsx --test tests/admin-counts.test.ts`, then `npm test`, `npx astro check`). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/counts.ts tests/admin-counts.test.ts
git commit -m "Admin panel: waiting-work counts endpoint"
```

---

### Task 3: UI kit (rows, chips, switches, confirm, toasts)

**Files:**
- Create: `src/scripts/admin/ui-kit.ts`
- Test: `tests/admin-ui-kit.test.ts`

**Interfaces:**
- Produces (all return HTML strings unless noted; every text argument is escaped inside):
  - `BTN.primary`, `BTN.secondary`, `BTN.danger`, `BTN.ghost`: class strings (each includes `min-h-11 lg:min-h-9` and the focus ring)
  - `row(opts: { title: string; subtitle?: string; chips?: string; trailing?: string; attrs?: string; selected?: boolean }): string` (`chips` and `trailing` are pre-built HTML; `title`/`subtitle` are escaped)
  - `chip(text: string, tone?: 'neutral' | 'green' | 'amber' | 'navy' | 'red'): string`
  - `switchControl(opts: { id: string; checked: boolean; label: string; hint?: string; attrs?: string }): string`
  - `emptyState(text: string): string`
  - `sectionCard(inner: string): string`
  - `armConfirm(button: HTMLButtonElement, confirmLabel: string, onConfirm: () => void | Promise<void>): void` (DOM; first click changes the label and arms for 4 s, second click runs)
  - `toast(message: string, isError?: boolean): void` (DOM; stacks in `#toastStack`, auto-removes after 4 s)

- [ ] **Step 1: Write the failing test** `tests/admin-ui-kit.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'node-html-parser';
import { row, chip, switchControl, emptyState, BTN } from '../src/scripts/admin/ui-kit';

test('row escapes title and subtitle and keeps trailing HTML', () => {
  const html = row({ title: '<b>x</b>', subtitle: 'a & b', trailing: '<button>Ok</button>', attrs: 'data-id="1"' });
  const el = parse(html).firstChild as unknown as { getAttribute(n: string): string; innerHTML: string; text: string };
  assert.equal(el.getAttribute('data-id'), '1');
  assert.ok(!html.includes('<b>x</b>'));
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('a &amp; b'));
  assert.ok(html.includes('<button>Ok</button>'));
});

test('switch is a real checkbox with a label, sized for a finger', () => {
  const html = switchControl({ id: 'r-admin', checked: true, label: 'Admin', hint: 'Her şey' });
  const root = parse(html);
  const input = root.querySelector('input#r-admin')!;
  assert.equal(input.getAttribute('type'), 'checkbox');
  assert.equal(input.getAttribute('role'), 'switch');
  assert.ok(input.hasAttribute('checked'));
  assert.ok(root.querySelector('label[for="r-admin"]'));
  assert.match(html, /min-h-11/);
});

test('chips and empty states escape their text; buttons meet the 44px target on phones', () => {
  assert.ok(chip('<x>').includes('&lt;x&gt;'));
  assert.ok(emptyState('<x>').includes('&lt;x&gt;'));
  for (const c of Object.values(BTN)) assert.match(c, /min-h-11/);
  assert.doesNotMatch(Object.values(BTN).join(' '), /text-gray-400/);
});
```

- [ ] **Step 2: Run to verify it fails** (`node --import tsx --test tests/admin-ui-kit.test.ts`).

- [ ] **Step 3: Implement** `src/scripts/admin/ui-kit.ts`:

```ts
/**
 * The admin panel's shared pieces. Lists are rows, never tables, so nothing
 * scrolls sideways on a phone; every control is at least 44 px tall there.
 */
import { escapeHtml } from '../escape-html';

const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const BASE = `inline-flex items-center justify-center gap-1 px-4 min-h-11 lg:min-h-9 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${FOCUS}`;

export const BTN = {
  primary: `${BASE} bg-navy text-white hover:bg-navy-mid`,
  secondary: `${BASE} border border-navy text-navy hover:bg-navy-light`,
  danger: `${BASE} border border-red text-red hover:bg-red-tint`,
  ghost: `${BASE} text-gray-500 hover:text-navy`,
};

const TONES = {
  neutral: 'bg-gray-100 text-gray-600',
  green: 'bg-green-50 text-green-700',
  amber: 'bg-amber-50 text-amber-700',
  navy: 'bg-navy-light text-navy',
  red: 'bg-red-tint text-red',
} as const;

export function chip(text: string, tone: keyof typeof TONES = 'neutral'): string {
  return `<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONES[tone]}">${escapeHtml(text)}</span>`;
}

export function row(o: { title: string; subtitle?: string; chips?: string; trailing?: string; attrs?: string; selected?: boolean }): string {
  return `<div ${o.attrs ?? ''} class="flex items-center gap-3 min-h-14 px-4 py-3 bg-white border ${o.selected ? 'border-navy-mid bg-navy-light/40' : 'border-border'} rounded-xl">
    <div class="flex-1 min-w-0">
      <p class="text-sm font-medium text-navy truncate">${escapeHtml(o.title)}</p>
      ${o.subtitle ? `<p class="text-xs text-gray-500 truncate">${escapeHtml(o.subtitle)}</p>` : ''}
      ${o.chips ? `<div class="flex flex-wrap gap-1 mt-1">${o.chips}</div>` : ''}
    </div>
    ${o.trailing ? `<div class="shrink-0 flex items-center gap-2">${o.trailing}</div>` : ''}
  </div>`;
}

export function switchControl(o: { id: string; checked: boolean; label: string; hint?: string; attrs?: string }): string {
  return `<div class="flex items-center justify-between gap-3 min-h-11 py-2 border-b border-border last:border-0">
    <label for="${escapeHtml(o.id)}" class="flex-1 min-w-0 cursor-pointer">
      <span class="block text-sm text-navy">${escapeHtml(o.label)}</span>
      ${o.hint ? `<span class="block text-xs text-gray-500">${escapeHtml(o.hint)}</span>` : ''}
    </label>
    <input id="${escapeHtml(o.id)}" type="checkbox" role="switch" ${o.checked ? 'checked' : ''} ${o.attrs ?? ''}
      class="appearance-none w-11 h-6 rounded-full bg-gray-300 checked:bg-navy relative cursor-pointer transition-colors
        after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:transition-all
        checked:after:left-[1.375rem] ${FOCUS}" />
  </div>`;
}

export function emptyState(text: string): string {
  return `<p class="text-center py-10 text-sm text-gray-500">${escapeHtml(text)}</p>`;
}

export function sectionCard(inner: string): string {
  return `<div class="bg-white rounded-2xl border border-border p-4 lg:p-6">${inner}</div>`;
}

/** Two clicks instead of window.confirm: the first changes the label, the second acts. Disarms after 4 s. */
export function armConfirm(button: HTMLButtonElement, confirmLabel: string, onConfirm: () => void | Promise<void>): void {
  const original = button.textContent ?? '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener('click', async () => {
    if (button.dataset.armed !== '1') {
      button.dataset.armed = '1';
      button.textContent = confirmLabel;
      timer = setTimeout(() => { button.dataset.armed = ''; button.textContent = original; }, 4000);
      return;
    }
    if (timer) clearTimeout(timer);
    button.dataset.armed = '';
    button.disabled = true;
    try { await onConfirm(); } finally { button.disabled = false; button.textContent = original; }
  });
}

/** Toasts stack at the bottom, full width on a phone. */
export function toast(message: string, isError = false): void {
  const stack = document.getElementById('toastStack');
  if (!stack) return;
  const el = document.createElement('div');
  el.setAttribute('role', isError ? 'alert' : 'status');
  el.className = `px-5 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${isError ? 'bg-red' : 'bg-navy'}`;
  el.textContent = message;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
```

- [ ] **Step 4: Run tests** (focused, then `npm test`, `npx astro check`). Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/admin/ui-kit.ts tests/admin-ui-kit.test.ts
git commit -m "Admin panel: shared UI kit (rows, chips, switches, confirm, toasts)"
```

---

### Task 4: Split `admin-panel.ts` into section modules (no behaviour change)

**Files:**
- Create: `src/scripts/admin/context.ts`, `src/scripts/admin/sections/users.ts`, `announcements.ts`, `blog.ts`, `mail.ts`, `symposium.ts`, `src/scripts/admin/main.ts`
- Delete: `src/scripts/admin-panel.ts`
- Modify: `src/components/admin/AdminShell.astro` (script import), `tests/admin-foundation-i18n.test.ts` and any other test that reads `src/scripts/admin-panel.ts` (find them with `grep -rn "admin-panel" tests`)

**Interfaces:**
- Produces:
  - `context.ts`: `lang: 'en' | 'tr'`, `t`, `tf(key, vars)`, `showToast(message, isError?)` (delegates to `toast` from ui-kit and, until Task 5 replaces `#toast`, to the old element), `formatDate(ts)`, `dateLocale`
  - `sections/users.ts`: `loadUsers()`, `setupUsersFilters()` (the filter-button and search wiring now at the end of the bootstrap), `doAction`, `renderUsers` (unchanged behaviour)
  - `sections/announcements.ts`: `loadAnnouncements()`, `setupAnnouncementForm()`, `setCanManageAnnouncements(v: boolean)`
  - `sections/blog.ts`: `loadBlogSubmissions()`
  - `sections/mail.ts`: `loadSenders()`, `setupBulkGrant()`, `loadAdminAttachments()`, `setupAttachmentUpload()`, `loadAllSends()`
  - `sections/symposium.ts`: `setupSymposium()` (calls setupEditionForm, setupSpeakerForm, setupSessionForm, setupCommitteeForm, setupCertificates), `loadSymposium()` (loadEdition, loadSpeakers, loadSessions, loadCommittee, loadCertificates), plus `showRebuildStatus` and `whileSaving` exported for `admin-certificates.ts`
  - `main.ts`: the bootstrap that is today the IIFE at the end of `admin-panel.ts` (unchanged order and conditions), including `applyRoleVisibility`, `registerPaneLoader`, `setupPaneSwitching` moved verbatim (Task 5 replaces them)

- [ ] **Step 1: Map the file.** Run `grep -n "^function\|^async function\|^const\|^let" src/scripts/admin-panel.ts` and assign each top-level declaration to a module by what it touches:
  - context: lines 27-40 (`lang`, `t`, `tf`, `dateLocale`), `showToast` (77), `formatDate` (86)
  - announcements: `renderAnnouncements` (103) to `setupAnnouncementForm` (168-214), `canManageAnnouncements`
  - users: `doAction` (215), `renderUsers` (233), `loadUsers` (407), `currentFilter`, `searchTimer`, `badgeCatalog`, `RANK_*`, `RANKS`, `moreMenuWidthClass`, and the filter/search wiring at the end of the bootstrap
  - mail: `loadSenders` (436) through `loadAllSends` (658-686), `ATTACHMENT_ERRORS`, `MAX_ATTACHMENT_BYTES`, `ALLOWED_UPLOAD_TYPES`, `formatBytes`
  - blog: `escapeHtmlForBlogReview` (882) through `loadBlogSubmissions` (933-1015)
  - symposium: lines 1016 to the end of the symposium code (`whileSaving`, `showRebuildStatus`, edition, speakers, sessions, committee, photo upload), `symposiumYear`, `symposiumSpeakers`
  - main: `applyRoleVisibility` (701), the pane loader block (729-756), `setupPaneSwitching` (758), the bootstrap IIFE
- [ ] **Step 2: Move the code.** Cut each group into its module verbatim, add `export` to what other modules call, and add imports (`escapeHtml`, `useTranslations`, the context helpers). Where `doAction` calls `loadSenders()`, import it from `./mail`. Keep every DOM id and every behaviour as it is.
- [ ] **Step 3: Repoint the entry.** In `AdminShell.astro`, change `import '../../scripts/admin-panel';` to `import '../../scripts/admin/main';`. Update tests that read `src/scripts/admin-panel.ts` to read the new modules: in `tests/admin-foundation-i18n.test.ts` replace `'admin-panel'` in the file list with the new paths, reading each with `new URL('../src/scripts/admin/<path>.ts', import.meta.url)`. Delete `src/scripts/admin-panel.ts`.
- [ ] **Step 4: Verify nothing changed.** Run `npm test`, `npx astro check`, `npm run build`. All pass. Then, with `npx astro preview --port 4329` running, run the existing browser checks that drive the panel (`tests/browser/certificates-admin.mjs`, `tests/browser/committee-admin.mjs`, `tests/browser/speaker-admin.mjs`, `tests/browser/user-roles.mjs`), adjusting only their BASE to `http://localhost:4329` through the `BASE` variable if they read one. Expected: same results as on `main`.
- [ ] **Step 5: Commit**

```bash
git add -A src/scripts src/components/admin/AdminShell.astro tests
git commit -m "Admin panel: split admin-panel.ts into one module per section (no behaviour change)"
```

---

### Task 5: The new shell (sidebar, drawer, routing, sub-pages, Overview)

**Files:**
- Rewrite: `src/components/admin/AdminNav.astro`
- Modify: `src/components/admin/AdminShell.astro`, `src/components/admin/panes/SymposiumPane.astro`, `src/components/admin/panes/SocialPane.astro`, `src/scripts/social/index.ts`, `src/scripts/admin/main.ts`, `src/scripts/admin-health.ts`
- Create: `src/scripts/admin/shell.ts`, `src/scripts/admin/overview.ts`, `tests/browser/admin-shell.mjs`

**Interfaces:**
- Consumes: Task 1 (`SECTIONS`, `GROUPS`, `visibleSections`, `subsFor`, `rolesFromMe`, `parseHash`, `toHash`, `resolveRoute`), Task 2 (`/api/admin/counts`), Task 3 (`row`, `chip`, `toast`), Task 4 modules.
- Produces:
  - DOM contract: each section is `<section data-section="<SectionId>">`; a sub-page inside it is `<div data-sub="<sub id>">`. `#sectionNav` holds the sidebar; `#navDrawer` the phone drawer; `#subNav` the desktop sub-tabs or phone sub-list; `#toastStack` the toasts; `#healthBanner` stays.
  - `shell.ts`: `startShell(roles: RoleFlags, hooks: { onShow?: Partial<Record<SectionId, () => Promise<void>>>; onSub?: Partial<Record<SectionId, (sub: string) => void>> }): void` and `refreshCounts(): Promise<void>`
  - `social/index.ts`: `showSocialTab(tab)` exported; its own tab bar removed.

Markup changes:

- [ ] **Step 1: Sections and sub-pages in markup.**
  - In `AdminShell.astro`, wrap each pane in `<section data-section="...">` with the registry id, replacing `data-pane`:
    - users pane: `kullanicilar`, its body inside `<div data-sub="liste">`, and add an empty `<div data-sub="yetkiler"><div id="rolesView"></div></div>` (Task 6 fills it);
    - announcements: `duyurular`;
    - blog: `blog`;
    - the four mail panes become one `<section data-section="eposta">` with `<div data-sub="yetki">`, `<div data-sub="gondericiler">`, `<div data-sub="ekler">`, `<div data-sub="gonderilenler">`;
    - connections: `baglantilar`;
    - audit: `kayit`.
  - Add `<section data-section="genel"><div id="overview"></div></section>` first.
  - In `SymposiumPane.astro`, the root gets `data-section="sempozyum"`. Each of the five `<section>` blocks becomes `<div data-sub="baski">`, `konusmacilar`, `oturumlar`, `komite`, `sertifikalar` (keep the inner markup and ids).
  - In `SocialPane.astro`, the root gets `data-section="sosyal"`. Delete the `#socialTabs` bar. Each `data-social-view="<tab>"` section also gets `data-sub` with the registry id: calendar→`takvim`, pending→`onay`, drafts→`taslaklar`, published→`yayinlananlar`, events→`etkinlik`.
  - Remove the header's `#statsRow`, the subtitle line and the old `#toast`. Add `<div id="toastStack" class="fixed z-50 bottom-4 inset-x-4 lg:inset-x-auto lg:right-6 flex flex-col gap-2 items-stretch lg:items-end"></div>`.
- [ ] **Step 2: The nav component.** Rewrite `AdminNav.astro` to render, from `SECTIONS` and `GROUPS`, a sidebar with every entry (roles prune at runtime, as today). The sidebar is visible from `lg` up. Below `lg` the same markup is inside a drawer behind a ☰ button. Entries are `<a href="#<id>" data-nav="<id>">` with a `<span data-count="<countKey>">` slot. The groups' headings carry `data-nav-group`. Each link is `min-h-11 lg:min-h-9`.

```astro
---
import { SECTIONS, GROUPS } from '../../scripts/admin/sections';
import { useTranslations } from '../../i18n/ui';
interface Props { lang: 'en' | 'tr' }
const t = useTranslations(Astro.props.lang);
const link = 'flex items-center justify-between gap-2 px-3 min-h-11 lg:min-h-9 rounded-lg text-sm text-navy hover:bg-[#F7F7F6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';
const countSlot = (k?: string) => (k ? `<span data-count="${k}" class="hidden min-w-5 px-1.5 rounded-full bg-red text-white text-xs text-center"></span>` : '');
const overview = SECTIONS.find((s) => s.id === 'genel')!;
---
<nav id="sectionNav" aria-label={t('admin.nav.menu')} class="flex flex-col gap-0.5 text-sm">
  <a href="#genel" data-nav="genel" class={link}><span>{t(overview.label as never)}</span></a>
  {GROUPS.map((g) => (
    <div data-nav-group={g.id} class="mt-3">
      <p class="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">{t(g.label as never)}</p>
      {SECTIONS.filter((s) => s.group === g.id).map((s) => (
        <a href={`#${s.id}`} data-nav={s.id} class={link}><span>{t(s.label as never)}</span><Fragment set:html={countSlot(s.count)} /></a>
      ))}
    </div>
  ))}
</nav>
```

  In `AdminShell.astro`, lay the content out as:
  - a top bar visible below `lg`: `<button id="navToggle" aria-controls="navDrawer" aria-expanded="false" class="w-11 h-11 ...">☰</button>`, the current title `#phoneTitle`, and a `#phoneBack` ‹ button (hidden by default);
  - `<aside class="hidden lg:block w-60 shrink-0 bg-white rounded-2xl border border-border p-2"><AdminNav lang={lang} /></aside>`;
  - `<div id="navDrawer" class="hidden fixed inset-0 z-40 bg-black/30 lg:hidden"><div class="w-4/5 max-w-xs h-full bg-white p-3 overflow-y-auto" data-drawer-panel></div></div>`. `shell.ts` clones `#sectionNav` into the drawer panel at start, so both carry identical links.
  - the content column: `<h1 id="sectionTitle">`, then `<div id="subNav">`, then the sections.
- [ ] **Step 3: `shell.ts`.**

```ts
/**
 * Shows one section (and one sub-page) at a time, from the address. Prunes
 * what the roles do not grant, fills the menu counts, and runs the phone
 * drawer and the phone's list-then-page sub-navigation.
 */
import { SECTIONS, visibleSections, subsFor, type RoleFlags, type SectionId } from './sections';
import { parseHash, toHash, resolveRoute, type Route } from './router';
import { t } from './context';

type Hooks = { onShow?: Partial<Record<SectionId, () => Promise<void>>>; onSub?: Partial<Record<SectionId, (sub: string) => void>> };
const PHONE = window.matchMedia('(max-width: 1023px)');
let roles: RoleFlags;
let hooks: Hooks;
let oauthReturn = false;
const loaded = new Set<SectionId>();

export function startShell(r: RoleFlags, h: Hooks): void {
  roles = r;
  hooks = h;
  const visible = new Set(visibleSections(r).map((s) => s.id));
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => { if (!visible.has(el.dataset.section as SectionId)) el.remove(); });
  for (const s of SECTIONS) {
    for (const sub of s.subs) {
      if (!subsFor(s, r).some((x) => x.id === sub.id)) document.querySelectorAll(`[data-section="${s.id}"] [data-sub="${sub.id}"]`).forEach((el) => el.remove());
    }
  }
  pruneNav(document.getElementById('sectionNav')!, visible);
  const panel = document.querySelector<HTMLElement>('[data-drawer-panel]')!;
  panel.replaceChildren(document.getElementById('sectionNav')!.cloneNode(true));
  panel.querySelector('nav')!.id = 'drawerNav';
  wireDrawer();
  const params = new URLSearchParams(location.search);
  oauthReturn = params.has('connected') || params.has('connection_error');
  window.addEventListener('hashchange', () => go());
  PHONE.addEventListener('change', () => go());
  go();
  void refreshCounts();
}

function pruneNav(nav: HTMLElement, visible: Set<SectionId>): void {
  nav.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => { if (!visible.has(a.dataset.nav as SectionId)) a.remove(); });
  nav.querySelectorAll<HTMLElement>('[data-nav-group]').forEach((g) => { if (!g.querySelector('[data-nav]')) g.remove(); });
  if (visible.size <= 1) document.querySelectorAll('#navToggle, aside:has(#sectionNav)').forEach((el) => el.classList.add('!hidden'));
}

function go(): void {
  const route = resolveRoute(parseHash(location.hash), roles, PHONE.matches, oauthReturn);
  oauthReturn = false;
  const wanted = toHash(route);
  if (location.hash !== wanted) history.replaceState(null, '', `${location.pathname}${location.search}${wanted}`);
  show(route);
}

function show(route: Route): void {
  const section = SECTIONS.find((s) => s.id === route.section)!;
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => el.classList.toggle('hidden', el.dataset.section !== route.section));
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === route.section;
    a.classList.toggle('bg-navy-light', on);
    a.classList.toggle('font-semibold', on);
    a.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const subs = subsFor(section, roles);
  const host = document.querySelector<HTMLElement>(`[data-section="${route.section}"]`)!;
  host.querySelectorAll<HTMLElement>('[data-sub]').forEach((el) => el.classList.toggle('hidden', el.dataset.sub !== route.sub));
  renderSubNav(route, subs);
  const title = t(section.label as never) as string;
  document.getElementById('sectionTitle')!.textContent = title;
  document.getElementById('phoneTitle')!.textContent = route.sub ? (t(subs.find((s) => s.id === route.sub)!.label as never) as string) : title;
  document.getElementById('phoneBack')!.classList.toggle('hidden', !(PHONE.matches && route.sub && subs.length));
  closeDrawer();
  if (!loaded.has(route.section)) {
    loaded.add(route.section);
    const load = hooks.onShow?.[route.section];
    if (load) void load().catch(() => {});
  }
  if (route.sub) hooks.onSub?.[route.section]?.(route.sub);
  void fetch('/api/audit/view', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pane: route.section }), keepalive: true,
  }).catch(() => {});
}

function renderSubNav(route: Route, subs: { id: string; label: string }[]): void {
  const nav = document.getElementById('subNav')!;
  if (subs.length === 0) { nav.replaceChildren(); return; }
  if (PHONE.matches) {
    // Phone: the list of sub-pages first; a sub-page hides the list.
    nav.innerHTML = route.sub ? '' : `<div class="flex flex-col gap-2">${subs.map((s) => `
      <a href="${toHash({ section: route.section, sub: s.id })}" class="flex items-center justify-between min-h-14 px-4 rounded-xl border border-border bg-white text-navy text-base">
        <span>${t(s.label as never)}</span><span aria-hidden="true">›</span></a>`).join('')}</div>`;
    return;
  }
  nav.innerHTML = `<div role="tablist" class="flex flex-wrap gap-2 mb-4">${subs.map((s) => `
    <a role="tab" aria-selected="${s.id === route.sub}" href="${toHash({ section: route.section, sub: s.id })}"
      class="px-3 min-h-9 inline-flex items-center rounded-full border text-sm ${s.id === route.sub ? 'bg-navy-light border-navy-mid text-navy font-semibold' : 'border-border text-gray-500 hover:text-navy'}">
      ${t(s.label as never)}</a>`).join('')}</div>`;
}

function wireDrawer(): void {
  const toggle = document.getElementById('navToggle')!;
  const drawer = document.getElementById('navDrawer')!;
  toggle.addEventListener('click', () => {
    const open = drawer.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  drawer.addEventListener('click', (e) => { if (e.target === drawer) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.getElementById('phoneBack')!.addEventListener('click', () => {
    const r = parseHash(location.hash);
    if (r) location.hash = `#${r.section}`;
  });
}

function closeDrawer(): void {
  document.getElementById('navDrawer')?.classList.add('hidden');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
}

export async function refreshCounts(): Promise<void> {
  let counts: Record<string, number> = {};
  try {
    const res = await fetch('/api/admin/counts');
    if (res.ok) counts = await res.json();
  } catch { /* the menu works without numbers */ }
  document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const n = counts[el.dataset.count!] ?? 0;
    el.textContent = String(n);
    el.classList.toggle('hidden', n === 0);
  });
}
```

- [ ] **Step 4: Social tabs follow the shell.** In `src/scripts/social/index.ts`:
  - export `showSocialTab(tab: Tab)` (rename `showTab`);
  - drop the `[data-social-tab]` listeners and their styling (the bar no longer exists);
  - make `loadSocial()` call `refreshPendingCount()` without forcing `calendar`.

  In `main.ts`, map shell sub ids to social tabs: `onSub.sosyal = (sub) => showSocialTab({ takvim: 'calendar', onay: 'pending', taslaklar: 'drafts', yayinlananlar: 'published', etkinlik: 'events' }[sub] as never)`. The pending count beside "Onay bekleyen" now comes from `refreshCounts()`. After a social change, call `refreshCounts()` from the social `onChange` hook so the menu number follows; pass it in `SocialDeps` as `refreshCounts`.
- [ ] **Step 5: Overview.** `src/scripts/admin/overview.ts`:

```ts
/** Overview: waiting work, health, and what is coming up, limited to what the roles may see. */
import { row } from './ui-kit';
import { t, tf } from './context';
import { escapeHtml } from '../escape-html';

const CARDS: { key: string; section: string; label: string }[] = [
  { key: 'email', section: 'eposta', label: 'admin.overview.email' },
  { key: 'social', section: 'sosyal/onay', label: 'admin.overview.social' },
  { key: 'blog', section: 'blog', label: 'admin.overview.blog' },
];

export async function loadOverview(): Promise<void> {
  const host = document.getElementById('overview');
  if (!host) return;
  let counts: Record<string, number> = {};
  try { const r = await fetch('/api/admin/counts'); if (r.ok) counts = await r.json(); } catch { /* empty overview */ }
  const waiting = CARDS.filter((c) => (counts[c.key] ?? 0) > 0)
    .map((c) => `<a href="#${c.section}" class="block">${row({ title: tf(c.label as never, { n: counts[c.key] }), trailing: '<span aria-hidden="true">›</span>' })}</a>`).join('');
  const upcoming = counts.scheduledThisWeek !== undefined
    ? `<a href="#sosyal/takvim" class="block">${row({ title: tf('admin.overview.scheduled' as never, { n: counts.scheduledThisWeek }), trailing: '<span aria-hidden="true">›</span>' })}</a>` : '';
  host.innerHTML = `
    <h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.waiting' as never))}</h2>
    <div class="flex flex-col gap-2 mb-6">${waiting || `<p class="text-sm text-gray-500">${escapeHtml(t('admin.overview.nothingWaiting' as never))}</p>`}</div>
    <h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.health' as never))}</h2>
    <div id="overviewHealth" class="mb-6"></div>
    ${upcoming ? `<h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(t('admin.overview.upcoming' as never))}</h2><div class="flex flex-col gap-2">${upcoming}</div>` : ''}`;
}
```

  In `admin-health.ts`, after filling `#healthBanner`, also fill `#overviewHealth` when present:
  - with the same issue lines when there are issues;
  - with `t('admin.overview.healthy')` when there are none.

  The Fix button navigates with `location.hash = '#baglantilar'` instead of clicking the old nav item.

  i18n, both languages:

English:
```ts
    'admin.overview.waiting': 'Waiting for you',
    'admin.overview.nothingWaiting': 'Nothing is waiting.',
    'admin.overview.email': '{n} unread e-mail conversations',
    'admin.overview.social': '{n} posts awaiting approval',
    'admin.overview.blog': '{n} blog submissions to review',
    'admin.overview.health': 'System',
    'admin.overview.healthy': 'Everything is working.',
    'admin.overview.upcoming': 'Coming up',
    'admin.overview.scheduled': '{n} posts scheduled this week',
```

Turkish:
```ts
    'admin.overview.waiting': 'Seni bekleyenler',
    'admin.overview.nothingWaiting': 'Bekleyen iş yok.',
    'admin.overview.email': '{n} okunmamış e-posta yazışması',
    'admin.overview.social': '{n} gönderi onay bekliyor',
    'admin.overview.blog': '{n} blog başvurusu inceleme bekliyor',
    'admin.overview.health': 'Sistem',
    'admin.overview.healthy': 'Her şey çalışıyor.',
    'admin.overview.upcoming': 'Yaklaşanlar',
    'admin.overview.scheduled': 'Bu hafta {n} gönderi zamanlanmış',
```

- [ ] **Step 6: Boot.** In `main.ts`:
  - Replace the call to `applyRoleVisibility(...)` with `startShell(rolesFromMe(data.user), { onShow, onSub })`. `onShow` maps:
    - `genel` → `loadOverview`
    - `baglantilar` → `loadConnections`
    - `kayit` → `loadAudit`
    - `sosyal` → `loadSocial`
  - Keep the eager loads that exist today, gated by the same conditions.
  - Keep the OAuth toast and the URL clean-up, but replace `history.replaceState(null, '', location.pathname)` with `history.replaceState(null, '', location.pathname + location.hash)`, so the route survives.
  - Delete `applyRoleVisibility`, `setupPaneSwitching`, `registerPaneLoader` and `runPaneLoader`.
  - The not-authorised check uses `landing(rolesFromMe(data.user)) === null`.
- [ ] **Step 7: Browser check.** Create `tests/browser/admin-shell.mjs`, which stubs `/api/**` with Playwright `page.route`, following `tests/browser/certificates-admin.mjs`.
  - Stubs:
    - `/api/me` returns a chosen role set;
    - `/api/admin/counts` returns `{ email: 3, social: 2, blog: 1, scheduledThisWeek: 4 }`;
    - every other GET returns `{}` or the minimal list shape it needs;
    - every POST returns 204.
  - Run as admin at 1280 px:
    - the panel lands on `#genel`;
    - the menu shows the four group headings and the E-posta count 3;
    - clicking Sempozyum makes the hash `#sempozyum/baski` and shows five sub-tabs;
    - clicking "Komite" makes it `#sempozyum/komite`;
    - reload keeps `#sempozyum/komite`;
    - browser back returns to `#sempozyum/baski`.
  - Run as a social-only user:
    - the panel lands on `#sosyal/takvim`;
    - there is no Overview link;
    - no group heading other than İletişim;
    - no ☰ at 390 px.
  - Run as admin at 390 px:
    - ☰ opens the drawer and choosing E-posta shows four list rows;
    - tapping "Ekler" shows the attachments sub-page and ‹;
    - ‹ returns to the list;
    - browser back from the list returns to the previous section;
    - `document.documentElement.scrollWidth <= 390`.
  - Open `/admin?connected=instagram#eposta/ekler` as admin: it shows Bağlantılar and the success toast, and the URL becomes `/admin#baglantilar`.
  - Collect `pageerror` events; fail on any.
- [ ] **Step 8: Run** `npm test`, `npx astro check`, `npm run build`, then the browser check (`BASE=http://localhost:4329 node tests/browser/admin-shell.mjs`) and the four older panel browser checks from Task 4. All pass.
- [ ] **Step 9: Commit**

```bash
git add -A src tests
git commit -m "Admin panel: grouped navigation, Overview, routes in the address, phone drawer and list-then-page sub-navigation"
```

---

### Task 6: Users and roles (two tabs)

**Files:**
- Modify: `src/scripts/admin/sections/users.ts`, `src/components/admin/AdminShell.astro` (the `kullanicilar` section markup), `src/i18n/ui.ts`
- Test: `tests/browser/admin-users.mjs`

**Interfaces:**
- Consumes: `row`, `chip`, `switchControl`, `armConfirm`, `BTN`, `emptyState` (Task 3); `GET /api/admin/users?filter=&search=` and `PATCH /api/admin/users {user_id, action, value?}` (unchanged; actions listed in `ROLE_UPDATES` and `set_rank`, `award_badge`, `revoke_badge`, `make_private`, `clear_bio`, `make_sender`, `remove_sender`).
- Produces: `loadUsers()`, `renderRolesView()`, and the role table `ROLE_SWITCHES` below.

Layout (`data-sub="liste"`):
- **Desktop:** a two-column layout (`lg:grid lg:grid-cols-[1fr_22rem] gap-4`):
  - Left: a search box, filter chips (Hepsi / Üyeler / Bekleyenler / Yetkisi olanlar), then rows.
  - Right: a detail panel `#userDetail`.
- **Phone:** selecting a row hides the list and shows the detail full width, with a ‹ that returns to the list. This uses `#userDetail` and a back button inside it; it does not touch the shell route.

- [ ] **Step 1: Role switches.** In `users.ts`:

```ts
/** Each role as a switch: on → make_*, off → remove_*. Order and copy shown in the detail panel and on the Roles tab. */
export const ROLE_SWITCHES = [
  { flag: 'is_admin', on: 'make_admin', off: 'remove_admin', label: 'admin.roles.admin', hint: 'admin.roles.adminHint' },
  { flag: 'is_announcer', on: 'make_announcer', off: 'remove_announcer', label: 'admin.roles.announcer', hint: 'admin.roles.announcerHint' },
  { flag: 'is_writer', on: 'make_writer', off: 'remove_writer', label: 'admin.roles.writer', hint: 'admin.roles.writerHint' },
  { flag: 'is_sender', on: 'make_sender', off: 'remove_sender', label: 'admin.roles.sender', hint: 'admin.roles.senderHint' },
  { flag: 'is_symposium', on: 'make_symposium', off: 'remove_symposium', label: 'admin.roles.symposium', hint: 'admin.roles.symposiumHint' },
  { flag: 'is_social', on: 'make_social', off: 'remove_social', label: 'admin.roles.social', hint: 'admin.roles.socialHint' },
  { flag: 'is_social_publisher', on: 'make_social_publisher', off: 'remove_social_publisher', label: 'admin.roles.socialPublisher', hint: 'admin.roles.socialPublisherHint' },
] as const;
```

  i18n, both languages:

English:
```ts
    'admin.roles.admin': 'Admin', 'admin.roles.adminHint': 'Sees and manages everything',
    'admin.roles.announcer': 'Announcements', 'admin.roles.announcerHint': 'Writes site announcements',
    'admin.roles.writer': 'Blog writer', 'admin.roles.writerHint': 'May submit blog posts',
    'admin.roles.sender': 'E-mail sender', 'admin.roles.senderHint': 'Sends e-mail as RSG',
    'admin.roles.symposium': 'Symposium', 'admin.roles.symposiumHint': 'Manages the symposium site and certificates',
    'admin.roles.social': 'Social media', 'admin.roles.socialHint': 'Prepares posts',
    'admin.roles.socialPublisher': 'Social media publisher', 'admin.roles.socialPublisherHint': 'Approves and publishes posts',
    'admin.users.filter.roles': 'Has a role',
    'admin.users.detail.membership': 'Membership',
    'admin.users.detail.roles': 'Roles',
    'admin.users.detail.profile': 'Profile',
    'admin.users.detail.rank': 'Rank',
    'admin.users.detail.badges': 'Skill badges',
    'admin.users.detail.select': 'Select a person to see their details.',
    'admin.users.detail.confirm': 'Click again to confirm',
    'admin.roles.addPerson': 'Add person',
    'admin.roles.addPlaceholder': 'Name or e-mail',
    'admin.roles.nobody': 'Nobody has this role.',
```

Turkish:
```ts
    'admin.roles.admin': 'Admin', 'admin.roles.adminHint': 'Her şeyi görür ve yönetir',
    'admin.roles.announcer': 'Duyurular', 'admin.roles.announcerHint': 'Site duyurularını yazar',
    'admin.roles.writer': 'Blog yazarı', 'admin.roles.writerHint': 'Blog yazısı gönderebilir',
    'admin.roles.sender': 'E-posta gönderici', 'admin.roles.senderHint': 'RSG adına e-posta gönderir',
    'admin.roles.symposium': 'Sempozyum', 'admin.roles.symposiumHint': 'Sempozyum sitesini ve sertifikaları yönetir',
    'admin.roles.social': 'Sosyal medya', 'admin.roles.socialHint': 'Gönderi hazırlar',
    'admin.roles.socialPublisher': 'Sosyal medya yayıncısı', 'admin.roles.socialPublisherHint': 'Gönderileri onaylar ve yayınlar',
    'admin.users.filter.roles': 'Yetkisi olanlar',
    'admin.users.detail.membership': 'Üyelik',
    'admin.users.detail.roles': 'Yetkiler',
    'admin.users.detail.profile': 'Profil',
    'admin.users.detail.rank': 'Seviye',
    'admin.users.detail.badges': 'Beceri rozetleri',
    'admin.users.detail.select': 'Ayrıntısını görmek için bir kişi seç.',
    'admin.users.detail.confirm': 'Onaylamak için tekrar tıkla',
    'admin.roles.addPerson': 'Kişi ekle',
    'admin.roles.addPlaceholder': 'İsim ya da e-posta',
    'admin.roles.nobody': 'Bu yetkide kimse yok.',
```

- [ ] **Step 2: The list.**
  - Replace the table markup in the `liste` sub-page with:
    - `#searchInput`;
    - filter chips (`data-filter="all|members|pending|roles"`; "roles" filters client-side to users with any role flag);
    - `#usersList`;
    - `#emptyState`;
    - `#userDetail`.
  - `renderUsers(users)` renders one `row` per user:
    - title: display name, or the email when the profile is empty;
    - subtitle: the email;
    - chips: membership (green "Üye" or neutral "Bekliyor"), one navy chip per role, an amber chip for private;
    - attrs: `data-user="<id>" role="button" tabindex="0"`.
  - Clicking a row or pressing Enter on it selects it and renders the detail.
- [ ] **Step 3: The detail panel.** `renderDetail(u)` shows, top to bottom:
  - name, email and the joined date;
  - **Membership:** the state chip and a verify/unverify `BTN.secondary` button (part 3 moves this to Üyelik);
  - **Roles:** one `switchControl` per `ROLE_SWITCHES` entry, `attrs: data-action-on="<on>" data-action-off="<off>"`. On change, PATCH with the right action, then reload the users and re-select the same user. Turning `is_admin` off for the signed-in admin themself is armed with `armConfirm` (the server already allows it; this only prevents a slip);
  - **Profile:** "Profili gizle" (`make_private`) and "Biyografiyi temizle" (`clear_bio`), both armed with `armConfirm`;
  - **Rank:** the existing rank `<select>` (`set_rank`);
  - **Skill badges:** the existing badge chips (`award_badge` / `revoke_badge`).
  - On a phone the detail opens full width with a ‹ back button.
- [ ] **Step 4: Roles tab.** `renderRolesView(users)` fills `#rolesView`:
  - one card per `ROLE_SWITCHES` entry, with its label, its hint and the people holding the flag;
  - each person is a chip with a × button that PATCHes the off action (armed with `armConfirm`);
  - "+ Kişi ekle" opens an inline search input that filters the loaded users by name or email and adds with the on action;
  - the roles tab loads users with `filter=all` (the 100-row cap is today's server behaviour and stays).
- [ ] **Step 5: Browser check** `tests/browser/admin-users.mjs` (stubbed API, two users, one an admin):
  - toggle a role and assert the PATCH body;
  - the roles tab shows the person under the role;
  - remove with two clicks;
  - at 390 px the list has no horizontal overflow, and the detail opens and closes with ‹.
- [ ] **Step 6: Run** `npm test`, `npx astro check`, the browser checks (this one, `admin-shell.mjs`, `user-roles.mjs`, adjusting `user-roles.mjs` selectors to the new markup if it targeted the old table).
- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "Admin panel: users and roles as rows with a detail panel and a roles tab"
```

---

### Task 7: Redraw Announcements, Blog, E-posta lists, Bağlantılar and İşlem kaydı

**Files:**
- Modify:
  - `src/components/admin/AdminShell.astro` (the markup of these sections);
  - `src/scripts/admin/sections/announcements.ts`, `blog.ts`, `mail.ts`;
  - `src/scripts/admin-connections.ts`, `src/scripts/admin-audit.ts`.
- Test: extend `tests/browser/admin-shell.mjs`

**Interfaces:**
- Consumes: `row`, `chip`, `BTN`, `emptyState`, `armConfirm`, `sectionCard` (Task 3).

- [ ] **Step 1: Announcements.**
  - Replace the table with `#announcementsList` rows:
    - title: the announcement title;
    - subtitle: the expiry date and the site;
    - chips: "Popup" when set;
    - trailing: Edit (`BTN.ghost`) and Delete (`BTN.danger`, `armConfirm`).
  - Keep the form, restyled with `BTN.primary`/`BTN.secondary`.
  - Add the shared unsaved-changes guard to `ui-kit.ts` and use it on the announcement form (`guardUnsaved(form, '#duyurular')`; call `.reset()` after a successful save and after "Cancel edit"):

```ts
/**
 * Warns before unsaved form changes are lost: on closing the tab (the
 * browser's own prompt) and on moving to another section (an inline notice
 * with Keep editing / Discard, never window.confirm).
 */
export function guardUnsaved(form: HTMLFormElement, sectionHash: string): { reset(): void } {
  let dirty = false;
  let current = location.hash;
  const notice = document.createElement('div');
  notice.className = 'hidden mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800';
  notice.innerHTML = `<span class="flex-1 min-w-0" data-msg></span><button type="button" data-keep class="${BTN.secondary}"></button><button type="button" data-discard class="${BTN.danger}"></button>`;
  form.before(notice);
  const lang = document.documentElement.lang === 'tr' ? 'tr' : 'en';
  const text = lang === 'tr'
    ? { msg: 'Kaydedilmemiş değişiklikler var.', keep: 'Düzenlemeye devam et', discard: 'Değişiklikleri at' }
    : { msg: 'You have unsaved changes.', keep: 'Keep editing', discard: 'Discard changes' };
  notice.querySelector('[data-msg]')!.textContent = text.msg;
  notice.querySelector('[data-keep]')!.textContent = text.keep;
  notice.querySelector('[data-discard]')!.textContent = text.discard;
  let pending: string | null = null;
  form.addEventListener('input', () => { dirty = true; });
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
  window.addEventListener('hashchange', () => {
    const leaving = current.startsWith(sectionHash) && !location.hash.startsWith(sectionHash);
    if (dirty && leaving && pending === null) {
      pending = location.hash;
      history.replaceState(null, '', current);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      notice.classList.remove('hidden');
      return;
    }
    current = location.hash;
  });
  notice.querySelector('[data-keep]')!.addEventListener('click', () => { pending = null; notice.classList.add('hidden'); });
  notice.querySelector('[data-discard]')!.addEventListener('click', () => {
    dirty = false;
    notice.classList.add('hidden');
    const to = pending;
    pending = null;
    if (to) location.hash = to;
  });
  return { reset() { dirty = false; notice.classList.add('hidden'); } };
}
```

  (These three strings live with the helper, in both languages, because the helper is used by several sections; `tests/admin-ui-kit.test.ts` does not cover it, the browser check in Step 7 does.)
- [ ] **Step 2: Blog.** The submission cards keep their content, restyled as cards with `BTN` buttons. Every `confirm()` in the blog review is replaced by `armConfirm` (find them with `grep -n "confirm(" src/scripts/admin/sections/blog.ts`).
- [ ] **Step 3: E-posta lists.** `loadSenders`, `loadAdminAttachments` and `loadAllSends` render with `row`:
  - senders: name or email, team chip, revoke as `BTN.danger` + `armConfirm`;
  - attachments: filename, size and type, delete as `BTN.danger` + `armConfirm`;
  - sends: subject, recipient count, time, and a status chip (green "Gönderildi", red "Hata").
- [ ] **Step 4: Bağlantılar.** In `admin-connections.ts`, replace the table rows with `row`:
  - title: the platform;
  - subtitle: the account and "connected by ... on ...";
  - chips: the status chip with today's colours;
  - trailing: the connect/reconnect link and the disconnect two-step, which already exists.

  Delete the table markup and keep `#connectionsBody` as the list container.
- [ ] **Step 5: İşlem kaydı.** In `admin-audit.ts`:
  - replace the table with rows: title is the action, subtitle is "time · person · target", and details go in a `<details>` beneath;
  - give the filter fields the kit's input style and labels at `text-sm`;
  - wrap Apply, CSV, JSON and Verify with `BTN` classes in a wrapping flex.
- [ ] **Step 6: Remaining `confirm()` calls.** `grep -rn "confirm(" src/scripts src/components/admin` must find only the typed certificate confirmation (an input, not `confirm()`) and nothing else; replace the rest with `armConfirm`.
- [ ] **Step 7: Browser check.** Extend `tests/browser/admin-shell.mjs`:
  - at 390 px, every one of these sections has `scrollWidth <= 390`;
  - deleting an announcement takes two clicks;
  - leaving a dirty announcement form shows the notice.
- [ ] **Step 8: Run** `npm test`, `npx astro check`, `npm run build`, and the browser checks.
- [ ] **Step 9: Commit**

```bash
git add -A src tests
git commit -m "Admin panel: announcements, blog, e-mail, connections and activity log as rows with shared buttons and two-step confirmation"
```

---

### Task 8: Sempozyum sub-pages restyled, with unsaved-changes guard

**Files:**
- Modify: `src/components/admin/panes/SymposiumPane.astro`, `src/scripts/admin/sections/symposium.ts`, `src/scripts/admin-certificates.ts`
- Test: extend `tests/browser/admin-shell.mjs`; the existing `tests/browser/committee-admin.mjs`, `speaker-admin.mjs`, `certificates-admin.mjs` must still pass.

- [ ] **Step 1: Lists.**
  - Speakers, sessions and committee tables become `row` lists:
    - speaker: name, then affiliation · role;
    - session: time, then title · type;
    - committee member: name, then team chips.
  - Edit and Delete become trailing `BTN.ghost` and `BTN.danger` with `armConfirm`.
  - Keep every form id and field id, so the existing browser checks keep working. Update their selectors only where they targeted `<tr>` or `<td>`.
- [ ] **Step 2: Forms.**
  - Forms keep their grid, use the kit's button classes, and get a sticky save bar on phones (`sticky bottom-0 bg-white py-2`).
  - Add `guardUnsaved(form, '#sempozyum')` (Task 7) to the edition, speaker, session and committee forms. Call `.reset()` after each successful save and after cancelling an edit.
- [ ] **Step 3: Certificates.**
  - The preview list becomes rows.
  - The typed "delete all" confirmation stays as it is.
  - At 390 px the certificates sub-page has no horizontal overflow.
- [ ] **Step 4: Browser check.** Extend `admin-shell.mjs`:
  - each Sempozyum sub-page opens from its tab (desktop) and from the list (phone);
  - a dirty speaker form warns on leaving.
- [ ] **Step 5: Run** `npm test`, `npx astro check`, `npm run build`, `admin-shell.mjs`, `committee-admin.mjs`, `speaker-admin.mjs`, `certificates-admin.mjs`.
- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "Admin panel: symposium as sub-pages with row lists and an unsaved-changes guard"
```

---

### Task 9: Whole-panel verification and docs

**Files:**
- Create: `tests/browser/admin-overflow.mjs`
- Modify: `README.md` (the admin panel section; find it with `grep -n -i "admin panel" README.md`)

- [ ] **Step 1: Overflow check.** Create `tests/browser/admin-overflow.mjs`:
  - For each language (`/admin`, `/tr/admin`), each width (390, 1280) and each section and sub-page reachable as admin (iterate `SECTIONS`, `subsFor` by reading the menu's links and, on the phone, the sub-list), open it with a stubbed API that returns two realistic items per list.
  - On each page, assert `document.documentElement.scrollWidth <= innerWidth`.
  - On the phone, every `a, button, input[type=checkbox]` in the content has `getBoundingClientRect().height >= 44`, except inline links inside paragraphs.
  - No `pageerror` anywhere.
- [ ] **Step 2: README.** Replace the panel description with the new structure: the groups, who sees what, links like `/admin#sempozyum/komite`, and the phone behaviour. One short paragraph and a list. No em dash.
- [ ] **Step 3: Run everything.** `npm test`, `npx astro check`, `npm run build`, and every `tests/browser/admin-*.mjs`, plus `committee-admin`, `speaker-admin`, `certificates-admin`, `user-roles`.
- [ ] **Step 4: Commit**

```bash
git add tests/browser/admin-overflow.mjs README.md
git commit -m "Admin panel: whole-panel overflow and touch-target check; README"
```

---

## Notes for the executor

- Task 4 is a move, not a rewrite. If a moved function behaves differently, that is a bug in the move.
- The membership section (`uyelik`) stays invisible; do not build its content.
- A manual signed-in pass through the real panel (laptop and phone) is done by the user after deploy; the browser checks here use stubbed APIs.
