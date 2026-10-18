import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestPost } from '../functions/api/progress';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

/** D1 over sqlite, counting the round trips a request makes (a batch is one). */
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, created_at, last_login) VALUES ('u1','g1','member@example.org',1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const real = d1(db);
  let trips = 0;
  const counted = (s: ReturnType<typeof real.prepare>): typeof s => ({
    ...s,
    bind: (...a: unknown[]) => counted(s.bind(...a)),
    first: (...a: []) => { trips++; return s.first(...a); },
    all: (...a: []) => { trips++; return s.all(...a); },
    run: (...a: []) => { trips++; return s.run(...a); },
  });
  const DB = {
    prepare: (sql: string) => counted(real.prepare(sql)),
    batch: async (stmts: { run(): Promise<unknown> }[]) => { trips++; const before = trips; const out = await real.batch(stmts); trips = before; return out; },
  };
  return { db, env: { DB: DB as never }, trips: () => trips };
}
const post = (env: unknown, body: unknown) => onRequestPost({
  request: new Request('https://rsg-turkiye.iscbsc.org/api/progress', {
    method: 'POST', headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }),
  env,
} as never);

test('a first sync of many ticked items stays far under the 50-query cap', async () => {
  // The free plan allows 50 D1 queries per request; one statement per item
  // cut a large first sync off part way.
  const { db, env, trips } = setup();
  const items = Array.from({ length: 120 }, (_, i) => ({ resource_id: `res-${i}`, completed: true }));
  const res = await post(env, { items });
  assert.equal(res.status, 200);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM progress WHERE user_id = 'u1' AND completed = 1`).get() as { n: number }).n, 120);
  assert.ok(trips() < 20, `made ${trips()} D1 round trips`);
});

test('invalid ids are skipped and unticking keeps the first completion time', async () => {
  const { db, env } = setup();
  await post(env, { items: [{ resource_id: 'ok-1', completed: true }, { resource_id: 'bad id!', completed: true }] });
  const first = db.prepare(`SELECT completed_at FROM progress WHERE resource_id = 'ok-1'`).get() as { completed_at: number };
  await post(env, { resource_id: 'ok-1', completed: false });
  const row = db.prepare(`SELECT completed, completed_at FROM progress WHERE resource_id = 'ok-1'`).get() as { completed: number; completed_at: number };
  assert.equal(row.completed, 0);
  assert.equal(row.completed_at, first.completed_at);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM progress`).get() as { n: number }).n, 1);
});
