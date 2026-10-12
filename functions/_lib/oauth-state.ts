export const STATE_TTL_SECONDS = 600;

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createState(
  db: D1Database, platform: string, userId: string, returnTo: '/admin' | '/tr/admin', now: number,
): Promise<string> {
  const state = randomState();
  await db.batch([
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO oauth_states (state, platform, user_id, return_to, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(state, platform, userId, returnTo, now + STATE_TTL_SECONDS),
  ]);
  return state;
}

/** Single use: the row is deleted as it is read, so a replay finds nothing. */
export function consumeState(db: D1Database, state: string, now: number) {
  return db.prepare('DELETE FROM oauth_states WHERE state = ? AND expires_at > ? RETURNING platform, user_id, return_to')
    .bind(state, now).first<{ platform: string; user_id: string; return_to: string }>();
}
