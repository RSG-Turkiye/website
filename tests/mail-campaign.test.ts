import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTable,
  placeholdersIn,
  fillTemplate,
  buildCampaign,
  CAMPAIGN_MAX_RECIPIENTS,
} from '../src/lib/mail-campaign';
import { checkRateLimit, CAMPAIGN_LIMITS } from '../functions/_lib/mail';

const SHEET = 'e-posta\tunvan\tad\nayse@uni.edu.tr\tProf. Dr.\tAyşe Yılmaz\nmehmet@uni.edu.tr\tDoç. Dr.\tMehmet Kaya\n';

test('parseTable reads a tab-separated paste from a Google Sheet', () => {
  const t = parseTable(SHEET);
  assert.deepEqual(t.headers, ['e-posta', 'unvan', 'ad']);
  assert.equal(t.emailColumn, 'e-posta');
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], { 'e-posta': 'ayse@uni.edu.tr', unvan: 'Prof. Dr.', ad: 'Ayşe Yılmaz' });
});

test('parseTable accepts commas or semicolons when there are no tabs, and CRLF', () => {
  assert.equal(parseTable('Email,ad\r\na@x.org,A\r\n').rows[0].ad, 'A');
  assert.equal(parseTable('mail;ad\na@x.org;A').emailColumn, 'mail');
});

test('parseTable finds the address column by any accepted name, any case', () => {
  for (const h of ['E-posta', 'EPOSTA', 'email', 'Mail']) {
    assert.equal(parseTable(`${h}\tad\na@x.org\tA`).emailColumn, h);
  }
  assert.equal(parseTable('isim\tad\nx\ty').emailColumn, null);
});

test('parseTable skips blank lines and trims cells', () => {
  const t = parseTable('email\tad\n\n  a@x.org \t  A  \n\t\n');
  assert.equal(t.rows.length, 1);
  assert.deepEqual(t.rows[0], { email: 'a@x.org', ad: 'A' });
});

test('placeholdersIn lists each [name] once, in order', () => {
  assert.deepEqual(placeholdersIn('Sayın [unvan] [ad], [ad] hocam'), ['unvan', 'ad']);
  assert.deepEqual(placeholdersIn('no braces'), []);
});

test('a Markdown link is not a placeholder', () => {
  assert.deepEqual(placeholdersIn('[Rehber](https://rsg-turkiye.iscbsc.org/tr/guide/) [ad]'), ['ad']);
  assert.equal(fillTemplate('[ad]: [link](https://x.org)', { ad: 'A', link: 'NO' }), 'A: [link](https://x.org)');
});

test('placeholder names are matched without regard to case', () => {
  assert.equal(fillTemplate('[Ad] [UNVAN]', { ad: 'A', unvan: 'P' }), 'A P');
});

test('fillTemplate replaces placeholders as plain text', () => {
  assert.equal(fillTemplate('Sayın [unvan] [ad],', { unvan: 'Prof. Dr.', ad: 'Ayşe' }), 'Sayın Prof. Dr. Ayşe,');
  // A value is text, never a template: brackets in it stay as they are.
  assert.equal(fillTemplate('[ad]', { ad: '[unvan]', unvan: 'X' }), '[unvan]');
});

test('buildCampaign gives each person their own subject and text', () => {
  const r = buildCampaign({ table: SHEET, subject: 'Rehber: [ad]', body: 'Sayın [unvan] [ad],\n\nMetin.' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.recipients.length, 2);
  assert.deepEqual(r.recipients[1], {
    email: 'mehmet@uni.edu.tr', subject: 'Rehber: Mehmet Kaya', body: 'Sayın Doç. Dr. Mehmet Kaya,\n\nMetin.',
  });
  assert.deepEqual(r.refused, []);
});

test('buildCampaign refuses rows with a bad or repeated address, or an empty value the text uses', () => {
  const table = 'email\tad\tunvan\nok@x.org\tA\tP\nbad-address\tB\tP\nOK@x.org\tC\tP\nempty@x.org\t\tP\n';
  const r = buildCampaign({ table, subject: 'S', body: 'Sayın [ad]' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.recipients.map((x) => x.email), ['ok@x.org']);
  assert.deepEqual(r.refused, [
    { line: 3, email: 'bad-address', reason: 'invalid_email' },
    { line: 4, email: 'OK@x.org', reason: 'duplicate' },
    { line: 5, email: 'empty@x.org', reason: 'empty_value', field: 'ad' },
  ]);
});

test('buildCampaign blocks the whole campaign for problems that would reach everyone', () => {
  const code = (input: Parameters<typeof buildCampaign>[0]) => {
    const r = buildCampaign(input);
    return r.ok ? 'ok' : r.code;
  };
  assert.equal(code({ table: 'isim\na', subject: 'S', body: 'B' }), 'no_email_column');
  assert.equal(code({ table: 'email\n', subject: 'S', body: 'B' }), 'no_recipients');
  assert.equal(code({ table: SHEET, subject: ' ', body: 'B' }), 'empty_subject');
  assert.equal(code({ table: SHEET, subject: 'S', body: '' }), 'empty_body');
  assert.equal(code({ table: SHEET, subject: 'S', body: 'Sayın [soyad]' }), 'unknown_placeholder');
  assert.equal(code({ table: 'email\tad\nbad\tA', subject: 'S', body: 'B' }), 'no_recipients');
  const many = 'email\n' + Array.from({ length: CAMPAIGN_MAX_RECIPIENTS + 1 }, (_, i) => `p${i}@x.org`).join('\n');
  assert.equal(code({ table: many, subject: 'S', body: 'B' }), 'too_many_recipients');
});

test('buildCampaign reports which placeholder is unknown', () => {
  const r = buildCampaign({ table: SHEET, subject: '[baslik]', body: 'Sayın [soyad]' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.deepEqual(r.unknown, ['baslik', 'soyad']);
});

// --- quotas -----------------------------------------------------------------

const NOW = 1_700_000_000;

/** Answers each count query in turn and records the SQL it was asked. */
function fakeDb(counts: number[]) {
  const queries: string[] = [];
  let i = 0;
  return {
    queries,
    prepare(sql: string) {
      queries.push(sql);
      return { bind: () => ({ first: async <T>() => ({ n: counts[i++] ?? 0 }) as T }) };
    },
  };
}

test('the campaign quota is 200 a day and 60 an hour', () => {
  assert.equal(CAMPAIGN_LIMITS.perDay, 200);
  assert.equal(CAMPAIGN_LIMITS.perHour, 60);
});

test('a campaign message is held by the campaign hourly, daily and site windows', async () => {
  // Order: campaign day, campaign hour, site day.
  assert.deepEqual(await checkRateLimit(fakeDb([0, 0, 0]), 'u1', 1, NOW, { campaign: true }), { ok: true });
  assert.deepEqual(await checkRateLimit(fakeDb([200, 0, 0]), 'u1', 1, NOW, { campaign: true }), { ok: false, code: 'rate_limit_campaign_day' });
  assert.deepEqual(await checkRateLimit(fakeDb([0, 60, 0]), 'u1', 1, NOW, { campaign: true }), { ok: false, code: 'rate_limit_campaign_hour' });
  assert.deepEqual(await checkRateLimit(fakeDb([0, 0, 300]), 'u1', 1, NOW, { campaign: true }), { ok: false, code: 'rate_limit_global' });
});

test('a campaign message ignores the sender\'s personal windows', async () => {
  const db = fakeDb([0, 0, 0]);
  await checkRateLimit(db, 'u1', 1, NOW, { campaign: true });
  assert.equal(db.queries.length, 3);
  assert.match(db.queries[0], /campaign_id IS NOT NULL/);
  assert.match(db.queries[1], /campaign_id IS NOT NULL/);
  assert.doesNotMatch(db.queries[2], /campaign_id/, 'the site window counts every message');
});

test('a person\'s ordinary mail is not held by campaign messages they sent', async () => {
  const db = fakeDb([0, 0, 0]);
  await checkRateLimit(db, 'u1', 1, NOW);
  assert.match(db.queries[0], /campaign_id IS NULL/);
  assert.match(db.queries[1], /campaign_id IS NULL/);
  assert.doesNotMatch(db.queries[2], /campaign_id/);
});

// --- review fixes -----------------------------------------------------------

test('a row with more or fewer cells than the header is refused, not shifted', () => {
  const r = buildCampaign({ table: 'e-posta,unvan,ad\nb@x.edu.tr,Doç., Dr.,Mehmet\nc@x.edu.tr,Prof.,Ayşe\n', subject: 'S', body: 'Sayın [unvan] [ad]' });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.recipients.map((x) => x.email), ['c@x.edu.tr']);
  assert.deepEqual(r.refused, [{ line: 2, email: 'b@x.edu.tr', reason: 'column_count' }]);
});

test('a quoted cell from a Sheets copy keeps its separators, quotes and line breaks', () => {
  const t = parseTable('email\tad\tnot\na@x.org\t"Ayşe ""Ece"" Yılmaz"\t"satır 1\nsatır 2"\nb@x.org\tB\tC\n');
  assert.equal(t.rows.length, 2);
  assert.deepEqual(t.rows[0], { email: 'a@x.org', ad: 'Ayşe "Ece" Yılmaz', not: 'satır 1\nsatır 2' });
  assert.equal(parseTable('email,unvan\na@x.org,"Doç., Dr."').rows[0].unvan, 'Doç., Dr.');
});

test('any bracketed name is a placeholder: punctuation in a header works and an unknown one blocks', () => {
  const ok = buildCampaign({ table: 'email\tAd.Soyad\tAd (TR)\na@x.org\tAyşe Yılmaz\tAyşe', subject: 'S', body: '[Ad.Soyad] / [Ad (TR)]' });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.recipients[0].body, 'Ayşe Yılmaz / Ayşe');
  const bad = buildCampaign({ table: 'email\tad\na@x.org\tA', subject: 'S', body: 'Sayın [ad/soyad]' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(bad.unknown, ['ad/soyad']);
});

test('an English header in capitals matches its placeholder', () => {
  const r = buildCampaign({ table: 'EMAIL\tTITLE\tİSİM\na@x.org\tProf.\tAyşe', subject: 'S', body: '[title] [isim]' });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.recipients[0].body, 'Prof. Ayşe');
});

test('a quoted address is refused rather than queued to fail at Gmail', () => {
  const r = buildCampaign({ table: 'email\tad\n"a@x.edu.tr" \tA\nb@x.org\tB', subject: 'S', body: 'B' });
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.recipients.map((x) => x.email), ['a@x.edu.tr', 'b@x.org']);
});
