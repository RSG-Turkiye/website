// The role catalog and the rule for how long a grant may last. Pure: no
// database access, so the admin panel and the endpoints share one answer.
// `is_member` is membership, not a role, and is deliberately not listed.

import { TR_OFFSET } from './stats';

export type RoleKey =
  | 'admin' | 'announcer' | 'writer' | 'sender' | 'symposium' | 'social' | 'social_publisher';

export interface RoleDef {
  key: RoleKey;
  /** Leader roles may run up to a year; edit roles one month, then renew. */
  level: 'leader' | 'edit';
  /** The legacy users.is_* flag that mirrors this role. */
  column?: string;
  /** Roles held automatically along with this one. */
  implies?: RoleKey[];
  /** Holding this role lets a non-admin grant this one, for one month. */
  approverRole?: string;
}

export const ROLES: readonly RoleDef[] = [
  { key: 'admin', level: 'leader', column: 'is_admin' },
  { key: 'announcer', level: 'leader', column: 'is_announcer' },
  { key: 'symposium', level: 'leader', column: 'is_symposium' },
  { key: 'social_publisher', level: 'leader', column: 'is_social_publisher', implies: ['social'] },
  { key: 'writer', level: 'edit', column: 'is_writer' },
  { key: 'sender', level: 'edit', column: 'is_sender' },
  { key: 'social', level: 'edit', column: 'is_social' },
];

const BY_KEY = new Map<string, RoleDef>(ROLES.map((r) => [r.key, r]));

/** A Map, not an object lookup, so 'constructor' is not a role. */
export function roleDef(key: string): RoleDef | null {
  return BY_KEY.get(key) ?? null;
}

export type Duration =
  | { months: 1 | 2 | 3 | 6 | 12 }
  | { until: number }
  | { permanent: true };

export type ExpiryResult =
  | { ok: true; expiresAt: number | null }
  | { ok: false; code: 'too_long' | 'permanent_not_allowed' | 'in_the_past' | 'bad_duration' | 'not_allowed' };

const OFFERED_MONTHS = [1, 2, 3, 6, 12];

/**
 * `ts` plus whole calendar months in Türkiye time, keeping the time of day.
 * A day the target month lacks lands on its last day (31 Jan + 1 = 28 Feb).
 */
function addMonths(ts: number, months: number): number {
  const d = new Date((ts + TR_OFFSET) * 1000);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + months;
  // Day 0 of the following month is the last day of the target month.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const ms = Date.UTC(year, month, Math.min(d.getUTCDate(), lastDay),
    d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  return ms / 1000 - TR_OFFSET;
}

/**
 * Whether `granter` may grant `def` for `d`, and when it then ends. An admin
 * is bound only by the role's level. Anyone else may grant just the role
 * whose approver role they hold, for at most a month, so an approver can
 * cover for an editor but never widen access on their own.
 */
export function resolveExpiry(
  def: RoleDef,
  d: Duration,
  now: number,
  granter: { isAdmin: boolean; activeRoles: string[] },
): ExpiryResult {
  const delegated = !granter.isAdmin;
  if (delegated && !(def.approverRole && granter.activeRoles.includes(def.approverRole))) {
    return { ok: false, code: 'not_allowed' };
  }

  if ('permanent' in d) {
    return delegated || def.level !== 'leader'
      ? { ok: false, code: 'permanent_not_allowed' }
      : { ok: true, expiresAt: null };
  }

  const maxMonths = delegated || def.level === 'edit' ? 1 : 12;
  let expiresAt: number;
  if ('months' in d) {
    if (!OFFERED_MONTHS.includes(d.months)) return { ok: false, code: 'bad_duration' };
    expiresAt = addMonths(now, d.months);
  } else {
    if (!Number.isFinite(d.until)) return { ok: false, code: 'bad_duration' };
    expiresAt = Math.floor(d.until);
  }
  if (expiresAt <= now) return { ok: false, code: 'in_the_past' };
  if (expiresAt > addMonths(now, maxMonths)) return { ok: false, code: 'too_long' };
  return { ok: true, expiresAt };
}
