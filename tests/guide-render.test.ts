import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestionBody, removalNoticeTemplate, removalNoticeForm } from '../src/scripts/admin/sections/guide-render';
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

test('the removal notice is bilingual, names the person, and links the guide on our own domain', () => {
  const n = removalNoticeTemplate('Doç. Dr.', 'Deneme Hoca');
  assert.match(n.subject, /kaldırıldı/);
  assert.match(n.subject, /removed/);
  assert.match(n.text, /Sayın Doç\. Dr\. Deneme Hoca/);
  assert.match(n.text, /Dear Doç\. Dr\. Deneme Hoca/);
  assert.match(n.text, /https:\/\/rsg-turkiye\.iscbsc\.org\/tr\/guide\//);
  assert.doesNotMatch(n.text, /pages\.dev|workers\.dev/);
  assert.match(n.text, /yanıtla/, 'tells them how to undo a false alarm');
  assert.equal(removalNoticeTemplate('', 'Deneme Hoca').text.split('\n')[0], 'Sayın Deneme Hoca,', 'no stray space without a title');
});

test('the notice form escapes what it shows', () => {
  const html = removalNoticeForm(7, { subject: '<b>s</b>', text: '<script>x</script>' }, { to: 'E-posta', hint: 'h', subject: 'Konu', text: 'Metin', send: 'Gönder', skip: 'Atla', cancel: 'Vazgeç' });
  assert.ok(!html.includes('<script>x'));
  assert.match(html, /data-notice-form="7"/);
  assert.match(html, /type="email"/);
});
