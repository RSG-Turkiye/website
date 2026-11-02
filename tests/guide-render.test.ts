import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionBody } from '../src/scripts/admin/sections/guide-render';
import { readCachedIndex, INDEX_TTL_SECONDS } from '../src/lib/guide-index-cache';

test('Final #5: a suggestion shows its whole text, line breaks kept, escaped, with a clickable http(s) link', () => {
  const html = suggestionBody('Yeni satır 1\nYeni <b>satır</b> 2', 'https://ilan.example.edu.tr/a?x=1&y=2');
  assert.match(html, /whitespace-pre-line/);
  assert.ok(html.includes('Yeni satır 1\nYeni &lt;b&gt;satır&lt;/b&gt; 2'));
  assert.ok(html.includes('href="https://ilan.example.edu.tr/a?x=1&amp;y=2"'));
  assert.ok(!suggestionBody('x', 'javascript:alert(1)').includes('href='), 'a non-http link is shown as text, never as a link');
});

test('Final #6: the browser copy of the index expires after five minutes', () => {
  assert.equal(INDEX_TTL_SECONDS, 300);
  const stored = JSON.stringify({ at: 1000, index: { generatedAt: 'x', professors: [], labs: [] } });
  assert.ok(readCachedIndex(stored, 1000 + 299));
  assert.equal(readCachedIndex(stored, 1000 + 301), null);
  assert.equal(readCachedIndex('{"generatedAt":"old shape"}', 1000), null, 'an old-format copy is refetched');
  assert.equal(readCachedIndex(null, 1000), null);
});
