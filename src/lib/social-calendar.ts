/**
 * Calendar arithmetic for the social panel, all in Türkiye time. Grid days
 * are calendar dates (YYYY-MM-DD), computed on dates rather than instants so
 * no host timezone leaks in; instants go through istanbul-time.ts.
 */
import { epochToIstanbulInput, istanbulInputToEpoch } from './istanbul-time';

export interface GridDay { key: string; day: number; inMonth: boolean }

const DAY_MS = 86_400_000;

/** Six weeks, Monday first, so every month fits and the grid never changes height. */
export function monthGrid(year: number, month: number): GridDay[] {
  const first = Date.UTC(year, month - 1, 1);
  const lead = (new Date(first).getUTCDay() + 6) % 7;
  const days: GridDay[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(first + (i - lead) * DAY_MS);
    days.push({ key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === month - 1 });
  }
  return days;
}

/** From the grid's first midnight to its last minute, in epoch seconds. */
export function gridRange(grid: GridDay[]): { from: number; to: number } {
  return {
    from: istanbulInputToEpoch(`${grid[0].key}T00:00`)!,
    to: istanbulInputToEpoch(`${grid[grid.length - 1].key}T23:59`)! + 59,
  };
}

export const dayKey = (epoch: number) => epochToIstanbulInput(epoch).slice(0, 10);
export const timeOf = (epoch: number) => epochToIstanbulInput(epoch).slice(11, 16);

/** The panel's default publishing time: the hour the account already posts most. */
export const DEFAULT_TIME = '18:00';

export function epochAt(date: string, time: string = DEFAULT_TIME): number | null {
  return istanbulInputToEpoch(`${date}T${time}`) ?? null;
}

export function bucketByDay<T>(items: T[], at: (item: T) => number | null): Map<string, T[]> {
  const out = new Map<string, T[]>();
  const dated = items.filter((i) => at(i) !== null).sort((a, b) => (at(a)! - at(b)!));
  for (const item of dated) {
    const k = dayKey(at(item)!);
    const list = out.get(k);
    if (list) list.push(item); else out.set(k, [item]);
  }
  return out;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthOf(epoch: number): { year: number; month: number } {
  const [y, m] = dayKey(epoch).split('-').map(Number);
  return { year: y, month: m };
}

/** The same 48 hours the nightly reminder uses (functions/api/admin/social/plan-reminders.ts). */
export const PLAN_DUE_SECONDS = 48 * 3600;

export function planDue(plan: { scheduledAt: number; postId: string | null }, now: number): boolean {
  return plan.postId === null && plan.scheduledAt - now <= PLAN_DUE_SECONDS;
}
