// classify422 is the only thing standing between "the archive stamps a
// pull request still titled 'Snapshot the ... CMS content'" and "the cron
// alarms every day forever" -- see docs/superpowers/plans/2026-09-16-
// symposium-snapshot-to-git.md's Task 3b. GitHub's 422 body text is the only
// signal distinguishing "a pull request already exists" (recover it) from
// "no commits between main and this branch" (the content is already on
// main). Anything else must come back 'other' and keep today's throw-into-
// error behaviour, rather than being guessed at.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify422, openContentPR } from '../functions/_lib/github';
import { onRequestPost } from '../functions/api/admin/symposium/archive';

test('a pull request that already exists is classified as exists', () => {
  assert.equal(
    classify422('A pull request already exists for RSG-Turkiye:symposium-archive/2026.'),
    'exists'
  );
});

test('no commits between main and the branch is classified as no-commits', () => {
  assert.equal(
    classify422('No commits between main and symposium-archive/2026'),
    'no-commits'
  );
});

test('a real GitHub JSON error body is still classified from its message field', () => {
  assert.equal(
    classify422(JSON.stringify({ message: 'No commits between main and symposium-archive/2026', documentation_url: 'https://docs.github.com' })),
    'no-commits'
  );
  assert.equal(
    classify422(JSON.stringify({ message: 'A pull request already exists for RSG-Turkiye:symposium-archive/2026.', documentation_url: 'https://docs.github.com' })),
    'exists'
  );
});

test('an unrelated validation body is not guessed at', () => {
  assert.equal(
    classify422(JSON.stringify({ message: 'Validation Failed', errors: [{ field: 'title', code: 'missing_field' }] })),
    'other'
  );
});

// The two integration-level outcomes classify422 exists to unlock:
// recovering an open PR now PATCHes it with the caller's own wording, and
// "no commits" comes back as its own OpenPrResult shape rather than a
// thrown error. A minimal fake fetch drives openContentPR for real, with no
// network and no real PR ever opened -- same approach as
// tests/github-content-pr.test.ts.
const env = { GITHUB_PAT: 'unused-fetch-is-stubbed' } as never;

test('recovering an already-open PR retitles it with the caller\'s title and body', async () => {
  const patchRequests: Array<{ path: string; body: unknown }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (method === 'GET' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (method === 'PUT' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ content: { sha: 'file-sha' } }), { status: 201 });
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify({ message: 'A pull request already exists for RSG-Turkiye:symposium-archive/2026.' }),
        { status: 422 }
      );
    }
    if (method === 'GET' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify([{ html_url: 'https://github.com/RSG-Turkiye/website/pull/42' }]),
        { status: 200 }
      );
    }
    if (method === 'PATCH' && url.pathname.endsWith('/pulls/42')) {
      patchRequests.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({}), { status: 200 });
    }
    throw new Error(`unexpected fake fetch: ${method} ${url}`);
  }) as never;

  try {
    const result = await openContentPR(
      {
        branchPrefix: 'symposium-archive',
        branchSlug: '2026',
        files: [{ path: 'a.json', content: '{}\n' }],
        title: 'Archive the 2026 symposium',
        prBody: 'Merge this promptly.',
      },
      env
    );
    assert.equal(result.success, true);
    if (result.success) assert.equal(result.prUrl, 'https://github.com/RSG-Turkiye/website/pull/42');
    assert.equal(patchRequests.length, 1, 'the recovered PR was retitled');
    assert.deepEqual(patchRequests[0].body, { title: 'Archive the 2026 symposium', body: 'Merge this promptly.' });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a failed retitle PATCH does not fail the recovery', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (method === 'GET' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (method === 'PUT' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ content: { sha: 'file-sha' } }), { status: 201 });
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify({ message: 'A pull request already exists for RSG-Turkiye:symposium-archive/2026.' }),
        { status: 422 }
      );
    }
    if (method === 'GET' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify([{ html_url: 'https://github.com/RSG-Turkiye/website/pull/42' }]),
        { status: 200 }
      );
    }
    if (method === 'PATCH' && url.pathname.endsWith('/pulls/42')) {
      return new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 });
    }
    throw new Error(`unexpected fake fetch: ${method} ${url}`);
  }) as never;

  try {
    const result = await openContentPR(
      {
        branchPrefix: 'symposium-archive',
        branchSlug: '2026',
        files: [{ path: 'a.json', content: '{}\n' }],
        title: 'Archive the 2026 symposium',
        prBody: 'Merge this promptly.',
      },
      env
    );
    assert.equal(result.success, true, 'the PR still exists and is still what the caller needed');
    if (result.success) assert.equal(result.prUrl, 'https://github.com/RSG-Turkiye/website/pull/42');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('"no commits between" comes back as reason: no-commits, not a thrown error', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (method === 'GET' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (method === 'PUT' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ content: { sha: 'file-sha' } }), { status: 201 });
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify({ message: 'No commits between main and symposium-archive/2026' }),
        { status: 422 }
      );
    }
    throw new Error(`unexpected fake fetch: ${method} ${url}`);
  }) as never;

  try {
    const result = await openContentPR(
      {
        branchPrefix: 'symposium-archive',
        branchSlug: '2026',
        files: [{ path: 'a.json', content: '{}\n' }],
        title: 'Archive the 2026 symposium',
        prBody: 'Merge this promptly.',
      },
      env
    );
    assert.equal(result.success, false);
    if (!result.success) assert.equal((result as { reason?: string }).reason, 'no-commits');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// --- the archive route itself: 'no-commits' must retire a FINISHED edition
// and must not alarm a SNAPSHOT day -------------------------------------

type FakeRow = Record<string, unknown>;

/** A minimal env.DB good enough to drive functions/api/admin/symposium/archive.ts's
 * onRequestPost end to end: it dispatches on substrings of the SQL text rather
 * than trying to be a real SQLite engine, which is all this route's own
 * queries need. */
function fakeDb(editionsRows: FakeRow[]) {
  const runCalls: Array<{ sql: string; args: unknown[] }> = [];
  function makeStmt(sql: string, boundArgs: unknown[] = []) {
    return {
      bind: (...args: unknown[]) => makeStmt(sql, args),
      all: async <T,>() => {
        if (sql.includes('FROM symposium_edition') && sql.includes('ORDER BY year ASC')) {
          return { results: editionsRows as unknown as T[] };
        }
        // The three fetchOverlayRows SELECTs: one speaker row is enough to
        // make renderArchive produce a file, so openContentPR is actually
        // reached; sessions/committee can stay empty.
        if (sql.includes('FROM symposium_speakers')) {
          return {
            results: [
              { id: 's1', slug: 'a-speaker', year: boundArgs[0], name: 'A Speaker', position: 'Chair', company: 'RSG', bio: 'bio', photo: 'p.jpg', linkedin: '', sort: 0 },
            ] as unknown as T[],
          };
        }
        return { results: [] as unknown as T[] };
      },
      run: async () => {
        runCalls.push({ sql, args: boundArgs });
        return { success: true, meta: {} };
      },
      first: async () => null,
    };
  }
  return { DB: { prepare: (sql: string) => makeStmt(sql) } as never, runCalls };
}

function makeGithubFetch(markdownByYear: Record<number, string>) {
  return (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    if (method === 'GET' && /\/contents\/.*editions\/(\d+)\.md/.test(url.pathname)) {
      const year = Number(/editions\/(\d+)\.md/.exec(url.pathname)![1]);
      const markdown = markdownByYear[year];
      if (markdown === undefined) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return new Response(
        JSON.stringify({ content: Buffer.from(markdown, 'utf-8').toString('base64'), encoding: 'base64' }),
        { status: 200 }
      );
    }
    if (method === 'GET' && url.pathname.endsWith('/git/ref/heads/main')) {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }), { status: 200 });
    }
    if (method === 'POST' && url.pathname.endsWith('/git/refs')) {
      return new Response(JSON.stringify({}), { status: 201 });
    }
    if (method === 'GET' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (method === 'PUT' && url.pathname.includes('/contents/')) {
      return new Response(JSON.stringify({ content: { sha: 'file-sha' } }), { status: 201 });
    }
    if (method === 'POST' && url.pathname.endsWith('/pulls')) {
      return new Response(
        JSON.stringify({ message: 'No commits between main and symposium-archive/branch' }),
        { status: 422 }
      );
    }
    throw new Error(`unexpected fake fetch: ${method} ${url}`);
  }) as never;
}

test('a FINISHED edition with no-commits stamps archived_at and reports archived-no-pr, not error', async () => {
  const year = 2020;
  const past = '2019-01-01';
  const editionsRows: FakeRow[] = [
    { year, registration_url: '', registration_deadline: null, abstract_url: '', abstract_deadline: null, venue_public: null, city_public: null, archived_pr_url: null, archived_at: null },
  ];
  const { DB, runCalls } = fakeDb(editionsRows);
  const env = {
    DB,
    GITHUB_PAT: 'unused-fetch-is-stubbed',
    SYMPOSIUM_ARCHIVE_SECRET: 'secret',
  } as never;
  const request = new Request('https://example.com/api/admin/symposium/archive', {
    method: 'POST',
    headers: { 'X-Archive-Secret': 'secret' },
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = makeGithubFetch({ [year]: `---\nstartDate: "${past}"\nendDate: "${past}"\n---\n` });
  try {
    const res = await onRequestPost({ request, env } as never);
    const payload = await res.json() as { ok: boolean; results: Array<{ year: number; status: string }> };

    assert.equal(payload.ok, true, 'a FINISHED no-commits edition must not raise anyError');
    assert.deepEqual(payload.results, [{ year, status: 'archived-no-pr' }]);

    const archivedAtUpdate = runCalls.find((c) => c.sql.includes('SET archived_at ='));
    assert.ok(archivedAtUpdate, 'archived_at was stamped');
    assert.equal(archivedAtUpdate!.args[1], year);
    assert.equal(typeof archivedAtUpdate!.args[0], 'number');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('a SNAPSHOT day with no-commits reports snapshot-no-changes, not error, and stamps nothing', async () => {
  const year = 2099;
  const future = '2099-06-01';
  const editionsRows: FakeRow[] = [
    { year, registration_url: '', registration_deadline: null, abstract_url: '', abstract_deadline: null, venue_public: null, city_public: null, archived_pr_url: null, archived_at: null },
  ];
  const { DB, runCalls } = fakeDb(editionsRows);
  const env = {
    DB,
    GITHUB_PAT: 'unused-fetch-is-stubbed',
    SYMPOSIUM_ARCHIVE_SECRET: 'secret',
  } as never;
  const request = new Request('https://example.com/api/admin/symposium/archive', {
    method: 'POST',
    headers: { 'X-Archive-Secret': 'secret' },
  });

  const realFetch = globalThis.fetch;
  globalThis.fetch = makeGithubFetch({ [year]: `---\nstartDate: "${future}"\nendDate: "${future}"\n---\n` });
  try {
    const res = await onRequestPost({ request, env } as never);
    const payload = await res.json() as { ok: boolean; results: Array<{ year: number; status: string }> };

    assert.equal(payload.ok, true, 'a SNAPSHOT no-commits day must not raise anyError');
    assert.deepEqual(payload.results, [{ year, status: 'snapshot-no-changes' }]);
    assert.equal(runCalls.length, 0, 'no D1 write happens for an unfinished edition');
  } finally {
    globalThis.fetch = realFetch;
  }
});
