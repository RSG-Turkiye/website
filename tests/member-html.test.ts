import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, safeAvatarUrl } from '../src/scripts/escape-html';
import { optionalText, avatarUrl, MAX_INSTITUTION, MAX_BIO } from '../functions/_lib/profile';

/**
 * A member's own text, on its way into a page.
 *
 * The members directory and the admin user table both build their rows as
 * strings and assign them to innerHTML, and until 2026-09-06 they did that
 * with display_name, institution and bio unescaped. Anyone could sign in with
 * a Google account, put markup in their bio, and have it run in the browser of
 * every signed-in visitor -- and in the admin panel, where a same-origin
 * request can grant its sender is_admin, and where a new account appears at
 * the top of the list.
 *
 * These are the two halves of the fix: escaping at the sink, which is what
 * actually makes it safe, and refusing at the source, which is what stops the
 * fields being used as unbounded storage.
 */

// --- escaping at the sink ---------------------------------------------------

test('the characters that end an element or an attribute are escaped', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('" onerror="x'), '&quot; onerror=&quot;x');
  assert.equal(escapeHtml("' onerror='x"), '&#39; onerror=&#39;x');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('the escaping runs before the ampersand can be re-read', () => {
  // & must be replaced first, or "&lt;" written by hand becomes "&amp;lt;".
  assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
});

test('the payload from the incident cannot close the attribute it sits in', () => {
  const payload = '"><img src=x onerror="fetch(\'/api/admin/users\',{method:\'PATCH\'})">';
  const rendered = `<div title="${escapeHtml(payload)}">x</div>`;
  assert.ok(!rendered.includes('<img'), 'no tag survives');
  assert.equal(rendered.match(/"/g)?.length, 2, 'exactly the two quotes the markup wrote');
});

test('nothing renders as the string "null" or "undefined"', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

// --- the avatar URL ---------------------------------------------------------

test('an avatar from the upload host is kept', () => {
  assert.equal(
    safeAvatarUrl('https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg'),
    'https://res.cloudinary.com/demo/image/upload/v1/avatar.jpg',
  );
});

test('the prefix trick that a startsWith check let through is refused or defanged', () => {
  // This is what the server accepted: it starts with the expected string, and
  // in an img tag built by concatenation it closed the attribute and ran.
  const hostile = 'https://res.cloudinary.com/x" onerror="alert(1)';
  const cleaned = safeAvatarUrl(hostile);
  assert.ok(cleaned !== null, 'the host really is the upload host, so parsing keeps it');
  assert.ok(!cleaned!.includes('"'), 'but the quote is percent-encoded away');
  assert.ok(!`<img src="${escapeHtml(cleaned)}">`.includes('onerror="'), 'and the sink escapes too');
});

test('another host, another scheme, and nonsense are all refused', () => {
  assert.equal(safeAvatarUrl('https://evil.example/x.jpg'), null);
  assert.equal(safeAvatarUrl('http://res.cloudinary.com/x.jpg'), null, 'http is not https');
  assert.equal(safeAvatarUrl('javascript:alert(1)'), null);
  assert.equal(safeAvatarUrl('res.cloudinary.com/x.jpg'), null, 'no scheme is not a URL');
  assert.equal(safeAvatarUrl(''), null);
  assert.equal(safeAvatarUrl(null), null);
});

test('a host that merely contains the upload host is refused', () => {
  assert.equal(safeAvatarUrl('https://res.cloudinary.com.evil.example/x.jpg'), null);
  assert.equal(safeAvatarUrl('https://notres.cloudinary.com/x.jpg'), null);
});

test('the server and the page agree on what an avatar is', () => {
  // Two copies of this rule would drift, and the pair is what protects the
  // img tag. If they ever disagree, this fails rather than one of them
  // quietly becoming decorative.
  for (const candidate of [
    'https://res.cloudinary.com/demo/a.jpg',
    'https://res.cloudinary.com/x" onerror="alert(1)',
    'https://evil.example/x.jpg',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(avatarUrl(candidate), safeAvatarUrl(candidate), candidate);
  }
});

// --- refusing at the source -------------------------------------------------

test('an institution and a bio are bounded', () => {
  assert.equal(optionalText('a'.repeat(MAX_INSTITUTION), MAX_INSTITUTION, 'Institution').ok, true);
  assert.equal(optionalText('a'.repeat(MAX_INSTITUTION + 1), MAX_INSTITUTION, 'Institution').ok, false);
  assert.equal(optionalText('a'.repeat(MAX_BIO), MAX_BIO, 'Bio').ok, true);
  assert.equal(optionalText('a'.repeat(MAX_BIO + 1), MAX_BIO, 'Bio').ok, false);
});

test('the limits clear the longest profile anyone actually has', () => {
  // Measured on 2026-09-06: ten profiles, longest institution 26, longest bio
  // 219. A limit that rejected existing data would break the next save of a
  // member who had done nothing wrong.
  assert.ok(MAX_INSTITUTION > 26);
  assert.ok(MAX_BIO > 219);
});

test('an emptied field is stored as absent, not as an empty string', () => {
  assert.deepEqual(optionalText('   ', 120, 'Institution'), { ok: true, value: null });
  assert.deepEqual(optionalText(undefined, 120, 'Institution'), { ok: true, value: null });
  assert.deepEqual(optionalText(null, 120, 'Institution'), { ok: true, value: null });
});

test('a field that is not text is refused rather than coerced', () => {
  assert.equal(optionalText(42, 120, 'Institution').ok, false);
  assert.equal(optionalText({ toString: () => 'x' }, 120, 'Institution').ok, false);
});

test('surrounding whitespace is trimmed', () => {
  assert.deepEqual(optionalText('  METU  ', 120, 'Institution'), { ok: true, value: 'METU' });
});
