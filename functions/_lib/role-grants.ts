// Roles as grants with an optional end date. role_grants is the record; the
// users.is_* columns are a cache of it that every permission check still
// reads, so each change rewrites them in the same batch as the grant and its
// audit row (runWithAudit). The one definition of "held" is LIVE below.

import { runWithAudit } from './audit';
import { ROLES, roleDef, type RoleKey } from './roles';

/** A grant that counts right now. Binds one parameter: now. */
const LIVE = 'revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)';

const COLUMN_ROLES = ROLES.filter((r) => r.column);

/**
 * One UPDATE that sets every is_* column of `userId` to whether a live grant
 * of that role exists. Grant, revoke and the expiry job all go through it, so
 * the columns can never disagree with the grants about what "live" means.
 */
export function syncColumnsStatement(db: D1Database, userId: string, now: number): D1PreparedStatement {
  const sets = COLUMN_ROLES.map(
    (r) => `${r.column} = EXISTS (SELECT 1 FROM role_grants WHERE user_id = users.id AND role = '${r.key}' AND ${LIVE})`,
  );
  return db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...COLUMN_ROLES.map(() => now), userId);
}

/** null is the latest end there is. */
const endsLater = (a: number | null, b: number | null) => (a === null ? b !== null : b !== null && a > b);

async function liveEnd(db: D1Database, userId: string, role: RoleKey, now: number): Promise<{ held: boolean; end: number | null }> {
  const { results } = await db.prepare(`SELECT expires_at FROM role_grants WHERE user_id = ? AND role = ? AND ${LIVE}`)
    .bind(userId, role, now).all<{ expires_at: number | null }>();
  if (results.length === 0) return { held: false, end: null };
  return { held: true, end: results.some((r) => r.expires_at === null) ? null : Math.max(...results.map((r) => r.expires_at!)) };
}

const endLive = (db: D1Database, userId: string, role: RoleKey, by: string | null, now: number) =>
  db.prepare(`UPDATE role_grants SET revoked_at = ?, revoked_by = ? WHERE user_id = ? AND role = ? AND ${LIVE}`)
    .bind(now, by, userId, role, now);

/**
 * Grants `role` (and the roles it implies) until `expiresAt`, null for good.
 * At most one live grant per user and role: a grant that ends later replaces
 * the live one, and one that ends sooner changes nothing but is still logged,
 * with `kept: true`. `extra` statements join the same batch.
 */
export async function grantRole(
  db: D1Database,
  p: { userId: string; role: RoleKey; expiresAt: number | null; by: string | null; note?: string; extra?: D1PreparedStatement[] },
  now: number,
): Promise<void> {
  const def = roleDef(p.role);
  if (!def) throw new Error(`unknown role: ${p.role}`);
  const statements: D1PreparedStatement[] = [];
  let kept = false;
  for (const role of [def.key, ...(def.implies ?? [])]) {
    const current = await liveEnd(db, p.userId, role, now);
    if (current.held && !endsLater(p.expiresAt, current.end)) {
      if (role === def.key) kept = true;
      continue;
    }
    // Unconditional, though a no-op when nothing is live: the audit retry re-runs
    // this batch after a concurrent writer, and this keeps that to one live row.
    statements.push(endLive(db, p.userId, role, p.by, now));
    statements.push(db.prepare(
      'INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, note) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), p.userId, role, p.expiresAt, p.by, now, p.note ?? null));
  }
  statements.push(syncColumnsStatement(db, p.userId, now), ...(p.extra ?? []));
  await runWithAudit(db, statements, {
    userId: p.by, action: 'role.grant', targetType: 'user', targetId: p.userId,
    details: kept ? { role: p.role, expiresAt: p.expiresAt, kept: true } : { role: p.role, expiresAt: p.expiresAt },
  }, now);
}

/**
 * Ends every live grant of `role`. Taking away social also takes away
 * social_publisher, which cannot work without it; the reverse leaves social.
 * The audit row's expiresAt is when the revoked grant would have ended.
 */
export async function revokeRole(
  db: D1Database,
  p: { userId: string; role: RoleKey; by: string; extra?: D1PreparedStatement[] },
  now: number,
): Promise<void> {
  if (!roleDef(p.role)) throw new Error(`unknown role: ${p.role}`);
  const current = await liveEnd(db, p.userId, p.role, now);
  const roles = ROLES.filter((r) => r.key === p.role || r.implies?.includes(p.role)).map((r) => r.key);
  await runWithAudit(db, [
    ...roles.map((role) => endLive(db, p.userId, role, p.by, now)),
    syncColumnsStatement(db, p.userId, now),
    ...(p.extra ?? []),
  ], {
    userId: p.by, action: 'role.revoke', targetType: 'user', targetId: p.userId,
    details: { role: p.role, expiresAt: current.end },
  }, now);
}

/** The user's live grants, one row per grant. */
export async function activeGrants(db: D1Database, userId: string, now: number): Promise<{ role: string; expires_at: number | null }[]> {
  const { results } = await db.prepare(`SELECT role, expires_at FROM role_grants WHERE user_id = ? AND ${LIVE}`)
    .bind(userId, now).all<{ role: string; expires_at: number | null }>();
  return results;
}
