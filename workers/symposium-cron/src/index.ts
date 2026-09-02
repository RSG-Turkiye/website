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
    ctx.waitUntil(rebuild(env));
  },

  /**
   * A plain GET triggers the rebuild and returns its result, so the schedule
   * can be tested by hand without waiting for a tick. No secret needed here --
   * the deploy hook URL itself is the auth token.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await rebuild(env);
    return new Response(
      JSON.stringify({ rebuild: body }, null, 2),
      { headers: { 'Content-Type': 'application/json' } },
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
