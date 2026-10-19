/**
 * A token the dispatcher can publish with, per platform. Instagram and
 * LinkedIn keep a long-lived access token (renewed by the daily job); X's
 * lasts two hours and is renewed here, at the moment it is needed (Task 5
 * registers that in REFRESH_ON_USE).
 */
import type { ConnectionRow } from '../connections';
import { getConnection, connectionStatus, readAccessToken, isBufferRow, bufferOrg, withLiveExpiry } from '../connections';
import type { SocialPlatform } from '../social-limits';
import { refreshXOnUse } from './x';

export type TokenEnv = { DB: D1Database; TOKEN_ENC_KEY?: string; X_CLIENT_ID?: string; X_CLIENT_SECRET?: string; BUFFER_API_KEY?: string; BUFFER_KEY_EXPIRES?: string };

export type Usable =
  /** via: 'buffer' when the connection posts through Buffer (token = the Buffer key, account.org its organisation). */
  | { ok: true; token: string; account: { id: string; name: string | null; org?: string | null }; via?: 'buffer' }
  /** unused: never connected. broken: needs a reconnect (justBroke: this call found out). unreadable: stored token cannot be opened. */
  | { ok: false; why: 'unused' | 'unreadable' }
  | { ok: false; why: 'broken'; justBroke?: boolean; reason?: string }
  /** The provider could not be reached to renew the token; try again next tick. */
  | { ok: false; why: 'transient'; reason: string };

export type Refresher = (env: TokenEnv, row: ConnectionRow, now: number) => Promise<Usable>;

export const REFRESH_ON_USE: Partial<Record<SocialPlatform, { within: number; refresh: Refresher }>> = {};

/** X access tokens last two hours; renew one that has under five minutes left. */
REFRESH_ON_USE.x = { within: 300, refresh: refreshXOnUse };

export async function usableToken(env: TokenEnv, platform: SocialPlatform, now: number): Promise<Usable> {
  const row = withLiveExpiry(await getConnection(env.DB, platform), env);
  const status = connectionStatus(row, now);
  if (status === 'unused') return { ok: false, why: 'unused' };
  if (status === 'broken' || !row?.account_id) return { ok: false, why: 'broken' };
  // A Buffer-backed row has no token to renew; the key is a secret, rotated by hand (spec §4).
  if (isBufferRow(row)) {
    if (!env.BUFFER_API_KEY) return { ok: false, why: 'unreadable' };
    return { ok: true, token: env.BUFFER_API_KEY, account: { id: row.account_id, name: row.account_name, org: bufferOrg(row) }, via: 'buffer' };
  }
  const r = REFRESH_ON_USE[platform];
  if (r && (row.expires_at === null || row.expires_at - now <= r.within)) return r.refresh(env, row, now);
  const token = await readAccessToken(env, row);
  if (!token) return { ok: false, why: 'unreadable' };
  return { ok: true, token, account: { id: row.account_id, name: row.account_name } };
}
