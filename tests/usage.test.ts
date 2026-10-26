import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utcDay, crossings } from '../functions/_lib/usage';

test('utcDay is the UTC date, not Istanbul', () => {
  assert.equal(utcDay(Date.parse('2026-10-26T23:30:00Z') / 1000), '2026-10-26'); // 02:30 on the 27th in Türkiye
  assert.equal(utcDay(Date.parse('2026-10-27T00:00:00Z') / 1000), '2026-10-27');
});

test('a value at exactly 70% crosses; one below does not', () => {
  assert.deepEqual(crossings({ requests: 70_000, rowsRead: 3_499_999, rowsWritten: 0 }, []).map((c) => `${c.metric}:${c.threshold}`), ['requests:70']);
});

test('90% crosses both thresholds', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 0, rowsWritten: 95_000 }, []).map((c) => `${c.metric}:${c.threshold}`), ['rowsWritten:70', 'rowsWritten:90']);
});

test('already alerted pairs are left out', () => {
  assert.deepEqual(crossings({ requests: 95_000, rowsRead: 0, rowsWritten: 0 }, ['requests:70']).map((c) => c.threshold), [90]);
});

test('a crossing carries its value and limit', () => {
  assert.deepEqual(crossings({ requests: 0, rowsRead: 4_000_000, rowsWritten: 0 }, [])[0], { metric: 'rowsRead', threshold: 70, value: 4_000_000, limit: 5_000_000 });
});

test('crossings come in metric order, then threshold ascending', () => {
  assert.deepEqual(
    crossings({ requests: 95_000, rowsRead: 4_000_000, rowsWritten: 95_000 }, []).map((c) => `${c.metric}:${c.threshold}`),
    ['requests:70', 'requests:90', 'rowsRead:70', 'rowsWritten:70', 'rowsWritten:90'],
  );
});
