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
