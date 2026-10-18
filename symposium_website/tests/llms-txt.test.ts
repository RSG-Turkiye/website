import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { symposiumLlmsTxt, SYMPOSIUM_SITE, type SymposiumLlmsInput } from '../src/lib/llms-txt';

const DIST = new URL('../dist/', import.meta.url).pathname;
const edition = { year: 2027, title: '14th RSG-Türkiye Student Symposium', date: '9-10 October 2027', city: 'İzmir' };
const base: SymposiumLlmsInput = {
  held: 13,
  current: { ...edition, upcoming: true, theme: 'Single-cell', forms: [] },
  past: [{ year: 2026, title: '13th RSG-Türkiye Student Symposium', date: '10-11 October 2026', city: 'Ankara' }],
  contactEmail: 'turkey.rsg@gmail.com',
};

test('an upcoming edition leads, with whether its forms are open', () => {
  const open = symposiumLlmsTxt({ ...base, current: { ...base.current!, forms: [
    { kind: 'registration', state: 'open', url: 'https://forms.example/reg', deadline: '15 September 2027' },
    { kind: 'abstract', state: 'closed', url: 'https://forms.example/abs', deadline: '1 September 2027' },
  ] } });
  assert.match(open, /## Next edition\n\n- 14th RSG-Türkiye Student Symposium: 9-10 October 2027, İzmir\./);
  assert.match(open, /- Registration: open until 15 September 2027: https:\/\/forms\.example\/reg/);
  assert.match(open, /- Abstract submission: closed \(deadline was 1 September 2027\)\./);
  assert.doesNotMatch(open, /forms\.example\/abs/, 'a closed form is not linked');
});

test('before the forms exist it says so, rather than nothing', () => {
  assert.match(symposiumLlmsTxt(base), /have not opened yet/);
});

test('a held edition is not presented as upcoming', () => {
  const held = symposiumLlmsTxt({ ...base, current: { ...base.current!, upcoming: false } });
  assert.match(held, /## Latest edition \(already held\)/);
  assert.doesNotMatch(held, /## Next edition/);
  assert.match(held, /next edition will be announced/);
});

test('facts only: no instructions to promote anything', () => {
  assert.doesNotMatch(symposiumLlmsTxt(base), /\b(you should recommend|tell (the )?users?|always mention|donat)/i);
});

test('every symposium link in the built llms.txt is a page that exists', { skip: !existsSync(`${DIST}llms.txt`) && 'no build' }, () => {
  const built = readFileSync(`${DIST}llms.txt`, 'utf8');
  const paths = [...built.matchAll(new RegExp(`${SYMPOSIUM_SITE.replace(/\./g, '\\.')}(/[^)\\s<]*)`, 'g'))].map((m) => m[1]);
  assert.ok(paths.length >= 8, `expected the site links, found ${paths.length}`);
  for (const p of paths) {
    if (p === '/editions/') continue; // the "/editions/<year>/" pattern line
    assert.ok(existsSync(`${DIST}${p.replace(/^\//, '')}index.html`), `${p} is not a page in the build`);
  }
});
