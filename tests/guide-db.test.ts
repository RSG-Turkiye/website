import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import {
  listProfessors, listLabs, upsertProfessor, upsertLab, deleteProfessor, deleteLab, staleRecords,
  newProfessorId, newLabId, type ProfessorRow, type LabRow,
} from '../functions/_lib/guide-db';

/** The guide's professors and labs in D1 (never git: CLAUDE.md rule 4). Names are invented. */

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = 1_800_000_000;
const DAY = 86400;

function setup() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(SCHEMA);
  return { raw, db: d1(raw) as unknown as D1Database };
}

const lab = (over: Partial<LabRow> = {}): LabRow => ({
  id: 'l_000000000001', name: 'Örnek Yapısal Biyoinformatik Lab', universityId: 'ornek', url: 'https://lab.example.edu.tr', checkedAt: NOW, ...over,
});
const prof = (over: Partial<ProfessorRow> = {}): ProfessorRow => ({
  id: 'p_000000000001', title: 'Doç. Dr.', name: 'Örnek Hoca A', universityId: 'ornek', department: 'Biyomühendislik',
  labId: null, profileUrl: 'https://example.edu.tr/a', openalexId: 'A5000000001',
  handTopics: ['protein yapısı'], hiddenTopics: [], openalexTopics: ['Structural Bioinformatics'],
  topicsRefreshedAt: null, topicsFailures: 0, programmeIds: ['ornek-bioinf'], source: 'https://example.edu.tr/a', checkedAt: NOW, ...over,
});

const audits = (raw: DatabaseSync) => raw.prepare('SELECT action, target_id, details FROM audit_log ORDER BY seq').all() as { action: string; target_id: string | null; details: string }[];

test('upsert then list round-trips JSON columns', async () => {
  const { db } = setup();
  await upsertLab(db, lab(), 'u1', NOW);
  await upsertProfessor(db, prof({ labId: 'l_000000000001' }), 'u1', NOW);
  const [p] = await listProfessors(db);
  assert.deepEqual(p, prof({ labId: 'l_000000000001' }));
  assert.deepEqual(await listLabs(db), [lab()]);
  await upsertProfessor(db, prof({ handTopics: ['docking', 'protein yapısı'] }), 'u1', NOW + 1);
  assert.deepEqual((await listProfessors(db))[0].handTopics, ['docking', 'protein yapısı'], 'an upsert replaces the row');
});

test('deleteProfessor removes the row and its audit details hold only the id', async () => {
  const { raw, db } = setup();
  await upsertProfessor(db, prof(), 'u1', NOW);
  await deleteProfessor(db, 'p_000000000001', 'u1', NOW);
  assert.deepEqual(await listProfessors(db), []);
  const rows = audits(raw);
  assert.deepEqual(rows.map((r) => r.action), ['guide.professor.save', 'guide.professor.delete']);
  for (const r of rows) {
    assert.equal(r.target_id, 'p_000000000001');
    assert.ok(!r.details?.includes('Örnek'), 'no name in the audit log');
  }
});

test('staleRecords returns ids checked over a year ago', async () => {
  const { db } = setup();
  await upsertProfessor(db, prof({ id: 'p_old000000001', checkedAt: NOW - 366 * DAY }), 'u1', NOW);
  await upsertProfessor(db, prof({ id: 'p_new000000001', checkedAt: NOW - 30 * DAY }), 'u1', NOW);
  await upsertLab(db, lab({ id: 'l_old000000001', checkedAt: NOW - 400 * DAY }), 'u1', NOW);
  assert.deepEqual(await staleRecords(db, NOW), { professors: ['p_old000000001'], labs: ['l_old000000001'] });
});

test('deleteLab refuses while a professor references it', async () => {
  const { db } = setup();
  await upsertLab(db, lab(), 'u1', NOW);
  await upsertProfessor(db, prof({ labId: 'l_000000000001' }), 'u1', NOW);
  assert.deepEqual(await deleteLab(db, 'l_000000000001', 'u1', NOW), { ok: false, code: 'lab_in_use' });
  await deleteProfessor(db, 'p_000000000001', 'u1', NOW);
  assert.deepEqual(await deleteLab(db, 'l_000000000001', 'u1', NOW), { ok: true });
  assert.deepEqual(await listLabs(db), []);
});

test('new ids are opaque and never contain the name', () => {
  const a = newProfessorId(), b = newProfessorId();
  assert.match(a, /^p_[0-9a-f]{12}$/);
  assert.match(newLabId(), /^l_[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});
