import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { stubHttp } from './lib/http';
import { fetchAuthorTopics } from '../functions/_lib/openalex';
import { pageText, fingerprint, changedLines } from '../functions/_lib/page-watch';
import { backupGuide, BACKUP_KEEP, backupToSql } from '../functions/_lib/guide-backup';
import { onRequestPost as refreshPost } from '../functions/api/admin/guide/refresh-topics';
import { onRequestPost as watchPost } from '../functions/api/admin/guide/watch';
import { onRequestPost as backupPost } from '../functions/api/admin/guide/backup';
import { upsertProfessor, upsertLab, listProfessors, type ProfessorRow } from '../functions/_lib/guide-db';

/** The guide's nightly jobs: OpenAlex topics, the announcement-page watch and the backups. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';

const catalog = {
  universities: [{ id: 'ornek', name: { en: 'E', tr: 'Ö' }, city: 'Ankara', url: 'https://example.edu.tr' }],
  programmes: [
    { id: 'ornek-a', universityId: 'ornek', announcementUrl: 'https://ilan.example.edu.tr/a', calendarUrl: 'https://ilan.example.edu.tr/takvim' },
    { id: 'ornek-b', universityId: 'ornek', announcementUrl: 'https://ilan.example.edu.tr/a' },
  ],
  terms: [],
};

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const r2 = fakeR2();
  const backups = fakeR2();
  const env = {
    DB: d1(raw) as unknown as D1Database, BLOG_IMAGES: r2 as unknown as R2Bucket, GUIDE_BACKUPS: backups as unknown as R2Bucket,
    ASSETS: { fetch: async () => Response.json(catalog) }, SYMPOSIUM_ARCHIVE_SECRET: 's3cret',
  };
  return { raw, r2, backups, env, db: env.DB };
}
const prof = (over: Partial<ProfessorRow>): ProfessorRow => ({
  id: 'p_000000000001', title: '', name: 'Örnek Hoca', universityId: 'ornek', department: '', labId: null, profileUrl: '', openalexId: 'A1',
  handTopics: [], hiddenTopics: [], openalexTopics: [], topicsRefreshedAt: null, topicsFailures: 0, programmeIds: [], source: '', checkedAt: NOW, ...over,
});
type Handler = (c: unknown) => Promise<Response>;
const post = (h: unknown, env: unknown, path: string, secret = 's3cret') =>
  (h as Handler)({ request: new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'X-Archive-Secret': secret } }), env });

test('fetchAuthorTopics returns at most 15 names, highest count first', async () => {
  const topics = Array.from({ length: 20 }, (_, i) => ({ display_name: `T${i}`, count: i }));
  const http = stubHttp(['api.openalex.org'], (c) => {
    assert.equal(c.url.pathname, '/authors/A5000000001');
    assert.ok(c.url.searchParams.get('mailto'), 'the polite pool asks for a contact');
    return Response.json({ topics });
  });
  try {
    const got = await fetchAuthorTopics('A5000000001');
    assert.equal(got.length, 15);
    assert.deepEqual(got.slice(0, 2), ['T19', 'T18']);
  } finally { http.restore(); }
});

test('refresh picks the oldest 20 with an OpenAlex id and keeps a row unchanged when its fetch fails', async () => {
  const { env, db, raw } = setup();
  for (let i = 0; i < 22; i++) await upsertProfessor(db, prof({ id: `p_${String(i).padStart(12, '0')}`, openalexId: `A${i}`, topicsRefreshedAt: i < 2 ? null : NOW - i }), 'u', NOW);
  await upsertProfessor(db, prof({ id: 'p_nonealex0001', openalexId: null, topicsRefreshedAt: null }), 'u', NOW);
  const seen: string[] = [];
  const http = stubHttp(['api.openalex.org'], (c) => {
    const id = c.url.pathname.split('/').pop()!;
    seen.push(id);
    if (id === 'A0') return new Response('boom', { status: 500 });
    return Response.json({ topics: [{ display_name: `topic of ${id}`, count: 1 }] });
  });
  try {
    const res = await post(refreshPost, env, '/api/admin/guide/refresh-topics');
    assert.equal(res.status, 200);
  } finally { http.restore(); }
  assert.equal(seen.length, 20);
  assert.ok(!seen.includes('A2'), 'the two newest-refreshed are left for later');
  const all = await listProfessors(db);
  const a0 = all.find((p) => p.openalexId === 'A0')!;
  assert.deepEqual(a0.openalexTopics, [], 'a failed fetch keeps the old topics');
  assert.equal(a0.topicsFailures, 1);
  assert.ok(a0.topicsRefreshedAt !== null, 'a failed fetch still moves the professor to the back of the queue');
  assert.deepEqual(all.find((p) => p.openalexId === 'A5')!.openalexTopics, ['topic of A5']);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.topics'").get() as { n: number }).n, 1);
});

test('pageText ignores a changed clock and script', () => {
  const a = pageText('<html><body><nav>Menü</nav><p>Başvurular 12:00 açılır</p><script>var x=1</script><p>Ziyaretçi 1234567</p><p>Güncelleme 01.11.2026</p></body></html>');
  const b = pageText('<html><body><nav>Başka</nav><p>Başvurular 18:45 açılır</p><script>var x=2</script><p>Ziyaretçi 1234999</p><p>Güncelleme 02.11.2026</p></body></html>');
  assert.equal(a, b);
  assert.match(a, /Başvurular/);
});

test('a windows-1254 page decodes ş correctly', () => {
  const bytes = new Uint8Array([0x3c, 0x70, 0x3e, 0x62, 0x61, 0xfe, 0x76, 0x75, 0x72, 0x75, 0x3c, 0x2f, 0x70, 0x3e]); // <p>baþvuru</p> in 1254: þ = ş
  assert.match(pageText(bytes, 'text/html; charset=windows-1254'), /başvuru/);
});

test('changedLines lists the new lines, at most 40', () => {
  assert.deepEqual(changedLines('a\nb', 'a\nb\nc'), ['c']);
  assert.equal(changedLines('', Array.from({ length: 50 }, (_, i) => `l${i}`).join('\n')).length, 40);
});

function pageServer(bodies: Record<string, { status?: number; body: string }>) {
  return stubHttp(['ilan.example.edu.tr'], (c) => {
    const b = bodies[c.url.href];
    return new Response(b?.body ?? 'x', { status: b?.status ?? 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  });
}
const long = (s: string) => `<p>${s}</p>` + '<p>Lisansüstü başvuru koşulları ve takvim bilgileri burada yer alır.</p>'.repeat(30);

test('first sighting of a URL raises no queue item, a changed one raises exactly one', async () => {
  const { env, raw } = setup();
  const pages = { 'https://ilan.example.edu.tr/a': { body: long('2026 Güz') }, 'https://ilan.example.edu.tr/takvim': { body: long('Takvim') } };
  let http = pageServer(pages);
  try { await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM guide_page_watch').get() as { n: number }).n, 2, 'URLs are deduplicated');
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM intake_rows').get() as { n: number }).n, 0);
  raw.prepare('UPDATE guide_page_watch SET checked_at = 0').run();
  pages['https://ilan.example.edu.tr/a'] = { body: long('2027 Bahar başvuruları açıldı') };
  http = pageServer(pages);
  try { await post(watchPost, env, '/api/admin/guide/watch'); await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  const rows = raw.prepare("SELECT kind, record_id, payload FROM intake_rows").all() as { kind: string; record_id: string; payload: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'page_changed');
  assert.match(JSON.parse(rows[0].payload).text, /2027 Bahar/);
});

test('a flip back to one of the last 3 fingerprints raises nothing', async () => {
  const { env, raw } = setup();
  const pages = { 'https://ilan.example.edu.tr/a': { body: long('A') }, 'https://ilan.example.edu.tr/takvim': { body: long('T') } };
  for (const v of ['A', 'B', 'A']) {
    pages['https://ilan.example.edu.tr/a'] = { body: long(v) };
    raw.prepare('UPDATE guide_page_watch SET checked_at = 0').run();
    const http = pageServer(pages);
    try { await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  }
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM intake_rows').get() as { n: number }).n, 1, 'A→B raised one; B→A raised none');
});

test('a short or non-200 body is unreadable and raises nothing', async () => {
  const { env, raw } = setup();
  const http = pageServer({ 'https://ilan.example.edu.tr/a': { status: 403, body: 'no' }, 'https://ilan.example.edu.tr/takvim': { body: '<p>bakımda</p>' } });
  // Two URLs, a seventh of them a night (at least one): two nights see both.
  try { await post(watchPost, env, '/api/admin/guide/watch'); await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  const w = raw.prepare('SELECT state, failures, fingerprints FROM guide_page_watch ORDER BY url').all() as { state: string; failures: number; fingerprints: string }[];
  assert.deepEqual(w.map((x) => [x.state, x.failures, x.fingerprints]), [['unreadable', 1, '[]'], ['unreadable', 1, '[]']]);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM intake_rows').get() as { n: number }).n, 0);
});

test('muted URLs are not fetched', async () => {
  const { env, raw } = setup();
  let http = pageServer({ 'https://ilan.example.edu.tr/a': { body: long('A') }, 'https://ilan.example.edu.tr/takvim': { body: long('T') } });
  try { await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  raw.prepare("UPDATE guide_page_watch SET muted = 1, checked_at = 0 WHERE url LIKE '%/a'").run();
  raw.prepare("UPDATE guide_page_watch SET checked_at = 0").run();
  const fetched: string[] = [];
  http = stubHttp(['ilan.example.edu.tr'], (c) => { fetched.push(c.url.pathname); return new Response(long('T'), { headers: { 'Content-Type': 'text/html' } }); });
  try { await post(watchPost, env, '/api/admin/guide/watch'); } finally { http.restore(); }
  assert.deepEqual(fetched, ['/takvim']);
});

test('backup keeps the newest 30 and deletes the rest', async () => {
  const { env, backups } = setup();
  assert.equal(BACKUP_KEEP, 30);
  for (let d = 1; d <= 33; d++) await backups.put(`guide-backup-2026-09-${String(d).padStart(2, '0')}.json`, new Uint8Array([1]));
  const r = await backupGuide(env as never, NOW);
  const keys = [...backups.store.keys()].sort();
  assert.equal(keys.length, 30);
  assert.equal(r.deleted, 4);
  assert.ok(keys.includes(`guide-backup-${new Date(NOW * 1000).toISOString().slice(0, 10)}.json`));
});

test('backup file contains no key outside the D1 columns, and restores into an empty database', async () => {
  const { env, db, backups } = setup();
  await upsertLab(db, { id: 'l_000000000001', name: 'Örnek Lab', universityId: 'ornek', url: '', checkedAt: NOW }, 'u', NOW);
  await upsertProfessor(db, prof({ labId: 'l_000000000001', handTopics: ["O'Brien topics"] }), 'u', NOW);
  await backupGuide(env as never, NOW);
  const key = [...backups.store.keys()][0];
  const file = JSON.parse(new TextDecoder().decode(backups.store.get(key)!.body));
  assert.deepEqual(Object.keys(file).sort(), ['labs', 'professors', 'takenAt']);
  const fresh = new DatabaseSync(':memory:');
  fresh.exec(SCHEMA);
  fresh.exec(backupToSql(file));
  const back = await listProfessors(d1(fresh) as unknown as D1Database);
  assert.deepEqual(back, await listProfessors(db));
});

test('the nightly endpoints refuse without the secret', async () => {
  const { env } = setup();
  for (const [h, p] of [[refreshPost, '/refresh-topics'], [watchPost, '/watch'], [backupPost, '/backup']] as const) {
    assert.equal((await post(h, env, `/api/admin/guide${p}`, 'wrong')).status, 403, p);
  }
});
