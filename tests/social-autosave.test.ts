import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AutosaveQueue, type Timers } from '../src/scripts/social/autosave';

/** Manual clock: timers run only when the test says so. */
function manual() {
  let pending: (() => void) | null = null;
  const timers: Timers = { set: (fn) => { pending = fn; return 1; }, clear: () => { pending = null; } };
  return { timers, fire: () => { const f = pending; pending = null; f?.(); }, armed: () => pending !== null };
}
const tick = () => new Promise((r) => setImmediate(r));

test('edits within the delay produce one save', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; }, 3000, c.timers);
  q.touch(); q.touch(); q.touch();
  c.fire(); await tick();
  assert.equal(saves, 1);
});

test('never two saves in flight: an edit during a save queues exactly one more', async () => {
  let inFlight = 0, maxInFlight = 0, saves = 0;
  let release!: () => void;
  const c = manual();
  const q = new AutosaveQueue(async () => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); saves++;
    if (saves === 1) await new Promise<void>((r) => { release = r; });
    inFlight--;
  }, 3000, c.timers);
  q.touch(); c.fire(); await tick();
  q.touch(); q.touch();
  assert.equal(c.armed(), false, 'no timer while a save is running');
  release(); await tick(); await tick();
  assert.equal(c.armed(), true, 'the pending edit is scheduled after the save');
  c.fire(); await tick();
  assert.deepEqual([saves, maxInFlight], [2, 1]);
});

test('a failing save stops the queue for good', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; throw new Error('post_changed'); }, 3000, c.timers);
  q.touch(); c.fire(); await tick();
  assert.equal(q.stopped, true);
  q.touch();
  assert.equal(c.armed(), false);
  assert.equal(saves, 1);
});

test('flush saves now if anything is pending, and waits for it', async () => {
  let saves = 0;
  const c = manual();
  const q = new AutosaveQueue(async () => { saves++; }, 3000, c.timers);
  await q.flush();
  assert.equal(saves, 0, 'nothing pending, nothing saved');
  q.touch();
  await q.flush();
  assert.equal(saves, 1);
  assert.equal(c.armed(), false);
});
