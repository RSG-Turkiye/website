import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { committeeSchema, committeesFor, sortCommittees } from '../src/data/committees';

/**
 * src/content/committees: one JSON file per committee. These pin the move
 * from the two parallel TypeScript arrays: every file validates, no member
 * carries an e-mail address, every member has consented to the published
 * profile, and both languages get the committees, members and wording they
 * got before.
 */

const dir = new URL('../src/content/committees/', import.meta.url).pathname;
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const raw = files.map((f) => ({ f, json: JSON.parse(readFileSync(dir + f, 'utf8')) }));
const all = raw.map(({ json }) => committeeSchema.parse(json));

test('every committee JSON validates against the schema', () => {
  assert.equal(files.length, 8);
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

// The old arrays, as the two pages rendered them (names and roles).
const expectedEn = [
  ['Chair', [['Emre Taha Çevik', 'President'], ['Gizem Beyza Anık', 'Vice President'], ['Sude Karaoğlan', 'Secretary']]],
  ['Webinar Committee', [['Ezgi Gokce', 'Webinar Leader']]],
  ['Outreach Committee', [['Mariam Aseyakhe', 'Outreach Leader']]],
  ['Social Media Committee', [['Zeynep Ateşgil', 'Social Media Leader']]],
  ['Sponsorship Committee', [['Gökçe Koçak', 'Sponsorship Leader']]],
  ['Translation Committee', [['Kurayi Chawatama', 'Translation Leader']]],
  ['Website Committee', [['Hilal Kınalı', 'Website Leader']]],
  ['Graphic Design Committee', [['Ayşe Akkan', 'Graphic Design Leader']]],
];
const expectedTr = [
  ['Yönetim Kurulu', [['Emre Taha Çevik', 'Başkan'], ['Gizem Beyza Anık', 'Başkan Yardımcısı'], ['Sude Karaoğlan', 'Sekreter']]],
  ['Webinar Komitesi', [['Ezgi Gokce', 'Webinar Ekibi Lideri']]],
  ['Topluluk İlişkileri Komitesi', [['Mariam Aseyakhe', 'Topluluk İlişkileri Ekibi Lideri']]],
  ['Sosyal Medya Komitesi', [['Zeynep Ateşgil', 'Sosyal Medya Ekibi Lideri']]],
  ['Sponsorluk Komitesi', [['Gökçe Koçak', 'Sponsorluk Ekibi Lideri']]],
  ['Çeviri Komitesi', [['Kurayi Chawatama', 'Çeviri Ekibi Lideri']]],
  ['Web Sitesi Komitesi', [['Hilal Kınalı', 'Web Sitesi Ekibi Lideri']]],
  ['Grafik Tasarım Komitesi', [['Ayşe Akkan', 'Grafik Tasarım Ekibi Lideri']]],
];

const snapshot = (lang: 'en' | 'tr') =>
  committeesFor(all, lang).map((c) => [c.name, c.members.map((m) => [m.name, m.role])]);

test('committees, members and roles in each language match the old arrays, in order', () => {
  assert.deepEqual(snapshot('en'), expectedEn);
  assert.deepEqual(snapshot('tr'), expectedTr);
});

test('descriptions, education and links are picked per language', () => {
  const en = committeesFor(all, 'en');
  const tr = committeesFor(all, 'tr');
  assert.equal(en[0].description, 'Leading the organization with vision and strategy.');
  assert.equal(tr[0].description, 'Organizasyonu vizyon ve strateji ile yönetmek.');
  assert.deepEqual(en[0].members[0].education, [{ degree: 'MSc', field: 'Bioinformatics and Systems Biology', institution: 'Gebze Technical University' }]);
  assert.deepEqual(tr[0].members[0].education, [{ degree: 'Yüksek Lisans', field: 'Bioinformatik ve Sistem Biyolojisi', institution: 'Gebze Teknik Üniversitesi' }]);
  // A link's url is one string for both languages.
  assert.equal(en[4].members[0].socialMedia![0].url, tr[4].members[0].socialMedia![0].url);
  assert.doesNotMatch(tr[4].members[0].socialMedia![0].url, /skipRedirect/);
  for (const c of [...en, ...tr]) {
    for (const m of c.members) {
      assert.ok(!('email' in m));
      assert.ok(!('consent' in m), 'consent is a content fact, not a render prop');
    }
  }
});

test('sortCommittees orders by order', () => {
  const shuffled = [...all].reverse();
  assert.deepEqual(sortCommittees(shuffled).map((c) => c.order), all.map((_, i) => i));
});
