import type { DatabaseSync } from 'node:sqlite';
import { hashToken, newTokenValue } from '../../functions/_lib/agent-tokens';
import { newRefreshValue, newValue, PREFIX, sha256Hex } from '../../functions/_lib/oauth-config';

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

/**
 * Inserts an OAuth connection for `userId` (an agent_tokens row of kind
 * 'oauth', as the token endpoint makes it) and returns its id and the only
 * copies of its access and refresh values (the row holds their hashes).
 */
export async function mintConnection(
  db: DatabaseSync,
  userId: string,
  scopes: string[],
  opts: { id?: string; label?: string; clientId?: string; accessExpiresAt?: number; expiresAt?: number; revokedAt?: number | null } = {},
): Promise<{ id: string; access: string; refresh: string }> {
  const id = opts.id ?? crypto.randomUUID();
  const access = newValue(PREFIX.access);
  const refresh = newRefreshValue(id);
  db.prepare(
    `INSERT INTO agent_tokens (id, user_id, token_hash, hint, label, scopes, created_at, expires_at, revoked_at,
       kind, client_id, access_expires_at, refresh_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'oauth', ?, ?, ?)`,
  ).run(
    // No hint: the access value rotates every hour, so a connection has none to show.
    id, userId, await sha256Hex(access), '', opts.label ?? 'client.example.org', JSON.stringify(scopes), 1,
    opts.expiresAt ?? 4_000_000_000, opts.revokedAt ?? null, opts.clientId ?? 'https://client.example.org/oauth/client.json',
    opts.accessExpiresAt ?? 4_000_000_000, await sha256Hex(refresh),
  );
  return { id, access, refresh };
}
