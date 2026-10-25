import type { DatabaseSync } from 'node:sqlite';
import { hashToken, newTokenValue } from '../../functions/_lib/agent-tokens';

/**
 * Inserts a personal agent token for `userId` and returns its value, the
 * only copy there is (the row holds the hash). `scopes` are stored as given,
 * so a test can also store a scope list the API would refuse.
 */
export async function mintToken(
  db: DatabaseSync,
  userId: string,
  scopes: string[],
  opts: { id?: string; label?: string; createdAt?: number; expiresAt?: number; revokedAt?: number | null; lastUsedAt?: number | null } = {},
): Promise<string> {
  const value = newTokenValue();
  db.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, hint, label, scopes, created_at, expires_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    opts.id ?? crypto.randomUUID(), userId, await hashToken(value), value.slice(-4), opts.label ?? 'test agent',
    JSON.stringify(scopes), opts.createdAt ?? 1, opts.expiresAt ?? 4_000_000_000, opts.lastUsedAt ?? null, opts.revokedAt ?? null,
  );
  return value;
}

/** The request header that carries a token. */
export const bearer = (value: string): Record<string, string> => ({ Authorization: `Bearer ${value}` });
