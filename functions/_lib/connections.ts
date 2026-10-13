import { seal, unseal } from './token-vault';

export type Platform = 'gmail' | 'instagram' | 'linkedin' | 'x';
/** Display order in the panel and the banner. */
export const PLATFORMS: Platform[] = ['gmail', 'instagram', 'linkedin', 'x'];
export const isPlatform = (v: unknown): v is Platform => typeof v === 'string' && (PLATFORMS as string[]).includes(v);

export const EXPIRING_WINDOW_SECONDS = 14 * 86400;
const MAX_ERROR_LENGTH = 300;

export interface ConnectionRow {
  platform: Platform;
  account_id: string | null;
  account_name: string | null;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  scopes: string | null;
  expires_at: number | null;
  refresh_expires_at: number | null;
  connected_by: string | null;
  connected_at: number | null;
  last_ok_at: number | null;
  last_error: string | null;
  last_error_at: number | null;
}

export type ConnectionStatus = 'connected' | 'expiring' | 'broken' | 'unused';

/**
 * Derived, never stored, so it cannot go stale. An error newer than the last
 * success means broken; a later success clears it. `hasLegacyToken` covers
 * Gmail while its refresh token still lives in the GMAIL_REFRESH_TOKEN secret.
 */
export function connectionStatus(row: ConnectionRow | null, now: number, hasLegacyToken = false): ConnectionStatus {
  const hasToken = Boolean(row?.refresh_token_enc || row?.access_token_enc) || hasLegacyToken;
  if (!hasToken) return 'unused';
  if (row?.last_error_at != null && (row.last_ok_at == null || row.last_error_at >= row.last_ok_at)) return 'broken';
  const expiry = row?.refresh_expires_at ?? row?.expires_at ?? null;
  if (expiry !== null && expiry <= now) return 'broken';
  if (expiry !== null && expiry - now <= EXPIRING_WINDOW_SECONDS) return 'expiring';
  return 'connected';
}

export const tokenContext = (platform: Platform, kind: 'access' | 'refresh') => `${platform}:${kind}`;

export function getConnection(db: D1Database, platform: Platform): Promise<ConnectionRow | null> {
  return db.prepare('SELECT * FROM platform_connections WHERE platform = ?').bind(platform).first<ConnectionRow>();
}

export async function listConnections(db: D1Database): Promise<ConnectionRow[]> {
  return (await db.prepare('SELECT * FROM platform_connections').all<ConnectionRow>()).results;
}

export interface NewTokens {
  accountId: string | null;
  accountName: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scopes: string;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
}

/** A statement, not a write, so the caller can batch it with its audit row. */
export async function connectionUpsert(
  env: { DB: D1Database; TOKEN_ENC_KEY?: string },
  platform: Platform,
  tokens: NewTokens,
  userId: string,
  now: number,
): Promise<D1PreparedStatement> {
  const access = tokens.accessToken ? await seal(env.TOKEN_ENC_KEY, tokens.accessToken, tokenContext(platform, 'access')) : null;
  const refresh = tokens.refreshToken ? await seal(env.TOKEN_ENC_KEY, tokens.refreshToken, tokenContext(platform, 'refresh')) : null;
  return env.DB.prepare(
    `INSERT INTO platform_connections
       (platform, account_id, account_name, access_token_enc, refresh_token_enc, scopes, expires_at, refresh_expires_at,
        connected_by, connected_at, last_ok_at, last_error, last_error_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
     ON CONFLICT(platform) DO UPDATE SET
       account_id = excluded.account_id, account_name = excluded.account_name,
       access_token_enc = excluded.access_token_enc, refresh_token_enc = excluded.refresh_token_enc,
       scopes = excluded.scopes, expires_at = excluded.expires_at, refresh_expires_at = excluded.refresh_expires_at,
       connected_by = excluded.connected_by, connected_at = excluded.connected_at,
       last_ok_at = excluded.last_ok_at, last_error = NULL, last_error_at = NULL`,
  ).bind(platform, tokens.accountId, tokens.accountName, access, refresh, tokens.scopes, tokens.expiresAt, tokens.refreshExpiresAt, userId, now, now);
}

export function disconnectStatement(db: D1Database, platform: Platform): D1PreparedStatement {
  return db.prepare('DELETE FROM platform_connections WHERE platform = ?').bind(platform);
}

export async function markOk(db: D1Database, platform: Platform, now: number): Promise<void> {
  await db.prepare(
    'INSERT INTO platform_connections (platform, last_ok_at) VALUES (?, ?) ON CONFLICT(platform) DO UPDATE SET last_ok_at = excluded.last_ok_at',
  ).bind(platform, now).run();
}

export async function markBroken(db: D1Database, platform: Platform, error: string, now: number): Promise<void> {
  await db.prepare(
    `INSERT INTO platform_connections (platform, last_error, last_error_at) VALUES (?, ?, ?)
     ON CONFLICT(platform) DO UPDATE SET last_error = excluded.last_error, last_error_at = excluded.last_error_at`,
  ).bind(platform, error.slice(0, MAX_ERROR_LENGTH), now).run();
}

export async function readRefreshToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null> {
  return row.refresh_token_enc ? unseal(env.TOKEN_ENC_KEY, row.refresh_token_enc, tokenContext(row.platform, 'refresh')) : null;
}

/** The stored access token, or null when there is none or it cannot be opened (wrong key, tampered row). */
export async function readAccessToken(env: { TOKEN_ENC_KEY?: string }, row: ConnectionRow): Promise<string | null> {
  if (!row.access_token_enc) return null;
  try {
    return await unseal(env.TOKEN_ENC_KEY, row.access_token_enc, tokenContext(row.platform, 'access'));
  } catch {
    return null;
  }
}
