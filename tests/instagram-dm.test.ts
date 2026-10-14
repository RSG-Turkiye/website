import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubGraph, type GraphCall } from './lib/instagram';
import { instagramDm, dmErrorKind, peerOf } from '../functions/_lib/social/instagram-dm';
import { IG_SCOPES } from '../functions/_lib/social/instagram';

const ME = { id: '17841400000000000', name: 'rsg_test' };
async function withGraph<T>(h: (c: GraphCall) => Response | undefined, run: () => Promise<T>) {
  const g = stubGraph(h);
  try { return { result: await run(), calls: g.calls }; } finally { g.restore(); }
}
const err = (code: number, sub?: number, status = 400) => Response.json({ error: { code, error_subcode: sub, message: 'x' } }, { status });

test('the connection asks for the messaging scope', () => {
  assert.ok(IG_SCOPES.includes('instagram_business_manage_messages'));
});

test('conversations: platform=instagram, newest first, times parsed from +0000', async () => {
  const { result, calls } = await withGraph((c) => (c.path === '/me/conversations' ? Response.json({ data: [
    { id: 'cA', updated_time: '2026-10-15T08:00:00+0000' },
    { id: 'cB', updated_time: '2026-10-15T09:00:00+0000' },
  ] }) : undefined), () => instagramDm.listConversations('tok'));
  assert.deepEqual(result, { ok: true, conversations: [
    { id: 'cB', updatedAt: Date.UTC(2026, 9, 15, 9) / 1000 },
    { id: 'cA', updatedAt: Date.UTC(2026, 9, 15, 8) / 1000 },
  ] });
  assert.equal(calls[0].params.get('platform'), 'instagram');
  assert.equal(calls[0].params.get('access_token'), 'tok');
});

test('a thread: oldest first, ours marked by id or by username, attachments as https links only', async () => {
  const { result } = await withGraph((c) => (c.path === '/cA' ? Response.json({ messages: { data: [
    { id: 'm3', created_time: '2026-10-15T09:02:00+0000', from: { id: ME.id, username: 'rsg_test' }, message: 'Merhaba!' },
    { id: 'm2', created_time: '2026-10-15T09:01:00+0000', from: { id: '999', username: 'RSG_TEST' }, message: 'by name' },
    { id: 'm1', created_time: '2026-10-15T09:00:00+0000', from: { id: '555', username: 'ayse' }, message: 'Soru',
      attachments: { data: [{ image_data: { url: 'https://lookaside.fbsbx.com/x.jpg' } }, { file_url: 'javascript:alert(1)' }] } },
  ] } }) : undefined), () => instagramDm.thread('tok', 'cA', ME));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.messages.map((m) => [m.id, m.mine]), [['m1', false], ['m2', true], ['m3', true]]);
  assert.deepEqual(result.messages[0].attachments, ['https://lookaside.fbsbx.com/x.jpg']);
  assert.deepEqual(peerOf(result.messages), { id: '555', username: 'ayse' });
});

test('a thread with only our messages has no peer from "from"; the "to" field names them', async () => {
  const { result } = await withGraph((c) => (c.path === '/cA' ? Response.json({ messages: { data: [
    { id: 'm1', created_time: '2026-10-15T09:00:00+0000', from: { id: ME.id, username: 'rsg_test' }, to: { data: [{ id: '555', username: 'ayse' }] }, message: 'x' },
  ] } }) : undefined), () => instagramDm.thread('tok', 'cA', ME));
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual(peerOf(result.messages), { id: '555', username: 'ayse' });
});

test('send: form-encoded recipient and message JSON, to me/messages', async () => {
  const { result, calls } = await withGraph((c) => (c.method === 'POST' && c.path === '/me/messages' ? Response.json({ recipient_id: '555', message_id: 'mid' }) : undefined),
    () => instagramDm.send('tok', '555', 'Çok teşekkürler'));
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(JSON.parse(calls[0].params.get('recipient')!), { id: '555' });
  assert.deepEqual(JSON.parse(calls[0].params.get('message')!), { text: 'Çok teşekkürler' });
});

test('error classes: the window refusal is never auth (R3)', () => {
  assert.equal(dmErrorKind(400, { code: 10, error_subcode: 2534022 }), 'window');
  assert.equal(dmErrorKind(400, { code: 10 }), 'refused', 'a bare permission error must not break the connection');
  assert.equal(dmErrorKind(400, { code: 190 }), 'auth');
  assert.equal(dmErrorKind(403, { code: 200 }), 'permission');
  assert.equal(dmErrorKind(500, null), 'transient');
  assert.equal(dmErrorKind(0, null), 'transient');
  assert.equal(dmErrorKind(400, { code: 4 }), 'transient');
  assert.equal(dmErrorKind(400, { code: 551 }), 'refused');
});

test('send outside the window comes back as window', async () => {
  const { result } = await withGraph(() => err(10, 2534022), () => instagramDm.send('tok', '555', 'geç'));
  assert.deepEqual(result, { ok: false, kind: 'window', reason: 'x' });
});
