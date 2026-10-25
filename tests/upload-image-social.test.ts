import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { onRequestPost } from '../functions/api/blog-submissions/upload-image';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
/** A minimal JPEG whose frame header says width x height. */
const jpeg = (w: number, h: number) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 0, 0, 0, 0, 0, 0, 0, 0]);

function setup(roles: Record<string, number>, schema = SCHEMA) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  const cols = Object.keys(roles);
  db.prepare(`INSERT INTO users (id, google_id, email, ${cols.join(',')}, created_at, last_login) VALUES ('u1','g1','a@example.org',${cols.map(() => '?').join(',')},1,1)`).run(...Object.values(roles));
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  return { db, env: { DB: d1(db), BLOG_IMAGES: fakeR2(), PUBLIC_BLOG_IMAGES_URL: 'https://rsg-turkiye.iscbsc.org/api/images' } as never };
}
const upload = (env: unknown, bytes: Uint8Array) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/blog-submissions/upload-image', {
      method: 'POST', headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'image/jpeg' }, body: bytes,
    }),
    env,
  });

test('a social editor may upload, and the server records the real size', async () => {
  const { env, db } = setup({ is_social: 1 });
  const res = await upload(env, jpeg(1080, 1350));
  assert.equal(res.status, 200);
  const body = await res.json() as { url: string; key: string; width: number; height: number };
  assert.match(body.key, /^[0-9a-f-]{36}\.jpg$/);
  assert.equal(body.url, `https://rsg-turkiye.iscbsc.org/api/images/${body.key}`);
  assert.deepEqual([body.width, body.height], [1080, 1350]);
  const row = db.prepare('SELECT width, height, uploaded_by FROM social_media WHERE key = ?').get(body.key);
  assert.deepEqual({ ...row as object }, { width: 1080, height: 1350, uploaded_by: 'u1' });
});

test('someone with no writing or social role still cannot upload', async () => {
  const { env } = setup({ is_member: 1 });
  assert.equal((await upload(env, jpeg(10, 10))).status, 403);
});

test('before the 8d migration a blog upload still succeeds', async () => {
  const pre = SCHEMA.replace(/CREATE TABLE IF NOT EXISTS social_media[\s\S]*?\);/, '');
  const { env, db } = setup({ is_member: 1 }, pre);
  db.prepare(`INSERT INTO role_grants (id, user_id, role, granted_at) VALUES ('g1','u1','content.yazilar.edit',1)`).run();
  assert.equal((await upload(env, jpeg(800, 600))).status, 200);
});

test('the retired writer flag alone no longer uploads (migration 8k moves it to Yazılar)', async () => {
  const { env } = setup({ is_writer: 1 });
  assert.equal((await upload(env, jpeg(10, 10))).status, 403);
});

test('an Etkinlikler editor may upload, and the upload is logged', async () => {
  const { env, db } = setup({ is_member: 1 });
  db.prepare(`INSERT INTO role_grants (id, user_id, role, granted_at) VALUES ('g1','u1','content.etkinlikler.edit',1)`).run();
  const res = await upload(env, jpeg(800, 600));
  assert.equal(res.status, 200);
  const { key } = await res.json() as { key: string };
  const row = db.prepare(`SELECT user_id, target_type, target_id FROM audit_log WHERE action = 'media.upload'`).get();
  assert.deepEqual({ ...row as object }, { user_id: 'u1', target_type: 'image', target_id: key });
});

test('an expired or revoked content grant does not allow uploads', async () => {
  const { env, db } = setup({ is_member: 1 });
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_at) VALUES ('g1','u1','content.etkinlikler.edit',2,1)`).run();
  assert.equal((await upload(env, jpeg(10, 10))).status, 403);
});
