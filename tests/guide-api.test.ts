import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import * as professors from '../functions/api/guide/professors';
import * as labs from '../functions/api/guide/labs';
import { INDEX_KEY } from '../functions/_lib/guide-index';

/** The panel's guide editor: Rehber editors read, approvers write. Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://rsg-turkiye.iscbsc.org';

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  const add = raw.prepare('INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1)');
  const grant = raw.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  const session = raw.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, admin] of [['admin', 1], ['editor', 0], ['approver', 0], ['other', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, admin);
    session.run(`s-${id}`, id);
  }
  grant.run('g1', 'editor', 'content.rehber.edit');
  grant.run('g2', 'approver', 'content.rehber.approve');
  grant.run('g3', 'other', 'content.etkinlikler.edit');
  const r2 = fakeR2();
  const env = { DB: d1(raw) as unknown as D1Database, BLOG_IMAGES: r2 as unknown as R2Bucket, ASSETS: { fetch: async () => new Response('no', { status: 404 }) } };
  return { raw, r2, env };
}

type Handler = (c: unknown) => Promise<Response>;
function call(h: unknown, env: unknown, as: string, method: string, path: string, body?: unknown) {
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { Cookie: `rsg_session=s-${as}`, Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return (h as Handler)({ request, env });
}

const newProf = {
  title: 'Doç. Dr.', name: 'Örnek Hoca A', universityId: 'ornek', department: 'Biyomühendislik', labId: null,
  profileUrl: 'https://example.edu.tr/a', openalexId: 'A5000000001', handTopics: ['protein yapısı'], hiddenTopics: [],
  programmeIds: ['ornek-bioinf'], source: 'https://example.edu.tr/a',
};

test('GET without edit rights is 403', async () => {
  const { env } = setup();
  assert.equal((await call(professors.onRequestGet, env, 'other', 'GET', '/api/guide/professors')).status, 403);
  const ok = await call(professors.onRequestGet, env, 'editor', 'GET', '/api/guide/professors');
  assert.equal(ok.status, 200);
  const body = await ok.json() as { professors: unknown[]; labs: unknown[]; state: unknown };
  assert.deepEqual(body.professors, []);
});

test('editor without approve gets 403 on POST and DELETE', async () => {
  const { env } = setup();
  assert.equal((await call(professors.onRequestPost, env, 'editor', 'POST', '/api/guide/professors', { professor: newProf })).status, 403);
  assert.equal((await call(professors.onRequestDelete, env, 'editor', 'DELETE', '/api/guide/professors?id=p_000000000001')).status, 403);
  assert.equal((await call(labs.onRequestPost, env, 'editor', 'POST', '/api/guide/labs', { lab: { name: 'L', universityId: 'ornek', url: '' } })).status, 403);
});

test('approver POST writes the row, an audit row and republishes', async () => {
  const { raw, r2, env } = setup();
  const res = await call(professors.onRequestPost, env, 'approver', 'POST', '/api/guide/professors', { professor: newProf });
  assert.equal(res.status, 200);
  const body = await res.json() as { id: string; publish: { ok: boolean } };
  assert.match(body.id, /^p_[0-9a-f]{12}$/);
  assert.equal(body.publish.ok, true);
  assert.equal((raw.prepare('SELECT COUNT(*) AS n FROM guide_professors').get() as { n: number }).n, 1);
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.professor.save'").get() as { n: number }).n, 1);
  assert.ok(new TextDecoder().decode(r2.store.get(INDEX_KEY)!.body).includes('Örnek Hoca A'));
  const del = await call(professors.onRequestDelete, env, 'approver', 'DELETE', `/api/guide/professors?id=${body.id}`);
  assert.equal(del.status, 200);
  assert.ok(!new TextDecoder().decode(r2.store.get(INDEX_KEY)!.body).includes('Örnek Hoca A'));
});

test('an update keeps the OpenAlex topics the client never sends', async () => {
  const { raw, env } = setup();
  const { id } = await (await call(professors.onRequestPost, env, 'admin', 'POST', '/api/guide/professors', { professor: newProf })).json() as { id: string };
  raw.prepare(`UPDATE guide_professors SET openalex_topics = '["Docking"]', topics_refreshed_at = 5 WHERE id = ?`).run(id);
  await call(professors.onRequestPost, env, 'admin', 'POST', '/api/guide/professors', { professor: { ...newProf, id, department: 'Kimya' } });
  const row = raw.prepare('SELECT department, openalex_topics, topics_refreshed_at FROM guide_professors WHERE id = ?').get(id);
  assert.deepEqual({ ...row }, { department: 'Kimya', openalex_topics: '["Docking"]', topics_refreshed_at: 5 });
});

test('body with an unknown key (e.g. email) is rejected 400', async () => {
  const { env } = setup();
  const res = await call(professors.onRequestPost, env, 'approver', 'POST', '/api/guide/professors', { professor: { ...newProf, email: 'x@example.org' } });
  assert.equal(res.status, 400);
  const res2 = await call(professors.onRequestPost, env, 'approver', 'POST', '/api/guide/professors', { professor: { ...newProf, name: '' } });
  assert.equal(res2.status, 400, 'a name is required');
});

test('a bearer token is refused even with a session', async () => {
  const { env } = setup();
  const request = new Request(`${ORIGIN}/api/guide/professors`, { headers: { Cookie: 'rsg_session=s-admin', Authorization: 'Bearer rsg_pat_x' } });
  assert.equal((await (professors.onRequestGet as Handler)({ request, env })).status, 403);
});

test('republish without a change', async () => {
  const { r2, raw, env } = setup();
  const res = await call(professors.onRequestPost, env, 'approver', 'POST', '/api/guide/professors?republish=1', {});
  assert.equal(res.status, 200);
  assert.ok(r2.store.has(INDEX_KEY));
  assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'guide.republish'").get() as { n: number }).n, 1);
});

test('lab delete refuses while a professor uses it', async () => {
  const { env } = setup();
  const { id: labId } = await (await call(labs.onRequestPost, env, 'admin', 'POST', '/api/guide/labs', { lab: { name: 'Örnek Lab', universityId: 'ornek', url: 'https://lab.example.edu.tr' } })).json() as { id: string };
  assert.match(labId, /^l_[0-9a-f]{12}$/);
  await call(professors.onRequestPost, env, 'admin', 'POST', '/api/guide/professors', { professor: { ...newProf, labId } });
  const res = await call(labs.onRequestDelete, env, 'admin', 'DELETE', `/api/guide/labs?id=${labId}`);
  assert.equal(res.status, 409);
});
