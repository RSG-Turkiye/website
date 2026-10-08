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

import { toPublicItem } from '../functions/_lib/opportunity-rss';

test('toPublicItem tolerates unparsable levels and maps online to boolean', () => {
  const item = toPublicItem({ id: 'a', levels: 'not json', online: 1 });
  assert.deepEqual(item.levels, []);
  assert.equal(item.online, true);
  assert.deepEqual(toPublicItem({ id: 'b', levels: '["msc"]', online: 0 }).levels, ['msc']);
  assert.equal(toPublicItem({ id: 'b', levels: '{"x":1}', online: 0 }).levels.length, 0);
});

test('rss drops XML-illegal control characters', () => {
  const xml = renderRss([{
    id: 'a', url: 'https://ex.org/', title: 'Bell\u0007 title', title_tr: '', summary_tr: '',
    source: 's', type: 'course', levels: [], deadline: null, starts_at: null, country: 'TR', online: false,
    cost_note: '', eligibility_note: '', published_at: 1790000000, expires_at: 1795000000,
  }], 'https://rsg-turkiye.iscbsc.org');
  assert.ok(!xml.includes('\u0007'));
  assert.ok(xml.includes('Bell title'));
});
