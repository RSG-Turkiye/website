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

type OpenPrResult = { success: true; prUrl: string } | { success: false; error: string };

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

async function createPullRequest(
  branchName: string,
  title: string,
  body: string,
  env: Env
): Promise<string> {
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
    // GitHub's own reason for a 422 here is almost always "A pull request
    // already exists for <owner>:<branch>" -- the retry case this exists
    // for, where a previous attempt opened the PR but crashed before its
    // URL was recorded. Recover that PR's URL rather than failing; if this
    // 422 is for some other reason (no existing PR is found), fall through
    // to the same error handling every other failure gets.
    const existing = await findExistingPr(branchName, env);
    if (existing) return existing;
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Failed to open PR (${res.status}): ${errBody}`);
  }
  const data = await res.json<{ html_url: string }>();
  return data.html_url;
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
    const prUrl = await createPullRequest(branchName, params.title, params.prBody, env);
    return { success: true, prUrl };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Unknown GitHub API error' };
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
