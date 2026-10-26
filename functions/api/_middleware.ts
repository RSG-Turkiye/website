// The first gate for agent tokens, on every /api/* request. A request that
// carries an Authorization header and is not in the agent route table is
// refused here, before any handler runs, so an endpoint that only knows
// cookies can never be reached with a token. Routes in the table go on to
// their handler, whose gate (authenticateAgent) checks the IP, the token and
// the table again, and counts the request. No header: nothing changes, so
// people in the panel are never counted or limited here.
//
// A refusal here costs at most one row written (agent-limits.ts,
// countRefusal), and none from an IP that is already cut off. The counter
// writes are bookkeeping: if D1 fails, a refusal is still a refusal.

import { routeFor } from '../_lib/agent-routes';
import { hashToken, humanOnly } from '../_lib/agent-tokens';
import { countRefusal, type RefusedToken } from '../_lib/agent-limits';
import type { Env } from '../_lib/auth';

// A personal token or an OAuth connection's access token (agent-tokens.ts).
const TOKEN = /^Bearer (rsg_(?:pat|oat)_[A-Za-z0-9_-]{43})$/;

function logFailure(e: unknown) {
  // The error's name only: never a header or a body.
  console.error('agent limits: the counter write failed', e instanceof Error ? e.name : 'error');
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const header = request.headers.get('Authorization');
  if (header === null) return next();
  if (routeFor(request.method, new URL(request.url).pathname)) return next();

  const now = Math.floor(Date.now() / 1000);
  // Which token the header names, looked up only once the IP is known not to be cut off.
  const lookup = async (): Promise<RefusedToken> => {
    const value = TOKEN.exec(header)?.[1];
    if (!value) return 'none';
    const row = await env.DB.prepare('SELECT id, user_id, revoked_at, expires_at, kind, access_expires_at FROM agent_tokens WHERE token_hash = ?')
      .bind(await hashToken(value)).first<{ id: string; user_id: string; revoked_at: number | null; expires_at: number; kind: string; access_expires_at: number | null }>();
    if (!row) return 'unknown';
    // A connection's access token past its hour is stale, like a revoked token: not counted.
    const accessLive = row.kind !== 'oauth' || (row.access_expires_at !== null && row.access_expires_at > now);
    return row.revoked_at === null && row.expires_at > now && accessLive ? { id: row.id, user_id: row.user_id } : 'dead';
  };
  try {
    // Over an IP limit this answers 429 rather than 403: both refuse, and 429 tells a loop to back off.
    const limited = await countRefusal(env.DB, request, lookup, now);
    if (limited) return limited;
  } catch (e) {
    logFailure(e);
  }
  return humanOnly();
};
