// The CMS endpoints with an agent token (plan 5, Task 3): a member's token
// drafts, saves and submits in the member's name, and never approves.
// A real SQLite copy of the D1 schema; a fake GitHub behind global.fetch
// that holds no files (every new name is free), as in tests/cms-api.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { call } from './lib/social';
import { bearer, mintToken } from './lib/agent';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import * as types from '../functions/api/cms/types';
import * as drafts from '../functions/api/cms/drafts';
import * as draft from '../functions/api/cms/drafts/[id]';
import * as submit from '../functions/api/cms/drafts/[id]/submit';
import * as approve from '../functions/api/cms/drafts/[id]/approve';
import * as reject from '../functions/api/cms/drafts/[id]/reject';
import * as cancel from '../functions/api/cms/drafts/[id]/cancel';
import * as pull from '../functions/api/cms/podcast/pull';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const INDEX = buildCmsIndex({});
const ORIGIN = { Origin: 'https://rsg-turkiye.iscbsc.org' };

// GitHub with an empty repository: a content read is a 404, anything else is a test failure.
const ghCalls: string[] = [];
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  ghCalls.push(`${method} ${url.pathname}`);
  if (method === 'GET' && url.pathname.includes('/contents/')) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  throw new Error(`unexpected fake GitHub call: ${method} ${url}`);
}) as never;

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_admin, is_member, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1, 1)');
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  const session = db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, isAdmin] of [['admin', 1], ['editor', 0], ['editor2', 0], ['approver', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, isAdmin);
    session.run(`s-${id}`, id);
  }
  grant.run('g0', 'admin', 'admin');
  grant.run('g1', 'editor', 'content.etkinlikler.edit');
  grant.run('g1b', 'editor', 'content.yazilar.edit');
  grant.run('g2', 'editor2', 'content.etkinlikler.edit');
  grant.run('g3', 'approver', 'content.etkinlikler.approve');
  const assets = { fetch: async (req: Request) => new URL(req.url).pathname === '/cms-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 }) };
  const env = { DB: d1(db), GITHUB_PAT: 'unused', ASSETS: assets } as never;
  const audit = () => db.prepare('SELECT user_id, action, target_id, details FROM audit_log ORDER BY seq').all() as { user_id: string; action: string; target_id: string; details: string }[];
  const row = (id: string) => db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as Record<string, any>;
  return { db, env, audit, row };
}
type Env = ReturnType<typeof setup>['env'];

/** As a person (session cookie) or as an agent (a token value). */
type As = { session: string } | { token: string };
const req = (env: Env, handler: unknown, method: string, path: string, as: As, body?: unknown, params?: Record<string, string>) =>
  'session' in as
    ? call(handler, method, path, { env, as: as.session, body, params, headers: ORIGIN })
    : call(handler, method, path, { env, body, params, headers: bearer(as.token) });
const on = (env: Env, h: unknown, method: string, id: string, as: As, body?: unknown, suffix = '') =>
  req(env, h, method, `/api/cms/drafts/${id}${suffix}`, as, body, { id });

const newEvent = (title = 'Ankara meetup') => ({
  id: 'meetup-ankara-2027',
  type: 'meetup',
  start: '2027-03-06',
  title: { en: title, tr: 'Ankara buluşması' },
  when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' },
  description: { en: 'An evening meetup.', tr: 'Bir akşam buluşması.' },
});
const newPost = () => ({
  en: { frontmatter: { title: 'A post', pubDate: '2027-01-05', description: 'D.', author: 'An Author', category: 'general', tags: [], image: '', draft: false }, body: 'Text.' },
  tr: null,
});

async function createAs(env: Env, as: As, body: unknown = { type: 'events', action: 'create', data: newEvent() }) {
  const res = await req(env, drafts.onRequestPost, 'POST', '/api/cms/drafts', as, body);
  return { res, body: await res.json() as any };
}

test('an editor\'s draft token creates, saves and submits an event draft; each step is logged as the agent, in the member\'s name', async () => {
  const { db, env, audit, row } = setup();
  const token = await mintToken(db, 'editor', ['cms.etkinlikler:draft'], { id: 'tok-ed' });
  const me = { token };

  const made = await createAs(env, me);
  assert.equal(made.res.status, 201);
  assert.equal(made.body.draft.by_agent, true);
  assert.equal(made.body.draft.author_id, 'editor');
  assert.ok(!('agent_token_id' in made.body.draft), 'the id stays on the server');
  const id = made.body.draft.id;
  assert.equal(row(id).agent_token_id, 'tok-ed');

  const saved = await on(env, draft.onRequestPatch, 'PATCH', id, me, { data: newEvent('Ankara evening'), write_nonce: made.body.draft.write_nonce });
  assert.equal(saved.status, 200);
  assert.equal((await saved.json() as any).draft.by_agent, true);
  assert.equal(JSON.parse(row(id).data).title.en, 'Ankara evening');

  const sent = await on(env, submit.onRequestPost, 'POST', id, me, undefined, '/submit');
  assert.equal(sent.status, 200);
  assert.equal((await sent.json() as any).draft.status, 'submitted');
  assert.equal(row(id).status, 'submitted');

  const rows = audit();
  assert.deepEqual(rows.map((r) => r.action), ['cms.draft.create', 'cms.draft.update', 'cms.draft.submit']);
  for (const r of rows) {
    assert.equal(r.user_id, 'editor');
    assert.equal(r.target_id, id);
    const d = JSON.parse(r.details);
    assert.equal(d.via, 'agent');
    assert.equal(d.agent_token, 'tok-ed');
  }

  // The list shows the mark too.
  const list = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', me)).json() as any;
  assert.equal(list.mine[0].by_agent, true);
  // A person's draft carries no mark.
  const mine = await createAs(env, { session: 'editor2' });
  assert.equal(mine.body.draft.by_agent, false);
  assert.ok(!('via' in JSON.parse(audit().at(-1)!.details)));
});

test('Review Focus 5: a token save needs write_nonce, a stale one is refused, a session save without one still works, and a person\'s save keeps the mark', async () => {
  const { db, env, row } = setup();
  const token = await mintToken(db, 'editor', ['cms.etkinlikler:draft'], { id: 'tok-ed' });
  const made = await createAs(env, { token });
  const id = made.body.draft.id;
  const before = row(id);

  const bare = await on(env, draft.onRequestPatch, 'PATCH', id, { token }, { data: newEvent('Changed') });
  assert.equal(bare.status, 400);
  assert.equal((await bare.json() as any).code, 'write_nonce_required');
  const nulled = await on(env, draft.onRequestPatch, 'PATCH', id, { token }, { data: newEvent('Changed'), write_nonce: null });
  assert.equal((await nulled.json() as any).code, 'write_nonce_required');
  assert.deepEqual(row(id), before);

  const stale = await on(env, draft.onRequestPatch, 'PATCH', id, { token }, { data: newEvent('Changed'), write_nonce: crypto.randomUUID() });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as any).code, 'draft_changed');
  assert.deepEqual(row(id), before);

  // The panel (a session) saves without a nonce, as it always could; the mark stays.
  const person = await on(env, draft.onRequestPatch, 'PATCH', id, { session: 'editor' }, { data: newEvent('By hand') });
  assert.equal(person.status, 200);
  assert.equal((await person.json() as any).draft.by_agent, true);
  assert.equal(JSON.parse(row(id).data).title.en, 'By hand');
  assert.equal(row(id).agent_token_id, 'tok-ed');
});

test('Review Focus 1 (CMS): an approver\'s and an admin\'s token get human_only from approve, reject and cancel, and nothing changes', async () => {
  const { db, env, audit, row } = setup();
  const made = await createAs(env, { session: 'editor' });
  const id = made.body.draft.id;
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, { session: 'editor' }, undefined, '/submit')).status, 200);
  // A second draft with an open pull request, for cancel.
  const other = await createAs(env, { session: 'editor2' }, { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-izmir-2027' } });
  db.prepare(`UPDATE content_drafts SET status = 'pr_open', pr_number = 41, pr_url = 'https://github.com/RSG-Turkiye/website/pull/41' WHERE id = ?`).run(other.body.draft.id);

  for (const user of ['approver', 'admin']) {
    const token = await mintToken(db, user, ['cms.etkinlikler:draft']);
    const rows = [row(id), row(other.body.draft.id)];
    const log = audit();
    ghCalls.length = 0;
    for (const [h, target, suffix, body] of [
      [approve.onRequestPost, id, '/approve', undefined],
      [reject.onRequestPost, id, '/reject', { note: 'No.' }],
      [cancel.onRequestPost, other.body.draft.id, '/cancel', undefined],
    ] as const) {
      const res = await on(env, h, 'POST', target, { token }, body, suffix);
      assert.equal(res.status, 403, `${user} ${suffix}`);
      assert.equal((await res.json() as any).code, 'human_only', `${user} ${suffix}`);
    }
    assert.deepEqual([row(id), row(other.body.draft.id)], rows);
    assert.deepEqual(audit(), log);
    assert.deepEqual(ghCalls, []);
  }
  // The same people in the panel still approve.
  assert.notEqual((await on(env, reject.onRequestPost, 'POST', id, { session: 'approver' }, { note: 'No.' }, '/reject')).status, 403);
});

test('an approver\'s token reaches only the member\'s own drafts: no queue, no in-flight list, no one else\'s draft', async () => {
  const { db, env, row } = setup();
  const made = await createAs(env, { session: 'editor' });
  const id = made.body.draft.id;
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, { session: 'editor' }, undefined, '/submit')).status, 200);
  // The approver in the panel sees it waiting.
  const panel = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', { session: 'approver' })).json() as any;
  assert.equal(panel.queue.length, 1);

  const token = await mintToken(db, 'approver', ['cms.etkinlikler:draft']);
  const list = await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', { token });
  assert.equal(list.status, 200);
  const body = await list.json() as any;
  assert.deepEqual(body.queue, []);
  assert.deepEqual(body.inflight, []);
  assert.deepEqual(body.mine, []);

  // A draft still with its author, so only the approve-level reach could open it.
  db.prepare(`UPDATE content_drafts SET status = 'draft' WHERE id = ?`).run(id);
  const before = row(id);
  assert.equal((await on(env, draft.onRequestGet, 'GET', id, { token })).status, 403);
  const patch = await on(env, draft.onRequestPatch, 'PATCH', id, { token }, { data: newEvent('Taken over'), write_nonce: before.write_nonce });
  assert.equal(patch.status, 403);
  assert.deepEqual(row(id), before);
});

test('a read token reads but cannot draft; a draft token for one group cannot draft in another the member also edits', async () => {
  const { db, env } = setup();
  const read = await mintToken(db, 'editor', ['cms.etkinlikler:read']);
  const made = await createAs(env, { session: 'editor' });
  assert.equal((await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', { token: read })).status, 200);
  assert.equal((await on(env, draft.onRequestGet, 'GET', made.body.draft.id, { token: read })).status, 200);
  assert.equal((await req(env, types.onRequestGet, 'GET', '/api/cms/types', { token: read })).status, 200);
  const refused = await createAs(env, { token: read });
  assert.equal(refused.res.status, 403);

  const events = await mintToken(db, 'editor', ['cms.etkinlikler:draft']);
  // The member edits Yazılar in the panel...
  assert.equal((await createAs(env, { session: 'editor' }, { type: 'blog', action: 'create', data: newPost() })).res.status, 201);
  // ...but this token was not given it.
  const blog = await createAs(env, { token: events }, { type: 'blog', action: 'create', data: newPost() });
  assert.equal(blog.res.status, 403);
});

test('a token discards only a draft that is with its author: submitted is bad_state, its own draft goes', async () => {
  const { db, env, row } = setup();
  const token = await mintToken(db, 'editor', ['cms.etkinlikler:draft'], { id: 'tok-ed' });
  const sent = (await createAs(env, { token })).body.draft.id;
  assert.equal((await on(env, submit.onRequestPost, 'POST', sent, { token }, undefined, '/submit')).status, 200);
  const res = await on(env, draft.onRequestDelete, 'DELETE', sent, { token });
  assert.equal(res.status, 409);
  assert.equal((await res.json() as any).code, 'bad_state');
  assert.equal(row(sent).status, 'submitted');

  const own = (await createAs(env, { token }, { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-izmir-2027' } })).body.draft.id;
  const gone = await on(env, draft.onRequestDelete, 'DELETE', own, { token });
  assert.equal(gone.status, 200);
  assert.equal(row(own).status, 'discarded');
  // The panel still withdraws a submitted draft.
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', sent, { session: 'editor' })).status, 200);
});

test('types, for a token, lists only the scoped groups\' types and never canApprove', async () => {
  const { db, env } = setup();
  const token = await mintToken(db, 'admin', ['cms.etkinlikler:read']);
  const body = await (await req(env, types.onRequestGet, 'GET', '/api/cms/types', { token })).json() as any;
  assert.deepEqual(body.types.map((t: any) => t.group).filter((g: string, i: number, a: string[]) => a.indexOf(g) === i), ['etkinlikler']);
  assert.ok(body.types.length > 0);
  for (const t of body.types) assert.equal(t.canApprove, false);
});

test('with a bearer header the token alone decides: a bad token beside a valid session is 401', async () => {
  const { env } = setup();
  const res = await call(drafts.onRequestGet, 'GET', '/api/cms/drafts', { env, as: 'editor', headers: { ...ORIGIN, Authorization: 'Bearer rsg_pat_' + 'x'.repeat(43) } });
  assert.equal(res.status, 401);
  assert.equal((await res.json() as any).code, 'unauthorized');
});

test('a Topluluk draft token\'s podcast pull logs both of its rows as the agent', async () => {
  const { db, env, audit } = setup();
  db.prepare(`INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES ('g9', 'editor', 'content.topluluk.edit', NULL, NULL, 1)`).run();
  const token = await mintToken(db, 'editor', ['cms.topluluk:draft'], { id: 'tok-pod' });
  // The fake network refuses the feed, so the pull ends in feed_failed after both rows.
  const res = await req(env, pull.onRequestPost, 'POST', '/api/cms/podcast/pull', { token });
  assert.equal(res.status, 502);
  const rows = audit();
  assert.deepEqual(rows.map((r) => r.action), ['cms.podcast.pull', 'cms.podcast.result']);
  for (const r of rows) {
    assert.equal(r.user_id, 'editor');
    assert.equal(JSON.parse(r.details).agent_token, 'tok-pod');
    assert.equal(JSON.parse(r.details).via, 'agent');
  }
});

test('an admin\'s token (users.is_admin set, live admin grant) has no approve reach and no one else\'s drafts', async () => {
  const { db, env, row } = setup();
  const id = (await createAs(env, { session: 'editor' })).body.draft.id;
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, { session: 'editor' }, undefined, '/submit')).status, 200);
  const other = (await createAs(env, { session: 'editor2' }, { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-izmir-2027' } })).body.draft;
  // The admin's session sees the queue and opens both drafts.
  const panel = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', { session: 'admin' })).json() as any;
  assert.equal(panel.queue.length, 1);
  assert.equal((await on(env, draft.onRequestGet, 'GET', other.id, { session: 'admin' })).status, 200);

  const token = await mintToken(db, 'admin', ['cms.etkinlikler:draft']);
  const list = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', { token })).json() as any;
  assert.deepEqual([list.mine, list.queue, list.inflight], [[], [], []]);
  const typesBody = await (await req(env, types.onRequestGet, 'GET', '/api/cms/types', { token })).json() as any;
  for (const t of typesBody.types) assert.equal(t.canApprove, false);
  const before = [row(id), row(other.id)];
  assert.equal((await on(env, draft.onRequestGet, 'GET', id, { token })).status, 403);
  assert.equal((await on(env, draft.onRequestGet, 'GET', other.id, { token })).status, 403);
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', other.id, { token }, { data: newEvent('Taken over'), write_nonce: other.write_nonce })).status, 403);
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', other.id, { token })).status, 403);
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, { token }, undefined, '/approve')).status, 403);
  assert.deepEqual([row(id), row(other.id)], before);
});
