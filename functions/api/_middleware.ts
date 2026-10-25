// The first gate for agent tokens, on every /api/* request. A request that
// carries an Authorization header and is not in the agent route table is
// refused here, before any handler runs, so an endpoint that only knows
// cookies can never be reached with a token. Routes in the table go on to
// their handler, whose gate (authenticateAgent) checks the token and the
// table again. No header: nothing changes.
//
// The per-IP limits and the refusal count also live here. Their D1 writes are
// bookkeeping: if D1 fails, a refusal is still a refusal and a table route
// still reaches its gate, whose own lookup and per-token limits fail closed.

import { routeFor } from '../_lib/agent-routes';
import { hashToken, humanOnly } from '../_lib/agent-tokens';
import { checkIp, countFailedAuth, countRefusal } from '../_lib/agent-limits';
import type { Env } from '../_lib/auth';

const TOKEN = /^Bearer (rsg_pat_[A-Za-z0-9_-]{43})$/;

function logFailure(e: unknown) {
  // The error's name only: never a header or a body.
  console.error('agent limits: the counter write failed', e instanceof Error ? e.name : 'error');
}

export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const header = request.headers.get('Authorization');
  if (header === null) return next();
  const now = Math.floor(Date.now() / 1000);

  let limited: Response | null = null;
  try {
    limited = await checkIp(env.DB, request, now);
  } catch (e) {
    logFailure(e);
  }

  // Over an IP limit, nothing more is counted or looked up: a client spraying
  // made-up tokens at a cut-off IP adds no rows. On a route outside the
  // table this answers 429 rather than 403: both refuse, and 429 tells a
  // loop to back off.
  if (limited) return limited;

  if (!routeFor(request.method, new URL(request.url).pathname)) {
    // Counted only for a well-formed token; any other header (Basic, malformed) adds no row.
    const value = TOKEN.exec(header)?.[1];
    if (value) {
      try {
        await countRefusal(env.DB, await hashToken(value), now);
      } catch (e) {
        logFailure(e);
      }
    }
    return humanOnly();
  }

  const res = await next();
  if (res.status === 401) {
    try {
      await countFailedAuth(env.DB, request, now);
    } catch (e) {
      logFailure(e);
    }
  }
  return res;
};
