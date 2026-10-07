# Symposium schedule: days and Turkish translation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions carry a day number and a Turkish title/description; the schedule pages group by day with dated headings and show each language's own text.

**Architecture:** Three new D1 columns on `symposium_sessions` travel the same path `role_tr` already does (row interface → admin input → overlay → archive snapshot → symposium site content). Rendering logic lives in one pure module in the symposium site, tested without Astro, and one shared component used by both schedule pages.

**Tech Stack:** Cloudflare Pages Functions + D1, Astro 5 (two sites), `node --test` via tsx.

**Spec:** `docs/superpowers/specs/2026-10-07-symposium-schedule-days-and-tr-design.md`

## Global Constraints

- English is canonical: `title`/`description` English, `titleTr`/`descriptionTr` (D1: `title_tr`/`description_tr`) Turkish; Turkish pages fall back to English when empty.
- `day` is an integer >= 1, default 1. Heading date = edition `startDate` + (`day` − 1), computed in UTC.
- Headings render only when the programme spans more than one day.
- Heading text: `DAY 1 · Saturday, 10 October` / `1. GÜN · 10 Ekim Cumartesi`.
- New columns: `day INTEGER NOT NULL DEFAULT 1`, `title_tr TEXT NOT NULL DEFAULT ''`, `description_tr TEXT NOT NULL DEFAULT ''`.
- Never publish `*.pages.dev` hostnames (blocked in Türkiye); verify on `symposium.rsg-turkiye.iscbsc.org`.

## Review Focus

1. **An older overlay payload with no `day`** (main site and symposium site deploy separately) — every session must land on day 1, not vanish or form an "undefined" group. Test in Task 4.
2. **Edition with no `startDate`** — headings still render as `DAY 2` with no date, never `Invalid Date`. Test in Task 4.
3. **A day with a gap** (sessions on day 1 and 3 only) — heading dates follow the day number, not the group index. Test in Task 4.
4. **Times reset at midnight between days** — the existing "times never go backwards" test must compare within a day, or the 2026 snapshot fails CI. Task 3.
5. **Admin edit round trip** — loading a session and saving it unchanged must keep `day`, `titleTr`, `descriptionTr`. Test in Task 1, browser check in Task 5.

---

### Task 1: Backend columns end to end

**Files:**
- Modify: `db/schema.sql` (symposium_sessions CREATE TABLE ~line 584; migration comment block ~line 157)
- Modify: `functions/_lib/symposium.ts` (SessionRow line 14, OverlaySession line 22, rowsToOverlay ~234, SessionInput ~505, rowFromInput ~572, rowToInput ~629)
- Modify: `functions/api/admin/symposium/[kind].ts` (LIST_COLUMNS, insertStatement)
- Modify: `functions/api/admin/symposium/[kind]/[id].ts` (column constant, UPDATE)
- Modify: `functions/api/symposium.ts` (SELECT line 58)
- Modify: `functions/api/admin/symposium/archive.ts` (SELECT line 75)
- Test: `tests/symposium-shape.test.ts`, `tests/symposium-columns.test.ts` (unchanged; it enforces the SQL)

**Interfaces — Produces:**
- `SessionRow` gains `day: number; title_tr: string; description_tr: string`
- `OverlaySession` gains `day: number; titleTr: string; descriptionTr: string`
- `SessionInput` gains `day?: number; titleTr?: string; descriptionTr?: string`

- [ ] **Step 1: Write failing tests** in `tests/symposium-shape.test.ts`. Replace the session round-trip test and add day validation:

```ts
test('every session field round trips to itself, not to its neighbour', () => {
  const row = {
    id: 'se1', slug: 'opening-keynote', year: 2026, title: 'Opening Keynote', type: 'keynote',
    time: '09:00', end_time: '10:00', description: 'Welcome remarks from the organizers.',
    speaker_slugs: '["jane-doe","john-roe"]', sort: 1,
    day: 2, title_tr: 'Açılış Konuşması', description_tr: 'Düzenleyicilerden hoş geldiniz.',
  };
  const input = rowToInput('sessions', row);
  assert.deepEqual(input, {
    id: row.id, sort: row.sort, slug: row.slug, title: row.title, type: row.type,
    time: row.time, endTime: row.end_time, description: row.description,
    speakerSlugs: ['jane-doe', 'john-roe'],
    day: 2, titleTr: row.title_tr, descriptionTr: row.description_tr,
  });
  const { id, sort, ...expectedRow } = row;
  assert.deepEqual(rowFromInput('sessions', input, row.year), expectedRow);
});

test('a session with no day is on day 1, and no translation is empty', () => {
  const row = rowFromInput('sessions', { title: 'Keynote', type: 'keynote' }, 2026);
  assert.equal(row.day, 1);
  assert.equal(row.title_tr, '');
  assert.equal(row.description_tr, '');
});

test('a day that is not a positive whole number is rejected', () => {
  for (const day of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => rowFromInput('sessions', { title: 'X', type: 'talk', day }, 2026), /day/);
  }
});

test('the overlay carries a session day and its translations', () => {
  const o = rowsToOverlay(editionRow, [], [{
    id: 's', slug: 'w', year: 2026, title: 'Workshop', type: 'workshop', time: '13:00', end_time: '',
    description: 'Hands-on', speaker_slugs: '[]', sort: 0, day: 2, title_tr: 'Atölye', description_tr: 'Uygulamalı',
  }], [], []);
  assert.equal(o.sessions[0].day, 2);
  assert.equal(o.sessions[0].titleTr, 'Atölye');
  assert.equal(o.sessions[0].descriptionTr, 'Uygulamalı');
});
```

- [ ] **Step 2: Run** `npm test` (in `website/`). Expected: the four tests above FAIL.

- [ ] **Step 3: Schema.** In `db/schema.sql`, inside `CREATE TABLE IF NOT EXISTS symposium_sessions`, after `speaker_slugs`:

```sql
  speaker_slugs TEXT NOT NULL DEFAULT '[]',
  -- Which day of the symposium, 1-based. The schedule page derives the
  -- heading's date from the edition's startDate, so this is never a date.
  day           INTEGER NOT NULL DEFAULT 1,
  -- Turkish translations. title/description are English and canonical; an
  -- empty translation falls back to English on the Turkish pages.
  title_tr      TEXT NOT NULL DEFAULT '',
  description_tr TEXT NOT NULL DEFAULT '',
  sort          INTEGER NOT NULL DEFAULT 0
```

And in the migration comment block next to the existing `teams` line:

```sql
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN day INTEGER NOT NULL DEFAULT 1"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN title_tr TEXT NOT NULL DEFAULT ''"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN description_tr TEXT NOT NULL DEFAULT ''"
```

- [ ] **Step 4: Library.** In `functions/_lib/symposium.ts`:

```ts
export interface SessionRow { id: string; slug: string; year: number; title: string; type: string; time: string; end_time: string; description: string; speaker_slugs: string; day: number; title_tr: string; description_tr: string; sort: number }
```
```ts
export interface OverlaySession { slug: string; title: string; titleTr: string; type: string; speakerSlugs: string[]; description: string; descriptionTr: string; time: string; endTime?: string; day: number; order: number }
```
In `rowsToOverlay` sessions map add `titleTr: s.title_tr, descriptionTr: s.description_tr, day: s.day,`.
`SessionInput` add `day?: number; titleTr?: string; descriptionTr?: string;`.
In `rowFromInput` case `'sessions'`, before the return:

```ts
      const day = session.day ?? 1;
      if (!Number.isInteger(day) || day < 1) throw new Error(`session day must be a whole number from 1, got: ${session.day}`);
```
and add to the returned object `day, title_tr: session.titleTr ?? '', description_tr: session.descriptionTr ?? '',`.
In `rowToInput` case `'sessions'` add `day: r.day, titleTr: r.title_tr, descriptionTr: r.description_tr,`.

- [ ] **Step 5: SQL.** Add `day, title_tr, description_tr` to: both session column constants (`[kind].ts`, `[kind]/[id].ts`), the SELECTs in `functions/api/symposium.ts` and `archive.ts`, the INSERT (columns, three more `?`, values `r.day, r.title_tr, r.description_tr` before `sort`), and the UPDATE (`day = ?, title_tr = ?, description_tr = ?` with values before `id`).

- [ ] **Step 6: Run** `npm test`. Expected: all PASS, including `symposium-columns.test.ts` (it fails if any SQL site was missed).

- [ ] **Step 7: Commit** `git commit -am "Sessions carry a day and a Turkish title and description"`.

---

### Task 2: Admin form

**Files:**
- Modify: `src/components/admin/panes/SymposiumPane.astro` (session form ~182-218, table head ~226)
- Modify: `src/scripts/admin-panel.ts` (SessionItem ~1232, renderSessions, edit handler ~1268, saveSession ~1319)
- Modify: `src/i18n/ui.ts` (en ~494, tr ~1029)

**Interfaces — Consumes:** `SessionInput.day/titleTr/descriptionTr` from Task 1 (the API speaks this shape).

- [ ] **Step 1: i18n.** Change and add keys (en / tr):

```ts
'admin.symposium.sessions.form.titlePlaceholder': 'Title (English, required)',
'admin.symposium.sessions.form.titleTrPlaceholder': 'Title (Turkish, optional)',
'admin.symposium.sessions.form.descriptionPlaceholder': 'Description (English)',
'admin.symposium.sessions.form.descriptionTrPlaceholder': 'Description (Turkish, optional)',
'admin.symposium.sessions.form.dayLabel': 'Day',
'admin.symposium.sessions.table.day': 'Day',
```
```ts
'admin.symposium.sessions.form.titlePlaceholder': 'Başlık (İngilizce, zorunlu)',
'admin.symposium.sessions.form.titleTrPlaceholder': 'Başlık (Türkçe, isteğe bağlı)',
'admin.symposium.sessions.form.descriptionPlaceholder': 'Açıklama (İngilizce)',
'admin.symposium.sessions.form.descriptionTrPlaceholder': 'Açıklama (Türkçe, isteğe bağlı)',
'admin.symposium.sessions.form.dayLabel': 'Gün',
'admin.symposium.sessions.table.day': 'Gün',
```

- [ ] **Step 2: Markup.** After `symSessionTitle` add a `symSessionTitleTr` input (same classes, `titleTrPlaceholder`, not required). After the type `<label>` add:

```astro
        <label class="flex flex-col gap-1 text-sm text-gray-600">
          {t('admin.symposium.sessions.form.dayLabel')}
          <select id="symSessionDay"
            class="px-3 py-2 rounded-xl border border-border text-sm text-navy bg-white focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid focus:border-navy-mid">
            {[1, 2, 3, 4, 5].map((d) => <option value={d}>{d}</option>)}
          </select>
        </label>
```
After `symSessionDescription` add a `symSessionDescriptionTr` textarea (same classes incl. `sm:col-span-2`). Add a `table.day` `<th>` before the time column.

- [ ] **Step 3: Script.** `SessionItem` gains `day: number; titleTr: string; descriptionTr: string;`. `renderSessions` adds `<td class="px-5 py-4 text-gray-500 tabular-nums">${s.day}</td>` before the time cell. The edit handler sets `symSessionTitleTr`, `symSessionDescriptionTr` and `symSessionDay` (`String(item.day ?? 1)`). `saveSession` body adds:

```ts
      titleTr: (document.getElementById('symSessionTitleTr') as HTMLInputElement).value,
      descriptionTr: (document.getElementById('symSessionDescriptionTr') as HTMLTextAreaElement).value,
      day: Number((document.getElementById('symSessionDay') as unknown as HTMLSelectElement).value),
```
`form.reset()` already returns the select to day 1.

- [ ] **Step 4: Run** `npm test` and `npx astro check` (or `npm run build`) in `website/`. Expected: PASS / no type errors.

- [ ] **Step 5: Commit** `git commit -am "Session form: day, and Turkish title and description"`.

---

### Task 3: Symposium site content shape

**Files:**
- Modify: `symposium_website/src/content.config.ts` (sessions schema)
- Modify: `symposium_website/src/lib/content.ts` (Session interface)
- Modify: `symposium_website/tests/sessions.test.ts` (times compared per day)

**Interfaces — Produces:** `Session` gains `day?: number; titleTr?: string; descriptionTr?: string` (optional: an older overlay payload lacks them; the overlay is `.passthrough()`).

- [ ] **Step 1: Failing test.** In `sessions.test.ts`, change `sessionsIn` to return `day?: number`, and group before comparing:

```ts
test('within a day of an edition, printed times never go backwards', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const byDay = new Map<number, ReturnType<typeof sessionsIn>>();
    for (const s of sessionsIn(file)) {
      if (typeof s.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(s.time)) continue;
      const day = s.day ?? 1;
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    for (const [day, timed] of byDay) {
      timed.sort((a, b) => a.order - b.order);
      for (let i = 1; i < timed.length; i++) {
        const prev = timed[i - 1];
        const cur = timed[i];
        if (cur.time!.padStart(5, '0') < prev.time!.padStart(5, '0')) {
          offenders.push(`${file} day ${day}: "${prev.title}" at ${prev.time} is followed by "${cur.title}" at ${cur.time}`);
        }
      }
    }
  }
  assert.deepEqual(offenders, []);
});
```
Add a fixture-free unit check in the same file that a day-2 13:00 after a day-1 17:00 is not an offender, by extracting the per-file loop into `offendersIn(items)` and calling it with an inline array.

- [ ] **Step 2: Run** `npm test` in `symposium_website/`. Expected: new inline case FAILS before the refactor, PASSES after.

- [ ] **Step 3: Schema.** In the sessions item object add:

```ts
      titleTr: z.string().default(""),
      descriptionTr: z.string().default(""),
      day: z.number().int().min(1).default(1),
```
In `content.ts`: `export interface Session { slug: string; title: string; titleTr?: string; type: SessionType; speakerSlugs: string[]; description: string; descriptionTr?: string; time: string; endTime?: string; day?: number; order: number; }`

- [ ] **Step 4: Run** `npm test` in `symposium_website/`. Expected: PASS.

- [ ] **Step 5: Commit** `git commit -am "Symposium content: sessions have a day and Turkish text"`.

---

### Task 4: Schedule rendering

**Files:**
- Create: `symposium_website/src/lib/schedule-days.ts`
- Create: `symposium_website/tests/schedule-days.test.ts`
- Create: `symposium_website/src/components/ScheduleDays.astro`
- Modify: `symposium_website/src/components/SessionRow.astro`
- Modify: `symposium_website/src/pages/schedule.astro`, `src/pages/tr/schedule.astro`
- Modify: `symposium_website/src/i18n/ui.ts`

**Interfaces — Produces:**
```ts
export interface DayGroup<T> { day: number; heading: string | null; sessions: T[] }
export function groupByDay<T extends { day?: number; order: number }>(sessions: T[], startDate: Date | undefined, lang: 'en' | 'tr'): DayGroup<T>[];
export function dayHeading(day: number, startDate: Date | undefined, lang: 'en' | 'tr'): string;
export function sessionText(s: { title: string; titleTr?: string; description: string; descriptionTr?: string }, lang: 'en' | 'tr'): { title: string; description: string };
```

- [ ] **Step 1: Failing tests** `tests/schedule-days.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, dayHeading, sessionText } from '../src/lib/schedule-days';

const start = new Date('2026-10-10T00:00:00Z');
const s = (order: number, day?: number) => ({ order, day, title: `s${order}`, description: '' });

test('a one-day programme has no headings', () => {
  const groups = groupByDay([s(0), s(1)], start, 'en');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].heading, null);
});

test('sessions with no day (an older payload) are day 1', () => {
  const groups = groupByDay([s(0), s(1, 2)], start, 'en');
  assert.deepEqual(groups.map((g) => g.day), [1, 2]);
  assert.deepEqual(groups[0].sessions.map((x) => x.order), [0]);
});

test('groups are ordered by day, then by order', () => {
  const groups = groupByDay([s(5, 2), s(1, 1), s(3, 2), s(0, 1)], start, 'en');
  assert.deepEqual(groups.map((g) => g.sessions.map((x) => x.order)), [[0, 1], [3, 5]]);
});

test('headings carry the date derived from the start date, in both languages', () => {
  assert.equal(dayHeading(1, start, 'en'), 'Day 1 · Saturday, 10 October');
  assert.equal(dayHeading(2, start, 'tr'), '2. Gün · 11 Ekim Pazar');
});

test('a gap in days keeps the date tied to the day number', () => {
  assert.equal(dayHeading(3, start, 'en'), 'Day 3 · Monday, 12 October');
});

test('no start date gives a heading without a date', () => {
  assert.equal(dayHeading(2, undefined, 'en'), 'Day 2');
  assert.equal(dayHeading(2, undefined, 'tr'), '2. Gün');
});

test('Turkish text falls back to English, English never shows Turkish', () => {
  const x = { title: 'Opening', titleTr: 'Açılış', description: 'Welcome', descriptionTr: '' };
  assert.deepEqual(sessionText(x, 'tr'), { title: 'Açılış', description: 'Welcome' });
  assert.deepEqual(sessionText(x, 'en'), { title: 'Opening', description: 'Welcome' });
});
```
(Headings are stored in title case; the component uppercases them with CSS `uppercase`, which keeps screen readers from spelling them out.)

- [ ] **Step 2: Run** `npm test`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** `src/lib/schedule-days.ts`:

```ts
/**
 * The schedule, split into days. A session carries a day number, never a
 * date: the date is the edition's startDate plus (day - 1), so moving the
 * edition moves every heading with it. A one-day programme gets no heading
 * at all, which is how every edition before 2026 still renders.
 *
 * Sessions from an overlay served before `day` existed have none; they are
 * day 1. The main site and this one deploy separately, so that payload is a
 * real case, not a hypothetical.
 */
export interface DayGroup<T> { day: number; heading: string | null; sessions: T[] }

const DAY_MS = 24 * 60 * 60 * 1000;

export function dayHeading(day: number, startDate: Date | undefined, lang: 'en' | 'tr'): string {
  const label = lang === 'tr' ? `${day}. Gün` : `Day ${day}`;
  if (!startDate || Number.isNaN(startDate.getTime())) return label;
  const date = new Date(startDate.getTime() + (day - 1) * DAY_MS);
  const opts = { timeZone: 'UTC', day: 'numeric', month: 'long', weekday: 'long' } as const;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'en-GB', opts).formatToParts(date).map((p) => [p.type, p.value]),
  );
  const when = lang === 'tr'
    ? `${parts.day} ${parts.month} ${parts.weekday}`
    : `${parts.weekday}, ${parts.day} ${parts.month}`;
  return `${label} · ${when}`;
}

export function groupByDay<T extends { day?: number; order: number }>(
  sessions: T[],
  startDate: Date | undefined,
  lang: 'en' | 'tr',
): DayGroup<T>[] {
  const byDay = new Map<number, T[]>();
  for (const s of sessions) {
    const day = s.day ?? 1;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  const multi = days.length > 1;
  return days.map((day) => ({
    day,
    heading: multi ? dayHeading(day, startDate, lang) : null,
    sessions: byDay.get(day)!.sort((a, b) => a.order - b.order),
  }));
}

export function sessionText(
  s: { title: string; titleTr?: string; description: string; descriptionTr?: string },
  lang: 'en' | 'tr',
): { title: string; description: string } {
  if (lang !== 'tr') return { title: s.title, description: s.description };
  return { title: s.titleTr || s.title, description: s.descriptionTr || s.description };
}
```

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: SessionRow.** Import `sessionText`; `const lang = getLangFromUrl(Astro.url); const text = sessionText(session, lang);` and render `text.title` / `text.description` in place of `session.title` / `session.description`.

- [ ] **Step 6: ScheduleDays component** `src/components/ScheduleDays.astro`:

```astro
---
import type { Session, Speaker } from "../lib/content";
import SessionRow from "./SessionRow.astro";
import { groupByDay } from "../lib/schedule-days";
import { getLangFromUrl } from "../i18n/ui";

interface Props { sessions: Session[]; speakers: Speaker[]; startDate?: Date }
const { sessions, speakers, startDate } = Astro.props;
const groups = groupByDay(sessions, startDate, getLangFromUrl(Astro.url));
---
<div class="p-4 space-y-6">
  {groups.map((g) => (
    <section class="space-y-2" aria-labelledby={g.heading ? `day-${g.day}` : undefined}>
      {g.heading && (
        <h3 id={`day-${g.day}`} class="text-xs font-semibold uppercase tracking-wider text-navy-mid border-b border-border pb-1.5">
          {g.heading}
        </h3>
      )}
      {g.sessions.map((session) => <SessionRow session={session} speakers={speakers} />)}
    </section>
  ))}
</div>
```

- [ ] **Step 7: Pages.** In both schedule pages replace the `<!-- Sessions list -->` div with `<ScheduleDays sessions={sessions} speakers={scheduleSpeakers} startDate={edition.data.startDate} />` (import it, drop the `SessionRow` import). In the header block, after the location `<p>`s, add `<p class="text-sm text-gray-600 mt-1">{t("schedule.language")}</p>`. Add i18n: en `"schedule.language": "Event language: English"`, tr `"schedule.language": "Etkinlik dili: İngilizce"`.

- [ ] **Step 8: Run** `npm test && npm run build` in `symposium_website/`. Expected: PASS; `translations.test.ts` passes with the new key in both languages.

- [ ] **Step 9: Commit** `git commit -am "Schedule grouped by day, in each page's own language"`.

---

### Task 5: Ship and migrate 2026 data (operator steps, not subagent work)

- [ ] **Step 1:** Push the branch, open the PR, and get CI green.
- [ ] **Step 2:** Before merge, run the three `ALTER TABLE` commands against remote D1. They are additive with defaults, so the currently deployed code keeps working; the new code's SELECTs need them to exist.
- [ ] **Step 3:** Merge. Wait for the main `website` deploy, and confirm `/api/symposium` sessions now carry `day`, `titleTr`, `descriptionTr`.
- [ ] **Step 4:** Show the organiser the English translations for the 18 sessions. On approval, run one SQL file that moves the current Turkish into `title_tr`/`description_tr`, writes English into `title`/`description`, sets `day = 2` on the three workshop-day rows, and strips the hand-typed day and language notes.
- [ ] **Step 5:** Trigger a symposium rebuild (a no-op panel save). Verify `/schedule` and `/tr/schedule` on `symposium.rsg-turkiye.iscbsc.org` in a browser: two headings, English text on the English page, Turkish on the Turkish page, the language line under the venue.
- [ ] **Step 6:** Signed-in admin check: open a session, change nothing, save; then confirm the API row is unchanged.
