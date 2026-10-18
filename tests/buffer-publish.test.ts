import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import {
  bufferPublishStep, bufferGraphql, parseRateLimit, lowestShare, decodeBufferState, resetRateMemory, channelFits, POLL_BACKOFF, type BufferChannel,
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
const state = (s: { attempt?: number | null; postId?: string | null; next?: number; polls?: number }) =>
  JSON.stringify({ buf: 1, attempt: s.attempt ?? null, postId: s.postId ?? null, next: s.next ?? 0, polls: s.polls ?? 0 });

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
  assert.deepEqual(decodeBufferState(state({ attempt: 5, postId: 'p', next: 9, polls: 2 })), { buf: 1, attempt: 5, postId: 'p', next: 9, polls: 2 });
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
  assert.deepEqual(JSON.parse((result as { containerId: string }).containerId), { buf: 1, attempt: null, postId: 'bp1', next: NOW + POLL_BACKOFF[0], polls: 0 });
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

test('create refusals: invalid input and limits fail with Buffer\'s message; auth waits; 429 retries with the attempt cleared', async () => {
  const answer = (r: Response) => () => r;
  const invalid = await run(answer(gql({ createPost: { __typename: 'InvalidInputError', message: 'Text too long' } })), input(single, null));
  assert.deepEqual(invalid.result, { kind: 'fail', reason: 'buffer_refused: Text too long', clearContainer: true });
  const limit = await run(answer(gql({ createPost: { __typename: 'LimitReachedError', message: 'Queue limit' } })), input(single, null));
  assert.deepEqual(limit.result, { kind: 'fail', reason: 'limit: Queue limit', clearContainer: true });
  const auth = await run(answer(Response.json({ data: null, errors: [{ message: 'Not authorized', extensions: { code: 'UNAUTHORIZED' } }] })), input(single, null));
  assert.deepEqual(auth.result, { kind: 'auth', reason: 'auth: Not authorized' });
  const rate = await run(answer(Response.json({ errors: [{ message: 'Too many', extensions: { code: 'RATE_LIMIT_EXCEEDED' } }] }, { status: 429 })), input(single, null));
  assert.deepEqual(rate.result, { kind: 'retry', reason: 'rate_limited: Too many', clearContainer: true });
  const query = await run(answer(Response.json({ errors: [{ message: 'Cannot query field' }] }, { status: 400 })), input(single, null));
  assert.deepEqual(query.result, { kind: 'fail', reason: 'unknown: Cannot query field', clearContainer: true });
});

test('a create with no answer keeps the attempt: the next tick looks before it creates again', async () => {
  const down = await run(() => new Response('bad gateway', { status: 502 }), input(single, null));
  assert.equal(down.result.kind, 'retry');
  assert.equal((down.result as { clearContainer?: boolean }).clearContainer, undefined, 'the attempt stays');
});

test('recovery: the post found in the channel list is followed; not found waits, then the attempt is cleared', async () => {
  const st = state({ attempt: NOW - 30 });
  const list = (nodes: unknown[]) => (c: HttpCall) => op(c) === 'Recent' ? gql({ posts: { edges: nodes.map((node) => ({ node })) } }) : undefined;
  const found = await run(list([
    { id: 'old', text: single.caption, createdAt: new Date((NOW - 86400) * 1000).toISOString() },
    { id: 'mine', text: `${single.caption} `, createdAt: new Date((NOW - 20) * 1000).toISOString() },
  ]), input(single, st));
  assert.equal(found.result.kind, 'pending');
  assert.equal(JSON.parse((found.result as { containerId: string }).containerId).postId, 'mine');
  assert.deepEqual((found.result as { notes?: string[] }).notes, ['recovered_created']);
  assert.match(String((found.calls[0].body as { query: string }).query), /organizationId: "org1"/);
  assert.match(String((found.calls[0].body as { query: string }).query), /channelIds: \["chan1"\]/);

  const early = await run(list([]), input(single, st));
  assert.deepEqual(early.result, { kind: 'pending', containerId: st });
  const late = await run(list([]), input(single, st, { now: NOW + 600 }));
  assert.deepEqual(JSON.parse((late.result as { containerId: string }).containerId), { buf: 1, attempt: null, postId: null, next: 0, polls: 0 });

  const unreadable = await run(() => new Response('', { status: 503 }), input(single, st));
  assert.equal(unreadable.result.kind, 'retry', 'a failed read never clears the attempt');
  assert.equal((unreadable.result as { clearContainer?: boolean }).clearContainer, undefined);
});

test('a duplicate answer looks the post up: found means ours went out, not found fails for a person to edit', async () => {
  const dup = (nodes: unknown[]) => (c: HttpCall) => op(c) === 'CreatePost'
    ? gql({ createPost: { __typename: 'DuplicateError', message: 'Duplicate post' } })
    : op(c) === 'Recent' ? gql({ posts: { edges: nodes.map((node) => ({ node })) } }) : undefined;
  const ours = await run(dup([{ id: 'b9', text: single.caption, createdAt: new Date((NOW - 60) * 1000).toISOString() }]), input(single, null));
  assert.equal(JSON.parse((ours.result as { containerId: string }).containerId).postId, 'b9');
  assert.deepEqual((ours.result as { notes?: string[] }).notes, ['recovered_duplicate']);
  const gone = await run(dup([]), input(single, null));
  assert.deepEqual(gone.result, { kind: 'fail', reason: 'duplicate: Duplicate post', clearContainer: true });
});

test('status reads wait for their turn, back off, and end sent (with the link), refused, or gone', async () => {
  const none = (c: HttpCall): Response | undefined => { throw new Error(`no call expected: ${op(c)}`); };
  const waiting = state({ postId: 'bp1', next: NOW + 30 });
  assert.deepEqual((await run(none, input(single, waiting))).result, { kind: 'pending', containerId: waiting });

  const post = (p: unknown) => (c: HttpCall) => op(c) === 'Post' ? gql({ post: p }) : undefined;
  const due = state({ postId: 'bp1', next: NOW - 1, polls: 1 });
  const sending = await run(post({ id: 'bp1', status: 'sending', sentAt: null, externalLink: null, error: null }), input(single, due));
  assert.deepEqual(JSON.parse((sending.result as { containerId: string }).containerId), { buf: 1, attempt: null, postId: 'bp1', next: NOW + POLL_BACKOFF[2], polls: 2 });
  const maxed = await run(post({ id: 'bp1', status: 'sending' }), input(single, state({ postId: 'bp1', polls: 9 })));
  assert.equal(JSON.parse((maxed.result as { containerId: string }).containerId).next, NOW + POLL_BACKOFF[POLL_BACKOFF.length - 1]);

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
  assert.equal(low.result.kind, 'fail');
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

test('the registry picks Buffer only for a Buffer connection, and never for Instagram', () => {
  assert.equal(publisherFor('linkedin', 'buffer'), bufferPublishStep);
  assert.equal(publisherFor('x', 'buffer'), bufferPublishStep);
  assert.equal(publisherFor('linkedin'), linkedinPublishStep);
  assert.equal(publisherFor('x'), xPublishStep);
  assert.notEqual(publisherFor('instagram', 'buffer'), bufferPublishStep);
});
