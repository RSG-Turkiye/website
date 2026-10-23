// The CMS helpers in functions/_lib/github.ts: deleting files through
// openContentPR, reading blob shas off main, folding a pull request's
// required checks into one answer, and the two writes the PR shepherd makes
// (update-branch and squash-merge).
//
// Same approach as tests/github-content-pr.test.ts: global.fetch is swapped
// for a small fake for the duration of each test, so the real functions run
// end to end with no token and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openContentPR,
  fileShasOnBase,
  prStatus,
  updateBranch,
  mergePr,
  REQUIRED_CHECKS,
} from '../functions/_lib/github';

type Req = { method: string; path: string; body: any };
type Handler = (method: string, url: URL, body: any) => Response | undefined;

const env = { GITHUB_PAT: 'unused-fetch-is-stubbed' } as never;

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

async function withFetch<T>(handler: Handler, run: (requests: Req[]) => Promise<T>): Promise<T> {
  const requests: Req[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, path: url.pathname + url.search, body });
    const res = handler(method, url, body);
    if (!res) throw new Error(`unexpected fake fetch: ${method} ${url}`);
    return res;
  }) as never;
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = realFetch;
  }
}

const REPO = '/repos/RSG-Turkiye/website';

// ---------------------------------------------------------------- REQUIRED_CHECKS

test('REQUIRED_CHECKS pins the branch-protection contexts as of 2026-10-23', () => {
  assert.deepEqual([...REQUIRED_CHECKS], ['Build & Type Check', 'Symposium Build & Type Check']);
});

// ---------------------------------------------------------------- openContentPR deletes

function contentPrHandler(branchFiles: Map<string, string>): Handler {
  return (method, url, body) => {
    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) return json({ object: { sha: 'base-sha' } });
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) return json({}, 201);
    if (url.pathname.includes('/contents/')) {
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]);
      if (method === 'GET') {
        const sha = branchFiles.get(path);
        if (!sha) return json({ message: 'Not Found' }, 404);
        return json({ sha, content: Buffer.from('old').toString('base64'), encoding: 'base64' });
      }
      if (method === 'PUT') {
        branchFiles.set(path, 'new-sha');
        return json({ content: { sha: 'new-sha' } }, 201);
      }
      if (method === 'DELETE') {
        if (branchFiles.get(path) !== body.sha) return json({ message: 'sha does not match' }, 409);
        branchFiles.delete(path);
        return json({ commit: {} });
      }
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      return json({ html_url: 'https://github.com/RSG-Turkiye/website/pull/7' }, 201);
    }
    return undefined;
  };
}

test('a null content deletes the file with its sha on the branch', async () => {
  const branchFiles = new Map([['src/content/events/old.json', 'blob-old']]);
  await withFetch(contentPrHandler(branchFiles), async (requests) => {
    const result = await openContentPR(
      {
        branchPrefix: 'cms',
        branchSlug: 'events-1',
        files: [
          { path: 'src/content/events/new.json', content: '{}\n' },
          { path: 'src/content/events/old.json', content: null },
        ],
        title: 't',
        prBody: 'b',
        retitle: false,
      },
      env,
    );
    assert.deepEqual(result, { success: true, prUrl: 'https://github.com/RSG-Turkiye/website/pull/7' });
    const del = requests.filter((r) => r.method === 'DELETE');
    assert.equal(del.length, 1);
    assert.equal(del[0].path, `${REPO}/contents/src/content/events/old.json`);
    assert.equal(del[0].body.sha, 'blob-old');
    assert.equal(del[0].body.branch, 'cms/events-1');
    assert.equal(typeof del[0].body.message, 'string');
    assert.equal(branchFiles.has('src/content/events/old.json'), false);
  });
});

test('deleting a file already gone from the branch is skipped, so a retry converges', async () => {
  const branchFiles = new Map<string, string>();
  await withFetch(contentPrHandler(branchFiles), async (requests) => {
    const result = await openContentPR(
      {
        branchPrefix: 'cms',
        branchSlug: 'events-1',
        files: [{ path: 'src/content/events/old.json', content: null }],
        title: 't',
        prBody: 'b',
        retitle: false,
      },
      env,
    );
    assert.equal(result.success, true);
    assert.equal(requests.filter((r) => r.method === 'DELETE').length, 0);
  });
});

test('a failed delete comes back as an error result, not a throw', async () => {
  await withFetch(
    (method, url) => {
      if (method === 'DELETE') return new Response('secret-ish GitHub body', { status: 500 });
      return contentPrHandler(new Map([['a.json', 'blob-a']]))(method, url, undefined);
    },
    async () => {
      const result = await openContentPR(
        { branchPrefix: 'cms', branchSlug: 'x', files: [{ path: 'a.json', content: null }], title: 't', prBody: 'b', retitle: false },
        env,
      );
      assert.equal(result.success, false);
      assert.ok('error' in result && result.error.includes('500'));
    },
  );
});

// ---------------------------------------------------------------- fileShasOnBase

test('fileShasOnBase returns each blob sha on main and maps a 404 to null', async () => {
  await withFetch(
    (method, url) => {
      if (method !== 'GET' || !url.pathname.includes('/contents/')) return undefined;
      assert.equal(url.searchParams.get('ref'), 'main');
      const path = decodeURIComponent(url.pathname.split('/contents/')[1]);
      if (path === 'a.json') return json({ sha: 'sha-a', type: 'file' });
      return json({ message: 'Not Found' }, 404);
    },
    async (requests) => {
      const shas = await fileShasOnBase(['a.json', 'missing.json'], env);
      assert.deepEqual(shas, { 'a.json': 'sha-a', 'missing.json': null });
      assert.equal(requests.length, 2, 'one GET per path');
    },
  );
});

test('fileShasOnBase throws on a non-404 failure without echoing the body', async () => {
  await withFetch(
    () => new Response('GITHUB-BODY-DETAIL', { status: 502 }),
    async () => {
      await assert.rejects(fileShasOnBase(['a.json'], env), (e: Error) => {
        assert.ok(e.message.includes('502'));
        assert.ok(!e.message.includes('GITHUB-BODY-DETAIL'));
        return true;
      });
    },
  );
});

test('fileShasOnBase with no paths makes no request', async () => {
  await withFetch(
    () => undefined,
    async (requests) => {
      assert.deepEqual(await fileShasOnBase([], env), {});
      assert.equal(requests.length, 0);
    },
  );
});

// ---------------------------------------------------------------- prStatus

type Run = { id: number; name: string; status: string; conclusion: string | null };

function prHandler(pull: Record<string, unknown>, runs: Run[]): Handler {
  return (method, url) => {
    if (method === 'GET' && url.pathname === `${REPO}/pulls/12`) return json(pull);
    if (method === 'GET' && url.pathname === `${REPO}/commits/head-1/check-runs`) {
      return json({ total_count: runs.length, check_runs: runs });
    }
    return undefined;
  };
}

const openPull = { state: 'open', merged: false, mergeable_state: 'clean', head: { sha: 'head-1' }, title: 'CMS: events' };
const ok = (id: number, name: string): Run => ({ id, name, status: 'completed', conclusion: 'success' });

test('prStatus: all required checks green is success, and other checks are ignored', async () => {
  const runs = [ok(1, 'Build & Type Check'), ok(2, 'Symposium Build & Type Check'), { id: 3, name: 'lp-link-check', status: 'completed', conclusion: 'failure' }];
  await withFetch(prHandler(openPull, runs), async () => {
    const s = await prStatus(12, env);
    assert.deepEqual(s, { state: 'open', mergeable_state: 'clean', checks: 'success', headSha: 'head-1' });
  });
});

test('prStatus: a missing required check is pending', async () => {
  await withFetch(prHandler(openPull, [ok(1, 'Build & Type Check')]), async () => {
    assert.equal((await prStatus(12, env)).checks, 'pending');
  });
});

test('prStatus: a queued or in-progress required check is pending', async () => {
  for (const status of ['queued', 'in_progress']) {
    const runs = [ok(1, 'Build & Type Check'), { id: 2, name: 'Symposium Build & Type Check', status, conclusion: null }];
    await withFetch(prHandler(openPull, runs), async () => {
      assert.equal((await prStatus(12, env)).checks, 'pending', status);
    });
  }
});

test('prStatus: a failed required check is failure and names the check', async () => {
  for (const conclusion of ['failure', 'cancelled', 'timed_out', 'action_required']) {
    const runs = [ok(1, 'Build & Type Check'), { id: 2, name: 'Symposium Build & Type Check', status: 'completed', conclusion }];
    await withFetch(prHandler(openPull, runs), async () => {
      const s = await prStatus(12, env);
      assert.equal(s.checks, 'failure', conclusion);
      assert.equal(s.failedCheck, 'Symposium Build & Type Check');
    });
  }
});

test('prStatus: failure wins over pending', async () => {
  const runs = [{ id: 1, name: 'Build & Type Check', status: 'completed', conclusion: 'failure' }];
  await withFetch(prHandler(openPull, runs), async () => {
    const s = await prStatus(12, env);
    assert.equal(s.checks, 'failure');
    assert.equal(s.failedCheck, 'Build & Type Check');
  });
});

test('prStatus: a re-run counts, not the older run of the same check', async () => {
  const runs = [
    { id: 1, name: 'Build & Type Check', status: 'completed', conclusion: 'failure' },
    ok(5, 'Build & Type Check'),
    ok(2, 'Symposium Build & Type Check'),
  ];
  await withFetch(prHandler(openPull, runs), async () => {
    assert.equal((await prStatus(12, env)).checks, 'success');
  });
});

test('prStatus surfaces mergeable_state behind', async () => {
  const runs = [ok(1, 'Build & Type Check'), ok(2, 'Symposium Build & Type Check')];
  await withFetch(prHandler({ ...openPull, mergeable_state: 'behind' }, runs), async () => {
    assert.equal((await prStatus(12, env)).mergeable_state, 'behind');
  });
});

test('prStatus reports merged and closed pull requests', async () => {
  await withFetch(prHandler({ ...openPull, state: 'closed', merged: true }, []), async () => {
    assert.equal((await prStatus(12, env)).state, 'merged');
  });
  await withFetch(prHandler({ ...openPull, state: 'closed', merged: false }, []), async () => {
    assert.equal((await prStatus(12, env)).state, 'closed');
  });
});

test('prStatus throws a short error without the GitHub body', async () => {
  await withFetch(
    () => new Response('GITHUB-BODY-DETAIL', { status: 404 }),
    async () => {
      await assert.rejects(prStatus(12, env), (e: Error) => {
        assert.ok(e.message.includes('404'));
        assert.ok(!e.message.includes('GITHUB-BODY-DETAIL'));
        return true;
      });
    },
  );
});

// ---------------------------------------------------------------- updateBranch

test('updateBranch PUTs update-branch with the expected head sha', async () => {
  await withFetch(
    (method, url) => (method === 'PUT' && url.pathname === `${REPO}/pulls/12/update-branch` ? json({ message: 'Updating pull request branch.' }, 202) : undefined),
    async (requests) => {
      assert.deepEqual(await updateBranch(12, env, 'head-1'), { success: true });
      assert.equal(requests[0].body.expected_head_sha, 'head-1');
    },
  );
});

test('updateBranch reports a 422 (head moved or conflict) as not updated, not a throw', async () => {
  await withFetch(
    () => new Response('GITHUB-BODY-DETAIL', { status: 422 }),
    async () => {
      assert.deepEqual(await updateBranch(12, env, 'head-1'), { success: false, status: 422 });
    },
  );
});

// ---------------------------------------------------------------- mergePr

function mergeHandler(mergeRes: () => Response): Handler {
  return (method, url) => {
    if (method === 'GET' && url.pathname === `${REPO}/pulls/12`) return json(openPull);
    if (method === 'PUT' && url.pathname === `${REPO}/pulls/12/merge`) return mergeRes();
    return undefined;
  };
}

test('mergePr squash-merges with the PR title and the validated head sha', async () => {
  await withFetch(
    mergeHandler(() => json({ merged: true, sha: 'merge-sha' })),
    async (requests) => {
      assert.deepEqual(await mergePr(12, env, 'head-1'), { merged: true, sha: 'merge-sha' });
      const put = requests.find((r) => r.method === 'PUT')!;
      assert.equal(put.body.merge_method, 'squash');
      assert.equal(put.body.commit_title, 'CMS: events');
      assert.equal(put.body.sha, 'head-1');
    },
  );
});

test('mergePr: 405 is "not mergeable now", not a throw', async () => {
  await withFetch(
    mergeHandler(() => new Response('GITHUB-BODY-DETAIL', { status: 405 })),
    async () => {
      assert.deepEqual(await mergePr(12, env, 'head-1'), { merged: false, reason: 'not-mergeable' });
    },
  );
});

test('mergePr: 409 is "head changed", not a throw', async () => {
  await withFetch(
    mergeHandler(() => new Response('GITHUB-BODY-DETAIL', { status: 409 })),
    async () => {
      assert.deepEqual(await mergePr(12, env, 'head-1'), { merged: false, reason: 'head-changed' });
    },
  );
});

test('mergePr refuses without a merge call when the head already moved', async () => {
  await withFetch(
    mergeHandler(() => json({ merged: true, sha: 'merge-sha' })),
    async (requests) => {
      assert.deepEqual(await mergePr(12, env, 'older-head'), { merged: false, reason: 'head-changed' });
      assert.equal(requests.filter((r) => r.method === 'PUT').length, 0);
    },
  );
});

test('mergePr throws a short error on anything else', async () => {
  await withFetch(
    mergeHandler(() => new Response('GITHUB-BODY-DETAIL', { status: 500 })),
    async () => {
      await assert.rejects(mergePr(12, env, 'head-1'), (e: Error) => {
        assert.ok(e.message.includes('500'));
        assert.ok(!e.message.includes('GITHUB-BODY-DETAIL'));
        return true;
      });
    },
  );
});
