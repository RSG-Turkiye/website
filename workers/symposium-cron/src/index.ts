export interface Env {
  SYMPOSIUM_DEPLOY_HOOK: string;
}

/**
 * Rebuilds the symposium site once a day.
 *
 * The site is static, and which edition is "upcoming" is derived from the
 * clock at build time. Without a scheduled rebuild the site would keep
 * advertising the symposium as upcoming for as long as nobody pushed --
 * potentially months after it happened.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      rebuild(env).then((result) => {
        // A scheduled Worker's only failure signal is its invocation status.
        // Returning quietly would leave a dead deploy hook looking healthy in
        // the dashboard, so the one mechanism keeping the site's derived
        // lifecycle honest could stop working with nothing to say so.
        if (result.startsWith('ERROR')) throw new Error(result);
      }),
    );
  },

  /**
   * A plain GET triggers the rebuild and returns its result, so the schedule
   * can be checked by hand. Not reachable from the internet: workers_dev is
   * off and no route is bound, so this answers only under `wrangler dev`.
   *
   * Unlike `scheduled` it reports failure as a 502 with the body rather than
   * throwing -- the two callers want different things. The scheduler needs a
   * failed invocation; a human needs to read what went wrong, and a stack
   * trace tells them less than the hook's own response does.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await rebuild(env);
    return new Response(
      JSON.stringify({ rebuild: body }, null, 2),
      {
        status: body.startsWith('ERROR') ? 502 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};

async function rebuild(env: Env): Promise<string> {
  try {
    const res = await fetch(env.SYMPOSIUM_DEPLOY_HOOK, { method: 'POST' });
    const body = await res.text();

    // Log all attempts: a silent scheduler is the failure mode this Worker
    // exists to end, so a 4xx or 5xx must be visible in `wrangler tail`.
    console.log(`rebuild ${res.status}: ${body.slice(0, 300)}`);
    return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
  } catch (err) {
    console.log(`rebuild threw: ${String(err).slice(0, 300)}`);
    return `ERROR: ${String(err).slice(0, 200)}`;
  }
}
