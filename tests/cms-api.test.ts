// The panel CMS's API (/api/cms/*) end to end: drafts in a real SQLite copy
// of the D1 schema, and a fake GitHub behind global.fetch, so the real
// functions/_lib/github.ts runs with no token and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { call } from './lib/social';
import { buildCmsIndex, type CmsIndex } from '../src/lib/cms/cms-index';
import { cmsType } from '../src/lib/cms/types';
import { parseJson, parseMarkdown, serializeJson } from '../src/lib/cms/serialize';
import { filesFor, validateDraft, prTitle, prBody } from '../functions/_lib/cms-drafts';
import { setCmsIndexLoader } from '../functions/_lib/cms-api';
import * as types from '../functions/api/cms/types';
import * as entries from '../functions/api/cms/entries';
import * as entry from '../functions/api/cms/entry';
import * as drafts from '../functions/api/cms/drafts';
import * as draft from '../functions/api/cms/drafts/[id]';
import * as submit from '../functions/api/cms/drafts/[id]/submit';
import * as approve from '../functions/api/cms/drafts/[id]/approve';
import * as reject from '../functions/api/cms/drafts/[id]/reject';

const ROOT = new URL('../', import.meta.url).pathname;
const SCHEMA = readFileSync(`${ROOT}db/schema.sql`, 'utf8');
const EVENTS = cmsType('events')!;
const WEBINARS = cmsType('webinars')!;

// ── the repository on main, read from this checkout ───────────────────────────

function contentFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['src/content/events', 'src/content/workshops']) {
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = readFileSync(`${ROOT}${dir}/${f}`, 'utf8');
  }
  for (const lang of ['en', 'tr']) {
    const dir = `src/content/webinars/${lang}`;
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = readFileSync(`${ROOT}${dir}/${f}`, 'utf8');
  }
  return out;
}
const FILES = contentFiles();
const INDEX: CmsIndex = buildCmsIndex(FILES);

const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');

// ── a fake GitHub ─────────────────────────────────────────────────────────────

type Req = { method: string; path: string; body: any };

class FakeGitHub {
  main = new Map<string, string>(Object.entries(FILES));
  branches = new Map<string, Map<string, string>>();
  prs: { title: string; body: string; head: string; number: number }[] = [];
  requests: Req[] = [];
  /** What POST /pulls answers. */
  pulls: 'ok' | 'no-commits' | 'error' = 'ok';

  files(ref: string): Map<string, string> | undefined {
    return ref === 'main' ? this.main : this.branches.get(ref);
  }

  handle(method: string, url: URL, body: any): Response {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const p = url.pathname.replace('/repos/RSG-Turkiye/website', '');
    if (method === 'GET' && p === '/git/ref/heads/main') return json({ object: { sha: 'a'.repeat(40) } });
    if (method === 'POST' && p === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (this.branches.has(name)) return json({ message: 'Reference already exists' }, 422);
      this.branches.set(name, new Map(this.main));
      return json({}, 201);
    }
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      if (method === 'GET') {
        const content = this.files(url.searchParams.get('ref') ?? 'main')?.get(path);
        if (content === undefined) return json({ message: 'Not Found' }, 404);
        return json({ sha: blobSha(content), content: Buffer.from(content).toString('base64'), encoding: 'base64' });
      }
      const branch = this.branches.get(body.branch)!;
      if (method === 'PUT') {
        branch.set(path, Buffer.from(body.content, 'base64').toString('utf8'));
        return json({ content: {} }, 201);
      }
      if (method === 'DELETE') {
        if (blobSha(branch.get(path) ?? '') !== body.sha) return json({ message: 'sha mismatch' }, 409);
        branch.delete(path);
        return json({ commit: {} });
      }
    }
    if (method === 'POST' && p === '/pulls') {
      if (this.pulls === 'no-commits') return json({ message: 'Validation Failed', errors: [{ message: 'No commits between main and x' }] }, 422);
      if (this.pulls === 'error') return json({ message: 'Server Error: secret-detail-from-github' }, 500);
      const number = this.prs.length + 41;
      this.prs.push({ title: body.title, body: body.body, head: body.head, number });
      return json({ html_url: `https://github.com/RSG-Turkiye/website/pull/${number}` }, 201);
    }
    if (method === 'GET' && p === '/pulls') return json([]);
    throw new Error(`unexpected fake GitHub call: ${method} ${url}`);
  }

  /** Writes to a branch, in order. */
  writes(): { method: string; path: string }[] {
    return this.requests
      .filter((r) => (r.method === 'PUT' || r.method === 'DELETE') && r.path.includes('/contents/'))
      .map((r) => ({ method: r.method, path: decodeURIComponent(r.path.split('/contents/')[1].split('?')[0]) }));
  }
}

let gh = new FakeGitHub();
globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
  const url = new URL(String(input));
  const method = init?.method ?? 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  gh.requests.push({ method, path: url.pathname + url.search, body });
  return gh.handle(method, url, body);
}) as never;

// ── the database and the people ───────────────────────────────────────────────

function setup() {
  gh = new FakeGitHub();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare('INSERT INTO users (id, google_id, email, is_admin, is_member, created_at, last_login) VALUES (?, ?, ?, ?, 1, 1, 1)');
  const grant = db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  const session = db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)');
  for (const [id, isAdmin] of [['admin', 1], ['editor', 0], ['editor2', 0], ['approver', 0], ['member', 0]] as const) {
    add.run(id, `g-${id}`, `${id}@example.org`, isAdmin);
    session.run(`s-${id}`, id);
  }
  grant.run('g1', 'editor', 'content.etkinlikler.edit');
  grant.run('g2', 'editor2', 'content.etkinlikler.edit');
  grant.run('g3', 'approver', 'content.etkinlikler.approve');
  const assets = { fetch: async (req: Request) => new URL(req.url).pathname === '/cms-index.json' ? new Response(JSON.stringify(INDEX)) : new Response('', { status: 404 }) };
  const env = { DB: d1(db), GITHUB_PAT: 'unused', ASSETS: assets } as never;
  const audit = () => db.prepare('SELECT action, target_type, target_id, details FROM audit_log ORDER BY seq').all() as { action: string; target_type: string; target_id: string; details: string }[];
  const row = (id: string) => db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as Record<string, any>;
  return { db, env, audit, row };
}

type Env = ReturnType<typeof setup>['env'];
const ORIGIN = { Origin: 'https://rsg-turkiye.iscbsc.org' };

const req = (env: Env, handler: unknown, method: string, path: string, as?: string, body?: unknown, params?: Record<string, string>) =>
  call(handler, method, path, { env, as, body, params, headers: ORIGIN });

async function create(env: Env, as: string, body: unknown) {
  const res = await req(env, drafts.onRequestPost, 'POST', '/api/cms/drafts', as, body);
  return { res, body: await res.json() as any };
}
const on = (env: Env, h: unknown, method: string, id: string, as: string, body?: unknown, suffix = '') =>
  req(env, h, method, `/api/cms/drafts/${id}${suffix}`, as, body, { id });

const symposium2026 = () => JSON.parse(FILES['src/content/events/symposium-2026.json']);
const newEvent = () => ({
  id: 'meetup-ankara-2027',
  type: 'meetup',
  start: '2027-03-06',
  title: { en: 'Ankara meetup', tr: 'Ankara buluşması' },
  when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' },
  description: { en: 'An evening meetup.', tr: 'Bir akşam buluşması.' },
});

// ── the build-time index ──────────────────────────────────────────────────────

test('the index pairs every webinar by the translation rule, not by file name', () => {
  assert.equal(INDEX.webinars.length, 82);
  for (const w of INDEX.webinars) assert.ok(w.paths?.en && w.paths?.tr, w.id);
  const pair = INDEX.webinars.find((w) => w.id === 'integrative-modeling-of-biomolecular-complexes')!;
  assert.deepEqual(pair.paths, {
    en: 'src/content/webinars/en/integrative-modeling-of-biomolecular-complexes.md',
    tr: 'src/content/webinars/tr/first-webinar-2018-integrative-modeling.md',
  });
  assert.ok(INDEX.events.some((e) => e.id === 'symposium-2026' && e.title === symposium2026().title.en));
  assert.equal(INDEX.workshops.length, readdirSync(`${ROOT}src/content/workshops`).length);
});

test('entries come from the index the build wrote, or the injected loader when there is no ASSETS', async () => {
  const { env } = setup();
  const res = await req(env, entries.onRequestGet, 'GET', '/api/cms/entries?type=events', 'editor');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.deepEqual(body.entries, INDEX.events);

  const bare = { ...(env as any), ASSETS: undefined } as never;
  assert.equal((await req(bare, entries.onRequestGet, 'GET', '/api/cms/entries?type=events', 'editor')).status, 503);
  setCmsIndexLoader(async () => INDEX);
  try {
    const again = await req(bare, entries.onRequestGet, 'GET', '/api/cms/entries?type=workshops', 'editor');
    assert.deepEqual((await again.json() as any).entries, INDEX.workshops);
  } finally {
    setCmsIndexLoader(null);
  }
});

test('types lists what the user can edit, with its JSON Schema', async () => {
  const { env } = setup();
  const body = await (await req(env, types.onRequestGet, 'GET', '/api/cms/types', 'editor')).json() as any;
  assert.deepEqual(body.types.map((t: any) => t.key), ['events', 'workshops', 'webinars']);
  assert.equal(body.types[0].canApprove, false);
  assert.equal(body.types[0].schema.properties.start.format, 'date');
});

test('entry reads the current files and their shas from main; a webinar finds its pair', async () => {
  const { env } = setup();
  const res = await req(env, entry.onRequestGet, 'GET', '/api/cms/entry?type=webinars&id=integrative-modeling-of-biomolecular-complexes', 'editor');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  const tr = 'src/content/webinars/tr/first-webinar-2018-integrative-modeling.md';
  assert.equal(body.base_shas[tr], blobSha(FILES[tr]));
  assert.deepEqual(body.data.tr.frontmatter, parseMarkdown(WEBINARS, FILES[tr]).frontmatter);
  assert.equal(body.data.tr.source, parseMarkdown(WEBINARS, FILES[tr]).source);

  const ev = await (await req(env, entry.onRequestGet, 'GET', '/api/cms/entry?type=events&id=symposium-2026', 'editor')).json() as any;
  assert.deepEqual(ev.data, symposium2026());
  assert.equal((await req(env, entry.onRequestGet, 'GET', '/api/cms/entry?type=events&id=no-such-event', 'editor')).status, 404);
  assert.equal((await req(env, entry.onRequestGet, 'GET', '/api/cms/entry?type=events&id=../x', 'editor')).status, 400);
});

// ── the whole path ────────────────────────────────────────────────────────────

test('create, save, submit, approve: a pull request is opened and every step is logged', async () => {
  const { env, audit, row } = setup();
  const made = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  assert.equal(made.res.status, 201);
  const id = made.body.draft.id;
  assert.equal(made.body.draft.entry_id, 'meetup-ankara-2027');
  assert.equal(made.body.draft.status, 'draft');
  assert.deepEqual(made.body.draft.base_shas, { 'src/content/events/meetup-ankara-2027.json': null });

  const edited = { ...newEvent(), description: { en: 'An evening meetup in Ankara.', tr: 'Ankara’da bir akşam buluşması.' } };
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: edited })).status, 200);
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')).status, 200);
  assert.equal(row(id).status, 'submitted');

  // The editor's own list has it; the approver's queue has it.
  const mine = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor')).json() as any;
  assert.deepEqual(mine.mine.map((d: any) => d.id), [id]);
  assert.deepEqual(mine.queue, []);
  const queue = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'approver')).json() as any;
  assert.deepEqual(queue.queue.map((d: any) => d.id), [id]);

  const res = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  const after = row(id);
  assert.equal(after.status, 'pr_open');
  assert.equal(after.pr_number, 41);
  assert.equal(after.pr_url, 'https://github.com/RSG-Turkiye/website/pull/41');
  assert.equal(after.reviewer_id, 'approver');

  const pr = gh.prs[0];
  assert.equal(pr.head, `cms/${id}`);
  assert.equal(pr.title, 'CMS: create events meetup-ankara-2027');
  assert.ok(pr.body.includes(id) && pr.body.includes('events') && pr.body.includes('meetup-ankara-2027'));
  assert.ok(pr.body.includes(`https://rsg-turkiye.iscbsc.org/admin#icerik-etkinlikler/taslaklar/${id}`));
  assert.equal(gh.branches.get(`cms/${id}`)!.get('src/content/events/meetup-ankara-2027.json'), serializeJson(EVENTS, edited));

  assert.deepEqual(audit().map((a) => a.action), ['cms.draft.create', 'cms.draft.update', 'cms.draft.submit', 'cms.draft.approve', 'cms.pr.open']);
  for (const a of audit()) {
    assert.equal(a.target_type, 'content_draft');
    assert.equal(a.target_id, id);
    assert.doesNotMatch(a.details, /@|Ankara/, 'ids and codes only, never the content or an address');
  }
});

test('the pull request title and body carry no @ and no name, whoever wrote and approved it', async () => {
  const { env } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: 'symposium-2026', data: { ...symposium2026(), note: 'x' } });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  await on(env, approve.onRequestPost, 'POST', body.draft.id, 'admin', {}, '/approve');
  const pr = gh.prs[0];
  for (const text of [pr.title, pr.body]) {
    assert.doesNotMatch(text, /@/);
    assert.doesNotMatch(text, /editor|admin@|example\.org/);
  }
  // The pure builders too, for any inputs.
  const fake = { id: 'd1', type: 'events', entry_id: 'x', action: 'update' } as never;
  assert.doesNotMatch(prTitle(fake) + prBody(fake), /@/);
});

// ── rights ────────────────────────────────────────────────────────────────────

test('an editor cannot approve or send back, nor open someone else\'s draft', async () => {
  const { env, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');

  for (const as of ['editor', 'editor2']) {
    const a = await on(env, approve.onRequestPost, 'POST', id, as, {}, '/approve');
    assert.equal(a.status, 403);
    const r = await on(env, reject.onRequestPost, 'POST', id, as, { note: 'no' }, '/reject');
    assert.equal(r.status, 403);
  }
  assert.equal(row(id).status, 'submitted');
  assert.equal(gh.prs.length, 0);

  const other = await on(env, draft.onRequestGet, 'GET', id, 'editor2');
  assert.equal(other.status, 403);
  assert.doesNotMatch(await other.text(), /Ankara/);
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', id, 'editor2')).status, 403);
});

test('someone with no content role gets 403 from every endpoint, and no draft data', async () => {
  const { env } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');

  const calls: [unknown, string, string, unknown?, Record<string, string>?][] = [
    [types.onRequestGet, 'GET', '/api/cms/types'],
    [entries.onRequestGet, 'GET', '/api/cms/entries?type=events'],
    [entry.onRequestGet, 'GET', '/api/cms/entry?type=events&id=symposium-2026'],
    [drafts.onRequestGet, 'GET', '/api/cms/drafts'],
    [drafts.onRequestPost, 'POST', '/api/cms/drafts', { type: 'events', action: 'create', data: newEvent() }],
    [draft.onRequestGet, 'GET', `/api/cms/drafts/${id}`, undefined, { id }],
    [draft.onRequestPatch, 'PATCH', `/api/cms/drafts/${id}`, { data: newEvent() }, { id }],
    [draft.onRequestDelete, 'DELETE', `/api/cms/drafts/${id}`, undefined, { id }],
    [submit.onRequestPost, 'POST', `/api/cms/drafts/${id}/submit`, {}, { id }],
    [approve.onRequestPost, 'POST', `/api/cms/drafts/${id}/approve`, {}, { id }],
    [reject.onRequestPost, 'POST', `/api/cms/drafts/${id}/reject`, { note: 'x' }, { id }],
  ];
  for (const [h, method, path, b, params] of calls) {
    const res = await req(env, h, method, path, 'member', b, params);
    assert.equal(res.status, 403, `${method} ${path}`);
    const out = await res.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(out).sort(), ['code', 'error'], `${method} ${path}`);
    assert.doesNotMatch(JSON.stringify(out), /Ankara|meetup|draft/i);
  }
  // And signed out: 401 everywhere.
  for (const [h, method, path, b, params] of calls) {
    assert.equal((await req(env, h, method, path, undefined, b, params)).status, 401, `${method} ${path}`);
  }
  assert.equal(gh.prs.length, 0);
});

test('an approver may approve their own draft', async () => {
  const { env, row } = setup();
  const { body } = await create(env, 'approver', { type: 'events', action: 'create', data: newEvent() });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/submit');
  const res = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  assert.equal(row(body.draft.id).status, 'pr_open');
});

test('mutating calls from another origin are refused', async () => {
  const { env } = setup();
  const res = await call(drafts.onRequestPost, 'POST', '/api/cms/drafts', {
    env, as: 'editor', body: { type: 'events', action: 'create', data: newEvent() }, headers: { Origin: 'https://evil.example' },
  });
  assert.equal(res.status, 403);
  assert.equal((await res.json() as any).code, 'csrf');
});

// ── no silent overwrite ───────────────────────────────────────────────────────

test('approval refuses with changed_since when the file changed on main, and opens nothing', async () => {
  const { env, row } = setup();
  const path = 'src/content/events/symposium-2026.json';
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: 'symposium-2026', data: { ...symposium2026(), note: 'draft' } });
  assert.equal(body.draft.base_shas[path], blobSha(FILES[path]));
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');

  gh.main.set(path, FILES[path].replace('"symposium"', '"symposium" '));
  const res = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(res.status, 409);
  const out = await res.json() as any;
  assert.equal(out.code, 'changed_since');
  assert.deepEqual(out.paths, [path]);
  assert.equal(row(id).status, 'submitted');
  assert.equal(gh.prs.length, 0);
  assert.deepEqual(gh.writes(), []);
});

test('a new entry whose file appeared on main meanwhile is changed_since too', async () => {
  const { env } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  gh.main.set('src/content/events/meetup-ankara-2027.json', '{}\n');
  const res = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  assert.equal(res.status, 409);
  assert.equal((await res.json() as any).code, 'changed_since');
});

test('creating an entry that already exists is refused', async () => {
  const { env } = setup();
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'create', data: symposium2026() });
  assert.equal(res.status, 409);
  assert.equal(body.code, 'exists');
});

test('a draft started from a stale read is refused at once', async () => {
  const { env } = setup();
  const path = 'src/content/events/symposium-2026.json';
  const { res, body } = await create(env, 'editor', {
    type: 'events', action: 'update', entry_id: 'symposium-2026', data: symposium2026(), base_shas: { [path]: 'b'.repeat(40) },
  });
  assert.equal(res.status, 409);
  assert.equal(body.code, 'changed_since');
  assert.deepEqual(body.paths, [path]);
});

// ── webinars: one draft, two files ────────────────────────────────────────────

test('a new webinar writes exactly two files, with the same name in both languages', async () => {
  const { env } = setup();
  const side = (title: string, lang: string) => ({
    frontmatter: { title, date: '2027-01-15', speaker: 'Speaker', description: `${lang} description`, year: 2027, type: 'bioinfonet' },
    body: `\n${lang} body\n`,
  });
  const { res, body } = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Protein Design Today', 'en'), tr: side('Bugün Protein Tasarımı', 'tr') } });
  assert.equal(res.status, 201);
  assert.equal(body.draft.entry_id, 'protein-design-today');
  const files = filesFor({ ...body.draft, data: JSON.stringify(body.draft.data), base_shas: JSON.stringify(body.draft.base_shas) });
  assert.deepEqual(files.map((f) => f.path).sort(), [
    'src/content/webinars/en/protein-design-today.md',
    'src/content/webinars/tr/protein-design-today.md',
  ]);
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  assert.deepEqual(gh.writes().map((w) => w.path).sort(), files.map((f) => f.path).sort());
});

test('editing an existing pair with different file names writes back to both existing files, unchanged keys byte for byte', async () => {
  const { env } = setup();
  const en = 'src/content/webinars/en/integrative-modeling-of-biomolecular-complexes.md';
  const tr = 'src/content/webinars/tr/first-webinar-2018-integrative-modeling.md';
  const current = await (await req(env, entry.onRequestGet, 'GET', '/api/cms/entry?type=webinars&id=integrative-modeling-of-biomolecular-complexes', 'editor')).json() as any;
  // The client sends back what it read, minus `source`: the server keeps its own.
  const data = {
    en: { frontmatter: { ...current.data.en.frontmatter, topic: 'Integrative modelling' }, body: current.data.en.body },
    tr: { frontmatter: current.data.tr.frontmatter, body: current.data.tr.body },
  };
  const { res, body } = await create(env, 'editor', { type: 'webinars', action: 'update', entry_id: 'integrative-modeling-of-biomolecular-complexes', data, base_shas: current.base_shas });
  assert.equal(res.status, 201);
  assert.deepEqual(Object.keys(body.draft.base_shas).sort(), [en, tr]);

  const files = filesFor({ ...body.draft, data: JSON.stringify(body.draft.data), base_shas: JSON.stringify(body.draft.base_shas) });
  assert.equal(files.length, 2);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.content]));
  assert.equal(byPath[tr], FILES[tr], 'the untouched side is byte-identical');
  const enLines = (byPath[en] as string).split('\n');
  const before = FILES[en].split('\n');
  assert.equal(enLines.filter((l, i) => l !== before[i]).length, 1, 'one changed line on the edited side');

  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  const branch = gh.branches.get(`cms/${body.draft.id}`)!;
  assert.equal(branch.get(en), byPath[en]);
  assert.equal(branch.get(tr), FILES[tr]);
});

test('the two sides of a webinar must share their translationKey', () => {
  const fm = parseMarkdown(WEBINARS, FILES['src/content/webinars/en/molecular-simulations.md']).frontmatter;
  const result = validateDraft(WEBINARS, {
    en: { frontmatter: fm, body: '' },
    tr: { frontmatter: { ...fm, translationKey: 'something-else' }, body: '' },
  });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors['tr.frontmatter.translationKey']);
});

// ── validation ────────────────────────────────────────────────────────────────

test('a schema-invalid save answers with an error per field and keeps the last good data', async () => {
  const { env, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  const bad = { ...newEvent(), start: 'next spring', title: { en: 'Only English' }, colour: 'red' };
  const res = await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: bad });
  assert.equal(res.status, 422);
  const out = await res.json() as any;
  assert.equal(out.code, 'invalid');
  assert.ok(out.errors.start, 'start');
  assert.ok(out.errors['title.tr'], 'title.tr');
  assert.ok(out.errors.colour, 'unknown key');
  assert.deepEqual(JSON.parse(row(id).data), newEvent());

  const created = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), id: undefined } });
  assert.equal(created.res.status, 422);
  assert.ok(created.body.errors.id);
});

test('an update cannot rename the file', async () => {
  const { env } = setup();
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: 'symposium-2026', data: { ...symposium2026(), id: 'symposium-2026b' } });
  assert.equal(res.status, 422);
  assert.ok(body.errors.id);
});

// ── delete ────────────────────────────────────────────────────────────────────

test('a delete draft produces null files and deletes them on the branch', async () => {
  const { env } = setup();
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'delete', entry_id: 'meetup-izmir-2025' });
  assert.equal(res.status, 201);
  const files = filesFor({ ...body.draft, data: JSON.stringify(body.draft.data), base_shas: JSON.stringify(body.draft.base_shas) });
  assert.deepEqual(files, [{ path: 'src/content/events/meetup-izmir-2025.json', content: null }]);

  const pair = await create(env, 'editor', { type: 'webinars', action: 'delete', entry_id: 'molecular-simulations' });
  const pairFiles = filesFor({ ...pair.body.draft, data: JSON.stringify(pair.body.draft.data), base_shas: JSON.stringify(pair.body.draft.base_shas) });
  assert.deepEqual(pairFiles.map((f) => f.content), [null, null]);
  assert.deepEqual(pairFiles.map((f) => f.path).sort(), ['src/content/webinars/en/molecular-simulations.md', 'src/content/webinars/tr/molekuler-simulasyonlar.md']);

  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  assert.deepEqual(gh.writes(), [{ method: 'DELETE', path: 'src/content/events/meetup-izmir-2025.json' }]);
  assert.equal(gh.prs[0].title, 'CMS: delete events meetup-izmir-2025');
});

// ── the other transitions, each with its log row ──────────────────────────────

test('send back, edit, resubmit; discard; each writes its row', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  // A submitted draft is frozen until it is sent back.
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: newEvent() })).status, 409);

  assert.equal((await on(env, reject.onRequestPost, 'POST', id, 'approver', { note: 'Add the venue.' }, '/reject')).status, 200);
  assert.equal(row(id).status, 'rejected');
  assert.equal(row(id).review_note, 'Add the venue.');
  const seen = await (await on(env, draft.onRequestGet, 'GET', id, 'editor')).json() as any;
  assert.equal(seen.draft.review_note, 'Add the venue.');

  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), location: { en: 'Ankara, ODTÜ', tr: 'Ankara, ODTÜ' } } })).status, 200);
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')).status, 200);
  assert.equal(row(id).review_note, null);

  const other = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-ankara-2028' } });
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', other.body.draft.id, 'editor')).status, 200);
  assert.equal(row(other.body.draft.id).status, 'discarded');
  // Gone from the list.
  const mine = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor')).json() as any;
  assert.deepEqual(mine.mine.map((d: any) => d.id), [id]);

  assert.deepEqual(audit().map((a) => a.action), [
    'cms.draft.create', 'cms.draft.submit', 'cms.draft.reject', 'cms.draft.update', 'cms.draft.submit',
    'cms.draft.create', 'cms.draft.discard',
  ]);
});

test('content already on main: the draft is published, logged as a merge with noop', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: 'symposium-2026', data: symposium2026() });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  gh.pulls = 'no-commits';
  const res = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  assert.equal(row(body.draft.id).status, 'published');
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.pr.merged');
  assert.equal(JSON.parse(last.details).noop, true);
});

test('a GitHub failure: pr_failed with a short code, never GitHub\'s own text', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  gh.pulls = 'error';
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  let res: Response;
  try {
    res = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  } finally {
    console.error = realError;
  }
  assert.equal(res.status, 502);
  const text = await res.text();
  assert.doesNotMatch(text, /secret-detail/);
  assert.equal(JSON.parse(text).code, 'github_failed');
  const r = row(body.draft.id);
  assert.equal(r.status, 'pr_failed');
  assert.equal(r.failure, 'github_failed');
  assert.ok(errors.length > 0, 'the detail is logged on the server');
  assert.deepEqual(audit().slice(-2).map((a) => a.action), ['cms.draft.approve', 'cms.pr.failed']);
  assert.doesNotMatch(audit().at(-1)!.details, /secret-detail/);

  // The author fixes it and sends it again; the approver tries once more.
  gh.pulls = 'ok';
  assert.equal((await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit')).status, 200);
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(body.draft.id).status, 'pr_open');
});

test('a draft can be approved only once', async () => {
  const { env } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  const again = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'admin', {}, '/approve');
  assert.equal(again.status, 409);
  assert.equal((await again.json() as any).code, 'bad_state');
  assert.equal(gh.prs.length, 1);
});

test('the stored JSON draft round-trips a real file unchanged', () => {
  const path = 'src/content/events/symposium-2026.json';
  const files = filesFor({ type: 'events', entry_id: 'symposium-2026', action: 'update', data: JSON.stringify(parseJson(EVENTS, FILES[path])), base_shas: JSON.stringify({ [path]: blobSha(FILES[path]) }) });
  assert.deepEqual(files, [{ path, content: FILES[path] }]);
});

test('a draft left in approved by a crash can be approved again once it is stale', async () => {
  const { env, db, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  const now = Math.floor(Date.now() / 1000);
  db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = ? WHERE id = ?`).run(now - 10, id);
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 409, 'too fresh: the first attempt may still be running');
  db.prepare(`UPDATE content_drafts SET updated_at = ? WHERE id = ?`).run(now - 400, id);
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(id).status, 'pr_open');
});
