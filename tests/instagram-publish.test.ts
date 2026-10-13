import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubGraph, type GraphCall } from './lib/instagram';
import { instagramPublishStep } from '../functions/_lib/social/instagram';
import type { PostForPlatform } from '../functions/_lib/social/types';

const IG = '17841400000000000';
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://rsg-turkiye.iscbsc.org/api/images/k${n}.jpg`, alt: `Alt ${n}` });
const single: PostForPlatform = { type: 'image', caption: 'Merhaba\n\n🔗 Link profilde', media: [img(1)] };
const err = (code: number, sub?: number, message = 'x', status = 400) => Response.json({ error: { code, error_subcode: sub, message } }, { status });
const step = (post: PostForPlatform, containerId: string | null = null) => instagramPublishStep({ igUserId: IG, token: 'tok', post, state: { containerId } });

async function withGraph<T>(h: (c: GraphCall) => Response | undefined, run: () => Promise<T>) {
  const g = stubGraph(h);
  try { return { result: await run(), calls: g.calls }; } finally { g.restore(); }
}

test('first tick creates a single-image container with caption and alt text, and waits', async () => {
  const { result, calls } = await withGraph((c) => (c.method === 'POST' && c.path === `/${IG}/media` ? Response.json({ id: 'c1' }) : undefined), () => step(single));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1', notes: [] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params.get('image_url'), single.media[0].url);
  assert.equal(calls[0].params.get('caption'), single.caption);
  assert.equal(calls[0].params.get('alt_text'), 'Alt 1');
  assert.equal(calls[0].params.get('access_token'), 'tok');
});

test('alt text refused by the API: the container is made without it, and the gap is noted', async () => {
  let n = 0;
  const { result, calls } = await withGraph((c) => {
    if (c.path !== `/${IG}/media`) return undefined;
    return n++ === 0 ? err(100, undefined, 'Invalid parameter alt_text') : Response.json({ id: 'c1' });
  }, () => step(single));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1', notes: ['alt_text_dropped'] });
  assert.equal(calls[1].params.has('alt_text'), false);
});

test('a carousel makes one child per image, then the parent with the caption', async () => {
  const post: PostForPlatform = { type: 'carousel', caption: 'Üç görsel', media: [img(1), img(2), img(3)] };
  let child = 0;
  const { result, calls } = await withGraph((c) => {
    if (c.path !== `/${IG}/media`) return undefined;
    return c.params.get('media_type') === 'CAROUSEL' ? Response.json({ id: 'parent' }) : Response.json({ id: `child${++child}` });
  }, () => step(post));
  assert.deepEqual(result, { kind: 'pending', containerId: 'parent', notes: [] });
  assert.deepEqual(calls.slice(0, 3).map((c) => [c.params.get('is_carousel_item'), c.params.get('alt_text'), c.params.has('caption')]), [['true', 'Alt 1', false], ['true', 'Alt 2', false], ['true', 'Alt 3', false]]);
  assert.equal(calls[3].params.get('children'), 'child1,child2,child3');
  assert.equal(calls[3].params.get('caption'), 'Üç görsel');
});

test('a story is media_type STORIES with no caption or alt text', async () => {
  const post: PostForPlatform = { type: 'story', caption: 'ignored', media: [img(1)] };
  const { result, calls } = await withGraph((c) => (c.path === `/${IG}/media` ? Response.json({ id: 's1' }) : undefined), () => step(post));
  assert.equal(result.kind, 'pending');
  assert.equal(calls[0].params.get('media_type'), 'STORIES');
  assert.equal(calls[0].params.has('caption'), false);
  assert.equal(calls[0].params.has('alt_text'), false);
});

test('a container still processing is polled again later; a finished one is published and its link read', async () => {
  const waiting = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'IN_PROGRESS' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(waiting.result, { kind: 'pending', containerId: 'c1' });
  const done = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.method === 'POST' && c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return Response.json({ permalink: 'https://www.instagram.com/p/abc/', id: 'm1' });
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(done.result, { kind: 'done', remoteId: 'm1', permalink: 'https://www.instagram.com/p/abc/' });
  assert.equal(done.calls.find((c) => c.path === `/${IG}/media_publish`)!.params.get('creation_id'), 'c1');
});

test('a container already PUBLISHED (crash after publishing) is recorded, never published again', async () => {
  const { result, calls } = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'PUBLISHED' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_published_container'] });
  assert.equal(calls.some((c) => c.path.endsWith('/media_publish')), false);
});

test('an expired container is recreated; an errored one fails with its status', async () => {
  const expired = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'EXPIRED' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(expired.result, { kind: 'retry', reason: 'expired: container expired', clearContainer: true });
  const broken = await withGraph((c) => (c.path === '/c1' ? Response.json({ status_code: 'ERROR', status: 'Error: unsupported' }) : undefined), () => step(single, 'c1'));
  assert.deepEqual(broken.result, { kind: 'fail', reason: 'container_error: Error: unsupported' });
});

test('publish says "not ready yet": keep polling the same container', async () => {
  const { result } = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.path === `/${IG}/media_publish`) return err(9007, 2207027, 'Media ID is not available');
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'pending', containerId: 'c1' });
});

test('a missing permalink does not fail a publish', async () => {
  const { result } = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.path === `/${IG}/media_publish`) return Response.json({ id: 'm1' });
    if (c.path === '/m1') return err(100, undefined, 'no permalink');
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(result, { kind: 'done', remoteId: 'm1', permalink: null });
});

test('errors become steps: expired token, ratio, 5xx, network', async () => {
  const cases: [Response | 'throw', string][] = [[err(190, 463, 'expired'), 'auth'], [err(36003, 2207009, 'ratio'), 'fail'], [new Response('', { status: 503 }), 'retry'], ['throw', 'retry']];
  for (const [res, kind] of cases) {
    const g = stubGraph(() => { if (res === 'throw') throw new TypeError('network'); return res; });
    try { assert.equal((await step(single)).kind, kind, String(kind)); } finally { g.restore(); }
  }
});

test('FINISHED then publish fails with an expired-class error or a lost response: retry, container kept', async () => {
  const fin = (c: GraphCall) => (c.path === '/c1' ? Response.json({ status_code: 'FINISHED' }) : undefined);
  const expired = await withGraph((c) => fin(c) ?? (c.path === `/${IG}/media_publish` ? err(24, 2207008, 'expired') : undefined), () => step(single, 'c1'));
  assert.equal(expired.result.kind, 'retry');
  assert.equal('clearContainer' in expired.result, false);
  const g = stubGraph((c) => { if (c.path === `/${IG}/media_publish`) throw new TypeError('lost'); return fin(c); });
  try {
    const lost = await step(single, 'c1');
    assert.equal(lost.kind, 'retry');
    assert.equal('clearContainer' in lost, false);
  } finally { g.restore(); }
});

test('a 2xx without usable JSON or without an id is transient and never yields "undefined"', async () => {
  const oops = await withGraph((c) => (c.path === '/c1' ? new Response('oops', { status: 200 }) : undefined), () => step(single, 'c1'));
  assert.equal(oops.result.kind, 'retry');
  const pub = await withGraph((c) => {
    if (c.path === '/c1') return Response.json({ status_code: 'FINISHED' });
    if (c.path === `/${IG}/media_publish`) return Response.json({});
    return undefined;
  }, () => step(single, 'c1'));
  assert.deepEqual(pub.result, { kind: 'retry', reason: 'unavailable: response without id' });
  const create = await withGraph((c) => (c.path === `/${IG}/media` ? Response.json({}) : undefined), () => step(single));
  assert.deepEqual(create.result, { kind: 'retry', reason: 'unavailable: response without id' });
});

test('carousel: once alt_text is refused, later children skip it, and the note appears once', async () => {
  const post: PostForPlatform = { type: 'carousel', caption: 'c', media: [img(1), img(2), img(3)] };
  let n = 0;
  const { result, calls } = await withGraph((c) => {
    if (c.path !== `/${IG}/media`) return undefined;
    if (c.params.get('media_type') === 'CAROUSEL') return Response.json({ id: 'parent' });
    if (n++ === 0) return err(100, undefined, 'Invalid parameter alt_text');
    return Response.json({ id: `child${n}` });
  }, () => step(post));
  assert.deepEqual(result, { kind: 'pending', containerId: 'parent', notes: ['alt_text_dropped'] });
  assert.equal(calls.filter((c) => c.params.has('is_carousel_item')).length, 4);
  assert.equal(calls.slice(1, 4).some((c) => c.params.has('alt_text')), false);
});
