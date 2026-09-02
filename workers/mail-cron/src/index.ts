export interface Env {
  /** Same value as the Pages project's MAIL_SYNC_SECRET. */
  MAIL_SYNC_SECRET: string;
  DISPATCH_URL: string;
  SYNC_URL: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env).then((result) => {
        // A scheduled Worker's only failure signal is its invocation status.
        // `tick` has already run both calls by the time it resolves, so
        // reporting here still lets a failing dispatch and a failing sync both
        // be logged before either is raised.
        if (failed(result)) throw new Error(summarise(result));
      }),
    );
  },

  /**
   * A plain GET returns the same call's result, so the schedule can be checked
   * by hand. Not reachable from the internet: workers_dev is off and no route
   * is bound, so this answers only under `wrangler dev`.
   *
   * Unlike `scheduled` it reports failure as a 502 with the body rather than
   * throwing -- the two callers want different things. The scheduler needs a
   * failed invocation; a human needs to read what went wrong, and a stack
   * trace tells them less than the endpoints' own responses do.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await tick(env);
    return new Response(
      JSON.stringify({ dispatch: parseIfJson(body.dispatch), sync: parseIfJson(body.sync) }, null, 2),
      {
        status: failed(body) ? 502 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};

async function tick(env: Env): Promise<Tick> {
  // Dispatch first: a message queued for this minute should go out before the
  // sync spends the tick's budget reading replies. Sequential rather than
  // raced, so one failing does not cancel the other's logging.
  const dispatch = await call(env, 'dispatch', env.DISPATCH_URL);
  const sync = await call(env, 'sync', env.SYNC_URL);

  // Both results are returned rather than raised here: one failing must not
  // stop the other being reported, and the two callers differ on what to do
  // about it -- see `scheduled` and `fetch`.
  return { dispatch, sync };
}

type Tick = { dispatch: string; sync: string };

function failed(t: Tick): boolean {
  return t.dispatch.startsWith('ERROR') || t.sync.startsWith('ERROR');
}

function summarise(t: Tick): string {
  return `tick failed -- dispatch: ${t.dispatch.slice(0, 120)} sync: ${t.sync.slice(0, 120)}`;
}

/**
 * The two endpoints answer with JSON, but `call` deals in text so it can also
 * carry an ERROR string. Parse back where possible so the manual `fetch`
 * check reads as one document instead of JSON nested inside JSON -- being
 * readable by hand is the entire reason that handler exists.
 */
function parseIfJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function call(env: Env, label: string, url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'X-Dispatch-Secret': env.MAIL_SYNC_SECRET },
    });
    const body = await res.text();

    // Log both ways: a silent scheduler is the failure mode this Worker exists
    // to end, so a bad secret or a 500 must be visible in `wrangler tail`.
    console.log(`${label} ${res.status}: ${body.slice(0, 300)}`);
    return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
  } catch (err) {
    console.log(`${label} threw: ${String(err).slice(0, 300)}`);
    return `ERROR: ${String(err).slice(0, 200)}`;
  }
}
