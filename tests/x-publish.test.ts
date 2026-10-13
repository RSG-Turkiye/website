import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import { setupSocial } from './lib/social';
import { xPublishStep, pkceVerifier, pkceChallenge } from '../functions/_lib/social/x';
import { usableToken } from '../functions/_lib/social/tokens';
import { connectionUpsert, getConnection, readRefreshToken } from '../functions/_lib/connections';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const KEY = Buffer.alloc(32, 1).toString('base64');
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://example.org/k${n}.jpg`, alt: `Alt ${n}`, load: async () => bytes });
const single: PostForPlatform = { type: 'image', caption: 'Kayıt açık https://rsg-turkiye.iscbsc.org/', media: [img(1)] };
const state = (media: string[], attempt: number | null) => JSON.stringify({ x: 1, media, attempt });
const input = (post: PostForPlatform, containerId: string | null, cps: string[] = []): PublishInput => ({
  account: { id: '77', name: 'rsgturkey' }, token: 'x-tok', post, state: { containerId }, now: 1_800_000_000,
  checkpoint: async (c) => { cps.push(c); return true; },
});
async function run(h: (c: HttpCall) => Response | undefined, i: PublishInput) {
  const s = stubHttp(['api.x.com'], h);
  try { return { result: await xPublishStep(i), calls: s.calls }; } finally { s.restore(); }
}

test('PKCE: the verifier is derived from the state with the app secret, and the challenge is its S256 hash', async () => {
  const v = await pkceVerifier('secret', 'state-1');
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await pkceVerifier('secret', 'state-1'), v, 'the callback derives the same verifier');
  assert.notEqual(await pkceVerifier('secret', 'state-2'), v);
  assert.match(await pkceChallenge(v), /^[A-Za-z0-9_-]{43}$/);
});

test('first tick uploads each image with its alt text and waits', async () => {
  let n = 0;
  const { result, calls } = await run((c) => {
    if (c.url.pathname === '/2/media/upload') return Response.json({ data: { id: String(++n), media_key: `3_${n}` } });
    if (c.url.pathname === '/2/media/metadata') return Response.json({ data: { id: '1' } });
    return undefined;
  }, input({ ...single, type: 'carousel', media: [img(1), img(2)] }, null));
  assert.deepEqual(result, { kind: 'pending', containerId: state(['1', '2'], null), notes: [] });
  const up = calls.find((c) => c.url.pathname === '/2/media/upload')!;
  assert.ok(up.body instanceof FormData);
  assert.equal((up.body as FormData).get('media_category'), 'tweet_image');
  assert.equal(up.headers.get('Authorization'), 'Bearer x-tok');
  assert.deepEqual(calls.filter((c) => c.url.pathname === '/2/media/metadata').map((c) => c.body), [
    { id: '1', metadata: { alt_text: { text: 'Alt 1' } } }, { id: '2', metadata: { alt_text: { text: 'Alt 2' } } },
  ]);
});

test('alt text refused: the image still goes, and the gap is noted', async () => {
  const { result } = await run((c) => {
    if (c.url.pathname === '/2/media/upload') return Response.json({ data: { id: '1' } });
    if (c.url.pathname === '/2/media/metadata') return Response.json({ title: 'Invalid Request' }, { status: 400 });
    return undefined;
  }, input(single, null));
  assert.deepEqual(result, { kind: 'pending', containerId: state(['1'], null), notes: ['alt_text_dropped'] });
});

test('second tick checkpoints, then posts the text with the media', async () => {
  const cps: string[] = [];
  const { result, calls } = await run((c) => (c.url.pathname === '/2/tweets' ? Response.json({ data: { id: '1900', text: 'x' } }, { status: 201 }) : undefined), input(single, state(['1'], null), cps));
  assert.deepEqual(result, { kind: 'done', remoteId: '1900', permalink: 'https://x.com/rsgturkey/status/1900' });
  assert.deepEqual(cps, [state(['1'], 1_800_000_000)]);
  assert.deepEqual(calls[0].body, { text: single.caption, media: { media_ids: ['1'] } });
});

test('after a lost answer, X calling the retry a duplicate proves the first one went out', async () => {
  const { result } = await run((c) => (c.url.pathname === '/2/tweets'
    ? Response.json({ title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.', status: 403 }, { status: 403 })
    : undefined), input(single, state(['1'], 1_800_000_000)));
  assert.deepEqual(result, { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_duplicate'] });
});

test('a duplicate on a first attempt is the team repeating an old text: failed, with the reason', async () => {
  const { result } = await run(() => Response.json({ detail: 'You are not allowed to create a Tweet with duplicate content.', status: 403 }, { status: 403 }), input(single, state(['1'], null)));
  assert.equal(result.kind, 'fail');
  assert.match((result as { reason: string }).reason, /^duplicate: /);
});

test('no credits, a revoked token, a timeout', async () => {
  const pay = await run(() => Response.json({ title: 'Payment Required', detail: 'no credits', status: 402 }, { status: 402 }), input(single, state(['1'], null)));
  assert.match((pay.result as { reason: string }).reason, /^no_api_access: /);
  const auth = await run(() => Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 }), input(single, state(['1'], null)));
  assert.equal(auth.result.kind, 'auth');
  const down = await run(() => new Response('', { status: 503 }), input(single, state(['1'], null)));
  assert.equal(down.result.kind, 'retry');
});

function xWorld() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret' } as never as { DB: D1Database; TOKEN_ENC_KEY: string; X_CLIENT_ID: string; X_CLIENT_SECRET: string };
  return { ...s, env };
}
async function connectX(env: { DB: D1Database; TOKEN_ENC_KEY: string }, expiresAt: number) {
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'old-access', refreshToken: 'rt-1', scopes: 'x', expiresAt, refreshExpiresAt: null }, 'admin', 1)).run();
}

test('an X access token about to expire is renewed on use, and the rotated refresh token is stored', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], (c) => {
    if (c.url.pathname !== '/2/oauth2/token') return undefined;
    assert.equal(c.headers.get('Authorization'), `Basic ${btoa('xid:xsecret')}`);
    assert.equal((c.body as URLSearchParams).get('refresh_token'), 'rt-1');
    return Response.json({ access_token: 'new-access', refresh_token: 'rt-2', expires_in: 7200, scope: 'tweet.write' });
  });
  let u;
  try { u = await usableToken(env, 'x', now); } finally { g.restore(); }
  assert.deepEqual(u, { ok: true, token: 'new-access', account: { id: '77', name: 'rsgturkey' } });
  const row = (await getConnection(env.DB, 'x'))!;
  assert.equal(await readRefreshToken(env, row), 'rt-2');
  assert.equal(row.expires_at, now + 7200);
});

test('two renewals racing: the one that loses uses the winner\'s token and does not mark X broken', async () => {
  const { env, db } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const stale = (await getConnection(env.DB, 'x'))!;
  // The other side renews first: a new access token and a rotated refresh token are already stored.
  const g1 = stubHttp(['api.x.com'], () => Response.json({ access_token: 'winner-access', refresh_token: 'rt-2', expires_in: 7200 }));
  try { await usableToken(env, 'x', now); } finally { g1.restore(); }
  // This side read the row before that and now tries the spent refresh token.
  const { refreshXOnUse } = await import('../functions/_lib/social/x');
  const g2 = stubHttp(['api.x.com'], () => Response.json({ error: 'invalid_request', error_description: 'Value passed for the token was invalid.' }, { status: 400 }));
  let u;
  try { u = await refreshXOnUse(env, stale, now); } finally { g2.restore(); }
  assert.deepEqual(u, { ok: true, token: 'winner-access', account: { id: '77', name: 'rsgturkey' } });
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform = 'x'`).get() as { last_error: string | null }).last_error, null);
});

test('a refresh token X no longer accepts, with nobody else having renewed: broken, and the caller is told it just broke', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], () => Response.json({ error: 'invalid_request' }, { status: 400 }));
  let u;
  try { u = await usableToken(env, 'x', now); } finally { g.restore(); }
  assert.equal(u!.ok, false);
  assert.equal((u as { why: string }).why, 'broken');
  assert.equal((u as { justBroke?: boolean }).justBroke, true);
});

test('X unreachable while renewing, old token still valid: it is used; already expired: try again next tick', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], () => new Response('', { status: 503 }));
  try {
    assert.deepEqual(await usableToken(env, 'x', now), { ok: true, token: 'old-access', account: { id: '77', name: 'rsgturkey' } });
    assert.equal((await usableToken(env, 'x', now + 120) as { why: string }).why, 'transient');
  } finally { g.restore(); }
});

test('recovering: a 400 or a 402 does not prove nothing went out, so it is retried as uncertain and the attempt is kept', async () => {
  for (const status of [400, 402]) {
    const { result } = await run(() => Response.json({ title: 'Nope', detail: 'refused', status }, { status }), input(single, state(['1'], 1_800_000_000)));
    assert.equal(result.kind, 'retry', String(status));
    assert.match((result as { reason: string }).reason, /^uncertain: /);
    assert.equal('clearContainer' in result, false);
  }
});

test('recovering: 401 is auth, 429 is rate limited, 5xx is uncertain', async () => {
  const a = await run(() => Response.json({ title: 'Unauthorized' }, { status: 401 }), input(single, state(['1'], 1_800_000_000)));
  assert.equal(a.result.kind, 'auth');
  const r = await run(() => Response.json({ title: 'Too Many Requests' }, { status: 429 }), input(single, state(['1'], 1_800_000_000)));
  assert.match((r.result as { reason: string }).reason, /^rate_limited: /);
  const s = await run(() => new Response('', { status: 503 }), input(single, state(['1'], 1_800_000_000)));
  assert.match((s.result as { reason: string }).reason, /^uncertain: /);
});

test('a 2xx that is not 200/201, or a 201 without an id, is uncertain, not done', async () => {
  const a = await run(() => Response.json({ data: { id: '5' } }, { status: 202 }), input(single, state(['1'], null)));
  assert.deepEqual(a.result, { kind: 'retry', reason: 'uncertain: unexpected 202 from X' });
  const b = await run(() => Response.json({}, { status: 201 }), input(single, state(['1'], null)));
  assert.deepEqual(b.result, { kind: 'retry', reason: 'uncertain: unexpected 201 from X' });
});
