# Roles With Expiry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every role in the admin panel is a grant with an optional end date. Grants lapse on their own, and the CMS plans that follow build on them.

**Architecture:**
- A `role_grants` table keeps every grant: who, which role, until when, by whom, and when it was revoked.
- For the eight existing roles, the `users.is_*` columns stay the materialised effective state. This keeps the 40-plus existing reads and SQL filters untouched. Every grant, revoke or expiry rewrites the matching column in the same D1 batch as the grant row and its audit row.
- An hourly sweep in the existing mail dispatch tick expires lapsed grants.
- New roles that have no column, the CMS groups added by later plans, are read from active grants only.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), TypeScript, node:test with node:sqlite.

**Spec:** `docs/superpowers/specs/2026-10-23-content-cms-design.md` (section "Calls made while writing this": the general role model is built first). This is plan 1 of 5:
1. roles (this plan)
2. content collections migration
3. CMS core and the Etkinlikler group
4. remaining groups
5. agent access

## Global Constraints

- Durations offered: 1, 2, 3, 6 or 12 months, or a custom end date. Permanent (no end date) only for leader-level roles, and only granted by an admin.
- Leader-level roles (`admin`, `announcer`, `symposium`, `social_publisher`) may run up to 12 months. Edit-level roles (`writer`, `sender`, `social`) may run up to 1 month and are renewed.
- An approver of a CMS group may grant that group's edit role for at most 1 month. Only an admin grants approve roles or anything longer. The catalog supports this now; the CMS roles themselves arrive in plan 3.
- `is_member` is membership, not a role. It stays exactly as it is.
- Nobody loses access at deploy. The backfill gives every current holder a permanent grant before the code that reads grants ships.
- Every grant, revoke and expiry writes an audit row in the same batch (CLAUDE.md rule 9). New action codes need names in `src/lib/audit-labels.ts`.
- Panel strings in both languages in `src/i18n/ui.ts`. Visual changes are shown to the owner before push, at 1280×680, 1366×768, 1440×800, 1536×864, 1440×900, 1920×1080 and 390 px.
- Migration notes go at the top of `db/schema.sql` as **8i**. 8h is taken by the certificate counter.

## Review Focus

1. **A grant that ends while the person is mid-session** must stop working within the hour, not at their next sign-in. Task 4's sweep test pins this.
2. **Removing a role someone holds through two grants**, for example a permanent one plus a one-month one: removing it must end both, or the column flips back on at the next sweep. Task 2 test.
3. **Social publisher implies social editor.** Granting publisher must also make them an editor for the same period. Removing editor removes publisher, as `ROLE_UPDATES` does today. Task 2 test.
4. **An admin removing their own admin role** is still refused, and so is letting their own admin grant expire unnoticed. Task 3 test for the refusal; Task 6 shows the end date on one's own chip.
5. **A duration outside the allowed set**, such as 4 months, 0, a past date or permanent for an edit-level role, is a coded 400 and never a silent clamp. Task 1 test.

---

### Task 1: Role catalog and duration rules

**Files:**
- Create: `functions/_lib/roles.ts`
- Test: `tests/roles-catalog.test.ts`

**Interfaces:**
- Produces:
  - `type RoleKey = 'admin' | 'announcer' | 'writer' | 'sender' | 'symposium' | 'social' | 'social_publisher'` (plan 3 widens this with `content.<group>.edit` and `content.<group>.approve`)
  - `interface RoleDef { key: RoleKey; level: 'leader' | 'edit'; column?: string; implies?: RoleKey[]; approverRole?: string }`
  - `const ROLES: readonly RoleDef[]`
  - `function roleDef(key: string): RoleDef | null`
  - `type Duration = { months: 1 | 2 | 3 | 6 | 12 } | { until: number } | { permanent: true }`
  - `function resolveExpiry(def: RoleDef, d: Duration, now: number, granter: { isAdmin: boolean; activeRoles: string[] }): { ok: true; expiresAt: number | null } | { ok: false; code: 'too_long' | 'permanent_not_allowed' | 'in_the_past' | 'bad_duration' | 'not_allowed' }`

- [ ] **Step 1: Write the failing tests** in `tests/roles-catalog.test.ts`:
  - `months: 1` from 2026-10-23 12:00 TR ends 2026-11-23 12:00 TR (calendar month, not 30 days); `months: 1` from 31 Jan ends 28 Feb, the last day of the month.
  - Edit-level (`writer`): `months: 1` ok, `months: 2` → `too_long`, `permanent` → `permanent_not_allowed`.
  - Leader-level (`symposium`) by an admin: `months: 12` ok, `permanent` ok (`expiresAt: null`), `until` 13 months away → `too_long`.
  - `until` in the past → `in_the_past`; `months: 4` → `bad_duration`.
  - A non-admin granter: any role → `not_allowed`, except when the role's `approverRole` is in `granter.activeRoles`; then `months: 1` ok and `months: 2` → `too_long`. Test this with a fixture `RoleDef` passed directly.
  - `roleDef('social_publisher').implies` equals `['social']`; `roleDef('constructor')` is `null`.
- [ ] **Step 2: Run them to verify they fail.** `node --import tsx --test tests/roles-catalog.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `functions/_lib/roles.ts`.**
  - `column` is `is_<key>` for the seven roles.
  - `implies: ['social']` on `social_publisher`.
  - Month arithmetic is in Türkiye time (UTC+3, no DST; reuse `TR_OFFSET` from `functions/_lib/stats.ts`), clamped to the month's last day.
- [ ] **Step 4: Run them to verify they pass.**
- [ ] **Step 5: Commit.** `git commit -m "Role catalog and grant duration rules"`

### Task 2: Grants table, grant and revoke

**Files:**
- Modify: `db/schema.sql`. Add the `role_grants` table and indexes, plus note **8i** at the top: the `CREATE TABLE` and the backfill.
- Create: `functions/_lib/role-grants.ts`
- Modify: `src/lib/audit-labels.ts` (`role.grant`, `role.revoke`, `role.expire`)
- Test: `tests/role-grants.test.ts`

**Interfaces:**
- Consumes: `ROLES`, `roleDef`, `resolveExpiry` (Task 1); `runWithAudit` (`functions/_lib/audit.ts`).
- Produces:
  - `grantRole(db: D1Database, p: { userId: string; role: RoleKey; expiresAt: number | null; by: string | null; note?: string }, now: number): Promise<void>`
  - `revokeRole(db: D1Database, p: { userId: string; role: RoleKey; by: string }, now: number): Promise<void>`
  - `activeGrants(db: D1Database, userId: string, now: number): Promise<{ role: string; expires_at: number | null }[]>`

Table:

```sql
CREATE TABLE IF NOT EXISTS role_grants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  expires_at INTEGER,            -- NULL: permanent
  granted_by TEXT,               -- NULL: the 8i backfill
  granted_at INTEGER NOT NULL,
  revoked_by TEXT,
  revoked_at INTEGER,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_role_grants_user ON role_grants(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_role_grants_expiry ON role_grants(revoked_at, expires_at);
```

Backfill in note 8i, idempotent. For each column with `is_<role> = 1` and no live grant of that role:
`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, '<role>', NULL, NULL, unixepoch() FROM users WHERE is_<role> = 1 AND NOT EXISTS (...)`, one statement per role.

- [ ] **Step 1: Write the failing tests.** Real schema on `node:sqlite` via `tests/lib/d1-sqlite.ts`:
  - `grantRole` writes one grant row, sets the column to 1, and writes one `role.grant` audit row, all in one batch. Make the audit insert fail and assert that neither the grant nor the column changed.
  - Granting `social_publisher` for 1 month also makes `social` active until the same `expires_at`, with two grant rows.
  - Granting a role the user already holds keeps one live row, the one with the later end. `null` beats any date.
  - `revokeRole` revokes **every** live grant of that role and clears the column. Revoking `social` also revokes `social_publisher`.
  - `activeGrants` excludes revoked rows and rows with `expires_at <= now`.
  - Running the 8i backfill twice on a database with existing `is_*` flags yields exactly one permanent grant per flag.
  - Run `tests/audit-labels.test.ts`: the three new codes have names in both languages.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `functions/_lib/role-grants.ts` and the schema.** Write each mutation, its column update and its audit row in one `runWithAudit` batch. The audit `details` hold `{ role, expiresAt }` and nothing else.
- [ ] **Step 4: Run them, together with `tests/schema*.test.ts`, to verify they pass.** The schema tests already check that every column a note adds is in the body and that indexes come after their tables.
- [ ] **Step 5: Commit.** `git commit -m "Role grants: table, grant and revoke with audit"`

### Task 3: Panel endpoints use grants

**Files:**
- Modify: `functions/api/admin/users.ts`. `ROLE_UPDATES` keeps `verify` and `unverify` as they are. Every `make_*` and `remove_*` goes through `grantRole` and `revokeRole`. The body gains an optional `duration`, shaped as the `Duration` type. Absent means permanent for leader-level roles and 1 month for edit-level ones, so today's panel buttons keep working.
- Modify: `functions/api/admin/senders.ts`. `grantSender` and `revokeSender` call `grantRole` and `revokeRole` for `sender`, and keep writing the `sender_grants` record row in the same batch.
- Modify: `functions/api/admin/users.ts` GET with `filter=roles`. Each user carries `grants: { role, expires_at }[]` from one query over `role_grants` for the listed ids. No per-user query.
- Test: `tests/admin-users-roles.test.ts`

**Interfaces:**
- Consumes: Task 1 `resolveExpiry`; Task 2 `grantRole`, `revokeRole`.
- Produces:
  - PATCH `/api/admin/users` body `{ user_id, action, duration?: Duration }`.
  - Errors: 400 with `code` from `resolveExpiry`.
  - GET rows: `grants: { role: string; expires_at: number | null }[]`.

- [ ] **Step 1: Write the failing tests.**
  - `make_writer` with no duration gives a grant ending in 1 month.
  - `make_admin` with no duration gives a permanent grant.
  - `make_writer` with `{ months: 3 }` → 400 `too_long`.
  - `remove_admin` on oneself is still 400.
  - The bulk sender grant gives `sender` grants and `sender_grants` rows.
  - GET `filter=roles` returns `grants` for each user, and the `bind` count stays under D1's cap of 100 for 150 users. Use `onBind` from `tests/lib/d1-sqlite.ts`.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the whole suite.** `npm test`. Expected: all pass, `tests/audit-coverage.test.ts` included.
- [ ] **Step 5: Commit.** `git commit -m "Admin role actions write expiring grants"`

### Task 4: Hourly expiry sweep

**Files:**
- Modify: `functions/_lib/role-grants.ts`. Add `expireGrants(db: D1Database, now: number): Promise<number>`.
- Modify: `functions/api/mail/dispatch.ts`. On the prune tick (`isPruneTick(now)`, once an hour), call `expireGrants`. Catch and log a failure; it must never block mail.
- Test: `tests/role-grants.test.ts` (extend)

**Interfaces:**
- Produces: `expireGrants(db, now)`. It finds live grants with `expires_at <= now` (by the `(revoked_at, expires_at)` index), marks them `revoked_at = expires_at` and `revoked_by = NULL`, and recomputes each affected user's columns from what is still active. Each user gets one batch and one `role.expire` audit row (`userId: null`). It returns how many grants it ended.

- [ ] **Step 1: Write the failing tests.**
  - Someone holds `writer` until T. At T+1 `expireGrants` ends it, `is_writer` becomes 0, and one `role.expire` row has the right `targetId`.
  - Someone holds `writer` until T and also permanently. After the sweep `is_writer` stays 1.
  - Publisher expires while editor runs longer: `is_social` stays 1.
  - Nothing due: 0 is returned, no writes are made, and exactly one indexed SELECT runs. Assert the SQL plan with `EXPLAIN QUERY PLAN` includes `USING INDEX idx_role_grants_expiry`, matching the existing index tests' style.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** `npm test`
- [ ] **Step 5: Commit.** `git commit -m "Expire role grants hourly"`

### Task 5: `/api/me` reports grants

**Files:**
- Modify: `functions/api/me.ts`. Add `grants: { role, expires_at }[]` for the signed-in user from `activeGrants`.
- Test: `tests/me.test.ts` (create if absent, following `tests/connections-api.test.ts`'s handler-call style)

**Interfaces:**
- Produces: `/api/me` → `{ user: { …existing…, grants: { role: string; expires_at: number | null }[] }, profile }`. Plan 3 reads CMS group rights from this.

- [ ] **Step 1: Write the failing test.** A user with a live `writer` grant and an expired `sender` grant gets `grants` listing only `writer` with its `expires_at`.
- [ ] **Step 2: Run to verify it fails.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.**
- [ ] **Step 5: Commit.** `git commit -m "Expose active grants on /api/me"`

### Task 6: Roles view shows and sets durations

**Files:**
- Modify: `src/scripts/admin/sections/users.ts` (`renderRolesView`, `personChip`, the add flow).
- Modify: `src/i18n/ui.ts`
- Test: `tests/browser/user-roles.mjs` (extend the existing check)

**Interfaces:**
- Consumes: GET `filter=roles` `grants`; PATCH `duration` (Task 3).

What changes for the person using it:
- A chip with an end date shows it after the name, for example "Ayşe · 23 Kas'a kadar". A permanent grant shows no date. A grant ending within 7 days shows the date in the amber chip tone.
- Adding someone opens a duration choice next to the search result: 1, 2, 3, 6 or 12 months, a date, or Permanent. It offers only what `resolveExpiry` would accept for that role. Leader roles default to Permanent, edit roles to 1 month. Show the allowed set from a small client copy of the level rule, and let the server's 400 code be the final word.
- A chip's renew action extends by the same choice, with the same rules.

- [ ] **Step 1: Extend `tests/browser/user-roles.mjs`.**
  - A mocked grants list renders an end date on a chip.
  - The duration choice for "writer" offers only 1 month and a date up to 1 month away.
  - Adding with "3 months" for "symposium" sends `duration: { months: 3 }`.
- [ ] **Step 2: Run it against `npm run preview` to verify it fails.**
- [ ] **Step 3: Implement the UI and strings (TR and EN).**
- [ ] **Step 4: Run the browser check and `npm test`. Check the seven window sizes for no horizontal scroll and no inner scrollbars.**
- [ ] **Step 5: Show the owner a local preview link and wait for OK.** Then commit: `git commit -m "Roles view: end dates and durations"`

### Task 7: Docs and release notes

**Files:**
- Modify: `README.md` (Yearly handover: roles now end on their own; renew before the date) and `CLAUDE.md` ("Where things live": `functions/_lib/roles.ts`, `role-grants.ts`).
- Modify: the PR body, which must list the order:
  1. Run the 8i table and backfill on the remote D1 **before** merging.
  2. Merge.
  3. No Worker redeploy: the sweep runs inside `/api/mail/dispatch`.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: `npm test` and `npx astro check` (0 errors).**
- [ ] **Step 3: Commit.** `git commit -m "Document expiring roles"`
