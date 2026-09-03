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

async function commitFile(
  branchName: string,
  filePath: string,
  content: string,
  message: string,
  env: Env
): Promise<void> {
  const res = await githubRequest(
    `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`,
    {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: toBase64Utf8(content),
        branch: branchName,
      }),
    },
    env
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to commit ${filePath} (${res.status}): ${body}`);
  }
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
