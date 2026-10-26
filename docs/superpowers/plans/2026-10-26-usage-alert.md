# Free-Tier Usage Alert Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** E-mail the site admins once when today's (UTC) Workers requests, D1 rows read or D1 rows written pass 70% and again at 90% of the free plan, and show today's usage (plus the agents' requests and writes) on the admin Overview "System" card.

**Architecture:** An hourly check rides the existing mail tick (`functions/api/mail/dispatch.ts`, the `isPruneTick` block, driven by `workers/mail-cron`). It asks Cloudflare's GraphQL Analytics API for today's three numbers in one request, stores them in a one-row D1 table `usage_state`, and mails the admins through the existing system-mail path (`notifyEach` + `adminEmails` in `functions/_lib/social-notify.ts`) when a threshold is newly crossed. `/api/admin/health` reads that row (never GraphQL) plus today's `agent_counters` sums, and `src/scripts/admin-health.ts` renders them in Overview's System block.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1, Cloudflare GraphQL Analytics API, `node --test` with `tsx`, `node:sqlite` via `tests/lib/d1-sqlite.ts`.

**Spec:** No separate spec file. The owner's decisions (in the task request of 2026-10-26) are restated verbatim-in-substance in Global Constraints below; the executor reads this plan alone.

## Global Constraints

- Free limits, per account, reset 00:00 UTC: Workers + Pages Functions **100,000 requests/day**; D1 **5,000,000 rows read/day** and **100,000 rows written/day**.
- Alert thresholds: **70%** and **90%** of each limit, per metric. Controller call: a value counts as passed when `value >= limit * threshold / 100`.
- At most **one alert per metric per threshold per UTC day**. No repeats, no alert storm.
- Alerts go by e-mail to the site admins (`users.is_admin = 1`) via `notifyEach(env, await adminEmails(env.DB), message)`; never `sendAndLog`. Body Turkish first, then English, as in `functions/_lib/social-notify.ts`.
- The check runs **hourly** on the existing cron path (`isPruneTick(now)` in `functions/api/mail/dispatch.ts`). No new Worker, no new cron, no GitHub `schedule:`. It never runs on the other 59 ticks.
- The check's own D1 cost per run: **1 row read + 1 row written**; on an alert run add the claim and audit row (see Task 3). Write the counts in code comments.
- If `CF_ANALYTICS_TOKEN` or `CF_ACCOUNT_ID` is missing, or the GraphQL call fails: no mail; the Overview card says so.
- Secrets: reuse the existing Pages secret `CF_ANALYTICS_TOKEN` (permission **Account → Account Analytics → Read**) and the var `CF_ACCOUNT_ID` in `wrangler.toml`. No code, test or doc contains a real token value. Controller call: no new token. The Statistics section already reads Cloudflare's GraphQL API with exactly this token and permission (README, Statistics, step 3), and Account Analytics: Read is the permission the D1 query of 2026-10-18 worked with; the check runs in the Pages Function, so no Worker secret either.
- Agent figures on the card: requests `sum(general + reserve)` against `AGENT_BUDGET` (15,000) and writes `sum(writes + submits + uploads)` against `AGENT_WRITE_BUDGET` (2,000), today's token rows of `agent_counters`. Agents do not trigger alerts.
- UI stays plain (design pass later): text lines, no tiles, no progress bars, no emoji. Every string in `src/i18n/ui.ts`, en and tr, keys under `admin.health.usage.`, written as **literal** keys in `src/scripts/admin-health.ts` (the i18n test scans for literals). No em dashes in strings (`tests/no-em-dashes.test.ts`).
- Rule 9: the alert writes an audit row, `action: 'usage.alert'` written literally, with a label in `src/lib/audit-labels.ts`.
- Schema change: `CREATE TABLE IF NOT EXISTS` in `db/schema.sql` plus migration note **8m**. Code must tolerate the table being absent (no 500 from health, no failed tick).

## Review Focus

1. **D1 writes already blocked (over 100,000)**: the state write throws; the check must not send mail it cannot record, and the tick still answers 200. Tests in Task 3 (`D1 refusing writes mails nobody`) and Task 4 (`a usage check that throws does not fail the tick`).
2. **Gmail down when an alert fires**: the threshold is already claimed, so the next hour does not resend; the audit row still exists. Test in Task 3 (`mail failure does not resend next hour`).
3. **A dataset with no traffic yet today** (00:00 UTC hour, empty arrays): reads as 0, not as a failure. Test in Task 2 (`empty groups read as zero`).
4. **Token present but refused** (wrong permission, HTTP 200 with `errors`, or HTTP 401): stored as a failure with the message, earlier numbers kept, card says the check failed; non-admins never see the message. Tests in Task 2, Task 3 and Task 5.
5. **The cron misses the `:00` minute** (Cloudflare fires late): that hour is skipped. The card says "not checked since" after 3 hours. Test in Task 6 (`stale check is said`).

---

## File Structure

| File | Responsibility |
| --- | --- |
| `db/schema.sql` (modify) | Migration note 8m and the `usage_state` table. |
| `functions/_lib/usage.ts` (create) | Limits, thresholds, `utcDay`, `crossings`, `readUsage` (GraphQL), `readUsageState`, `checkUsage` (the hourly job). |
| `functions/_lib/usage-alert.ts` (create) | `usageAlertMessage`: the bilingual mail. Pure. |
| `functions/_lib/web-analytics.ts` (modify) | Export the existing `gql` helper for reuse. |
| `functions/_lib/agent-limits.ts` (modify) | `agentUsageToday`: today's agent sums (keeps `dayKey` private to this file). |
| `functions/api/mail/dispatch.ts` (modify) | Call `checkUsage` in the hourly block. |
| `functions/api/admin/health.ts` (modify) | Add `usage` to the response. |
| `src/scripts/admin-health.ts` (modify) | `usageHtml` (pure) and its place in `renderOverviewHealth`. |
| `src/i18n/ui.ts` (modify) | `admin.health.usage.*` in en and tr. |
| `src/lib/audit-labels.ts` (modify) | Label for `usage.alert`. |
| `README.md`, `CLAUDE.md`, `wrangler.toml` (modify) | One paragraph, one bullet, one comment line. |
| Tests (create) | `tests/usage.test.ts`, `tests/usage-check.test.ts`, `tests/usage-dispatch.test.ts`, `tests/usage-health.test.ts`, `tests/admin-health-usage.test.ts`. |

---

### Task 1: `usage_state` table and the pure core

**Files:**
- Modify: `db/schema.sql` (migration note after 8l, near line 375; table after `agent_counters`, end of file)
- Create: `functions/_lib/usage.ts`
- Test: `tests/usage.test.ts`, `tests/schema.test.ts` (add one case)

**Interfaces:**
- Produces:
  - `export const FREE_LIMITS = { requests: 100_000, rowsRead: 5_000_000, rowsWritten: 100_000 } as const`
  - `export type Metric = keyof typeof FREE_LIMITS`
  - `export const THRESHOLDS = [70, 90] as const; export type Threshold = typeof THRESHOLDS[number]`
  - `export type Usage = Record<Metric, number>`
  - `export type Crossing = { metric: Metric; threshold: Threshold; value: number; limit: number }`
  - `export function utcDay(now: number): string` (`'YYYY-MM-DD'`, UTC)
  - `export function crossings(usage: Usage, alerted: string[]): Crossing[]` (keys `'<metric>:<threshold>'`, e.g. `'rowsRead:70'`; order: metric in `FREE_LIMITS` order, then threshold ascending)

- [ ] **Step 1: Write the failing tests** in `tests/usage.test.ts`

```ts
test('utcDay is the UTC date, not Istanbul', () => {
  assert.equal(utcDay(Date.parse('2026-10-26T23:30:00Z') / 1000), '2026-10-26'); // 02:30 on the 27th in Türkiye
  assert.equal(utcDay(Date.parse('2026-10-27T00:00:00Z') / 1000), '2026-10-27');
});
test('a value at exactly 70% crosses; one below does not', () => {
  assert.deepEqual(crossings({ requests: 70_000, rowsRead: 3_499_999, rowsWritten: 0 }, []).map((c) => `${c.metric}:${c.threshold}`), ['requests:70']);
});
test('90% crosses both thresholds', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 0, rowsWritten: 95_000 }, []).map((c) => `${c.metric}:${c.threshold}`), ['rowsWritten:70', 'rowsWritten:90']);
});
test('already alerted pairs are left out', () => {
  assert.deepEqual(crossings({ requests: 95_000, rowsRead: 0, rowsWritten: 0 }, ['requests:70']).map((c) => c.threshold), [90]);
});
test('a crossing carries its value and limit', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 4_000_000, rowsWritten: 0 }, [])[0], { metric: 'rowsRead', threshold: 70, value: 4_000_000, limit: 5_000_000 });
});
```

In `tests/schema.test.ts` add:

```ts
test('usage_state is a single row looked up by its key', () => {
  const db = freshDatabase();
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM usage_state').get() as { n: number }).n, 1);
  const plan = (db.prepare('EXPLAIN QUERY PLAN SELECT * FROM usage_state WHERE id = 1').all() as { detail: string }[]).map((r) => r.detail);
  assert.ok(plan.every((d) => !/^SCAN /.test(d)), plan.join(' / '));
  assert.throws(() => db.prepare('INSERT INTO usage_state (id) VALUES (2)').run());
  db.close();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/usage.test.ts tests/schema.test.ts`
Expected: FAIL (`Cannot find module '../functions/_lib/usage'`, `no such table: usage_state`).

- [ ] **Step 3: Add the table and note 8m to `db/schema.sql`**

Controller call: one row, not one row per day, modelled on `mail_sync_state` (`id = 1`, no secondary index, so a write is one row and nothing needs pruning; the history of alerts is in the audit log):

```sql
-- Free-tier usage, measured hourly by the mail tick (functions/_lib/usage.ts).
-- One row. day/requests/rows_*: the last successful measurement (UTC day).
-- error: the last attempt's failure, NULL when it worked. alert_day/alerted:
-- which '<metric>:<threshold>' alerts went out on that UTC day (JSON list).
CREATE TABLE IF NOT EXISTS usage_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  checked_at    INTEGER,
  measured_at   INTEGER,
  day           TEXT,
  requests      INTEGER,
  rows_read     INTEGER,
  rows_written  INTEGER,
  error         TEXT,
  alert_day     TEXT,
  alerted       TEXT NOT NULL DEFAULT '[]'
);
INSERT OR IGNORE INTO usage_state (id) VALUES (1);
```

Note 8m, same style as 8l: new table, all `IF NOT EXISTS`/`OR IGNORE`, safe to repeat; run `wrangler d1 execute rsg-members --remote --file=db/schema.sql` before deploying; without it the hourly check logs `no such table: usage_state` and the card shows no usage, nothing else breaks.

- [ ] **Step 4: Implement the Task 1 exports in `functions/_lib/usage.ts`**

- [ ] **Step 5: Run to verify they pass**

Run: `node --import tsx --test tests/usage.test.ts tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql functions/_lib/usage.ts tests/usage.test.ts tests/schema.test.ts
git commit -m "Usage alert: usage_state table and threshold rules"
```

---

### Task 2: Read today's usage from the GraphQL Analytics API

**Files:**
- Modify: `functions/_lib/web-analytics.ts` (export `gql`, currently a private `async function gql<T>(env, query, variables, fetcher)` at about line 40; no other change). Controller call: reuse it rather than a second GraphQL client; it already handles `CF_GRAPHQL_URL` for local previews and turns `errors` into a throw.
- Modify: `functions/_lib/usage.ts`
- Test: `tests/usage.test.ts`

**Interfaces:**
- Consumes: `gql<T>(env: AnalyticsEnv, query: string, variables: Record<string, unknown>, fetcher: typeof fetch): Promise<T>` and `configured(env: AnalyticsEnv): boolean` from `web-analytics.ts`.
- Produces: `export async function readUsage(env: AnalyticsEnv, day: string, fetcher: typeof fetch = fetch): Promise<Usage>`. Throws on HTTP error, GraphQL `errors`, or no account in the answer.

The query (one request, three aliased datasets, all filtered by `date` only). Field names are from the account-scoped schema: `workersInvocationsAdaptive` sum `requests` (https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/), `pagesFunctionsInvocationsAdaptiveGroups` sum `requests` and filter `date` (dataset listed at https://developers.cloudflare.com/data-localization/metadata-boundary/graphql-datasets/; fields from the schema mirror https://pages.johnspurlock.com/graphql-schema-docs/cloudflare.html, type `AccountPagesFunctionsInvocationsAdaptiveGroupsSum`), `d1AnalyticsAdaptiveGroups` sum `rowsRead rowsWritten` (https://developers.cloudflare.com/d1/observability/metrics-analytics/):

```graphql
query ($account: string!, $day: Date!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workers: workersInvocationsAdaptive(limit: 1000, filter: { date: $day }) { sum { requests } }
    pages: pagesFunctionsInvocationsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { requests } }
    d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date: $day }) { sum { rowsRead rowsWritten } }
  } }
}
```

Controller call: `requests = sum(workers) + sum(pages)`. The 100,000 limit is per account and Pages Functions requests count toward it (https://developers.cloudflare.com/pages/functions/pricing/: "Requests to your Pages Functions count towards your quota for the Workers Free plan"). If Pages Functions also appear in `workersInvocationsAdaptive`, this double-counts, which alerts early rather than late; see Open questions.

Controller call: `limit: 1000` and no `dimensions`, so each dataset answers with one summed group (code still sums every group returned).

Controller call: D1 is summed account-wide with no `databaseId` filter, because the free D1 limits are per account; with one database it equals the per-database number. No new var for the database id.

- [ ] **Step 1: Write the failing tests** (a fake `fetcher` returns canned GraphQL bodies; no `stubHttp` needed here)

```ts
const ENV = { CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok' };
test('readUsage adds Workers and Pages requests and reads D1 rows', async () => {
  const seen: unknown[] = [];
  const usage = await readUsage(ENV, '2026-10-26', fakeGql(seen, { workers: [{ sum: { requests: 1500 } }, { sum: { requests: 500 } }], pages: [{ sum: { requests: 40_000 } }], d1: [{ sum: { rowsRead: 1_000_000, rowsWritten: 20_000 } }] }));
  assert.deepEqual(usage, { requests: 42_000, rowsRead: 1_000_000, rowsWritten: 20_000 });
  assert.deepEqual((seen[0] as { variables: unknown }).variables, { account: 'acc', day: '2026-10-26' });
});
test('empty groups read as zero', async () => {
  assert.deepEqual(await readUsage(ENV, '2026-10-26', fakeGql([], { workers: [], pages: [], d1: [] })), { requests: 0, rowsRead: 0, rowsWritten: 0 });
});
test('a GraphQL error is thrown with its message', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', errorGql('not authorized for that account')), /not authorized/);
});
test('an HTTP failure is thrown', async () => {
  await assert.rejects(readUsage(ENV, '2026-10-26', async () => new Response('no', { status: 401 })), /HTTP 401/);
});
```

`fakeGql(seen, accountData)` and `errorGql(message)` are small helpers in the test file returning `typeof fetch` that record the parsed body and answer `{ data: { viewer: { accounts: [accountData] } } }` or `{ data: null, errors: [{ message }] }`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/usage.test.ts`
Expected: FAIL (`readUsage` is not exported).

- [ ] **Step 3: Export `gql` and implement `readUsage`**

- [ ] **Step 4: Run to verify they pass**, plus the existing reader's tests

Run: `node --import tsx --test tests/usage.test.ts tests/stats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/web-analytics.ts functions/_lib/usage.ts tests/usage.test.ts
git commit -m "Usage alert: read today's requests and D1 rows from GraphQL"
```

---

### Task 3: The hourly check, the alert mail and its audit row

**Files:**
- Create: `functions/_lib/usage-alert.ts`
- Modify: `functions/_lib/usage.ts`, `src/lib/audit-labels.ts`
- Test: `tests/usage-check.test.ts`

Controller call: the message lives in its own `usage-alert.ts` rather than as a new `NotifyKind` in `social-notify.ts`, whose context and templates are shaped for social posts; only `notifyEach`, `adminEmails` and `SystemMessage` are reused.

**Interfaces:**
- Consumes: `readUsage`, `crossings`, `utcDay` (Tasks 1-2); `notifyEach`, `adminEmails`, `type SystemMessage` from `functions/_lib/social-notify.ts`; `runGuardedWithAudit` from `functions/_lib/audit.ts`; `configured` from `web-analytics.ts`.
- Produces:
  - `export type UsageState = { checkedAt: number | null; measuredAt: number | null; day: string | null; usage: Usage | null; error: string | null; alertDay: string | null; alerted: string[] }`
  - `export async function readUsageState(db: D1Database): Promise<UsageState | null>` (null when the table or row is missing; never throws)
  - `export async function checkUsage(env: Env & AnalyticsEnv, now: number, origin: string, fetcher: typeof fetch = fetch): Promise<'not_configured' | 'failed' | 'measured' | 'alerted'>`
  - `export function usageAlertMessage(list: Crossing[], panelUrl: string): SystemMessage` in `usage-alert.ts`

`checkUsage` in order:
1. Not `configured(env)`: return `'not_configured'`. No D1, no fetch. (Controller call: the card learns "not set up" from env, so nothing is written for it.)
2. `readUsage(env, utcDay(now), fetcher)`. On throw: `INSERT INTO usage_state (id, checked_at, error) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error` (message cut to 200 characters; the earlier numbers stay), return `'failed'`.
3. `readUsageState` (1 row read), then write the measurement (`checked_at`, `measured_at`, `day`, the three numbers, `error = NULL`) as `INSERT ... VALUES (1, ...) ON CONFLICT(id) DO UPDATE SET ...`: 1 row written. Never a plain `UPDATE ... WHERE id = 1`: if the seed row were ever missing it would match nothing and fail silently forever.
4. `alerted` = the stored list when `alert_day` equals today, else `[]`. `list = crossings(usage, alerted)`. Empty: return `'measured'`.
5. `recipients = await adminEmails(env.DB)` (reads the `users` rows; only on an alert run).
6. Claim with `runGuardedWithAudit`: guard `UPDATE usage_state SET alert_day = ?, alerted = ? WHERE id = 1 AND alert_day IS ? AND alerted = ?` (old values), proof `changes() = 1`, entry `{ userId: null, action: 'usage.alert', targetType: 'usage', targetId: <day>, details: { alerts: list.map(c => ({ metric, threshold, value, limit })), recipients: recipients.length } }`. False (lost the race or nothing changed): return `'measured'`, send nothing.
7. Only after the claim: `notifyEach(env, recipients, usageAlertMessage(list, `${origin}/admin#genel`))`. Return `'alerted'`.

Controller call: claim before send. A lost mail (Gmail down) is not resent; a resend loop is the worse failure, and the panel banner already says when Gmail is broken.
Controller call: one mail per check, listing every newly crossed pair; when 70 and 90 are crossed in the same hour, one mail names 90 and both pairs are claimed.
Controller call: the audit row records that an alert fired and how many admins it was addressed to, not delivery.
D1 cost, in a comment above `checkUsage`: normal hour 1 read + 1 write; alert hour adds the admins' `users` rows read, the audit chain-head read (1), the guard update (1 write) and the audit insert (row + `idx_audit_at` + `idx_audit_user` + `prev_hash` unique index = about 4 writes). At most 6 alert hours a day (3 metrics x 2 thresholds), so the day's total is under 25 reads + 25 writes plus at most 6 x (users + 6).

`usageAlertMessage` copy (no user-written text goes in, so `text` rendered as Markdown is safe):
- Subject: `Ücretsiz kota %<max threshold> sınırını geçti / Free-tier usage passed <max threshold>%`
- Body, Turkish block, `---`, English block. Each line: metric name, `value / limit (pct%)`, threshold. Then what happens at 100% (requests: every API call fails; rows read: every D1 read fails; rows written: every D1 write fails; all until 00:00 UTC, 03:00 Türkiye), then the panel link. Metric names: `Worker istekleri / Worker requests`, `D1 okunan satır / D1 rows read`, `D1 yazılan satır / D1 rows written`.

Audit label in `src/lib/audit-labels.ts`: `'usage.alert': { en: 'Free-tier usage alert sent', tr: 'Ücretsiz kota uyarısı gönderildi' }`.

- [ ] **Step 1: Write the failing tests** in `tests/usage-check.test.ts`

Setup: `setupSocial()` and `stubMail()` from `tests/lib/social.ts` (admin is `admin@example.org`); env extended with `CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok'`; a fake `fetcher` returning chosen numbers. `NOON = Date.parse('2026-10-26T12:00:00Z') / 1000`.

```ts
test('without the token nothing is fetched or written', async () => {
  const calls: unknown[] = [];
  assert.equal(await checkUsage(envWithout, NOON, BASE, recordingFetch(calls)), 'not_configured');
  assert.equal(calls.length, 0);
  assert.equal(stateRow(db).checked_at, null);
});
test('below 70% the numbers are stored and no mail goes', async () => {
  assert.equal(await checkUsage(env, NOON, BASE, numbers({ requests: 10_000, rowsRead: 0, rowsWritten: 0 })), 'measured');
  assert.equal(stateRow(db).requests, 10_000);
  assert.equal(mail.sent.length, 0);
});
test('70% mails each admin once and logs one usage.alert row', async () => {
  assert.equal(await checkUsage(env, NOON, BASE, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 })), 'alerted');
  assert.deepEqual(mail.sent.map((m) => m.to), ['admin@example.org']);
  assert.match(mail.sent[0].subject, /70%/);
  assert.equal(auditCount(db, 'usage.alert'), 1);
});
test('the same threshold does not mail again the same UTC day', async () => {
  await checkUsage(env, NOON, BASE, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  await checkUsage(env, NOON + 3600, BASE, numbers({ requests: 75_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(mail.sent.length, 1);
});
test('90% mails a second time', async () => { /* 71_000 then 91_000: 2 mails, second subject /90%/ */ });
test('70% and 90% crossed in one hour send one mail naming 90%', async () => { /* 95_000 at once: 1 mail, /90%/, alerted = ['requests:70','requests:90'] */ });
test('a new UTC day can alert again', async () => { /* 71_000 at NOON, 71_000 at next day 01:00Z: 2 mails */ });
test('a failed GraphQL call stores the error, keeps the numbers and mails nobody', async () => {
  await checkUsage(env, NOON, BASE, numbers({ requests: 10_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(await checkUsage(env, NOON + 3600, BASE, errorGql('not authorized')), 'failed');
  const row = stateRow(db);
  assert.equal(row.requests, 10_000);
  assert.match(row.error, /not authorized/);
  assert.equal(mail.sent.length, 0);
});
test('D1 refusing writes mails nobody', async () => {
  db.exec('DROP TABLE usage_state'); // stands in for D1 refusing writes
  await assert.rejects(checkUsage(env, NOON, BASE, numbers({ requests: 99_000, rowsRead: 0, rowsWritten: 0 })));
  assert.equal(mail.sent.length, 0);
});
test('mail failure does not resend next hour', async () => {
  mail.fail();
  await checkUsage(env, NOON, BASE, numbers({ requests: 71_000, rowsRead: 0, rowsWritten: 0 }));
  await checkUsage(env, NOON + 3600, BASE, numbers({ requests: 72_000, rowsRead: 0, rowsWritten: 0 }));
  assert.equal(auditCount(db, 'usage.alert'), 1);
});
test('the alert mail is Turkish first and names the metric and the reset', () => {
  const m = usageAlertMessage([{ metric: 'rowsRead', threshold: 90, value: 4_600_000, limit: 5_000_000 }], 'https://rsg-turkiye.iscbsc.org/admin#genel');
  assert.ok(m.text.indexOf('D1 okunan satır') < m.text.indexOf('D1 rows read'));
  assert.match(m.text, /92%/);
  assert.match(m.text, /00:00 UTC/);
});
```

(`checkUsage` throwing when the state table is missing is intended: the dispatch wrapper in Task 4 catches it. The "nothing is mailed" assertion is what matters.)

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/usage-check.test.ts`
Expected: FAIL (`checkUsage` not exported).

- [ ] **Step 3: Implement `readUsageState`, `checkUsage`, `usageAlertMessage` and the audit label**

- [ ] **Step 4: Run to verify they pass**, with the audit-label scan

Run: `node --import tsx --test tests/usage-check.test.ts tests/audit-labels.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/usage.ts functions/_lib/usage-alert.ts src/lib/audit-labels.ts tests/usage-check.test.ts
git commit -m "Usage alert: hourly check, one mail per threshold per day"
```

---

### Task 4: Run the check on the hourly mail tick

**Files:**
- Modify: `functions/api/mail/dispatch.ts` (the `if (isPruneTick(now)) { ... }` block in `onRequestPost`, about lines 281-293; import `checkUsage`; widen the handler's env type to `Env & AnalyticsEnv`)
- Test: `tests/usage-dispatch.test.ts`

**Interfaces:**
- Consumes: `checkUsage(env, now, origin, fetcher?)` (Task 3); `isPruneTick(at)` from `functions/_lib/dispatch-log.ts`.
- Produces: nothing new.

Controller call: inside the existing hourly block, after `pruneDrafts`, before the sending-window check, so it runs at night too. Same rule as its neighbours: its own try/catch, `console.error('usage check failed', err)`, never blocks mail. Run it under `context.waitUntil` when present (awaited otherwise), like `runShepherd`, so a slow Cloudflare API never delays the tick's answer. Origin: `new URL(request.url).origin`. `workers/mail-cron` is not touched.

- [ ] **Step 1: Write the failing tests**, using the fixed-Date `dispatchAt` pattern from `tests/dispatch-expiry.test.ts` (copy the helper; env adds `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`), `stubMail()` first, then `stubHttp(['api.cloudflare.com'], ...)` from `tests/lib/http.ts` answering the GraphQL body.

```ts
test('the on-the-hour tick measures usage, even at night', async () => {
  const res = await dispatchAt('2026-10-26T00:00:30Z', db); // 03:00 Istanbul, mail held
  assert.equal(res.status, 200);
  assert.equal(cf.calls.length, 1);
  assert.equal(stateRow(db).day, '2026-10-26');
});
test('other minutes never call Cloudflare or write usage_state', async () => {
  await dispatchAt('2026-10-26T10:30:00Z', db);
  assert.equal(cf.calls.length, 0);
  assert.equal(stateRow(db).checked_at, null);
});
test('a usage check that throws does not fail the tick', async () => {
  // A GraphQL 500 is caught inside checkUsage, so it cannot test the wrapper.
  // A missing table makes checkUsage itself throw; only the dispatch try/catch saves the tick.
  db.exec('DROP TABLE usage_state');
  const res = await dispatchAt('2026-10-26T10:00:00Z', db);
  assert.equal(res.status, 200);
  assert.equal((await res.json<{ ok: boolean }>()).ok, true);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/usage-dispatch.test.ts`
Expected: FAIL (`cf.calls.length` is 0 on the hourly tick).

- [ ] **Step 3: Add the call to the hourly block**

- [ ] **Step 4: Run to verify they pass**, with the other dispatch tests

Run: `node --import tsx --test tests/usage-dispatch.test.ts tests/dispatch-expiry.test.ts tests/dispatch-lifecycle.test.ts tests/dispatch-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/api/mail/dispatch.ts tests/usage-dispatch.test.ts
git commit -m "Usage alert: run the check on the hourly mail tick"
```

---

### Task 5: Usage in `/api/admin/health`

**Files:**
- Modify: `functions/_lib/agent-limits.ts` (add one export next to `readSnapshot`, about line 186)
- Modify: `functions/api/admin/health.ts`
- Test: `tests/usage-health.test.ts`, `tests/schema.test.ts` (one query added to `'agent limit queries look rows up by index'`)

**Interfaces:**
- Consumes: `readUsageState`, `FREE_LIMITS` (Tasks 1, 3); `configured` from `web-analytics.ts`; `AGENT_BUDGET`, `AGENT_WRITE_BUDGET` from `agent-limits.ts`.
- Produces:
  - `export async function agentUsageToday(db: D1Database, now: number): Promise<{ requests: number; writes: number }>`, one statement over today's token rows: `SELECT COALESCE(SUM(general + reserve), 0) AS requests, COALESCE(SUM(writes + submits + uploads), 0) AS writes FROM agent_counters WHERE bucket >= ?1 AND bucket < ?2` bound to `` `${dayKey(now)}:t:` `` and `` `${dayKey(now)}:t;` ``. Rows read: one per token used today.
  - Health response gains `usage: HealthUsage | null`:

```ts
export type HealthUsage = {
  configured: boolean;
  checkedAt: number | null; measuredAt: number | null; day: string | null;
  requests: number | null; rowsRead: number | null; rowsWritten: number | null;
  failed: boolean;            // the last attempt failed
  error: string | null;       // the message; admins only, null for everyone else
  agentRequests: number; agentWrites: number;
  limits: { requests: number; rowsRead: number; rowsWritten: number; agentRequests: number; agentWrites: number };
};
```

Controller call: usage is a separate field, not a `HealthIssue`; `healthIssues` in `functions/_lib/health.ts` and the red banner stay as they are. The card is where usage lives.
Controller call: every panel role that may read health sees the numbers; only admins see `error` (same rule as `lastError` today).
Health cost per panel load: +1 row read (`usage_state`) + one row per token used today. Each part in its own try/catch: a missing table gives `usage: null`, never a 500 and never an empty `issues`.

- [ ] **Step 1: Write the failing tests**

```ts
test('health carries today\'s usage and agent sums', async () => {
  // seed usage_state (day today, 42_000 / 1_000_000 / 20_000) and two token rows for today: general 10 + reserve 2, writes 3 + submits 1
  const body = await (await call(health, 'GET', '/api/admin/health', { as: 'admin', env })).json();
  assert.equal(body.usage.requests, 42_000);
  assert.equal(body.usage.agentRequests, 12);
  assert.equal(body.usage.agentWrites, 4);
  assert.equal(body.usage.limits.agentRequests, 15_000);
});
test('a non-admin sees that the check failed but not why', async () => {
  // usage_state.error = 'not authorized'; call as 'pub'
  assert.equal(body.usage.failed, true);
  assert.equal(body.usage.error, null);
});
test('without the token usage says not configured', async () => { /* env without CF_* -> usage.configured === false */ });
test('a missing usage_state table leaves the issues intact', async () => {
  db.exec('DROP TABLE usage_state');
  const res = await call(health, 'GET', '/api/admin/health', { as: 'admin', env });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray((await res.json()).issues));
});
```

In `tests/schema.test.ts`, add to the agent-limit query list: `['SELECT COALESCE(SUM(general + reserve), 0) FROM agent_counters WHERE bucket >= ?1 AND bucket < ?2', /agent_counters USING PRIMARY KEY/]`.

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/usage-health.test.ts tests/schema.test.ts`
Expected: FAIL (`body.usage` is undefined).

- [ ] **Step 3: Implement `agentUsageToday` and the `usage` field**

- [ ] **Step 4: Run to verify they pass**, with the existing health users

Run: `node --import tsx --test tests/usage-health.test.ts tests/schema.test.ts tests/connections.test.ts tests/buffer-connect.test.ts tests/agent-limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/agent-limits.ts functions/api/admin/health.ts tests/usage-health.test.ts tests/schema.test.ts
git commit -m "Usage alert: today's usage and agent sums in the health answer"
```

---

### Task 6: The Overview card, strings and docs

**Files:**
- Modify: `src/scripts/admin-health.ts` (add `usageHtml`; call it from `renderOverviewHealth` so the usage lines follow the issues or "Everything is working." line)
- Modify: `src/i18n/ui.ts` (en block near line 765, tr block near line 2442)
- Modify: `README.md` (`## Statistics`, after the Visits setup, about line 940), `CLAUDE.md` (`## Data and the free tier`), `wrangler.toml` (the `CF_ANALYTICS_TOKEN` comment, line 30)
- Test: `tests/admin-health-usage.test.ts`; `tests/admin-foundation-i18n.test.ts` already scans `admin-health.ts`

**Interfaces:**
- Consumes: `HealthUsage` (Task 5; redeclare the type in the client file, as `Issue` is redeclared today); `formatDateTime(ts, lang)` from `src/scripts/format-time.ts`; `HealthDeps`.
- Produces: `export function usageHtml(u: HealthUsage | null, d: HealthDeps, now: number): string` (empty string for `null`).

Layout (plain; design pass later): a small heading `admin.health.usage.title`, then one text line per metric in this order: Worker requests, D1 rows read, D1 rows written, Agent requests, Agent writes, each `label: value of limit (pct%)` with numbers formatted by `toLocaleString(d.lang === 'tr' ? 'tr-TR' : 'en-GB')`. A line at or past 70% gets `font-semibold`; nothing else is coloured. Then one status line, first that applies:
- not configured: `notSetUp`, the three Cloudflare lines omitted (agent lines still shown);
- `day` is not today (UTC): `notYet`, the three Cloudflare lines omitted;
- `now - checkedAt > 3 * 3600`: `stale` with the time (Controller call: 3 hours, so one missed `:00` tick does not raise it);
- `failed`: `failed` with time and, for admins, the error; otherwise `failedNoDetail`;
- else `asOf` with `measuredAt`.

Strings (en / tr), all literal keys:

| Key | en | tr |
| --- | --- | --- |
| `admin.health.usage.title` | Free plan, today (UTC) | Ücretsiz plan, bugün (UTC) |
| `admin.health.usage.requests` | Worker requests | Worker istekleri |
| `admin.health.usage.rowsRead` | D1 rows read | D1 okunan satır |
| `admin.health.usage.rowsWritten` | D1 rows written | D1 yazılan satır |
| `admin.health.usage.agentRequests` | Agent requests | Ajan istekleri |
| `admin.health.usage.agentWrites` | Agent writes | Ajan yazmaları |
| `admin.health.usage.value` | {value} of {limit} ({pct}%) | {limit} içinde {value} (%{pct}) |
| `admin.health.usage.asOf` | Measured at {time}. Admins get an e-mail at 70% and 90%. | {time} itibarıyla. Adminlere %70 ve %90'da e-posta gider. |
| `admin.health.usage.notSetUp` | Cloudflare usage is not measured: CF_ANALYTICS_TOKEN is not set (README, Statistics). | Cloudflare kullanımı ölçülmüyor: CF_ANALYTICS_TOKEN girilmemiş (README, Statistics). |
| `admin.health.usage.notYet` | Not measured yet today. | Bugün henüz ölçülmedi. |
| `admin.health.usage.stale` | Not checked since {time}. | {time} tarihinden beri kontrol edilmedi. |
| `admin.health.usage.failed` | The check at {time} failed: {error} | {time} kontrolü başarısız: {error} |
| `admin.health.usage.failedNoDetail` | The check at {time} failed. An admin can see why. | {time} kontrolü başarısız. Nedenini bir admin görebilir. |

- [ ] **Step 1: Write the failing tests** in `tests/admin-health-usage.test.ts` (pure; parse the returned HTML with `node-html-parser` as `tests/admin-ui-kit.test.ts` does; `d` uses `ui.en` with a minimal `tf`)

```ts
test('numbers show as value of limit with a percent', () => {
  const text = parse(usageHtml(usage({ requests: 42_000 }), d, NOW)).text;
  assert.match(text, /Worker requests: 42,000 of 100,000 \(42%\)/);
  assert.match(text, /Agent requests: 12 of 15,000/);
});
test('not configured says so and still shows the agent lines', () => { /* configured false: /CF_ANALYTICS_TOKEN is not set/, /Agent writes/, no /Worker requests/ */ });
test('a failed check says so with the error for admins', () => { /* failed true, error 'not authorized': /failed: not authorized/ */ });
test('stale check is said', () => { /* checkedAt NOW - 4h: /Not checked since/ */ });
test('yesterday\'s numbers are not shown as today\'s', () => { /* day '2026-10-25': /Not measured yet today/, no /Worker requests/ */ });
test('null usage renders nothing', () => assert.equal(usageHtml(null, d, NOW), ''));
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --import tsx --test tests/admin-health-usage.test.ts`
Expected: FAIL (`usageHtml` not exported).

- [ ] **Step 3: Implement `usageHtml`, wire it into `renderOverviewHealth` (and keep `HealthDeps`/`last` as they are), add the strings**

- [ ] **Step 4: Docs**: README `## Statistics`: one paragraph, "Usage alert": what is measured, the 70%/90% mails, the hourly check on the mail tick, that it reuses `CF_ANALYTICS_TOKEN`, the card lines. `CLAUDE.md` `## Data and the free tier`: one bullet, "The mail tick measures all three hourly (`functions/_lib/usage.ts`) and mails the admins at 70% and 90%; the Overview card shows today's numbers." `wrangler.toml`: the comment above `CF_ACCOUNT_ID` also names the usage alert.

- [ ] **Step 5: Full verification**

Run: `npm test && npx astro check && npm run build`
Expected: all tests pass, `astro check` reports 0 errors, build succeeds.

- [ ] **Step 6: Browser check while signed in**: `npm run build && npm run preview`, a Playwright script in `tests/browser/` mocking `/api/me` and `/api/admin/health` with `page.route` (as the existing `tests/browser/*.mjs` do) for three states: numbers, not configured, failed. Check Overview at 1280×680 and 1440×900: the System block shows the lines, no inner scrollbar, the page does not scroll sideways at 390 px. Give the maintainer the local preview link and wait for approval before any push (CLAUDE.md, "Verifying a change").

- [ ] **Step 7: Commit**

```bash
git add src/scripts/admin-health.ts src/i18n/ui.ts tests/admin-health-usage.test.ts tests/browser README.md CLAUDE.md wrangler.toml
git commit -m "Usage alert: today's usage on the Overview card, docs"
```

---

## Owner steps (by the owner, never by an agent)

1. Check that `CF_ANALYTICS_TOKEN` is set on the Pages project `website`: `npx wrangler pages secret list --project-name website`. If the Statistics section already shows visits, it is. If not: create an API token with only **Account → Account Analytics → Read** for the organisation account, then in your own terminal `npx wrangler pages secret put CF_ANALYTICS_TOKEN --project-name website`. No Worker secret is needed: the check runs in the site, not in `workers/mail-cron`.
2. Before deploying: `npx wrangler d1 execute rsg-members --remote --file=db/schema.sql` (migration 8m).
3. Once, after deploy: compare the card's "Worker requests" with the Cloudflare dashboard's Workers & Pages daily request count (see Open questions). If the card is about double, Pages Functions are counted twice; say so and the sum becomes `max` or Pages-only.

## Open questions

- Does `workersInvocationsAdaptive` already include Pages Functions invocations? If yes, `requests` double-counts (alerts early). Settled by owner step 3.
- Do the two cron Workers' scheduled invocations count toward the 100,000? Cloudflare's limits page does not say. Either way they are about 1,440 + 1 a day (under 1.5%).
- The `pagesFunctionsInvocationsAdaptiveGroups` field names come from an unofficial schema mirror; the official docs list the dataset but not its fields. Task 2's tests cannot prove them; the first hourly check on production does (a wrong field shows as "check failed" on the card, never as a mail).
