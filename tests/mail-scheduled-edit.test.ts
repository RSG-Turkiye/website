import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { onRequestPatch } from '../functions/api/mail/scheduled';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');

test('editing a queued mail gives it a fresh retry window', async () => {
  // The edit used to keep the row's give-up clock. A row whose first attempt
  // was today, moved to tomorrow, was retired at tomorrow's first tick with
  // no new attempt -- deleted unsent.
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_sender, created_at, last_login) VALUES ('u1','g1','sender@example.org',1,1,1)`).run();
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',4000000000,1)`).run();
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`INSERT INTO scheduled_emails (id, sender_user_id, recipients, subject, body, scheduled_at, attempts, first_tried_at, last_error, created_at, updated_at)
              VALUES ('row-1','u1','["a@example.org"]','Old','Old body',?,3,?,'rate_limit_day',?,?)`).run(now - 600, now - 5 * 3600, now - 7200, now - 600);

  const res = await onRequestPatch({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/mail/scheduled', {
      method: 'PATCH',
      headers: { Cookie: 'rsg_session=s1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'row-1', to: 'a@example.org', subject: 'New', body: 'New body', scheduled_at: now + 86400 }),
    }),
    env: { DB: d1(db) },
  } as never);
  assert.equal(res.status, 200, await res.clone().text());

  const row = db.prepare(`SELECT subject, attempts, first_tried_at, last_error FROM scheduled_emails WHERE id = 'row-1'`).get() as Record<string, unknown>;
  assert.equal(row.subject, 'New');
  assert.equal(row.attempts, 0);
  assert.equal(row.first_tried_at, null);
  assert.equal(row.last_error, null);
});
