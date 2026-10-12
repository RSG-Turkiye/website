# Social Media Panel, Phase 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the site an audited, self-reporting foundation: social roles, a tamper-evident audit log with export and verification, encrypted platform connections, in-panel Gmail reconnection, and a status banner that says when a connection or the scheduler is broken.

**Architecture:**
- **Pure libraries** in `functions/_lib/`:
  - `audit.ts`: the hash chain, CSV, verification.
  - `token-vault.ts`: AES-GCM.
  - `connections.ts`: storage and derived status.
  - `health.ts`: banner issues.
  - `oauth-state.ts`: single-use OAuth state.
- **Endpoints:** thin Pages Functions in `functions/api/` call those libraries.
- **Gmail:** `getAccessToken` prefers an encrypted D1 refresh token and falls back to the existing `GMAIL_REFRESH_TOKEN` secret. Deploying this changes nothing until an admin reconnects Gmail from the panel.
- **Admin UI:** three new client modules (`admin-health.ts`, `admin-connections.ts`, `admin-audit.ts`) wired into the existing vanilla-TS panel.

**Tech Stack:** Cloudflare Pages Functions, D1, Web Crypto (`crypto.subtle`), Astro, vanilla TypeScript, `node:test` with in-memory `node:sqlite`.

**Spec:** `docs/superpowers/specs/2026-10-12-social-media-panel-design.md` (sections 1, 2 "Status banner" and "Connections"/"Log" sub-tabs, 3 `platform_connections` and `audit_log`, 4, 5 "Scheduler health", 6, 8 phase 1, 9).

## Global Constraints

- **Language:** every user-facing string is in `src/i18n/ui.ts`, in both `en` and `tr`.
- **No em dashes** (U+2014) anywhere in `src/` or `functions/`. `tests/no-em-dashes.test.ts` enforces this; use `--` or rephrase.
- **Public repo:** no token, secret, client secret or real email address other than `turkey.rsg@gmail.com` in code, tests or docs. Tests use `example.org` addresses.
- **Migrations are run by hand.** Add each new column as a numbered note at the top of `db/schema.sql` (continue from `7l`, so `8a`, `8b`...) and add it to the `CREATE TABLE` as well; `tests/schema.test.ts` fails otherwise. New tables are `CREATE TABLE IF NOT EXISTS` in the body.
- **Role checks are server side.** Hiding a pane in `admin-panel.ts` is presentation only.
- **Gmail must keep working throughout:**
  - Every new read of `platform_connections` from the mail path is wrapped so that a missing table, a missing `TOKEN_ENC_KEY`, or an undecryptable row falls back to `GMAIL_REFRESH_TOKEN`.
  - Health bookkeeping (`markOk`/`markBroken`) never throws into mail.
- **Audited mutations fail closed.** A mutation and its audit row are written in one D1 batch; if the audit insert cannot be written, the mutation does not happen.
- **Retention:**
  - Audit log: one year (`AUDIT_RETENTION_SECONDS = 365 * 86400`).
  - OAuth state: 10 minutes (`STATE_TTL_SECONDS = 600`).
  - Scheduler is stale after 10 minutes (`SCHEDULER_STALE_SECONDS = 600`).
  - Connection is "expiring" within 14 days (`EXPIRING_WINDOW_SECONDS = 14 * 86400`).
- **Gmail OAuth scopes:** `openid email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly`.
- **Gmail redirect URI:** `https://rsg-turkiye.iscbsc.org/api/admin/connections/gmail/callback`, which must be added in Google Cloud (Task 10).
- **Run all tests with** `npm test`. **Build with** `npm run build`.

## Review Focus

1. **`TOKEN_ENC_KEY` missing, malformed, or rotated after a connect.**
   - Expected: mail keeps sending with the legacy secret, and the Connections row says "Broken: stored token unreadable, reconnect". Nothing crashes.
   - Pinned by tests in Task 5.
2. **An admin authorises the wrong Google account** (their personal Gmail).
   - Expected: it is refused with a clear message, the grant is revoked at Google, and the existing working connection is untouched.
   - Pinned in Task 6.
3. **Two audited actions at the same instant.**
   - Expected: both are logged, the chain does not fork, and "Verify integrity" passes.
   - Pinned in Task 1 (concurrent appends).
4. **Code deployed before the migrations ran** (no `platform_connections`, no `audit_log`, no `is_social` column).
   - Expected: mail still sends, the panel still loads, the health banner stays quiet rather than erroring, social roles read as false.
   - Pinned in Tasks 2, 5 and 7.
5. **The OAuth callback opened twice** (back button, reload, an old tab) or after 10 minutes.
   - Expected: "the link expired or was already used", no duplicate rows, no stored token.
   - Pinned in Task 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `db/schema.sql` | `audit_log`, `platform_connections`, `oauth_states` tables; `is_social`, `is_social_publisher` columns and notes 8a-8c |
| `functions/_lib/audit.ts` | Hash chain: `runWithAudit`, `appendAudit`, `verifyChain`, `toCsv`, constants |
| `functions/_lib/audit-query.ts` | Shared filter parsing for the list and export endpoints |
| `functions/_lib/token-vault.ts` | `seal` / `unseal` with AES-GCM and context binding |
| `functions/_lib/connections.ts` | `platform_connections` access and `connectionStatus` |
| `functions/_lib/health.ts` | `healthIssues` (pure) |
| `functions/_lib/oauth-state.ts` | `createState` / `consumeState` |
| `functions/_lib/gmail-oauth.ts` | Gmail auth URL, code exchange, account check, revoke |
| `functions/_lib/secret.ts` | `safeEqual` constant-time compare |
| `functions/_lib/auth.ts` | `User` fields, `canSocialEdit`, `canSocialPublish`, `canSeeAdminPanel`, `Env` additions |
| `functions/_lib/gmail.ts` | `getAccessToken` reads D1 first, records health |
| `functions/api/admin/users.ts` | Social role actions; every role change audited |
| `functions/api/me.ts` | Exposes the two new flags |
| `functions/api/admin/connections/index.ts` | GET list |
| `functions/api/admin/connections/[platform].ts` | DELETE disconnect |
| `functions/api/admin/connections/gmail/start.ts` | Begins the Google grant |
| `functions/api/admin/connections/gmail/callback.ts` | Completes it |
| `functions/api/admin/health.ts` | Banner data |
| `functions/api/admin/audit/index.ts` | GET list |
| `functions/api/admin/audit/export.ts` | GET CSV/JSON download |
| `functions/api/admin/audit/verify.ts` | POST verify |
| `functions/api/admin/audit/prune.ts` | POST, secret-gated, daily |
| `functions/api/audit/view.ts` | POST pane-view beacon |
| `workers/symposium-cron/src/index.ts`, `wrangler.toml` | Daily call to prune |
| `src/scripts/format-time.ts` | Date-time formatting for the new panes |
| `src/scripts/admin-health.ts` | Banner |
| `src/scripts/admin-connections.ts` | Connections pane |
| `src/scripts/admin-audit.ts` | Log pane |
| `src/scripts/admin-panel.ts` | Wiring, social role buttons, view beacon |
| `src/components/admin/AdminNav.astro`, `AdminShell.astro` | Nav entries, banner slot, two panes |
| `src/i18n/ui.ts` | New `admin.*` keys, en and tr |
| `README.md` | Runbook and yearly handover |
| `tests/*.test.ts` | One file per task, listed in each task |

---

### Task 1: Audit log core

**Files:**
- Modify: `db/schema.sql` (add table after the `certificate_lookups` table at the end; add note 8a to the header after 7l)
- Create: `functions/_lib/audit.ts`
- Test: `tests/audit.test.ts`

**Interfaces:**
- Produces:
  - `GENESIS: string` (64 zeros)
  - `AUDIT_RETENTION_SECONDS: number`
  - `interface AuditEntry { userId: string | null; action: string; targetType?: string | null; targetId?: string | null; details?: unknown }`
  - `interface AuditRow { seq: number; at: number; user_id: string | null; action: string; target_type: string | null; target_id: string | null; details: string; prev_hash: string; hash: string }`
  - `runWithAudit(db: D1Database, statements: D1PreparedStatement[], entry: AuditEntry, now?: number): Promise<void>`
  - `appendAudit(db: D1Database, entry: AuditEntry, now?: number): Promise<void>`
  - `hashRow(row: Omit<AuditRow, 'seq' | 'hash'>): Promise<string>`
  - `verifyChain(rows: AuditRow[]): Promise<ChainResult>`
  - `type ChainResult = { ok: true; checked: number; anchoredAfterPrune: boolean } | { ok: false; checked: number; brokenAt: number; reason: 'hash' | 'link' }`
  - `toCsv(rows: (AuditRow & { user_email: string | null })[]): string`

- [ ] **Step 1: Add the table and its note to `db/schema.sql`**

At the end of the file:

```sql
-- Who did what in the admin panel, kept a year. Each row carries the hash of
-- the row before it, so a row changed or removed after the fact breaks the
-- chain and /api/admin/audit/verify says where. prev_hash is UNIQUE: two
-- writers that read the same last row cannot both append after it, so the
-- chain cannot fork -- the loser retries (functions/_lib/audit.ts).
-- user_id has no foreign key on purpose: system rows have none, and deleting
-- a user must not delete the record of what they did.
CREATE TABLE IF NOT EXISTS audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  user_id      TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  details      TEXT NOT NULL DEFAULT '{}',
  prev_hash    TEXT NOT NULL UNIQUE,
  hash         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at);
```

In the header, after the 7l note:

```sql
-- 8a. The audit log (audit_log, below). New table, IF NOT EXISTS, so
--    re-applying the file is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run it BEFORE deploying. Role changes are written together with their
--    audit row and fail closed: without the table, granting or removing any
--    role answers 500 instead of happening unlogged.
--
```

- [ ] **Step 2: Write the failing tests** in `tests/audit.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { appendAudit, runWithAudit, verifyChain, toCsv, GENESIS, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','a@example.org',1,1)`).run();
  return { db, DB: d1(db) as never };
}
const rows = (db: DatabaseSync) => db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[];

test('the first row links to GENESIS and each next row to the one before', async () => {
  const { db, DB } = setup();
  await appendAudit(DB, { userId: 'u1', action: 'role.change', targetType: 'user', targetId: 'u2', details: { role: 'is_social', value: 1 } }, 100);
  await appendAudit(DB, { userId: null, action: 'audit.prune' }, 101);
  const [a, b] = rows(db);
  assert.equal(a.prev_hash, GENESIS);
  assert.equal(b.prev_hash, a.hash);
  assert.equal(a.details, '{"role":"is_social","value":1}');
  assert.equal(b.details, '{}');
  assert.deepEqual(await verifyChain(rows(db)), { ok: true, checked: 2, anchoredAfterPrune: false });
});

test('concurrent appends do not fork the chain', async () => {
  const { db, DB } = setup();
  await Promise.all([1, 2, 3, 4, 5].map((n) => appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100)));
  const all = rows(db);
  assert.equal(all.length, 5);
  assert.equal((await verifyChain(all)).ok, true);
});

test('runWithAudit applies the statements and the audit row together', async () => {
  const { db, DB } = setup();
  await runWithAudit(DB, [DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind('u1')], { userId: 'u1', action: 'role.change' }, 100);
  assert.equal((db.prepare('SELECT is_admin FROM users').get() as { is_admin: number }).is_admin, 1);
  assert.equal(rows(db).length, 1);
});

test('when the audit row cannot be written the mutation does not happen', async () => {
  const { db, DB } = setup();
  db.exec('DROP TABLE audit_log');
  await assert.rejects(runWithAudit(DB, [DB.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').bind('u1')], { userId: 'u1', action: 'role.change' }, 100));
  assert.equal((db.prepare('SELECT is_admin FROM users').get() as { is_admin: number }).is_admin, 0);
});

test('an edited row is caught as a hash break, a removed row as a link break', async () => {
  const { db, DB } = setup();
  for (const n of [1, 2, 3]) await appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100 + n);
  const edited = rows(db).map((r) => (r.seq === 2 ? { ...r, action: 'something-else' } : r));
  assert.deepEqual(await verifyChain(edited), { ok: false, checked: 1, brokenAt: 2, reason: 'hash' });
  const removed = rows(db).filter((r) => r.seq !== 2);
  assert.deepEqual(await verifyChain(removed), { ok: false, checked: 1, brokenAt: 3, reason: 'link' });
});

test('a chain whose first row is not GENESIS-linked verifies, flagged as pruned', async () => {
  const { db, DB } = setup();
  for (const n of [1, 2, 3]) await appendAudit(DB, { userId: 'u1', action: `a${n}` }, 100 + n);
  const tail = rows(db).slice(1);
  assert.deepEqual(await verifyChain(tail), { ok: true, checked: 2, anchoredAfterPrune: true });
});

test('CSV quotes what needs quoting and defuses spreadsheet formulas', () => {
  const csv = toCsv([{ seq: 1, at: 0, user_id: 'u1', user_email: '=cmd@example.org', action: 'x', target_type: null, target_id: 'a,b', details: '{"q":"say \\"hi\\""}', prev_hash: 'p', hash: 'h' }]);
  const [header, line] = csv.trimEnd().split('\r\n');
  assert.equal(header, 'seq,at,user_email,action,target_type,target_id,details,prev_hash,hash');
  assert.equal(line, `1,1970-01-01T00:00:00.000Z,'=cmd@example.org,x,,"a,b","{""q"":""say \\""hi\\""""}",p,h`);
});
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `node --import tsx --test tests/audit.test.ts`
Expected: FAIL, `Cannot find module '../functions/_lib/audit'`.

- [ ] **Step 4: Implement `functions/_lib/audit.ts`**

```ts
/**
 * The admin panel's audit log: who did what, kept a year, and tamper-evident.
 *
 * Each row stores the hash of the row before it. Changing a row breaks its own
 * hash; deleting one breaks the link to the next. verifyChain finds the first
 * break. Deleting the newest rows cannot be detected from the table alone --
 * an exported copy is the evidence for that, which is why export exists.
 *
 * Mutations are written in the same D1 batch as their audit row (runWithAudit),
 * so an action is never recorded without happening or the reverse. prev_hash is
 * UNIQUE in the schema: when two writers read the same last row, one insert
 * fails, its whole batch rolls back, and it retries against the new last row.
 */

export const GENESIS = '0'.repeat(64);
export const AUDIT_RETENTION_SECONDS = 365 * 86400;
const MAX_ATTEMPTS = 8;

export interface AuditEntry {
  userId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: unknown;
}

export interface AuditRow {
  seq: number;
  at: number;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string;
  prev_hash: string;
  hash: string;
}

export type ChainResult =
  | { ok: true; checked: number; anchoredAfterPrune: boolean }
  | { ok: false; checked: number; brokenAt: number; reason: 'hash' | 'link' };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An array, not an object: key order is part of the hash, and arrays keep it. */
export function hashRow(row: Omit<AuditRow, 'seq' | 'hash'>): Promise<string> {
  return sha256Hex(JSON.stringify([row.at, row.user_id, row.action, row.target_type, row.target_id, row.details, row.prev_hash]));
}

const isChainCollision = (err: unknown) => /UNIQUE constraint failed: audit_log\.prev_hash/.test(String(err));

export async function runWithAudit(
  db: D1Database,
  statements: D1PreparedStatement[],
  entry: AuditEntry,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = await db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').first<{ hash: string }>();
    const base = {
      at: now,
      user_id: entry.userId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: JSON.stringify(entry.details ?? {}),
      prev_hash: last?.hash ?? GENESIS,
    };
    const hash = await hashRow(base);
    const insert = db.prepare(
      'INSERT INTO audit_log (at, user_id, action, target_type, target_id, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(base.at, base.user_id, base.action, base.target_type, base.target_id, base.details, base.prev_hash, hash);
    try {
      await db.batch([...statements, insert]);
      return;
    } catch (err) {
      if (!isChainCollision(err)) throw err;
    }
  }
  throw new Error(`audit_log: could not append after ${MAX_ATTEMPTS} attempts`);
}

export function appendAudit(db: D1Database, entry: AuditEntry, now?: number): Promise<void> {
  return runWithAudit(db, [], entry, now);
}

/**
 * Rows in seq order. The first row may link to a pruned row rather than
 * GENESIS; that is accepted and reported, because the daily prune removes
 * the oldest rows on purpose.
 */
export async function verifyChain(rows: AuditRow[]): Promise<ChainResult> {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0 && row.prev_hash !== rows[i - 1].hash) return { ok: false, checked: i, brokenAt: row.seq, reason: 'link' };
    if ((await hashRow(row)) !== row.hash) return { ok: false, checked: i, brokenAt: row.seq, reason: 'hash' };
  }
  return { ok: true, checked: rows.length, anchoredAfterPrune: rows.length > 0 && rows[0].prev_hash !== GENESIS };
}

const CSV_COLUMNS = ['seq', 'at', 'user_email', 'action', 'target_type', 'target_id', 'details', 'prev_hash', 'hash'] as const;

/** A leading = + - @ makes Excel evaluate the cell; a quote defuses it. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** For reading. JSON export is the one to verify against the chain: CSV defuses formulas, which changes cell text. */
export function toCsv(rows: (AuditRow & { user_email: string | null })[]): string {
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((c) => csvCell(c === 'at' ? new Date(r.at * 1000).toISOString() : r[c])).join(','),
  );
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}
```

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `node --import tsx --test tests/audit.test.ts tests/schema.test.ts`
Expected: PASS, all tests.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql functions/_lib/audit.ts tests/audit.test.ts
git commit -m "Audit log: hash-chained, batched with the change it records"
```

---

### Task 2: Social roles, and every role change audited

**Files:**
- Modify: `db/schema.sql` (users CREATE + note 8b)
- Modify: `functions/_lib/auth.ts`
- Modify: `functions/api/me.ts:34-39`
- Modify: `functions/api/admin/users.ts`
- Test: `tests/social-roles.test.ts`

**Interfaces:**
- Consumes: `runWithAudit`, `appendAudit` from Task 1.
- Produces:
  - `User.is_social: number`, `User.is_social_publisher: number`
  - `canSocialEdit(user: Pick<User, 'is_admin' | 'is_social' | 'is_social_publisher'>): boolean`
  - `canSocialPublish(user: Pick<User, 'is_admin' | 'is_social_publisher'>): boolean`
  - `canSeeAdminPanel(user: Pick<User, 'is_admin' | 'is_announcer' | 'is_symposium' | 'is_social' | 'is_social_publisher'>): boolean`
  - `/api/me` `user.is_social: boolean`, `user.is_social_publisher: boolean`
  - users PATCH actions `make_social`, `remove_social`, `make_social_publisher`, `remove_social_publisher`
  - Audit action `role.change` with details `{ role, value, email }`

- [ ] **Step 1: Schema**

In the `users` CREATE, after `is_symposium  INTEGER NOT NULL DEFAULT 0,`:

```sql
  is_social           INTEGER NOT NULL DEFAULT 0,
  is_social_publisher INTEGER NOT NULL DEFAULT 0,
```

Header note after 8a:

```sql
-- 8b. Social media roles. Deploying without these does NOT throw --
--    getSessionUser does SELECT *, so the columns are simply absent and both
--    roles read as false -- but functions/api/admin/users.ts SELECTs them by
--    name and the admin user list 500s. ALTER TABLE ADD COLUMN is NOT
--    idempotent -- do not re-run:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_social INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_social_publisher INTEGER NOT NULL DEFAULT 0"
--
```

- [ ] **Step 2: Write the failing tests** in `tests/social-roles.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { canSocialEdit, canSocialPublish, canSeeAdminPanel } from '../functions/_lib/auth';
import { onRequestPatch } from '../functions/api/admin/users';
import { verifyChain, type AuditRow } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const none = { is_admin: 0, is_announcer: 0, is_symposium: 0, is_social: 0, is_social_publisher: 0 };

test('who may edit and who may publish', () => {
  assert.equal(canSocialEdit(none), false);
  assert.equal(canSocialEdit({ ...none, is_social: 1 }), true);
  assert.equal(canSocialEdit({ ...none, is_social_publisher: 1 }), true, 'a publisher can always edit');
  assert.equal(canSocialEdit({ ...none, is_admin: 1 }), true);
  assert.equal(canSocialPublish({ ...none, is_social: 1 }), false);
  assert.equal(canSocialPublish({ ...none, is_social_publisher: 1 }), true);
  assert.equal(canSocialPublish({ ...none, is_admin: 1 }), true);
});

test('a column missing before the migration reads as no role', () => {
  const legacy = { is_admin: 0, is_announcer: 0, is_symposium: 0 } as never;
  assert.equal(canSocialEdit(legacy), false);
  assert.equal(canSeeAdminPanel(legacy), false);
});

test('the admin panel opens for any panel role', () => {
  assert.equal(canSeeAdminPanel(none), false);
  for (const k of ['is_admin', 'is_announcer', 'is_symposium', 'is_social', 'is_social_publisher'] as const) {
    assert.equal(canSeeAdminPanel({ ...none, [k]: 1 }), true, k);
  }
});

function setup(isAdmin = 1) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',?,1,1)`).run(isAdmin);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u2','g2','new@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) } as never };
}
const patch = (env: unknown, body: unknown) =>
  (onRequestPatch as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/users', {
      method: 'PATCH', headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
    env,
  });
const flags = (db: DatabaseSync) => db.prepare(`SELECT is_social, is_social_publisher FROM users WHERE id = 'u2'`).get();

test('making someone a publisher makes them an editor too, and is logged', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_social_publisher' })).status, 200);
  assert.deepEqual({ ...flags(db) }, { is_social: 1, is_social_publisher: 1 });
  const log = db.prepare('SELECT * FROM audit_log').all() as unknown as AuditRow[];
  assert.equal(log.length, 1);
  assert.equal(log[0].user_id, 'u1');
  assert.equal(log[0].action, 'role.change');
  assert.equal(log[0].target_id, 'u2');
  assert.deepEqual(JSON.parse(log[0].details), { role: 'is_social_publisher', value: 1, email: 'new@example.org' });
  assert.equal((await verifyChain(log)).ok, true);
});

test('removing the editor role removes publisher; removing publisher keeps editor', async () => {
  const { db, env } = setup();
  await patch(env, { user_id: 'u2', action: 'make_social_publisher' });
  await patch(env, { user_id: 'u2', action: 'remove_social_publisher' });
  assert.deepEqual({ ...flags(db) }, { is_social: 1, is_social_publisher: 0 });
  await patch(env, { user_id: 'u2', action: 'make_social_publisher' });
  await patch(env, { user_id: 'u2', action: 'remove_social' });
  assert.deepEqual({ ...flags(db) }, { is_social: 0, is_social_publisher: 0 });
});

test('existing role actions are logged too', async () => {
  const { db, env } = setup();
  await patch(env, { user_id: 'u2', action: 'make_symposium' });
  const row = db.prepare('SELECT details FROM audit_log').get() as { details: string };
  assert.deepEqual(JSON.parse(row.details), { role: 'is_symposium', value: 1, email: 'new@example.org' });
});

test('an unknown user is a 404 and nothing is logged', async () => {
  const { db, env } = setup();
  assert.equal((await patch(env, { user_id: 'nobody', action: 'make_social' })).status, 404);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n: number }).n, 0);
});

test('a non-admin cannot grant roles', async () => {
  const { db, env } = setup(0);
  assert.equal((await patch(env, { user_id: 'u2', action: 'make_social' })).status, 403);
  assert.deepEqual({ ...flags(db) }, { is_social: 0, is_social_publisher: 0 });
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `node --import tsx --test tests/social-roles.test.ts`
Expected: FAIL, `canSocialEdit` is not exported.

- [ ] **Step 4: `functions/_lib/auth.ts`**

Add to `User` after `is_symposium: number;`:

```ts
  is_social: number;
  is_social_publisher: number;
```

Add after `canManageSymposium`:

```ts
/**
 * Social media roles. A publisher is always an editor as well, even if
 * is_social was never set on the row: publish is the larger permission and
 * must not depend on the smaller flag having been set in the same request.
 */
export function canSocialEdit(user: Pick<User, 'is_admin' | 'is_social' | 'is_social_publisher'>): boolean {
  return user.is_admin === 1 || user.is_social === 1 || user.is_social_publisher === 1;
}

export function canSocialPublish(user: Pick<User, 'is_admin' | 'is_social_publisher'>): boolean {
  return user.is_admin === 1 || user.is_social_publisher === 1;
}

/** Anyone with a pane in /admin. Used by endpoints every panel user needs, like the status banner. */
export function canSeeAdminPanel(
  user: Pick<User, 'is_admin' | 'is_announcer' | 'is_symposium' | 'is_social' | 'is_social_publisher'>,
): boolean {
  return user.is_admin === 1 || user.is_announcer === 1 || user.is_symposium === 1 || canSocialEdit(user);
}
```

- [ ] **Step 5: `functions/api/me.ts`**

After `is_symposium: user.is_symposium === 1,` add:

```ts
      is_social: user.is_social === 1,
      is_social_publisher: user.is_social_publisher === 1,
```

- [ ] **Step 6: `functions/api/admin/users.ts`**

Add the import:

```ts
import { runWithAudit, appendAudit } from '../../_lib/audit';
```

In the GET query, change `u.is_symposium, u.created_at` to `u.is_symposium, u.is_social, u.is_social_publisher, u.created_at`.

Above `onRequestPatch`, add:

```ts
/**
 * Every action that sets a role flag. They are table rows rather than switch
 * cases so that each one is written together with its audit row -- see
 * runWithAudit. `role` and `value` are what the log records.
 */
const ROLE_UPDATES: Record<string, { sql: string; role: string; value: 0 | 1 }> = {
  verify:                  { sql: 'UPDATE users SET is_member = 1 WHERE id = ?', role: 'is_member', value: 1 },
  unverify:                { sql: 'UPDATE users SET is_member = 0 WHERE id = ?', role: 'is_member', value: 0 },
  make_admin:              { sql: 'UPDATE users SET is_admin = 1 WHERE id = ?', role: 'is_admin', value: 1 },
  remove_admin:            { sql: 'UPDATE users SET is_admin = 0 WHERE id = ?', role: 'is_admin', value: 0 },
  make_announcer:          { sql: 'UPDATE users SET is_announcer = 1 WHERE id = ?', role: 'is_announcer', value: 1 },
  remove_announcer:        { sql: 'UPDATE users SET is_announcer = 0 WHERE id = ?', role: 'is_announcer', value: 0 },
  // The symposium role could only be granted by hand, with a wrangler
  // command in a comment in db/schema.sql, so in practice only full admins
  // ever had it -- which is the wrong shape for a role whose whole point is
  // to let an organiser edit the programme without being an admin of
  // everything.
  make_symposium:          { sql: 'UPDATE users SET is_symposium = 1 WHERE id = ?', role: 'is_symposium', value: 1 },
  remove_symposium:        { sql: 'UPDATE users SET is_symposium = 0 WHERE id = ?', role: 'is_symposium', value: 0 },
  make_writer:             { sql: 'UPDATE users SET is_writer = 1 WHERE id = ?', role: 'is_writer', value: 1 },
  remove_writer:           { sql: 'UPDATE users SET is_writer = 0 WHERE id = ?', role: 'is_writer', value: 0 },
  // Publisher implies editor in both directions: granting publisher sets
  // both, removing editor clears both.
  make_social:             { sql: 'UPDATE users SET is_social = 1 WHERE id = ?', role: 'is_social', value: 1 },
  remove_social:           { sql: 'UPDATE users SET is_social = 0, is_social_publisher = 0 WHERE id = ?', role: 'is_social', value: 0 },
  make_social_publisher:   { sql: 'UPDATE users SET is_social = 1, is_social_publisher = 1 WHERE id = ?', role: 'is_social_publisher', value: 1 },
  remove_social_publisher: { sql: 'UPDATE users SET is_social_publisher = 0 WHERE id = ?', role: 'is_social_publisher', value: 0 },
};
```

In `onRequestPatch`, directly after the self-demotion check, insert:

```ts
  const roleUpdate = ROLE_UPDATES[body.action];
  if (roleUpdate) {
    const target = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(body.user_id).first<{ email: string }>();
    if (!target) return jsonResponse({ error: 'Unknown user' }, 404);
    await runWithAudit(env.DB, [env.DB.prepare(roleUpdate.sql).bind(body.user_id)], {
      userId: user.id, action: 'role.change', targetType: 'user', targetId: body.user_id,
      details: { role: roleUpdate.role, value: roleUpdate.value, email: target.email },
    });
    return jsonResponse({ ok: true });
  }
```

Delete the switch cases `verify`, `unverify`, `make_admin`, `remove_admin`, `make_announcer`, `remove_announcer`, `make_symposium`, `remove_symposium`, `make_writer`, `remove_writer` (and the symposium comment above them, which moved into the table).

Replace the `make_sender` / `remove_sender` cases with:

```ts
    case 'make_sender':
      await grantSender(env, body.user_id, body.value?.trim() || null, user.id);
      await appendAudit(env.DB, { userId: user.id, action: 'role.change', targetType: 'user', targetId: body.user_id, details: { role: 'is_sender', value: 1 } });
      break;
    case 'remove_sender':
      await revokeSender(env, body.user_id, user.id);
      await appendAudit(env.DB, { userId: user.id, action: 'role.change', targetType: 'user', targetId: body.user_id, details: { role: 'is_sender', value: 0 } });
      break;
```

(Senders keep their own `sender_grants` history; the audit row is appended after it rather than batched, because `grantSender` runs its own statements.)

- [ ] **Step 7: Run the tests**

Run: `node --import tsx --test tests/social-roles.test.ts tests/schema.test.ts tests/permissions.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add db/schema.sql functions/_lib/auth.ts functions/api/me.ts functions/api/admin/users.ts tests/social-roles.test.ts
git commit -m "Social editor and publisher roles; every role change is audited"
```

---

### Task 3: Token vault

**Files:**
- Create: `functions/_lib/token-vault.ts`
- Modify: `functions/_lib/auth.ts` (`Env`)
- Test: `tests/token-vault.test.ts`

**Interfaces:**
- Produces:
  - `class VaultError extends Error`
  - `seal(keyB64: string | undefined, plaintext: string, context: string): Promise<string>`, which returns `v1.<iv b64>.<ciphertext b64>`
  - `unseal(keyB64: string | undefined, sealed: string, context: string): Promise<string>`, which throws `VaultError` on any failure
  - `Env.TOKEN_ENC_KEY?: string`

- [ ] **Step 1: Write the failing tests** in `tests/token-vault.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seal, unseal, VaultError } from '../functions/_lib/token-vault';

const KEY = Buffer.alloc(32, 7).toString('base64');
const OTHER = Buffer.alloc(32, 9).toString('base64');

test('a sealed token opens with the same key and context', async () => {
  const sealed = await seal(KEY, 'refresh-abc', 'gmail:refresh');
  assert.match(sealed, /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
  assert.ok(!sealed.includes('refresh-abc'));
  assert.equal(await unseal(KEY, sealed, 'gmail:refresh'), 'refresh-abc');
});

test('two seals of the same token differ (fresh IV)', async () => {
  assert.notEqual(await seal(KEY, 't', 'c'), await seal(KEY, 't', 'c'));
});

test('a token sealed for one platform does not open as another', async () => {
  const sealed = await seal(KEY, 't', 'gmail:refresh');
  await assert.rejects(unseal(KEY, sealed, 'instagram:refresh'), VaultError);
});

test('wrong key, tampering, and garbage all fail as VaultError', async () => {
  const sealed = await seal(KEY, 't', 'c');
  await assert.rejects(unseal(OTHER, sealed, 'c'), VaultError);
  const [v, iv, ct] = sealed.split('.');
  const flipped = `${v}.${iv}.${ct.slice(0, -4)}AAA=`;
  await assert.rejects(unseal(KEY, flipped, 'c'), VaultError);
  await assert.rejects(unseal(KEY, 'not-a-token', 'c'), VaultError);
});

test('a missing or wrong-length key is a VaultError, not a crash', async () => {
  await assert.rejects(seal(undefined, 't', 'c'), /TOKEN_ENC_KEY is not set/);
  await assert.rejects(seal(Buffer.alloc(16).toString('base64'), 't', 'c'), /32 bytes/);
  await assert.rejects(unseal('%%%', 'v1.a.b', 'c'), VaultError);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/token-vault.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `functions/_lib/token-vault.ts`**

```ts
/**
 * Platform tokens at rest. AES-GCM with a 256-bit key from the TOKEN_ENC_KEY
 * Pages secret (generate with `openssl rand -base64 32`), a fresh 96-bit IV
 * per seal, and the row's purpose ("gmail:refresh") as additional
 * authenticated data -- so a ciphertext copied into another row's column
 * fails to open rather than becoming that platform's token.
 *
 * Every failure is a VaultError. Callers treat it as "this connection is
 * broken, reconnect", never as a reason to stop serving.
 */
export class VaultError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string | undefined): Promise<CryptoKey> {
  if (!keyB64) throw new VaultError('TOKEN_ENC_KEY is not set');
  let raw: Uint8Array;
  try {
    raw = fromB64(keyB64);
  } catch {
    throw new VaultError('TOKEN_ENC_KEY is not valid base64');
  }
  if (raw.length !== 32) throw new VaultError('TOKEN_ENC_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(keyB64: string | undefined, plaintext: string, context: string): Promise<string> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(context) }, key, enc.encode(plaintext));
  return `v1.${toB64(iv)}.${toB64(new Uint8Array(ct))}`;
}

export async function unseal(keyB64: string | undefined, sealed: string, context: string): Promise<string> {
  const key = await importKey(keyB64);
  const parts = sealed.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') throw new VaultError('Not a sealed token');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(parts[1]), additionalData: enc.encode(context) },
      key,
      fromB64(parts[2]),
    );
    return dec.decode(pt);
  } catch {
    throw new VaultError('Sealed token could not be opened (wrong key, wrong row, or altered)');
  }
}
```

- [ ] **Step 4: Add to `Env` in `functions/_lib/auth.ts`**, after `SYMPOSIUM_ARCHIVE_SECRET: string;`:

```ts
  /** 32 random bytes, base64. Encrypts platform tokens in D1 -- see token-vault.ts. */
  TOKEN_ENC_KEY?: string;
  /** The Gmail account the site sends from, when RSG_MAIL_FROM is a send-as alias of it. Defaults to RSG_MAIL_FROM. */
  GMAIL_ACCOUNT?: string;
```

- [ ] **Step 5: Run the tests**

Run: `node --import tsx --test tests/token-vault.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/token-vault.ts functions/_lib/auth.ts tests/token-vault.test.ts
git commit -m "Token vault: AES-GCM, bound to the row it belongs to"
```

---

### Task 4: Connections and health libraries

**Files:**
- Modify: `db/schema.sql` (two tables + note 8c)
- Create: `functions/_lib/connections.ts`, `functions/_lib/health.ts`
- Test: `tests/connections.test.ts`

**Interfaces:**
- Consumes: `seal`, `unseal` (Task 3).
- Produces:
  - `type Platform = 'gmail' | 'instagram' | 'linkedin' | 'x'`
  - `PLATFORMS: Platform[]`
  - `isPlatform(v: unknown): v is Platform`
  - `interface ConnectionRow { platform: Platform; account_id: string | null; account_name: string | null; access_token_enc: string | null; refresh_token_enc: string | null; scopes: string | null; expires_at: number | null; refresh_expires_at: number | null; connected_by: string | null; connected_at: number | null; last_ok_at: number | null; last_error: string | null; last_error_at: number | null }`
  - `type ConnectionStatus = 'connected' | 'expiring' | 'broken' | 'unused'`
  - `EXPIRING_WINDOW_SECONDS`
  - `connectionStatus(row: ConnectionRow | null, now: number, hasLegacyToken?: boolean): ConnectionStatus`
  - `getConnection(db: D1Database, platform: Platform): Promise<ConnectionRow | null>`
  - `listConnections(db: D1Database): Promise<ConnectionRow[]>`
  - `interface NewTokens { accountId: string | null; accountName: string | null; accessToken: string | null; refreshToken: string | null; scopes: string; expiresAt: number | null; refreshExpiresAt: number | null }`
  - `connectionUpsert(env: { DB: D1Database; TOKEN_ENC_KEY?: string }, platform: Platform, tokens: NewTokens, userId: string, now: number): Promise<D1PreparedStatement>`
  - `disconnectStatement(db: D1Database, platform: Platform): D1PreparedStatement`
  - `markOk(db: D1Database, platform: Platform, now: number): Promise<void>`
  - `markBroken(db: D1Database, platform: Platform, error: string, now: number): Promise<void>`
  - `readRefreshToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null>`
  - `SCHEDULER_STALE_SECONDS`
  - `type HealthIssue = { kind: 'connection'; platform: Platform; status: 'expiring' | 'broken'; expiresAt: number | null; lastError: string | null } | { kind: 'scheduler'; lastRunAt: number | null }`
  - `healthIssues(input: { connections: ConnectionRow[]; legacyGmail: boolean; lastRunAt: number | null; now: number }): HealthIssue[]`

- [ ] **Step 1: Schema.** Append at the end of `db/schema.sql`:

```sql
-- One row per external account the site talks to. Tokens are AES-GCM
-- ciphertext (functions/_lib/token-vault.ts), never plaintext. A row may
-- exist with no tokens at all: Gmail's health (last_ok_at / last_error) is
-- recorded here even while the refresh token still comes from the
-- GMAIL_REFRESH_TOKEN secret. Status is derived on read, never stored.
CREATE TABLE IF NOT EXISTS platform_connections (
  platform            TEXT PRIMARY KEY CHECK (platform IN ('gmail','instagram','linkedin','x')),
  account_id          TEXT,
  account_name        TEXT,
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  scopes              TEXT,
  expires_at          INTEGER,
  refresh_expires_at  INTEGER,
  connected_by        TEXT,
  connected_at        INTEGER,
  last_ok_at          INTEGER,
  last_error          TEXT,
  last_error_at       INTEGER
);

-- Single-use OAuth state, ten minutes. Consumed with DELETE ... RETURNING so
-- a reloaded or replayed callback finds nothing.
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  return_to   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);
```

Header note after 8b:

```sql
-- 8c. platform_connections and oauth_states (below). New tables, IF NOT
--    EXISTS: re-apply the file before deploying:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Without them mail is unaffected (the Gmail path falls back to the
--    GMAIL_REFRESH_TOKEN secret), but the Connections pane and the status
--    banner have nothing to read, and "Reconnect Gmail" answers 500.
--
```

- [ ] **Step 2: Write the failing tests** in `tests/connections.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import {
  connectionStatus, connectionUpsert, getConnection, markOk, markBroken, readRefreshToken,
  disconnectStatement, EXPIRING_WINDOW_SECONDS, type ConnectionRow,
} from '../functions/_lib/connections';
import { healthIssues, SCHEDULER_STALE_SECONDS } from '../functions/_lib/health';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 3).toString('base64');
const NOW = 1_800_000_000;
const blank: ConnectionRow = {
  platform: 'instagram', account_id: null, account_name: null, access_token_enc: null, refresh_token_enc: null,
  scopes: null, expires_at: null, refresh_expires_at: null, connected_by: null, connected_at: null,
  last_ok_at: null, last_error: null, last_error_at: null,
};

test('status is derived from the row', () => {
  assert.equal(connectionStatus(null, NOW), 'unused');
  assert.equal(connectionStatus(blank, NOW), 'unused', 'a health-only row with no token is not a connection');
  const live = { ...blank, access_token_enc: 'x', expires_at: NOW + 60 * 86400 };
  assert.equal(connectionStatus(live, NOW), 'connected');
  assert.equal(connectionStatus({ ...live, expires_at: NOW + EXPIRING_WINDOW_SECONDS }, NOW), 'expiring');
  assert.equal(connectionStatus({ ...live, expires_at: NOW }, NOW), 'broken');
  assert.equal(connectionStatus({ ...live, last_error_at: NOW - 5, last_ok_at: NOW - 10 }, NOW), 'broken');
  assert.equal(connectionStatus({ ...live, last_error_at: NOW - 10, last_ok_at: NOW - 5 }, NOW), 'connected', 'a success after the error clears it');
  assert.equal(connectionStatus({ ...live, refresh_expires_at: NOW + 3 * 86400 }, NOW), 'expiring', 'the refresh expiry wins when present');
});

test('Gmail on the legacy secret counts as connected, and can break', () => {
  const gmail = { ...blank, platform: 'gmail' as const };
  assert.equal(connectionStatus(null, NOW, true), 'connected');
  assert.equal(connectionStatus({ ...gmail, last_error_at: NOW, last_error: 'invalid_grant' }, NOW, true), 'broken');
});

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, env: { DB: d1(db) as never, TOKEN_ENC_KEY: KEY } };
}

test('a stored connection keeps tokens sealed and reads back', async () => {
  const { db, env } = setup();
  const stmt = await connectionUpsert(env, 'gmail', {
    accountId: null, accountName: 'turkey.rsg@gmail.com', accessToken: null, refreshToken: 'r-123',
    scopes: 'a b', expiresAt: null, refreshExpiresAt: null,
  }, 'u1', NOW);
  await stmt.run();
  const raw = db.prepare('SELECT * FROM platform_connections').get() as Record<string, unknown>;
  assert.ok(!JSON.stringify(raw).includes('r-123'));
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(await readRefreshToken(env, row), 'r-123');
  assert.equal(row.connected_by, 'u1');
  assert.equal(row.last_ok_at, NOW);
});

test('reconnecting clears an earlier error', async () => {
  const { env } = setup();
  await markBroken(env.DB, 'gmail', 'invalid_grant', NOW - 100);
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'r', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', NOW)).run();
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(row.last_error, null);
  assert.equal(row.last_error_at, null);
});

test('markOk and markBroken create a health-only row when none exists', async () => {
  const { env } = setup();
  await markOk(env.DB, 'gmail', NOW);
  await markBroken(env.DB, 'gmail', 'x'.repeat(1000), NOW + 1);
  const row = (await getConnection(env.DB, 'gmail'))!;
  assert.equal(row.last_ok_at, NOW);
  assert.equal(row.last_error!.length, 300, 'errors are truncated');
  assert.equal(row.refresh_token_enc, null);
});

test('disconnect removes the row', async () => {
  const { env } = setup();
  await markOk(env.DB, 'gmail', NOW);
  await disconnectStatement(env.DB, 'gmail').run();
  assert.equal(await getConnection(env.DB, 'gmail'), null);
});

test('health lists broken and expiring connections and a stale scheduler', () => {
  const issues = healthIssues({
    connections: [
      { ...blank, platform: 'instagram', access_token_enc: 'x', expires_at: NOW + 3 * 86400 },
      { ...blank, platform: 'gmail', last_error: 'invalid_grant', last_error_at: NOW },
    ],
    legacyGmail: true,
    lastRunAt: NOW - SCHEDULER_STALE_SECONDS - 1,
    now: NOW,
  });
  assert.deepEqual(issues, [
    { kind: 'connection', platform: 'gmail', status: 'broken', expiresAt: null, lastError: 'invalid_grant' },
    { kind: 'connection', platform: 'instagram', status: 'expiring', expiresAt: NOW + 3 * 86400, lastError: null },
    { kind: 'scheduler', lastRunAt: NOW - SCHEDULER_STALE_SECONDS - 1 },
  ]);
});

test('a healthy system has no issues', () => {
  assert.deepEqual(healthIssues({ connections: [], legacyGmail: true, lastRunAt: NOW - 30, now: NOW }), []);
});
```

- [ ] **Step 3: Run and confirm failure**

Run: `node --import tsx --test tests/connections.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 4: Implement `functions/_lib/connections.ts`**

```ts
import { seal, unseal } from './token-vault';

export type Platform = 'gmail' | 'instagram' | 'linkedin' | 'x';
/** Display order in the panel and the banner. */
export const PLATFORMS: Platform[] = ['gmail', 'instagram', 'linkedin', 'x'];
export const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && (PLATFORMS as string[]).includes(v);

export const EXPIRING_WINDOW_SECONDS = 14 * 86400;
const MAX_ERROR_LENGTH = 300;

export interface ConnectionRow {
  platform: Platform;
  account_id: string | null;
  account_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  scopes: string | null;
  expires_at: number | null;
  refresh_expires_at: number | null;
  connected_by: string | null;
  connected_at: number | null;
  last_ok_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
}

export type ConnectionStatus = 'connected' | 'expiring' | 'broken' | 'unused';

/**
 * Derived, never stored, so it cannot go stale. An error newer than the last
 * success means broken; a later success clears it. `hasLegacyToken` covers
 * Gmail while its refresh token still lives in the GMAIL_REFRESH_TOKEN secret.
 */
export function connectionStatus(row: ConnectionRow | null, now: number, hasLegacyToken = false): ConnectionStatus {
  const hasToken = Boolean(row?.refresh_token_enc || row?.access_token_enc) || hasLegacyToken;
  if (!hasToken) return 'unused';
  if (row?.last_error_at != null && (row.last_ok_at == null || row.last_error_at >= row.last_ok_at)) return 'broken';
  const expiry = row?.refresh_expires_at ?? row?.expires_at ?? null;
  if (expiry !== null && expiry <= now) return 'broken';
  if (expiry !== null && expiry - now <= EXPIRING_WINDOW_SECONDS) return 'expiring';
  return 'connected';
}

export const tokenContext = (platform: Platform, kind: 'access' | 'refresh') => `${platform}:${kind}`;

export function getConnection(db: D1Database, platform: Platform): Promise<ConnectionRow | null> {
  return db.prepare('SELECT * FROM platform_connections WHERE platform = ?').bind(platform).first<ConnectionRow>();
}

export async function listConnections(db: D1Database): Promise<ConnectionRow[]> {
  return (await db.prepare('SELECT * FROM platform_connections').all<ConnectionRow>()).results;
}

export interface NewTokens {
  accountId: string | null;
  accountName: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

/** A statement, not a write, so the caller can batch it with its audit row. */
export async function connectionUpsert(
  env: { DB: D1Database; TOKEN_ENC_KEY?: string },
  platform: Platform,
  tokens: NewTokens,
  userId: string,
  now: number,
): Promise<D1PreparedStatement> {
  const access = tokens.accessToken ? await seal(env.TOKEN_ENC_KEY, tokens.accessToken, tokenContext(platform, 'access')) : null;
  const refresh = tokens.refreshToken ? await seal(env.TOKEN_ENC_KEY, tokens.refreshToken, tokenContext(platform, 'refresh')) : null;
  return env.DB.prepare(
    `INSERT INTO platform_connections
       (platform, account_id, account_name, access_token_enc, refresh_token_enc, scopes, expires_at, refresh_expires_at,
        connected_by, connected_at, last_ok_at, last_error, last_error_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(platform) DO UPDATE SET
       account_id = excluded.account_id, account_name = excluded.account_name,
       access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
       scopes = excluded.scopes, expires_at = excluded.expires_at, refresh_expires_at = excluded.refresh_expires_at,
       connected_by = excluded.connected_by, connected_at = excluded.connected_at,
       last_ok_at = excluded.last_ok_at, last_error = NULL, last_error_at = NULL`,
  ).bind(platform, tokens.accountId, tokens.accountName, access, refresh, tokens.scopes, tokens.expiresAt, tokens.refreshExpiresAt, userId, now, now);
}

export function disconnectStatement(db: D1Database, platform: Platform): D1PreparedStatement {
  return db.prepare('DELETE FROM platform_connections WHERE platform = ?').bind(platform);
}

export async function markOk(db: D1Database, platform: Platform, now: number): Promise<void> {
  await db.prepare(
    'INSERT INTO platform_connections (platform, last_ok_at) VALUES (?, ?) ON CONFLICT(platform) DO UPDATE SET last_ok_at = excluded.last_ok_at',
  ).bind(platform, now).run();
}

export async function markBroken(db: D1Database, platform: Platform, error: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO platform_connections (platform, last_error, last_error_at) VALUES (?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
  ).bind(platform, error.slice(0, MAX_ERROR_LENGTH), now).run();
}

export async function readRefreshToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null> {
  return row.refresh_token_enc ? unseal(env.TOKEN_ENC_KEY, row.refresh_token_enc, tokenContext(row.platform, 'refresh')) : null;
}
```

- [ ] **Step 5: Implement `functions/_lib/health.ts`**

```ts
import { PLATFORMS, connectionStatus, type ConnectionRow, type Platform } from './connections';

/** The mail cron ticks every minute and writes dispatch_runs every tick, held or not. */
export const SCHEDULER_STALE_SECONDS = 10 * 60;

export type HealthIssue =
  | { kind: 'connection'; platform: Platform; status: 'expiring' | 'broken'; expiresAt: number | null; lastError: string | null }
  | { kind: 'scheduler'; lastRunAt: number | null };

export function healthIssues(input: {
  connections: ConnectionRow[];
  legacyGmail: boolean;
  lastRunAt: number | null;
  now: number;
}): HealthIssue[] {
  const issues: HealthIssue[] = [];
  for (const platform of PLATFORMS) {
    const row = input.connections.find((c) => c.platform === platform) ?? null;
    const status = connectionStatus(row, input.now, platform === 'gmail' && input.legacyGmail);
    if (status === 'broken' || status === 'expiring') {
      issues.push({
        kind: 'connection', platform, status,
        expiresAt: row?.refresh_expires_at ?? row?.expires_at ?? null,
        lastError: row?.last_error ?? null,
      });
    }
  }
  if (input.lastRunAt === null || input.now - input.lastRunAt > SCHEDULER_STALE_SECONDS) {
    issues.push({ kind: 'scheduler', lastRunAt: input.lastRunAt });
  }
  return issues;
}
```

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test tests/connections.test.ts tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/schema.sql functions/_lib/connections.ts functions/_lib/health.ts tests/connections.test.ts
git commit -m "Platform connections: sealed tokens, derived status, banner issues"
```

---

### Task 5: Gmail reads its token from D1 first, and reports its health

**Files:**
- Modify: `functions/_lib/gmail.ts:401-446` (`getAccessToken`)
- Test: `tests/gmail-token-source.test.ts`

**Interfaces:**
- Consumes: `getConnection`, `readRefreshToken`, `markOk`, `markBroken` (Task 4).
- Produces: unchanged `getAccessToken(env): Promise<string>` and `resetAccessToken()`.
  - Side effects: `platform_connections.gmail.last_ok_at` on each successful refresh.
  - `last_error(_at)` on `invalid_grant` or an unreadable stored token.

- [ ] **Step 1: Write the failing tests** in `tests/gmail-token-source.test.ts`

```ts
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { getAccessToken, resetAccessToken } from '../functions/_lib/gmail';
import { connectionUpsert, getConnection } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 5).toString('base64');

function setup(opts: { withTables?: boolean } = {}) {
  const db = new DatabaseSync(':memory:');
  if (opts.withTables !== false) db.exec(SCHEMA);
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GMAIL_REFRESH_TOKEN: 'secret-token', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' };
  return { db, env };
}

function stubToken(respond: (refresh: string) => Response) {
  const seen: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const refresh = new URLSearchParams(String(init?.body)).get('refresh_token')!;
    seen.push(refresh);
    return respond(refresh);
  }) as typeof fetch;
  return { seen, restore: () => { globalThis.fetch = original; } };
}
const ok = () => new Response(JSON.stringify({ access_token: 'at', expires_in: 3600 }), { status: 200 });

beforeEach(() => resetAccessToken());

test('with no stored connection, the secret is used and success is recorded', async () => {
  const { env } = setup();
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(env as never), 'at');
    assert.deepEqual(f.seen, ['secret-token']);
    assert.ok((await getConnection(env.DB, 'gmail'))!.last_ok_at);
  } finally { f.restore(); }
});

test('a stored connection wins over the secret', async () => {
  const { env } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'stored-token', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 1)).run();
  const f = stubToken(ok);
  try {
    await getAccessToken(env as never);
    assert.deepEqual(f.seen, ['stored-token']);
  } finally { f.restore(); }
});

test('invalid_grant marks Gmail broken and still throws', async () => {
  const { env } = setup();
  const f = stubToken(() => new Response('{"error":"invalid_grant","error_description":"Token has been expired or revoked."}', { status: 400 }));
  try {
    await assert.rejects(getAccessToken(env as never), /Token refresh failed \(400\)/);
    const row = (await getConnection(env.DB, 'gmail'))!;
    assert.match(row.last_error!, /invalid_grant/);
    assert.ok(row.last_error_at);
  } finally { f.restore(); }
});

test('a 500 from Google is not recorded as broken', async () => {
  const { env } = setup();
  const f = stubToken(() => new Response('oops', { status: 500 }));
  try {
    await assert.rejects(getAccessToken(env as never));
    assert.equal(await getConnection(env.DB, 'gmail'), null);
  } finally { f.restore(); }
});

test('an unreadable stored token (key rotated) falls back to the secret and says so', async () => {
  const { env } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'a', accessToken: null, refreshToken: 'stored', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 1)).run();
  const rotated = { ...env, TOKEN_ENC_KEY: Buffer.alloc(32, 6).toString('base64') };
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(rotated as never), 'at');
    assert.deepEqual(f.seen, ['secret-token']);
    assert.match((await getConnection(env.DB, 'gmail'))!.last_error!, /could not be read/);
  } finally { f.restore(); }
});

test('before the migration (no tables) mail still gets a token from the secret', async () => {
  const { env } = setup({ withTables: false });
  const f = stubToken(ok);
  try {
    assert.equal(await getAccessToken(env as never), 'at');
  } finally { f.restore(); }
});

test('with neither a stored token nor the secret, the old error message stands', async () => {
  const { env } = setup();
  const f = stubToken(ok);
  try {
    await assert.rejects(getAccessToken({ ...env, GMAIL_REFRESH_TOKEN: '' } as never), /GMAIL_REFRESH_TOKEN is not configured/);
  } finally { f.restore(); }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/gmail-token-source.test.ts`
Expected: FAIL. The "stored connection wins" test sees `['secret-token']`, and no health row is written.

- [ ] **Step 3: Change `functions/_lib/gmail.ts`**

Add the import at the top with the others:

```ts
import { getConnection, readRefreshToken, markOk, markBroken } from './connections';
```

Replace `getAccessToken` (keep `cachedToken` and `resetAccessToken` as they are) with:

```ts
const nowSeconds = () => Math.floor(Date.now() / 1000);

/** Health bookkeeping must never be the reason a mail fails. */
async function quietly(work: () => Promise<void>): Promise<void> {
  try { await work(); } catch { /* recorded nowhere, on purpose: see the comment on getAccessToken */ }
}

/**
 * Which refresh token to use. A token stored from the admin panel's
 * "Reconnect Gmail" wins; the GMAIL_REFRESH_TOKEN secret is the fallback, so
 * deploying this changed nothing until the first reconnect. Anything wrong
 * with the stored one -- no table yet, no TOKEN_ENC_KEY, a rotated key --
 * falls through to the secret rather than stopping mail.
 */
async function refreshTokenFor(env: Env): Promise<string> {
  // env.DB is absent in some unit tests' env objects; getConnection would throw synchronously.
  const row = env.DB ? await getConnection(env.DB, 'gmail').catch(() => null) : null;
  if (row?.refresh_token_enc) {
    try {
      const stored = await readRefreshToken(env, row);
      if (stored) return stored;
    } catch {
      await quietly(() => markBroken(env.DB, 'gmail', 'The stored Gmail token could not be read (TOKEN_ENC_KEY missing or changed). Reconnect Gmail.', nowSeconds()));
    }
  }
  if (env.GMAIL_REFRESH_TOKEN) return env.GMAIL_REFRESH_TOKEN;
  throw new GmailError('GMAIL_REFRESH_TOKEN is not configured');
}

/**
 * Refreshes at most once an hour per isolate. A refused grant is recorded on
 * the Gmail connection so the admin panel's banner can say so: Google revokes
 * Gmail grants when the account password changes, which happens every year,
 * and until now that stopped mail with nothing visible anywhere.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  const refreshToken = await refreshTokenFor(env);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    cachedToken = null;
    const detail = (await res.text()).slice(0, 300);
    if ((res.status === 400 || res.status === 401) && detail.includes('invalid_grant')) {
      await quietly(() => markBroken(env.DB, 'gmail', `Google refused the grant (invalid_grant). Usually the account password changed. Reconnect Gmail. ${detail}`, nowSeconds()));
    }
    throw new GmailError(`Token refresh failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  await quietly(() => markOk(env.DB, 'gmail', nowSeconds()));
  return data.access_token;
}
```

- [ ] **Step 4: Run the new and the existing Gmail tests**

Run: `node --import tsx --test tests/gmail-token-source.test.ts tests/gmail.test.ts tests/gmail-read.test.ts tests/mail.test.ts tests/dispatch-lifecycle.test.ts`
Expected: PASS. Existing tests that build an `env` without `DB` still pass: `refreshTokenFor` skips the lookup when `env.DB` is absent, and `markOk`/`markBroken` on an undefined `DB` reject inside `quietly`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/gmail.ts tests/gmail-token-source.test.ts
git commit -m "Gmail: prefer the token stored from the panel, record refused grants"
```

---

### Task 6: Reconnect Gmail from the panel

**Files:**
- Create: `functions/_lib/oauth-state.ts`, `functions/_lib/gmail-oauth.ts`
- Create: `functions/api/admin/connections/gmail/start.ts`, `functions/api/admin/connections/gmail/callback.ts`
- Test: `tests/gmail-connect.test.ts`

**Interfaces:**
- Consumes: `connectionUpsert` (Task 4), `runWithAudit`, `appendAudit` (Task 1), `resetAccessToken` (gmail.ts).
- Produces:
  - `STATE_TTL_SECONDS`
  - `createState(db, platform: string, userId: string, returnTo: '/admin' | '/tr/admin', now: number): Promise<string>`
  - `consumeState(db, state: string, now: number): Promise<{ platform: string; user_id: string; return_to: string } | null>`
  - `GMAIL_SCOPES: string[]`
  - `gmailAuthUrl(env, base: string, state: string): string`
  - `gmailRedirectUri(base: string): string`
  - `GET /api/admin/connections/gmail/start?lang=tr|en`, which 302s to Google
  - `GET /api/admin/connections/gmail/callback`, which 302s to `/admin?connected=gmail` or `/admin?connection_error=<code>`. The codes are `bad_state`, `not_admin`, `cancelled`, `token_exchange`, `no_refresh_token`, `missing_scope`, `wrong_account`.
  - Audit actions `connection.start`, `connection.connect`, `connection.rejected`, `connection.cancelled`.

- [ ] **Step 1: Write the failing tests** in `tests/gmail-connect.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestGet as start } from '../functions/api/admin/connections/gmail/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/gmail/callback';
import { getConnection, readRefreshToken } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';
const KEY = Buffer.alloc(32, 1).toString('base64');
const SCOPE = 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly';

function setup(isAdmin = 1) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',?,1,1)`).run(isAdmin);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u2','g2','other@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1),('s2','u2',4000000000,1)`).run();
  const env = { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs', RSG_MAIL_FROM: 'turkey.rsg@gmail.com' };
  return { db, env };
}
const get = (h: unknown, url: string, env: unknown, session = 's1') =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(url, { headers: { Cookie: `rsg_session=${session}` } }), env });

async function begin(env: unknown, lang = '') {
  const res = await get(start, `${BASE}/api/admin/connections/gmail/start${lang}`, env);
  assert.equal(res.status, 302);
  return new URL(res.headers.get('Location')!);
}

function stubGoogle(opts: { email?: string; refresh?: boolean; scope?: string; exchangeStatus?: number } = {}) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://oauth2.googleapis.com/token')) {
      if (opts.exchangeStatus) return new Response('nope', { status: opts.exchangeStatus });
      return Response.json({ access_token: 'at', expires_in: 3600, scope: opts.scope ?? SCOPE, ...(opts.refresh === false ? {} : { refresh_token: 'rt-new' }) });
    }
    if (url.startsWith('https://openidconnect.googleapis.com/v1/userinfo')) {
      return Response.json({ email: opts.email ?? 'turkey.rsg@gmail.com', email_verified: true });
    }
    if (url.startsWith('https://oauth2.googleapis.com/revoke')) return new Response('', { status: 200 });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('start sends the admin to Google with offline access, consent and the RSG account hinted', async () => {
  const { env } = setup();
  const google = await begin(env);
  assert.equal(google.origin + google.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(google.searchParams.get('access_type'), 'offline');
  assert.equal(google.searchParams.get('prompt'), 'consent');
  assert.equal(google.searchParams.get('login_hint'), 'turkey.rsg@gmail.com');
  assert.equal(google.searchParams.get('redirect_uri'), `${BASE}/api/admin/connections/gmail/callback`);
  assert.match(google.searchParams.get('scope')!, /gmail\.send/);
  assert.ok(google.searchParams.get('state')!.length >= 32);
});

test('start is admin-only', async () => {
  const { env } = setup(0);
  assert.equal((await get(start, `${BASE}/api/admin/connections/gmail/start`, env)).status, 403);
});

test('the happy path stores the sealed token, logs it, and returns to the panel', async () => {
  const { env, db } = setup();
  const state = (await begin(env, '?lang=tr')).searchParams.get('state')!;
  const g = stubGoogle();
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    assert.equal(res.headers.get('Location'), `${BASE}/tr/admin?connected=gmail`);
    const row = (await getConnection(env.DB, 'gmail'))!;
    assert.equal(await readRefreshToken(env, row), 'rt-new');
    assert.equal(row.account_name, 'turkey.rsg@gmail.com');
    const actions = (db.prepare('SELECT action FROM audit_log ORDER BY seq').all() as { action: string }[]).map((r) => r.action);
    assert.deepEqual(actions, ['connection.start', 'connection.connect']);
  } finally { g.restore(); }
});

test('a callback replayed after success finds no state', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const g = stubGoogle();
  try {
    await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    const again = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
    assert.equal(again.headers.get('Location'), `${BASE}/admin?connection_error=bad_state`);
  } finally { g.restore(); }
});

test('an expired state is refused', async () => {
  const { env, db } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  db.prepare('UPDATE oauth_states SET expires_at = 1').run();
  const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env);
  assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=bad_state`);
});

test('a state started by one admin cannot be finished by another', async () => {
  const { env } = setup();
  const state = (await begin(env)).searchParams.get('state')!;
  const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${state}`, env, 's2');
  assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=not_admin`);
});

test('the wrong Google account is refused, revoked, and the working connection is untouched', async () => {
  const { env, db } = setup();
  const s1 = (await begin(env)).searchParams.get('state')!;
  let g = stubGoogle();
  await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${s1}`, env);
  g.restore();
  const s2 = (await begin(env)).searchParams.get('state')!;
  g = stubGoogle({ email: 'someone.personal@example.org' });
  try {
    const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?code=c&state=${s2}`, env);
    assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=wrong_account`);
    assert.ok(g.calls.some((u) => u.startsWith('https://oauth2.googleapis.com/revoke')));
    assert.equal(await readRefreshToken(env, (await getConnection(env.DB, 'gmail'))!), 'rt-new');
    const last = db.prepare('SELECT action, details FROM audit_log ORDER BY seq DESC LIMIT 1').get() as { action: string; details: string };
    assert.equal(last.action, 'connection.rejected');
    assert.equal(JSON.parse(last.details).account, 'someone.personal@example.org');
  } finally { g.restore(); }
});

test('no refresh token, missing scope, failed exchange and a cancelled consent each say why', async () => {
  const cases: [Parameters<typeof stubGoogle>[0], string, string][] = [
    [{ refresh: false }, 'code=c', 'no_refresh_token'],
    [{ scope: 'openid email https://www.googleapis.com/auth/gmail.send' }, 'code=c', 'missing_scope'],
    [{ exchangeStatus: 400 }, 'code=c', 'token_exchange'],
    [{}, 'error=access_denied', 'cancelled'],
  ];
  for (const [opts, query, code] of cases) {
    const { env } = setup();
    const state = (await begin(env)).searchParams.get('state')!;
    const g = stubGoogle(opts);
    try {
      const res = await get(callback, `${BASE}/api/admin/connections/gmail/callback?${query}&state=${state}`, env);
      assert.equal(res.headers.get('Location'), `${BASE}/admin?connection_error=${code}`, code);
      assert.equal(await getConnection(env.DB, 'gmail'), null, code);
    } finally { g.restore(); }
  }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/gmail-connect.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/oauth-state.ts`**

```ts
export const STATE_TTL_SECONDS = 600;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createState(
  db: D1Database, platform: string, userId: string, returnTo: '/admin' | '/tr/admin', now: number,
): Promise<string> {
  const state = randomState();
  await db.batch([
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO oauth_states (state, platform, user_id, return_to, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(state, platform, userId, returnTo, now + STATE_TTL_SECONDS),
  ]);
  return state;
}

/** Single use: the row is deleted as it is read, so a replay finds nothing. */
export function consumeState(db: D1Database, state: string, now: number) {
  return db.prepare('DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING platform, user_id, return_to')
    .bind(state, now).first<{ platform: string; user_id: string; return_to: string }>();
}
```

- [ ] **Step 4: `functions/_lib/gmail-oauth.ts`**

```ts
import type { Env } from './auth';

/** openid + email let the callback check WHICH account granted access. */
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const REQUIRED = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];

export const gmailRedirectUri = (base: string) => `${base}/api/admin/connections/gmail/callback`;
export const expectedGmailAccount = (env: Pick<Env, 'GMAIL_ACCOUNT' | 'RSG_MAIL_FROM'>) =>
  (env.GMAIL_ACCOUNT || env.RSG_MAIL_FROM).trim().toLowerCase();

export function gmailAuthUrl(env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GMAIL_ACCOUNT' | 'RSG_MAIL_FROM'>, base: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: gmailRedirectUri(base),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    // Without both, Google returns no refresh token on a second grant.
    access_type: 'offline',
    prompt: 'consent',
    login_hint: expectedGmailAccount(env),
    state,
  }).toString();
  return url.toString();
}

export const hasRequiredScopes = (granted: string) => REQUIRED.every((s) => granted.split(' ').includes(s));

export async function revokeGrant(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch { /* best effort: an unrevoked grant to the wrong account is harmless to the site */ }
}
```

- [ ] **Step 5: `functions/api/admin/connections/gmail/start.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { gmailAuthUrl } from '../../../../_lib/gmail-oauth';
import { appendAudit } from '../../../../_lib/audit';

/** A link in the Connections pane, not a fetch: the browser navigates here and on to Google. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  const state = await createState(env.DB, 'gmail', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'gmail' }, now);
  return redirectResponse(gmailAuthUrl(env, getBaseUrl(request), state));
};
```

- [ ] **Step 6: `functions/api/admin/connections/gmail/callback.ts`**

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { gmailRedirectUri, expectedGmailAccount, hasRequiredScopes, revokeGrant } from '../../../../_lib/gmail-oauth';
import { connectionUpsert } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { resetAccessToken } from '../../../../_lib/gmail';

/**
 * Finishes "Reconnect Gmail". Every way out is a redirect back to the panel
 * with either ?connected=gmail or ?connection_error=<code>; the panel turns
 * the code into a sentence. Nothing is stored unless every check passes, so a
 * failed reconnect leaves the working connection exactly as it was.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'gmail') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');

  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'gmail', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: gmailRedirectUri(base),
      grant_type: 'authorization_code',
    }),
  });
  if (!tokenRes.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokenRes.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  const tokens = await tokenRes.json<{ access_token: string; refresh_token?: string; scope?: string }>();

  if (!tokens.refresh_token) {
    await audit('connection.rejected', { reason: 'no_refresh_token' });
    return back(returnTo, 'connection_error=no_refresh_token');
  }
  const scope = tokens.scope ?? '';
  if (!hasRequiredScopes(scope)) {
    await revokeGrant(tokens.refresh_token);
    await audit('connection.rejected', { reason: 'missing_scope', scope });
    return back(returnTo, 'connection_error=missing_scope');
  }

  const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const info = infoRes.ok ? await infoRes.json<{ email?: string }>() : {};
  const account = (info.email ?? '').toLowerCase();
  if (account !== expectedGmailAccount(env)) {
    await revokeGrant(tokens.refresh_token);
    await audit('connection.rejected', { reason: 'wrong_account', account });
    return back(returnTo, 'connection_error=wrong_account');
  }

  const upsert = await connectionUpsert(env, 'gmail', {
    accountId: null, accountName: account, accessToken: null, refreshToken: tokens.refresh_token,
    scopes: scope, expiresAt: null, refreshExpiresAt: null,
  }, user.id, now);
  await runWithAudit(env.DB, [upsert], {
    userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'gmail',
    details: { account, scopes: scope.split(' ') },
  }, now);
  resetAccessToken();
  return back(returnTo, 'connected=gmail');
};
```

- [ ] **Step 7: Run the tests**

Run: `node --import tsx --test tests/gmail-connect.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/oauth-state.ts functions/_lib/gmail-oauth.ts functions/api/admin/connections/gmail tests/gmail-connect.test.ts
git commit -m "Reconnect Gmail from the admin panel, refusing any other account"
```

---

### Task 7: Admin APIs (connections, health, audit, view beacon)

**Files:**
- Create: `functions/_lib/audit-query.ts`
- Create: `functions/api/admin/connections/index.ts`, `functions/api/admin/connections/[platform].ts`
- Create: `functions/api/admin/health.ts`
- Create: `functions/api/admin/audit/index.ts`, `functions/api/admin/audit/export.ts`, `functions/api/admin/audit/verify.ts`
- Create: `functions/api/audit/view.ts`
- Test: `tests/connections-api.test.ts`, `tests/audit-api.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 4.
- Produces:
  - **`GET /api/admin/connections`** returns `{ connections: { platform, status, accountName, connectedBy, connectedAt, lastOkAt, lastError, expiresAt, usesLegacySecret, hasStoredToken }[] }` (admin; logs `read.connections`).
  - **`DELETE /api/admin/connections/:platform`** returns `{ ok: true }` (admin, CSRF; logs `connection.disconnect`).
  - **`GET /api/admin/health`** returns `{ issues: HealthIssue[]; canFix: boolean }`.
    - Allowed for any panel role.
    - `lastError` is null for non-admins.
    - Returns `{ issues: [], canFix }` if the tables are missing.
  - **`GET /api/admin/audit?user=&action=&from=&to=&before=`** returns `{ rows: (AuditRow & { user_email })[]; hasMore: boolean }`.
    - Admin; 100 rows per page, newest first; logs `read.audit`.
  - **`GET /api/admin/audit/export?format=csv|json&...same filters`** downloads the file (admin; logs `audit.export` first).
  - **`POST /api/admin/audit/verify`** returns `ChainResult` (admin, CSRF; logs `audit.verify`).
  - **`POST /api/audit/view`** with body `{ pane }` returns 204 (any panel role, CSRF; logs `view.pane`).

- [ ] **Step 1: Write the failing tests** in `tests/connections-api.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as list from '../functions/api/admin/connections/index';
import * as one from '../functions/api/admin/connections/[platform]';
import * as health from '../functions/api/admin/health';
import { connectionUpsert, markBroken } from '../functions/_lib/connections';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY = Buffer.alloc(32, 2).toString('base64');
const BASE = 'https://rsg-turkiye.iscbsc.org';

function setup(roles: Record<string, number> = { is_admin: 1 }, schema = SCHEMA) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','admin@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) as never, TOKEN_ENC_KEY: KEY, GMAIL_REFRESH_TOKEN: 'legacy' } };
}
const call = (h: unknown, method: string, path: string, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request: new Request(`${BASE}${path}`, { method, headers: { Cookie: 'rsg_session=s1' } }), env, params });

test('the list shows every platform, never a token, and logs the read', async () => {
  const { env, db } = setup();
  await (await connectionUpsert(env, 'gmail', { accountId: null, accountName: 'turkey.rsg@gmail.com', accessToken: null, refreshToken: 'rt', scopes: '', expiresAt: null, refreshExpiresAt: null }, 'u1', 100)).run();
  const res = await call(list.onRequestGet, 'GET', '/api/admin/connections', env);
  const text = await res.text();
  assert.ok(!text.includes('v1.'), 'no sealed token in the response');
  const { connections } = JSON.parse(text) as { connections: { platform: string; status: string; connectedBy: string; hasStoredToken: boolean; usesLegacySecret: boolean }[] };
  assert.deepEqual(connections.map((c) => c.platform), ['gmail', 'instagram', 'linkedin', 'x']);
  assert.equal(connections[0].status, 'connected');
  assert.equal(connections[0].connectedBy, 'admin@example.org');
  assert.equal(connections[0].hasStoredToken, true);
  assert.equal(connections[0].usesLegacySecret, false);
  assert.equal(connections[1].status, 'unused');
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'read.connections'`).get() as { n: number }).n, 1);
});

test('Gmail on the secret alone shows as connected via the legacy secret', async () => {
  const { env } = setup();
  const { connections } = await (await call(list.onRequestGet, 'GET', '/api/admin/connections', env)).json() as { connections: { status: string; usesLegacySecret: boolean }[] };
  assert.equal(connections[0].status, 'connected');
  assert.equal(connections[0].usesLegacySecret, true);
});

test('only an admin may list or disconnect', async () => {
  const { env } = setup({ is_symposium: 1 });
  assert.equal((await call(list.onRequestGet, 'GET', '/api/admin/connections', env)).status, 403);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/gmail', env, { platform: 'gmail' })).status, 403);
});

test('disconnect removes the row and is logged; an unknown platform is a 400', async () => {
  const { env, db } = setup();
  await markBroken(env.DB, 'gmail', 'x', 1);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/gmail', env, { platform: 'gmail' })).status, 200);
  assert.equal(db.prepare('SELECT * FROM platform_connections').get(), undefined);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'connection.disconnect'`).get() as { n: number }).n, 1);
  assert.equal((await call(one.onRequestDelete, 'DELETE', '/api/admin/connections/myspace', env, { platform: 'myspace' })).status, 400);
});

test('health is open to any panel role and hides error detail from non-admins', async () => {
  const { env, db } = setup({ is_announcer: 1 });
  await markBroken(env.DB, 'gmail', 'invalid_grant secret detail', Math.floor(Date.now() / 1000));
  db.prepare('INSERT INTO dispatch_runs (id, started_at) VALUES (?, ?)').run('r1', Math.floor(Date.now() / 1000));
  const body = await (await call(health.onRequestGet, 'GET', '/api/admin/health', env)).json() as { issues: { lastError: string | null }[]; canFix: boolean };
  assert.equal(body.canFix, false);
  assert.equal(body.issues.length, 1);
  assert.equal(body.issues[0].lastError, null);
});

test('health is 403 for a signed-in user with no panel role', async () => {
  const { env } = setup({ is_member: 1 });
  assert.equal((await call(health.onRequestGet, 'GET', '/api/admin/health', env)).status, 403);
});

test('health before the migration answers with no issues instead of failing', async () => {
  const preMigration = SCHEMA.replace(/CREATE TABLE IF NOT EXISTS platform_connections[\s\S]*?\);/, '');
  const { env } = setup({ is_admin: 1 }, preMigration);
  const res = await call(health.onRequestGet, 'GET', '/api/admin/health', env);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json() as { issues: unknown[] }).issues, []);
});
```

`tests/audit-api.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import * as list from '../functions/api/admin/audit/index';
import * as exp from '../functions/api/admin/audit/export';
import * as verify from '../functions/api/admin/audit/verify';
import * as view from '../functions/api/audit/view';
import { appendAudit } from '../functions/_lib/audit';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org';

function setup(roles: Record<string, number> = { is_admin: 1 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','admin@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u2','g2','editor@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db) as never } };
}
const call = (h: unknown, method: string, path: string, env: unknown, body?: unknown) =>
  (h as (c: unknown) => Promise<Response>)({
    request: new Request(`${BASE}${path}`, { method, headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  });

test('the list filters by person and action, newest first, with paging', async () => {
  const { env } = setup();
  for (let i = 0; i < 3; i++) await appendAudit(env.DB, { userId: 'u2', action: 'role.change' }, 100 + i);
  await appendAudit(env.DB, { userId: 'u1', action: 'connection.start' }, 200);
  const res = await call(list.onRequestGet, 'GET', '/api/admin/audit?user=editor&action=role', env);
  const body = await res.json() as { rows: { seq: number; user_email: string }[]; hasMore: boolean };
  assert.deepEqual(body.rows.map((r) => r.seq), [3, 2, 1]);
  assert.equal(body.rows[0].user_email, 'editor@example.org');
  assert.equal(body.hasMore, false);
  const older = await (await call(list.onRequestGet, 'GET', '/api/admin/audit?before=2', env)).json() as { rows: { seq: number }[] };
  assert.deepEqual(older.rows.map((r) => r.seq), [1]);
});

test('date filters are inclusive unix bounds', async () => {
  const { env } = setup();
  await appendAudit(env.DB, { userId: 'u1', action: 'a' }, 100);
  await appendAudit(env.DB, { userId: 'u1', action: 'b' }, 200);
  const body = await (await call(list.onRequestGet, 'GET', '/api/admin/audit?from=150&to=250', env)).json() as { rows: { action: string }[] };
  assert.deepEqual(body.rows.filter((r) => r.action !== 'read.audit').map((r) => r.action), ['b']);
});

test('export is logged before it is served, and CSV is a download', async () => {
  const { env, db } = setup();
  await appendAudit(env.DB, { userId: 'u2', action: 'role.change' }, 100);
  const res = await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=csv', env);
  assert.equal(res.headers.get('Content-Type'), 'text/csv; charset=utf-8');
  assert.match(res.headers.get('Content-Disposition')!, /attachment; filename="rsg-audit-\d{8}\.csv"/);
  const csv = await res.text();
  assert.match(csv, /audit\.export/, 'the export row is inside the export');
  const json = await (await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=json', env)).json() as unknown[];
  assert.ok(Array.isArray(json));
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'audit.export'`).get() as { n: number }).n, 2);
});

test('verify reports an intact chain, and a broken one after tampering', async () => {
  const { env, db } = setup();
  for (let i = 0; i < 3; i++) await appendAudit(env.DB, { userId: 'u2', action: `a${i}` }, 100 + i);
  const ok = await (await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).json() as { ok: boolean };
  assert.equal(ok.ok, true);
  db.prepare(`UPDATE audit_log SET action = 'forged' WHERE seq = 2`).run();
  const bad = await (await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).json() as { ok: boolean; brokenAt: number };
  assert.deepEqual([bad.ok, bad.brokenAt], [false, 2]);
});

test('audit endpoints are admin-only', async () => {
  const { env } = setup({ is_symposium: 1 });
  assert.equal((await call(list.onRequestGet, 'GET', '/api/admin/audit', env)).status, 403);
  assert.equal((await call(exp.onRequestGet, 'GET', '/api/admin/audit/export?format=csv', env)).status, 403);
  assert.equal((await call(verify.onRequestPost, 'POST', '/api/admin/audit/verify', env)).status, 403);
});

test('a pane view from any panel role is logged; junk pane names are refused', async () => {
  const { env, db } = setup({ is_symposium: 1 });
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, { pane: 'symposium' })).status, 204);
  const row = db.prepare('SELECT action, target_type, target_id, user_id FROM audit_log').get();
  assert.deepEqual({ ...row as object }, { action: 'view.pane', target_type: 'pane', target_id: 'symposium', user_id: 'u1' });
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, { pane: '<script>' })).status, 400);
  assert.equal((await call(view.onRequestPost, 'POST', '/api/audit/view', env, {})).status, 400);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/connections-api.test.ts tests/audit-api.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: `functions/_lib/audit-query.ts`**

```ts
/** Filters shared by the log list and its export. Bad numbers are ignored, not 400s: these come from a form. */
export function auditFilters(params: URLSearchParams): { where: string; binds: (string | number)[] } {
  const clauses: string[] = [];
  const binds: (string | number)[] = [];
  const int = (v: string | null) => (v !== null && /^\d{1,12}$/.test(v) ? Number(v) : null);

  const user = params.get('user')?.trim();
  if (user) { clauses.push('u.email LIKE ?'); binds.push(`%${user}%`); }
  const action = params.get('action')?.trim();
  if (action) { clauses.push('a.action LIKE ?'); binds.push(`${action}%`); }
  const from = int(params.get('from'));
  if (from !== null) { clauses.push('a.at >= ?'); binds.push(from); }
  const to = int(params.get('to'));
  if (to !== null) { clauses.push('a.at <= ?'); binds.push(to); }
  const before = int(params.get('before'));
  if (before !== null) { clauses.push('a.seq < ?'); binds.push(before); }

  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', binds };
}

export const AUDIT_SELECT = 'SELECT a.*, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id';
```

- [ ] **Step 4: `functions/api/admin/connections/index.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { PLATFORMS, connectionStatus, type ConnectionRow } from '../../../_lib/connections';
import { appendAudit } from '../../../_lib/audit';

type Row = ConnectionRow & { connected_by_email: string | null; connected_by_name: string | null };

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const rows = (await env.DB.prepare(
    `SELECT c.*, u.email AS connected_by_email, p.display_name AS connected_by_name
       FROM platform_connections c
       LEFT JOIN users u ON u.id = c.connected_by
       LEFT JOIN profiles p ON p.user_id = c.connected_by`,
  ).all<Row>()).results;
  const legacyGmail = Boolean(env.GMAIL_REFRESH_TOKEN);

  const connections = PLATFORMS.map((platform) => {
    const row = rows.find((r) => r.platform === platform) ?? null;
    const hasStoredToken = Boolean(row?.refresh_token_enc || row?.access_token_enc);
    return {
      platform,
      status: connectionStatus(row, now, platform === 'gmail' && legacyGmail),
      accountName: row?.account_name ?? null,
      connectedBy: row?.connected_by_name || row?.connected_by_email || null,
      connectedAt: row?.connected_at ?? null,
      lastOkAt: row?.last_ok_at ?? null,
      lastError: row?.last_error ?? null,
      expiresAt: row?.refresh_expires_at ?? row?.expires_at ?? null,
      usesLegacySecret: platform === 'gmail' && legacyGmail && !hasStoredToken,
      hasStoredToken,
    };
  });

  await appendAudit(env.DB, { userId: user.id, action: 'read.connections' }, now);
  return jsonResponse({ connections });
};
```

- [ ] **Step 5: `functions/api/admin/connections/[platform].ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { isPlatform, disconnectStatement } from '../../../_lib/connections';
import { runWithAudit } from '../../../_lib/audit';
import { resetAccessToken } from '../../../_lib/gmail';

/** For Gmail this drops the stored token; mail falls back to the GMAIL_REFRESH_TOKEN secret if it is still set. */
export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const platform = params.platform;
  if (!isPlatform(platform)) return jsonResponse({ error: 'Unknown platform', code: 'unknown_platform' }, 400);

  await runWithAudit(env.DB, [disconnectStatement(env.DB, platform)], {
    userId: user.id, action: 'connection.disconnect', targetType: 'connection', targetId: platform,
  });
  if (platform === 'gmail') resetAccessToken();
  return jsonResponse({ ok: true });
};
```

- [ ] **Step 6: `functions/api/admin/health.ts`**

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, canSeeAdminPanel } from '../../_lib/auth';
import { listConnections } from '../../_lib/connections';
import { healthIssues } from '../../_lib/health';

/**
 * What the banner above every admin pane shows. Every panel role sees it;
 * only an admin sees the provider's error text and gets the fix button. If
 * the tables are not there yet (deployed before the migration) it answers
 * with no issues rather than a 500 -- a banner that errors is worse than none.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const canFix = user.is_admin === 1;

  try {
    const now = Math.floor(Date.now() / 1000);
    const [connections, lastRun] = await Promise.all([
      listConnections(env.DB),
      env.DB.prepare('SELECT MAX(started_at) AS t FROM dispatch_runs').first<{ t: number | null }>(),
    ]);
    const issues = healthIssues({ connections, legacyGmail: Boolean(env.GMAIL_REFRESH_TOKEN), lastRunAt: lastRun?.t ?? null, now })
      .map((i) => (i.kind === 'connection' && !canFix ? { ...i, lastError: null } : i));
    return jsonResponse({ issues, canFix });
  } catch (err) {
    console.error('health check failed', err);
    return jsonResponse({ issues: [], canFix });
  }
};
```

- [ ] **Step 7: `functions/api/admin/audit/index.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { appendAudit, type AuditRow } from '../../../_lib/audit';
import { auditFilters, AUDIT_SELECT } from '../../../_lib/audit-query';

const PAGE = 100;

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const { where, binds } = auditFilters(new URL(request.url).searchParams);
  const rows = (await env.DB.prepare(`${AUDIT_SELECT} ${where} ORDER BY a.seq DESC LIMIT ?`)
    .bind(...binds, PAGE + 1).all<AuditRow & { user_email: string | null }>()).results;
  // Logged after the read, so this page does not show its own viewing.
  await appendAudit(env.DB, { userId: user.id, action: 'read.audit' });
  return jsonResponse({ rows: rows.slice(0, PAGE), hasMore: rows.length > PAGE });
};
```

- [ ] **Step 8: `functions/api/admin/audit/export.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../../_lib/auth';
import { appendAudit, toCsv, type AuditRow } from '../../../_lib/audit';
import { auditFilters, AUDIT_SELECT } from '../../../_lib/audit-query';

const MAX_ROWS = 50_000;

/**
 * Logged BEFORE the rows are read, so the file contains the record of its own
 * export. JSON is the verifiable format (exact cell text); CSV is for reading.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const params = new URL(request.url).searchParams;
  const format = params.get('format') === 'json' ? 'json' : 'csv';
  const { where, binds } = auditFilters(params);
  await appendAudit(env.DB, {
    userId: user.id, action: 'audit.export',
    details: { format, filters: Object.fromEntries([...params].filter(([k]) => k !== 'format')) },
  });
  const rows = (await env.DB.prepare(`${AUDIT_SELECT} ${where} ORDER BY a.seq ASC LIMIT ?`)
    .bind(...binds, MAX_ROWS).all<AuditRow & { user_email: string | null }>()).results;

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const body = format === 'json' ? JSON.stringify(rows, null, 2) : toCsv(rows);
  return new Response(body, {
    headers: {
      'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="rsg-audit-${stamp}.${format}"`,
      'Cache-Control': 'no-store',
    },
  });
};
```

- [ ] **Step 9: `functions/api/admin/audit/verify.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { appendAudit, verifyChain, type AuditRow } from '../../../_lib/audit';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const rows = (await env.DB.prepare('SELECT * FROM audit_log ORDER BY seq ASC').all<AuditRow>()).results;
  const result = await verifyChain(rows);
  await appendAudit(env.DB, { userId: user.id, action: 'audit.verify', details: result });
  return jsonResponse(result);
};
```

- [ ] **Step 10: `functions/api/audit/view.ts`**

```ts
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canSeeAdminPanel } from '../../_lib/auth';
import { appendAudit } from '../../_lib/audit';

const PANE = /^[a-z][a-z-]{0,39}$/;

/**
 * Sent by the admin panel each time a pane is shown. Client-reported, so a
 * determined user can suppress it; the server-side read entries
 * (read.connections, read.audit) cannot be.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSeeAdminPanel(user)) return jsonResponse({ error: 'Forbidden' }, 403);

  let pane: unknown;
  try { pane = (await request.json() as { pane?: unknown }).pane; } catch { pane = undefined; }
  if (typeof pane !== 'string' || !PANE.test(pane)) return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);

  await appendAudit(env.DB, { userId: user.id, action: 'view.pane', targetType: 'pane', targetId: pane });
  return new Response(null, { status: 204 });
};
```

- [ ] **Step 11: Run the tests**

Run: `node --import tsx --test tests/connections-api.test.ts tests/audit-api.test.ts tests/routes.test.ts tests/route-parity.test.ts tests/functions-hygiene.test.ts tests/api-input.test.ts`
Expected: PASS. If `routes.test.ts` or `route-parity.test.ts` keeps a list of known API routes, add the new routes to that list as the failing message says, and rerun.

- [ ] **Step 12: Commit**

```bash
git add functions/_lib/audit-query.ts functions/api/admin/connections functions/api/admin/health.ts functions/api/admin/audit functions/api/audit tests/connections-api.test.ts tests/audit-api.test.ts
git commit -m "Admin APIs: connections, health banner, audit list/export/verify, pane views"
```

---

### Task 8: Daily audit prune

**Files:**
- Create: `functions/_lib/secret.ts`, `functions/api/admin/audit/prune.ts`
- Modify: `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml`
- Modify: `tests/symposium-cron.test.ts`
- Test: `tests/audit-prune.test.ts`

**Interfaces:**
- Consumes: `appendAudit`, `AUDIT_RETENTION_SECONDS` (Task 1).
- Produces:
  - `safeEqual(a: string | null | undefined, b: string | null | undefined): boolean`
  - `POST /api/admin/audit/prune`, with header `X-Archive-Secret`, returns `{ ok: true, deleted: number }`.
  - Worker env `AUDIT_PRUNE_URL`.
  - Worker `Tick` gains `auditPrune: string`.

- [ ] **Step 1: Write the failing tests** in `tests/audit-prune.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestPost } from '../functions/api/admin/audit/prune';
import { appendAudit, verifyChain, AUDIT_RETENTION_SECONDS, type AuditRow } from '../functions/_lib/audit';
import { safeEqual } from '../functions/_lib/secret';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = Math.floor(Date.now() / 1000);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  return { db, env: { DB: d1(db) as never, SYMPOSIUM_ARCHIVE_SECRET: 's3cret' } };
}
const prune = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/audit/prune', { method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {} }),
    env,
  });

test('safeEqual', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), false, 'an unset secret never matches');
  assert.equal(safeEqual(null, 'x'), false);
});

test('rows older than a year go, the chain still verifies, and the prune is logged', async () => {
  const { env, db } = setup();
  await appendAudit(env.DB, { userId: 'u', action: 'old' }, NOW - AUDIT_RETENTION_SECONDS - 10);
  await appendAudit(env.DB, { userId: 'u', action: 'old' }, NOW - AUDIT_RETENTION_SECONDS - 5);
  await appendAudit(env.DB, { userId: 'u', action: 'recent' }, NOW - 60);
  assert.equal((await prune(env)).status, 403);
  assert.equal((await prune(env, 'wrong')).status, 403);
  const res = await prune(env, 's3cret');
  assert.deepEqual(await res.json(), { ok: true, deleted: 2 });
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY seq').all() as unknown as AuditRow[];
  assert.deepEqual(rows.map((r) => r.action), ['recent', 'audit.prune']);
  assert.deepEqual(await verifyChain(rows), { ok: true, checked: 2, anchoredAfterPrune: true });
});
```

In `tests/symposium-cron.test.ts`:

1. Add `AUDIT_PRUNE_URL: 'https://main/audit-prune',` to `ENV`.
2. Change the secret-header check to `if (url.includes('/purge') || url.includes('/archive') || url.includes('/audit-prune'))`.
3. Update the order assertion to `[ENV.ARCHIVE_URL, ENV.PURGE_URL, ENV.AUDIT_PRUNE_URL, ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]`.
4. In the failing-purge test, change `f.calls.slice(2)` to `f.calls.slice(3)`.
5. Add:

```ts
test('a failing audit prune is reported but stops nothing', async () => {
  const f = stubFetch(ENV.AUDIT_PRUNE_URL);
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 502);
    assert.deepEqual(f.calls.slice(3), [ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
    assert.match(String((await res.json() as { auditPrune: string }).auditPrune), /^ERROR 500/);
  } finally { f.restore(); }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/audit-prune.test.ts tests/symposium-cron.test.ts`
Expected: FAIL, modules not found and call order mismatch.

- [ ] **Step 3: `functions/_lib/secret.ts`**

```ts
/** Constant-time comparison for shared secrets. An empty or missing value never matches. */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
```

- [ ] **Step 4: `functions/api/admin/audit/prune.ts`**

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { appendAudit, AUDIT_RETENTION_SECONDS } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';

/**
 * Called nightly by workers/symposium-cron with the same secret as the
 * certificate purge. Removes rows older than a year. The chain stays
 * verifiable: verifyChain accepts a first row that links to a removed one and
 * reports it as anchoredAfterPrune.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - AUDIT_RETENTION_SECONDS;
  const result = await env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(cutoff).run();
  const deleted = Number(result.meta.changes ?? 0);
  await appendAudit(env.DB, { userId: null, action: 'audit.prune', details: { deleted, cutoff } }, now);
  return jsonResponse({ ok: true, deleted });
};
```

- [ ] **Step 5: Worker.** In `workers/symposium-cron/src/index.ts`:

1. Add to `Env`:

   ```ts
     /** Main site's audit-log retention endpoint; same secret as archive. */
     AUDIT_PRUNE_URL: string;
   ```

2. Replace `callPurge` with a generic caller, and use it for both:

   ```ts
   /** POSTs to one of the main site's secret-gated maintenance endpoints. */
   async function callSecretPost(label: string, url: string, env: Env): Promise<string> {
     try {
       const res = await fetch(url, { method: 'POST', headers: { 'X-Archive-Secret': env.SYMPOSIUM_ARCHIVE_SECRET } });
       const body = await res.text();
       console.log(`${label} ${res.status}: ${body.slice(0, 300)}`);
       return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
     } catch (err) {
       console.log(`${label} threw: ${String(err).slice(0, 300)}`);
       return `ERROR: ${String(err).slice(0, 200)}`;
     }
   }
   ```

3. In `tick`:
   - `const purge = await callSecretPost('purge', env.PURGE_URL, env);`
   - Then `const auditPrune = await callSecretPost('audit prune', env.AUDIT_PRUNE_URL, env);`
   - Return `{ archive, purge, auditPrune, rebuild, websiteRebuild }`.
4. `type Tick` gains `auditPrune: string`.
5. Add `t.auditPrune` to the `failed` list.
6. Add ` audit prune: ${t.auditPrune.slice(0, 120)}` to `summarise`.
7. In `fetch`, add `auditPrune: parseIfJson(body.auditPrune),` after `purge`.

In `workers/symposium-cron/wrangler.toml` `[vars]` add:

```toml
AUDIT_PRUNE_URL = "https://rsg-turkiye.iscbsc.org/api/admin/audit/prune"
```

Extend the header comment's last paragraph: "It also prunes the admin audit log to one year (functions/api/admin/audit/prune.ts), with the same secret."

- [ ] **Step 6: Run the tests**

Run: `node --import tsx --test tests/audit-prune.test.ts tests/symposium-cron.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/secret.ts functions/api/admin/audit/prune.ts workers/symposium-cron tests/audit-prune.test.ts tests/symposium-cron.test.ts
git commit -m "Prune the audit log to a year from the nightly cron"
```

---

### Task 9: Admin panel UI (banner, Connections, Log, social roles, view beacon)

**Files:**
- Modify: `src/i18n/ui.ts` (en block near `admin.symposium.heading` at :453, tr block near :1031)
- Create: `src/scripts/format-time.ts`, `src/scripts/admin-health.ts`, `src/scripts/admin-connections.ts`, `src/scripts/admin-audit.ts`
- Modify: `src/components/admin/AdminNav.astro`, `src/components/admin/AdminShell.astro`, `src/scripts/admin-panel.ts`
- Test: `tests/admin-foundation-i18n.test.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 2, 6, 7.
- Produces:
  - `formatDateTime(ts: number, lang: 'en' | 'tr'): string`
  - `loadHealth(deps: { t; tf; lang }): Promise<void>`
  - `setupConnections(deps)` and `loadConnections()`
  - `setupAudit(deps)` and `loadAudit(more?: boolean)`

- [ ] **Step 1: Write the failing i18n test** `tests/admin-foundation-i18n.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ui } from '../src/i18n/ui';

const PREFIXES = ['admin.connections.', 'admin.audit.', 'admin.health.'];
const keys = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => PREFIXES.some((p) => k.startsWith(p)));

test('every new admin key exists in both languages', () => {
  assert.deepEqual(keys('en').sort(), keys('tr').sort());
  assert.ok(keys('en').length > 30);
});

test('every key the new scripts look up exists', () => {
  const used = new Set<string>();
  for (const f of ['admin-health', 'admin-connections', 'admin-audit', 'admin-panel']) {
    const src = readFileSync(new URL(`../src/scripts/${f}.ts`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/'((?:admin\.(?:connections|audit|health|badge\.social|action\.(?:make|remove)Social)[\w.]*))'/g)) used.add(m[1]);
  }
  for (const k of used) {
    assert.ok(k in ui.en, `en missing ${k}`);
    assert.ok(k in ui.tr, `tr missing ${k}`);
  }
});

test('each connection error code the callback can send has a sentence', () => {
  for (const code of ['bad_state', 'not_admin', 'cancelled', 'token_exchange', 'no_refresh_token', 'missing_scope', 'wrong_account', 'unknown']) {
    assert.ok(`admin.connections.error.${code}` in ui.en, code);
    assert.ok(`admin.connections.error.${code}` in ui.tr, code);
  }
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --import tsx --test tests/admin-foundation-i18n.test.ts`
Expected: FAIL, `keys('en').length > 30` is false.

- [ ] **Step 3: Add the keys to `src/i18n/ui.ts`.** In the `en` block, after `'admin.symposium.heading': 'Symposium',`:

```ts
    'admin.badge.social': 'Social editor',
    'admin.badge.socialPublisher': 'Social publisher',
    'admin.action.makeSocial': 'Make social editor',
    'admin.action.removeSocial': 'Remove social roles',
    'admin.action.makeSocialPublisher': 'Make social publisher',
    'admin.action.removeSocialPublisher': 'Remove publisher (stays editor)',
    'admin.connections.heading': 'Connections',
    'admin.connections.intro': 'Every account the site talks to. Each row says what is wrong and how to fix it, without code.',
    'admin.connections.col.account': 'Account',
    'admin.connections.col.status': 'Status',
    'admin.connections.col.connectedBy': 'Connected by',
    'admin.connections.col.lastOk': 'Last worked',
    'admin.connections.platform.gmail': 'Gmail',
    'admin.connections.platform.instagram': 'Instagram',
    'admin.connections.platform.linkedin': 'LinkedIn',
    'admin.connections.platform.x': 'X',
    'admin.connections.status.connected': 'Connected',
    'admin.connections.status.expiring': 'Expires soon',
    'admin.connections.status.broken': 'Broken',
    'admin.connections.status.unused': 'Not connected',
    'admin.connections.legacy': 'Using the token set by hand in Cloudflare. Reconnect once to manage it here.',
    'admin.connections.connect': 'Connect',
    'admin.connections.reconnect': 'Reconnect',
    'admin.connections.disconnect': 'Disconnect',
    'admin.connections.disconnectConfirm': 'Click again to disconnect',
    'admin.connections.later': 'Comes in a later phase',
    'admin.connections.loadFailed': 'Could not load connections.',
    'admin.connections.disconnectFailed': 'Could not disconnect.',
    'admin.connections.connected': '{platform} connected.',
    'admin.connections.error.bad_state': 'That connection link expired or was already used. Start again from Connections.',
    'admin.connections.error.not_admin': 'Only the admin who started the connection can finish it.',
    'admin.connections.error.cancelled': 'The connection was cancelled at Google. Nothing changed.',
    'admin.connections.error.token_exchange': 'Google did not accept the sign-in. Try again in a minute.',
    'admin.connections.error.no_refresh_token': 'Google did not grant lasting access. Try again and approve every permission.',
    'admin.connections.error.missing_scope': 'Not every permission was approved. Try again and tick all of them.',
    'admin.connections.error.wrong_account': 'That was a different Google account. Sign in as the RSG mail account. The existing connection is unchanged.',
    'admin.connections.error.unknown': 'The connection did not complete. Nothing changed.',
    'admin.health.connection.broken': '{platform} connection is broken.',
    'admin.health.connection.expiring': '{platform} connection expires on {date}.',
    'admin.health.effect.gmail': 'Site mail, reply sync and email notifications have stopped.',
    'admin.health.effect.social': 'Posts to it are waiting.',
    'admin.health.scheduler': 'The scheduler has not run since {time}. Scheduled mail is not going out.',
    'admin.health.schedulerNever': 'The scheduler has never run. Scheduled mail is not going out.',
    'admin.health.fix': 'Fix',
    'admin.health.adminCanFix': 'An admin can fix this from Connections.',
    'admin.health.howTo': 'How to fix',
    'admin.audit.heading': 'Log',
    'admin.audit.intro': 'Every change and every panel view, kept for a year. Entries cannot be edited or deleted here.',
    'admin.audit.filter.user': 'Person (email)',
    'admin.audit.filter.action': 'Action',
    'admin.audit.filter.from': 'From',
    'admin.audit.filter.to': 'To',
    'admin.audit.apply': 'Filter',
    'admin.audit.more': 'Older entries',
    'admin.audit.col.time': 'Time',
    'admin.audit.col.person': 'Person',
    'admin.audit.col.action': 'Action',
    'admin.audit.col.target': 'Target',
    'admin.audit.col.details': 'Details',
    'admin.audit.system': 'System',
    'admin.audit.empty': 'No entries match.',
    'admin.audit.loadFailed': 'Could not load the log.',
    'admin.audit.exportCsv': 'Export CSV',
    'admin.audit.exportJson': 'Export JSON',
    'admin.audit.verify': 'Verify integrity',
    'admin.audit.verifyOk': 'Intact: {count} entries checked.',
    'admin.audit.verifyPruned': 'Entries older than a year were removed on schedule; the check starts after them.',
    'admin.audit.verifyBroken': 'Broken at entry #{seq}: an entry was changed or removed outside the panel.',
```

In the `tr` block, after `'admin.symposium.heading': 'Sempozyum',`:

```ts
    'admin.badge.social': 'Sosyal medya editörü',
    'admin.badge.socialPublisher': 'Sosyal medya yayıncısı',
    'admin.action.makeSocial': 'Sosyal medya editörü yap',
    'admin.action.removeSocial': 'Sosyal medya rollerini kaldır',
    'admin.action.makeSocialPublisher': 'Sosyal medya yayıncısı yap',
    'admin.action.removeSocialPublisher': 'Yayıncılığı kaldır (editör kalır)',
    'admin.connections.heading': 'Bağlantılar',
    'admin.connections.intro': 'Sitenin dışarıyla konuştuğu her hesap. Her satır neyin bozuk olduğunu ve kod yazmadan nasıl düzeltileceğini söyler.',
    'admin.connections.col.account': 'Hesap',
    'admin.connections.col.status': 'Durum',
    'admin.connections.col.connectedBy': 'Bağlayan',
    'admin.connections.col.lastOk': 'Son çalıştığı an',
    'admin.connections.platform.gmail': 'Gmail',
    'admin.connections.platform.instagram': 'Instagram',
    'admin.connections.platform.linkedin': 'LinkedIn',
    'admin.connections.platform.x': 'X',
    'admin.connections.status.connected': 'Bağlı',
    'admin.connections.status.expiring': 'Yakında dolacak',
    'admin.connections.status.broken': 'Kopuk',
    'admin.connections.status.unused': 'Bağlı değil',
    'admin.connections.legacy': "Cloudflare'a elle girilmiş token kullanılıyor. Buradan yönetmek için bir kez yeniden bağla.",
    'admin.connections.connect': 'Bağla',
    'admin.connections.reconnect': 'Yeniden bağla',
    'admin.connections.disconnect': 'Bağlantıyı kes',
    'admin.connections.disconnectConfirm': 'Kesmek için tekrar tıkla',
    'admin.connections.later': 'Sonraki aşamada gelecek',
    'admin.connections.loadFailed': 'Bağlantılar yüklenemedi.',
    'admin.connections.disconnectFailed': 'Bağlantı kesilemedi.',
    'admin.connections.connected': '{platform} bağlandı.',
    'admin.connections.error.bad_state': "Bağlantı linkinin süresi doldu ya da zaten kullanıldı. Bağlantılar'dan yeniden başla.",
    'admin.connections.error.not_admin': 'Bağlantıyı yalnızca başlatan admin tamamlayabilir.',
    'admin.connections.error.cancelled': "Bağlantı Google'da iptal edildi. Hiçbir şey değişmedi.",
    'admin.connections.error.token_exchange': 'Google girişi kabul etmedi. Bir dakika sonra tekrar dene.',
    'admin.connections.error.no_refresh_token': 'Google kalıcı erişim vermedi. Tekrar dene ve bütün izinleri onayla.',
    'admin.connections.error.missing_scope': 'İzinlerin hepsi onaylanmadı. Tekrar dene ve hepsini işaretle.',
    'admin.connections.error.wrong_account': 'Bu başka bir Google hesabıydı. RSG mail hesabıyla giriş yap. Mevcut bağlantı değişmedi.',
    'admin.connections.error.unknown': 'Bağlantı tamamlanmadı. Hiçbir şey değişmedi.',
    'admin.health.connection.broken': '{platform} bağlantısı kopuk.',
    'admin.health.connection.expiring': '{platform} bağlantısı {date} tarihinde dolacak.',
    'admin.health.effect.gmail': 'Site e-postaları, yanıt takibi ve e-posta bildirimleri durdu.',
    'admin.health.effect.social': 'Oraya gidecek gönderiler bekliyor.',
    'admin.health.scheduler': 'Zamanlayıcı {time} tarihinden beri çalışmadı. Zamanlanmış e-postalar gitmiyor.',
    'admin.health.schedulerNever': 'Zamanlayıcı hiç çalışmadı. Zamanlanmış e-postalar gitmiyor.',
    'admin.health.fix': 'Düzelt',
    'admin.health.adminCanFix': "Bir admin bunu Bağlantılar'dan düzeltebilir.",
    'admin.health.howTo': 'Nasıl düzeltilir',
    'admin.audit.heading': 'Kayıtlar',
    'admin.audit.intro': 'Her değişiklik ve panelde açılan her sayfa, bir yıl tutulur. Kayıtlar buradan değiştirilemez ya da silinemez.',
    'admin.audit.filter.user': 'Kişi (e-posta)',
    'admin.audit.filter.action': 'İşlem',
    'admin.audit.filter.from': 'Başlangıç',
    'admin.audit.filter.to': 'Bitiş',
    'admin.audit.apply': 'Filtrele',
    'admin.audit.more': 'Daha eski kayıtlar',
    'admin.audit.col.time': 'Zaman',
    'admin.audit.col.person': 'Kişi',
    'admin.audit.col.action': 'İşlem',
    'admin.audit.col.target': 'Hedef',
    'admin.audit.col.details': 'Ayrıntı',
    'admin.audit.system': 'Sistem',
    'admin.audit.empty': 'Eşleşen kayıt yok.',
    'admin.audit.loadFailed': 'Kayıtlar yüklenemedi.',
    'admin.audit.exportCsv': 'CSV indir',
    'admin.audit.exportJson': 'JSON indir',
    'admin.audit.verify': 'Bütünlüğü doğrula',
    'admin.audit.verifyOk': 'Sağlam: {count} kayıt kontrol edildi.',
    'admin.audit.verifyPruned': 'Bir yıldan eski kayıtlar planlı olarak silindi; kontrol onlardan sonra başlıyor.',
    'admin.audit.verifyBroken': '#{seq} numaralı kayıtta kırık: bir kayıt panel dışından değiştirilmiş ya da silinmiş.',
```

- [ ] **Step 4: `src/scripts/format-time.ts`**

```ts
/** Date and time in Istanbul, for log entries and the banner, where the hour matters. */
export function formatDateTime(ts: number, lang: 'en' | 'tr'): string {
  return new Date(ts * 1000).toLocaleString(lang === 'en' ? 'en-GB' : 'tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
}
```

- [ ] **Step 5: `src/scripts/admin-health.ts`**

```ts
/**
 * The status banner above every admin pane. Says what is broken, what that
 * stops, and either offers the fix (admins) or says who can fix it.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';

export interface HealthDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  lang: 'en' | 'tr';
}

type Issue =
  | { kind: 'connection'; platform: string; status: 'expiring' | 'broken'; expiresAt: number | null; lastError: string | null }
  | { kind: 'scheduler'; lastRunAt: number | null };

const RUNBOOK = 'https://github.com/RSG-Turkiye/website#connections-and-the-status-banner';

function message(i: Issue, d: HealthDeps): string {
  if (i.kind === 'scheduler') {
    return i.lastRunAt ? d.tf('admin.health.scheduler', { time: formatDateTime(i.lastRunAt, d.lang) }) : d.t('admin.health.schedulerNever');
  }
  const platform = d.t(`admin.connections.platform.${i.platform}`);
  if (i.status === 'expiring') {
    return d.tf('admin.health.connection.expiring', { platform, date: i.expiresAt ? formatDateTime(i.expiresAt, d.lang) : '' });
  }
  const effect = d.t(i.platform === 'gmail' ? 'admin.health.effect.gmail' : 'admin.health.effect.social');
  return `${d.tf('admin.health.connection.broken', { platform })} ${effect}`;
}

function action(i: Issue, canFix: boolean, d: HealthDeps): string {
  if (i.kind === 'scheduler') {
    return `<a href="${RUNBOOK}" target="_blank" rel="noopener" class="shrink-0 text-xs font-medium underline">${escapeHtml(d.t('admin.health.howTo'))}</a>`;
  }
  return canFix
    ? `<button type="button" data-fix class="shrink-0 px-3 py-1 rounded-lg bg-red text-white text-xs font-semibold hover:bg-red-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${escapeHtml(d.t('admin.health.fix'))}</button>`
    : `<span class="shrink-0 text-xs">${escapeHtml(d.t('admin.health.adminCanFix'))}</span>`;
}

export async function loadHealth(d: HealthDeps): Promise<void> {
  const el = document.getElementById('healthBanner');
  if (!el) return;
  let data: { issues: Issue[]; canFix: boolean };
  try {
    const res = await fetch('/api/admin/health');
    if (!res.ok) return;
    data = await res.json();
  } catch {
    return;
  }
  if (data.issues.length === 0) {
    el.classList.add('hidden');
    el.replaceChildren();
    return;
  }
  el.innerHTML = data.issues
    .map((i) => `<div class="flex items-center justify-between gap-3 py-1.5"><span>⚠ ${escapeHtml(message(i, d))}</span>${action(i, data.canFix, d)}</div>`)
    .join('');
  el.classList.remove('hidden');
  el.querySelectorAll<HTMLButtonElement>('[data-fix]').forEach((b) =>
    b.addEventListener('click', () => document.querySelector<HTMLButtonElement>('.admin-nav-item[data-target="connections"]')?.click()),
  );
}
```

- [ ] **Step 6: `src/scripts/admin-connections.ts`**

```ts
/**
 * The Connections pane (admins only). One row per platform; Gmail is the only
 * one that can be connected in this phase. Reconnect is a plain link: the
 * browser goes to /api/admin/connections/gmail/start and on to Google, and
 * comes back to /admin?connected=gmail.
 */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';

export interface ConnDeps {
  t: (key: string) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
}

type Conn = {
  platform: 'gmail' | 'instagram' | 'linkedin' | 'x';
  status: 'connected' | 'expiring' | 'broken' | 'unused';
  accountName: string | null;
  connectedBy: string | null;
  connectedAt: number | null;
  lastOkAt: number | null;
  lastError: string | null;
  usesLegacySecret: boolean;
  hasStoredToken: boolean;
};

const STATUS_CLASS: Record<Conn['status'], string> = {
  connected: 'text-green-700', expiring: 'text-amber-700', broken: 'text-red-600', unused: 'text-gray-500',
};
const BUTTON = 'inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid';

let deps: ConnDeps;

export function setupConnections(d: ConnDeps): void {
  deps = d;
}

function actions(c: Conn): string {
  if (c.platform !== 'gmail') return `<span class="text-xs text-gray-500">${escapeHtml(deps.t('admin.connections.later'))}</span>`;
  const urgent = c.status === 'broken' || c.status === 'expiring';
  const label = deps.t(c.status === 'unused' ? 'admin.connections.connect' : 'admin.connections.reconnect');
  const connect = `<a href="/api/admin/connections/gmail/start?lang=${deps.lang}" class="${BUTTON} ${urgent ? 'bg-red text-white hover:bg-red-hover' : 'border border-navy text-navy hover:bg-navy-light'}">${escapeHtml(label)}</a>`;
  const disconnect = c.hasStoredToken
    ? ` <button type="button" data-disconnect="${c.platform}" class="${BUTTON} text-gray-500 hover:text-red-600">${escapeHtml(deps.t('admin.connections.disconnect'))}</button>`
    : '';
  return connect + disconnect;
}

function row(c: Conn): string {
  const note = c.status === 'broken' && c.lastError ? c.lastError : c.usesLegacySecret ? deps.t('admin.connections.legacy') : '';
  return `<tr class="border-b border-border last:border-0">
    <td class="px-5 py-3"><p class="font-medium text-navy">${escapeHtml(deps.t(`admin.connections.platform.${c.platform}`))}</p><p class="text-xs text-gray-500">${escapeHtml(c.accountName ?? '')}</p></td>
    <td class="px-5 py-3"><span class="font-medium ${STATUS_CLASS[c.status]}">● ${escapeHtml(deps.t(`admin.connections.status.${c.status}`))}</span>${note ? `<p class="text-xs text-gray-500 mt-0.5 max-w-md">${escapeHtml(note)}</p>` : ''}</td>
    <td class="px-5 py-3 text-gray-500">${escapeHtml(c.connectedBy ?? '')}${c.connectedAt ? `<br><span class="text-xs">${escapeHtml(formatDateTime(c.connectedAt, deps.lang))}</span>` : ''}</td>
    <td class="px-5 py-3 text-gray-500">${c.lastOkAt ? escapeHtml(formatDateTime(c.lastOkAt, deps.lang)) : ''}</td>
    <td class="px-5 py-3 text-right whitespace-nowrap">${actions(c)}</td>
  </tr>`;
}

async function disconnect(button: HTMLButtonElement): Promise<void> {
  // Two clicks instead of window.confirm: the panel uses no browser dialogs.
  if (button.dataset.armed !== '1') {
    button.dataset.armed = '1';
    button.textContent = deps.t('admin.connections.disconnectConfirm');
    return;
  }
  button.disabled = true;
  const res = await fetch(`/api/admin/connections/${button.dataset.disconnect}`, { method: 'DELETE' });
  if (!res.ok) {
    deps.showToast(deps.t('admin.connections.disconnectFailed'), true);
    button.disabled = false;
    return;
  }
  await loadConnections();
}

export async function loadConnections(): Promise<void> {
  const body = document.getElementById('connectionsBody');
  if (!body) return;
  const res = await fetch('/api/admin/connections');
  if (!res.ok) {
    deps.showToast(deps.t('admin.connections.loadFailed'), true);
    return;
  }
  const { connections } = await res.json() as { connections: Conn[] };
  body.innerHTML = connections.map(row).join('');
  body.querySelectorAll<HTMLButtonElement>('[data-disconnect]').forEach((b) => b.addEventListener('click', () => void disconnect(b)));
}
```

- [ ] **Step 7: `src/scripts/admin-audit.ts`**

```ts
/** The Log pane (admins only): filter, page back, export, verify. */
import { escapeHtml } from './escape-html';
import { formatDateTime } from './format-time';

export interface AuditDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  lang: 'en' | 'tr';
}

type Row = { seq: number; at: number; user_email: string | null; action: string; target_type: string | null; target_id: string | null; details: string };

let deps: AuditDeps;
let oldestSeq: number | null = null;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Date inputs are days in Türkiye time; the API wants unix seconds. */
function dayStart(value: string): number | null {
  return value ? Math.floor(new Date(`${value}T00:00:00+03:00`).getTime() / 1000) : null;
}

function filters(): URLSearchParams {
  const q = new URLSearchParams();
  const user = $<HTMLInputElement>('auditUser').value.trim();
  const action = $<HTMLInputElement>('auditAction').value.trim();
  const from = dayStart($<HTMLInputElement>('auditFrom').value);
  const toStart = dayStart($<HTMLInputElement>('auditTo').value);
  if (user) q.set('user', user);
  if (action) q.set('action', action);
  if (from !== null) q.set('from', String(from));
  if (toStart !== null) q.set('to', String(toStart + 86399));
  return q;
}

function row(r: Row): string {
  const target = [r.target_type, r.target_id].filter(Boolean).join(': ');
  return `<tr class="border-b border-border last:border-0 align-top">
    <td class="px-4 py-2 whitespace-nowrap text-gray-500">${escapeHtml(formatDateTime(r.at, deps.lang))}</td>
    <td class="px-4 py-2">${escapeHtml(r.user_email ?? deps.t('admin.audit.system'))}</td>
    <td class="px-4 py-2"><code class="text-xs">${escapeHtml(r.action)}</code></td>
    <td class="px-4 py-2 text-xs text-gray-500">${escapeHtml(target)}</td>
    <td class="px-4 py-2 text-xs text-gray-500 break-all">${r.details === '{}' ? '' : escapeHtml(r.details)}</td>
  </tr>`;
}

export async function loadAudit(more = false): Promise<void> {
  const q = filters();
  if (more && oldestSeq !== null) q.set('before', String(oldestSeq));
  const res = await fetch(`/api/admin/audit?${q}`);
  if (!res.ok) {
    deps.showToast(deps.t('admin.audit.loadFailed'), true);
    return;
  }
  const { rows, hasMore } = await res.json() as { rows: Row[]; hasMore: boolean };
  const body = $('auditBody');
  const html = rows.map(row).join('');
  if (more) body.insertAdjacentHTML('beforeend', html);
  else body.innerHTML = html || `<tr><td colspan="5" class="px-4 py-6 text-center text-gray-500">${escapeHtml(deps.t('admin.audit.empty'))}</td></tr>`;
  if (rows.length) oldestSeq = rows[rows.length - 1].seq;
  $('auditMore').classList.toggle('hidden', !hasMore);
}

async function verify(): Promise<void> {
  const button = $<HTMLButtonElement>('auditVerify');
  const out = $('auditVerifyResult');
  button.disabled = true;
  try {
    const res = await fetch('/api/admin/audit/verify', { method: 'POST' });
    const r = await res.json() as { ok: boolean; checked: number; anchoredAfterPrune?: boolean; brokenAt?: number };
    out.textContent = r.ok
      ? `${deps.tf('admin.audit.verifyOk', { count: r.checked })}${r.anchoredAfterPrune ? ` ${deps.t('admin.audit.verifyPruned')}` : ''}`
      : deps.tf('admin.audit.verifyBroken', { seq: r.brokenAt ?? '?' });
    out.className = `text-sm mt-2 ${r.ok ? 'text-green-700' : 'text-red-600 font-semibold'}`;
  } finally {
    button.disabled = false;
  }
}

export function setupAudit(d: AuditDeps): void {
  deps = d;
  $('auditFilter').addEventListener('submit', (e) => {
    e.preventDefault();
    oldestSeq = null;
    void loadAudit();
  });
  $('auditMore').addEventListener('click', () => void loadAudit(true));
  $('auditExportCsv').addEventListener('click', () => { const q = filters(); q.set('format', 'csv'); location.href = `/api/admin/audit/export?${q}`; });
  $('auditExportJson').addEventListener('click', () => { const q = filters(); q.set('format', 'json'); location.href = `/api/admin/audit/export?${q}`; });
  $('auditVerify').addEventListener('click', () => void verify());
}
```

- [ ] **Step 8: Nav and shell.** In `src/components/admin/AdminNav.astro`, add two top-level items after `symposium`:

```ts
  { pane: 'connections',   label: t('admin.connections.heading') },
  { pane: 'audit',         label: t('admin.audit.heading') },
```

In `src/components/admin/AdminShell.astro`, insert the banner right after the `<!-- Toast -->` div:

```astro
        <div id="healthBanner" role="status" class="hidden mb-6 rounded-2xl border border-red-200 bg-red-tint px-4 py-2 text-sm text-[#8a1c1c]"></div>
```

Then, after the `<div data-pane="mail-sent">...</div>` block (still inside the panes column), add:

```astro
        <div data-pane="connections">
          <h2 class="text-lg font-semibold text-navy mb-1">{t('admin.connections.heading')}</h2>
          <p class="text-sm text-gray-500 mb-4">{t('admin.connections.intro')}</p>
          <div class="bg-white rounded-2xl border border-border overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-[#F7F7F6]">
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.connections.col.account')}</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.connections.col.status')}</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.connections.col.connectedBy')}</th>
                  <th class="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.connections.col.lastOk')}</th>
                  <th class="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody id="connectionsBody"></tbody>
            </table>
          </div>
        </div>

        <div data-pane="audit">
          <h2 class="text-lg font-semibold text-navy mb-1">{t('admin.audit.heading')}</h2>
          <p class="text-sm text-gray-500 mb-4">{t('admin.audit.intro')}</p>
          <form id="auditFilter" class="bg-white rounded-2xl border border-border p-4 mb-4 flex flex-wrap items-end gap-3">
            <label class="text-xs text-gray-500">{t('admin.audit.filter.user')}<input id="auditUser" type="text" class="block mt-1 px-3 py-2 rounded-xl border border-border text-sm text-navy" /></label>
            <label class="text-xs text-gray-500">{t('admin.audit.filter.action')}<input id="auditAction" type="text" class="block mt-1 px-3 py-2 rounded-xl border border-border text-sm text-navy" /></label>
            <label class="text-xs text-gray-500">{t('admin.audit.filter.from')}<input id="auditFrom" type="date" class="block mt-1 px-3 py-2 rounded-xl border border-border text-sm text-navy" /></label>
            <label class="text-xs text-gray-500">{t('admin.audit.filter.to')}<input id="auditTo" type="date" class="block mt-1 px-3 py-2 rounded-xl border border-border text-sm text-navy" /></label>
            <button type="submit" class="px-4 py-2 rounded-xl bg-navy text-white text-sm font-medium">{t('admin.audit.apply')}</button>
            <span class="flex-1"></span>
            <button type="button" id="auditExportCsv" class="px-4 py-2 rounded-xl border border-navy text-navy text-sm font-medium">{t('admin.audit.exportCsv')}</button>
            <button type="button" id="auditExportJson" class="px-4 py-2 rounded-xl border border-navy text-navy text-sm font-medium">{t('admin.audit.exportJson')}</button>
            <button type="button" id="auditVerify" class="px-4 py-2 rounded-xl border border-navy text-navy text-sm font-medium">{t('admin.audit.verify')}</button>
          </form>
          <p id="auditVerifyResult" class="text-sm"></p>
          <div class="bg-white rounded-2xl border border-border overflow-x-auto mt-2">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border bg-[#F7F7F6]">
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.audit.col.time')}</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.audit.col.person')}</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.audit.col.action')}</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.audit.col.target')}</th>
                  <th class="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('admin.audit.col.details')}</th>
                </tr>
              </thead>
              <tbody id="auditBody"></tbody>
            </table>
          </div>
          <button type="button" id="auditMore" class="hidden mt-3 px-4 py-2 rounded-xl border border-border text-sm text-navy">{t('admin.audit.more')}</button>
        </div>
```

- [ ] **Step 9: `src/scripts/admin-panel.ts`.** Make these changes:

1. **Imports.** Next to `setupCertificates`:

   ```ts
   import { loadHealth } from './admin-health';
   import { setupConnections, loadConnections } from './admin-connections';
   import { setupAudit, loadAudit } from './admin-audit';
   ```

2. **Users table badges.** After the `symposiumBadge` constant (~line 261):

   ```ts
       const socialBadge = u.is_social_publisher
         ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.socialPublisher')}</span>`
         : u.is_social
           ? `<span class="ml-1 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-navy-light text-navy">${t('admin.badge.social')}</span>`
           : '';
   ```

   Add `${socialBadge}` after `${symposiumBadge}` in the badges cell (~line 333).

3. **Users table actions.** After the `make_symposium` / `remove_symposium` button block (~line 314), add:

   ```ts
             ${u.is_social_publisher
               ? `<button data-id="${u.id}" data-action="remove_social_publisher" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSocialPublisher')}</button>`
               : `<button data-id="${u.id}" data-action="make_social_publisher" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSocialPublisher')}</button>`}
             ${u.is_social || u.is_social_publisher
               ? `<button data-id="${u.id}" data-action="remove_social" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.removeSocial')}</button>`
               : `<button data-id="${u.id}" data-action="make_social" class="action-btn block w-full text-left px-4 py-2 text-xs text-gray-600 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid">${t('admin.action.makeSocial')}</button>`}
   ```

   If the user list declares a row type with `is_symposium`, add `is_social: number; is_social_publisher: number;` beside it.

4. **`applyRoleVisibility`:**
   - Change the signature to `function applyRoleVisibility(roles: { isFullAdmin: boolean; isAnnouncer: boolean; isSymposium: boolean }, preferred?: string): void`.
   - Add `'connections', 'audit'` to the full-admin list.
   - Replace `setupPaneSwitching(allowed[0]);` with `setupPaneSwitching(preferred && allowed.includes(preferred) ? preferred : allowed[0]);`.

5. **`setupPaneSwitching`.** At the end of `show(target)`, after the `items.forEach`, add:

   ```ts
       // The audit log records which panes each person opened (spec §6).
       // keepalive so a view right before leaving the page is still sent.
       void fetch('/api/audit/view', {
         method: 'POST', headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ pane: target }), keepalive: true,
       }).catch(() => {});
   ```

6. **Bootstrap.** Replace `applyRoleVisibility({ isFullAdmin, isAnnouncer, isSymposium });` with:

   ```ts
     // Back from a Gmail reconnect: open Connections and say how it went.
     const params = new URLSearchParams(location.search);
     const connected = params.get('connected');
     const connectionError = params.get('connection_error');
     applyRoleVisibility({ isFullAdmin, isAnnouncer, isSymposium }, connected || connectionError ? 'connections' : undefined);
     void loadHealth({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, lang });
   ```

   After the `if (isFullAdmin) { setupBulkGrant(); ... }` block, add:

   ```ts
     if (isFullAdmin) {
       setupConnections({ t: t as (k: string) => string, showToast, lang });
       setupAudit({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, showToast, lang });
       await Promise.all([loadConnections(), loadAudit()]);
     }
     if (connected || connectionError) {
       const known = ['bad_state', 'not_admin', 'cancelled', 'token_exchange', 'no_refresh_token', 'missing_scope', 'wrong_account'];
       if (connected) showToast(tf('admin.connections.connected', { platform: t(`admin.connections.platform.${connected}` as never) }));
       else showToast(t(`admin.connections.error.${known.includes(connectionError!) ? connectionError : 'unknown'}` as never), true);
       history.replaceState(null, '', location.pathname);
     }
   ```

- [ ] **Step 10: Run the tests and the build**

Run: `npm test && npm run build`
Expected: all tests PASS (including `inline-scripts`, `no-em-dashes`, `contrast` and the new i18n test) and the build completes. If `contrast-rendered.test.ts` flags the banner text `#8a1c1c` on `bg-red-tint`, use `text-red` instead. Its ratio on `#FDEAEA` is above 4.5:1.

- [ ] **Step 11: Commit**

```bash
git add src tests/admin-foundation-i18n.test.ts
git commit -m "Admin panel: status banner, Connections and Log panes, social roles, pane views"
```

---

### Task 10: Runbook, deploy, and live verification

**Files:**
- Modify: `README.md`
- No new tests; verification is manual and signed-in.

- [ ] **Step 1: README.** Add a section `## Connections and the status banner` (the anchor the banner links to) containing:

- **What each banner line means and what fixes it.**
  - Gmail broken: Connections → Reconnect, signed in as `turkey.rsg@gmail.com`.
  - Scheduler not running: in Cloudflare → Workers → `rsg-mail-cron`, check its cron trigger is enabled and its last invocations. If it was deleted, run `cd workers/mail-cron && npx wrangler deploy`.
- **One-time setup:**
  1. Generate and set the vault key: `openssl rand -base64 32 | npx wrangler pages secret put TOKEN_ENC_KEY --project-name website`. Store the value in the organisation's password manager. If it is lost, every stored token must be reconnected, but mail falls back to `GMAIL_REFRESH_TOKEN` meanwhile.
  2. In Google Cloud → APIs & Services → Credentials → the OAuth client, add the authorised redirect URI `https://rsg-turkiye.iscbsc.org/api/admin/connections/gmail/callback`. Under Data access, make sure `openid` and `.../auth/userinfo.email` are listed next to `gmail.send` and `gmail.readonly`.
  3. Apply migrations 8a, 8b and 8c from the top of `db/schema.sql`.
  4. Redeploy the daily Worker so it picks up `AUDIT_PRUNE_URL`: `cd workers/symposium-cron && npx wrangler deploy`.
- **`## Yearly handover` checklist:**
  - After changing the Gmail password: admin panel → Connections → Gmail → Reconnect.
  - Grant the incoming team their roles in Members; remove the outgoing team's.
  - Make sure at least two people are admins.
  - Export the Log (JSON) and keep it with the year's records.

- [ ] **Step 2: Commit the docs**

```bash
git add README.md
git commit -m "README: connections runbook and the yearly handover checklist"
```

- [ ] **Step 3: Open the PR.** Push the branch and open a PR to `main` titled "Social panel phase 1: audit log, connections, Gmail reconnect, status banner". The body lists the operator steps from Step 1 in order, and states that migrations run before merge.

- [ ] **Step 4: Operator steps, with the user.** These are production changes; run each only after the user says go.
  1. Set `TOKEN_ENC_KEY`.
  2. Add the redirect URI in Google Cloud. The user does this in their browser.
  3. Apply 8a, 8b, 8c.
  4. Merge.
  5. Redeploy `symposium-cron`.

- [ ] **Step 5: Live verification** (signed in as an admin, in a browser; see memory "verify auth UI in a browser"):
  1. `/admin` loads. No banner should show, since Gmail works on the legacy secret and the scheduler ran within 10 minutes. Connections lists Gmail as "Connected" with the legacy note, and the other three as "Not connected / Comes in a later phase".
  2. Gmail → Reconnect → Google consent as `turkey.rsg@gmail.com` → back on `/admin` with the "Gmail connected." toast. The row now shows the account and "Connected by". The legacy note is gone.
  3. Send one test mail from `/account/mail` to the user's own address; it arrives.
  4. Log shows `connection.start`, `connection.connect`, `view.pane` rows, and the test mail's sender in the right order. Verify integrity says "Intact". Export CSV and JSON both download.
  5. In Members, make a test account a social publisher; the badge appears, and the Log shows `role.change` with the email.
  6. `/tr/admin` shows the same in Turkish.
  7. Signed in as a symposium-only account, the banner endpoint works and the Connections and Log panes are absent.
