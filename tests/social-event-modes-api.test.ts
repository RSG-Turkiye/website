import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import * as modes from '../functions/api/social/event-modes/index';
import * as close from '../functions/api/social/event-modes/[id]/close';

const NOW = Math.floor(Date.now() / 1000);
const valid = { name: '13. Sempozyum', startsAt: NOW - 60, endsAt: NOW + 2 * 86400, editorIds: ['ed'] };

test('a publisher opens an event window; editors see it as active', async () => {
  const { env, db } = setupSocial();
  const res = await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body: valid });
  assert.equal(res.status, 201);
  const list = await (await call(modes.onRequestGet, 'GET', '/api/social/event-modes', { env, as: 'ed' })).json() as { modes: { name: string; active: boolean; editorEmails: string[] }[] };
  assert.deepEqual(list.modes.map((m) => [m.name, m.active, m.editorEmails]), [['13. Sempozyum', true, ['ed@example.org']]]);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.event.open'`).get() as { n: number }).n, 1);
});

test('only publishers open windows, and bad windows are refused', async () => {
  const { env } = setupSocial();
  assert.equal((await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'ed', body: valid })).status, 403);
  const cases: [Record<string, unknown>, string][] = [
    [{ ...valid, name: '' }, 'invalid_name'],
    [{ ...valid, endsAt: valid.startsAt }, 'invalid_window'],
    [{ ...valid, startsAt: NOW - 3 * 86400, endsAt: NOW - 86400 }, 'invalid_window'],
    [{ ...valid, endsAt: valid.startsAt + 8 * 86400 }, 'window_too_long'],
    [{ ...valid, editorIds: [] }, 'invalid_editors'],
    [{ ...valid, editorIds: ['mem'] }, 'invalid_editors'],
  ];
  for (const [body, code] of cases) {
    const res = await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body });
    assert.equal(res.status, 400, code);
    assert.equal((await res.json() as { code: string }).code, code);
  }
});

test('closing works once', async () => {
  const { env, db } = setupSocial();
  const { id } = await (await call(modes.onRequestPost, 'POST', '/api/social/event-modes', { env, as: 'pub', body: valid })).json() as { id: string };
  assert.equal((await call(close.onRequestPost, 'POST', `/api/social/event-modes/${id}/close`, { env, as: 'admin', params: { id } })).status, 200);
  assert.equal((await call(close.onRequestPost, 'POST', `/api/social/event-modes/${id}/close`, { env, as: 'pub', params: { id } })).status, 409);
  // Same user, same second: the second close must not leave a second audit row either.
  assert.equal((await call(close.onRequestPost, 'POST', `/api/social/event-modes/${id}/close`, { env, as: 'admin', params: { id } })).status, 409);
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'social.event.close'`).get() as { n: number }).n, 1);
  const list = await (await call(modes.onRequestGet, 'GET', '/api/social/event-modes', { env, as: 'ed' })).json() as { modes: { active: boolean }[] };
  assert.equal(list.modes[0].active, false);
});

test('closing an unknown window is a 404', async () => {
  const { env } = setupSocial();
  assert.equal((await call(close.onRequestPost, 'POST', '/api/social/event-modes/nope/close', { env, as: 'pub', params: { id: 'nope' } })).status, 404);
});
