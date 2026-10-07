import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// `order` decides where a session sits in the programme and `time` is what the
// page prints beside it. Nothing makes them agree, so a schedule can show the
// closing remarks at 09:00 above a keynote at 10:00 and look, to the code,
// entirely correct. The CMS makes this easier to get wrong: order comes from
// the row's sort position, time is typed in by hand.

const DIR = 'src/content/sessions';

type Item = { order: number; time?: string; title: string; day?: number };

function sessionsIn(file: string): Item[] {
  return JSON.parse(readFileSync(join(DIR, file), 'utf8')).items ?? [];
}

// The clock restarts every morning, so times are only comparable inside one
// day. A missing `day` means 1: older payloads predate the field.
function offendersIn(items: Item[], label = 'edition'): string[] {
  const offenders: string[] = [];
  const byDay = new Map<number, Item[]>();
  for (const s of items) {
    if (typeof s.time !== 'string' || !/^\d{1,2}:\d{2}$/.test(s.time)) continue;
    const day = s.day ?? 1;
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }
  for (const [day, timed] of byDay) {
    timed.sort((a, b) => a.order - b.order);
    for (let i = 1; i < timed.length; i++) {
      const prev = timed[i - 1];
      const cur = timed[i];
      // A later slot printing an earlier clock time means one of the two is
      // wrong, and only a human knows which. Padded so "9:00" sorts before "10:00".
      if (cur.time!.padStart(5, '0') < prev.time!.padStart(5, '0')) {
        offenders.push(`${label} day ${day}: "${prev.title}" at ${prev.time} is followed by "${cur.title}" at ${cur.time}`);
      }
    }
  }
  return offenders;
}

test('a day-2 morning after a day-1 evening is not an offender, a same-day regression is', () => {
  assert.deepEqual(
    offendersIn([
      { order: 1, time: '17:00', title: 'Closing day 1', day: 1 },
      { order: 2, time: '13:00', title: 'Day 2 session', day: 2 },
    ]),
    [],
  );
  assert.equal(
    offendersIn([
      { order: 1, time: '17:00', title: 'A', day: 2 },
      { order: 2, time: '13:00', title: 'B', day: 2 },
    ]).length,
    1,
  );
});

test('within a day of an edition, printed times never go backwards', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    offenders.push(...offendersIn(sessionsIn(file), file));
  }
  assert.deepEqual(offenders, []);
});

test('order is unique within an edition', () => {
  // Two sessions claiming the same position sort unpredictably, so the
  // programme can reshuffle itself between builds.
  const offenders: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const seen = new Map<number, string>();
    for (const s of sessionsIn(file)) {
      const first = seen.get(s.order);
      if (first) offenders.push(`${file}: order ${s.order} used by both "${first}" and "${s.title}"`);
      else seen.set(s.order, s.title);
    }
  }
  assert.deepEqual(offenders, []);
});
