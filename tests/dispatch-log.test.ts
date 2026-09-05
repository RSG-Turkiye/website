import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  startRun,
  finishRun,
  markPhase,
  pruneRuns,
  isPruneTick,
  RUN_RETENTION_SECONDS,
  type RunLogDb,
} from '../functions/_lib/dispatch-log';

/** Records what was asked of D1 without needing one. */
function fakeDb(behaviour: 'ok' | 'throws' = 'ok') {
  const calls: { query: string; values: unknown[] }[] = [];
  const db: RunLogDb = {
    prepare(query: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async run() {
              if (behaviour === 'throws') throw new Error('D1_ERROR: no such table: dispatch_runs');
              calls.push({ query, values });
              return {};
            },
          };
        },
      };
    },
  };
  return { db, calls };
}

// --- the interval ----------------------------------------------------------

test('pruning happens once an hour, not once a minute', () => {
  const hour = 1_788_620_400; // exactly on the hour
  const fired = [];
  for (let i = 0; i < 60; i++) if (isPruneTick(hour + i * 60)) fired.push(i);
  assert.deepEqual(fired, [0], 'exactly one minute in sixty should prune');
});

test('the pruning minute is the first of the hour whatever the offset', () => {
  // The cron fires near the top of each minute but not on the second, so the
  // test that matters is that some second inside the first minute counts.
  assert.ok(isPruneTick(1_788_620_400 + 37));
  assert.ok(!isPruneTick(1_788_620_400 + 60));
  assert.ok(!isPruneTick(1_788_620_400 + 3599));
});

// --- the two-phase row -----------------------------------------------------

test('a run is inserted with a start and no end', async () => {
  const { db, calls } = fakeDb();
  const id = await startRun(db, 'run-1', 1000);
  assert.equal(id, 'run-1');
  assert.match(calls[0].query, /INSERT INTO dispatch_runs/);
  assert.deepEqual(calls[0].values, ['run-1', 1000]);
});

test('finishing writes the counts against that id', async () => {
  const { db, calls } = fakeDb();
  await finishRun(db, 'run-1', 1042, {
    candidates: 13,
    planned: 1,
    sent: 1,
    failed: 0,
    retried: 0,
    alreadySent: 0,
  });
  assert.match(calls[0].query, /UPDATE dispatch_runs/);
  assert.deepEqual(calls[0].values, [1042, 13, 1, 1, 0, 0, 0, null, null, 'run-1']);
});

test('a tick that threw records null counts, not zeroes', async () => {
  // Zero would read as "there was no mail due", which is the opposite of what
  // a throw before the queue is read actually means.
  const { db, calls } = fakeDb();
  await finishRun(db, 'run-1', 1042, { error: 'Worker exceeded resource limits' });
  assert.deepEqual(calls[0].values.slice(1, 7), [null, null, null, null, null, null]);
  assert.equal(calls[0].values[8], 'Worker exceeded resource limits');
});

test('a held tick is distinguishable from a tick that found nothing', async () => {
  const { db, calls } = fakeDb();
  await finishRun(db, 'run-1', 1042, {
    candidates: 0, planned: 0, sent: 0, failed: 0, retried: 0, alreadySent: 0,
    held: 'outside 8:00-22:00 Europe/Istanbul',
  });
  assert.equal(calls[0].values[7], 'outside 8:00-22:00 Europe/Istanbul');
});

// --- where a tick got to ----------------------------------------------------

test('a phase is recorded against the run, with the row it concerns', async () => {
  const { db, calls } = fakeDb();
  await markPhase(db, 'run-1', 'resolved', 'row-9');
  assert.match(calls[0].query, /UPDATE dispatch_runs SET phase/);
  assert.deepEqual(calls[0].values, ['resolved:row-9', 'run-1']);
});

test('a phase with no detail is stored bare', async () => {
  const { db, calls } = fakeDb();
  await markPhase(db, 'run-1', 'planned');
  assert.deepEqual(calls[0].values, ['planned', 'run-1']);
});

// --- logging never costs a send --------------------------------------------

test('a missing table does not stop the tick', async () => {
  const { db } = fakeDb('throws');
  assert.equal(await startRun(db, 'run-1', 1000), null, 'start reports failure as null');
  await finishRun(db, 'run-1', 1042, { sent: 1 }); // must not throw
  await markPhase(db, 'run-1', 'claimed', 'row-9'); // must not throw
  await pruneRuns(db, 1042); // must not throw
});

test('a run that never started is never written to', async () => {
  const { db, calls } = fakeDb();
  await finishRun(db, null, 1042, { sent: 1 });
  await markPhase(db, null, 'sent', 'row-9');
  assert.equal(calls.length, 0);
});

// --- retention -------------------------------------------------------------

test('pruning keeps a week and drops what is older', async () => {
  const { db, calls } = fakeDb();
  const now = 1_788_620_400;
  await pruneRuns(db, now);
  assert.match(calls[0].query, /DELETE FROM dispatch_runs/);
  assert.deepEqual(calls[0].values, [now - RUN_RETENTION_SECONDS]);
  assert.equal(RUN_RETENTION_SECONDS, 7 * 24 * 60 * 60);
});
