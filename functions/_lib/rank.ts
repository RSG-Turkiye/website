import type { Env } from './auth';
import { generateId } from './auth';

export const RANK_ORDINALS: Record<string, number> = {
  seed: 1,
  sprout: 2,
  sapling: 3,
  legacy_tree: 4,
};

export type Rank = keyof typeof RANK_ORDINALS;

export async function getCurrentRank(
  userId: string,
  env: Env
): Promise<{ rank: string; ordinal: number } | null> {
  return env.DB.prepare(
    'SELECT rank, rank_ordinal as ordinal FROM rank_history WHERE user_id = ? ORDER BY rank_ordinal DESC, computed_at DESC LIMIT 1'
  ).bind(userId).first<{ rank: string; ordinal: number }>();
}

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
