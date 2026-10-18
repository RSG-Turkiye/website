import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestGet } from '../functions/api/admin/announcements';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

test('the admin list says which site each announcement belongs to', async () => {
  // The panel's edit form takes the site from this list and sends it back on
  // save. When the list left it out, the form fell back to "main", so saving
  // any edit moved a symposium announcement off the symposium site.
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, created_at, last_login) VALUES ('u1','g1','admin@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const insert = db.prepare(`INSERT INTO announcements (id, site, title, description, button_text, button_url, show_as_popup, expires_at, created_by, created_at) VALUES (?, ?, 't', 'd', 'b', 'https://example.org', 0, 4000000000, 'u1', ?)`);
  insert.run('a-main', 'main', 1);
  insert.run('a-sym', 'symposium', 2);

  const res = await onRequestGet({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/announcements', { headers: { Cookie: 'rsg_session=s1' } }),
    env: { DB: d1(db) },
  } as never);
  const body = await res.json() as { announcements: { id: string; site: string }[] };
  assert.deepEqual(Object.fromEntries(body.announcements.map((a) => [a.id, a.site])), { 'a-main': 'main', 'a-sym': 'symposium' });
});
