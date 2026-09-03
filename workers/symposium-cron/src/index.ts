export interface Env {
  SYMPOSIUM_DEPLOY_HOOK: string;
  /** Same value as the main site's SYMPOSIUM_ARCHIVE_SECRET Pages secret. */
  SYMPOSIUM_ARCHIVE_SECRET: string;
  ARCHIVE_URL: string;
}

/**
 * Rebuilds the symposium site once a day, after first folding any finished
 * edition's CMS overlay into the repo.
 *
 * The site is static, and which edition is "upcoming" is derived from the
 * clock at build time. Without a scheduled rebuild the site would keep
 * advertising the symposium as upcoming for as long as nobody pushed --
 * potentially months after it happened. Archiving runs first: an edition
 * that just finished must land in the repo (as a pull request, pending
 * human review) before the rebuild runs, or the rebuild ships without
 * whatever the CMS overlay was still carrying for it.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env).then((result) => {
        // A scheduled Worker's only failure signal is its invocation status.
        // `tick` has already run both calls by the time it resolves, so
        // reporting here still lets a failing archive and a failing rebuild
        // both be logged before either is raised.
        if (failed(result)) throw new Error(summarise(result));
      }),
    );
  },

  /**
   * A plain GET triggers both calls and returns their result, so the
   * schedule can be checked by hand. Not reachable from the internet:
   * workers_dev is off and no route is bound, so this answers only under
   * `wrangler dev`.
   *
   * Unlike `scheduled` it reports failure as a 502 with the body rather than
   * throwing -- the two callers want different things. The scheduler needs a
   * failed invocation; a human needs to read what went wrong, and a stack
   * trace tells them less than the endpoints' own responses do.
   */
  async fetch(_request: Request, env: Env): Promise<Response> {
    const body = await tick(env);
    return new Response(
      JSON.stringify({ archive: parseIfJson(body.archive), rebuild: parseIfJson(body.rebuild) }, null, 2),
      {
        status: failed(body) ? 502 : 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  },
};

type Tick = { archive: string; rebuild: string };

async function tick(env: Env): Promise<Tick> {
  // Archive first: a finished edition needs its pull request opened before
  // the rebuild runs, so a rebuild triggered by this same tick has the
  // freshest possible content once that PR is merged, and so an edition
  // that just finished is never advertised as upcoming by a rebuild that
  // ran ahead of its archive. Sequential rather than raced, so one failing
  // does not cancel the other's logging.
  const archive = await callArchive(env);
  const rebuild = await callRebuild(env);

  // Both results are returned rather than raised here: one failing must not
  // stop the other being reported, and the two callers differ on what to do
  // about it -- see `scheduled` and `fetch`.
  return { archive, rebuild };
}

function failed(t: Tick): boolean {
  return t.archive.startsWith('ERROR') || t.rebuild.startsWith('ERROR');
}

function summarise(t: Tick): string {
  return `tick failed -- archive: ${t.archive.slice(0, 120)} rebuild: ${t.rebuild.slice(0, 120)}`;
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

async function callArchive(env: Env): Promise<string> {
  try {
    const res = await fetch(env.ARCHIVE_URL, {
      method: 'POST',
      headers: { 'X-Archive-Secret': env.SYMPOSIUM_ARCHIVE_SECRET },
    });
    const body = await res.text();
    console.log(`archive ${res.status}: ${body.slice(0, 300)}`);
    return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
  } catch (err) {
    console.log(`archive threw: ${String(err).slice(0, 300)}`);
    return `ERROR: ${String(err).slice(0, 200)}`;
  }
}

async function callRebuild(env: Env): Promise<string> {
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
