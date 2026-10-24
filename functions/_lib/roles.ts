// The role catalog and the rule for how long a grant may last. Pure: no
// database access, so the admin panel and the endpoints share one answer.
// `is_member` is membership, not a role, and is deliberately not listed.

import { TR_OFFSET } from './stats';

export type RoleKey =
  | 'admin' | 'announcer' | 'writer' | 'sender' | 'symposium' | 'social' | 'social_publisher'
  | `content.${CmsGroup}.edit` | `content.${CmsGroup}.approve`;

export interface RoleDef {
  key: RoleKey;
  /** Leader roles may run up to a year; edit roles one month, then renew. */
  level: 'leader' | 'edit';
  /** The legacy users.is_* flag that mirrors this role. */
  column?: string;
  /** Roles held automatically along with this one. */
  implies?: RoleKey[];
  /** Holding this role lets a non-admin grant this one, for one month. */
  approverRole?: RoleKey;
  /** No longer granted by anyone (resolveExpiry and grantRole refuse it).
   * Kept in the catalog so live grants can still be revoked and the role
   * history still reads. */
  retired?: true;
}

/** The content groups of the panel CMS. A group's rights are its content.<group>.* roles. */
export const CMS_GROUPS = ['etkinlikler', 'yazilar', 'ogrenme', 'topluluk', 'sayfalar'] as const;
export type CmsGroup = (typeof CMS_GROUPS)[number];
export type GroupRights = Record<CmsGroup, { edit: boolean; approve: boolean }>;

export const ROLES: readonly RoleDef[] = [
  { key: 'admin', level: 'leader', column: 'is_admin' },
  { key: 'announcer', level: 'leader', column: 'is_announcer' },
  { key: 'symposium', level: 'leader', column: 'is_symposium' },
  { key: 'social_publisher', level: 'leader', column: 'is_social_publisher', implies: ['social'] },
  // Retired: blog posts are written in the panel CMS (content.yazilar.*).
  { key: 'writer', level: 'edit', column: 'is_writer', retired: true },
  { key: 'sender', level: 'edit', column: 'is_sender' },
  { key: 'social', level: 'edit', column: 'is_social' },
  // Content groups (the panel CMS), two roles each. No column: they live in
  // role_grants only. Approve is a leader role only an admin grants; edit
  // runs a month, and the group's approver may grant it too.
  ...CMS_GROUPS.flatMap((g): RoleDef[] => [
    { key: `content.${g}.approve`, level: 'leader' },
    { key: `content.${g}.edit`, level: 'edit', approverRole: `content.${g}.approve` },
  ]),
];

/**
 * What a set of live roles allows in each content group. Approvers can do
 * everything editors can; an admin can do everything. Pure, so the panel
 * and the server answer alike.
 */
export function rightsFromRoles(roles: readonly string[], isAdmin: boolean): GroupRights {
  const held = new Set(roles);
  return Object.fromEntries(CMS_GROUPS.map((g) => {
    const approve = isAdmin || held.has(`content.${g}.approve`);
    return [g, { edit: approve || held.has(`content.${g}.edit`), approve }];
  })) as GroupRights;
}

const BY_KEY = new Map<string, RoleDef>(ROLES.map((r) => [r.key, r]));

/** A Map, not an object lookup, so 'constructor' is not a role. */
export function roleDef(key: string): RoleDef | null {
  return BY_KEY.get(key) ?? null;
}

/** The roles a non-admin holding `activeRoles` may grant and take away: those they are the approver of. */
export function grantableBy(activeRoles: readonly string[]): RoleKey[] {
  return ROLES.filter((r) => r.approverRole && activeRoles.includes(r.approverRole)).map((r) => r.key);
}

export type Duration =
  | { months: 1 | 2 | 3 | 6 | 12 }
  | { until: number }
  | { permanent: true };

/**
 * The request body's `duration`, if it has the shape of a Duration: exactly
 * one of months, until or permanent. Whether the values are allowed is
 * resolveExpiry's question, so { months: 5 } passes here and fails there.
 */
export function parseDuration(x: unknown): Duration | null {
  if (x === null || typeof x !== 'object' || Array.isArray(x)) return null;
  const keys = Object.keys(x);
  if (keys.length !== 1) return null;
  const o = x as Record<string, unknown>;
  if (keys[0] === 'months' && typeof o.months === 'number') return { months: o.months as 1 };
  if (keys[0] === 'until' && typeof o.until === 'number') return { until: o.until };
  if (keys[0] === 'permanent' && o.permanent === true) return { permanent: true };
  return null;
}

/** What the panel's plain on/off switch means: leaders keep it, editors renew monthly. */
export function defaultDuration(def: RoleDef): Duration {
  return def.level === 'leader' ? { permanent: true } : { months: 1 };
}

export type ExpiryResult =
  | { ok: true; expiresAt: number | null }
  | { ok: false; code: 'too_long' | 'permanent_not_allowed' | 'in_the_past' | 'bad_duration' | 'not_allowed' | 'retired' };

const OFFERED_MONTHS = [1, 2, 3, 6, 12];

/**
 * `ts` plus whole calendar months in Türkiye time, keeping the time of day.
 * A day the target month lacks lands on its last day (31 Jan + 1 = 28 Feb).
 * Exported for the admin panel's date picker, so its latest offered date is
 * the one this rule accepts.
 */
export function addMonths(ts: number, months: number): number {
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
 * cover for an editor but never widen access on their own. A retired role
 * is granted by nobody.
 */
export function resolveExpiry(
  def: RoleDef,
  d: Duration,
  now: number,
  granter: { isAdmin: boolean; activeRoles: string[] },
): ExpiryResult {
  if (def.retired) return { ok: false, code: 'retired' };
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
