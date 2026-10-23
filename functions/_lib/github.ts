import type { Env } from './auth';

const GITHUB_OWNER = 'RSG-Turkiye';
const GITHUB_REPO = 'website';
const GITHUB_BASE_BRANCH = 'main';
const GITHUB_API_BASE = 'https://api.github.com';
const GITHUB_TIMEOUT_MS = 10_000;

type OpenPrParams = {
  /** The `<branchPrefix>/` this branch lives under -- e.g. `blog-submission`
   * or `symposium-archive`. Keeps unrelated automated branches from
   * colliding on name alone, and lets a human tell at a glance which flow
   * opened a given branch. */
  branchPrefix: string;
  branchSlug: string;
  /** `content: null` deletes the file on the branch (see `deleteFile`). */
  files: Array<{ path: string; content: string | null }>;
  title: string;
  prBody: string;
  /** Whether to PATCH a recovered pull request's title and body onto
   * `title`/`prBody` above, when GitHub's 422 says one already exists for
   * this branch. Required, not defaulted -- the two writers that can share a
   * `symposium-archive/<year>` branch disagree on the right answer (the
   * archive path must overwrite a snapshot's wording; the snapshot path must
   * never overwrite the archive's), so this library has no safe guess to
   * fall back to, and a caller that forgets the field must fail to compile
   * rather than silently retitle -- the more dangerous of the two -- an
   * existing pull request that was not its own. */
  retitle: boolean;
  /** When the branch already exists, force it back to main's current sha
   * before committing, so the pull request carries exactly `files` and
   * nothing an earlier attempt left there (a CMS draft that was renamed
   * after a failed attempt). Off for the blog and symposium flows, which
   * keep their earlier behaviour. */
  resetBranch?: boolean;
  /** The commit to start a new branch from, or reset an existing one to.
   * Defaults to main's head read now. The CMS passes the commit it checked
   * the draft's base shas against, so a merge landing in between shows up
   * as a behind or conflicting pull request instead of being overwritten. */
  baseSha?: string;
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
    // A GitHub that hangs must not hold a cron tick (or a panel request)
    // until the platform kills it.
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
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

async function createBranch(branchName: string, baseSha: string, env: Env, reset = false): Promise<void> {
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
    if (reset) await resetBranchTo(branchName, baseSha, env);
    return;
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to create branch ${branchName} (${res.status}): ${body}`);
  }
}

/** Force `branchName` to `sha`. Status code only in the error. */
async function resetBranchTo(branchName: string, sha: string, env: Env): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`,
    { method: 'PATCH', body: JSON.stringify({ sha, force: true }) },
    env
  );
  if (!res.ok) throw new Error(`Failed to reset branch ${branchName} (${res.status})`);
}

/**
 * The current sha of `filePath` on `branchName`, or `undefined` if the path
 * doesn't exist there yet. GitHub's contents API requires the existing
 * file's sha on a PUT that overwrites a file, and rejects a PUT with no sha
 * for a path that already exists -- so this is what lets `commitFile`
 * converge instead of colliding when a retry finds a file a previous,
 * crashed attempt already wrote.
 */
async function getFile(
  branchName: string,
  filePath: string,
  env: Env,
): Promise<{ sha: string; content: string } | undefined> {
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
  // The content comes back base64 with newlines in it, which Buffer ignores.
  // Read alongside the sha rather than in a second request: commitFile needs
  // both, and one round trip answers both questions.
  const data = await res.json<{ sha: string; content?: string }>();
  return { sha: data.sha, content: data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '' };
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
  const existing = await getFile(branchName, filePath, env);

  // Writing content byte-identical to what the branch already holds still
  // makes GitHub record a commit -- one whose tree is unchanged. That is
  // enough to put the branch ahead of main, which is enough for a pull
  // request to open, so a daily refresh with nothing new to say produced an
  // empty pull request every night. Measured on 2026-09-16: +0/-0, no files,
  // ahead_by 1, and the commit named after the file it did not change.
  //
  // An empty pull request every night is worse than none: it teaches
  // everybody to skim past this branch, which is exactly what the one that
  // matters cannot afford. Skipping the write leaves the branch level with
  // main, so openContentPR reaches GitHub's "No commits between" and the
  // caller hears that nothing changed.
  if (existing && existing.content === content) return;

  const sha = existing?.sha;
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
 * Deletes `filePath` on `branchName`. The contents API wants the file's
 * current sha on that branch, so it is looked up first -- and a path that is
 * already absent is skipped rather than failed, which keeps openContentPR
 * retryable: a retry after a crash between this delete and the PR opening
 * finds the file gone and moves on.
 */
async function deleteFile(branchName: string, filePath: string, message: string, env: Env): Promise<void> {
  const existing = await getFile(branchName, filePath, env);
  if (!existing) return;
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ message, sha: existing.sha, branch: branchName }),
    },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to delete ${filePath} (${res.status}): ${body}`);
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
 * opened and the caller passed `retitle: true` -- its wording ("Snapshot the
 * ... CMS content", "merging is optional") is wrong once the caller is the
 * archive, and this is what replaces it with the caller's own wording. Never
 * called for a caller that passed `retitle: false`: a snapshot recovering
 * this same PR must not overwrite whatever the archive (or a human reviewer)
 * has since put on it.
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
  retitle: boolean,
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
    // 'exists' and 'other' both still attempt the same recovery lookup
    // today's code ran unconditionally on any 422 -- an unrelated validation
    // failure essentially never coincides with an already-open PR, but this
    // keeps that fallback exactly as it was rather than short-circuiting it
    // based on the message classify422 happened to recognize. Retitling is
    // reserved for 'exists', though, and even then only when the caller's own
    // `retitle` says to: a previous attempt already opening this PR (most
    // often a prior day's snapshot that crashed before its URL was recorded,
    // or -- the case this task exists for -- a still-open snapshot PR on the
    // day the archive tries to take over the same branch) is evidence the
    // caller's own wording belongs on it only when the caller is the kind
    // that gets to overwrite it (the archive, passing `retitle: true`); a
    // snapshot recovering the same PR passes `retitle: false` precisely so it
    // never overwrites an archive's wording with its own, and recovering an
    // open PR after some unrelated 422 is not evidence of anything at all.
    const existing = await findExistingPr(branchName, env);
    if (existing) {
      if (kind === 'exists' && retitle) {
        await retitlePullRequest(existing, title, body, env);
      }
      return { kind: 'recovered', prUrl: existing };
    }
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
  // Force-resetting throws away commits; only the CMS's own branches may be.
  if (params.resetBranch && params.branchPrefix !== 'cms') throw new Error('resetBranch is only for cms/ branches');
  const branchName = `${params.branchPrefix}/${params.branchSlug}`;
  try {
    const baseSha = params.baseSha ?? await getBaseBranchSha(env);
    await createBranch(branchName, baseSha, env, params.resetBranch === true);
    for (const file of params.files) {
      if (file.content === null) {
        await deleteFile(branchName, file.path, `Delete ${file.path}`, env);
      } else {
        await commitFile(branchName, file.path, file.content, `Add ${file.path}`, env);
      }
    }
    const outcome = await createPullRequest(branchName, params.title, params.prBody, params.retitle, env);
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

// ---------------------------------------------------------------------------
// CMS pull-request helpers. Unlike the older functions above, these never put
// a GitHub response body into an error message: their callers (the panel's
// CMS endpoints and the PR shepherd) show errors to admins, so a failure is
// reported as a short "what and which status" only.
// ---------------------------------------------------------------------------

/**
 * The status checks branch protection on `main` requires before a merge --
 * the job names in `.github/workflows/build-check.yml`, which GitHub Actions
 * reports as check runs under those names. Copied from branch protection as
 * of 2026-10-23.
 *
 * MAINTAINER: when you change the required checks in the repository's
 * branch protection settings, or rename either job in build-check.yml,
 * update this list (and the test that pins it, tests/github-cms.test.ts) in
 * the same PR. Otherwise prStatus waits forever for a check that no longer
 * runs, or merges without one that now matters.
 */
export const REQUIRED_CHECKS: readonly string[] = ['Build & Type Check', 'Symposium Build & Type Check'];

/** Each path segment URL-encoded, the slashes between them kept. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

/**
 * The blob sha of each path on `main`, or `null` for a path that is not
 * there. The CMS records these when an editor opens an entry and compares
 * them on save, so an edit made on GitHub in between is noticed instead of
 * overwritten.
 *
 * One contents GET per path, run in parallel. The CMS asks about a handful
 * of files per save; the git trees API would answer any number in one call
 * but returns the whole tree of a directory (or, recursively, the repo) and
 * needs a second lookup to get from `main` to a tree sha, which is more
 * work than it saves at this size.
 */
export async function fileShasOnBase(paths: string[], env: Env, ref: string = GITHUB_BASE_BRANCH): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, string | null]> => {
      const res = await githubRequest(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`,
        { method: 'GET' },
        env
      );
      if (res.status === 404) return [path, null];
      if (!res.ok) throw new Error(`Failed to read the sha of ${path} on ${ref} (${res.status})`);
      const data = await res.json<{ sha: string }>();
      return [path, data.sha];
    })
  );
  return Object.fromEntries(entries);
}

/**
 * Each path's text and blob sha on `main`, or `null` for a path that is not
 * there. One request per file answers both, so the sha a CMS draft records
 * is the sha of exactly the text it was started from. Errors carry the
 * status code only.
 */
export async function filesOnBase(paths: string[], env: Env): Promise<Record<string, { content: string; sha: string } | null>> {
  const entries = await Promise.all(
    paths.map(async (path): Promise<[string, { content: string; sha: string } | null]> => {
      const res = await githubRequest(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${encodePath(path)}?ref=${GITHUB_BASE_BRANCH}`,
        { method: 'GET' },
        env
      );
      if (res.status === 404) return [path, null];
      if (!res.ok) throw new Error(`Failed to read ${path} on ${GITHUB_BASE_BRANCH} (${res.status})`);
      const data = await res.json<{ sha: string; content?: string; encoding?: string }>();
      if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new Error(`Unexpected contents response for ${path}`);
      return [path, { sha: data.sha, content: Buffer.from(data.content, 'base64').toString('utf-8') }];
    })
  );
  return Object.fromEntries(entries);
}

export type PrStatus = {
  state: 'open' | 'merged' | 'closed';
  /** GitHub's own value, passed through: 'clean', 'behind' (needs
   * updateBranch), 'blocked', 'dirty' (conflicts), 'unstable', or
   * 'unknown' while GitHub is still computing it. */
  mergeable_state: string;
  /** Only REQUIRED_CHECKS count; any other check is ignored. */
  checks: 'pending' | 'success' | 'failure';
  /** The required check that failed, when `checks` is 'failure'. */
  failedCheck?: string;
  /** The head commit the checks above belong to. Pass it to mergePr so a
   * head that changes after this read is never merged. */
  headSha: string;
};

type CheckRun = { id: number; name: string; status: string; conclusion: string | null };

/** Conclusions branch protection counts as passed. 'neutral' and 'skipped'
 * are included because GitHub itself lets a required check with either
 * conclusion through. */
const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);
const FAILING_CONCLUSIONS = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure']);

/**
 * Folds the check runs on one commit into a single answer, counting only
 * REQUIRED_CHECKS. A re-run adds a newer check run under the same name, so
 * the newest (highest id) run of each name is the one that counts. Any
 * required check failed -> failure (the first, in REQUIRED_CHECKS order, is
 * named); otherwise any missing, queued, in progress or otherwise undecided
 * -> pending; all passed -> success.
 */
function foldChecks(runs: CheckRun[]): Pick<PrStatus, 'checks' | 'failedCheck'> {
  const latest = new Map<string, CheckRun>();
  for (const run of runs) {
    const seen = latest.get(run.name);
    if (!seen || run.id > seen.id) latest.set(run.name, run);
  }
  let pending = false;
  for (const name of REQUIRED_CHECKS) {
    const run = latest.get(name);
    if (run?.status === 'completed' && run.conclusion && FAILING_CONCLUSIONS.has(run.conclusion)) {
      return { checks: 'failure', failedCheck: name };
    }
    if (!run || run.status !== 'completed' || !run.conclusion || !PASSING_CONCLUSIONS.has(run.conclusion)) {
      pending = true;
    }
  }
  return { checks: pending ? 'pending' : 'success' };
}

/**
 * Where a pull request stands: open, merged or closed; GitHub's
 * mergeable_state; and its required checks folded into one answer.
 *
 * Checks come from the check-runs API for the head sha, because that is how
 * GitHub Actions reports (the combined status API only carries the older
 * commit-status contexts, which nothing in this repo posts). Throws a short
 * error, without GitHub's body, on any failed request.
 */
export async function prStatus(prNumber: number, env: Env): Promise<PrStatus> {
  const pull = await getPull(prNumber, env);
  const headSha = pull.head.sha;
  // A finished pull request's checks no longer matter: one request, not two.
  if (pull.merged || pull.state === 'closed') {
    return { state: pull.merged ? 'merged' : 'closed', mergeable_state: pull.mergeable_state, checks: 'pending', headSha };
  }
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/commits/${headSha}/check-runs?per_page=100`,
    { method: 'GET' },
    env
  );
  if (!res.ok) throw new Error(`Failed to read checks for pull ${prNumber} (${res.status})`);
  const data = await res.json<{ check_runs: CheckRun[] }>();
  const state = pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open';
  return { state, mergeable_state: pull.mergeable_state, ...foldChecks(data.check_runs), headSha };
}

type Pull = { state: string; merged: boolean; mergeable_state: string; title: string; head: { sha: string } };

/** Whether a pull request is open, merged or closed, and its head: one request. Errors carry the status only. */
export async function readPull(prNumber: number, env: Env): Promise<{ state: 'open' | 'merged' | 'closed'; headSha: string }> {
  const pull = await getPull(prNumber, env);
  return { state: pull.merged ? 'merged' : pull.state === 'closed' ? 'closed' : 'open', headSha: pull.head.sha };
}

async function getPull(prNumber: number, env: Env): Promise<Pull> {
  const res = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}`, { method: 'GET' }, env);
  if (!res.ok) throw new Error(`Failed to read pull ${prNumber} (${res.status})`);
  return res.json<Pull>();
}

/**
 * Merges main into the pull request's branch (GitHub's "Update branch"
 * button), for a PR whose mergeable_state is 'behind'. `expectedHeadSha`
 * makes GitHub refuse if the branch moved since the caller looked.
 *
 * GitHub answers 202 and does the merge asynchronously; the new head shows
 * up on a later prStatus, and the checks run again on it. A refusal (422)
 * comes back as `{ success: false, status, reason }`: 'conflict' when
 * GitHub's message mentions a conflict (main does not merge into the
 * branch), otherwise 'head-changed' (look again next time). The reason is
 * read from GitHub's message, which is never passed on. Anything else
 * unexpected throws a short error.
 */
export async function updateBranch(
  prNumber: number,
  env: Env,
  expectedHeadSha?: string
): Promise<{ success: true } | { success: false; status: number; reason: 'head-changed' | 'conflict' }> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}/update-branch`,
    { method: 'PUT', body: JSON.stringify(expectedHeadSha ? { expected_head_sha: expectedHeadSha } : {}) },
    env
  );
  if (res.ok) return { success: true };
  if (res.status === 422) {
    const text = await res.text().catch(() => '');
    // Only a refusal that says so is a conflict (which fails the draft);
    // anything else ("not behind", a moved head, a validation hiccup) is
    // looked at again next tick.
    return { success: false, status: res.status, reason: /conflict/i.test(text) ? 'conflict' : 'head-changed' };
  }
  throw new Error(`Failed to update the branch of pull ${prNumber} (${res.status})`);
}

/**
 * Closes a pull request without merging it (the panel's "cancel"). Closing
 * one that is already closed is fine; errors carry the status only.
 */
export async function closePr(prNumber: number, env: Env): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}`,
    { method: 'PATCH', body: JSON.stringify({ state: 'closed' }) },
    env
  );
  if (!res.ok) throw new Error(`Failed to close pull ${prNumber} (${res.status})`);
}

export type MergeResult =
  | { merged: true; sha: string }
  | { merged: false; reason: 'not-mergeable' | 'head-changed' };

/**
 * Squash-merges a pull request, with its own title as the commit title.
 *
 * `headSha` is required: it is the head the caller saw pass its checks
 * (prStatus().headSha), and GitHub refuses the merge (409) if the branch
 * has moved since, so a commit pushed after the checks passed is never
 * merged unchecked. The PR is read first for its title, and a head that has
 * already moved is refused here without asking GitHub to merge.
 *
 * 405 (not mergeable: checks, reviews or conflicts) and 409 (head changed)
 * are ordinary outcomes for a shepherd that polls, not exceptions; anything
 * else throws a short error.
 */
export async function mergePr(prNumber: number, env: Env, headSha: string): Promise<MergeResult> {
  const pull = await getPull(prNumber, env);
  if (pull.head.sha !== headSha) return { merged: false, reason: 'head-changed' };
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls/${prNumber}/merge`,
    {
      method: 'PUT',
      body: JSON.stringify({ merge_method: 'squash', commit_title: pull.title, sha: headSha }),
    },
    env
  );
  if (res.status === 405) return { merged: false, reason: 'not-mergeable' };
  if (res.status === 409) return { merged: false, reason: 'head-changed' };
  if (!res.ok) throw new Error(`Failed to merge pull ${prNumber} (${res.status})`);
  const data = await res.json<{ sha: string }>();
  return { merged: true, sha: data.sha };
}

/** The commit main points at now. Read once by the CMS approval, which
 * checks a draft's files at this commit and branches from it. */
export function mainHeadSha(env: Env): Promise<string> {
  return getBaseBranchSha(env);
}

export type BranchPr = { url: string; number: number; state: 'open' | 'closed' | 'merged' };

/** The newest pull request (any state) whose head is `branchName`, or null. Errors carry the status only. */
export async function prForBranch(branchName: string, env: Env): Promise<BranchPr | null> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/pulls?head=${GITHUB_OWNER}:${encodeURIComponent(branchName)}&state=all&sort=created&direction=desc`,
    { method: 'GET' },
    env
  );
  if (!res.ok) throw new Error(`Failed to look up the pull request for ${branchName} (${res.status})`);
  const list = await res.json<Array<{ html_url: string; number: number; state: string; merged_at: string | null }>>();
  const pr = list[0];
  if (!pr) return null;
  return { url: pr.html_url, number: pr.number, state: pr.merged_at ? 'merged' : pr.state === 'open' ? 'open' : 'closed' };
}

/** Deletes a branch (closing any open pull request from it). 'absent' when
 * GitHub answers 404; 'failed' on a 422, which the caller cannot read as
 * "gone" (the branch, and a pull request on it, may still be there). Only
 * for cms/ branches. Other errors throw, carrying the status only. */
export async function deleteBranch(branchName: string, env: Env): Promise<'deleted' | 'absent' | 'failed'> {
  if (!branchName.startsWith('cms/')) throw new Error('deleteBranch is only for cms/ branches');
  const res = await githubRequest(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/git/refs/heads/${branchName}`, { method: 'DELETE' }, env);
  if (res.status === 404) return 'absent';
  if (res.status === 422) return 'failed';
  if (!res.ok) throw new Error(`Failed to delete branch ${branchName} (${res.status})`);
  return 'deleted';
}
