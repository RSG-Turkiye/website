import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import { linkedinPublishStep, toLittleText, findAdminOrganization, LI_VERSION } from '../functions/_lib/social/linkedin';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const HOSTS = ['api.linkedin.com', 'www.linkedin.com', 'upload.example.org'];
const ORG = '424242';
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://rsg-turkiye.iscbsc.org/api/images/k${n}.jpg`, alt: `Alt ${n}`, load: async () => bytes });
const single: PostForPlatform = { type: 'image', caption: 'Kayıt açık (son gün 1 Kasım) #bioinformatics', media: [img(1)] };
const multi: PostForPlatform = { type: 'carousel', caption: 'İki görsel', media: [img(1), img(2)] };

function input(post: PostForPlatform, containerId: string | null, checkpoints: string[] = []): PublishInput {
  return {
    account: { id: ORG, name: 'RSG' }, token: 'li-tok', post, state: { containerId }, now: 1_800_000_000,
    checkpoint: async (c) => { checkpoints.push(c); return true; },
  };
}
const state = (images: string[], attempt: number | null) => JSON.stringify({ li: 1, images, attempt });

async function run(h: (c: HttpCall) => Response | undefined, i: PublishInput) {
  const s = stubHttp(HOSTS, h);
  try { return { result: await linkedinPublishStep(i), calls: s.calls }; } finally { s.restore(); }
}

const uploads = (c: HttpCall) => {
  if (c.method === 'POST' && c.url.pathname === '/rest/images' && c.url.searchParams.get('action') === 'initializeUpload') {
    const n = Math.floor(Math.random() * 1e9);
    return Response.json({ value: { uploadUrl: `https://upload.example.org/u/${n}`, image: `urn:li:image:I${n}` } });
  }
  if (c.method === 'PUT' && c.url.host === 'upload.example.org') return new Response(null, { status: 201 });
  return undefined;
};

test('little text: reserved characters are escaped, real hashtags stay hashtags, a # inside a link does not', () => {
  assert.equal(toLittleText('Kayıt (son gün) @rsg *önemli* a_b ~x~ [1] <a> {b} | \\'),
    'Kayıt \\(son gün\\) \\@rsg \\*önemli\\* a\\_b \\~x\\~ \\[1\\] \\<a\\> \\{b\\} \\| \\\\');
  assert.equal(toLittleText('#biyoinformatik ve #bio_info'), '{hashtag|\\#|biyoinformatik} ve {hashtag|\\#|bio\\_info}');
  assert.equal(toLittleText('https://x.org/a_b#bölüm'), 'https://x.org/a\\_b\\#bölüm');
});

test('first tick uploads each image to LinkedIn as the organisation and waits', async () => {
  const { result, calls } = await run(uploads, input(multi, null));
  assert.equal(result.kind, 'pending');
  const st = JSON.parse((result as { containerId: string }).containerId);
  assert.equal(st.li, 1);
  assert.equal(st.attempt, null);
  assert.equal(st.images.length, 2);
  const inits = calls.filter((c) => c.method === 'POST');
  assert.equal(inits.length, 2);
  assert.deepEqual(inits[0].body, { initializeUploadRequest: { owner: `urn:li:organization:${ORG}` } });
  assert.equal(inits[0].headers.get('Linkedin-Version'), LI_VERSION);
  assert.equal(inits[0].headers.get('X-Restli-Protocol-Version'), '2.0.0');
  assert.equal(inits[0].headers.get('Authorization'), 'Bearer li-tok');
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].headers.get('Authorization'), 'Bearer li-tok');
});

test('an image still processing waits; once available the post is checkpointed, then created with alt text', async () => {
  const st = state(['urn:li:image:A'], null);
  let available = false;
  const handler = (c: HttpCall) => {
    if (c.method === 'GET' && c.url.pathname === '/rest/images') return Response.json({ results: { 'urn:li:image:A': { status: available ? 'AVAILABLE' : 'PROCESSING' } } });
    if (c.method === 'POST' && c.url.pathname === '/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });
    return undefined;
  };
  const first = await run(handler, input(single, st));
  assert.deepEqual(first.result, { kind: 'pending', containerId: st });
  available = true;
  const cps: string[] = [];
  const second = await run(handler, input(single, st, cps));
  assert.deepEqual(second.result, { kind: 'done', remoteId: 'urn:li:share:99', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:99/' });
  assert.equal(JSON.parse(cps[0]).attempt, 1_800_000_000, 'the attempt is recorded before the create call');
  const created = second.calls.find((c) => c.url.pathname === '/rest/posts')!;
  assert.deepEqual(created.body, {
    author: `urn:li:organization:${ORG}`,
    commentary: 'Kayıt açık \\(son gün 1 Kasım\\) {hashtag|\\#|bioinformatics}',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: 'urn:li:image:A', altText: 'Alt 1' } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
});

test('several images go out as a multiImage post, each with its alt text', async () => {
  const st = state(['urn:li:image:A', 'urn:li:image:B'], null);
  const { result, calls } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' }, 'urn:li:image:B': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
    return undefined;
  }, input(multi, st));
  assert.equal(result.kind, 'done');
  const body = calls.find((c) => c.url.pathname === '/rest/posts')!.body as { content: unknown };
  assert.deepEqual(body.content, { multiImage: { images: [{ id: 'urn:li:image:A', altText: 'Alt 1' }, { id: 'urn:li:image:B', altText: 'Alt 2' }] } });
});

test('a lost response after the create call: the next tick finds the post by its image and records it, without posting again', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  const { result, calls } = await run((c) => {
    if (c.method === 'GET' && c.url.pathname === '/rest/posts') {
      assert.equal(c.url.searchParams.get('q'), 'author');
      assert.equal(c.url.searchParams.get('author'), `urn:li:organization:${ORG}`);
      return Response.json({ elements: [{ id: 'urn:li:share:5', content: { media: { id: 'urn:li:image:OTHER' } } }, { id: 'urn:li:share:6', content: { media: { id: 'urn:li:image:A' } } }] });
    }
    return undefined;
  }, input(single, st));
  assert.deepEqual(result, { kind: 'done', remoteId: 'urn:li:share:6', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:6/', notes: ['recovered_published'] });
  assert.equal(calls.some((c) => c.method === 'POST'), false);
});

test('a lost response, and the post is not there: the attempt is cleared so the next tick creates it', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  const late = input(single, st);
  late.now = 1_800_000_000 + 120;
  const { result } = await run((c) => (c.method === 'GET' && c.url.pathname === '/rest/posts' ? Response.json({ elements: [] }) : undefined), late);
  assert.deepEqual(result, { kind: 'pending', containerId: state(['urn:li:image:A'], null) });
});

test('a miss within the settle window keeps the attempt', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  const early = input(single, st);
  early.now = 1_800_000_000 + 119;
  const { result } = await run((c) => (c.method === 'GET' && c.url.pathname === '/rest/posts' ? Response.json({ elements: [] }) : undefined), early);
  assert.deepEqual(result, { kind: 'pending', containerId: st });
});

test('a failed or odd finder read never clears the attempt: retried as uncertain', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  for (const res of [() => Response.json({ message: 'bad finder' }, { status: 400 }), () => Response.json({ paging: {} })]) {
    const { result } = await run((c) => (c.method === 'GET' && c.url.pathname === '/rest/posts' ? res() : undefined), input(single, st));
    assert.equal(result.kind, 'retry');
    assert.match((result as { reason: string }).reason, /^uncertain: /);
    assert.equal('clearContainer' in result, false);
  }
});

test('a 2xx other than 201 on the create call is uncertain, not a failure', async () => {
  const st = state(['urn:li:image:A'], null);
  const { result } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return new Response(null, { status: 202 });
    return undefined;
  }, input(single, st));
  assert.deepEqual(result, { kind: 'retry', reason: 'uncertain: unexpected 202 from LinkedIn' });
});

test('a 503 on the create call is retried as unavailable, never cleared (the attempt stays recorded)', async () => {
  const st = state(['urn:li:image:A'], null);
  const { result } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return new Response('upstream', { status: 503 });
    return undefined;
  }, input(single, st));
  assert.equal(result.kind, 'retry');
  assert.match((result as { reason: string }).reason, /^unavailable: /);
  assert.equal('clearContainer' in result, false);
});

test('LinkedIn refusing the post outright: failed, and the images are let go so the post can be edited', async () => {
  const st = state(['urn:li:image:A'], null);
  const { result } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return Response.json({ message: 'FIELD_LENGTH_TOO_LONG commentary', status: 400 }, { status: 400 });
    return undefined;
  }, input(single, st));
  assert.deepEqual(result, { kind: 'fail', reason: 'caption_rejected: FIELD_LENGTH_TOO_LONG commentary', clearContainer: true });
});

test('a revoked token or a lost page role is an auth problem; a processing failure is a content one', async () => {
  const r401 = await run(() => Response.json({ message: 'Invalid access token' }, { status: 401 }), input(single, null));
  assert.equal(r401.result.kind, 'auth');
  const failed = await run((c) => (c.method === 'GET' ? Response.json({ results: { 'urn:li:image:A': { status: 'PROCESSING_FAILED' } } }) : undefined), input(single, state(['urn:li:image:A'], null)));
  assert.deepEqual(failed.result, { kind: 'fail', reason: 'image_format: LinkedIn could not process an image', clearContainer: true });
});

test('an image that cannot be read from storage is retried, not published without it', async () => {
  const post: PostForPlatform = { ...single, media: [{ ...img(1), load: async () => null }] };
  const { result } = await run(uploads, input(post, null));
  assert.equal(result.kind, 'retry');
  assert.match((result as { reason: string }).reason, /^media_unreachable: /);
});

test('the organisation is found among the pages the member administers, by its public name', async () => {
  const s = stubHttp(HOSTS, (c) => {
    if (c.url.pathname === '/rest/organizationAcls') return Response.json({ elements: [{ organization: 'urn:li:organization:1', state: 'APPROVED' }, { organizationTarget: `urn:li:organization:${ORG}`, state: 'APPROVED' }] });
    if (c.url.pathname === '/rest/organizations/1') return Response.json({ vanityName: 'other-club', localizedName: 'Other' });
    if (c.url.pathname === `/rest/organizations/${ORG}`) return Response.json({ vanityName: 'RSGTurkey', localizedName: 'ISCB-SC RSG-Türkiye' });
    return undefined;
  });
  try {
    assert.deepEqual(await findAdminOrganization('tok', 'rsgturkey'), { ok: true, id: ORG, name: 'ISCB-SC RSG-Türkiye' });
    assert.deepEqual(await findAdminOrganization('tok', 'somebody-else'), { ok: false, reason: 'not_admin', status: 200 });
  } finally { s.restore(); }
});
