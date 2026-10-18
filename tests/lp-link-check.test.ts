import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLinks, classify, nextHop, report, type Result } from '../scripts/check-lp-links';

test('every external url and youtubeUrl is found once, with each file it is in', () => {
  const links = extractLinks([
    { path: 'en/a.md', text: '  - id: "x"\n    url: "https://example.org/a"\n    youtubeUrl: "https://youtu.be/abc"\n' },
    { path: 'tr/a.md', text: '  - id: "x"\n    url: "https://example.org/a"\n' },
    { path: 'en/b.md', text: '    url: "/learning-paths/genomics/"\n    url: https://example.org/unquoted\n' },
  ]);
  assert.deepEqual([...links.keys()].sort(), ['https://example.org/a', 'https://example.org/unquoted', 'https://youtu.be/abc']);
  assert.deepEqual(links.get('https://example.org/a'), ['en/a.md', 'tr/a.md']);
});

test('only 404, 410 and silence count as dead; bot walls are unverified', () => {
  assert.equal(classify(200), 'ok');
  assert.equal(classify(301), 'ok');
  assert.equal(classify(404), 'dead');
  assert.equal(classify(410), 'dead');
  assert.equal(classify(null), 'dead');
  for (const s of [401, 403, 429, 500, 503]) assert.equal(classify(s), 'unverified', String(s));
});

test('an https page redirecting to http on its own host is followed over https', () => {
  // wwpdb.org does this to HTTP/1.1 clients; the http address then leads to a closed port.
  assert.equal(nextHop('https://www.wwpdb.org/validation/x', 'http://www.wwpdb.org/validation/fetch?page=x'),
    'https://www.wwpdb.org/validation/fetch?page=x');
  assert.equal(nextHop('https://a.org/x', '/y'), 'https://a.org/y');
  // Another host's http is left alone: that is a real downgrade, not HSTS's business here.
  assert.equal(nextHop('https://a.org/x', 'http://b.org/y'), 'http://b.org/y');
});

test('the report lists dead links first, and says none when there are none', () => {
  const r = (url: string, verdict: Result['verdict'], detail: string): Result => ({ url, files: ['en/a.md', 'tr/a.md'], verdict, detail });
  const when = new Date('2026-10-18T00:00:00Z');
  const md = report([r('https://ok.org', 'ok', '200'), r('https://gone.org', 'dead', '404'), r('https://wall.org', 'unverified', '403')], when);
  assert.match(md, /Checked 3 external/);
  assert.match(md, /## Dead \(1\)[\s\S]*https:\/\/gone\.org \| 404 \| `en\/a\.md`<br>`tr\/a\.md`/);
  assert.match(md, /in place/, 'the report reminds that ids must stay');
  assert.ok(md.indexOf('## Dead') < md.indexOf('## Unverified'));
  assert.doesNotMatch(md, /ok\.org/);
  assert.match(report([r('https://ok.org', 'ok', '200')], when), /## Dead\n\nNone\./);
});
