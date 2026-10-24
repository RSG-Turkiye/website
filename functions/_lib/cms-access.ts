// Who may do what in the panel CMS, per content group. The rule itself is
// pure and lives in roles.ts (rightsFromRoles), so the panel can show the
// same answer from /api/me; this reads the live grants it is applied to.

import { canSeeAdminPanel, type User } from './auth';
import { activeGrants } from './role-grants';
import { rightsFromRoles, type CmsGroup, type GroupRights } from './roles';

export type { CmsGroup, GroupRights };
export { rightsFromRoles };

/** Edit and approve rights in each content group, from live grants plus is_admin. */
export async function groupRights(db: D1Database, user: Pick<User, 'id' | 'is_admin'>, now: number): Promise<GroupRights> {
  if (user.is_admin === 1) return rightsFromRoles([], true);
  const roles = (await activeGrants(db, user.id, now)).map((g) => g.role);
  return rightsFromRoles(roles, false);
}

/** Edit rights in at least one group: enough to open /admin. */
export async function editsAnyGroup(db: D1Database, user: Pick<User, 'id' | 'is_admin'>, now: number): Promise<boolean> {
  return Object.values(await groupRights(db, user, now)).some((r) => r.edit);
}

/**
 * canSeeAdminPanel with content editors counted. The is_* columns answer
 * for everyone else, so role_grants is read only when they say no.
 */
export async function canOpenAdminPanel(db: D1Database, user: User, now: number): Promise<boolean> {
  return canSeeAdminPanel(user) || await editsAnyGroup(db, user, now);
}
