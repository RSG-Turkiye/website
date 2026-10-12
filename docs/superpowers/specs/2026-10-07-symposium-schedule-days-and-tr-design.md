# Symposium schedule: days and a Turkish translation

## Problem

The 2026 programme runs over two days, and its session titles exist in one
language only. The schedule page renders every session as one flat list, so
day 2's 13:00 workshop follows day 1's 17:00 closing as if it were the same
day. The English `/schedule` page prints the Turkish titles, because a session
has a single `title` and a single `description`.

Both structures have to be reusable next year without code changes.

## Decisions

- **English is canonical, Turkish is the translation.** `title` and
  `description` hold English; new `titleTr` / `descriptionTr` hold Turkish.
  This is the rule the rest of the symposium content already follows
  (`title`/`titleTr`, `venue`/`venueTr`, `date`/`dateTr`, `role`/`roleTr`).
  The event language is English. An empty translation falls back to English
  on the Turkish page, never the other way round.
- **Day is a number, not a date.** A session carries `day` (1, 2, ...). The
  day heading's date is derived from the edition's `startDate` plus
  `day - 1`, so moving the edition moves every heading with it. Nothing is
  typed twice.
- **Headings only when there is more than one day.** A single-day programme,
  including every archived edition, renders exactly as it does today.

## Data

D1, `symposium_sessions`, three new columns:

```sql
ALTER TABLE symposium_sessions ADD COLUMN day INTEGER NOT NULL DEFAULT 1;
ALTER TABLE symposium_sessions ADD COLUMN title_tr TEXT NOT NULL DEFAULT '';
ALTER TABLE symposium_sessions ADD COLUMN description_tr TEXT NOT NULL DEFAULT '';
```

`db/schema.sql` gets the columns in the `CREATE TABLE` and the `ALTER`
commands in its migration comment block, as the committee `teams` column did.

Defaults keep every existing row valid: day 1, no translation.

## Flow

The fields travel the same path `role_tr` does, end to end:

| Layer | Change |
|---|---|
| `functions/_lib/symposium.ts` | `SessionRow` + `day`, `title_tr`, `description_tr`; `OverlaySession` + `day`, `titleTr`, `descriptionTr`; `rowFromInput` validates `day` as an integer >= 1 (default 1); `rowToInput` and the overlay mapper carry them |
| `functions/api/admin/symposium/[kind].ts`, `[kind]/[id].ts` | list columns, INSERT and UPDATE include the three columns |
| `functions/api/symposium.ts` | SELECT includes them |
| `archive.ts` | snapshot JSON carries them (it reuses the overlay mapper) |
| `symposium_website/src/content.config.ts` | sessions schema: `day` default 1, `titleTr` / `descriptionTr` default `""` |
| `symposium_website/src/lib/content.ts`, `overlay.ts` | `Session` type and the overlay's zod shape gain the fields |
| Admin pane + `admin-panel.ts` | session form: day select (1-5), English title (required), Turkish title (optional), English and Turkish descriptions; table shows the day |

## Rendering

`schedule.astro` and `tr/schedule.astro` group sessions by `day`, ordered by
day then the existing sort. A pure helper in `symposium_website/src/lib/`
(`groupByDay`, plus `dayHeading(startDate, day, lang)`) does the grouping and
the date arithmetic, so it is tested without Astro.

Heading text: `DAY 1 · Saturday, 10 October` / `1. GÜN · 10 Ekim Cumartesi`,
rendered as a small uppercase label between groups. `SessionRow` picks
`titleTr || title` and `descriptionTr || description` on Turkish pages.

The header box gains one line under the venue: `Event language: English` /
`Etkinlik dili: İngilizce`, from i18n strings. It is static for now; making it
an edition field is deferred until an edition is held in another language.

## 2026 data

After deploy and migration, the 18 existing rows are rewritten: current
Turkish text moves to `title_tr` / `description_tr`, English translations go
into `title` / `description`, workshop rows get `day = 2`, and the hand-typed
"1. Gün ..." / "2. Gün ..." / event-language notes are removed from the
descriptions. The English translations are shown to the organiser before they
are written.

## Testing

- `groupByDay` / `dayHeading`: single day yields no headings; two days split
  correctly; dates derive from `startDate`; both languages.
- `rowFromInput`: day default, rejects 0 / non-integers, carries translations.
- Existing `symposium-shape` and `symposium-columns` tests updated for the
  new columns (the columns test is what catches a SELECT that forgets one).
- Browser check of `/schedule` and `/tr/schedule` after deploy, and a
  signed-in admin form round trip.

## Out of scope

- A separate session-track field ("Session 1: Immunoinformatics ..."). Track
  names stay in the description.
- Translating speaker bios.
