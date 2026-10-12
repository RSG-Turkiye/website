import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countChars, countHashtags, captionFor, ratioOk, captionProblems, LINK_IN_BIO_LINE,
} from '../functions/_lib/social-limits';

test('characters are counted as the user sees them', () => {
  assert.equal(countChars('şğüöçı'), 6);
  assert.equal(countChars('🧬🎓'), 2, 'an emoji is one character, not two UTF-16 units');
});

test('hashtags include Turkish letters and digits', () => {
  assert.equal(countHashtags('#RSGTürkiye #biyoinformatik #2026 # not'), 3);
});

test('Instagram gets the link-in-bio line, LinkedIn gets the link itself', () => {
  const src = { caption: 'Sertifikalar yayında', captionOverrides: {}, link: 'https://rsg-turkiye.iscbsc.org/certificates' };
  assert.equal(captionFor(src, 'instagram'), `Sertifikalar yayında\n\n${LINK_IN_BIO_LINE}`);
  assert.equal(captionFor(src, 'linkedin'), 'Sertifikalar yayında\n\nhttps://rsg-turkiye.iscbsc.org/certificates');
  assert.equal(captionFor({ ...src, link: null }, 'instagram'), 'Sertifikalar yayında');
});

test('a non-empty override replaces the shared caption for that platform only', () => {
  const src = { caption: 'TR', captionOverrides: { linkedin: 'EN' }, link: null };
  assert.equal(captionFor(src, 'linkedin'), 'EN');
  assert.equal(captionFor(src, 'instagram'), 'TR');
  assert.equal(captionFor({ ...src, captionOverrides: { linkedin: '   ' } }, 'linkedin'), 'TR', 'blank override falls back');
});

test('ratios: feed 4:5 to 1.91:1, story 9:16, with 1% tolerance', () => {
  assert.equal(ratioOk('image', 1080, 1350), true);
  assert.equal(ratioOk('carousel', 1080, 1080), true);
  assert.equal(ratioOk('image', 1910, 1000), true);
  assert.equal(ratioOk('image', 1080, 1920), false, 'a story-shaped image is not a feed post');
  assert.equal(ratioOk('story', 1080, 1920), true);
  assert.equal(ratioOk('story', 1080, 1350), false);
  assert.equal(ratioOk('image', 0, 100), false);
});

test('caption problems per platform; stories have no caption to check', () => {
  const long = 'a'.repeat(2201);
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  const src = { caption: long, captionOverrides: { linkedin: tags }, link: null };
  assert.deepEqual(captionProblems(src, ['instagram', 'linkedin'], 'image'), [
    { code: 'caption_too_long', platform: 'instagram', limit: 2200, actual: 2201 },
  ]);
  assert.deepEqual(captionProblems({ ...src, caption: tags }, ['instagram'], 'image'), [
    { code: 'too_many_hashtags', platform: 'instagram', limit: 30, actual: 31 },
  ]);
  assert.deepEqual(captionProblems(src, ['instagram'], 'story'), []);
});
