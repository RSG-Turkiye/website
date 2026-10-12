import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, kindFromLabel, planUpload, PLAN_KINDS } from '../src/lib/certificate-csv';
import { KINDS } from '../functions/_lib/certificates';

test('the panel and the API agree on the four kinds', () => {
  assert.deepEqual([...PLAN_KINDS], [...KINDS]);
});

test('comma CSV with a quoted name containing a comma', () => {
  const r = parseCsv('email,name,type,file\nayse@example.org,"Yılmaz, Ayşe",participation,ayse.pdf\n');
  assert.ok('rows' in r);
  assert.deepEqual(r.rows, [{ line: 2, email: 'ayse@example.org', name: 'Yılmaz, Ayşe', type: 'participation', file: 'ayse.pdf' }]);
});

test('Excel-TR: semicolons, BOM, CRLF, header in another order and case', () => {
  const r = parseCsv('﻿File;Name;EMAIL;Type\r\nayse.pdf;Ayşe;ayse@example.org;Katılım\r\n\r\n');
  assert.ok('rows' in r);
  assert.equal(r.rows.length, 1, 'blank line ignored');
  assert.equal(r.rows[0].type, 'Katılım');
});

test('a doubled quote inside a quoted field is one quote', () => {
  const r = parseCsv('email,name,type,file\na@example.org,"Ali ""Can"" Demir",workshop,a.pdf');
  assert.ok('rows' in r);
  assert.equal(r.rows[0].name, 'Ali "Can" Demir');
});

test('missing columns are named', () => {
  assert.deepEqual(parseCsv('email,name\na@example.org,A'), { error: 'missing_columns', missing: ['type', 'file'] });
  assert.deepEqual(parseCsv('   \n'), { error: 'empty' });
});

test('Turkish and English kind labels, any case', () => {
  assert.equal(kindFromLabel('KATILIM'), 'participation');
  assert.equal(kindFromLabel('katılım'), 'participation');
  assert.equal(kindFromLabel('Sunum'), 'presentation');
  assert.equal(kindFromLabel('TEŞEKKÜR'), 'appreciation');
  assert.equal(kindFromLabel('Workshop'), 'workshop');
  assert.equal(kindFromLabel('poster'), null);
});

test('planning flags each problem and lists unused files', () => {
  const rows = [
    { line: 2, email: 'A@Example.org', name: 'A', type: 'katılım', file: 'A.PDF' },
    { line: 3, email: 'a@example.org', name: 'A', type: 'participation', file: 'a2.pdf' },
    { line: 4, email: 'bad', name: '', type: 'poster', file: 'missing.pdf' },
  ];
  const plan = planUpload(rows, ['a.pdf', 'a2.pdf', 'extra.pdf']);
  assert.deepEqual(plan.rows.map((r) => r.problems), [[], ['duplicate'], ['invalid_email', 'invalid_kind', 'missing_name', 'missing_file']]);
  assert.equal(plan.rows[0].email, 'a@example.org');
  assert.equal(plan.rows[0].kind, 'participation');
  assert.deepEqual(plan.unusedFiles, ['extra.pdf']);
});
