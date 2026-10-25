// The first gate for agent tokens, on every /api/* request. A request that
// carries an Authorization header and is not in the agent route table is
// refused here, before any handler runs and without touching D1, so an
// endpoint that only knows cookies can never be reached with a token. Routes
// in the table go on to their handler, whose gate (authenticateAgent) checks
// the token and the table again. No header: nothing changes.

import { routeFor } from '../_lib/agent-routes';
import { humanOnly } from '../_lib/agent-tokens';
import type { Env } from '../_lib/auth';

export const onRequest: PagesFunction<Env> = async ({ request, next }) => {
  if (request.headers.get('Authorization') === null) return next();
  if (routeFor(request.method, new URL(request.url).pathname)) return next();
  return humanOnly();
};
