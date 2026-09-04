import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTick, COST_MULTIPLIER, type QueueRow } from '../functions/_lib/mail-queue';

const MB = 1024 * 1024;
const PLAN = { batch: 20, perSender: 2, byteBudget: 40 * MB };

let seq = 0;
const row = (sender: string, attachments: string[] = []): QueueRow =>
  ({ id: `r${seq++}`, sender_user_id: sender, attachment_ids: JSON.stringify(attachments) });

const SIZES: Record<string, number> = { big: 9.36 * MB, small: 0.2 * MB };
const sizeOf = (id: string) => SIZES[id] ?? 0;
const senders = (picked: QueueRow[]) => picked.map((r) => r.sender_user_id).join(' ');

// --- fairness --------------------------------------------------------------

test('the incident: two light mails were behind forty-two heavy ones', () => {
  const due = [
    ...Array.from({ length: 17 }, () => row('neval', ['big'])),
    ...Array.from({ length: 25 }, () => row('sude', ['big'])),
    row('ahsen'), row('ahsen'),
  ];
  const picked = planTick(due, PLAN, sizeOf);
  assert.ok(picked.some((r) => r.sender_user_id === 'ahsen'), 'Ahsen must be in the first tick');
});

test('a sender with one mail is never behind a sender with fifty', () => {
  const due = [...Array.from({ length: 50 }, () => row('bulk')), row('solo')];
  assert.ok(planTick(due, { ...PLAN, batch: 3 }, sizeOf).some((r) => r.sender_user_id === 'solo'));
});

test('senders are served a round at a time, oldest sender leading', () => {
  const due = [row('a'), row('a'), row('b'), row('c')];
  assert.equal(senders(planTick(due, { ...PLAN, batch: 6 }, sizeOf)), 'a b c a');
});

test("within one sender, their own order holds", () => {
  const first = row('a'); const second = row('a');
  assert.deepEqual(planTick([first, second], PLAN, sizeOf).map((r) => r.id), [first.id, second.id]);
});

// --- the byte budget -------------------------------------------------------

test('light mail flows many at a time', () => {
  const due = Array.from({ length: 12 }, (_, i) => row(`s${i}`));
  assert.equal(planTick(due, { ...PLAN, perSender: 1 }, sizeOf).length, 12);
});

test('a nine-megabyte attachment goes one at a time, not five', () => {
  // 9.36 MB * 3.5 is over 32 MB, so a 40 MB budget fits exactly one. Five of
  // these in one invocation is what Cloudflare killed with 1102.
  const due = Array.from({ length: 5 }, (_, i) => row(`s${i}`, ['big']));
  assert.equal(planTick(due, { ...PLAN, perSender: 1 }, sizeOf).length, 1);
});

test('one oversized mail still goes rather than blocking the queue forever', () => {
  const due = [row('a', ['big'])];
  assert.equal(planTick(due, { ...PLAN, byteBudget: 1 }, sizeOf).length, 1);
});

test('the budget is spent, not merely counted', () => {
  // Four small ones fit in a budget that one big one would exhaust.
  const due = Array.from({ length: 4 }, (_, i) => row(`s${i}`, ['small']));
  const budget = 0.2 * MB * COST_MULTIPLIER * 4;
  assert.equal(planTick(due, { ...PLAN, perSender: 1, byteBudget: budget }, sizeOf).length, 4);
});

test('light mail queued behind heavy mail still gets its turn', () => {
  // The shape that matters: Ahsen's costs nothing, so it fits alongside the
  // one heavy mail the budget allows.
  const due = [row('bulk', ['big']), row('bulk', ['big']), row('ahsen')];
  const picked = planTick(due, { ...PLAN, perSender: 1 }, sizeOf);
  assert.deepEqual(senders(picked).split(' ').sort(), ['ahsen', 'bulk']);
});

// --- robustness ------------------------------------------------------------

test('a corrupt attachment list does not skew the plan or throw', () => {
  const corrupt = { id: 'x', sender_user_id: 'a', attachment_ids: 'not json' };
  assert.equal(planTick([corrupt], PLAN, sizeOf).length, 1);
});

test('an unknown attachment id counts as nothing rather than crashing', () => {
  assert.equal(planTick([row('a', ['missing'])], PLAN, sizeOf).length, 1);
});

test('nothing due, nothing planned', () => {
  assert.deepEqual(planTick([], PLAN, sizeOf), []);
  assert.deepEqual(planTick([row('a')], { ...PLAN, batch: 0 }, sizeOf), []);
});
