export interface Env {
  /** Same value as the Pages project's MAIL_SYNC_SECRET. */
  MAIL_SYNC_SECRET: string;
  DISPATCH_URL: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env));
  },

  /**
   * A plain GET returns the same call's result, so the schedule can be tested
   * by hand without waiting for a tick. It carries no secret of its own -- it
   * simply forwards the one this Worker holds, exactly as the cron does.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await dispatch(env);
    return new Response(body, { headers: { 'Content-Type': 'application/json' } });
  },
};

async function dispatch(env: Env): Promise<string> {
  const res = await fetch(env.DISPATCH_URL, {
    method: 'POST',
    headers: { 'X-Dispatch-Secret': env.MAIL_SYNC_SECRET },
  });
  const body = await res.text();

  // Log both ways: a silent scheduler is the failure mode this Worker exists
  // to end, so a bad secret or a 500 must be visible in `wrangler tail`.
  console.log(`dispatch ${res.status}: ${body.slice(0, 300)}`);
  if (!res.ok) throw new Error(`dispatch returned HTTP ${res.status}`);

  return body;
}
