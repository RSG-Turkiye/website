import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventSchema } from '../src/data/events';
import { eventFiles, readEvents } from './lib/events';

/**
 * src/content/events: one JSON file per event, named by its id. These pin the
 * move from the TypeScript array: every file validates, dates land on the day
 * they name (UTC midnight, exactly as `new Date("2026-10-10")` did), and the
 * order the pages receive is the order they received before.
 */

test('every event JSON validates against the schema', () => {
  const files = eventFiles();
  assert.equal(files.length, 20);
  for (const { file, raw } of files) {
    const r = eventSchema.safeParse(raw);
    assert.ok(r.success, `${file}: ${r.success ? '' : r.error.message}`);
  }
});

test('ids are unique and equal the file names', () => {
  const files = eventFiles();
  const ids = files.map(({ raw }) => (raw as { id: string }).id);
  assert.equal(new Set(ids).size, ids.length);
  for (const { file, raw } of files) assert.equal(file, `${(raw as { id: string }).id}.json`);
});

test('dates are read as UTC midnight of the day they name, not shifted a day', () => {
  const s = readEvents().find((e) => e.id === 'symposium-2026');
  assert.ok(s);
  assert.equal(s.start.getTime(), Date.UTC(2026, 9, 10));
  assert.equal(s.end?.getTime(), Date.UTC(2026, 9, 11));
  const one = readEvents().find((e) => e.id === 'workshop-nextflow-2024');
  assert.equal(one?.start.getTime(), Date.UTC(2024, 2, 16));
  assert.equal(one?.end, undefined);
});

test('the sorted order is the order the pages had before the collection', () => {
  // Newest start first, ties by id. The old array was grouped by type, but
  // every consumer sorted it by start (stable), which gives exactly this
  // list: the two same-day pairs (2025-10-30, 2024-11-15) put the symposium
  // first both ways.
  assert.deepEqual(readEvents().map((e) => e.id), [
    'symposium-2026',
    'hackathon-nfcore-2026',
    'hackathon-docking-2025',
    'meetup-izmir-2025',
    'meetup-istanbul-2025',
    'symposium-2025',
    'workshop-hibit-2025',
    'meetup-bursa-2025',
    'meetup-boardgame-2025',
    'hackathon-nfcore-2025',
    'symposium-2024',
    'workshop-nextflow-symposium-2024',
    'hackathon-combine-2024',
    'workshop-nextflow-2024',
    'symposium-2023',
    'workshop-structural-biology-2021',
    'workshop-command-line-2021',
    'workshop-single-cell-2020',
    'workshop-symposium-2020',
    'workshop-ankapy-2019',
  ]);
});
