export interface Env {
  /** Same value as the Pages project's MAIL_SYNC_SECRET. */
  MAIL_SYNC_SECRET: string;
  DISPATCH_URL: string;
  SYNC_URL: string;
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(tick(env));
  },

  /**
   * A plain GET returns the same call's result, so the schedule can be tested
   * by hand without waiting for a tick. It carries no secret of its own -- it
   * simply forwards the one this Worker holds, exactly as the cron does.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await tick(env);
    return new Response(
      JSON.stringify({ dispatch: parseIfJson(body.dispatch), sync: parseIfJson(body.sync) }, null, 2),
      { headers: { 'Content-Type': 'application/json' } },
    );
  },
};

async function tick(env: Env): Promise<{ dispatch: string; sync: string }> {
  // Dispatch first: a message queued for this minute should go out before the
  // sync spends the tick's budget reading replies. Sequential rather than
  // raced, so one failing does not cancel the other's logging.
  const dispatch = await call(env, 'dispatch', env.DISPATCH_URL);
  const sync = await call(env, 'sync', env.SYNC_URL);

  // Throw only after both have run: a scheduled Worker's single failure signal
  // is the invocation status, and throwing earlier would have skipped the
  // second call entirely.
  if (dispatch.startsWith('ERROR') || sync.startsWith('ERROR')) {
    throw new Error(`tick failed -- dispatch: ${dispatch.slice(0, 120)} sync: ${sync.slice(0, 120)}`);
  }

  return { dispatch, sync };
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
