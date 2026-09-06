import type { Env } from './auth';
import { generateId } from './auth';

export const RANK_ORDINALS: Record<string, number> = {
  seed: 1,
  sprout: 2,
  sapling: 3,
  legacy_tree: 4,
};

export type Rank = keyof typeof RANK_ORDINALS;

/**
 * Is this a rank?
 *
 * The admin endpoint asked `rank in RANK_ORDINALS`, and `in` walks the
 * prototype chain: "toString", "constructor", "hasOwnProperty" and the rest
 * of Object.prototype all pass. `RANK_ORDINALS["toString"]` is a function,
 * which then went into a D1 bind as the rank ordinal -- a 500 from a request
 * that should have been a 400, and a row in rank_history if it had not.
 */
export function isRank(value: unknown): value is Rank {
  return typeof value === "string" && Object.hasOwn(RANK_ORDINALS, value);
}

/**
 * The rank a member holds now: the most recent entry in their history.
 *
 * This used to order by rank_ordinal first, which meant it returned the
 * highest rank ever held rather than the current one. An admin choosing a
 * lower rank wrote a row that was then never read -- the demotion appeared to
 * work, the member kept the old rank on every page, and the only trace was a
 * row in rank_history nobody looks at. Ordering by time says what the history
 * actually records.
 */
export async function getCurrentRank(
  userId: string,
  env: Env
): Promise<{ rank: string; ordinal: number; reason: string } | null> {
  return env.DB.prepare(
    'SELECT rank, rank_ordinal as ordinal, reason FROM rank_history WHERE user_id = ? ORDER BY computed_at DESC, rowid DESC LIMIT 1'
  ).bind(userId).first<{ rank: string; ordinal: number; reason: string }>();
}

/** The reason stamped on a rank an admin chose by hand. */
export const MANUAL_REASON = 'admin_manual';

export async function awardRank(
  userId: string,
  rank: Rank,
  reason: string,
  env: Env
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO rank_history (id, user_id, rank, rank_ordinal, reason, computed_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(generateId(), userId, rank, RANK_ORDINALS[rank], reason, Math.floor(Date.now() / 1000)).run();
}

/**
 * Auto-promotes Seed -> Sprout -> Sapling based on learning-path completion
 * count. Thresholds are a placeholder until event-participation and
 * community-contribution tracking exist to blend in -- tune freely, they
 * aren't load-bearing on the schema.
 *
 * Legacy Tree is deliberately excluded: it's meant to recognize giving back
 * to the community, which has no automatic signal yet. Admin-only for now
 * (see functions/api/admin/users.ts, action "set_rank").
 */
export async function maybeAutoPromote(userId: string, env: Env): Promise<void> {
  const current = await getCurrentRank(userId, env);
  // An admin's decision is not something a progress counter overrules. Now
  // that getCurrentRank returns the latest rank rather than the highest, a
  // demoted member would otherwise be promoted back the next time they
  // finished a learning path.
  if (current?.reason === MANUAL_REASON) return;
  const currentOrdinal = current?.ordinal ?? RANK_ORDINALS.seed;
  if (currentOrdinal >= RANK_ORDINALS.sapling) return;

  const completed = await env.DB.prepare(
    'SELECT COUNT(*) as n FROM progress WHERE user_id = ? AND completed = 1'
  ).bind(userId).first<{ n: number }>();
  const n = completed?.n ?? 0;

  let target: Rank | null = null;
  if (n >= 10) target = 'sapling';
  else if (n >= 3) target = 'sprout';

  if (target && RANK_ORDINALS[target] > currentOrdinal) {
    await awardRank(userId, target, 'auto_learning_path_progress', env);
  }
}
