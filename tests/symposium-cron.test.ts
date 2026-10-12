import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/symposium-cron/src/index';

const ENV = {
  ARCHIVE_URL: 'https://main/archive',
  PURGE_URL: 'https://main/purge',
  SYMPOSIUM_ARCHIVE_SECRET: 's',
  SYMPOSIUM_DEPLOY_HOOK: 'https://hooks/symposium',
  WEBSITE_DEPLOY_HOOK: 'https://hooks/website',
};

function stubFetch(fail: string | null = null) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/purge') || url.includes('/archive')) {
      assert.equal(new Headers(init?.headers).get('X-Archive-Secret'), 's');
    }
    if (url === fail) return new Response('down', { status: 500 });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('the tick runs archive, purge, then both rebuilds, in that order', async () => {
  const f = stubFetch();
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 200);
    assert.deepEqual(f.calls, [ENV.ARCHIVE_URL, ENV.PURGE_URL, ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
  } finally { f.restore(); }
});

test('a failing purge still lets both rebuilds run, and the tick reports failure', async () => {
  const f = stubFetch(ENV.PURGE_URL);
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 502);
    assert.deepEqual(f.calls.slice(2), [ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
    const body = await res.json() as { purge: string };
    assert.match(String(body.purge), /^ERROR 500/);
  } finally { f.restore(); }
});
