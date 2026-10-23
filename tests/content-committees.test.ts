import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { committeeSchema, committeesFor, sortCommittees } from '../src/data/committees';

/**
 * src/content/committees: one JSON file per committee. Every file
 * validates, no member carries an e-mail address, every member has consented
 * to the published profile, and both languages are filled in.
 */

const dir = new URL('../src/content/committees/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const raw = files.map((f) => ({ f, json: JSON.parse(readFileSync(dir + f, 'utf8')) }));
const all = raw.map(({ json }) => committeeSchema.parse(json));

test('every committee JSON validates against the schema', () => {
  assert.ok(files.length > 0);
  for (const { f, json } of raw) {
    const r = committeeSchema.safeParse(json);
    assert.ok(r.success, `${f}: ${r.success ? '' : r.error.message}`);
  }
});

test('no member has an e-mail address, and every member has consented', () => {
  for (const { f, json } of raw) {
    for (const m of json.members) {
      assert.ok(!('email' in m), `${f}: ${m.name} has an email key`);
      assert.equal(m.consent, true, `${f}: ${m.name}`);
    }
    assert.doesNotMatch(JSON.stringify(json), /@/, `${f} contains an @`);
  }
});

test('the schema refuses a member without consent or with an e-mail', () => {
  const base = all[0];
  const member = { ...base.members[0] };
  assert.equal(committeeSchema.safeParse({ ...base, members: [{ ...member, consent: false }] }).success, false);
  const { consent: _c, ...noConsent } = member;
  assert.equal(committeeSchema.safeParse({ ...base, members: [noConsent] }).success, false);
  assert.equal(committeeSchema.safeParse({ ...base, members: [{ ...member, email: 'x@example.org' }] }).success, false);
});

test('orders are contiguous from 0', () => {
  assert.deepEqual(all.map((c) => c.order).sort((a, b) => a - b), all.map((_, i) => i));
});

test('names, descriptions and roles have both languages', () => {
  for (const c of all) {
    for (const f of [c.name, c.description, ...c.members.map((m) => m.role)]) {
      assert.ok(f.en.trim() && f.tr.trim(), c.name.en);
    }
  }
});

test('a member photo on a host blocked in Türkiye is refused', () => {
  const base = all[0];
  const member = { ...base.members[0], image: 'https://pub-x.r2.dev/a.jpg' };
  assert.equal(committeeSchema.safeParse({ ...base, members: [member] }).success, false);
});

test('committeesFor picks one language and drops consent', () => {
  const c = {
    order: 0,
    name: { en: 'Committee', tr: 'Komite' },
    description: { en: 'Does things.', tr: 'Bir şeyler yapar.' },
    members: [
      {
        name: 'Ada Örnek',
        role: { en: 'Leader', tr: 'Lider' },
        image: '/images/a.jpg',
        education: [{ degree: { en: 'MSc', tr: 'Yüksek Lisans' }, field: { en: 'Biology', tr: 'Biyoloji' }, institution: { en: 'A University', tr: 'A Üniversitesi' } }],
        socialMedia: [{ platform: 'github' as const, url: 'https://github.com/example' }],
        consent: true as const,
      },
    ],
  };
  const [en] = committeesFor([c], 'en');
  const [tr] = committeesFor([c], 'tr');
  assert.equal(en.description, 'Does things.');
  assert.equal(tr.description, 'Bir şeyler yapar.');
  assert.equal(tr.members[0].role, 'Lider');
  assert.deepEqual(en.members[0].education, [{ degree: 'MSc', field: 'Biology', institution: 'A University' }]);
  assert.deepEqual(tr.members[0].education, [{ degree: 'Yüksek Lisans', field: 'Biyoloji', institution: 'A Üniversitesi' }]);
  // A link's url is one string for both languages.
  assert.equal(en.members[0].socialMedia![0].url, tr.members[0].socialMedia![0].url);
  for (const m of [...en.members, ...tr.members]) {
    assert.ok(!('email' in m));
    assert.ok(!('consent' in m), 'consent is a content fact, not a render prop');
  }
});

test('sortCommittees orders by order', () => {
  const shuffled = [...all].reverse();
  assert.deepEqual(sortCommittees(shuffled).map((c) => c.order), all.map((_, i) => i));
});
