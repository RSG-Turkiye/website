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

function sessionsIn(file: string): { order: number; time?: string; title: string }[] {
  return JSON.parse(readFileSync(join(DIR, file), 'utf8')).items ?? [];
}

test('within an edition, printed times never go backwards', () => {
  const offenders: string[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
    const timed = sessionsIn(file)
      .filter((s) => typeof s.time === 'string' && /^\d{1,2}:\d{2}$/.test(s.time))
      .sort((a, b) => a.order - b.order);
    for (let i = 1; i < timed.length; i++) {
      const prev = timed[i - 1];
      const cur = timed[i];
      // A later slot printing an earlier clock time means one of the two is
      // wrong, and only a human knows which.
      if (cur.time! < prev.time!) {
        offenders.push(`${file}: "${prev.title}" at ${prev.time} is followed by "${cur.title}" at ${cur.time}`);
      }
    }
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
