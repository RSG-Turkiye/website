import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestUrl } from '../src/lib/guide-text';
import { GUIDE_FORM } from '../src/data/guide-form';

test('the correction link opens the Google Form with the record id filled in', () => {
  const u = new URL(suggestUrl('p_0123456789ab', 'tr'));
  assert.equal(`${u.origin}${u.pathname}`, GUIDE_FORM.url);
  assert.equal(u.searchParams.get('usp'), 'pp_url');
  assert.equal(u.searchParams.get(`entry.${GUIDE_FORM.recordField}`), 'p_0123456789ab');
});

test('the Form link is a Google Forms address and the record field is a number', () => {
  assert.match(GUIDE_FORM.url, /^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/);
  assert.match(GUIDE_FORM.recordField, /^\d+$/);
});
