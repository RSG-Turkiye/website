import type { Env } from './auth';

const GITHUB_OWNER = 'RSG-Turkiye';
const GITHUB_REPO = 'website';
const GITHUB_BASE_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';

type OpenPrParams = {
  /** The `<branchPrefix>/` this branch lives under -- e.g. `blog-submission`
   * or `symposium-archive`. Keeps unrelated automated branches from
   * colliding on name alone, and lets a human tell at a glance which flow
   * opened a given branch. */
  branchPrefix: string;
  branchSlug: string;
  files: Array<{ path: string; content: string }>;
  title: string;
  prBody: string;
};

export type OpenPrResult =
  | { success: true; prUrl: string }
  | { success: false; error: string }
  | { success: false; reason: 'no-commits' };

/**
 * Tells apart GitHub's two different 422 bodies on `POST .../pulls`, since
 * the body text is the only signal that distinguishes them:
 *
 * - `'exists'`: "A pull request already exists for owner:branch." -- a
 *   previous attempt already opened one; recover its URL rather than fail.
 * - `'no-commits'`: "No commits between main and branch" -- the branch has
 *   nothing to propose because its content is already on main (the day's
 *   snapshot PR was merged and nothing has changed since). This is not a
 *   failure to recover from; it means the caller's content is already where
 *   it needs to be.
 * - `'other'`: anything else. Kept as its own case, rather than folded into
 *   one of the two above, so an unrelated validation failure keeps today's
 *   throw-into-error behaviour exactly instead of being guessed at.
 *
 * A pure function so the three outcomes are testable without a token or a
 * network call.
 */
export function classify422(body: string): 'exists' | 'no-commits' | 'other' {
  if (body.includes('No commits between')) return 'no-commits';
  if (body.includes('A pull request already exists')) return 'exists';
  return 'other';
}

async function githubRequest(
  path: string,
  init: RequestInit,
  env: Env
): Promise<Response> {
  return fetch(`${GITHUB_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.GITHUB_PAT}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'rsg-turkiye-website',
      ...(init.headers ?? {}),
    },
  });
}

function toBase64Utf8(content: string): string {
  // nodejs_compat is enabled in wrangler.toml, so Buffer is available.
  // btoa() alone would corrupt non-Latin1 characters (ı, ş, ğ, ç, ö, ü),
  // which real post content will contain.
  return Buffer.from(content, 'utf-8').toString('base64');
}

async function getBaseBranchSha(env: Env): Promise<string> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/ref/heads/${GITHUB_BASE_BRANCH}`,
    { method: 'GET' },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to read base branch ref (${res.status}): ${body}`);
  }
  const data = await res.json<{ object: { sha: string } }>();
  return data.object.sha;
}

async function createBranch(branchName: string, baseSha: string, env: Env): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs`,
    {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: baseSha }),
    },
    env
  );
  if (res.status === 422) {
    // Branch name already exists (e.g. a prior failed attempt left it
    // behind). Treat as usable rather than failing -- the commit step
    // will fail loudly on its own if this branch is actually unusable.
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create branch ${branchName} (${res.status}): ${body}`);
  }
}

/**
 * The current sha of `filePath` on `branchName`, or `undefined` if the path
 * doesn't exist there yet. GitHub's contents API requires the existing
 * file's sha on a PUT that overwrites a file, and rejects a PUT with no sha
 * for a path that already exists -- so this is what lets `commitFile`
 * converge instead of colliding when a retry finds a file a previous,
 * crashed attempt already wrote.
 */
async function getFileSha(branchName: string, filePath: string, env: Env): Promise<string | undefined> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${branchName}`,
    { method: 'GET' },
    env
  );
  if (res.status === 404) return undefined;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to read ${filePath} on ${branchName} (${res.status}): ${body}`);
  }
  const data = await res.json<{ sha: string }>();
  return data.sha;
}

async function commitFile(
  branchName: string,
  filePath: string,
  content: string,
  message: string,
  env: Env
): Promise<void> {
  // A PUT that omits `sha` for a path GitHub already has on this branch is
  // rejected outright -- exactly what happens on a retry after a crash
  // between a first successful commit and the archived_pr_url write that
  // was supposed to record it. Looking the sha up first, and including it
  // when the file exists, makes this call idempotent: create when the path
  // is new, update-in-place (same content, same result) when it isn't.
  const sha = await getFileSha(branchName, filePath, env);
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: toBase64Utf8(content),
        branch: branchName,
        ...(sha ? { sha } : {}),
      }),
    },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to commit ${filePath} (${res.status}): ${body}`);
  }
}

/**
 * The URL of the open PR already proposing `branchName` into the base
 * branch, if one exists. Used when opening a PR 422s because one already
 * does -- the retry case this exists for.
 */
async function findExistingPr(branchName: string, env: Env): Promise<string | null> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?head=${GITHUB_OWNER}:${encodeURIComponent(branchName)}&state=open`,
    { method: 'GET' },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to look up an existing PR for ${branchName} (${res.status}): ${body}`);
  }
  const data = await res.json<Array<{ html_url: string }>>();
  return data[0]?.html_url ?? null;
}

/**
 * Best-effort PATCH of an existing pull request's title and body. Used when
 * `createPullRequest` recovers a pull request that a prior day's snapshot
 * opened -- its wording ("Snapshot the ... CMS content", "merging is
 * optional") is wrong once the caller is the archive, and this is what
 * replaces it with the caller's own wording.
 *
 * Never throws and never fails the caller: the pull request already exists
 * and its URL is what the caller needed, so a PATCH failure (a transient
 * GitHub error, a permissions gap) is logged and swallowed rather than
 * turned into a failure of the whole open-a-PR attempt.
 */
async function retitlePullRequest(prUrl: string, title: string, body: string, env: Env): Promise<void> {
  const number = pullNumberFromUrl(prUrl);
  if (number === null) return;
  try {
    const res = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${number}`,
      { method: 'PATCH', body: JSON.stringify({ title, body }) },
      env
    );
    if (!res.ok) {
      const errBody = await res.text();
      console.error(`Failed to retitle PR ${number} (${res.status}): ${errBody}`);
    }
  } catch (e) {
    console.error('retitlePullRequest threw', e);
  }
}

type CreatePrOutcome =
  | { kind: 'opened'; prUrl: string }
  | { kind: 'recovered'; prUrl: string }
  | { kind: 'no-commits' };

async function createPullRequest(
  branchName: string,
  title: string,
  body: string,
  env: Env
): Promise<CreatePrOutcome> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls`,
    {
      method: 'POST',
      body: JSON.stringify({
        title,
        head: branchName,
        base: GITHUB_BASE_BRANCH,
        body,
      }),
    },
    env
  );
  if (res.status === 422) {
    const errBody = await res.text();
    const kind = classify422(errBody);
    if (kind === 'no-commits') {
      // The branch has nothing to propose because its content is already on
      // main -- most likely a prior snapshot PR for this same branch was
      // merged and nothing has changed since. Not a failure: the caller's
      // content is already where it needs to be.
      return { kind: 'no-commits' };
    }
    if (kind === 'exists') {
      // A previous attempt already opened this PR, most often a prior day's
      // snapshot that crashed before its URL was recorded, or -- the case
      // this task exists for -- a still-open snapshot PR on the day the
      // archive tries to take over the same branch. Recover its URL rather
      // than failing, and retitle it so the caller's own wording (an
      // archive's "merge this promptly", not a snapshot's "merging is
      // optional") is what a reviewer actually sees.
      const existing = await findExistingPr(branchName, env);
      if (existing) {
        await retitlePullRequest(existing, title, body, env);
        return { kind: 'recovered', prUrl: existing };
      }
    }
    // 'other', or 'exists' with no open PR actually found: fall through to
    // the same error handling every other failure gets.
    throw new Error(`Failed to open PR (${res.status}): ${errBody}`);
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to open PR (${res.status}): ${errBody}`);
  }
  const data = await res.json<{ html_url: string }>();
  return { kind: 'opened', prUrl: data.html_url };
}

/**
 * Checks whether a file already exists at `filePath` on the base branch.
 * Used before opening a PR to catch a slug collision early.
 */
export async function fileExistsOnBaseBranch(filePath: string, env: Env): Promise<boolean> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BASE_BRANCH}`,
    { method: 'GET' },
    env
  );
  if (res.status === 404) return false;
  if (res.ok) return true;
  const body = await res.text();
  throw new Error(`Failed to check ${filePath} (${res.status}): ${body}`);
}

/**
 * Reads `filePath` off the base branch and returns its decoded text, or
 * `null` if no such file exists there. Used by the symposium archive to
 * read an edition's own `editions/<year>.md` out of the repo -- the repo is
 * the source of truth for that file's dates, and this is the only way this
 * server ever sees repo content it didn't itself just write.
 *
 * Throws (rather than returning null) on anything other than a clean 404,
 * so a transient GitHub failure is never mistaken for "this file doesn't
 * exist" -- those two must stay distinguishable to the caller.
 */
export async function getFileOnBaseBranch(filePath: string, env: Env): Promise<string | null> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}?ref=${GITHUB_BASE_BRANCH}`,
    { method: 'GET' },
    env
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to read ${filePath} (${res.status}): ${body}`);
  }
  const data = await res.json<{ content: string; encoding: string }>();
  if (data.encoding !== 'base64') {
    throw new Error(`Unexpected encoding for ${filePath}: ${data.encoding}`);
  }
  // The inverse of toBase64Utf8 -- GitHub returns file content base64-encoded
  // regardless of the bytes underneath, so this must decode as UTF-8
  // explicitly or Turkish characters in a title/subtitle would come back
  // mojibake'd the same way an encode with plain btoa() would corrupt them.
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

/**
 * Creates a branch, commits one or more files to it, and opens a PR against
 * main. Returns { success: false, error } on any failure without throwing
 * -- callers (the blog-submission approve endpoint, the symposium archive
 * endpoint) must not update their own row's status unless this returns
 * { success: true }, and must never surface `error` to an untrusted caller
 * -- it can echo back the GitHub API response body, which is not secret
 * itself but is diagnostic detail with no business leaving this server.
 *
 * Returns { success: false, reason: 'no-commits' } instead, distinct from
 * the `error` shape above, when GitHub refuses the PR because the branch has
 * nothing to propose -- its content is already on main, most often because
 * an earlier PR for this same branch was merged and nothing has changed
 * since. This is not a failure a caller should retry expecting a different
 * outcome; it means the requested content already exists at the base
 * branch.
 *
 * Generalised from the blog approval flow's own `openBlogPostPR`:
 * `branchPrefix` is what used to be the hardcoded `blog-submission/`, now
 * supplied by each caller so a second flow (the symposium archive) can open
 * PRs under its own `symposium-archive/` branch namespace without a second
 * copy of this function.
 *
 * Safely retryable end to end: `createBranch` reuses a branch that already
 * exists, `commitFile` looks up each file's current sha on that branch and
 * updates in place rather than colliding on one that's already there, and
 * `createPullRequest` recovers the URL of a PR that already exists for this
 * branch instead of failing on GitHub's 422. A caller whose process dies
 * after this resolves but before it records the URL can simply call this
 * again with the same arguments -- it converges on the same branch, the
 * same file contents, and the same PR, rather than needing a human to
 * reconcile a half-done attempt by hand.
 */
export async function openContentPR(params: OpenPrParams, env: Env): Promise<OpenPrResult> {
  const branchName = `${params.branchPrefix}/${params.branchSlug}`;
  try {
    const baseSha = await getBaseBranchSha(env);
    await createBranch(branchName, baseSha, env);
    for (const file of params.files) {
      await commitFile(branchName, file.path, file.content, `Add ${file.path}`, env);
    }
    const outcome = await createPullRequest(branchName, params.title, params.prBody, env);
    if (outcome.kind === 'no-commits') return { success: false, reason: 'no-commits' };
    return { success: true, prUrl: outcome.prUrl };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown GitHub API error' };
  }
}

/** Escapes a string for use inside a `new RegExp(...)` pattern. */
function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The number out of a pull request's browser URL, or null when the string is
 * not one.
 *
 * Separated from the request below so the refusals are testable without a
 * token: an issue URL, an empty column and a truncated string must all come
 * back null rather than being read as a pull request that would then be
 * asked about. The URL must also name *this* repository's owner and name --
 * `archived_pr_url` is free text written by this codebase, but a stray value
 * pointing at another repository's pull request must not make an unrelated
 * merge retire an edition, so it is refused here rather than trusted and
 * handed to `prState`.
 */
export function pullNumberFromUrl(prUrl: string): number | null {
  const pattern = new RegExp(
    `/${escapeForRegex(GITHUB_OWNER)}/${escapeForRegex(GITHUB_REPO)}/pull/(\\d+)/?$`
  );
  const match = pattern.exec(prUrl.trim());
  return match ? Number(match[1]) : null;
}

/**
 * Whether, and how, a pull request has been resolved.
 *
 * Four states, not two:
 * - `merged` / `unmerged`: still awaiting review or ready to merge.
 * - `closed-unmerged`: a human closed it without merging. Nothing reopens a
 *   pull request automatically, so this needs a person, not a retry.
 * - `unknown`: we could not tell. Split by `permanent`, because the two
 *   causes need opposite responses. A rate limit, a 5xx, or a thrown network
 *   error (`permanent: false`) fixes itself, so the edition must be left
 *   exactly as it was for the next run to retry -- treating "we could not
 *   ask" as "not merged" would retire an edition whose content is not in the
 *   repository, and raising an alarm for it would fire on a condition that
 *   resolves on its own. A revoked token (401), lost permission (403), a
 *   deleted pull request (404), or a URL that never named a pull request at
 *   all (`permanent: true`) will not fix itself by retrying and needs a
 *   human to notice -- the caller uses this flag to decide whether the run
 *   as a whole reports failure.
 */
export type PrState =
  | { kind: 'merged'; mergedAt: number }
  | { kind: 'unmerged' }
  | { kind: 'closed-unmerged' }
  | { kind: 'unknown'; error: string; permanent: boolean };

export async function prState(prUrl: string, env: Env): Promise<PrState> {
  const number = pullNumberFromUrl(prUrl);
  if (number === null) {
    return { kind: 'unknown', error: `not a pull request URL: ${prUrl}`, permanent: true };
  }
  try {
    const res = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${number}`,
      { method: 'GET' },
      env
    );
    if (!res.ok) {
      const body = await res.text();
      // 401/403/404 will not fix themselves on the next run's retry; every
      // other status (429, 5xx, and anything else GitHub might return) is
      // treated as transient.
      const permanent = res.status === 401 || res.status === 403 || res.status === 404;
      return {
        kind: 'unknown',
        error: `pull ${number} lookup failed (${res.status}): ${body.slice(0, 200)}`,
        permanent,
      };
    }
    const data = await res.json<{ merged_at: string | null; state: string }>();
    if (data.merged_at) {
      const mergedAt = Math.floor(Date.parse(data.merged_at) / 1000);
      if (!Number.isFinite(mergedAt)) {
        // A malformed merged_at is not proof of a merge -- report it as
        // unknown rather than stamping archived_at with a bad timestamp.
        // Not `permanent`: it is GitHub's data, not this URL, that is
        // wrong, and there is nothing a human needs to do about a single
        // bad read that a retry might not repeat.
        return {
          kind: 'unknown',
          error: `pull ${number} merged_at did not parse: ${data.merged_at}`,
          permanent: false,
        };
      }
      return { kind: 'merged', mergedAt };
    }
    if (data.state === 'closed') return { kind: 'closed-unmerged' };
    return { kind: 'unmerged' };
  } catch (e) {
    return { kind: 'unknown', error: e instanceof Error ? e.message : 'Unknown GitHub API error', permanent: false };
  }
}

/**
 * Opens a GitHub issue assigned to env.GITHUB_NOTIFY_USERNAME so that
 * account gets a real "you were assigned" notification. Used to alert a
 * human the moment a member submits a post, since no PR exists yet at
 * that point (a PR only exists after an admin approves).
 *
 * Note: since GITHUB_PAT authors the issue, GitHub will never notify
 * that same token's own account about it (GitHub never notifies an
 * account about its own actions) -- GITHUB_NOTIFY_USERNAME must be a
 * different, real person's GitHub username for this to have any effect.
 *
 * Best-effort: never throws. A failure here must not block or fail the
 * member's actual submission, so callers should not await this in a way
 * that surfaces its errors to the submitter.
 */
export async function notifyNewSubmission(title: string, body: string, env: Env): Promise<void> {
  if (!env.GITHUB_NOTIFY_USERNAME) return;
  try {
    const res = await githubRequest(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
      {
        method: 'POST',
        body: JSON.stringify({
          title,
          body,
          assignees: [env.GITHUB_NOTIFY_USERNAME],
        }),
      },
      env
    );
    if (!res.ok) {
      // Swallow -- a missing "Issues: Read and write" permission on the
      // fine-grained PAT is the most likely cause, and a notification
      // failure must never block the submission itself.
      console.error('notifyNewSubmission failed', res.status, await res.text());
    }
  } catch (e) {
    console.error('notifyNewSubmission threw', e);
  }
}
