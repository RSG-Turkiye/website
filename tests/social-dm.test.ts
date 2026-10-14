import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  dmView, istanbulHour, istanbulDayStart, isQuietHour, digestFresh, digestList, mayDigest, lastCallDue,
  WINDOW_SECONDS, type DmThreadRow,
} from '../functions/_lib/social-dm';

// 2026-10-15 09:00 UTC = 12:00 Istanbul.
const NOON = Date.UTC(2026, 9, 15, 9, 0) / 1000;
const H = 3600;
const row = (o: Partial<DmThreadRow> = {}): DmThreadRow => ({
  id: 't1', platform: 'instagram', conversation_id: 'c1', peer_id: 'p1', peer_username: 'ayse',
  last_inbound_at: NOON - H, last_outbound_at: null, read_at: null, read_by: null,
  digested_at: null, final_warned_at: null, updated_at: NOON - H, ...o,
});

test('the schema has both DM tables', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8'));
  db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('a','instagram','c','p',1)`).run();
  assert.throws(() => db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('b','instagram','c','p',1)`).run(), /UNIQUE/);
  assert.throws(() => db.prepare(`INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, updated_at) VALUES ('c','linkedin','c2','p',1)`).run(), /CHECK/);
  db.prepare(`INSERT INTO social_dm_digest_log (user_id, sent_at) VALUES ('u', 1)`).run();
});

test('an incoming message an hour old is open, unread, with 23 hours left', () => {
  const v = dmView(row(), NOON);
  assert.deepEqual(v, { unanswered: true, unread: true, expired: false, closesAt: NOON - H + WINDOW_SECONDS, secondsLeft: 23 * H });
});

test('our reply after their message: answered, not unread, not expired', () => {
  const v = dmView(row({ last_outbound_at: NOON - 60 }), NOON);
  assert.equal(v.unanswered, false);
  assert.equal(v.unread, false);
});

test('read after the last incoming message clears unread but not unanswered', () => {
  const v = dmView(row({ read_at: NOON - 30 }), NOON);
  assert.equal(v.unread, false);
  assert.equal(v.unanswered, true);
});

test('past 24 hours: expired, zero left, and not unread', () => {
  const v = dmView(row({ last_inbound_at: NOON - 25 * H }), NOON);
  assert.equal(v.expired, true);
  assert.equal(v.secondsLeft, 0);
  assert.equal(v.unread, false);
});

test('a thread with no incoming message is neither unanswered nor unread', () => {
  const v = dmView(row({ last_inbound_at: null, last_outbound_at: NOON - H }), NOON);
  assert.deepEqual([v.unanswered, v.unread, v.expired, v.closesAt], [false, false, false, null]);
});

test('Istanbul hour and day start are UTC+3', () => {
  assert.equal(istanbulHour(NOON), 12);
  assert.equal(istanbulDayStart(NOON), Date.UTC(2026, 9, 14, 21, 0) / 1000);
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 20, 0) / 1000), true, '23:00');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 4, 59) / 1000), true, '07:59');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 5, 0) / 1000), false, '08:00');
  assert.equal(isQuietHour(Date.UTC(2026, 9, 15, 19, 59) / 1000), false, '22:59');
});

test('digestFresh: unanswered, open, and newer than the last digest', () => {
  const rows = [
    row({ id: 'new' }),
    row({ id: 'seen', digested_at: NOON - H }),
    row({ id: 'answered', last_outbound_at: NOON }),
    row({ id: 'expired', last_inbound_at: NOON - 30 * H }),
    row({ id: 'newer', digested_at: NOON - 2 * H }),
  ];
  assert.deepEqual(digestFresh(rows, NOON).map((r) => r.id), ['new', 'newer']);
  assert.deepEqual(digestList(rows, NOON).map((r) => r.id), ['new', 'seen', 'newer']);
});

test('mayDigest: not in quiet hours, an hour apart, six a day', () => {
  assert.equal(mayDigest([], NOON), true);
  assert.equal(mayDigest([NOON - 59 * 60], NOON), false);
  assert.equal(mayDigest([NOON - H], NOON), true);
  const six = [1, 2, 3, 4, 5, 6].map((n) => istanbulDayStart(NOON) + n * 60);
  assert.equal(mayDigest(six, NOON), false);
  assert.equal(mayDigest(six.map((s) => s - 86400), NOON), true, 'yesterday does not count');
  assert.equal(mayDigest([], Date.UTC(2026, 9, 15, 21, 0) / 1000), false, 'midnight');
});

test('lastCallDue: 20 hours old, unanswered, open, once per incoming message', () => {
  const at = NOON - 20 * H;
  const rows = [
    row({ id: 'due', last_inbound_at: at }),
    row({ id: 'young', last_inbound_at: NOON - 19 * H }),
    row({ id: 'warned', last_inbound_at: at, final_warned_at: at }),
    row({ id: 'warnedEarlier', last_inbound_at: at, final_warned_at: at - 100 }),
    row({ id: 'answered', last_inbound_at: at, last_outbound_at: NOON }),
    row({ id: 'expired', last_inbound_at: NOON - 24 * H }),
  ];
  assert.deepEqual(lastCallDue(rows, NOON).map((r) => r.id), ['due', 'warnedEarlier']);
});

test('a stored 0 means no message', () => {
  assert.equal(dmView(row({ last_inbound_at: 0 }), NOON).unanswered, false);
});
