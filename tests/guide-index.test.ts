import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { upsertProfessor, upsertLab, deleteProfessor, type ProfessorRow, type LabRow } from '../functions/_lib/guide-db';
import { buildGuideIndex, publishGuideIndex, INDEX_KEY, PROFESSOR_FIELDS, type GuideIndex } from '../functions/_lib/guide-index';
import { onRequestGet } from '../functions/api/guide/index.json.ts';

/** The search index: professors and labs from D1, published to R2. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;

const catalog = {
  universities: [{ id: 'ornek', name: { en: 'Example', tr: 'Örnek' }, city: 'Ankara', url: 'https://example.edu.tr' }],
  programmes: [{ id: 'ornek-bioinf', universityId: 'ornek' }],
  terms: [],
};

function setup(catalogBody: unknown = catalog) {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const r2 = fakeR2();
  const env = {
    DB: d1(raw) as unknown as D1Database,
    BLOG_IMAGES: r2 as unknown as R2Bucket,
    ASSETS: { fetch: async () => (catalogBody === null ? new Response('no', { status: 404 }) : Response.json(catalogBody)) },
  };
  return { raw, r2, env, db: env.DB };
}

const lab = (over: Partial<LabRow> = {}): LabRow => ({ id: 'l_000000000001', name: 'Örnek Lab', universityId: 'ornek', url: 'https://lab.example.edu.tr', checkedAt: NOW, ...over });
const prof = (over: Partial<ProfessorRow> = {}): ProfessorRow => ({
  id: 'p_000000000001', title: 'Doç. Dr.', name: 'Örnek Hoca A', universityId: 'ornek', department: 'Biyomühendislik',
  labId: 'l_000000000001', profileUrl: 'https://example.edu.tr/a', openalexId: 'A5000000001',
  handTopics: ['protein yapısı', 'Docking'], hiddenTopics: ['Wrong Topic'], openalexTopics: ['docking', 'Wrong Topic', 'Structural Bioinformatics'],
  topicsRefreshedAt: NOW, topicsFailures: 0, programmeIds: ['ornek-bioinf'], source: 'https://example.edu.tr/a', checkedAt: NOW, ...over,
});

const published = (r2: ReturnType<typeof fakeR2>): GuideIndex => JSON.parse(new TextDecoder().decode(r2.store.get(INDEX_KEY)!.body));

test('index keys of a professor are exactly the allowlist', () => {
  const idx = buildGuideIndex([prof()], [lab()], NOW);
  assert.deepEqual(Object.keys(idx.professors[0]).sort(), [...PROFESSOR_FIELDS].sort());
  assert.deepEqual([...PROFESSOR_FIELDS].sort(), ['checkedAt', 'department', 'id', 'labId', 'name', 'openalexId', 'profileUrl', 'programmeIds', 'source', 'title', 'topics', 'universityId'].sort());
});

test('hand topics come first and hidden OpenAlex topics are dropped', () => {
  const idx = buildGuideIndex([prof()], [lab()], NOW);
  assert.deepEqual(idx.professors[0].topics, ['protein yapısı', 'Docking', 'Structural Bioinformatics']);
});

test('a deleted professor is absent after republish', async () => {
  const { r2, env, db } = setup();
  await upsertLab(db, lab(), 'u1', NOW);
  await upsertProfessor(db, prof(), 'u1', NOW);
  await upsertProfessor(db, prof({ id: 'p_000000000002', name: 'Örnek Hoca B', labId: null }), 'u1', NOW);
  assert.equal((await publishGuideIndex(env, NOW)).ok, true);
  await deleteProfessor(db, 'p_000000000001', 'u1', NOW);
  await publishGuideIndex(env, NOW);
  const text = new TextDecoder().decode(r2.store.get(INDEX_KEY)!.body);
  assert.ok(!text.includes('Örnek Hoca A'));
  assert.deepEqual(published(r2).professors.map((p) => p.id), ['p_000000000002']);
});

test('a lab whose only professor is removed leaves the index', async () => {
  const { r2, env, db } = setup();
  await upsertLab(db, lab(), 'u1', NOW);
  await upsertProfessor(db, prof(), 'u1', NOW);
  await publishGuideIndex(env, NOW);
  assert.equal(published(r2).labs.length, 1);
  await deleteProfessor(db, 'p_000000000001', 'u1', NOW);
  await publishGuideIndex(env, NOW);
  assert.deepEqual(published(r2).labs, []);
});

test('publish writes nothing when the D1 read throws, and records the error', async () => {
  const { raw, r2, env, db } = setup();
  await upsertProfessor(db, prof({ labId: null }), 'u1', NOW);
  await publishGuideIndex(env, NOW);
  const before = r2.store.get(INDEX_KEY)!.body;
  raw.exec('DROP TABLE guide_professors');
  let puts = 0;
  const realPut = r2.put.bind(r2);
  r2.put = async (...a: Parameters<typeof realPut>) => { puts++; return realPut(...a); };
  const res = await publishGuideIndex(env, NOW + 5);
  assert.equal(res.ok, false);
  assert.equal(puts, 0);
  assert.equal(r2.store.get(INDEX_KEY)!.body, before, 'the last good index keeps serving');
  const state = raw.prepare('SELECT error FROM guide_index_state WHERE id = 1').get() as { error: string };
  assert.ok(state.error && state.error.length > 0);
});

test('unresolved counts a programme id missing from the catalog', async () => {
  const { raw, env, db } = setup();
  await upsertProfessor(db, prof({ labId: null, programmeIds: ['ornek-bioinf', 'gone-programme'] }), 'u1', NOW);
  const res = await publishGuideIndex(env, NOW);
  assert.deepEqual(res, { ok: true, count: 1, unresolved: 1 });
  const state = raw.prepare('SELECT count, unresolved, error, published_at FROM guide_index_state WHERE id = 1').get();
  assert.deepEqual({ ...state }, { count: 1, unresolved: 1, error: null, published_at: NOW });
});

test('GET /api/guide/index.json serves the object, 404 before the first publish', async () => {
  const { env, db } = setup();
  const get = () => (onRequestGet as (c: unknown) => Promise<Response>)({ request: new Request('https://rsg-turkiye.iscbsc.org/api/guide/index.json'), env });
  assert.equal((await get()).status, 404);
  await upsertProfessor(db, prof({ labId: null }), 'u1', NOW);
  await publishGuideIndex(env, NOW);
  const res = await get();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('Cache-Control') ?? '', /max-age=300/);
  assert.equal(((await res.json()) as GuideIndex).professors.length, 1);
});
