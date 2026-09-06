import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  announcementText,
  announcementExpiry,
  announcementUrl,
  MAX_TITLE,
  MAX_DESCRIPTION,
  MAX_BUTTON_TEXT,
  EARLIEST_EXPIRY,
  LATEST_EXPIRY,
} from '../functions/_lib/announcement';
import { parseHttpUrl } from '../functions/_lib/url';

/**
 * What an announcement is allowed to contain.
 *
 * The create endpoint checked three string lengths and the truthiness of the
 * rest; the edit endpoint called .length on whatever arrived, so a numeric
 * title passed and was stored as a number. Neither looked at the two fields
 * that can do damage.
 */

// --- the expiry that does not expire -----------------------------------------

test('SQLite really does sort every text above every integer', () => {
  // The premise, checked rather than asserted from memory: this is why a text
  // expires_at makes an announcement permanent. `WHERE expires_at > ?` is
  // true for ever, on the home page of every visitor, with no error anywhere.
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE a (expires_at INTEGER)');
  db.exec(`INSERT INTO a VALUES ('2026-12-31')`);
  const far = 4_000_000_000;
  const rows = db.prepare('SELECT COUNT(*) AS n FROM a WHERE expires_at > ?').all(far) as {
    n: number;
  }[];
  assert.equal(rows[0].n, 1, 'a date string outlives a timestamp fifty years away');
  db.close();
});

test('a date string is refused', () => {
  assert.equal(announcementExpiry('2026-12-31').ok, false);
});

test('milliseconds are refused, because they would never expire either', () => {
  // The mistake a browser makes every time: Date.now() rather than /1000.
  assert.equal(announcementExpiry(Date.now()).ok, false);
  const result = announcementExpiry(1_788_700_000_000);
  assert.match(result.ok === false ? result.error : '', /millisecond/i);
});

test('zero is refused, because 1970 reads as unset and behaves as expired', () => {
  assert.equal(announcementExpiry(0).ok, false);
});

test('a real timestamp is accepted, and the bounds are where they say', () => {
  assert.deepEqual(announcementExpiry(1_788_700_000), { ok: true, value: 1_788_700_000 });
  assert.equal(announcementExpiry(EARLIEST_EXPIRY).ok, true);
  assert.equal(announcementExpiry(LATEST_EXPIRY).ok, true);
  assert.equal(announcementExpiry(EARLIEST_EXPIRY - 1).ok, false);
  assert.equal(announcementExpiry(LATEST_EXPIRY + 1).ok, false);
});

test('anything that is not a whole number is refused', () => {
  for (const bad of [null, undefined, {}, [], 1.5, NaN, Infinity, '1788700000']) {
    assert.equal(announcementExpiry(bad).ok, false, String(bad));
  }
});

// --- the button link ----------------------------------------------------------

test('a javascript: link is refused at the door', () => {
  // The home page neutralises this when it renders; the symposium side has
  // always refused it here. The two surfaces write the same column.
  assert.equal(announcementUrl('javascript:alert(1)', true).ok, false);
  assert.equal(announcementUrl('data:text/html,<script>', true).ok, false);
});

test('an http(s) link is kept', () => {
  assert.deepEqual(announcementUrl('https://example.org/a', true), {
    ok: true,
    value: 'https://example.org/a',
  });
  assert.equal(announcementUrl('http://example.org', true).ok, true);
});

test('a link with no scheme is refused rather than guessed at', () => {
  assert.equal(announcementUrl('example.org', true).ok, false);
  assert.equal(announcementUrl('/somewhere', true).ok, false);
});

test('the moved helper still behaves exactly as it did', () => {
  // It lived in _lib/symposium.ts and the symposium CMS still calls it.
  assert.equal(parseHttpUrl('https://example.org', 'x'), 'https://example.org');
  assert.equal(parseHttpUrl('', 'x'), '');
  assert.equal(parseHttpUrl(undefined, 'x'), '');
  assert.throws(() => parseHttpUrl('javascript:alert(1)', 'Button URL'), /Button URL/);
});

// --- the text fields ----------------------------------------------------------

test('a non-string field is refused rather than coerced', () => {
  // The edit endpoint called .length on this and a number sailed through.
  assert.equal(announcementText(42, MAX_TITLE, 'Title', true).ok, false);
  assert.equal(announcementText({}, MAX_TITLE, 'Title', true).ok, false);
});

test('the length limits are the ones the endpoints used', () => {
  assert.equal(announcementText('a'.repeat(MAX_TITLE), MAX_TITLE, 'Title', true).ok, true);
  assert.equal(announcementText('a'.repeat(MAX_TITLE + 1), MAX_TITLE, 'Title', true).ok, false);
  assert.deepEqual([MAX_TITLE, MAX_DESCRIPTION, MAX_BUTTON_TEXT], [80, 200, 30]);
});

test('a required field cannot be empty, and the error names it', () => {
  const result = announcementText('', MAX_TITLE, 'Title', true);
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /Title/);
});
