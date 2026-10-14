# Social DM Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publishers read and answer @rsgturkey's Instagram DMs from the admin panel (`#sosyal/dm`). The server notices new DMs every five minutes and e-mails publishers before the 24-hour reply window closes.

**Architecture:**
- **Thread metadata.** A new D1 table holds per-conversation metadata only. Message text is fetched live from `graph.instagram.com`.
- **Poll.** Runs inside the existing social tick (`/api/social/dispatch`, called every minute by `workers/mail-cron`), paced to five minutes. After syncing, it sends the digest and last-call e-mails through the existing system-mail path.
- **Panel.** A publisher-only sub-tab copies the mail inbox's list/thread layout.
- **Login.** A `next` cookie lets the e-mail links survive sign-in.

**Tech Stack:**
- Cloudflare Pages Functions (TypeScript) and D1.
- Astro 7 pages with plain TS client scripts and Tailwind classes.
- Tests: `node --test` with `tsx` (`npm test`). Playwright browser checks live in `tests/browser/*.mjs` and are run by hand.

**Spec:** `docs/superpowers/specs/2026-10-15-social-dm-inbox-design.md`

## Global Constraints

- **Language.** Every UI string exists in both `en` and `tr` in `src/i18n/ui.ts`. DM keys live under `admin.social.dm.*`.
- **Characters and classes:**
  - No em dash (U+2014) anywhere (`tests/no-em-dashes.test.ts` enforces it).
  - No `text-gray-400`.
  - Never `hidden` and `inline-flex` together in static markup.
  - Phone touch targets `min-h-11`.
- **Public repo.** Tests use `example.org` addresses. No real ids, tokens or personal e-mails.
- **Message text is never stored in D1, the audit log or e-mails.**
  - E-mails carry @username, times and links only.
  - Audit rows carry the thread id and the actor, never the text.
- **Access.** Every DM endpoint requires `canSocialPublish(user)` (`functions/_lib/auth.ts`). Write endpoints also require `checkCsrf(request)`.
- **Window.** Reply only within 24 h (86400 s) of the newest incoming message. Text is 1 to 1000 bytes of UTF-8. No HUMAN_AGENT tag.
- **Poll pacing:**
  - Every 300 s.
  - Manual refresh no more often than every 30 s (one shared limit across all users, see ruling R2).
  - At most 10 conversation fetches per poll.
- **Digest:**
  - Only when something new is unanswered.
  - At most one per person per 3600 s and 6 per Istanbul day.
  - None between 23:00 and 08:00 Istanbul (UTC+3, no DST).
  - Recipients: `is_social_publisher` users; admins if there are none.
- **Last call:**
  - When an unanswered thread is ≥ 20 h old (72000 s).
  - Once per incoming message.
  - Recipients: publishers and admins.
  - Ignores quiet hours and caps.
- **Failure isolation.** A DM failure must never change `dispatchSocial`'s result or the social tick's HTTP status.
- **Commits.** Messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Rulings made while planning

- **R1.** The health banner is not changed. The DM poll runs inside the social tick, whose own `dispatch_runs` row (kind `social`) already shows a stopped scheduler. The `social_dm` rows are used only for pacing.
- **R2.** The manual refresh limit is one shared 30 s gate (the last `social_dm` run), not per user. It is stricter than the spec's per-user limit, and three publishers do not need more.
- **R3.** Meta's error code 10 means "outside the allowed window" when its subcode is 2534022. It must never be read as an auth error. DM errors get their own classifier (`dmErrorKind`); only code 190 and 200-299 count as auth and break the connection.
- **R4.** Our own messages are recognised by `from.id === account.id` **or** `from.username === account.name` (case-insensitive). The id Meta puts in `from` for the business has not been observed live yet.
- **R5.** `digested_at` is set only when at least one person received the digest. A DM that arrives during quiet hours is therefore picked up by the 08:00 digest.

## Review Focus

1. **A Meta "window closed" refusal** (code 10, subcode 2534022) must not mark the Instagram connection broken. Publishing must keep working. Tested in Task 2 and Task 5.
2. **Message requests from strangers** may arrive with no username. The list and the digest must fall back to "Instagram user", never show "@null" or an empty row. Tested in Task 4 and Task 7.
3. **A conversation where our reply is the newest message** (answered from the Instagram app) must show "Answered", must not count as unread, and must never trigger a digest or a last call. Tested in Task 1 and Task 3.
4. **Open-redirect attempts through `next`:** `//evil.example`, `/\evil.example`, `https://evil.example`, `/admin/../../x` and encoded variants must fall back to `/account`. Tested in Task 6.
5. **Text near 1000 bytes in Turkish characters or emoji.** 500 × "ş" is 1000 bytes (allowed), 501 × "ş" is not. The counter and the server must agree. Tested in Task 5 and Task 7.

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `db/schema.sql` | modify | tables `social_dm_threads`, `social_dm_digest_log` |
| `functions/_lib/social-dm.ts` | create | constants, row type, pure state and pacing rules |
| `functions/_lib/social/instagram.ts` | modify | DM scope; export the `graph` helper as `igGraph` |
| `functions/_lib/social/instagram-dm.ts` | create | DM adapter: list, thread, send, error classes |
| `functions/_lib/dispatch-log.ts` | modify | `startRun` kind union gains `'social_dm'` |
| `functions/_lib/social-dm-poll.ts` | create | `pollDms`: pacing, sync rows, then notifications |
| `functions/_lib/social-dm-notify.ts` | create | digest and last-call selection, text, sending |
| `functions/api/social/dispatch.ts` | modify | call `pollDms` after the social run, isolated |
| `functions/api/admin/social/dm/index.ts` | create | GET list |
| `functions/api/admin/social/dm/[id].ts` | create | GET thread (marks read) |
| `functions/api/admin/social/dm/[id]/reply.ts` | create | POST reply |
| `functions/api/admin/social/dm/refresh.ts` | create | POST manual poll |
| `functions/api/admin/counts.ts` | modify | `dm` count for publishers |
| `functions/_lib/next-path.ts` | create | `safeNext`, `next` cookie helpers |
| `functions/auth/login.ts`, `functions/auth/callback.ts` | modify | return path |
| `src/components/admin/AdminShell.astro` | modify | sign-in link id |
| `src/scripts/admin/sections.ts` | modify | `dm` sub-page, `dm` count key |
| `src/scripts/admin/overview.ts` | modify | DM card |
| `src/components/admin/panes/SocialPane.astro` | modify | DM markup |
| `src/scripts/admin/sections/social-dm.ts` | create | DM list, thread, reply UI |
| `src/scripts/admin/main.ts` | modify | wire DM sub-page and sign-in link |
| `src/i18n/ui.ts` | modify | `admin.social.dm.*`, `admin.overview.dm`, `admin.social.tab.dm`, sign-in message |
| `src/data/privacy.ts` | modify | DM paragraph (en and tr) |
| `tests/social-dm.test.ts` | create | Task 1 |
| `tests/instagram-dm.test.ts` | create | Task 2 |
| `tests/social-dm-poll.test.ts` | create | Tasks 3 and 4 |
| `tests/social-dm-api.test.ts` | create | Task 5 |
| `tests/next-path.test.ts` | create | Task 6 |
| `tests/browser/admin-social-dm.mjs` | create | Task 7 |

---

### Task 1: Schema and DM state rules

**Files:**
- Modify: `db/schema.sql` (append after the `social_event_modes` table)
- Create: `functions/_lib/social-dm.ts`
- Test: `tests/social-dm.test.ts`

**Interfaces:**
- Produces:
  - `DmThreadRow`
  - `dmView(row, now): DmView`
  - `istanbulHour(now): number`
  - `istanbulDayStart(now): number`
  - `isQuietHour(now): boolean`
  - `digestFresh(rows, now): DmThreadRow[]`
  - `digestList(rows, now): DmThreadRow[]`
  - `mayDigest(sentAts: number[], now): boolean`
  - `lastCallDue(rows, now): DmThreadRow[]`
  - constants `WINDOW_SECONDS`, `LAST_CALL_AFTER`, `POLL_EVERY`, `REFRESH_MIN_GAP`, `MAX_THREAD_FETCHES`, `DIGEST_GAP`, `DIGESTS_PER_DAY`, `QUIET_FROM`, `QUIET_TO`, `MAX_REPLY_BYTES`, `DM_SCOPE`.

- [ ] **Step 1: Write the failing test** `tests/social-dm.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  dmView, istanbulHour, istanbulDayStart, isQuietHour, digestFresh, digestList, mayDigest, lastCallDue,
  WINDOW_SECONDS, type DmThreadRow,
} from '../functions/_lib/social-dm';

// 2026-10-15 09:00 UTC = 12:00 Istanbul.
const NOON = Date.UTC(2026, 9, 15, 9, 0) / 1000;
const H = 3600;
const row = (o: Partial<DmThreadRow> = {}): DmThreadRow => ({
  id: 't1', platform: 'instagram', conversation_id: 'c1', peer_id: 'p1', peer_username: 'ayse',
  last_inbound_at: NOON - H, last_outbound_at: null, read_at: null, read_by: null,
  digested_at: null, final_warned_at: null, updated_at: NOON - H, ...o,
});

test('the schema has both DM tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8'));
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('a','instagram','c','p',1)`).run();
  assert.throws(() => db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('b','instagram','c','p',1)`).run(), /UNIQUE/);
  assert.throws(() => db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('c','linkedin','c2','p',1)`).run(), /CHECK/);
  db.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES ('u', 1)`).run();
});

test('an incoming message an hour old is open, unread, with 23 hours left', () => {
  const v = dmView(row(), NOON);
  assert.deepEqual(v, { unanswered: true, unread: true, expired: false, closesAt: NOON - H + WINDOW_SECONDS, secondsLeft: 23 * H });
});

test('our reply after their message: answered, not unread, not expired', () => {
  const v = dmView(row({ last_outbound_at: NOON - 60 }), NOON);
  assert.equal(v.unanswered, false);
  assert.equal(v.unread, false);
});

test('read after the last incoming message clears unread but not unanswered', () => {
  const v = dmView(row({ read_at: NOON - 30 }), NOON);
  assert.equal(v.unread, false);
  assert.equal(v.unanswered, true);
});

test('past 24 hours: expired, zero left, and not unread', () => {
  const v = dmView(row({ last_inbound_at: NOON - 25 * H }), NOON);
  assert.equal(v.expired, true);
  assert.equal(v.secondsLeft, 0);
  assert.equal(v.unread, false);
});

test('a thread with no incoming message is neither unanswered nor unread', () => {
  const v = dmView(row({ last_inbound_at: null, last_outbound_at: NOON - H }), NOON);
  assert.deepEqual([v.unanswered, v.unread, v.expired, v.closesAt], [false, false, false, null]);
});

test('Istanbul hour and day start are UTC+3', () => {
  assert.equal(istanbulHour(NOON), 12);
  assert.equal(istanbulDayStart(NOON), Date.UTC(2026, 9, 14, 21, 0) / 1000);
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 20, 0) / 1000), true, '23:00');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 4, 59) / 1000), true, '07:59');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 5, 0) / 1000), false, '08:00');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 19, 59) / 1000), false, '22:59');
});

test('digestFresh: unanswered, open, and newer than the last digest', () => {
  const rows = [
    row({ id: 'new' }),
    row({ id: 'seen', digested_at: NOON - H }),
    row({ id: 'answered', last_outbound_at: NOON }),
    row({ id: 'expired', last_inbound_at: NOON - 30 * H }),
    row({ id: 'newer', digested_at: NOON - 2 * H }),
  ];
  assert.deepEqual(digestFresh(rows, NOON).map((r) => r.id), ['new', 'newer']);
  assert.deepEqual(digestList(rows, NOON).map((r) => r.id), ['new', 'seen', 'newer']);
});

test('mayDigest: not in quiet hours, an hour apart, six a day', () => {
  assert.equal(mayDigest([], NOON), true);
  assert.equal(mayDigest([NOON - 59 * 60], NOON), false);
  assert.equal(mayDigest([NOON - H], NOON), true);
  const six = [1, 2, 3, 4, 5, 6].map((n) => istanbulDayStart(NOON) + n * 60);
  assert.equal(mayDigest(six, NOON), false);
  assert.equal(mayDigest(six.map((s) => s - 86400), NOON), true, 'yesterday does not count');
  assert.equal(mayDigest([], Date.UTC(2026, 9, 15, 21, 0) / 1000), false, 'midnight');
});

test('lastCallDue: 20 hours old, unanswered, open, once per incoming message', () => {
  const at = NOON - 20 * H;
  const rows = [
    row({ id: 'due', last_inbound_at: at }),
    row({ id: 'young', last_inbound_at: NOON - 19 * H }),
    row({ id: 'warned', last_inbound_at: at, final_warned_at: at }),
    row({ id: 'warnedEarlier', last_inbound_at: at, final_warned_at: at - 100 }),
    row({ id: 'answered', last_inbound_at: at, last_outbound_at: NOON }),
    row({ id: 'expired', last_inbound_at: NOON - 24 * H }),
  ];
  assert.deepEqual(lastCallDue(rows, NOON).map((r) => r.id), ['due', 'warnedEarlier']);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/social-dm.test.ts`
Expected: FAIL, cannot find module `functions/_lib/social-dm`.

- [ ] **Step 3: Add the tables** to the end of `db/schema.sql`

```sql
-- Social DM inbox (docs/superpowers/specs/2026-10-15-social-dm-inbox-design.md).
-- One row per conversation the poll has seen. No message text is stored: the
-- panel fetches messages live. id is our own random id, used in URLs, so the
-- platform's conversation id never appears in a link. updated_at is the
-- platform's updated_time for the conversation when we last read it.
CREATE TABLE IF NOT EXISTS social_dm_threads (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL CHECK (platform IN ('instagram','x')),
  conversation_id   TEXT NOT NULL,
  peer_id           TEXT NOT NULL,
  peer_username     TEXT,
  last_inbound_at   INTEGER,
  last_outbound_at  INTEGER,
  read_at           INTEGER,
  read_by           TEXT,
  digested_at       INTEGER,
  final_warned_at   INTEGER,
  updated_at        INTEGER NOT NULL,
  UNIQUE (platform, conversation_id)
);

-- Per-person digest pacing; pruned to two days by each poll.
CREATE TABLE IF NOT EXISTS social_dm_digest_log (
  user_id   TEXT NOT NULL,
  sent_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_dm_digest_log_user ON social_dm_digest_log (user_id, sent_at);
```

- [ ] **Step 4: Write `functions/_lib/social-dm.ts`**

```ts
/**
 * The DM inbox's rules, kept free of I/O so they can be tested by the clock:
 * what counts as unanswered, unread and expired, and when the digest and the
 * last call may go out. Meta lets a business answer a DM for 24 hours after
 * the person's newest message; nothing here stores what anyone wrote.
 */
export const WINDOW_SECONDS = 86400;
export const LAST_CALL_AFTER = 20 * 3600;
export const POLL_EVERY = 300;
export const REFRESH_MIN_GAP = 30;
export const MAX_THREAD_FETCHES = 10;
export const DIGEST_GAP = 3600;
export const DIGESTS_PER_DAY = 6;
export const QUIET_FROM = 23;
export const QUIET_TO = 8;
export const MAX_REPLY_BYTES = 1000;
export const DM_SCOPE = 'instagram_business_manage_messages';

/** Türkiye is UTC+3 all year (no DST since 2016), as in schedule.ts. */
const TR_OFFSET = 3 * 3600;

export interface DmThreadRow {
  id: string;
  platform: 'instagram' | 'x';
  conversation_id: string;
  peer_id: string;
  peer_username: string | null;
  last_inbound_at: number | null;
  last_outbound_at: number | null;
  read_at: number | null;
  read_by: string | null;
  digested_at: number | null;
  final_warned_at: number | null;
  updated_at: number;
}

export interface DmView {
  unanswered: boolean;
  unread: boolean;
  expired: boolean;
  closesAt: number | null;
  secondsLeft: number;
}

export function dmView(row: Pick<DmThreadRow, 'last_inbound_at' | 'last_outbound_at' | 'read_at'>, now: number): DmView {
  const inbound = row.last_inbound_at;
  if (inbound === null) return { unanswered: false, unread: false, expired: false, closesAt: null, secondsLeft: 0 };
  const closesAt = inbound + WINDOW_SECONDS;
  const expired = now >= closesAt;
  const unanswered = inbound > (row.last_outbound_at ?? 0);
  return {
    unanswered,
    unread: unanswered && !expired && (row.read_at ?? 0) < inbound,
    expired,
    closesAt,
    secondsLeft: expired ? 0 : closesAt - now,
  };
}

export const istanbulHour = (now: number) => Math.floor(((now + TR_OFFSET) % 86400) / 3600);
export const istanbulDayStart = (now: number) => now - ((now + TR_OFFSET) % 86400);
export function isQuietHour(now: number): boolean {
  const h = istanbulHour(now);
  return h >= QUIET_FROM || h < QUIET_TO;
}

const open = (r: DmThreadRow, now: number) => { const v = dmView(r, now); return v.unanswered && !v.expired; };

/** Threads that make a digest worth sending: something unanswered arrived since the last one. */
export function digestFresh(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now) && r.last_inbound_at! > (r.digested_at ?? 0));
}

/** What a digest lists: every thread that can still be answered. */
export function digestList(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now));
}

/** Whether one person may get a digest now, given when they got earlier ones. */
export function mayDigest(sentAts: number[], now: number): boolean {
  if (isQuietHour(now)) return false;
  if (sentAts.some((s) => now - s < DIGEST_GAP)) return false;
  const day = istanbulDayStart(now);
  return sentAts.filter((s) => s >= day).length < DIGESTS_PER_DAY;
}

/** Unanswered threads with four hours or less left, not yet warned about for this message. */
export function lastCallDue(rows: DmThreadRow[], now: number): DmThreadRow[] {
  return rows.filter((r) => open(r, now) && now - r.last_inbound_at! >= LAST_CALL_AFTER && r.final_warned_at !== r.last_inbound_at);
}
```

- [ ] **Step 5: Run the test and see it pass**

Run: `node --import tsx --test tests/social-dm.test.ts tests/schema.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add db/schema.sql functions/_lib/social-dm.ts tests/social-dm.test.ts
git commit -m "Social DM: tables and the window, digest and last-call rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Instagram DM adapter

**Files:**
- Modify: `functions/_lib/social/instagram.ts`
  - line 12: add `'instagram_business_manage_messages'` to `IG_SCOPES`;
  - the `graph` function, about line 114: export it as `igGraph`.
- Create: `functions/_lib/social/instagram-dm.ts`
- Test: `tests/instagram-dm.test.ts`

**Interfaces:**
- Consumes: `DM_SCOPE` (Task 1).
- Produces:
  - `DmConversation { id: string; updatedAt: number }`
  - `DmMessage { id: string; at: number; fromId: string; fromUsername: string | null; text: string; attachments: string[]; mine: boolean }`
  - `DmErrorKind = 'window' | 'auth' | 'transient' | 'refused'`
  - `DmError { ok: false; kind: DmErrorKind; reason: string }`
  - `DmAccount { id: string; name: string | null }`
  - `instagramDm.listConversations(token): Promise<{ ok: true; conversations: DmConversation[] } | DmError>`
  - `instagramDm.thread(token, conversationId, account): Promise<{ ok: true; messages: DmMessage[] } | DmError>` (oldest first)
  - `instagramDm.send(token, peerId, text): Promise<{ ok: true } | DmError>`
  - `dmErrorKind(status, err): DmErrorKind`
  - `peerOf(messages): { id: string; username: string | null } | null`

- [ ] **Step 1: Write the failing test** `tests/instagram-dm.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubGraph, type GraphCall } from './lib/instagram';
import { instagramDm, dmErrorKind, peerOf } from '../functions/_lib/social/instagram-dm';
import { IG_SCOPES } from '../functions/_lib/social/instagram';

const ME = { id: '17841400000000000', name: 'rsg_test' };
async function withGraph<T>(h: (c: GraphCall) => Response | undefined, run: () => Promise<T>) {
  const g = stubGraph(h);
  try { return { result: await run(), calls: g.calls }; } finally { g.restore(); }
}
const err = (code: number, sub?: number, status = 400) => Response.json({ error: { code, error_subcode: sub, message: 'x' } }, { status });

test('the connection asks for the messaging scope', () => {
  assert.ok(IG_SCOPES.includes('instagram_business_manage_messages'));
});

test('conversations: platform=instagram, newest first, times parsed from +0000', async () => {
  const { result, calls } = await withGraph((c) => (c.path === '/me/conversations' ? Response.json({ data: [
    { id: 'cA', updated_time: '2026-10-15T08:00:00+0000' },
    { id: 'cB', updated_time: '2026-10-15T09:00:00+0000' },
  ] }) : undefined), () => instagramDm.listConversations('tok'));
  assert.deepEqual(result, { ok: true, conversations: [
    { id: 'cB', updatedAt: Date.UTC(2026, 9, 15, 9) / 1000 },
    { id: 'cA', updatedAt: Date.UTC(2026, 9, 15, 8) / 1000 },
  ] });
  assert.equal(calls[0].params.get('platform'), 'instagram');
  assert.equal(calls[0].params.get('access_token'), 'tok');
});

test('a thread: oldest first, ours marked by id or by username, attachments as https links only', async () => {
  const { result } = await withGraph((c) => (c.path === '/cA' ? Response.json({ messages: { data: [
    { id: 'm3', created_time: '2026-10-15T09:02:00+0000', from: { id: ME.id, username: 'rsg_test' }, message: 'Merhaba!' },
    { id: 'm2', created_time: '2026-10-15T09:01:00+0000', from: { id: '999', username: 'RSG_TEST' }, message: 'by name' },
    { id: 'm1', created_time: '2026-10-15T09:00:00+0000', from: { id: '555', username: 'ayse' }, message: 'Soru',
      attachments: { data: [{ image_data: { url: 'https://lookaside.fbsbx.com/x.jpg' } }, { file_url: 'javascript:alert(1)' }] } },
  ] } }) : undefined), () => instagramDm.thread('tok', 'cA', ME));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.messages.map((m) => [m.id, m.mine]), [['m1', false], ['m2', true], ['m3', true]]);
  assert.deepEqual(result.messages[0].attachments, ['https://lookaside.fbsbx.com/x.jpg']);
  assert.deepEqual(peerOf(result.messages), { id: '555', username: 'ayse' });
});

test('a thread with only our messages has no peer from "from"; the "to" field names them', async () => {
  const { result } = await withGraph((c) => (c.path === '/cA' ? Response.json({ messages: { data: [
    { id: 'm1', created_time: '2026-10-15T09:00:00+0000', from: { id: ME.id, username: 'rsg_test' }, to: { data: [{ id: '555', username: 'ayse' }] }, message: 'x' },
  ] } }) : undefined), () => instagramDm.thread('tok', 'cA', ME));
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(peerOf(result.messages), { id: '555', username: 'ayse' });
});

test('send: form-encoded recipient and message JSON, to me/messages', async () => {
  const { result, calls } = await withGraph((c) => (c.method === 'POST' && c.path === '/me/messages' ? Response.json({ recipient_id: '555', message_id: 'mid' }) : undefined),
    () => instagramDm.send('tok', '555', 'Çok teşekkürler'));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(JSON.parse(calls[0].params.get('recipient')!), { id: '555' });
  assert.deepEqual(JSON.parse(calls[0].params.get('message')!), { text: 'Çok teşekkürler' });
});

test('error classes: the window refusal is never auth (R3)', () => {
  assert.equal(dmErrorKind(400, { code: 10, error_subcode: 2534022 }), 'window');
  assert.equal(dmErrorKind(400, { code: 10 }), 'refused', 'a bare permission error must not break the connection');
  assert.equal(dmErrorKind(400, { code: 190 }), 'auth');
  assert.equal(dmErrorKind(403, { code: 200 }), 'auth');
  assert.equal(dmErrorKind(500, null), 'transient');
  assert.equal(dmErrorKind(0, null), 'transient');
  assert.equal(dmErrorKind(400, { code: 4 }), 'transient');
  assert.equal(dmErrorKind(400, { code: 551 }), 'refused');
});

test('send outside the window comes back as window', async () => {
  const { result } = await withGraph(() => err(10, 2534022), () => instagramDm.send('tok', '555', 'geç'));
  assert.deepEqual(result, { ok: false, kind: 'window', reason: 'x' });
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/instagram-dm.test.ts`
Expected: FAIL, cannot find module `instagram-dm`.

- [ ] **Step 3: Edit `functions/_lib/social/instagram.ts`**

Replace line 12:

```ts
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_messages'];
```

Change `async function graph(` to `export async function igGraph(`. Rename every call of `graph(` in this file to `igGraph(`, and export the result type (`export type GraphResult = ...`). Check that nothing else is called `graph`: `grep -n "graph(" functions/_lib/social/instagram.ts`.

- [ ] **Step 4: Write `functions/_lib/social/instagram-dm.ts`**

```ts
/**
 * Instagram direct messages through the Instagram API with Instagram Login
 * (graph.instagram.com, scope instagram_business_manage_messages). Reads the
 * conversation list, the newest messages of one conversation (Meta returns
 * details for the 20 newest only), and sends a text reply. Never throws.
 *
 * Errors have their own classes here, not publishing's: code 10 with subcode
 * 2534022 is "outside the 24-hour window", a refusal of this one message, and
 * must not mark the connection broken (plan ruling R3).
 */
import { igGraph } from './instagram';
import type { GraphError } from './instagram-errors';

export interface DmConversation { id: string; updatedAt: number }
export interface DmMessage { id: string; at: number; fromId: string; fromUsername: string | null; text: string; attachments: string[]; mine: boolean; toId?: string; toUsername?: string | null }
export type DmErrorKind = 'window' | 'auth' | 'transient' | 'refused';
export interface DmError { ok: false; kind: DmErrorKind; reason: string }
export interface DmAccount { id: string; name: string | null }

export interface DmAdapter {
  listConversations(token: string): Promise<{ ok: true; conversations: DmConversation[] } | DmError>;
  thread(token: string, conversationId: string, account: DmAccount): Promise<{ ok: true; messages: DmMessage[] } | DmError>;
  send(token: string, peerId: string, text: string): Promise<{ ok: true } | DmError>;
}

const WINDOW_SUBCODE = 2534022;
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613, -1, -2]);

export function dmErrorKind(status: number, err: GraphError | null): DmErrorKind {
  const code = err?.code ?? 0;
  if (code === 10 && err?.error_subcode === WINDOW_SUBCODE) return 'window';
  if (code === 190 || (code >= 200 && code <= 299)) return 'auth';
  if (status === 0 || status >= 500 || TRANSIENT_CODES.has(code)) return 'transient';
  return 'refused';
}

const fail = (status: number, error: GraphError | null): DmError => ({
  ok: false, kind: dmErrorKind(status, error), reason: (error?.message ?? `HTTP ${status}`).slice(0, 200),
});

/** Meta writes "2026-10-15T09:00:00+0000"; Date.parse wants "+00:00". */
function parseTime(v: unknown): number {
  if (typeof v !== 'string') return 0;
  const ms = Date.parse(v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function attachmentUrls(raw: unknown): string[] {
  const data = (raw as { data?: unknown[] } | undefined)?.data;
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const a of data as Record<string, any>[]) {
    for (const u of [a?.image_data?.url, a?.video_data?.url, a?.file_url, a?.url]) {
      if (typeof u === 'string' && u.startsWith('https://')) out.push(u);
    }
  }
  return out;
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** The other person: the sender of their newest message, else whom our message went to. */
export function peerOf(messages: DmMessage[]): { id: string; username: string | null } | null {
  for (let i = messages.length - 1; i >= 0; i--) if (!messages[i].mine) return { id: messages[i].fromId, username: messages[i].fromUsername };
  const ours = messages.find((m) => m.toId);
  return ours ? { id: ours.toId!, username: ours.toUsername ?? null } : null;
}

export const instagramDm: DmAdapter = {
  async listConversations(token) {
    const r = await igGraph('GET', 'me/conversations', token, { platform: 'instagram', fields: 'id,updated_time', limit: '25' });
    if (!r.ok) return fail(r.status, r.error);
    const data = Array.isArray(r.data.data) ? (r.data.data as Record<string, unknown>[]) : [];
    const conversations = data
      .filter((c) => typeof c.id === 'string')
      .map((c) => ({ id: c.id as string, updatedAt: parseTime(c.updated_time) }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return { ok: true, conversations };
  },

  async thread(token, conversationId, account) {
    const r = await igGraph('GET', encodeURIComponent(conversationId), token, { fields: 'messages{id,created_time,from,to,message,attachments}' });
    if (!r.ok) return fail(r.status, r.error);
    const data = (r.data.messages as { data?: unknown[] } | undefined)?.data;
    const messages = (Array.isArray(data) ? (data as Record<string, any>[]) : [])
      .filter((m) => typeof m.id === 'string')
      .map((m): DmMessage => {
        const fromId = String(m.from?.id ?? '');
        const fromUsername = typeof m.from?.username === 'string' ? m.from.username : null;
        const to = Array.isArray(m.to?.data) ? m.to.data[0] : undefined;
        return {
          id: m.id, at: parseTime(m.created_time), fromId, fromUsername,
          text: typeof m.message === 'string' ? m.message : '',
          attachments: attachmentUrls(m.attachments),
          mine: fromId === account.id || same(fromUsername, account.name),
          toId: to?.id !== undefined ? String(to.id) : undefined,
          toUsername: typeof to?.username === 'string' ? to.username : null,
        };
      })
      .sort((a, b) => a.at - b.at);
    return { ok: true, messages };
  },

  async send(token, peerId, text) {
    const r = await igGraph('POST', 'me/messages', token, {
      recipient: JSON.stringify({ id: peerId }),
      message: JSON.stringify({ text }),
    });
    return r.ok ? { ok: true } : fail(r.status, r.error);
  },
};
```

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --import tsx --test tests/instagram-dm.test.ts tests/instagram-publish.test.ts tests/instagram-connect.test.ts`
Expected: PASS. If `instagram-connect.test.ts` asserts the exact scope string, update that assertion to the new three-scope list. That is the intended change.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/social/instagram.ts functions/_lib/social/instagram-dm.ts tests/instagram-dm.test.ts tests/instagram-connect.test.ts
git commit -m "Social DM: Instagram adapter (list, thread, send) and the messaging scope

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: The poll, inside the social tick

**Files:**
- Modify: `functions/_lib/dispatch-log.ts:91`. The `kind` parameter type becomes `'mail' | 'social' | 'social_dm'`.
- Create: `functions/_lib/social-dm-poll.ts`
- Modify: `functions/api/social/dispatch.ts`
- Test: `tests/social-dm-poll.test.ts`

**Interfaces:**
- Consumes: Task 1 constants and `DmThreadRow`; Task 2 `instagramDm`, `peerOf`, `DmAccount`; `usableToken` (`functions/_lib/social/tokens.ts`); `getConnection`, `markBroken` (`functions/_lib/connections.ts`); `startRun`, `finishRun`.
- Produces:
  - `pollDms(env: DmEnv, now: number, origin: string, opts?: { force?: boolean }): Promise<PollSummary>`
  - `DmEnv` = `Env`-compatible object with `DB`, `TOKEN_ENC_KEY`, mail vars.
  - `PollSummary = { skipped?: 'paced' | 'not_connected' | 'needs_scope' | 'token'; fetched: number; updated: number; error?: string }`
  - `dmStatus(env, now): Promise<'ok' | 'not_connected' | 'broken' | 'needs_scope'>`
  - The hook `afterSync` is called with `(env, now, origin)` and is a no-op until Task 4 sets it to `runDmNotifications`.

- [ ] **Step 1: Write the failing test** `tests/social-dm-poll.test.ts`

```ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, stubMail } from './lib/social';
import { stubGraph, type GraphCall } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
import { pollDms } from '../functions/_lib/social-dm-poll';
import { onRequestPost as tick } from '../functions/api/social/dispatch';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const T0 = Date.UTC(2026, 9, 15, 9, 0) / 1000; // 12:00 Istanbul
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';
const iso = (s: number) => new Date(s * 1000).toISOString().replace('.000Z', '+0000');

let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

function world() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never;
  return { ...s, env };
}
async function connect(env: unknown, scopes = 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages') {
  await (await connectionUpsert(env as never, 'instagram', {
    accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null, scopes, expiresAt: T0 + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', T0 - 86400)).run();
}
const threads = (db: import('node:sqlite').DatabaseSync) => db.prepare(`SELECT * FROM social_dm_threads ORDER BY conversation_id`).all() as Record<string, unknown>[];

/** conversations: id -> list of [from id, username, at]. */
function graphWith(convs: Record<string, [string, string | null, number][]>) {
  return (c: GraphCall) => {
    if (c.path === '/me/conversations') {
      return Response.json({ data: Object.entries(convs).map(([id, ms]) => ({ id, updated_time: iso(Math.max(...ms.map((m) => m[2]))) })) });
    }
    const id = c.path.slice(1);
    if (convs[id]) return Response.json({ messages: { data: convs[id].map(([from, username, at], i) => ({ id: `${id}-${i}`, created_time: iso(at), from: { id: from, username }, message: 'gizli metin' })) } });
    return undefined;
  };
}

test('a first poll records each conversation without its text', async () => {
  const { env, db } = world();
  await connect(env);
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]], cB: [['777', null, T0 - 7200], [IG, 'rsg_test', T0 - 3600]] }));
  try { await pollDms(env, T0, ORIGIN); } finally { g.restore(); }
  const rows = threads(db);
  assert.equal(rows.length, 2);
  assert.deepEqual([rows[0].conversation_id, rows[0].peer_id, rows[0].peer_username, rows[0].last_inbound_at, rows[0].last_outbound_at], ['cA', '555', 'ayse', T0 - 600, null]);
  assert.deepEqual([rows[1].peer_id, rows[1].peer_username, rows[1].last_inbound_at, rows[1].last_outbound_at], ['777', null, T0 - 7200, T0 - 3600]);
  assert.ok(!JSON.stringify(rows).includes('gizli'), 'no message text in D1');
  assert.match(String(rows[0].id), /^[0-9a-f-]{36}$/);
});

test('paced: a second poll within five minutes does nothing; force waits 30 seconds', async () => {
  const { env } = world();
  await connect(env);
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]] }));
  try {
    await pollDms(env, T0, ORIGIN);
    assert.equal((await pollDms(env, T0 + 120, ORIGIN)).skipped, 'paced');
    assert.equal((await pollDms(env, T0 + 20, ORIGIN, { force: true })).skipped, 'paced');
    assert.equal((await pollDms(env, T0 + 31, ORIGIN, { force: true })).skipped, undefined);
    assert.equal((await pollDms(env, T0 + 331, ORIGIN)).skipped, undefined);
  } finally { g.restore(); }
});

test('an unchanged conversation is not fetched again; a changed one is', async () => {
  const { env, db } = world();
  await connect(env);
  const convs: Record<string, [string, string | null, number][]> = { cA: [['555', 'ayse', T0 - 600]] };
  const g = stubGraph(graphWith(convs));
  try {
    await pollDms(env, T0, ORIGIN);
    const before = g.calls.length;
    await pollDms(env, T0 + 300, ORIGIN);
    assert.equal(g.calls.length - before, 1, 'list only');
    convs.cA.push([IG, 'rsg_test', T0 + 400]);
    await pollDms(env, T0 + 600, ORIGIN);
  } finally { g.restore(); }
  assert.equal(threads(db)[0].last_outbound_at, T0 + 400, 'answered in the Instagram app is seen');
});

test('at most ten conversation fetches per poll; the rest wait', async () => {
  const { env, db } = world();
  await connect(env);
  const convs: Record<string, [string, string | null, number][]> = {};
  for (let i = 0; i < 13; i++) convs[`c${String(i).padStart(2, '0')}`] = [[`p${i}`, `u${i}`, T0 - 1000 + i]];
  const g = stubGraph(graphWith(convs));
  try {
    const first = await pollDms(env, T0, ORIGIN);
    assert.equal(first.fetched, 10);
    assert.equal(threads(db).length, 10);
    await pollDms(env, T0 + 300, ORIGIN);
  } finally { g.restore(); }
  assert.equal(threads(db).length, 13);
});

test('not connected, or connected without the messaging scope: skipped quietly', async () => {
  const a = world();
  assert.equal((await pollDms(a.env, T0, ORIGIN)).skipped, 'not_connected');
  const b = world();
  await connect(b.env, 'instagram_business_basic,instagram_business_content_publish');
  assert.equal((await pollDms(b.env, T0, ORIGIN)).skipped, 'needs_scope');
});

test('an auth error marks Instagram broken; a transient one does not', async () => {
  const { env, db } = world();
  await connect(env);
  let g = stubGraph(() => Response.json({ error: { code: 4, message: 'busy' } }, { status: 400 }));
  try { await pollDms(env, T0, ORIGIN); } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as { last_error: string | null }).last_error, null);
  g = stubGraph(() => Response.json({ error: { code: 190, message: 'expired' } }, { status: 400 }));
  try { await pollDms(env, T0 + 300, ORIGIN); } finally { g.restore(); }
  assert.ok((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as { last_error: string | null }).last_error);
});

test('the social tick still answers 200 when the DM poll throws', async () => {
  const { env, db } = world();
  await connect(env);
  db.exec('DROP TABLE social_dm_threads');
  const g = stubGraph(graphWith({ cA: [['555', 'ayse', T0 - 600]] }));
  try {
    const res = await tick({ request: new Request(`${ORIGIN}/api/social/dispatch`, { method: 'POST', headers: { 'X-Dispatch-Secret': 'tick' } }), env } as never);
    assert.equal(res.status, 200);
  } finally { g.restore(); }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/social-dm-poll.test.ts`
Expected: FAIL, cannot find module `social-dm-poll`.

- [ ] **Step 3: Widen `startRun`** in `functions/_lib/dispatch-log.ts`

```ts
export async function startRun(db: RunLogDb, id: string, at: number, kind: 'mail' | 'social' | 'social_dm' = 'mail'): Promise<string | null> {
```

- [ ] **Step 4: Write `functions/_lib/social-dm-poll.ts`**

```ts
/**
 * Looks for new Instagram DMs. Runs from the social tick every minute but
 * acts every five (a 'social_dm' row in dispatch_runs marks each run), or on
 * a publisher's Refresh at most every 30 seconds. Records per conversation
 * only who and when (social_dm_threads), never what was written, then hands
 * over to the notifications.
 */
import type { Env } from './auth';
import { getConnection, markBroken } from './connections';
import { usableToken } from './social/tokens';
import { instagramDm, peerOf } from './social/instagram-dm';
import { startRun, finishRun } from './dispatch-log';
import { DM_SCOPE, POLL_EVERY, REFRESH_MIN_GAP, MAX_THREAD_FETCHES } from './social-dm';

export type DmEnv = Pick<Env, 'DB' | 'TOKEN_ENC_KEY' | 'RSG_MAIL_FROM'> & Partial<Env>;
export interface PollSummary { skipped?: 'paced' | 'not_connected' | 'needs_scope' | 'token'; fetched: number; updated: number; error?: string }

/** Task 4 replaces this with the digest and last-call step. */
export let afterSync: (env: DmEnv, now: number, origin: string) => Promise<void> = async () => {};
export function setAfterSync(fn: typeof afterSync): void { afterSync = fn; }

export async function dmStatus(env: DmEnv, now: number): Promise<'ok' | 'not_connected' | 'broken' | 'needs_scope'> {
  const row = await getConnection(env.DB, 'instagram');
  if (!row || !row.access_token_enc) return 'not_connected';
  const scopes = (row.scopes ?? '').split(/[,\s]+/);
  if (!scopes.includes(DM_SCOPE)) return 'needs_scope';
  const tok = await usableToken(env as never, 'instagram', now);
  return tok.ok ? 'ok' : tok.why === 'unused' ? 'not_connected' : 'broken';
}

async function lastRunAt(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT MAX(started_at) AS at FROM dispatch_runs WHERE kind = 'social_dm'`).first<{ at: number | null }>();
  return r?.at ?? 0;
}

export async function pollDms(env: DmEnv, now: number, origin: string, opts: { force?: boolean } = {}): Promise<PollSummary> {
  const summary: PollSummary = { fetched: 0, updated: 0 };
  const gap = opts.force ? REFRESH_MIN_GAP : POLL_EVERY;
  if (now - await lastRunAt(env.DB) < gap) return { ...summary, skipped: 'paced' };

  const status = await dmStatus(env, now);
  if (status === 'not_connected') return { ...summary, skipped: 'not_connected' };
  if (status === 'needs_scope') return { ...summary, skipped: 'needs_scope' };
  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return { ...summary, skipped: 'token' };

  const runId = await startRun(env.DB, crypto.randomUUID(), now, 'social_dm');
  try {
    const list = await instagramDm.listConversations(tok.token);
    if (!list.ok) {
      if (list.kind === 'auth') await markBroken(env.DB, 'instagram', list.reason, now);
      summary.error = `${list.kind}: ${list.reason}`;
      return summary;
    }
    for (const conv of list.conversations) {
      if (summary.fetched >= MAX_THREAD_FETCHES) break;
      const known = await env.DB.prepare(`SELECT id, updated_at FROM social_dm_threads WHERE platform = 'instagram' AND conversation_id = ?`)
        .bind(conv.id).first<{ id: string; updated_at: number }>();
      if (known && known.updated_at >= conv.updatedAt) continue;
      summary.fetched++;
      const th = await instagramDm.thread(tok.token, conv.id, tok.account);
      if (!th.ok) {
        if (th.kind === 'auth') { await markBroken(env.DB, 'instagram', th.reason, now); summary.error = `auth: ${th.reason}`; break; }
        continue;
      }
      const peer = peerOf(th.messages);
      if (!peer || !peer.id) continue;
      const theirs = th.messages.filter((m) => !m.mine).map((m) => m.at);
      const ours = th.messages.filter((m) => m.mine).map((m) => m.at);
      const inbound = theirs.length ? Math.max(...theirs) : null;
      const outbound = ours.length ? Math.max(...ours) : null;
      await env.DB.prepare(`
        INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, updated_at)
        VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?)
        ON CONFLICT (platform, conversation_id) DO UPDATE SET
          peer_id = excluded.peer_id,
          peer_username = COALESCE(excluded.peer_username, social_dm_threads.peer_username),
          last_inbound_at = MAX(COALESCE(social_dm_threads.last_inbound_at, 0), COALESCE(excluded.last_inbound_at, 0)),
          last_outbound_at = MAX(COALESCE(social_dm_threads.last_outbound_at, 0), COALESCE(excluded.last_outbound_at, 0)),
          updated_at = excluded.updated_at`)
        .bind(known?.id ?? crypto.randomUUID(), conv.id, peer.id, peer.username, inbound, outbound, conv.updatedAt).run();
      summary.updated++;
    }
    await afterSync(env, now, origin);
    return summary;
  } catch (err) {
    summary.error = String(err).slice(0, 300);
    throw err;
  } finally {
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), { candidates: summary.fetched, sent: summary.updated, error: summary.error ?? null });
  }
}
```

The `MAX(COALESCE(...,0), ...)` turns a missing time into `0`. `dmView` must then treat 0 as "none". Change the first lines of `dmView` in `functions/_lib/social-dm.ts`:

```ts
  const inbound = row.last_inbound_at || null;
  if (inbound === null) return { unanswered: false, unread: false, expired: false, closesAt: null, secondsLeft: 0 };
```

Also make `digestFresh` and `lastCallDue` safe for `0`. They already go through `open()`, which calls `dmView`, so no change is needed there. Add one line to `tests/social-dm.test.ts`:

```ts
test('a stored 0 means no message', () => {
  assert.equal(dmView(row({ last_inbound_at: 0 }), NOON).unanswered, false);
});
```

The first test asserts `last_outbound_at` is `null`, which matches the upsert because the INSERT path stores the bound `null`. The `MAX` only applies on conflict.

- [ ] **Step 5: Call the poll from the tick.** In `functions/api/social/dispatch.ts`, replace the `try { ... } catch { ... }` block with:

```ts
  let res: Response;
  try {
    const summary = await dispatchSocial(env, now, new URL(request.url).origin);
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), {
      candidates: summary.candidates, planned: summary.claimed, sent: summary.published, failed: summary.failed, retried: summary.waiting,
    });
    res = jsonResponse({ ok: true, ...summary });
  } catch (err) {
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), { error: String(err).slice(0, 300) });
    console.error('social dispatch failed', err);
    res = jsonResponse({ error: 'Dispatch failed', code: 'dispatch_failed' }, 500);
  }
  // DMs after posts, on their own: a DM failure never changes the tick's answer.
  try {
    await pollDms(env, Math.floor(Date.now() / 1000), new URL(request.url).origin);
  } catch (err) {
    console.error('social DM poll failed', err);
  }
  return res;
};
```

Add `import { pollDms } from '../../_lib/social-dm-poll';` and update the doc comment: "...and then looks for new Instagram DMs (social-dm-poll.ts)."

- [ ] **Step 6: Run the tests and see them pass**

Run: `node --import tsx --test tests/social-dm-poll.test.ts tests/social-dm.test.ts tests/social-dispatcher.test.ts tests/dispatch-log.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/_lib/dispatch-log.ts functions/_lib/social-dm-poll.ts functions/_lib/social-dm.ts functions/api/social/dispatch.ts tests/social-dm-poll.test.ts tests/social-dm.test.ts
git commit -m "Social DM: poll Instagram every five minutes from the social tick

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Digest and last-call e-mails

**Files:**
- Create: `functions/_lib/social-dm-notify.ts`
- Modify: `functions/_lib/social-dm-poll.ts`. Set the hook by default: replace the no-op initialiser with `runDmNotifications`, imported from the new file.
- Test: append to `tests/social-dm-poll.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `digestFresh`, `digestList`, `mayDigest`, `lastCallDue`, `dmView`, `DmThreadRow`.
  - `notifyEach`, `publisherEmails` (`functions/_lib/social-notify.ts`).
  - Task 3: `DmEnv`, `afterSync`.
- Produces:
  - `runDmNotifications(env: DmEnv, now: number, origin: string): Promise<{ lastCalls: number; digests: number }>`
  - `dmPanelUrl(origin: string, id: string): string`, which returns `${origin}/tr/admin#sosyal/dm/${id}`
  - `dmDigestText(rows, now, origin)`
  - `dmLastCallText(row, now, origin)`

- [ ] **Step 1: Append the failing tests** to `tests/social-dm-poll.test.ts`

```ts
import { runDmNotifications, dmDigestText } from '../functions/_lib/social-dm-notify';

function seedThread(db: import('node:sqlite').DatabaseSync, o: { id: string; inbound: number; outbound?: number | null; user?: string | null; digested?: number | null; warned?: number | null }) {
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, digested_at, final_warned_at, updated_at)
              VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(o.id, `conv-${o.id}`, `peer-${o.id}`, o.user === undefined ? 'ayse' : o.user, o.inbound, o.outbound ?? null, o.digested ?? null, o.warned ?? null, o.inbound);
}

test('digest: one mail per publisher, nothing to admins when a publisher exists, then paced', async () => {
  const { env, db } = world();
  seedThread(db, { id: 'a', inbound: T0 - 600 });
  const r1 = await runDmNotifications(env, T0, ORIGIN);
  assert.equal(r1.digests, 1);
  assert.deepEqual(mail.sent.map((m) => m.to), ['pub@example.org']);
  assert.match(mail.sent[0].subject, /Instagram/);
  assert.equal((db.prepare(`SELECT digested_at FROM social_dm_threads WHERE id='a'`).get() as { digested_at: number }).digested_at, T0 - 600);
  seedThread(db, { id: 'b', inbound: T0 + 60 });
  assert.equal((await runDmNotifications(env, T0 + 120, ORIGIN)).digests, 0, 'an hour apart');
  assert.equal((await runDmNotifications(env, T0 + 3600, ORIGIN)).digests, 1);
  assert.equal((await runDmNotifications(env, T0 + 7300, ORIGIN)).digests, 0, 'nothing new');
});

test('digest goes to admins when there is no publisher', async () => {
  const { env, db } = world();
  db.prepare(`UPDATE users SET is_social_publisher = 0`).run();
  seedThread(db, { id: 'a', inbound: T0 - 600 });
  await runDmNotifications(env, T0, ORIGIN);
  assert.deepEqual(mail.sent.map((m) => m.to), ['admin@example.org']);
});

test('quiet hours: no digest at 23:30, and the DM is still fresh at 08:00 (R5)', async () => {
  const { env, db } = world();
  const night = Date.UTC(2026, 9, 15, 20, 30) / 1000; // 23:30 Istanbul
  seedThread(db, { id: 'a', inbound: night - 60 });
  assert.equal((await runDmNotifications(env, night, ORIGIN)).digests, 0);
  assert.equal(mail.sent.length, 0);
  const morning = Date.UTC(2026, 9, 16, 5, 0) / 1000; // 08:00
  assert.equal((await runDmNotifications(env, morning, ORIGIN)).digests, 1);
});

test('answered or expired threads never send anything', async () => {
  const { env, db } = world();
  seedThread(db, { id: 'a', inbound: T0 - 600, outbound: T0 - 60 });
  seedThread(db, { id: 'b', inbound: T0 - 30 * 3600 });
  const r = await runDmNotifications(env, T0, ORIGIN);
  assert.deepEqual(r, { lastCalls: 0, digests: 0 });
  assert.equal(mail.sent.length, 0);
});

test('last call: at 20 hours to publishers and admins, at night too, once per message', async () => {
  const { env, db } = world();
  const night = Date.UTC(2026, 9, 15, 21, 0) / 1000; // 00:00 Istanbul
  seedThread(db, { id: 'a', inbound: night - 20 * 3600, digested: night - 20 * 3600 });
  const r = await runDmNotifications(env, night, ORIGIN);
  assert.equal(r.lastCalls, 1);
  assert.deepEqual(mail.sent.map((m) => m.to).sort(), ['admin@example.org', 'pub@example.org']);
  assert.equal((await runDmNotifications(env, night + 300, ORIGIN)).lastCalls, 0);
});

test('digest text: usernames, time left and a link per thread, never message text; unknown sender has a name', () => {
  const at = T0 - 3600;
  const text = dmDigestText([
    { id: 'id-1', platform: 'instagram', conversation_id: 'c', peer_id: 'p', peer_username: 'ayse', last_inbound_at: at, last_outbound_at: null, read_at: null, read_by: null, digested_at: null, final_warned_at: null, updated_at: at },
    { id: 'id-2', platform: 'instagram', conversation_id: 'c2', peer_id: 'p2', peer_username: null, last_inbound_at: at, last_outbound_at: null, read_at: null, read_by: null, digested_at: null, final_warned_at: null, updated_at: at },
  ], T0, ORIGIN);
  assert.match(text.text, /@ayse/);
  assert.match(text.text, /Instagram kullanıcısı/);
  assert.match(text.text, /Instagram user/);
  assert.ok(!text.text.includes('@null'));
  assert.match(text.text, /\/tr\/admin#sosyal\/dm\/id-1/);
  assert.match(text.text, /23 saat/);
  assert.match(text.subject, /2/);
});

test('the digest log keeps two days', async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES ('pub', ?), ('pub', ?)`).run(T0 - 3 * 86400, T0 - 3600);
  await runDmNotifications(env, T0, ORIGIN);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM social_dm_digest_log`).get() as { n: number }).n, 1);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/social-dm-poll.test.ts`
Expected: FAIL, cannot find module `social-dm-notify`.

- [ ] **Step 3: Write `functions/_lib/social-dm-notify.ts`**

```ts
/**
 * The DM inbox's two e-mails (spec §7). The digest tells publishers that new
 * DMs are waiting, at most hourly, six a day, never at night. The last call
 * goes to publishers and admins when a DM has four hours left, at any hour,
 * once per incoming message. Both name senders and times only, never what
 * they wrote, so DM content does not collect in the organisation's Sent folder.
 */
import type { DmEnv } from './social-dm-poll';
import { notifyEach, publisherEmails } from './social-notify';
import { dmView, digestFresh, digestList, mayDigest, lastCallDue, type DmThreadRow } from './social-dm';

export const dmPanelUrl = (origin: string, id: string) => `${origin}/tr/admin#sosyal/dm/${id}`;

const who = (r: DmThreadRow, lang: 'tr' | 'en') => r.peer_username ? `@${r.peer_username}` : lang === 'tr' ? 'Instagram kullanıcısı' : 'Instagram user';
const hoursLeft = (r: DmThreadRow, now: number) => Math.max(1, Math.floor(dmView(r, now).secondsLeft / 3600));
const at = (epoch: number, locale: 'tr-TR' | 'en-GB') => new Date(epoch * 1000).toLocaleString(locale, {
  day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
});

export function dmDigestText(rows: DmThreadRow[], now: number, origin: string): { subject: string; text: string } {
  const n = rows.length;
  const tr = rows.map((r) => `- **${who(r, 'tr')}**, ${at(r.last_inbound_at!, 'tr-TR')}, ${hoursLeft(r, now)} saat kaldı: ${dmPanelUrl(origin, r.id)}`).join('\n');
  const en = rows.map((r) => `- **${who(r, 'en')}**, ${at(r.last_inbound_at!, 'en-GB')}, ${hoursLeft(r, now)} h left: ${dmPanelUrl(origin, r.id)}`).join('\n');
  return {
    subject: `Instagram: ${n} cevaplanmamış mesaj / ${n} unanswered message${n === 1 ? '' : 's'}`,
    text: `@rsgturkey hesabında cevaplanmamış mesajlar var. Instagram bir mesaja yalnızca 24 saat içinde panelden cevap verilmesine izin veriyor.\n\n${tr}\n\n---\n\nThere are unanswered messages on @rsgturkey. Instagram allows answering from the panel only within 24 hours.\n\n${en}`,
  };
}

export function dmLastCallText(r: DmThreadRow, now: number, origin: string): { subject: string; text: string } {
  const h = hoursLeft(r, now);
  return {
    subject: `Son ${h} saat: ${who(r, 'tr')} / Last ${h} h: ${who(r, 'en')}`,
    text: `${who(r, 'tr')} kullanıcısının mesajı ${at(r.last_inbound_at!, 'tr-TR')} tarihinden beri cevap bekliyor. ${h} saat sonra panelden cevap verilemeyecek.\n\n${dmPanelUrl(origin, r.id)}\n\n---\n\nThe message from ${who(r, 'en')} has waited since ${at(r.last_inbound_at!, 'en-GB')}. In ${h} h it can no longer be answered from the panel.\n\n${dmPanelUrl(origin, r.id)}`,
  };
}

async function digestRecipients(db: D1Database): Promise<{ id: string; email: string }[]> {
  const pubs = (await db.prepare(`SELECT id, email FROM users WHERE is_social_publisher = 1`).all<{ id: string; email: string }>()).results;
  if (pubs.length) return pubs;
  return (await db.prepare(`SELECT id, email FROM users WHERE is_admin = 1`).all<{ id: string; email: string }>()).results;
}

export async function runDmNotifications(env: DmEnv, now: number, origin: string): Promise<{ lastCalls: number; digests: number }> {
  const out = { lastCalls: 0, digests: 0 };
  await env.DB.prepare(`DELETE FROM social_dm_digest_log WHERE sent_at < ?`).bind(now - 2 * 86400).run();
  const rows = (await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE platform = 'instagram'`).all<DmThreadRow>()).results;

  for (const r of lastCallDue(rows, now)) {
    const sent = await notifyEach(env as never, await publisherEmails(env.DB), dmLastCallText(r, now, origin));
    if (sent > 0) {
      await env.DB.prepare(`UPDATE social_dm_threads SET final_warned_at = ? WHERE id = ?`).bind(r.last_inbound_at, r.id).run();
      out.lastCalls++;
    }
  }

  const fresh = digestFresh(rows, now);
  if (fresh.length === 0) return out;
  const message = dmDigestText(digestList(rows, now), now, origin);
  for (const person of await digestRecipients(env.DB)) {
    const log = (await env.DB.prepare(`SELECT sent_at FROM social_dm_digest_log WHERE user_id = ?`).bind(person.id).all<{ sent_at: number }>()).results;
    if (!mayDigest(log.map((l) => l.sent_at), now)) continue;
    if (await notifyEach(env as never, [person.email], message) > 0) {
      await env.DB.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES (?, ?)`).bind(person.id, now).run();
      out.digests++;
    }
  }
  // R5: marked only if someone got it, so a quiet-hours DM is still fresh at 08:00.
  if (out.digests > 0) {
    await env.DB.batch(fresh.map((r) => env.DB.prepare(`UPDATE social_dm_threads SET digested_at = ? WHERE id = ?`).bind(r.last_inbound_at, r.id)));
  }
  return out;
}
```

- [ ] **Step 4: Wire the hook.** In `functions/_lib/social-dm-poll.ts`, add the import and replace the no-op default:

```ts
import { runDmNotifications } from './social-dm-notify';
...
export let afterSync: (env: DmEnv, now: number, origin: string) => Promise<void> = async (env, now, origin) => { await runDmNotifications(env, now, origin); };
```

The two modules import each other: `social-dm-notify` imports only the `DmEnv` type from `social-dm-poll`. Use `import type` there, as written, so there is no runtime cycle.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --import tsx --test tests/social-dm-poll.test.ts tests/social-dm.test.ts tests/social-notify.test.ts`
Expected: PASS. The Task 3 tests still pass: they seed no publisher-visible fresh threads beyond what they check, and mail is stubbed.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/social-dm-notify.ts functions/_lib/social-dm-poll.ts tests/social-dm-poll.test.ts
git commit -m "Social DM: hourly digest to publishers and a last call at 20 hours

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: DM API endpoints and the count

**Files:**
- Create:
  - `functions/api/admin/social/dm/index.ts`
  - `functions/api/admin/social/dm/[id].ts`
  - `functions/api/admin/social/dm/[id]/reply.ts`
  - `functions/api/admin/social/dm/refresh.ts`
- Modify: `functions/api/admin/counts.ts`
- Test: `tests/social-dm-api.test.ts`; update `tests/admin-counts.test.ts`, whose admin `deepEqual` gains `dm: 0`.

**Interfaces:**
- Consumes: Task 1 `dmView`, `MAX_REPLY_BYTES`, `DmThreadRow`; Task 2 `instagramDm`; Task 3 `dmStatus`, `pollDms`; `usableToken`, `markBroken`, `appendAudit`, `getConnection`.
- Produces the HTTP contract used by Task 7:
  - `GET /api/admin/social/dm` returns `{ status, account: string | null, linkedin: boolean, threads: ThreadOut[] }`, where `ThreadOut = { id, username: string | null, lastInboundAt: number | null, lastOutboundAt: number | null, lastAt: number, unanswered, unread, expired, closesAt: number | null, secondsLeft }`.
  - `GET /api/admin/social/dm/:id` returns `{ thread: ThreadOut, messages: { id, at, mine, text, attachments: string[] }[] | null, error?: 'window' | 'auth' | 'transient' | 'refused' | 'connection' }`.
  - `POST /api/admin/social/dm/:id/reply` takes `{ text }` and returns `{ ok: true }`, or `{ error, code }` where `code` is one of `empty | too_long | window_closed | connection | unavailable | refused | not_found`.
  - `POST /api/admin/social/dm/refresh` returns `{ ok: true, skipped?: string }`.
  - `counts.dm` holds the number of unread threads that can still be answered.

- [ ] **Step 1: Write the failing test** `tests/social-dm-api.test.ts`

```ts
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call, stubMail } from './lib/social';
import { stubGraph } from './lib/instagram';
import { connectionUpsert } from '../functions/_lib/connections';
import { onRequestGet as list } from '../functions/api/admin/social/dm/index';
import { onRequestGet as thread } from '../functions/api/admin/social/dm/[id]';
import { onRequestPost as reply } from '../functions/api/admin/social/dm/[id]/reply';
import { onRequestPost as refresh } from '../functions/api/admin/social/dm/refresh';
import { onRequestGet as counts } from '../functions/api/admin/counts';

const KEY = Buffer.alloc(32, 1).toString('base64');
const IG = '17841400000000000';
const now = () => Math.floor(Date.now() / 1000);
let mail: ReturnType<typeof stubMail>;
beforeEach(() => { mail = stubMail(); });
afterEach(() => mail.restore());

async function world(opts: { connected?: boolean } = {}) {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, MAIL_SYNC_SECRET: 'tick' } as never;
  if (opts.connected !== false) {
    await (await connectionUpsert(env, 'instagram', {
      accountId: IG, accountName: 'rsg_test', accessToken: 'tok', refreshToken: null,
      scopes: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_messages',
      expiresAt: now() + 50 * 86400, refreshExpiresAt: null,
    }, 'admin', now() - 86400)).run();
  }
  const t = now();
  s.db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, updated_at) VALUES
    ('open1','instagram','convA','555','ayse',?,NULL,?),
    ('old1','instagram','convB','777',NULL,?,NULL,?),
    ('done1','instagram','convC','888','mehmet',?,?,?)`).run(t - 3600, t, t - 30 * 3600, t, t - 7200, t - 60, t);
  return { ...s, env };
}

test('editors and members are refused on every endpoint; publishers and admins are let in', async () => {
  const { env } = await world();
  for (const as of ['ed', 'mem']) {
    assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as })).status, 403, as);
    assert.equal((await call(thread, 'GET', '/api/admin/social/dm/open1', { env, as, params: { id: 'open1' } })).status, 403, as);
    assert.equal((await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as, params: { id: 'open1' }, body: { text: 'x' } })).status, 403, as);
    assert.equal((await call(refresh, 'POST', '/api/admin/social/dm/refresh', { env, as })).status, 403, as);
  }
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env })).status, 401);
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).status, 200);
  assert.equal((await call(list, 'GET', '/api/admin/social/dm', { env, as: 'admin' })).status, 200);
});

test('the list: newest first, derived state, the account name; no conversation ids', async () => {
  const { env } = await world();
  const body = await (await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).json() as any;
  assert.equal(body.status, 'ok');
  assert.equal(body.account, 'rsg_test');
  assert.deepEqual(body.threads.map((t: any) => t.id), ['done1', 'open1', 'old1']);
  const byId = Object.fromEntries(body.threads.map((t: any) => [t.id, t]));
  assert.deepEqual([byId.open1.unread, byId.open1.unanswered, byId.open1.expired], [true, true, false]);
  assert.equal(byId.old1.expired, true);
  assert.equal(byId.done1.unanswered, false);
  assert.ok(!JSON.stringify(body).includes('convA'));
});

test('not connected: status says so and the list still answers', async () => {
  const { env } = await world({ connected: false });
  const body = await (await call(list, 'GET', '/api/admin/social/dm', { env, as: 'pub' })).json() as any;
  assert.equal(body.status, 'not_connected');
});

test('opening a thread fetches it live and marks it read for everyone', async () => {
  const { env, db } = await world();
  const g = stubGraph((c) => (c.path === '/convA' ? Response.json({ messages: { data: [
    { id: 'm1', created_time: new Date((now() - 3600) * 1000).toISOString().replace('.000Z', '+0000'), from: { id: '555', username: 'ayse' }, message: 'Merhaba <b>' },
  ] } }) : undefined));
  let body: any;
  try { body = await (await call(thread, 'GET', '/api/admin/social/dm/open1', { env, as: 'pub', params: { id: 'open1' } })).json(); } finally { g.restore(); }
  assert.equal(body.messages[0].text, 'Merhaba <b>');
  assert.equal(body.messages[0].mine, false);
  const r = db.prepare(`SELECT read_at, read_by FROM social_dm_threads WHERE id = 'open1'`).get() as { read_at: number; read_by: string };
  assert.ok(r.read_at > 0);
  assert.equal(r.read_by, 'pub');
  assert.equal((await call(thread, 'GET', '/api/admin/social/dm/nope', { env, as: 'pub', params: { id: 'nope' } })).status, 404);
});

test('a reply goes out, is audited without its text, and marks the thread answered', async () => {
  const { env, db } = await world();
  const g = stubGraph((c) => (c.method === 'POST' && c.path === '/me/messages' ? Response.json({ message_id: 'x' }) : undefined));
  let res: Response;
  try { res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: '  Teşekkürler!  ' } }); } finally { g.restore(); }
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(g.calls[0].params.get('message')!).text, 'Teşekkürler!');
  assert.ok((db.prepare(`SELECT last_outbound_at FROM social_dm_threads WHERE id='open1'`).get() as { last_outbound_at: number }).last_outbound_at > 0);
  const audit = db.prepare(`SELECT action, target_id, details FROM audit_log WHERE action = 'social.dm.reply'`).get() as any;
  assert.equal(audit.target_id, 'open1');
  assert.ok(!String(audit.details ?? '').includes('Teşekkürler'));
});

test('reply checks: empty, 1000 bytes of ş allowed, 1001 refused, expired refused without calling Meta', async () => {
  const { env } = await world();
  const g = stubGraph((c) => (c.path === '/me/messages' ? Response.json({ message_id: 'x' }) : undefined));
  try {
    const send = (id: string, text: string) => call(reply, 'POST', `/api/admin/social/dm/${id}/reply`, { env, as: 'pub', params: { id }, body: { text } });
    assert.equal((await (await send('open1', '   ')).json() as any).code, 'empty');
    assert.equal((await send('open1', 'ş'.repeat(500))).status, 200);
    assert.equal((await (await send('open1', 'ş'.repeat(500) + 'a')).json() as any).code, 'too_long');
    const before = g.calls.length;
    const late = await send('old1', 'geç');
    assert.equal(late.status, 409);
    assert.equal((await late.json() as any).code, 'window_closed');
    assert.equal(g.calls.length, before);
  } finally { g.restore(); }
});

test('Meta says the window closed: 409, and the connection is not broken (R3)', async () => {
  const { env, db } = await world();
  const g = stubGraph(() => Response.json({ error: { code: 10, error_subcode: 2534022, message: 'outside window' } }, { status: 400 }));
  let res: Response;
  try { res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: 'x' } }); } finally { g.restore(); }
  assert.equal(res.status, 409);
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform='instagram'`).get() as any).last_error, null);
});

test('CSRF: a cross-site reply is refused', async () => {
  const { env } = await world();
  const res = await call(reply, 'POST', '/api/admin/social/dm/open1/reply', { env, as: 'pub', params: { id: 'open1' }, body: { text: 'x' }, headers: { Origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});

test('counts: dm is unread and still answerable, for publishers only', async () => {
  const { env } = await world();
  assert.equal((await (await call(counts, 'GET', '/api/admin/counts', { env, as: 'pub' })).json() as any).dm, 1);
  assert.equal((await (await call(counts, 'GET', '/api/admin/counts', { env, as: 'ed' })).json() as any).dm, undefined);
});

test('refresh runs a forced poll', async () => {
  const { env } = await world();
  const g = stubGraph((c) => (c.path === '/me/conversations' ? Response.json({ data: [] }) : undefined));
  try {
    const res = await call(refresh, 'POST', '/api/admin/social/dm/refresh', { env, as: 'pub' });
    assert.equal(res.status, 200);
    assert.equal(g.calls[0].path, '/me/conversations');
  } finally { g.restore(); }
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/social-dm-api.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the shared helper and the endpoints**

`functions/api/admin/social/dm/index.ts`:

```ts
/**
 * DM inbox list (spec §8): the conversations the poll has seen, newest
 * first, with their derived state. Publishers and admins only. The
 * platform's conversation id stays on the server; links use our own id.
 */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish } from '../../../../_lib/auth';
import { getConnection } from '../../../../_lib/connections';
import { dmView, type DmThreadRow } from '../../../../_lib/social-dm';
import { dmStatus } from '../../../../_lib/social-dm-poll';

export function threadOut(r: DmThreadRow, now: number) {
  const v = dmView(r, now);
  return {
    id: r.id, username: r.peer_username,
    lastInboundAt: r.last_inbound_at || null, lastOutboundAt: r.last_outbound_at || null,
    lastAt: Math.max(r.last_inbound_at ?? 0, r.last_outbound_at ?? 0),
    ...v,
  };
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const [status, ig, li] = await Promise.all([dmStatus(env, now), getConnection(env.DB, 'instagram'), getConnection(env.DB, 'linkedin')]);
  const rows = (await env.DB.prepare(
    `SELECT * FROM social_dm_threads WHERE platform = 'instagram'
     ORDER BY MAX(COALESCE(last_inbound_at, 0), COALESCE(last_outbound_at, 0)) DESC LIMIT 100`,
  ).all<DmThreadRow>()).results;
  return jsonResponse({
    status, account: ig?.account_name ?? null, linkedin: !!li?.access_token_enc,
    threads: rows.map((r) => threadOut(r, now)),
  });
};
```

`functions/api/admin/social/dm/[id].ts`:

```ts
/** One DM conversation, fetched live from Instagram; opening it marks it read for the whole team. */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish } from '../../../../_lib/auth';
import { markBroken } from '../../../../_lib/connections';
import { usableToken } from '../../../../_lib/social/tokens';
import { instagramDm } from '../../../../_lib/social/instagram-dm';
import type { DmThreadRow } from '../../../../_lib/social-dm';
import { threadOut } from './index';

export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const id = String(params.id ?? '');
  const row = await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE id = ?`).bind(id).first<DmThreadRow>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  const now = Math.floor(Date.now() / 1000);
  if (row.last_inbound_at) {
    await env.DB.prepare(`UPDATE social_dm_threads SET read_at = ?, read_by = ? WHERE id = ?`).bind(now, user.id, id).run();
    row.read_at = now;
  }
  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return jsonResponse({ thread: threadOut(row, now), messages: null, error: 'connection' });
  const th = await instagramDm.thread(tok.token, row.conversation_id, tok.account);
  if (!th.ok) {
    if (th.kind === 'auth') await markBroken(env.DB, 'instagram', th.reason, now);
    return jsonResponse({ thread: threadOut(row, now), messages: null, error: th.kind });
  }
  return jsonResponse({
    thread: threadOut(row, now),
    messages: th.messages.map((m) => ({ id: m.id, at: m.at, mine: m.mine, text: m.text, attachments: m.attachments })),
  });
};
```

`functions/api/admin/social/dm/[id]/reply.ts`:

```ts
/**
 * Answer a DM from the panel. Refused once 24 hours have passed since the
 * person's newest message (Meta would refuse it anyway), and checked again
 * against Meta's own answer. Audited with the actor and thread, never the text.
 */
import type { Env } from '../../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish, checkCsrf } from '../../../../../_lib/auth';
import { markBroken } from '../../../../../_lib/connections';
import { appendAudit } from '../../../../../_lib/audit';
import { usableToken } from '../../../../../_lib/social/tokens';
import { instagramDm } from '../../../../../_lib/social/instagram-dm';
import { dmView, MAX_REPLY_BYTES, type DmThreadRow } from '../../../../../_lib/social-dm';

export const onRequestPost: PagesFunction<Env> = async ({ request, env, params }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  const id = String(params.id ?? '');
  const row = await env.DB.prepare(`SELECT * FROM social_dm_threads WHERE id = ?`).bind(id).first<DmThreadRow>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);

  const body = await request.json().catch(() => null) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return jsonResponse({ error: 'Empty', code: 'empty' }, 400);
  if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES) return jsonResponse({ error: 'Too long', code: 'too_long' }, 400);

  const now = Math.floor(Date.now() / 1000);
  const v = dmView(row, now);
  if (v.closesAt === null || v.expired) return jsonResponse({ error: 'Window closed', code: 'window_closed' }, 409);

  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return jsonResponse({ error: 'Connection', code: 'connection' }, 503);
  const sent = await instagramDm.send(tok.token, row.peer_id, text);
  if (!sent.ok) {
    if (sent.kind === 'window') return jsonResponse({ error: 'Window closed', code: 'window_closed' }, 409);
    if (sent.kind === 'auth') { await markBroken(env.DB, 'instagram', sent.reason, now); return jsonResponse({ error: 'Connection', code: 'connection' }, 503); }
    if (sent.kind === 'transient') return jsonResponse({ error: 'Unavailable', code: 'unavailable' }, 503);
    return jsonResponse({ error: 'Refused', code: 'refused' }, 422);
  }
  await env.DB.prepare(`UPDATE social_dm_threads SET last_outbound_at = ?, read_at = ?, read_by = ? WHERE id = ?`).bind(now, now, user.id, id).run();
  await appendAudit(env.DB, { userId: user.id, action: 'social.dm.reply', targetType: 'social_dm', targetId: id, details: { platform: 'instagram', bytes: new TextEncoder().encode(text).length } }, now);
  return jsonResponse({ ok: true });
};
```

`functions/api/admin/social/dm/refresh.ts`:

```ts
/** Refresh in the DM tab: a poll now, at most every 30 seconds (shared, plan ruling R2). */
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, canSocialPublish, checkCsrf } from '../../../../_lib/auth';
import { pollDms } from '../../../../_lib/social-dm-poll';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!canSocialPublish(user)) return jsonResponse({ error: 'Forbidden' }, 403);
  try {
    const s = await pollDms(env, Math.floor(Date.now() / 1000), new URL(request.url).origin, { force: true });
    return jsonResponse({ ok: true, skipped: s.skipped });
  } catch (err) {
    console.error('DM refresh failed', err);
    return jsonResponse({ error: 'Unavailable', code: 'unavailable' }, 503);
  }
};
```

Check before writing: confirm the relative import depth by matching an existing file at the same depth, e.g. `functions/api/admin/social/plan-reminders.ts` imports `../../../_lib/...`. `dm/index.ts` is one level deeper, so it uses `../../../../_lib`. `dm/[id]/reply.ts` uses `../../../../../_lib`.

- [ ] **Step 4: Add the count.** In `functions/api/admin/counts.ts`, after the `social` line:

```ts
  if (publisher) await count('dm', `SELECT COUNT(*) AS n FROM social_dm_threads
    WHERE last_inbound_at > COALESCE(last_outbound_at, 0) AND last_inbound_at > ? AND COALESCE(read_at, 0) < last_inbound_at`, now - 86400);
```

In `tests/admin-counts.test.ts`, the admin case becomes `{ email: 1, social: 1, dm: 0, blog: 1, scheduledThisWeek: 1 }`. Key order does not matter to `deepEqual`. Apply the same change to any other `deepEqual` on a publisher's counts in that file.

- [ ] **Step 5: Run the tests and see them pass**

Run: `node --import tsx --test tests/social-dm-api.test.ts tests/admin-counts.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/api/admin/social/dm functions/api/admin/counts.ts tests/social-dm-api.test.ts tests/admin-counts.test.ts
git commit -m "Social DM: list, thread, reply and refresh endpoints for publishers; unread DM count

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Login return path

**Files:**
- Create: `functions/_lib/next-path.ts`
- Modify:
  - `functions/auth/login.ts`
  - `functions/auth/callback.ts` (the final redirect; clear the cookie on every exit that sets a session)
  - `src/components/admin/AdminShell.astro:64`: give the sign-in `<a>` an `id="notSignedInLink"`
  - `src/scripts/admin/main.ts`, in the signed-out branch
  - `src/i18n/ui.ts`: `admin.notSignedIn.message` in both languages
- Test: `tests/next-path.test.ts`

**Interfaces:**
- Produces:
  - `safeNext(v: unknown): string | null`
  - `NEXT_COOKIE`
  - `nextCookie(v): string`
  - `clearNextCookie(): string`
  - `readNext(request): string | null`
  - `/auth/login?next=<encoded path+hash>`

- [ ] **Step 1: Write the failing test** `tests/next-path.test.ts`

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext, readNext, nextCookie } from '../functions/_lib/next-path';
import { onRequestGet as login } from '../functions/auth/login';

test('allowed: admin and account paths, with search and hash', () => {
  assert.equal(safeNext('/tr/admin#sosyal/dm/abc-1'), '/tr/admin#sosyal/dm/abc-1');
  assert.equal(safeNext('/admin'), '/admin');
  assert.equal(safeNext('/account/mail?x=1'), '/account/mail?x=1');
  assert.equal(safeNext('/tr/account'), '/tr/account');
});

test('refused: other sites, other paths, tricks', () => {
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example/admin', 'javascript:alert(1)', '/admin/../../blog',
    '/blog', '/administrator', '', '/%2F%2Fevil.example', '/admin\nSet-Cookie: x', null, 42, '/' + 'a'.repeat(600)]) {
    assert.equal(safeNext(bad), null, String(bad));
  }
});

test('the cookie round-trips and is HttpOnly, path /auth, ten minutes', () => {
  const c = nextCookie('/tr/admin#sosyal/dm/x');
  assert.match(c, /HttpOnly/);
  assert.match(c, /Path=\/auth/);
  assert.match(c, /Max-Age=600/);
  const value = c.split(';')[0];
  assert.equal(readNext(new Request('https://x.example/auth/callback', { headers: { Cookie: `a=b; ${value}` } })), '/tr/admin#sosyal/dm/x');
  assert.equal(readNext(new Request('https://x.example/auth/callback', { headers: { Cookie: 'rsg_next=%2F%2Fevil.example' } })), null);
});

test('login stores a valid next and ignores a bad one', async () => {
  const env = { GOOGLE_CLIENT_ID: 'c' } as never;
  const ok = await login({ request: new Request('https://rsg-turkiye.iscbsc.org/auth/login?next=%2Ftr%2Fadmin%23sosyal%2Fdm%2Fx'), env } as never);
  assert.match(ok.headers.get('Set-Cookie') ?? '', /^rsg_next=/);
  const bad = await login({ request: new Request('https://rsg-turkiye.iscbsc.org/auth/login?next=%2F%2Fevil.example'), env } as never);
  assert.equal(bad.headers.get('Set-Cookie'), null);
  assert.match(bad.headers.get('Location') ?? '', /^https:\/\/accounts\.google\.com\//);
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/next-path.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `functions/_lib/next-path.ts`**

```ts
/**
 * Where to go after signing in. The admin panel's address carries its place
 * in the fragment (#sosyal/dm/<id>), which never reaches the server, so the
 * page sends it as ?next= to /auth/login, which keeps it for ten minutes in a
 * cookie that only /auth/* sees. Only this site's own panel and account
 * pages are accepted: anything else would make sign-in an open redirect.
 */
export const NEXT_COOKIE = 'rsg_next';
const BASE = 'https://next.invalid';
const ALLOWED = /^\/(tr\/)?(admin|account)(\/|$)/;

export function safeNext(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f]/.test(v)) return null;
  let u: URL;
  try { u = new URL(v, BASE); } catch { return null; }
  if (u.origin !== BASE) return null;
  if (!ALLOWED.test(u.pathname) || u.pathname.includes('%2F') || u.pathname.includes('%2f')) return null;
  // The normalised path must be what was asked for: "/admin/../../blog" is not.
  if (!v.startsWith(u.pathname)) return null;
  return u.pathname + u.search + u.hash;
}

export const nextCookie = (v: string) => `${NEXT_COOKIE}=${encodeURIComponent(v)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
export const clearNextCookie = () => `${NEXT_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readNext(request: Request): string | null {
  const raw = (request.headers.get('Cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${NEXT_COOKIE}=`));
  if (!raw) return null;
  try { return safeNext(decodeURIComponent(raw.slice(NEXT_COOKIE.length + 1))); } catch { return null; }
}
```

- [ ] **Step 4: `functions/auth/login.ts`.** Replace the final `return`:

```ts
  const google = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  const next = safeNext(new URL(request.url).searchParams.get('next'));
  return next ? redirectResponse(google, { 'Set-Cookie': nextCookie(next) }) : redirectResponse(google);
```

Add `import { safeNext, nextCookie } from '../_lib/next-path';`.

- [ ] **Step 5: `functions/auth/callback.ts`.** Add `import { readNext, clearNextCookie } from '../_lib/next-path';`.

Replace the new-user redirect:

```ts
    const res = redirectResponse(`${base}/account/setup`, { 'Set-Cookie': sessionCookie(token, expires) });
    res.headers.append('Set-Cookie', clearNextCookie());
    return res;
```

Replace the final block:

```ts
  const { token, expires } = await createSession(user.id, env);
  // A new profile is set up first; otherwise back to the page that sent them to sign in.
  const next = profile ? readNext(request) : null;
  const dest = profile ? `${base}${next ?? '/account'}` : `${base}/account/setup`;
  const res = redirectResponse(dest, { 'Set-Cookie': sessionCookie(token, expires) });
  res.headers.append('Set-Cookie', clearNextCookie());
  return res;
```

Append a test to `tests/next-path.test.ts`. If there is no existing callback test harness, skip the end-to-end callback test, because it needs Google stubbed. Instead, check with `readNext` (already tested) and run `npx astro check` to confirm the types.

- [ ] **Step 6: Admin sign-in link.** In `src/components/admin/AdminShell.astro`, add `id="notSignedInLink"` to the `<a>` inside `#notSignedIn`. In `src/scripts/admin/main.ts`, inside `if (!data.user) {` before `return`:

```ts
    // Back to this exact place after Google: the fragment never reaches the server, so it travels as ?next=.
    document.getElementById('notSignedInLink')?.setAttribute('href', `/auth/login?next=${encodeURIComponent(location.pathname + location.hash)}`);
```

In `src/i18n/ui.ts`, set `admin.notSignedIn.message` to:
- en: `'You need to sign in to view this page.'`
- tr: `'Bu sayfayı görüntülemek için giriş yapmanız gerekiyor.'`

- [ ] **Step 7: Run tests and type check**

Run: `node --import tsx --test tests/next-path.test.ts` and `npx astro check`
Expected: PASS, and `0 errors`.

- [ ] **Step 8: Commit**

```bash
git add functions/_lib/next-path.ts functions/auth/login.ts functions/auth/callback.ts src/components/admin/AdminShell.astro src/scripts/admin/main.ts src/i18n/ui.ts tests/next-path.test.ts
git commit -m "Sign-in returns to the admin page that asked for it (next cookie, own paths only)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Panel: the DM sub-tab

**Files:**
- Modify:
  - `src/scripts/admin/sections.ts`
  - `src/scripts/admin/overview.ts`
  - `src/components/admin/panes/SocialPane.astro`
  - `src/scripts/admin/main.ts`
  - `src/i18n/ui.ts`
- Create: `src/scripts/admin/sections/social-dm.ts`
- Test:
  - `tests/admin-sections.test.ts`: add one test.
  - `tests/admin-social-i18n.test.ts`: extend the key scan to `src/scripts/admin/sections/social-dm.ts`.
  - Browser: `tests/browser/admin-social-dm.mjs`.

**Interfaces:**
- Consumes: the Task 5 HTTP contract. Also `goBack`, `refreshCounts` (`../shell`), `chip`, `guardUnsaved`, `toast` (`../ui-kit`), `t`, `tf`, `dateLocale` (`../context`), `formatIstanbul` (`src/lib/istanbul-time.ts`), `escapeHtml` (`src/scripts/escape-html.ts`).
- Produces:
  - `setupDm(): void`
  - `showDm(item: string | null): Promise<void>`
  - `utf8Bytes(s: string): number` (exported for the unit test)

- [ ] **Step 1: Write the failing unit test.** Append to `tests/admin-sections.test.ts`:

```ts
test('the DM tab is for publishers and admins, with its own count', () => {
  const sosyal = SECTIONS.find((s) => s.id === 'sosyal')!;
  const dm = sosyal.subs.find((s) => s.id === 'dm')!;
  assert.equal(dm.publisherOnly, true);
  assert.equal(dm.count, 'dm');
  const base = { admin: false, announcer: false, symposium: false, social: true, socialPublisher: false, sender: false };
  assert.ok(!subsFor(sosyal, base).some((s) => s.id === 'dm'), 'editor');
  assert.ok(subsFor(sosyal, { ...base, socialPublisher: true }).some((s) => s.id === 'dm'), 'publisher');
  assert.ok(subsFor(sosyal, { ...base, social: false, admin: true }).some((s) => s.id === 'dm'), 'admin');
});
```

Add the imports `SECTIONS` and `subsFor` if the file does not already have them.

Append to `tests/admin-social-i18n.test.ts`:

```ts
test('every key the DM tab looks up exists', () => {
  const src = readFileSync(new URL('../src/scripts/admin/sections/social-dm.ts', import.meta.url), 'utf8');
  const used = [...src.matchAll(/'(admin\.[\w.]+)'/g)].map((m) => m[1]);
  assert.ok(used.length > 10);
  for (const k of used) assert.ok(has(k), `missing ${k}`);
  for (const c of ['empty', 'too_long', 'window_closed', 'connection', 'unavailable', 'refused', 'not_found']) assert.ok(has(`admin.social.dm.error.${c}`), c);
  for (const s of ['not_connected', 'broken', 'needs_scope']) assert.ok(has(`admin.social.dm.status.${s}`), s);
});

test('utf8Bytes counts what the server counts', async () => {
  const { utf8Bytes } = await import('../src/scripts/admin/sections/social-dm');
  assert.equal(utf8Bytes('ş'.repeat(500)), 1000);
  assert.equal(utf8Bytes('😀'), 4);
});
```

`social-dm.ts` touches `document` only inside functions, never at import time, so importing it under node works. Keep it that way.

- [ ] **Step 2: Run the tests and see them fail**

Run: `node --import tsx --test tests/admin-sections.test.ts tests/admin-social-i18n.test.ts`
Expected: FAIL.

- [ ] **Step 3: Registry and overview.** In `src/scripts/admin/sections.ts`:

```ts
export type CountKey = 'email' | 'social' | 'blog' | 'membership' | 'dm';
```

Add a sub after `etkinlik`:

```ts
      { id: 'dm', label: 'admin.social.tab.dm', publisherOnly: true, count: 'dm' },
```

In `src/scripts/admin/overview.ts`, add to `CARDS` after the social card:

```ts
  { key: 'dm', section: 'sosyal/dm', label: 'admin.overview.dm' },
```

- [ ] **Step 4: i18n.** In `src/i18n/ui.ts`:
- **en**, after `'admin.social.tab.events'` (line 696):

```ts
    'admin.social.tab.dm': 'Messages',
    'admin.social.dm.intro': 'Direct messages to the organisation\'s Instagram. Instagram allows an answer only within 24 hours of the person\'s last message.',
    'admin.social.dm.refresh': 'Refresh',
    'admin.social.dm.filter.unanswered': 'Unanswered',
    'admin.social.dm.filter.all': 'All',
    'admin.social.dm.empty': 'No messages.',
    'admin.social.dm.select': 'Choose a conversation.',
    'admin.social.dm.back': 'Messages',
    'admin.social.dm.unknownUser': 'Instagram user',
    'admin.social.dm.answered': 'Answered',
    'admin.social.dm.unread': 'New',
    'admin.social.dm.hoursLeft': '{n} h left',
    'admin.social.dm.expired': 'Expired',
    'admin.social.dm.you': 'RSG-Türkiye',
    'admin.social.dm.attachment': 'Open attachment',
    'admin.social.dm.only20': 'Instagram shows only the 20 newest messages of a conversation.',
    'admin.social.dm.openInstagram': 'Open in Instagram',
    'admin.social.dm.placeholder': 'Write an answer',
    'admin.social.dm.bytes': '{n} / 1000',
    'admin.social.dm.send': 'Send',
    'admin.social.dm.sending': 'Sending…',
    'admin.social.dm.sent': 'Answer sent.',
    'admin.social.dm.closed': '24 hours have passed. Answer from the Instagram app.',
    'admin.social.dm.loadFailed': 'Messages could not be loaded.',
    'admin.social.dm.threadFailed': 'Could not reach Instagram. Try Refresh in a moment.',
    'admin.social.dm.linkedin': 'LinkedIn page messages cannot be read here.',
    'admin.social.dm.linkedinOpen': 'Open LinkedIn',
    'admin.social.dm.status.not_connected': 'Instagram is not connected. An admin can connect it in Connections.',
    'admin.social.dm.status.broken': 'The Instagram connection is not working. An admin can reconnect it in Connections.',
    'admin.social.dm.status.needs_scope': 'Reconnect Instagram in Connections to read messages here.',
    'admin.social.dm.error.empty': 'Write something first.',
    'admin.social.dm.error.too_long': 'Too long: Instagram allows 1000 bytes.',
    'admin.social.dm.error.window_closed': '24 hours have passed. Answer from the Instagram app.',
    'admin.social.dm.error.connection': 'The Instagram connection is not working.',
    'admin.social.dm.error.unavailable': 'Instagram did not answer. Your text is kept; try again.',
    'admin.social.dm.error.refused': 'Instagram refused this answer.',
    'admin.social.dm.error.not_found': 'This conversation no longer exists.',
```

- **en**, after `'admin.overview.social'`: `'admin.overview.dm': '{n} unread Instagram messages',`
- **tr**, after `'admin.social.tab.events'` (line 1740):

```ts
    'admin.social.tab.dm': 'Mesajlar',
    'admin.social.dm.intro': 'Derneğin Instagram hesabına gelen mesajlar. Instagram, kişinin son mesajından sonraki 24 saat içinde cevap vermeye izin veriyor.',
    'admin.social.dm.refresh': 'Yenile',
    'admin.social.dm.filter.unanswered': 'Cevaplanmamış',
    'admin.social.dm.filter.all': 'Tümü',
    'admin.social.dm.empty': 'Mesaj yok.',
    'admin.social.dm.select': 'Bir konuşma seç.',
    'admin.social.dm.back': 'Mesajlar',
    'admin.social.dm.unknownUser': 'Instagram kullanıcısı',
    'admin.social.dm.answered': 'Cevaplandı',
    'admin.social.dm.unread': 'Yeni',
    'admin.social.dm.hoursLeft': '{n} saat kaldı',
    'admin.social.dm.expired': 'Süresi doldu',
    'admin.social.dm.you': 'RSG-Türkiye',
    'admin.social.dm.attachment': 'Eki aç',
    'admin.social.dm.only20': 'Instagram bir konuşmanın yalnızca son 20 mesajını gösteriyor.',
    'admin.social.dm.openInstagram': 'Instagram\'da aç',
    'admin.social.dm.placeholder': 'Cevap yaz',
    'admin.social.dm.bytes': '{n} / 1000',
    'admin.social.dm.send': 'Gönder',
    'admin.social.dm.sending': 'Gönderiliyor…',
    'admin.social.dm.sent': 'Cevap gönderildi.',
    'admin.social.dm.closed': '24 saat geçti. Instagram uygulamasından cevap ver.',
    'admin.social.dm.loadFailed': 'Mesajlar yüklenemedi.',
    'admin.social.dm.threadFailed': 'Instagram\'a ulaşılamadı. Birazdan Yenile\'yi dene.',
    'admin.social.dm.linkedin': 'LinkedIn sayfa mesajları burada okunamıyor.',
    'admin.social.dm.linkedinOpen': 'LinkedIn\'i aç',
    'admin.social.dm.status.not_connected': 'Instagram bağlı değil. Bir admin Bağlantılar sekmesinden bağlayabilir.',
    'admin.social.dm.status.broken': 'Instagram bağlantısı çalışmıyor. Bir admin Bağlantılar sekmesinden yeniden bağlayabilir.',
    'admin.social.dm.status.needs_scope': 'Mesajları burada okumak için Instagram\'ı Bağlantılar sekmesinden yeniden bağla.',
    'admin.social.dm.error.empty': 'Önce bir şey yaz.',
    'admin.social.dm.error.too_long': 'Çok uzun: Instagram 1000 bayta izin veriyor.',
    'admin.social.dm.error.window_closed': '24 saat geçti. Instagram uygulamasından cevap ver.',
    'admin.social.dm.error.connection': 'Instagram bağlantısı çalışmıyor.',
    'admin.social.dm.error.unavailable': 'Instagram cevap vermedi. Metnin duruyor, yeniden dene.',
    'admin.social.dm.error.refused': 'Instagram bu cevabı kabul etmedi.',
    'admin.social.dm.error.not_found': 'Bu konuşma artık yok.',
```

- **tr**, after `'admin.overview.social'`: `'admin.overview.dm': '{n} okunmamış Instagram mesajı',`

- [ ] **Step 5: Markup.** In `src/components/admin/panes/SocialPane.astro`, add this before `<div id="socialOverlay"`. It has no `data-social-view`, so `showSocialTab` leaves it alone and the shell's `data-sub` toggle shows it.

```astro
  <section data-sub="dm" data-publisher-only class="hidden lg:flex-1 lg:min-h-0 fit-col">
    <div class="flex flex-wrap items-center justify-between gap-3 mb-3 lg:mb-2">
      <p class="text-sm lg:text-xs text-gray-500 flex-1 min-w-0">{t('admin.social.dm.intro')}</p>
      <div class="flex flex-wrap items-center gap-2">
        <div role="group" class="flex gap-1">
          <button type="button" id="dmFilterUnanswered" aria-pressed="true" class="px-3 min-h-11 lg:min-h-9 rounded-full border border-border text-sm text-navy aria-pressed:bg-navy-light aria-pressed:font-semibold">{t('admin.social.dm.filter.unanswered')}</button>
          <button type="button" id="dmFilterAll" aria-pressed="false" class="px-3 min-h-11 lg:min-h-9 rounded-full border border-border text-sm text-navy aria-pressed:bg-navy-light aria-pressed:font-semibold">{t('admin.social.dm.filter.all')}</button>
        </div>
        <button type="button" id="dmRefresh" class={btn}>{t('admin.social.dm.refresh')}</button>
      </div>
    </div>
    <p id="dmStatus" class="hidden text-sm text-navy bg-[#FFF7E6] border border-border rounded-xl px-3 py-2 mb-3"></p>
    <div class="grid lg:grid-cols-[320px_1fr] lg:grid-rows-[minmax(0,1fr)] lg:flex-1 lg:min-h-0 gap-4 lg:gap-3 items-start">
      <div id="dmListCard" class="min-w-0 bg-white rounded-2xl border border-border p-2 lg:max-h-full lg:overflow-y-auto lg:overscroll-contain">
        <div id="dmList" class="flex flex-col gap-1"></div>
        <p id="dmEmpty" class="hidden text-sm text-gray-500 px-2 py-4">{t('admin.social.dm.empty')}</p>
        <p id="dmLinkedin" class="hidden text-xs text-gray-500 px-2 pt-3 border-t border-border mt-2">{t('admin.social.dm.linkedin')} <a href="https://www.linkedin.com/" target="_blank" rel="noopener noreferrer" class="text-navy underline">{t('admin.social.dm.linkedinOpen')}</a></p>
      </div>
      <div id="dmThreadCard" class="hidden min-w-0 lg:block bg-[#F0F0EE] rounded-2xl border border-border p-4 lg:p-3 lg:h-full lg:overflow-y-auto lg:overscroll-contain">
        <div class="lg:hidden mb-3">
          <a href="#sosyal/dm" id="dmBack" class="flex w-fit items-center gap-1 px-4 min-h-11 rounded-xl text-sm font-medium text-navy hover:text-navy-mid"><span aria-hidden="true">‹</span> {t('admin.social.dm.back')}</a>
        </div>
        <p id="dmThreadEmpty" class="text-sm text-gray-600 text-center py-24">{t('admin.social.dm.select')}</p>
        <div id="dmThreadView" class="hidden flex flex-col gap-3">
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3 min-w-0">
            <h3 id="dmThreadWho" class="text-sm font-semibold text-navy break-all"></h3>
            <a id="dmOpenInstagram" href="https://www.instagram.com/direct/inbox/" target="_blank" rel="noopener noreferrer" class="text-xs text-navy underline">{t('admin.social.dm.openInstagram')}</a>
          </div>
          <p class="text-[11px] text-gray-600">{t('admin.social.dm.only20')}</p>
          <p id="dmThreadError" class="hidden text-sm text-navy"></p>
          <div id="dmMessages" class="flex flex-col gap-3"></div>
          <p id="dmClosed" class="hidden text-xs text-gray-600 border-t border-border pt-3">{t('admin.social.dm.closed')}</p>
          <form id="dmReplyForm" class="hidden flex-col gap-2 border-t border-border pt-3">
            <textarea id="dmReplyText" rows="4" aria-label={t('admin.social.dm.placeholder')} placeholder={t('admin.social.dm.placeholder')}
              class="px-3 py-2 min-h-11 rounded-xl border border-border text-sm text-navy bg-white placeholder-gray-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid"></textarea>
            <div class="flex flex-wrap items-center gap-3">
              <button type="submit" id="dmSend" class="px-4 min-h-11 lg:min-h-9 rounded-xl bg-navy text-white text-sm font-medium disabled:opacity-40">{t('admin.social.dm.send')}</button>
              <span id="dmBytes" class="text-xs text-gray-600" aria-live="polite"></span>
            </div>
          </form>
        </div>
      </div>
    </div>
  </section>
```

`setupSocial` removes `[data-publisher-only]` for editors and the shell removes the `dm` sub for them, so either path keeps editors out of the markup. The reply form uses `hidden` plus `flex-col`. `showDm` switches it with `classList.toggle('hidden')` and `classList.toggle('flex')`, never adding `inline-flex`.

- [ ] **Step 6: Write `src/scripts/admin/sections/social-dm.ts`**

```ts
/**
 * Sosyal's Messages sub-page (#sosyal/dm, publishers and admins): the
 * Instagram conversations the server has seen, and one conversation fetched
 * live with a reply box. Laid out like the e-mail inbox: list and thread side
 * by side from lg up; on a phone the list, then the thread with ‹ back.
 * Message text is shown with textContent-equivalent escaping, never as HTML.
 */
import { escapeHtml } from '../../escape-html';
import { formatIstanbul } from '../../../lib/istanbul-time';
import { t, tf, dateLocale } from '../context';
import { chip, guardUnsaved, toast } from '../ui-kit';
import { refreshCounts, goBack } from '../shell';

interface ThreadOut {
  id: string; username: string | null; lastAt: number; lastInboundAt: number | null;
  unanswered: boolean; unread: boolean; expired: boolean; closesAt: number | null; secondsLeft: number;
}
interface Msg { id: string; at: number; mine: boolean; text: string; attachments: string[] }

const HASH = '#sosyal/dm';
const MAX_BYTES = 1000;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;

export const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

let threads: ThreadOut[] | null = null;
let onlyUnanswered = true;
let wantedId: string | null = null;
let currentId: string | null = null;
let current: ThreadOut | null = null;
let started = false;
let listToken = 0;
let threadToken = 0;
let guard: { reset(): void } | null = null;

const who = (th: { username: string | null }) => th.username ? `@${th.username}` : t('admin.social.dm.unknownUser');

function stateChip(th: ThreadOut): string {
  if (!th.unanswered) return chip(t('admin.social.dm.answered'), 'neutral');
  if (th.expired) return chip(t('admin.social.dm.expired'), 'neutral');
  const h = Math.max(1, Math.floor(th.secondsLeft / 3600));
  return chip(tf('admin.social.dm.hoursLeft', { n: h }), th.secondsLeft < 4 * 3600 ? 'amber' : 'navy');
}

async function loadThreads(): Promise<boolean> {
  const mine = ++listToken;
  let data: { status: string; account: string | null; linkedin: boolean; threads: ThreadOut[] };
  try {
    const res = await fetch('/api/admin/social/dm');
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine === listToken) toast(t('admin.social.dm.loadFailed'), true);
    return false;
  }
  if (mine !== listToken) return false;
  const status = el('dmStatus');
  status.classList.toggle('hidden', data.status === 'ok');
  status.textContent = data.status === 'ok' ? '' : t(`admin.social.dm.status.${data.status}` as never);
  el('dmLinkedin').classList.toggle('hidden', !data.linkedin);
  threads = data.threads ?? [];
  renderList();
  return true;
}

function renderList(): void {
  const rows = (threads ?? []).filter((th) => !onlyUnanswered || (th.unanswered && !th.expired) || th.id === wantedId);
  el('dmEmpty').classList.toggle('hidden', threads === null || rows.length > 0);
  el('dmList').innerHTML = rows.map((th) => {
    const selected = th.id === wantedId;
    return `
    <a href="${HASH}/${escapeHtml(th.id)}" data-dm="${escapeHtml(th.id)}" ${selected ? 'aria-current="true"' : ''}
      class="block min-w-0 min-h-11 px-3 py-2 rounded-xl border transition-colors ${selected ? 'border-navy-mid bg-navy-light/40' : 'border-transparent hover:bg-[#F7F7F6]'}">
      <span class="flex items-baseline justify-between gap-2 min-w-0">
        <span class="text-sm truncate min-w-0 text-navy ${th.unread ? 'font-bold' : ''}">${escapeHtml(who(th))}</span>
        <span class="text-[11px] text-gray-500 shrink-0">${th.lastAt ? escapeHtml(formatIstanbul(th.lastAt, dateLocale)) : ''}</span>
      </span>
      <span class="flex flex-wrap items-center gap-2 mt-1">${th.unread ? chip(t('admin.social.dm.unread'), 'navy') : ''}${stateChip(th)}</span>
    </a>`;
  }).join('');
}

function layout(open: boolean): void {
  el('dmListCard').classList.toggle('hidden', open);
  el('dmThreadCard').classList.toggle('hidden', !open);
  el('dmThreadEmpty').classList.toggle('hidden', open);
  if (!open) el('dmThreadView').classList.add('hidden');
}

function setReplyOpen(open: boolean): void {
  const form = el('dmReplyForm');
  form.classList.toggle('hidden', !open);
  form.classList.toggle('flex', open);
  el('dmClosed').classList.toggle('hidden', open);
}

function updateBytes(): void {
  const n = utf8Bytes(el<HTMLTextAreaElement>('dmReplyText').value.trim());
  el('dmBytes').textContent = tf('admin.social.dm.bytes', { n });
  el('dmBytes').classList.toggle('text-red', n > MAX_BYTES);
  el<HTMLButtonElement>('dmSend').disabled = n === 0 || n > MAX_BYTES;
}

async function openThread(id: string): Promise<void> {
  const mine = ++threadToken;
  let data: { thread: ThreadOut; messages: Msg[] | null; error?: string };
  try {
    const res = await fetch(`/api/admin/social/dm/${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error(String(res.status));
    data = await res.json();
  } catch {
    if (mine === threadToken) toast(t('admin.social.dm.threadFailed'), true);
    return;
  }
  if (mine !== threadToken || wantedId !== id) return;
  const changed = currentId !== id;
  currentId = id;
  current = data.thread;
  if (changed) el('dmThreadCard').scrollTop = 0;
  el('dmThreadEmpty').classList.add('hidden');
  el('dmThreadView').classList.remove('hidden');
  el('dmThreadWho').textContent = who(data.thread);
  const err = el('dmThreadError');
  err.classList.toggle('hidden', !data.error);
  err.textContent = data.error ? t(data.error === 'connection' ? 'admin.social.dm.error.connection' : 'admin.social.dm.threadFailed') : '';
  el('dmMessages').innerHTML = (data.messages ?? []).map((m) => `
    <div class="flex ${m.mine ? 'justify-end' : 'justify-start'} min-w-0">
      <div class="max-w-[85%] min-w-0 break-words whitespace-pre-wrap rounded-2xl px-4 py-3 lg:px-3 lg:py-2 ${m.mine ? 'bg-navy text-white' : 'bg-white border border-border text-navy'}">
        <div class="text-[11px] mb-1 ${m.mine ? 'text-white/70' : 'text-gray-500'}">${escapeHtml(m.mine ? t('admin.social.dm.you') : who(data.thread))} &middot; ${escapeHtml(formatIstanbul(m.at, dateLocale))}</div>
        <div class="text-sm leading-relaxed">${escapeHtml(m.text)}</div>
        ${m.attachments.map((u) => `<a href="${escapeHtml(u)}" target="_blank" rel="noopener noreferrer" class="block text-[11px] underline mt-1">${escapeHtml(t('admin.social.dm.attachment'))}</a>`).join('')}
      </div>
    </div>`).join('');
  // Answerable while the window is open, answered or not: a follow-up is allowed too.
  setReplyOpen(data.thread.closesAt !== null && !data.thread.expired);
  if (changed) { el<HTMLFormElement>('dmReplyForm').reset(); guard?.reset(); }
  updateBytes();
  const row = threads?.find((x) => x.id === id);
  if (row?.unread) { row.unread = false; renderList(); }
  void refreshCounts();
}

async function submitReply(): Promise<void> {
  const id = currentId;
  if (!id) return;
  const box = el<HTMLTextAreaElement>('dmReplyText');
  const text = box.value.trim();
  if (!text || utf8Bytes(text) > MAX_BYTES) return;
  const button = el<HTMLButtonElement>('dmSend');
  button.disabled = true;
  el('dmBytes').textContent = t('admin.social.dm.sending');
  try {
    const res = await fetch(`/api/admin/social/dm/${encodeURIComponent(id)}/reply`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || data?.ok !== true) {
      const code = typeof data?.code === 'string' ? data.code : 'unavailable';
      toast(t(`admin.social.dm.error.${code}` as never) || t('admin.social.dm.error.unavailable'), true);
      if (code === 'window_closed') setReplyOpen(false);
      return;
    }
    // Cleared only once it has gone: the words exist nowhere else.
    el<HTMLFormElement>('dmReplyForm').reset();
    guard?.reset();
    toast(t('admin.social.dm.sent'));
    await loadThreads();
    if (currentId === id) await openThread(id);
  } catch {
    toast(t('admin.social.dm.error.unavailable'), true);
  } finally {
    updateBytes();
  }
}

function setFilter(unanswered: boolean): void {
  onlyUnanswered = unanswered;
  el('dmFilterUnanswered').setAttribute('aria-pressed', String(unanswered));
  el('dmFilterAll').setAttribute('aria-pressed', String(!unanswered));
  renderList();
}

/** Wires the controls once, before the shell first shows the sub-page. */
export function setupDm(): void {
  const form = el<HTMLFormElement>('dmReplyForm');
  if (!form) return;
  guard = guardUnsaved(form, HASH, () => { form.reset(); }, { exact: true });
  form.addEventListener('submit', (e) => { e.preventDefault(); void submitReply(); });
  el('dmReplyText').addEventListener('input', updateBytes);
  el('dmFilterUnanswered').addEventListener('click', () => setFilter(true));
  el('dmFilterAll').addEventListener('click', () => setFilter(false));
  el('dmRefresh').addEventListener('click', async () => {
    const b = el<HTMLButtonElement>('dmRefresh');
    b.disabled = true;
    try { await fetch('/api/admin/social/dm/refresh', { method: 'POST' }); } catch { /* the list below still loads */ }
    await loadThreads();
    if (wantedId) await openThread(wantedId);
    b.disabled = false;
  });
  el('dmBack').addEventListener('click', (e) => { e.preventDefault(); goBack(); });
}

/** Shows the list, and the conversation `item` names (null: none). Runs on every show of the sub-page. */
export async function showDm(item: string | null): Promise<void> {
  if (!document.getElementById('dmList')) return;
  wantedId = item;
  layout(item !== null);
  if (item === null) { currentId = null; current = null; }
  renderList();
  if (!started) {
    started = true;
    void loadThreads().then((ok) => { if (!ok) started = false; });
  }
  if (item !== null && item !== currentId) {
    el('dmThreadView').classList.add('hidden');
    await openThread(item);
  }
}
```

Check before use:
- `chip()` tones in `src/scripts/admin/ui-kit.ts` (`TONES`). If there is no `'amber'` tone, add one using the palette's existing amber/warning classes. If there is no `'navy'` tone, use the tone `mail-inbox.ts` uses for unread.
- `text-red`: confirm it exists in the Tailwind theme (the shell uses `bg-red`).

- [ ] **Step 7: Wire it in `src/scripts/admin/main.ts`.** Add `import { setupDm, showDm } from './sections/social-dm';`. After the `setupSocial(...)` block:

```ts
  if (isSocialPublisher) setupDm();
```

Change the `sosyal` entry of `onSub`:

```ts
    sosyal: (sub, item) => {
      if (sub === 'dm') { if (isSocialPublisher) void showDm(item); return; }
      if (Object.hasOwn(SOCIAL_TABS, sub)) showSocialTab(SOCIAL_TABS[sub]);
    },
```

- [ ] **Step 8: Run unit tests, the type check and the build**

Run: `npm test` then `npx astro check` then `npm run build`
Expected: all tests pass, `0 errors`, build complete.

- [ ] **Step 9: Write the browser check** `tests/browser/admin-social-dm.mjs`

```js
/**
 * Sosyal → Messages (#sosyal/dm) in a real browser: hidden for an editor,
 * list and thread for a publisher, a reply, the expired state, a deep link,
 * escaping, and the phone's list-then-thread flow, in English and Turkish.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-social-dm.mjs
 *
 * Every API call is intercepted, so nothing is sent or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };
const PUB = { id: 'p1', email: 'pub@example.org', is_social: true, is_social_publisher: true };
const ED = { id: 'e1', email: 'ed@example.org', is_social: true };
const NOW = Math.floor(Date.now() / 1000);
const XSS = '<img src=x onerror=alert(1)>';
const THREADS = [
  { id: 'aaa-1', username: 'ayse', lastAt: NOW - 600, lastInboundAt: NOW - 600, unanswered: true, unread: true, expired: false, closesAt: NOW - 600 + 86400, secondsLeft: 86400 - 600 },
  { id: 'bbb-2', username: null, lastAt: NOW - 90000, lastInboundAt: NOW - 90000, unanswered: true, unread: false, expired: true, closesAt: NOW - 3600, secondsLeft: 0 },
  { id: 'ccc-3', username: 'mehmet', lastAt: NOW - 60, lastInboundAt: NOW - 7200, unanswered: false, unread: false, expired: false, closesAt: NOW + 79200, secondsLeft: 79200 },
];

const browser = await chromium.launch();

async function open(lang, viewport, { user = PUB, hash = '#sosyal/dm', reply = () => null } = {}) {
  const page = await browser.newPage({ viewport });
  const calls = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${lang} ${viewport.width}): ` + String(e).slice(0, 160)));
  page.on('dialog', (d) => { bad.push(`dialog: ${d.message()}`); void d.dismiss(); });
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const body = req.method() === 'GET' ? null : req.postDataJSON();
    calls.push({ method: req.method(), path: url.pathname, body });
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const custom = reply(req.method(), url.pathname, body);
    if (custom) return json(custom.json, custom.status ?? 200);
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({ social: 0, dm: 1, scheduledThisWeek: 0 });
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: false });
    if (url.pathname === '/api/admin/social/dm') return json({ status: 'ok', account: 'rsg_test', linkedin: true, threads: THREADS });
    const m = url.pathname.match(/^\/api\/admin\/social\/dm\/([^/]+)(\/reply)?$/);
    if (m && m[2]) return json({ ok: true });
    if (m && m[1] !== 'refresh') {
      const th = THREADS.find((x) => x.id === m[1]);
      return json({ thread: th, messages: [
        { id: 'm1', at: NOW - 700, mine: false, text: XSS, attachments: ['https://lookaside.fbsbx.com/x.jpg'] },
        { id: 'm2', at: NOW - 650, mine: true, text: 'Merhaba', attachments: [] },
      ] });
    }
    if (req.method() !== 'GET') return json({ ok: true });
    return json({ posts: [], plans: [], modes: [], editors: [], connections: [], rows: [] });
  });
  await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/admin${hash}`, { waitUntil: 'networkidle' });
  return { page, calls };
}

console.log('editor: no Messages tab');
{
  const { page, calls } = await open('en', { width: 1280, height: 800 }, { user: ED });
  ok(await page.locator('[data-sub-link="dm"]').count() === 0, 'no tab link');
  ok(await page.locator('#dmList').count() === 0, 'no markup');
  ok(!calls.some((c) => c.path.startsWith('/api/admin/social/dm')), 'no DM request');
  await page.close();
}

console.log('publisher, desktop, English');
{
  const { page, calls } = await open('en', { width: 1280, height: 800 });
  ok(await page.locator('#dmList [data-dm]').count() === 1, 'Unanswered filter shows the one open thread');
  await page.click('#dmFilterAll');
  ok(await page.locator('#dmList [data-dm]').count() === 3, 'All shows three');
  ok((await page.locator('#dmList').innerText()).includes('Instagram user'), 'unknown sender named');
  ok(!(await page.locator('#dmList').innerText()).includes('@null'), 'no @null');
  await page.click('[data-dm="aaa-1"]');
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(page.url().endsWith('#sosyal/dm/aaa-1'), 'address names the thread');
  ok((await page.locator('#dmMessages').innerText()).includes(XSS), 'text shown as text');
  ok(await page.locator('#dmMessages img').count() === 0, 'no HTML injected');
  ok(await page.locator('#dmMessages a[rel="noopener noreferrer"]').count() === 1, 'attachment link');
  await page.fill('#dmReplyText', 'ş'.repeat(501));
  ok(await page.locator('#dmSend').isDisabled(), '1002 bytes: Send disabled');
  await page.fill('#dmReplyText', 'Teşekkürler');
  await page.click('#dmSend');
  await page.waitForTimeout(300);
  const sent = calls.find((c) => c.path === '/api/admin/social/dm/aaa-1/reply');
  ok(sent?.body?.text === 'Teşekkürler', 'reply posted');
  ok(await page.locator('#dmReplyText').inputValue() === '', 'box cleared after send');
  await page.goto(`${BASE}/admin#sosyal/dm/bbb-2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(await page.locator('#dmReplyForm').isHidden(), 'expired: no reply box');
  ok(await page.locator('#dmClosed').isVisible(), 'expired: explains why');
  ok(await page.locator('#dmLinkedin').isVisible(), 'LinkedIn line when connected');
  await page.close();
}

console.log('publisher, phone, Turkish');
{
  const { page } = await open('tr', { width: 390, height: 844 });
  ok(await page.locator('#dmListCard').isVisible(), 'list first');
  await page.click('#dmFilterAll');
  await page.click('[data-dm="ccc-3"]');
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(await page.locator('#dmListCard').isHidden(), 'thread replaces list');
  ok((await page.locator('#dmBack').boundingBox()).height >= 44, 'back is 44px');
  ok((await page.locator('#dmSend').boundingBox()).height >= 44, 'Send is 44px');
  await page.click('#dmBack');
  await page.waitForTimeout(200);
  ok(await page.locator('#dmListCard').isVisible(), 'back to the list');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  await page.close();
}

await browser.close();
if (bad.length) { console.log(`\n${bad.length} failed`); process.exit(1); }
console.log('\nall passed');
```

Run: `npm run build && (npx astro preview --port 4329 &)`, then `BASE=http://localhost:4329 node tests/browser/admin-social-dm.mjs`
Expected: `all passed`. Stop the preview server afterwards.

- [ ] **Step 10: Commit**

```bash
git add src/scripts/admin/sections.ts src/scripts/admin/overview.ts src/components/admin/panes/SocialPane.astro src/scripts/admin/sections/social-dm.ts src/scripts/admin/main.ts src/i18n/ui.ts tests/admin-sections.test.ts tests/admin-social-i18n.test.ts tests/browser/admin-social-dm.mjs
git commit -m "Social DM: Messages tab for publishers (list, live thread, reply, 24-hour state)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Privacy notice and go-live notes

**Files:**
- Modify: `src/data/privacy.ts` (en line 71, tr line 134)
- Test: `tests/privacy-page.test.ts` (append)

- [ ] **Step 1: Write the failing test.** Append to `tests/privacy-page.test.ts`:

```ts
test('the notice says how DMs are handled, in both languages', () => {
  const en = JSON.stringify(PRIVACY.en);
  const tr = JSON.stringify(PRIVACY.tr);
  assert.match(en, /direct messages/i);
  assert.match(tr, /mesaj/i);
  assert.ok(!en.includes('We do not read or store data about other people from these platforms'), 'old sentence removed');
});
```

- [ ] **Step 2: Run the test and see it fail**

Run: `node --import tsx --test tests/privacy-page.test.ts`
Expected: FAIL, the old sentence is still present.

- [ ] **Step 3: Replace the two items.**

- **en** (line 71):

```ts
          'Instagram and LinkedIn: the team publishes posts to RSG-Turkiye\'s own accounts from the admin panel. Access to those accounts is granted with OAuth and stored encrypted; we never store their passwords. Direct messages sent to our Instagram account are read and answered by the social media team in the admin panel: they are fetched from Instagram when opened, and the site stores only the sender\'s Instagram username and the times of the latest messages, not the messages themselves.',
```

- **tr** (line 134):

```ts
          'Instagram ve LinkedIn: Ekip, yönetim panelinden RSG-Türkiye\'nin kendi hesaplarına paylaşım yapar. Bu hesaplara erişim OAuth ile verilir ve şifreli saklanır; şifrelerini hiçbir zaman saklamayız. Instagram hesabımıza gönderilen doğrudan mesajları sosyal medya ekibi yönetim panelinden okur ve cevaplar: mesajlar açıldığında Instagram\'dan çekilir; site yalnızca gönderenin Instagram kullanıcı adını ve son mesajların zamanını saklar, mesajların kendisini saklamaz.',
```

- [ ] **Step 4: Run the full suite**

Run: `npm test` and `npx astro check`
Expected: all pass, `0 errors`.

- [ ] **Step 5: Commit**

```bash
git add src/data/privacy.ts tests/privacy-page.test.ts
git commit -m "Privacy notice: how Instagram DMs are read and what is kept

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Go-live checklist for the PR body.** The admin does these after merge; the implementer does not run them.
  1. Apply the migration. Run the two `CREATE TABLE` statements and the `CREATE INDEX` from `db/schema.sql` with `wrangler d1 execute rsg-members --remote --command="..."`.
  2. In the Instagram app on @rsgturkey (Business account): Settings → Messages and story replies → Message controls → Connected tools → allow access to messages.
  3. In the panel: Connections → Instagram → reconnect. This grants `instagram_business_manage_messages`.
  4. No Worker redeploy and no new secret.
  5. Manual pass:
     - Send a DM from a test account; it appears within 5 minutes.
     - The digest e-mail arrives.
     - Answer from the panel; the answer arrives on Instagram.
     - Answer from the Instagram app; the thread shows "Answered" after the next poll.
