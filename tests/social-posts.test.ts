import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import {
  parseDraft, linkOk, readinessProblems, mediaDims, canEditPost, canDeletePost, canCancelPost, statusAfterEdit, statusOnSubmit,
  updatePostGuarded, targetStatements, POST_PROOF, type DraftInput,
} from '../functions/_lib/social-posts';
import { eventCovers, coveringEvent, type EventModeRow } from '../functions/_lib/social-events';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const KEY_A = '11111111-1111-4111-8111-111111111111.jpg';
const KEY_B = '22222222-2222-4222-8222-222222222222.jpg';
const NOW = 1_800_000_000;

test('parseDraft accepts a sparse draft and fills defaults', () => {
  const r = parseDraft({ type: 'image' });
  assert.deepEqual(r, { ok: true, value: { type: 'image', caption: '', captionOverrides: {}, link: null, media: [], platforms: [], scheduledAt: null } });
});

test('parseDraft refuses wrong shapes with a code', () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ type: 'reel' }, 'invalid_type'],
    [{ type: 'image', caption: 7 }, 'invalid_caption'],
    [{ type: 'image', captionOverrides: { myspace: 'x' } }, 'invalid_overrides'],
    [{ type: 'image', captionOverrides: { constructor: 'x' } }, 'invalid_overrides'],
    [{ type: 'image', link: 'http://example.org' }, 'invalid_link'],
    [{ type: 'image', media: [{ key: '../etc/passwd', alt: '' }] }, 'invalid_media'],
    [{ type: 'image', media: Array.from({ length: 11 }, () => ({ key: KEY_A, alt: 'x' })) }, 'too_many_items'],
    [{ type: 'image', platforms: ['instagram', 'instagram'] }, 'invalid_platforms'],
    [{ type: 'image', platforms: ['toString'] }, 'invalid_platforms'],
    [{ type: 'image', scheduledAt: 1.5 }, 'invalid_schedule'],
  ];
  for (const [body, code] of bad) assert.deepEqual(parseDraft(body), { ok: false, code }, code);
});

test('linkOk: a whole https address only, so a half-typed one is never saved', () => {
  assert.equal(linkOk('https://rsg-turkiye.iscbsc.org'), true);
  assert.equal(linkOk('https://example.org/a?b=c'), true);
  for (const half of ['h', 'https', 'https:/', 'https://', 'http://example.org']) assert.equal(linkOk(half), false, half);
});

test('parseDraft keeps a cropped image\'s original and crop area, and refuses a malformed one', () => {
  const source = { key: KEY_B, mode: 'crop', x: 0, y: 120, w: 1080, h: 1350 };
  const r = parseDraft({ type: 'image', media: [{ key: KEY_A, alt: 'Afiş', source: { ...source, extra: 'dropped' } }] });
  assert.deepEqual(r.ok && r.value.media, [{ key: KEY_A, alt: 'Afiş', source }]);
  for (const bad of [
    { ...source, key: '../x' }, { ...source, mode: 'stretch' }, { ...source, w: 0 }, { ...source, x: -1 }, { ...source, y: 1.5 }, 'x',
  ]) {
    assert.deepEqual(parseDraft({ type: 'image', media: [{ key: KEY_A, alt: '', source: bad }] }), { ok: false, code: 'invalid_media' }, JSON.stringify(bad));
  }
});

const ready = (over: Partial<DraftInput> = {}): DraftInput => ({
  type: 'image', caption: 'Merhaba', captionOverrides: {}, link: null,
  media: [{ key: KEY_A, alt: 'Afiş' }], platforms: ['instagram'], scheduledAt: NOW + 3600, ...over,
});
const dims = new Map([[KEY_A, { width: 1080, height: 1350 }], [KEY_B, { width: 1080, height: 1920 }]]);
const codes = (p: DraftInput) => readinessProblems(p, dims, NOW).map((x) => x.code);

test('a complete post has no problems', () => {
  assert.deepEqual(readinessProblems(ready(), dims, NOW), []);
});

test('readiness: every rule says what is wrong', () => {
  assert.deepEqual(codes(ready({ platforms: [] })), ['no_platform']);
  assert.deepEqual(codes(ready({ platforms: ['x'] })), ['platform_unavailable']);
  assert.deepEqual(codes(ready({ media: [{ key: KEY_A, alt: '  ' }] })), ['missing_alt']);
  assert.deepEqual(codes(ready({ media: [] })), ['media_count']);
  assert.deepEqual(codes(ready({ type: 'carousel' })), ['media_count'], 'a carousel needs at least two');
  assert.deepEqual(codes(ready({ media: [{ key: KEY_B, alt: 'x' }] })), ['bad_ratio'], 'the server size wins, not the claim');
  assert.deepEqual(codes(ready({ media: [{ key: '33333333-3333-4333-8333-333333333333.jpg', alt: 'x' }] })), ['unknown_media']);
  assert.deepEqual(codes(ready({ type: 'story', media: [{ key: KEY_B, alt: 'x' }], platforms: ['instagram', 'linkedin'] })), ['story_instagram_only']);
  assert.deepEqual(codes(ready({ type: 'story', media: [{ key: KEY_B, alt: 'x' }] })), []);
  assert.deepEqual(codes(ready({ scheduledAt: null })), ['no_schedule']);
  assert.deepEqual(codes(ready({ scheduledAt: NOW - 60 })), ['schedule_in_past']);
  assert.deepEqual(codes(ready({ caption: 'a'.repeat(2201) })), ['caption_too_long']);
});

test('mediaDims reads the server record, and an empty list asks nothing', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, 1080, 1350, 'image/jpeg', 1, 'u', 1)`).run(KEY_A);
  const m = await mediaDims(d1(db) as never, [KEY_A, KEY_B]);
  assert.deepEqual([...m.entries()], [[KEY_A, { width: 1080, height: 1350 }]]);
  assert.equal((await mediaDims(d1(db) as never, [])).size, 0);
});

const editor = { id: 'ed', isPublisher: false };
const publisher = { id: 'pub', isPublisher: true };

test('who may edit, delete and cancel', () => {
  const own = (status: string) => ({ status: status as never, created_by: 'ed' });
  const other = (status: string) => ({ status: status as never, created_by: 'someone' });
  assert.equal(canEditPost(editor, own('draft')), true);
  assert.equal(canEditPost(editor, own('scheduled')), true);
  assert.equal(canEditPost(editor, other('draft')), false);
  assert.equal(canEditPost(publisher, other('scheduled')), true);
  for (const s of ['published', 'partially_published', 'cancelled']) assert.equal(canEditPost(publisher, other(s)), false, s);
  assert.equal(canDeletePost(editor, own('draft')), true);
  assert.equal(canDeletePost(editor, own('pending_approval')), false);
  assert.equal(canDeletePost(publisher, other('rejected')), true);
  assert.equal(canCancelPost(editor, own('pending_approval')), true);
  assert.equal(canCancelPost(editor, other('scheduled')), false);
  assert.equal(canCancelPost(publisher, other('scheduled')), true);
  assert.equal(canCancelPost(publisher, other('draft')), false);
});

test('status after an edit and on submit', () => {
  assert.equal(statusAfterEdit(editor, 'scheduled', false), 'pending_approval');
  assert.equal(statusAfterEdit(editor, 'scheduled', true), 'scheduled', 'a covered event story stays scheduled');
  assert.equal(statusAfterEdit(publisher, 'scheduled', false), 'scheduled');
  assert.equal(statusAfterEdit(editor, 'rejected', false), 'draft');
  assert.equal(statusAfterEdit(editor, 'pending_approval', false), 'pending_approval');
  assert.equal(statusOnSubmit(editor, false), 'pending_approval');
  assert.equal(statusOnSubmit(editor, true), 'scheduled');
  assert.equal(statusOnSubmit(publisher, false), 'scheduled');
});

test('event coverage: open, in time, and naming the editor', () => {
  const mode: EventModeRow = { id: 'e', name: 'Sempozyum', starts_at: NOW - 10, ends_at: NOW + 10, editor_ids: '["ed"]', opened_by: 'pub', closed_by: null, closed_at: null, created_at: NOW - 20 };
  assert.equal(eventCovers(mode, 'ed', NOW), true);
  assert.equal(eventCovers(mode, 'other', NOW), false);
  assert.equal(eventCovers(mode, 'ed', NOW + 10), false, 'ends_at is exclusive');
  assert.equal(eventCovers({ ...mode, closed_at: NOW - 1 }, 'ed', NOW), false);
  assert.equal(eventCovers({ ...mode, editor_ids: 'not json' }, 'ed', NOW), false);
});

test('coveringEvent finds the open window for this editor', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_event_modes (id, name, starts_at, ends_at, editor_ids, opened_by, created_at) VALUES ('e','S',?,?,'["ed"]','pub',1)`).run(NOW - 10, NOW + 10);
  assert.equal((await coveringEvent(d1(db) as never, 'ed', NOW))?.id, 'e');
  assert.equal(await coveringEvent(d1(db) as never, 'other', NOW), null);
});

test('guarded update and targets act only when this write landed', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO social_posts (id, type, created_by, created_at, updated_at) VALUES ('p','image','ed',1,1)`).run();
  const DB = d1(db) as never as D1Database;
  const stale = await DB.batch([updatePostGuarded(DB, 'p', 5, 'n-stale', { status: 'scheduled' }, NOW), ...targetStatements(DB, 'p', 'n-stale', ['instagram'], NOW)]);
  assert.equal((stale[0] as { meta: { changes: number } }).meta.changes, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 0);
  await DB.batch([updatePostGuarded(DB, 'p', 0, 'n-win', { status: 'scheduled' }, NOW), ...targetStatements(DB, 'p', 'n-win', ['instagram', 'linkedin'], NOW)]);
  assert.deepEqual({ ...db.prepare('SELECT status, revision, write_nonce FROM social_posts').get() as object }, { status: 'scheduled', revision: 1, write_nonce: 'n-win' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 2);
  // A loser that read revision 0 too, arriving after: its guard misses and its targets do not overwrite the winner's.
  await DB.batch([updatePostGuarded(DB, 'p', 0, 'n-lose', { status: 'scheduled' }, NOW), ...targetStatements(DB, 'p', 'n-lose', ['linkedin'], NOW)]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM social_post_targets').get() as { n: number }).n, 2);
  assert.match(POST_PROOF, /write_nonce = \?/);
});

test('updatePostGuarded refuses a column outside the allow-list and an undefined value', () => {
  const db = { prepare: () => ({ bind: () => ({}) }) } as never;
  assert.throws(() => updatePostGuarded(db, 'i', 0, 'n', { 'caption = 1, status': 'x' } as never, 1), /unknown column/);
  assert.throws(() => updatePostGuarded(db, 'i', 0, 'n', { caption: undefined }, 1), /undefined value/);
  assert.doesNotThrow(() => updatePostGuarded(db, 'i', 0, 'n', { caption: 'ok', review_note: null }, 1));
});

test('parseDraft refuses a scheduledAt beyond the safe integers', () => {
  assert.deepEqual(parseDraft({ type: 'image', scheduledAt: 2 ** 60 }), { ok: false, code: 'invalid_schedule' });
});

test('readiness refuses a non-JPEG image: Instagram publishes JPEG only', () => {
  const png = '33333333-3333-4333-8333-333333333333.png';
  const d = new Map([[png, { width: 1080, height: 1350 }]]);
  assert.deepEqual(readinessProblems(ready({ media: [{ key: png, alt: 'x' }] }), d, NOW).map((p) => [p.code, p.index]), [['not_jpeg', 0]]);
});

test('a failed post can be fixed: it is no longer locked, and an editor\'s edit goes back for approval', () => {
  assert.equal(canEditPost({ id: 'ed', isPublisher: false }, { status: 'failed', created_by: 'ed' }), true);
  assert.equal(canEditPost({ id: 'ed', isPublisher: false }, { status: 'partially_published', created_by: 'ed' }), false);
  assert.equal(statusAfterEdit({ id: 'pub', isPublisher: true }, 'failed', false), 'scheduled');
  assert.equal(statusAfterEdit({ id: 'ed', isPublisher: false }, 'failed', false), 'pending_approval');
});
