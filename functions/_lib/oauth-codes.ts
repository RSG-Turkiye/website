// Authorization codes (plan 6): made when a member presses Allow on the
// consent screen, spent once at the token endpoint. A code is stored only as
// its SHA-256, lives CODE_TTL seconds, and a member holds at most
// MAX_LIVE_CODES unexpired ones, so a loop pressing Allow cannot fill D1.

import { CODE_TTL, MAX_LIVE_CODES, PREFIX, newValue, sha256Hex } from './oauth-config';
import { safeEqual } from './secret';

/** An oauth_codes row as spent. `scopes` is the JSON array the member ticked. */
export interface CodeRow {
  code_hash: string;
  user_id: string;
  client_id: string;
  label: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  days: number;
  expires_at: number;
}

/**
 * A new code for this member, or null when they already hold MAX_LIVE_CODES
 * live ones. One batch: the member's expired codes go, and the insert runs
 * only while the live count is under the cap (one row written; a refusal
 * writes nothing but the expired codes it clears).
 */
export async function createCode(
  db: D1Database,
  input: { userId: string; clientId: string; label: string; redirectUri: string; codeChallenge: string; scopes: string[]; days: number },
  now: number,
): Promise<string | null> {
  const code = newValue(PREFIX.code);
  const [, inserted] = await db.batch([
    db.prepare('DELETE FROM oauth_codes WHERE user_id = ? AND expires_at <= ?').bind(input.userId, now),
    db.prepare(
      `INSERT INTO oauth_codes (code_hash, user_id, client_id, label, redirect_uri, code_challenge, scopes, days, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE (SELECT COUNT(*) FROM oauth_codes WHERE user_id = ? AND expires_at > ?) < ?`,
    ).bind(
      await sha256Hex(code), input.userId, input.clientId, input.label, input.redirectUri, input.codeChallenge,
      JSON.stringify(input.scopes), input.days, now + CODE_TTL, input.userId, now, MAX_LIVE_CODES,
    ),
  ]);
  return inserted.meta.changes === 1 ? code : null;
}

/** Single use: the row is deleted as it is read, as consumeState in oauth-state.ts, so a replay finds nothing. */
export async function consumeCode(db: D1Database, code: string, now: number): Promise<CodeRow | null> {
  if (!code) return null;
  return db.prepare('DELETE FROM oauth_codes WHERE code_hash = ? AND expires_at > ? RETURNING *')
    .bind(await sha256Hex(code), now).first<CodeRow>();
}

const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** PKCE, S256 only (RFC 7636 §4.6): base64url(SHA-256(verifier)), no padding, compared in constant time. */
export async function pkceMatches(verifier: string, challenge: string): Promise<boolean> {
  if (typeof verifier !== 'string' || typeof challenge !== 'string' || !VERIFIER.test(verifier) || !CHALLENGE.test(challenge)) return false;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const computed = btoa(String.fromCharCode(...digest)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return safeEqual(computed, challenge);
}
