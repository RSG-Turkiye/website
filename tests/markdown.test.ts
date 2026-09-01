import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody } from '../functions/_lib/markdown';

test('a labelled link becomes an anchor in html and "text (url)" in plain text', () => {
  const r = renderBody('See the [programme](https://rsg-turkiye.iscbsc.org/events) for details.');
  assert.match(r.html, /<a href="https:\/\/rsg-turkiye\.iscbsc\.org\/events">programme<\/a>/);
  assert.equal(r.text, 'See the programme (https://rsg-turkiye.iscbsc.org/events) for details.');
});

test('a bare url is linkified with itself as the label', () => {
  const r = renderBody('Details: https://example.org/x');
  assert.match(r.html, /<a href="https:\/\/example\.org\/x">https:\/\/example\.org\/x<\/a>/);
  assert.equal(r.text, 'Details: https://example.org/x');
});

test('a labelled link is not double-linkified by the bare-url pass', () => {
  const r = renderBody('[site](https://example.org)');
  assert.equal((r.html.match(/<a /g) ?? []).length, 1, 'expected exactly one anchor');
});

test('only http and https urls become links', () => {
  for (const bad of ['[x](javascript:alert(1))', '[x](mailto:a@b.com)', '[x](/relative/path)']) {
    assert.doesNotMatch(renderBody(bad).html, /<a /, bad + ' must not produce an anchor');
  }
});

test('html typed by the member is escaped, never emitted as markup', () => {
  const r = renderBody('<script>alert(1)</script> & <b>bold</b>');
  assert.doesNotMatch(r.html, /<script|<b>/);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(r.html, /&amp;/);
});

test('a link label is escaped independently of its url', () => {
  const r = renderBody('[<b>x</b>](https://example.org)');
  assert.match(r.html, /<a href="https:\/\/example\.org">&lt;b&gt;x&lt;\/b&gt;<\/a>/);
});

test('an ampersand in a url survives into the href as an entity', () => {
  const r = renderBody('[q](https://example.org/s?a=1&b=2)');
  assert.match(r.html, /href="https:\/\/example\.org\/s\?a=1&amp;b=2"/);
  assert.equal(r.text, 'q (https://example.org/s?a=1&b=2)');
});

test('bold and italic render, and their markers are stripped from plain text', () => {
  const r = renderBody('**Sayın** *Hocam*');
  assert.match(r.html, /<strong>Sayın<\/strong>/);
  assert.match(r.html, /<em>Hocam<\/em>/);
  assert.equal(r.text, 'Sayın Hocam');
});

test('dash lines become a single list, and stay as written in plain text', () => {
  const r = renderBody('Program:\n\n- Açılış\n- Panel\n- Kapanış');
  assert.match(r.html, /<ul><li>Açılış<\/li><li>Panel<\/li><li>Kapanış<\/li><\/ul>/);
  assert.equal(r.text, 'Program:\n\n- Açılış\n- Panel\n- Kapanış');
});

test('blank lines separate paragraphs and single newlines are line breaks', () => {
  const r = renderBody('Bir\niki\n\nüç');
  assert.match(r.html, /<p>Bir<br>iki<\/p>/);
  assert.match(r.html, /<p>üç<\/p>/);
});

test('a body with no markdown at all is unchanged in the plain-text half', () => {
  const src = 'Sayın Hocam,\n\nSizi sempozyumumuza davet etmek isteriz.\n\nSaygılarımla';
  assert.equal(renderBody(src).text, src);
});

test('control characters are stripped so member input cannot forge the placeholder', () => {
  const r = renderBody('a \u00000\u0000 b [x](https://example.org)');
  assert.doesNotMatch(r.html, /\u0000/);
  assert.match(r.html, /<a href="https:\/\/example\.org">x<\/a>/);
});

test('the html half is wrapped in an html document', () => {
  const r = renderBody('hello');
  assert.match(r.html, /^<html><body>/);
  assert.match(r.html, /<\/body><\/html>$/);
});
