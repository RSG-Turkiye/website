// The podcast in the panel CMS: the feed parser (shared with
// `npm run podcast:sync`), its schema, and POST /api/cms/podcast/pull, which
// turns the feed into a draft. The feed and GitHub are both fakes behind
// global.fetch: no test reads the real feed. The feed is synthetic
// (tests/fixtures/podcast-feed.xml); the only test that reads the real
// src/data/podcast.json checks structure, never wording (A2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { call } from './lib/social';
import { FEED, FeedError, MAX_EPISODES, PLATFORMS, houseText, parseFeed, type PodcastData } from '../src/lib/podcast-feed';
import { podcastSchema } from '../src/data/podcast';
import { cmsType } from '../src/lib/cms/types';
import { serializeJson } from '../src/lib/cms/serialize';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { entryPaths } from '../functions/_lib/cms-api';
import { houseRuleErrors, validateDraft } from '../functions/_lib/cms-drafts';
import { MODELS } from '../src/scripts/admin/cms-form';
import { diffEntry } from '../src/scripts/admin/cms-diff';
import * as pull from '../functions/api/cms/podcast/pull';
import * as submit from '../functions/api/cms/drafts/[id]/submit';

const ROOT = new URL('../', import.meta.url).pathname;
const SCHEMA = readFileSync(`${ROOT}db/schema.sql`, 'utf8');
const FIXTURE = readFileSync(`${ROOT}tests/fixtures/podcast-feed.xml`, 'utf8');
const PODCAST = cmsType('podcast')!;
const PATH = 'src/data/podcast.json';
const SYNCED = '2026-01-01T00:00:00.000Z';

/** What the fixture parses to: made-up episodes, newest first. */
const EXPECTED: PodcastData = {
  syncedAt: SYNCED,
  title: 'Örnek Biyoinformatik Podcast',
  description: 'Bir örnek gösteri & açıklaması.',
  image: 'https://example.org/show.jpg',
  platforms: PLATFORMS,
  episodes: [
    {
      guid: '00000000-0000-4000-8000-000000000003', title: 'Fragman', pubDate: '2025-05-30T09:00:00.000Z', durationSeconds: 300,
      audioUrl: 'https://example.org/audio/ep3.m4a', audioBytes: 300, image: '', description: 'Kısa.',
    },
    {
      guid: '00000000-0000-4000-8000-000000000002', title: 'İkinci bölüm: Dizileme - ve sonrası', pubDate: '2025-05-24T10:30:00.000Z', durationSeconds: 3065,
      audioUrl: 'https://example.org/audio/ep2.m4a?a=1&b=2', audioBytes: 2000, image: 'https://example.org/ep2.jpg',
      description: 'Hizalama - varyant çağırma. İkinci paragraf ve satır.',
    },
    {
      guid: '00000000-0000-4000-8000-000000000001', title: 'Birinci bölüm & giriş', pubDate: '2025-03-13T11:00:00.000Z', durationSeconds: 2448,
      audioUrl: 'https://example.org/audio/ep1.m4a', audioBytes: 1000, image: 'https://example.org/ep1.jpg', description: 'Düz metin açıklama.',
    },
  ],
};

// ── the parser ────────────────────────────────────────────────────────────────

test('the parser reads the fixture feed: plain text, ISO dates, seconds, newest first', () => {
  assert.deepEqual(parseFeed(FIXTURE, SYNCED), EXPECTED);
});

test('the parsed feed passes the schema and the house rules, so its draft can be sent', () => {
  assert.ok(podcastSchema.safeParse(EXPECTED).success);
  assert.deepEqual(houseRuleErrors(PODCAST, EXPECTED), {});
  assert.ok(validateDraft(PODCAST, EXPECTED, 'strict').ok);
  const text = JSON.stringify(parseFeed(FIXTURE, SYNCED));
  assert.ok(!text.includes('—'), 'the em dash in the feed is written as a hyphen');
  assert.doesNotMatch(text, /\w\s--\s\w/, 'and so is a spaced double hyphen');
});

test('houseText: an em dash and a spaced -- become " - "; an en dash and a --flag stay', () => {
  assert.equal(houseText('A — B'), 'A - B');
  assert.equal(houseText('A—B'), 'A - B');
  assert.equal(houseText('A -- B'), 'A - B');
  assert.equal(houseText('10–12 Mayıs'), '10–12 Mayıs');
  assert.equal(houseText('run with --resume'), 'run with --resume');
});

/** Today's podcast.json, written back as an RSS feed of the host's shape. */
function feedOf(show: PodcastData): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const items = show.episodes.map((e) => `<item>
      <title><![CDATA[${e.title}]]></title>
      <description><![CDATA[<p>${e.description}</p>]]></description>
      <guid isPermaLink="false">${e.guid}</guid>
      <pubDate>${new Date(e.pubDate).toUTCString()}</pubDate>
      <enclosure url="${esc(e.audioUrl)}" length="${e.audioBytes}" type="audio/x-m4a"/>
      <itunes:duration>${e.durationSeconds}</itunes:duration>
      ${e.image ? `<itunes:image href="${esc(e.image)}"/>` : ''}
    </item>`).join('\n');
  return `<rss><channel><title><![CDATA[${show.title}]]></title><description><![CDATA[${show.description}]]></description>
    <itunes:image href="${esc(show.image)}"/>${items}</channel></rss>`;
}

test('the parser gives back today\'s podcast.json episodes from a feed of the same shape, and the file fits the schema', () => {
  // Structural: whatever the episodes say, they survive the round trip.
  const real = JSON.parse(readFileSync(`${ROOT}${PATH}`, 'utf8')) as PodcastData;
  assert.ok(podcastSchema.safeParse(real).success, 'src/data/podcast.json fits src/data/podcast.ts');
  const back = parseFeed(feedOf(real), real.syncedAt);
  assert.deepEqual(back.episodes, real.episodes);
  assert.equal(serializeJson(PODCAST, real), readFileSync(`${ROOT}${PATH}`, 'utf8'), 'written in the file\'s own key order');
});

test('a feed with no episodes, or an episode without audio, title or date, is refused with FeedError', () => {
  assert.throws(() => parseFeed('<rss><channel><title>x</title></channel></rss>', SYNCED), FeedError);
  assert.throws(() => parseFeed('<html>Bad gateway</html>', SYNCED), FeedError);
  const without = (re: RegExp) => FIXTURE.replace(re, '');
  assert.throws(() => parseFeed(without(/<enclosure url="https:\/\/example.org\/audio\/ep1.m4a"[^>]*\/>/), SYNCED), FeedError);
  assert.throws(() => parseFeed(FIXTURE.replace('<title>Birinci bölüm &amp; giriş</title>', '<title></title>'), SYNCED), FeedError);
  assert.throws(() => parseFeed(FIXTURE.replace('Thu, 13 Mar 2025 11:00:00 GMT', 'not a date'), SYNCED), FeedError);
});

test('the schema refuses what tests/podcast.test.ts refuses', () => {
  const bad = (f: (d: PodcastData) => void) => { const d = structuredClone(EXPECTED); f(d); return podcastSchema.safeParse(d).success; };
  assert.equal(bad((d) => { d.episodes[0].audioUrl = 'http://example.org/a.m4a'; }), false, 'audio over https');
  assert.equal(bad((d) => { d.episodes[0].guid = ' '; }), false, 'a guid');
  assert.equal(bad((d) => { d.episodes[1].guid = d.episodes[0].guid; }), false, 'no shared guid');
  assert.equal(bad((d) => { d.episodes[1].audioUrl = d.episodes[0].audioUrl; }), false, 'no shared audio');
  assert.equal(bad((d) => { d.episodes.reverse(); }), false, 'newest first');
  assert.equal(bad((d) => { d.episodes[0].pubDate = 'soon'; }), false, 'a readable date');
  assert.equal(bad((d) => { d.episodes = []; }), false, 'at least one episode');
  assert.equal(bad(() => {}), true);
});

// ── the endpoint ──────────────────────────────────────────────────────────────

const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');
const fileOf = (d: PodcastData) => `${JSON.stringify(d, null, 2)}\n`;

type FeedAnswer = { kind: 'ok'; body: string; headers?: Record<string, string> } | { kind: 'status'; status: number; body: string } | { kind: 'throw'; error: Error };

let main = new Map<string, string>();
let feed: FeedAnswer = { kind: 'ok', body: FIXTURE };
let feedCalls: { url: string; signal: boolean }[] = [];

globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  if (url.href === FEED) {
    feedCalls.push({ url: url.href, signal: !!init?.signal });
    if (feed.kind === 'throw') throw feed.error;
    if (feed.kind === 'status') return new Response(feed.body, { status: feed.status });
    return new Response(feed.body, { status: 200, headers: feed.headers });
  }
  const contents = url.pathname.match(/^\/repos\/RSG-Turkiye\/website\/contents\/(.+)$/);
  if (url.host === 'api.github.com' && contents && (init?.method ?? 'GET') === 'GET') {
    const content = main.get(decodeURIComponent(contents[1]));
    if (content === undefined) return json({ message: 'Not Found' }, 404);
    return json({ sha: blobSha(content), content: Buffer.from(content).toString('base64'), encoding: 'base64' });
  }
  throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
}) as never;

function setup(onMain: PodcastData) {
  main = new Map([[PATH, fileOf(onMain)]]);
  feed = { kind: 'ok', body: FIXTURE };
  feedCalls = [];
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_admin, is_member, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1, 1)');
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  const session = db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, isAdmin] of [['admin', 1], ['community', 0], ['community2', 0], ['events', 0], ['member', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, isAdmin);
    session.run(`s-${id}`, id);
  }
  grant.run('g1', 'community', 'content.topluluk.edit');
  grant.run('g2', 'community2', 'content.topluluk.edit');
  grant.run('g3', 'events', 'content.etkinlikler.edit');
  const env = { DB: d1(db), GITHUB_PAT: 'unused' } as never;
  const audit = () => db.prepare('SELECT user_id, action, target_type, target_id, details FROM audit_log ORDER BY seq').all() as { user_id: string; action: string; target_type: string; target_id: string; details: string }[];
  const drafts = () => db.prepare('SELECT * FROM content_drafts').all() as Record<string, any>[];
  return { db, env, audit, drafts };
}

const ORIGIN = { Origin: 'https://rsg-turkiye.iscbsc.org' };
const doPull = (env: unknown, as?: string, headers: Record<string, string> = ORIGIN) =>
  call(pull.onRequestPost, 'POST', '/api/cms/podcast/pull', { env, as, body: {}, headers });

/** Main as the fixture minus its newest episode, synced earlier. */
const olderMain = (): PodcastData => ({ ...structuredClone(EXPECTED), syncedAt: '2025-06-01T00:00:00.000Z', episodes: structuredClone(EXPECTED.episodes.slice(1)) });

test('one new episode in the feed: an update draft by the caller, whose diff is that episode', async () => {
  const { env, audit, drafts } = setup(olderMain());
  const res = await doPull(env, 'community');
  assert.equal(res.status, 201);
  const body = await res.json() as any;
  assert.equal(body.draft.type, 'podcast');
  assert.equal(body.draft.entry_id, 'podcast');
  assert.equal(body.draft.action, 'update');
  assert.equal(body.draft.status, 'draft');
  assert.equal(body.draft.author_id, 'community');
  assert.equal(body.added, 1);
  assert.deepEqual(body.draft.base_shas, { [PATH]: blobSha(main.get(PATH)!) });

  const [row] = drafts();
  const data = JSON.parse(row.data) as PodcastData;
  assert.deepEqual(data.episodes, EXPECTED.episodes);
  assert.ok(Number.isFinite(Date.parse(data.syncedAt)) && data.syncedAt !== olderMain().syncedAt, 'syncedAt is when it was pulled');

  // What the approver sees: one changed field, the episodes, and in it one added row.
  const diff = diffEntry(MODELS.podcast, olderMain(), data, MODELS.podcast.fields);
  assert.deepEqual(diff.changed.map((c) => c.field.key), ['episodes']);
  const rows = diff.changed[0].changes[0];
  assert.equal(rows.type, 'rows');
  assert.deepEqual((rows as any).rows.map((r: any) => [r.state, r.row.guid]), [['added', EXPECTED.episodes[0].guid]]);

  const log = audit();
  assert.deepEqual(log.map((a) => a.action), ['cms.podcast.pull', 'cms.draft.create'], 'the attempt is logged before the feed is read');
  assert.equal(log[1].user_id, 'community');
  assert.equal(log[1].target_id, row.id);
  assert.deepEqual(JSON.parse(log[1].details), { type: 'podcast', entry_id: 'podcast', draft_action: 'update', generated: 'podcast' });
  assert.equal(feedCalls.length, 1, 'one request to the feed');
  assert.ok(feedCalls[0].signal, 'with a timeout');

  // It goes through the normal flow: the author sends it for approval.
  const sent = await call(submit.onRequestPost, 'POST', `/api/cms/drafts/${row.id}/submit`, { env, as: 'community', body: {}, params: { id: row.id }, headers: ORIGIN });
  assert.equal(sent.status, 200);
});

test('the same episodes: no_new_episodes and no draft, whatever syncedAt says', async () => {
  const { env, drafts, audit } = setup({ ...structuredClone(EXPECTED), syncedAt: '2020-01-01T00:00:00.000Z' });
  const res = await doPull(env, 'community');
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).code, 'no_new_episodes');
  assert.equal(drafts().length, 0);
  assert.deepEqual(audit().map((a) => [a.action, JSON.parse(a.details).result]), [['cms.podcast.pull', undefined], ['cms.podcast.result', 'no_new_episodes']]);
});

test('the feed down, empty, too large or broken: 502 feed_failed, no draft, and none of the feed\'s text in the answer', async () => {
  const cases: [string, FeedAnswer][] = [
    ['an error status', { kind: 'status', status: 503, body: 'secret-upstream-detail' }],
    ['a network error', { kind: 'throw', error: new TypeError('fetch failed') }],
    ['a timeout', { kind: 'throw', error: new DOMException('The operation timed out.', 'TimeoutError') }],
    ['no episodes', { kind: 'ok', body: '<rss><channel><title>secret-upstream-detail</title></channel></rss>' }],
    ['an episode without audio', { kind: 'ok', body: FIXTURE.replace(/<enclosure url="https:\/\/example.org\/audio\/ep1.m4a"[^>]*\/>/, '') }],
    ['an episode without a title', { kind: 'ok', body: FIXTURE.replace('<title><![CDATA[Fragman]]></title>', '<title></title>') }],
    ['over the size cap', { kind: 'ok', body: `${FIXTURE}<!--${'x'.repeat(pull.FEED_MAX_BYTES)}-->` }],
    ['a declared size over the cap', { kind: 'ok', body: FIXTURE, headers: { 'Content-Length': String(pull.FEED_MAX_BYTES + 1) } }],
    ['a feed that does not fit the schema', { kind: 'ok', body: FIXTURE.replace('https://example.org/audio/ep1.m4a"', 'http://example.org/audio/ep1.m4a"') }],
  ];
  for (const [what, answer] of cases) {
    const { env, drafts, audit } = setup(olderMain());
    feed = answer;
    const res = await doPull(env, 'community');
    assert.equal(res.status, 502, what);
    const text = await res.text();
    assert.equal(JSON.parse(text).code, 'feed_failed', what);
    assert.doesNotMatch(text, /secret-upstream-detail|example\.org/, `${what}: nothing of the feed is echoed`);
    assert.equal(drafts().length, 0, what);
    assert.deepEqual(audit().map((a) => [a.action, JSON.parse(a.details).result]), [['cms.podcast.pull', undefined], ['cms.podcast.result', 'feed_failed']], what);
  }
});

test('rights: Topluluk editors and admins pull; others are refused before the feed is read', async () => {
  const { env, drafts } = setup(olderMain());
  assert.equal((await doPull(env)).status, 401);
  assert.equal((await doPull(env, 'member')).status, 403);
  assert.equal((await doPull(env, 'events')).status, 403, 'edit rights in another group are not enough');
  assert.equal((await doPull(env, 'community', { Origin: 'https://evil.example' })).status, 403, 'a foreign Origin: refused as CSRF');
  assert.equal(feedCalls.length, 0);
  assert.equal(drafts().length, 0);
  assert.equal((await doPull(env, 'admin')).status, 201);
});

test('a podcast draft on its way: entry_busy, without reading the feed', async () => {
  const { env, db } = setup(olderMain());
  const first = await (await doPull(env, 'community')).json() as any;
  db.prepare("UPDATE content_drafts SET status = 'submitted' WHERE id = ?").run(first.draft.id);
  feedCalls = [];
  const res = await doPull(env, 'community2');
  assert.equal(res.status, 409);
  assert.equal((await res.json() as any).code, 'entry_busy');
  assert.equal(feedCalls.length, 0);
});

test('rate limit: PULL_LIMIT pulls per person in PULL_WINDOW_SECONDS, then 429 without reading the feed', async () => {
  assert.equal(pull.PULL_LIMIT, 5);
  assert.equal(pull.PULL_WINDOW_SECONDS, 600);
  assert.equal(pull.FEED_MAX_BYTES, 2 * 1024 * 1024);
  assert.equal(pull.FEED_TIMEOUT_MS, 10_000);
  const { env } = setup({ ...structuredClone(EXPECTED) });
  for (let i = 0; i < pull.PULL_LIMIT; i++) assert.equal((await doPull(env, 'community')).status, 200, `pull ${i + 1}`);
  feedCalls = [];
  const res = await doPull(env, 'community');
  assert.equal(res.status, 429);
  assert.equal((await res.json() as any).code, 'rate_limited');
  assert.equal(feedCalls.length, 0);
  assert.equal((await doPull(env, 'community2')).status, 200, 'per person');
});

test('the registry: podcast is Topluluk\'s, one fixed file, generated, no create or delete', () => {
  assert.equal(PODCAST.group, 'topluluk');
  assert.equal(PODCAST.dir, 'src/data');
  assert.equal(PODCAST.format, 'json');
  assert.equal(PODCAST.fixedId, 'podcast');
  assert.ok(PODCAST.generated && PODCAST.noCreate && PODCAST.noDelete);
  assert.equal(PODCAST.schema, podcastSchema);
  assert.equal(MODELS.podcast.sub, 'podcast');
});

test('fixedId: the index lists only src/data/podcast.json, and no other file in src/data is a podcast entry', () => {
  const files = { [PATH]: fileOf(EXPECTED), 'src/data/other.json': '{"title":"x"}' };
  assert.deepEqual(buildCmsIndex(files, undefined, [PODCAST]).podcast.map((e) => e.id), ['podcast']);
  assert.deepEqual(entryPaths(PODCAST, 'podcast', null), [PATH]);
  assert.equal(entryPaths(PODCAST, 'other', null), null);
});

test('GitHub down after the feed was read: the pull still counts toward the limit', async () => {
  const { env, audit, drafts } = setup(olderMain());
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) =>
    String(input).startsWith('https://api.github.com/') ? new Response('{}', { status: 500 }) : real(input, init)) as never;
  try {
    const res = await doPull(env, 'community');
    assert.equal(res.status, 502);
    assert.equal((await res.json() as any).code, 'github_failed');
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(drafts().length, 0);
  assert.deepEqual(audit().map((a) => [a.action, JSON.parse(a.details).result]), [['cms.podcast.pull', undefined], ['cms.podcast.result', 'github_failed']]);
});

// ── fix round 1 ───────────────────────────────────────────────────────────────

test('hostile feeds of 2 MB parse or fail in well under a second (no quadratic scans)', () => {
  const item = FIXTURE.slice(FIXTURE.indexOf('<item>'), FIXTURE.indexOf('</item>') + 7).replace('Hizalama', 'x'.repeat(3000));
  const many = Array.from({ length: 60 }, (_, i) => item.replace(/000000000002/g, String(i).padStart(12, '0')).replace('24 May 2025', `${(i % 28) + 1} May 2024`)).join('\n');
  const cases: Record<string, string> = {
    unclosedItems: '<item>'.repeat(Math.floor(2e6 / 6)),
    unclosedTitles: `<item>${'<title>'.repeat(Math.floor(2e6 / 7))}</item>`,
    enclosureAttrs: `<item><title>x</title><enclosure ${' a'.repeat(1e6)}></item>`,
    manyEnclosure: `<item><title>x</title>${'<enclosure '.repeat(Math.floor(2e6 / 11))}</item>`,
    unclosedTagsInText: `<item><title>x</title><description>${'<'.repeat(2e6)}</description><enclosure url="https://example.org/a.m4a"/><pubDate>Sat, 24 May 2025 10:30:00 GMT</pubDate></item>`,
    spacesInTitle: `<item><title>a${' '.repeat(2e6)}b</title><enclosure url="https://example.org/a.m4a"/><pubDate>Sat, 24 May 2025 10:30:00 GMT</pubDate></item>`,
    realisticLarge: FIXTURE.slice(0, FIXTURE.indexOf('<item>')) + many + '</channel></rss>',
  };
  for (const [what, xml] of Object.entries(cases)) {
    const t = performance.now();
    try { parseFeed(xml, SYNCED); } catch (e) { assert.ok(e instanceof FeedError, `${what}: ${e}`); }
    const ms = performance.now() - t;
    assert.ok(ms < 1000, `${what}: ${Math.round(ms)} ms`);
  }
});

test('an unclosed item or title fails the feed; more than MAX_EPISODES items fails it', () => {
  const last = FIXTURE.lastIndexOf('</item>');
  assert.throws(() => parseFeed(FIXTURE.slice(0, last) + FIXTURE.slice(last + 7), SYNCED), FeedError, 'the last item never closes');
  assert.throws(() => parseFeed(FIXTURE.replace('<title><![CDATA[Fragman]]></title>', '<title><![CDATA[Fragman]]>'), SYNCED), FeedError);
  const one = FIXTURE.slice(FIXTURE.indexOf('<item>'), FIXTURE.indexOf('</item>') + 7);
  const feedOfN = (n: number) => `<rss><channel><title>x</title>${Array.from({ length: n }, (_, i) => one.replace(/000000000002/g, String(i).padStart(12, '0')).replace('ep2.m4a', `ep${i}.m4a`)).join('')}</channel></rss>`;
  assert.equal(MAX_EPISODES, 500);
  assert.equal(parseFeed(feedOfN(MAX_EPISODES), SYNCED).episodes.length, MAX_EPISODES);
  assert.throws(() => parseFeed(feedOfN(MAX_EPISODES + 1), SYNCED), FeedError);
});

test('numeric entities are decoded, and a numeric em dash is written as a hyphen too', () => {
  const xml = FIXTURE
    .replace('<title>Birinci bölüm &amp; giriş</title>', '<title>Birinci&#8217;s &#x27;bölüm&#x27; &#8212; giriş</title>')
    .replace('<![CDATA[Düz metin açıklama.]]>', 'Düz&#160;metin &amp;#8212; açıklama&#x2014;son.');
  const ep = parseFeed(xml, SYNCED).episodes.find((e) => e.guid.endsWith('001'))!;
  assert.equal(ep.title, 'Birinci’s \'bölüm\' - giriş');
  assert.equal(ep.description, 'Düz metin &#8212; açıklama - son.', 'an escaped entity stays text, decoded once');
  assert.ok(!JSON.stringify(parseFeed(xml, SYNCED)).includes('—'));
});

test('episode and show artwork are https or empty', () => {
  const bad = (f: (d: PodcastData) => void) => { const d = structuredClone(EXPECTED); f(d); return podcastSchema.safeParse(d).success; };
  assert.equal(bad((d) => { d.episodes[0].image = 'http://example.org/a.jpg'; }), false);
  assert.equal(bad((d) => { d.episodes[0].image = 'javascript:alert(1)'; }), false);
  assert.equal(bad((d) => { d.episodes[0].image = ''; }), true, 'no artwork is fine');
  assert.equal(bad((d) => { d.image = 'http://example.org/a.jpg'; }), false);
});

test('the attempt is logged before the feed is read, so a request killed mid-fetch still counts', async () => {
  const { env, audit } = setup(olderMain());
  const real = globalThis.fetch;
  let reading = false;
  // The feed never answers: as far as this request goes, the platform kills it here.
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    if (String(input) === FEED) { reading = true; return new Promise(() => {}); }
    return real(input, init);
  }) as never;
  try {
    void doPull(env, 'community');
    for (let i = 0; i < 100 && !reading; i++) await new Promise((r) => setImmediate(r));
    assert.ok(reading, 'the feed is being read');
    assert.deepEqual(audit().map((a) => a.action), ['cms.podcast.pull']);
  } finally {
    globalThis.fetch = real;
  }
});
