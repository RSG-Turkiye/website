import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import {
  bufferPublishStep, bufferGraphql, parseRateLimit, lowestShare, decodeBufferState, resetRateMemory, channelFits, foreignState, comparableText,
  POLL_BACKOFF, RECOVERY_SETTLE_SECONDS, type BufferChannel,
} from '../functions/_lib/social/buffer';
import { publisherFor } from '../functions/_lib/social/registry';
import { linkedinPublishStep } from '../functions/_lib/social/linkedin';
import { xPublishStep } from '../functions/_lib/social/x';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const HOSTS = ['api.buffer.com'];
const NOW = 1_800_000_000;
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://rsg-turkiye.iscbsc.org/api/images/k${n}.jpg`, alt: `Alt ${n}` });
const single: PostForPlatform = { type: 'image', caption: 'Kayıt açık #bioinformatics', media: [img(1)] };

beforeEach(() => resetRateMemory());

function input(post: PostForPlatform, containerId: string | null, opts: { checkpoints?: string[]; platform?: 'linkedin' | 'x'; now?: number; lease?: boolean } = {}): PublishInput {
  return {
    account: { id: 'chan1', name: 'ISCB SC RSG-Türkiye', org: 'org1' }, token: 'buf-key', post, state: { containerId }, now: opts.now ?? NOW,
    platform: opts.platform ?? 'linkedin',
    checkpoint: async (c) => { opts.checkpoints?.push(c); return opts.lease ?? true; },
  };
}
const state = (s: { attempt?: number | null; first?: number | null; postId?: string | null; next?: number; polls?: number }) =>
  JSON.stringify({ buf: 1, attempt: s.attempt ?? null, first: s.first ?? s.attempt ?? null, postId: s.postId ?? null, next: s.next ?? 0, polls: s.polls ?? 0 });
const decoded = (r: unknown) => JSON.parse((r as { containerId: string }).containerId);

/** Routes a GraphQL call by the operation's first word after query/mutation. */
const op = (c: HttpCall) => String((c.body as { query?: string }).query ?? '').match(/^(?:query|mutation)\s+(\w+)/)?.[1];
const gql = (data: unknown, init: ResponseInit = {}) => Response.json({ data }, init);

async function run(h: (c: HttpCall) => Response | undefined, i: PublishInput) {
  const s = stubHttp(HOSTS, h);
  try { return { result: await bufferPublishStep(i), calls: s.calls }; } finally { s.restore(); }
}

test('rate-limit headers: the share left is the lowest across windows, quota from the policy or the name', () => {
  const w = parseRateLimit('"100-in-15min"; r=98; t=897, "250-in-1day"; r=20; t=86397, "3000-in-30days"; r=2969; t=696980',
    '"100-in-15min"; q=100; w=900; pk=:abc:, "250-in-1day"; q=250; w=86400; pk=:abc:');
  assert.deepEqual(w.map((x) => [x.name, x.remaining, x.quota]), [['100-in-15min', 98, 100], ['250-in-1day', 20, 250], ['3000-in-30days', 2969, 3000]]);
  assert.equal(lowestShare(w), 20 / 250);
  assert.deepEqual(parseRateLimit(null, null), []);
  assert.equal(lowestShare([]), null);
});

test('the state codec round-trips and refuses what is not ours', () => {
  assert.deepEqual(decodeBufferState(state({ attempt: 5, first: 3, postId: 'p', next: 9, polls: 2 })), { buf: 1, attempt: 5, first: 3, postId: 'p', next: 9, polls: 2 });
  assert.equal(decodeBufferState(JSON.stringify({ buf: 1, attempt: 7 }))!.first, 7, 'an older state without first uses its attempt');
  assert.equal(decodeBufferState(JSON.stringify({ li: 1 })), null);
  assert.equal(decodeBufferState('not json'), null);
  assert.equal(decodeBufferState(null), null);
});

test('first tick: checkpoint, then share now with the image URL and alt text; the Buffer id is kept', async () => {
  const cps: string[] = [];
  const { result, calls } = await run((c) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'bp1' } } }) : undefined, input(single, null, { checkpoints: cps }));
  assert.equal(JSON.parse(cps[0]).attempt, NOW, 'the attempt is recorded before the create call');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer buf-key');
  assert.deepEqual((calls[0].body as { variables: unknown }).variables, {
    input: {
      channelId: 'chan1', text: 'Kayıt açık #bioinformatics', schedulingType: 'automatic', mode: 'shareNow',
      assets: [{ image: { url: 'https://rsg-turkiye.iscbsc.org/api/images/k1.jpg', metadata: { altText: 'Alt 1' } } }],
    },
  });
  assert.equal(result.kind, 'pending');
  assert.deepEqual(decoded(result), { buf: 1, attempt: null, first: NOW, postId: 'bp1', next: NOW + POLL_BACKOFF[0], polls: 0 });
});

test('an image without alt text goes out with no metadata, not an empty altText', async () => {
  const { calls } = await run((c) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'bp1' } } }) : undefined,
    input({ ...single, media: [{ ...single.media[0], alt: '  ' }] }, null));
  const sent = (calls[0].body as { variables: { input: { assets: unknown } } }).variables.input.assets;
  assert.deepEqual(sent, [{ image: { url: 'https://rsg-turkiye.iscbsc.org/api/images/k1.jpg' } }]);
});

test('before any call: stories, posts without images and more than four images on X are refused', async () => {
  const none = (c: HttpCall): Response | undefined => { throw new Error(`no call expected: ${op(c)}`); };
  assert.equal((await run(none, input({ ...single, type: 'story' }, null))).result.kind, 'fail');
  assert.match((await run(none, input({ ...single, media: [] }, null))).result.kind, /fail/);
  const five = { ...single, type: 'carousel' as const, media: [1, 2, 3, 4, 5].map(img) };
  const x = await run(none, input(five, null, { platform: 'x' }));
  assert.deepEqual(x.result, { kind: 'fail', reason: 'carousel_count: X takes up to 4 images' });
  const li = await run((c) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'b' } } }) : undefined, input(five, null));
  assert.equal(li.result.kind, 'pending', 'LinkedIn takes more');
});

test('a lost lease stops before the create call', async () => {
  const { result, calls } = await run(() => undefined, input(single, null, { lease: false }));
  assert.equal(calls.length, 0);
  assert.equal(result.kind, 'retry');
});

test('create refusals that prove nothing was created: Buffer\'s message, the attempt cleared', async () => {
  const answer = (r: Response) => () => r;
  const invalid = await run(answer(gql({ createPost: { __typename: 'InvalidInputError', message: 'Text too long' } })), input(single, null));
  assert.deepEqual(invalid.result, { kind: 'fail', reason: 'buffer_refused: Text too long', clearContainer: true });
  const limit = await run(answer(gql({ createPost: { __typename: 'LimitReachedError', message: 'Queue limit' } })), input(single, null));
  assert.deepEqual(limit.result, { kind: 'fail', reason: 'limit: Queue limit', clearContainer: true });
  const auth = await run(answer(Response.json({ data: null, errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] })), input(single, null));
  assert.deepEqual(auth.result, { kind: 'auth', reason: 'auth: Not authorized' });
  const forbidden = await run(answer(Response.json({ data: null, errors: [{ message: 'No', extensions: { code: 'FORBIDDEN' } }] })), input(single, null));
  assert.equal(forbidden.result.kind, 'auth');
  const rate = await run(answer(Response.json({ errors: [{ message: 'Too many', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }, { status: 429 })), input(single, null));
  assert.deepEqual(rate.result, { kind: 'retry', reason: 'rate_limited: Too many', clearContainer: true });
  const bad = await run(answer(Response.json({ errors: [{ message: 'Cannot query field' }] }, { status: 400 })), input(single, null));
  assert.deepEqual(bad.result, { kind: 'fail', reason: 'unknown: Cannot query field', clearContainer: true });
  const validation = await run(answer(Response.json({ errors: [{ message: 'Unknown type', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] })), input(single, null));
  assert.deepEqual(validation.result, { kind: 'fail', reason: 'unknown: Unknown type', clearContainer: true }, 'refused before it ran, even on a 200');
});

test('create answers that may hide a post keep the attempt for the recovery read', async () => {
  const kept = (r: { result: unknown }) => {
    assert.equal((r.result as { kind: string }).kind, 'retry');
    assert.equal((r.result as { clearContainer?: boolean }).clearContainer, undefined, 'the attempt stays');
  };
  kept(await run(() => new Response('bad gateway', { status: 502 }), input(single, null)));
  kept(await run(() => Response.json({ data: null, errors: [{ message: 'Internal error' }] }), input(single, null)));
  kept(await run(() => new Response('<html>not json</html>', { status: 200 }), input(single, null)));
  kept(await run(() => gql({}), input(single, null)));
  const s = stubHttp(HOSTS, () => { throw new TypeError('timed out'); });
  try { kept({ result: await bufferPublishStep(input(single, null)) }); } finally { s.restore(); }
});

test('a post id is followed even when errors came with it', async () => {
  const { result } = await run(() => Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'bp7' } } }, errors: [{ message: 'partial' }] }), input(single, null));
  assert.equal(decoded(result).postId, 'bp7');
});

test('every Buffer call carries a timeout', async () => {
  let signal: AbortSignal | undefined;
  const before = globalThis.fetch;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { signal = init?.signal ?? undefined; return gql({ account: {} }); }) as typeof fetch;
  try { await bufferGraphql('k', 'query Q { account { id } }'); } finally { globalThis.fetch = before; }
  assert.ok(signal instanceof AbortSignal);
});

test('recovery: the post found in the channel list is followed; not found waits ten minutes, then the attempt is cleared', async () => {
  const st = state({ attempt: NOW - 30, first: NOW - 3600 });
  const at = (t: number) => new Date(t * 1000).toISOString();
  const list = (nodes: unknown[]) => (c: HttpCall) => op(c) === 'Recent' ? gql({ posts: { edges: nodes.map((node) => ({ node })) } }) : undefined;
  const found = await run(list([
    { id: 'older', text: single.caption, createdAt: at(NOW - 2 * 3600) },
    { id: 'undated', text: single.caption },
    { id: 'mine', text: `${single.caption}  `, createdAt: at(NOW - 3000) },
  ]), input(single, st));
  assert.equal(found.result.kind, 'pending');
  assert.equal(decoded(found.result).postId, 'mine', 'created after the first attempt, with a date');
  assert.equal(decoded(found.result).first, NOW - 3600);
  assert.deepEqual((found.result as { notes?: string[] }).notes, ['recovered_created']);
  assert.match(String((found.calls[0].body as { query: string }).query), /organizationId: "org1"/);
  assert.match(String((found.calls[0].body as { query: string }).query), /channelIds: \["chan1"\]/);

  const early = await run(list([]), input(single, st));
  assert.deepEqual(early.result, { kind: 'pending', containerId: st });
  const stillEarly = await run(list([]), input(single, st, { now: NOW - 30 + RECOVERY_SETTLE_SECONDS - 1 }));
  assert.deepEqual(stillEarly.result, { kind: 'pending', containerId: st });
  const late = await run(list([]), input(single, st, { now: NOW + 600 }));
  assert.deepEqual(decoded(late.result), { buf: 1, attempt: null, first: NOW - 3600, postId: null, next: 0, polls: 0 }, 'the first attempt is kept');

  const unreadable = await run(() => new Response('', { status: 503 }), input(single, st));
  assert.equal(unreadable.result.kind, 'retry', 'a failed read never clears the attempt');
  assert.equal((unreadable.result as { clearContainer?: boolean }).clearContainer, undefined);
});

test('a create sent again after a clear keeps the first attempt time', async () => {
  const cps: string[] = [];
  const cleared = state({ first: NOW - 1800 });
  const { result } = await run((c) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'b2' } } }) : undefined, input(single, cleared, { checkpoints: cps }));
  assert.deepEqual([JSON.parse(cps[0]).attempt, JSON.parse(cps[0]).first], [NOW, NOW - 1800]);
  assert.equal(decoded(result).first, NOW - 1800);
});

test('posts are compared by their text up to the first link', () => {
  assert.equal(comparableText('Kayıt açık:  https://rsg.org/a?x=1 son gün'), 'Kayıt açık:');
  assert.equal(comparableText('Kayıt açık: https://buff.ly/xyz'), comparableText('Kayıt açık:\nhttps://rsg-turkiye.iscbsc.org/events/'));
  assert.equal(comparableText('https://only.link/x'), 'https://only.link/x', 'a text that is only a link is compared whole');
});

test('a duplicate answer looks the post up from the first attempt: found means ours went out, not found fails for a person to edit', async () => {
  const dup = (nodes: unknown[], typename = 'DuplicateError', message = 'Duplicate post') => (c: HttpCall) => op(c) === 'CreatePost'
    ? gql({ createPost: { __typename: typename, message } })
    : op(c) === 'Recent' ? gql({ posts: { edges: nodes.map((node) => ({ node })) } }) : undefined;
  const at = (t: number) => new Date(t * 1000).toISOString();
  const cleared = state({ first: NOW - 5 * 3600 });
  const ours = await run(dup([{ id: 'b9', text: single.caption, createdAt: at(NOW - 4 * 3600) }]), input(single, cleared));
  assert.equal(decoded(ours.result).postId, 'b9', 'found back to the first attempt, five hours ago');
  assert.deepEqual((ours.result as { notes?: string[] }).notes, ['recovered_duplicate']);
  const before = await run(dup([{ id: 'old', text: single.caption, createdAt: at(NOW - 6 * 3600) }]), input(single, cleared));
  assert.deepEqual(before.result, { kind: 'fail', reason: 'duplicate: Duplicate post', clearContainer: true }, 'a copy from before our first attempt is not ours');
  const undated = await run(dup([{ id: 'u', text: single.caption }]), input(single, null));
  assert.equal(undated.result.kind, 'fail', 'a post without createdAt is never taken as ours');
  const byMessage = await run(dup([], 'InvalidInputError', 'Duplicate content detected'), input(single, null));
  assert.deepEqual(byMessage.result, { kind: 'fail', reason: 'duplicate: Duplicate content detected', clearContainer: true });
});

test('status reads wait for their turn, back off, and end sent (with the link), refused, or gone', async () => {
  const none = (c: HttpCall): Response | undefined => { throw new Error(`no call expected: ${op(c)}`); };
  const waiting = state({ postId: 'bp1', next: NOW + 30 });
  assert.deepEqual((await run(none, input(single, waiting))).result, { kind: 'pending', containerId: waiting });

  const post = (p: unknown) => (c: HttpCall) => op(c) === 'Post' ? gql({ post: p }) : undefined;
  const due = state({ postId: 'bp1', next: NOW - 1, polls: 1 });
  const sending = await run(post({ id: 'bp1', status: 'sending', sentAt: null, externalLink: null, error: null }), input(single, due));
  assert.deepEqual(decoded(sending.result), { buf: 1, attempt: null, first: null, postId: 'bp1', next: NOW + POLL_BACKOFF[2], polls: 2 });
  const maxed = await run(post({ id: 'bp1', status: 'sending' }), input(single, state({ postId: 'bp1', polls: 9 })));
  assert.equal(decoded(maxed.result).next, NOW + 1800, 'every 30 minutes at most');
  // About six reads fit in the two-hour window.
  let t = 0; let reads = 0;
  for (let i = 0; t < 7200; i++) { t += POLL_BACKOFF[Math.min(i, POLL_BACKOFF.length - 1)]; if (t < 7200) reads++; }
  assert.ok(reads >= 5 && reads <= 7, `${reads} reads`);

  const sent = await run(post({ id: 'bp1', status: 'sent', sentAt: '2027-01-01T00:00:00Z', externalLink: 'https://www.linkedin.com/feed/update/urn:li:share:1/', error: null }), input(single, due));
  assert.deepEqual(sent.result, { kind: 'done', remoteId: 'bp1', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:1/' });
  const noLink = await run(post({ id: 'bp1', status: 'sent', sentAt: '2027-01-01T00:00:00Z' }), input(single, due));
  assert.deepEqual(noLink.result, { kind: 'done', remoteId: 'bp1', permalink: null, notes: ['no_link'] });
  const refused = await run(post({ id: 'bp1', status: 'error', error: { message: 'LinkedIn rejected the image' } }), input(single, due));
  assert.deepEqual(refused.result, { kind: 'fail', reason: 'buffer_refused: LinkedIn rejected the image', clearContainer: true });
  const gone = await run(post(null), input(single, due));
  assert.equal(gone.result.kind, 'fail');
  const auth = await run(() => Response.json({ errors: [{ message: 'expired', extensions: { code: 'UNAUTHORIZED' } }] }, { status: 401 }), input(single, due));
  assert.equal(auth.result.kind, 'auth');
  const slow = await run(() => new Response('', { status: 500 }), input(single, due));
  assert.deepEqual(slow.result, { kind: 'retry', reason: 'unavailable: HTTP 500' });
});

test('under 10% of a rate window left, no new post is created', async () => {
  const low = await run(() => gql({ account: { id: 'a' } }, { headers: { RateLimit: '"250-in-1day"; r=10; t=100' } }), input(single, null));
  // The first call reads the header only after creating; the memory then holds the low share for the next create.
  assert.equal(low.result.kind, 'retry', 'an answer without createPost proves nothing');
  const next = await run(() => { throw new Error('no call expected'); }, input(single, null));
  assert.deepEqual(next.result, { kind: 'retry', reason: 'rate_limited: rate_low, under 10% of the Buffer request quota left' });
  const later = await run((c) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'x' } } }) : undefined, input(single, null, { now: NOW + 3600 }));
  assert.equal(later.result.kind, 'pending', 'an old reading is not trusted');
});

test('the client never throws: no answer is status 0, and the key stays out of the message', async () => {
  const s = stubHttp(HOSTS, () => { throw new TypeError('network down'); });
  try {
    const r = await bufferGraphql('secret-key', 'query Q { account { id } }');
    assert.deepEqual(r, { ok: false, status: 0, code: null, message: 'no answer from Buffer' });
  } finally { s.restore(); }
});

test('which channel fits: a LinkedIn Page (never a profile); X as twitter or x', () => {
  const ch = (service: string, type: string): BufferChannel => ({ id: 'c', name: 'n', service, type, organizationId: 'o', isDisconnected: false, isLocked: false });
  assert.equal(channelFits('linkedin', ch('linkedin', 'page')), true);
  assert.equal(channelFits('linkedin', ch('linkedin', 'profile')), false);
  assert.equal(channelFits('linkedin', ch('instagram', 'business')), false);
  assert.equal(channelFits('x', ch('twitter', 'profile')), true);
  assert.equal(channelFits('x', ch('x', 'profile')), true);
});

test('the registry picks Buffer only for a Buffer connection; the direct adapters stay the default', () => {
  assert.equal(publisherFor('linkedin', 'buffer'), bufferPublishStep);
  assert.equal(publisherFor('x', 'buffer'), bufferPublishStep);
  assert.equal(publisherFor('linkedin'), linkedinPublishStep);
  assert.equal(publisherFor('x'), xPublishStep);
  assert.equal(publisherFor('instagram', 'buffer'), bufferPublishStep);
  assert.notEqual(publisherFor('instagram'), bufferPublishStep);
});

test('switching adapters mid-flight: an idle state is dropped, a started one fails honestly', async () => {
  assert.equal(foreignState(JSON.stringify({ li: 1, images: ['i'], attempt: null }), 'buf'), 'idle');
  assert.equal(foreignState(JSON.stringify({ x: 1, media: [], attempt: 5 }), 'buf'), 'started');
  assert.equal(foreignState(JSON.stringify({ buf: 1, attempt: null, postId: 'p' }), 'x'), 'started');
  assert.equal(foreignState(JSON.stringify({ buf: 1, attempt: null, postId: null }), 'li'), 'idle');
  assert.equal(foreignState(JSON.stringify({ buf: 1 }), 'buf'), null, 'its own state');
  assert.equal(foreignState('17890000', 'buf'), null, 'not JSON');

  const create = (c: HttpCall) => op(c) === 'CreatePost' ? gql({ createPost: { __typename: 'PostActionSuccess', post: { id: 'b1' } } }) : undefined;
  const idle = await run(create, input(single, JSON.stringify({ li: 1, images: ['urn:li:image:1'], attempt: null })));
  assert.equal(decoded(idle.result).postId, 'b1');
  const started = await run(() => undefined, input(single, JSON.stringify({ x: 1, media: ['m'], attempt: NOW - 60 }), { platform: 'x' }));
  assert.deepEqual(started.result, { kind: 'fail', reason: 'uncertain: a direct create may already have gone out before switching to Buffer; check the account, then retry', clearContainer: true });
  assert.equal(started.calls.length, 0);
});

test('switching back from Buffer: the direct adapters drop an idle Buffer state and refuse a started one', async () => {
  const base = { account: { id: 'acct', name: 'rsgturkey' }, token: 't', post: { ...single, media: [{ ...img(1), load: async () => new Uint8Array([1]) }] }, now: NOW, checkpoint: async () => true };
  const started = JSON.stringify({ buf: 1, attempt: null, first: NOW - 60, postId: 'bp1', next: NOW, polls: 0 });
  for (const step of [xPublishStep, linkedinPublishStep]) {
    const r = await step({ ...base, state: { containerId: started } });
    assert.deepEqual(r, { kind: 'fail', reason: 'uncertain: a Buffer post may already have gone out before switching back; check the account, then retry', clearContainer: true });
  }
  const s = stubHttp(['api.x.com'], (c) => c.url.pathname === '/2/media/upload' ? Response.json({ data: { id: 'm1' } }) : c.url.pathname === '/2/media/metadata' ? Response.json({}) : undefined);
  try {
    const r = await xPublishStep({ ...base, state: { containerId: JSON.stringify({ buf: 1, attempt: null, first: null, postId: null, next: 0, polls: 0 }) } });
    assert.equal(r.kind, 'pending', 'starts afresh with an upload');
  } finally { s.restore(); }
});
