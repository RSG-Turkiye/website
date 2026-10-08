import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRss } from '../functions/_lib/opportunity-rss';

test('rss escapes Turkish text and ampersands into valid XML', () => {
  const xml = renderRss([{
    id: 'a', url: 'https://ex.org/?a=1&b=2', title: 'Doğa & Genomik <PhD>', title_tr: 'Doğa & Genomik', summary_tr: 'Şartlar: ı, ğ, ü',
    source: 'tess', type: 'course', levels: ['phd'], deadline: null, starts_at: null, country: 'TR', online: false,
    cost_note: '', eligibility_note: '', published_at: 1790000000, expires_at: 1795000000,
  }], 'https://rsg-turkiye.iscbsc.org');
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes('Doğa &amp; Genomik'));
  assert.ok(xml.includes('?a=1&amp;b=2'));
  assert.ok(!xml.includes('<PhD>'));
});
