import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { periodsFor, bucket, distinctBucket, areaOf, mergeCertYears, trYear, d1Stats } from '../functions/_lib/stats';
import { siteVisits, configured } from '../functions/_lib/web-analytics';
import * as endpoint from '../functions/api/admin/stats';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
// 2026-10-23 12:00 in Türkiye.
const NOW = Date.UTC(2026, 9, 23, 9) / 1000;
const tr = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000 - 3 * 3600;

test('the current year compares this month, last month, this year and last year, in Türkiye time', () => {
  const p = periodsFor(2026, NOW);
  assert.deepEqual(p.map((x) => x.key), ['thisMonth', 'lastMonth', 'thisYear', 'lastYear']);
  assert.equal(p[0].from, tr(2026, 10, 1));
  assert.equal(p[0].to, NOW);
  assert.deepEqual([p[1].from, p[1].to], [tr(2026, 9, 1), tr(2026, 10, 1)]);
  assert.deepEqual([p[2].from, p[3].from, p[3].to], [tr(2026, 1, 1), tr(2025, 1, 1), tr(2026, 1, 1)]);
});

test('January\'s last month is the previous December', () => {
  const p = periodsFor(2027, tr(2027, 1, 10));
  assert.deepEqual([p[1].from, p[1].to], [tr(2026, 12, 1), tr(2027, 1, 1)]);
});

test('an earlier year compares itself with the year before', () => {
  const p = periodsFor(2025, NOW);
  assert.deepEqual(p.map((x) => [x.key, x.from, x.to]), [
    ['year', tr(2025, 1, 1), tr(2026, 1, 1)],
    ['previousYear', tr(2024, 1, 1), tr(2025, 1, 1)],
  ]);
});

test('just after midnight on 1 January in Türkiye is already the new year', () => {
  assert.equal(trYear(tr(2027, 1, 1) + 60), 2027);
  assert.equal(trYear(tr(2027, 1, 1) - 60), 2026);
});

test('buckets count from inclusive, to exclusive; people are counted once', () => {
  const p = [{ key: 'a', from: 10, to: 20 }, { key: 'b', from: 0, to: 30 }];
  assert.deepEqual(bucket([5, 10, 19, 20], p), [2, 4]);
  assert.deepEqual(distinctBucket([{ key: 'u', at: 11 }, { key: 'u', at: 12 }, { key: 'v', at: 25 }], p), [1, 2]);
});

test('a progress id belongs to the area before its first dash, Turkish or not', () => {
  assert.equal(areaOf('genomics-explorer-foundations-0'), 'genomics');
  assert.equal(areaOf('tr-ml-practitioner-toolkit-2'), 'ml');
  assert.equal(areaOf('roadmap-2-1'), 'roadmap');
});

test('a symposium year with both stored and purged certificates adds them up, newest year first', () => {
  const row = (year: number, n: number) => ({ year, certificates: n, people: n, viewed: n, downloaded: n });
  assert.deepEqual(mergeCertYears([row(2026, 2)], [row(2026, 3), row(2025, 1)]), [row(2026, 5), row(2025, 1)]);
});

function seeded() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const user = db.prepare('INSERT INTO users (id, google_id, email, is_member, is_admin, created_at, last_login) VALUES (?,?,?,?,?,?,?)');
  user.run('admin', 'g0', 'admin@example.org', 1, 1, tr(2024, 5, 1), NOW);
  user.run('u1', 'g1', 'a@example.org', 1, 0, tr(2026, 10, 2), NOW);
  user.run('u2', 'g2', 'b@example.org', 0, 0, tr(2026, 9, 15), NOW);
  user.run('u3', 'g3', 'c@example.org', 0, 0, tr(2025, 3, 1), NOW);
  const done = db.prepare('INSERT INTO progress (user_id, resource_id, completed, completed_at) VALUES (?,?,1,?)');
  done.run('u1', 'genomics-explorer-foundations-0', tr(2026, 10, 3));
  done.run('u1', 'tr-genomics-explorer-foundations-1', tr(2026, 10, 4));
  done.run('u2', 'roadmap-1-0', tr(2026, 9, 20));
  db.prepare('INSERT INTO progress (user_id, resource_id, completed, completed_at) VALUES (?,?,0,NULL)').run('u2', 'ml-explorer-foundations-0');
  db.prepare(`INSERT INTO social_posts (id, type, created_by, created_at, updated_at) VALUES ('p1','image','admin',1,1)`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status, published_at) VALUES ('p1','instagram','published',?), ('p1','x','failed',NULL)`).run(tr(2026, 10, 5));
  const cert = db.prepare(`INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at, views, downloads) VALUES (?,2026,?,?,?,1,'admin',1,?,?,?)`);
  cert.run('c1', 'a@example.org', 'A', 'participation', NOW + 9, 1, 0);
  cert.run('c2', 'a@example.org', 'A', 'workshop', NOW + 9, 0, 1);
  cert.run('c3', 'b@example.org', 'B', 'participation', NOW + 9, 0, 0);
  db.prepare('INSERT INTO certificate_stats (year, certificates, people, viewed, downloaded) VALUES (2025, 10, 8, 6, 5)').run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('sa','admin',?,1), ('s1','u1',?,1)`).run(NOW + 9999999, NOW + 9999999);
  return db;
}

test('D1 figures are counts per period, and nothing in them names anyone', async () => {
  const db = seeded();
  const s = await d1Stats(d1(db) as never, periodsFor(2026, NOW));
  assert.deepEqual(s.snapshot, { accounts: 4, members: 2 });
  assert.deepEqual(s.membership, [{ key: 'accounts', values: [1, 1, 2, 1] }]);
  assert.deepEqual(s.learning, [
    { key: 'learners', values: [1, 1, 2, 0] },
    { key: 'completed', values: [2, 1, 3, 0] },
    { key: 'area:genomics', values: [2, 0, 2, 0] },
    { key: 'area:roadmap', values: [0, 1, 1, 0] },
  ]);
  assert.deepEqual(s.social, [
    { key: 'instagram', values: [1, 0, 1, 0] },
    { key: 'linkedin', values: [0, 0, 0, 0] },
    { key: 'x', values: [0, 0, 0, 0] },
  ]);
  assert.deepEqual(s.certificates, [
    { year: 2026, certificates: 3, people: 2, viewed: 1, downloaded: 1 },
    { year: 2025, certificates: 10, people: 8, viewed: 6, downloaded: 5 },
  ]);
  assert.doesNotMatch(JSON.stringify(s), /@example\.org|"u1"|"u2"/);
});

test('blog: the old submission form\'s history is counted; panel drafts are not', async () => {
  const db = seeded();
  // The old form's history (the table is kept, read only).
  const sub = db.prepare(`INSERT INTO blog_submissions (id, submitted_by, lang, title, description, category, author, body, slug, status, created_at, reviewed_at)
    VALUES (?, 'u1', 'en', 't', 'd', 'c', 'a', 'x', ?, ?, ?, ?)`);
  sub.run('b1', 's1', 'approved', tr(2025, 4, 1), tr(2025, 4, 2));
  sub.run('b2', 's2', 'rejected', tr(2026, 9, 3), tr(2026, 9, 4));
  sub.run('b3', 's3', 'pending', tr(2026, 10, 1), null);
  // A published panel draft is pruned after 90 days, so it is no yearly figure:
  // posts written in the panel are counted from git (by pubDate), not here.
  db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, status, author_id, created_at, updated_at)
    VALUES ('d1', 'blog', 'a-post', 'create', '{}', 'published', 'u1', ?, ?)`).run(tr(2026, 9, 1), tr(2026, 10, 5));
  const s = await d1Stats(d1(db) as never, periodsFor(2026, NOW));
  assert.deepEqual(s.submissions, [
    { key: 'submitted', values: [1, 1, 2, 1] },
    { key: 'approved', values: [0, 0, 0, 1] },
    { key: 'rejected', values: [0, 1, 1, 0] },
  ]);
});

const get = (env: unknown, query = '', cookie = 'rsg_session=sa') =>
  (endpoint.onRequestGet as (c: unknown) => Promise<Response>)({
    request: new Request(`https://rsg-turkiye.iscbsc.org/api/admin/stats${query}`, { headers: cookie ? { Cookie: cookie } : {} }),
    env,
  });

test('only admins may read it, and each read is in the audit log', async () => {
  const db = seeded();
  const env = { DB: d1(db) };
  assert.equal((await get(env, '', '')).status, 401);
  assert.equal((await get(env, '', 'rsg_session=s1')).status, 403);
  const res = await get(env);
  assert.equal(res.status, 200);
  const body = await res.json() as { visits: unknown; periods: unknown[] };
  assert.equal(body.visits, null, 'visits are not set up');
  assert.equal(body.periods.length, 4);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'read.stats'`).get() as { n: number }).n, 1);
});

test('a year in the future or malformed is 400; an earlier year has two columns', async () => {
  const env = { DB: d1(seeded()) };
  assert.equal((await get(env, '?year=2999')).status, 400);
  assert.equal((await get(env, '?year=20x6')).status, 200, 'malformed falls back to this year');
  const body = await (await get(env, '?year=2025')).json() as { periods: { key: string }[] };
  assert.deepEqual(body.periods.map((p) => p.key), ['year', 'previousYear']);
});

function fakeCloudflare(fail: (body: string) => boolean = () => false) {
  const calls: { query: string; variables: { filter: { AND: Record<string, string>[] } } }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push(body);
    if (fail(String(init.body))) return new Response(JSON.stringify({ data: null, errors: [{ message: 'too far back' }] }));
    const group = (name: string, count: number) => ({ count, sum: { visits: Math.floor(count / 2) }, dimensions: { name } });
    const data = body.query.includes('total:')
      ? { viewer: { accounts: [{ total: [group('', 100)] }] } }
      : { viewer: { accounts: [{ pages: [group('/tr/', 40), group('/webinars/', 9)], referrers: [group('', 50), group('google.com', 20)], countries: [group('TR', 80)], devices: [group('mobile', 60)] }] } };
    return new Response(JSON.stringify({ data, errors: null }));
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const ENV = { CF_ACCOUNT_ID: 'acc', CF_ANALYTICS_TOKEN: 'tok', WEB_ANALYTICS_SINCE: '2026-10-20' };

test('visits: periods before the beacon went live are null, not zero; others are asked per host', async () => {
  const { calls, fetcher } = fakeCloudflare();
  const v = await siteVisits(ENV, 'main', periodsFor(2026, NOW), NOW, fetcher);
  assert.deepEqual(v.totals, [{ views: 100, visits: 50 }, null, { views: 100, visits: 50 }, null]);
  assert.ok(calls.every((c) => c.variables.filter.AND.some((f) => f.requestHost === 'rsg-turkiye.iscbsc.org')));
  assert.deepEqual(v.top?.pages, [{ name: '/tr/', views: 40 }, { name: '/webinars/', views: 9 }]);
  assert.deepEqual(v.top?.referrers, [{ name: 'google.com', views: 20 }], 'direct visits have no referrer name');
});

test('visits: a refused period costs only that column; no start date means no totals', async () => {
  // Cloudflare refuses anything touching the turn of the year: this year and last year.
  const { fetcher } = fakeCloudflare((b) => b.includes('total:') && b.includes('2025-12-31T21:00'));
  const v = await siteVisits({ ...ENV, WEB_ANALYTICS_SINCE: '2025-01-01' }, 'symposium', periodsFor(2026, NOW), NOW, fetcher);
  assert.deepEqual(v.totals, [{ views: 100, visits: 50 }, { views: 100, visits: 50 }, null, null]);
  const none = await siteVisits({ ...ENV, WEB_ANALYTICS_SINCE: '' }, 'main', periodsFor(2026, NOW), NOW, fakeCloudflare().fetcher);
  assert.deepEqual(none.totals, [null, null, null, null]);
  assert.equal(configured({ CF_ACCOUNT_ID: 'acc' }), false);
});
