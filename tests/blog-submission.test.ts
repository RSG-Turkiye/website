import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  submissionText,
  submissionTags,
  submissionImageUrl,
  tagsFromRow,
  LIMITS,
} from '../functions/_lib/blog-submission';

/**
 * What a member may put in a blog submission.
 *
 * The create endpoint checked that six fields were truthy and nothing else,
 * which left a submission nobody could do anything with. `tags` was stored as
 * JSON.stringify(body.tags ?? []) with no check that it was an array, so
 * "tags": "genomics" put a quoted string in the column -- valid JSON, not a
 * list. The member and admin lists survive it because they only parse; the
 * approve path calls .map on the result and throws, so every attempt to
 * approve is a raw 500 with no error to show. The writer could not fix it
 * either: editing is allowed only on a rejected submission, and rejecting
 * then resubmitting went through the same unchecked line.
 *
 * Nobody has hit it -- all four rows in the database today are proper arrays,
 * checked before this was written.
 */

// --- the tag that could not be approved ---------------------------------------

test('a bare string is refused, and the message says what to do instead', () => {
  const result = submissionTags('genomics');
  assert.equal(result.ok, false);
  assert.match(result.ok === false ? result.error : '', /\["genomics"\]/);
});

test('a list of strings is stored as the JSON the column holds', () => {
  assert.deepEqual(submissionTags(['genomics', 'rna']), { ok: true, value: '["genomics","rna"]' });
});

test('absent tags are an empty list, not an error', () => {
  assert.deepEqual(submissionTags(undefined), { ok: true, value: '[]' });
  assert.deepEqual(submissionTags(null), { ok: true, value: '[]' });
});

test('a list with a non-string in it is refused', () => {
  assert.equal(submissionTags(['ok', 42]).ok, false);
  assert.equal(submissionTags([{ tag: 'x' }]).ok, false);
});

test('blank tags are dropped and duplicates collapse', () => {
  // An empty box in a form is not a mistake worth refusing a submission over.
  assert.deepEqual(submissionTags(['rna', '  ', 'rna', ' dna ']), {
    ok: true,
    value: '["rna","dna"]',
  });
});

test('the counts and lengths are bounded', () => {
  assert.equal(submissionTags(Array(LIMITS.tags + 1).fill('x')).ok, false);
  assert.equal(submissionTags(['a'.repeat(LIMITS.tag + 1)]).ok, false);
  assert.equal(submissionTags(['a'.repeat(LIMITS.tag)]).ok, true);
});

// --- reading a row that predates any of this ----------------------------------

test('a row whose tags are not a list reads as no tags, rather than throwing', () => {
  // This is what unsticks a submission that is already in the database in the
  // broken shape: published without its tags beats never publishable.
  assert.deepEqual(tagsFromRow('"genomics"'), []);
  assert.deepEqual(tagsFromRow('not json at all'), []);
  assert.deepEqual(tagsFromRow('{"a":1}'), []);
});

test('a good row still reads as its tags', () => {
  assert.deepEqual(tagsFromRow('["genomics","rna"]'), ['genomics', 'rna']);
});

test('a list with junk in it keeps the strings', () => {
  assert.deepEqual(tagsFromRow('["ok",42,null,"fine"]'), ['ok', 'fine']);
});

// --- the other field that threw before anything was stored --------------------

test('a non-string title is refused rather than reaching slugify', () => {
  // slugify calls .replace on it; a number threw a raw 500 with nothing saved.
  assert.equal(submissionText(42, LIMITS.title, 'Title').ok, false);
  assert.equal(submissionText(null, LIMITS.title, 'Title').ok, false);
});

test('required text is required, and bounded', () => {
  assert.equal(submissionText('   ', LIMITS.title, 'Title').ok, false);
  assert.equal(submissionText('a'.repeat(LIMITS.title), LIMITS.title, 'Title').ok, true);
  assert.equal(submissionText('a'.repeat(LIMITS.title + 1), LIMITS.title, 'Title').ok, false);
});

test('text is trimmed', () => {
  assert.deepEqual(submissionText('  A post  ', LIMITS.title, 'Title'), { ok: true, value: 'A post' });
});

// --- the hero image goes into published frontmatter ---------------------------

test('an image URL must be http(s), because it is written into the post', () => {
  assert.equal(submissionImageUrl('javascript:alert(1)').ok, false);
  assert.equal(submissionImageUrl('/local/path.png').ok, false);
  assert.equal(submissionImageUrl('https://res.cloudinary.com/a.png').ok, true);
});

test('no image is not an error', () => {
  assert.deepEqual(submissionImageUrl(''), { ok: true, value: '' });
  assert.deepEqual(submissionImageUrl(undefined), { ok: true, value: '' });
});
