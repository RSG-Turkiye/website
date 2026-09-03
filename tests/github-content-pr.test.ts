// openContentPR is what an archived edition's pull request and an approved
// blog submission's pull request both go through. Both callers can retry
// after a crash between GitHub succeeding and their own database write
// landing -- these tests prove that retry converges instead of colliding:
// a second call with the same branch/files does not 422 on a branch that
// already exists, a file that's already committed, or a PR that's already
// open, and it returns the SAME PR url rather than opening a second one.
//
// global.fetch is replaced with a small stateful fake for the duration of
// each test and restored after -- openContentPR itself takes no D1 and
// reads no other Env field beyond GITHUB_PAT, so this is enough to drive it
// for real, with no network and no real PR ever opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openContentPR } from '../functions/_lib/github';

type FakeFile = { sha: string; content: string };

function makeFakeGithub() {
  const branches = new Set<string>();
  const files = new Map<string, FakeFile>(); // `${branch}:${path}`
  const pulls = new Map<string, { html_url: string }>(); // branch -> PR
  let shaSeq = 1;
  let prSeq = 1;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];

  const fileKey = (branch: string, path: string) => `${branch}:${path}`;

  const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname + url.search, body });

    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }

    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      const branch = (body.ref as string).replace('refs/heads/', '');
      if (branches.has(branch)) return new Response(JSON.stringify({ message: 'already exists' }), { status: 422 });
      branches.add(branch);
      return new Response(JSON.stringify({ ref: body.ref }), { status: 201 });
    }

    if (method === 'GET' && url.pathname.includes('/contents/')) {
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]);
      const ref = url.searchParams.get('ref') ?? 'main';
      const existing = files.get(fileKey(ref, path));
      if (!existing) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return new Response(JSON.stringify({ sha: existing.sha, content: Buffer.from(existing.content).toString('base64'), encoding: 'base64' }), { status: 200 });
    }

    if (method === 'PUT' && url.pathname.includes('/contents/')) {
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]);
      const key = fileKey(body.branch, path);
      const existing = files.get(key);
      if (existing && !body.sha) {
        // The real API's real behaviour: no sha for an existing path is refused.
        return new Response(JSON.stringify({ message: '"sha" wasn\'t supplied' }), { status: 422 });
      }
      const sha = `sha-${shaSeq++}`;
      files.set(key, { sha, content: body.content });
      return new Response(JSON.stringify({ content: { sha } }), { status: existing ? 200 : 201 });
    }

    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      const existing = pulls.get(body.head as string);
      if (existing) return new Response(JSON.stringify({ message: `A pull request already exists for x:${body.head}.` }), { status: 422 });
      const pr = { html_url: `https://github.com/RSG-Turkiye/website/pull/${prSeq++}` };
      pulls.set(body.head as string, pr);
      return new Response(JSON.stringify(pr), { status: 201 });
    }

    if (method === 'GET' && url.pathname.endsWith('/pulls')) {
      const head = url.searchParams.get('head');
      const branch = head?.split(':')[1];
      const pr = branch ? pulls.get(branch) : undefined;
      return new Response(JSON.stringify(pr ? [pr] : []), { status: 200 });
    }

    throw new Error(`unexpected fake fetch: ${method} ${url}`);
  };

  return { fetchImpl, files, pulls, requests, fileKey };
}

const env = { GITHUB_PAT: 'unused-fetch-is-stubbed' } as never;

test('a retried commit updates the existing file instead of 422ing on a missing sha', async () => {
  const gh = makeFakeGithub();
  const realFetch = globalThis.fetch;
  globalThis.fetch = gh.fetchImpl as never;
  try {
    const params = {
      branchPrefix: 'symposium-archive',
      branchSlug: '2020',
      files: [{ path: 'a.json', content: '{"x":1}\n' }],
      title: 't',
      prBody: 'b',
    };

    const first = await openContentPR(params, env);
    assert.equal(first.success, true);

    const putRequests = gh.requests.filter((r) => r.method === 'PUT');
    assert.equal(putRequests.length, 1, 'one PUT for the first attempt');
    assert.equal(putRequests[0].body.sha, undefined, 'no sha for a brand-new file');

    const second = await openContentPR(params, env);
    assert.equal(second.success, true, 'the retry must not fail');

    const putRequestsAfterRetry = gh.requests.filter((r) => r.method === 'PUT');
    assert.equal(putRequestsAfterRetry.length, 2, 'the retry also PUTs (updates in place)');
    assert.ok(putRequestsAfterRetry[1].body.sha, 'the retry supplies the sha it looked up');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a retried PR recovers the existing PR\'s url instead of failing on the 422', async () => {
  const gh = makeFakeGithub();
  const realFetch = globalThis.fetch;
  globalThis.fetch = gh.fetchImpl as never;
  try {
    const params = {
      branchPrefix: 'symposium-archive',
      branchSlug: '2020',
      files: [{ path: 'a.json', content: '{"x":1}\n' }],
      title: 't',
      prBody: 'b',
    };

    const first = await openContentPR(params, env);
    const second = await openContentPR(params, env);

    assert.equal(first.success, true);
    assert.equal(second.success, true);
    if (first.success && second.success) {
      assert.equal(second.prUrl, first.prUrl, 'the retry returns the SAME pr, not a new one');
    }
    assert.equal(gh.pulls.size, 1, 'exactly one PR was ever created for this branch');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a branch that already exists from a prior attempt is reused, not treated as failure', async () => {
  const gh = makeFakeGithub();
  const realFetch = globalThis.fetch;
  globalThis.fetch = gh.fetchImpl as never;
  try {
    const params = {
      branchPrefix: 'symposium-archive',
      branchSlug: '2020',
      files: [{ path: 'a.json', content: '{"x":1}\n' }],
      title: 't',
      prBody: 'b',
    };

    await openContentPR(params, env);
    const second = await openContentPR(params, env);
    assert.equal(second.success, true);
  } finally {
    globalThis.fetch = realFetch;
  }
});
