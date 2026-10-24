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
import { realFixtures } from './lib/cms-fixtures';
import { z } from 'astro/zod';
import { cmsType, defineType, setTestCmsTypes, type CmsTypeKey } from '../src/lib/cms/types';
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
import * as cancel from '../functions/api/cms/drafts/[id]/cancel';
import * as counts from '../functions/api/admin/counts';
import { shepherd } from '../functions/_lib/cms-shepherd';
import { REQUIRED_CHECKS } from '../functions/_lib/github';

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
// Entries picked by shape, never by name: the panel edits and deletes them (A2).
const { EVENT_ID, EVENT_PATH, OTHER_EVENT_ID, OTHER_EVENT_PATH, PAIR_ID, PAIR_EN, PAIR_TR, PAIR_TR_TITLE, PAIR_KEY, OTHER_KEY } = realFixtures(FILES, INDEX);

const blobSha = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0${content}`).digest('hex');

// ── a fake GitHub ─────────────────────────────────────────────────────────────

type Req = { method: string; path: string; body: any };

class FakeGitHub {
  main = new Map<string, string>(Object.entries(FILES));
  branches = new Map<string, Map<string, string>>();
  prs: { title: string; body: string; head: string; number: number; state: 'open' | 'closed'; merged: boolean }[] = [];
  /** Commit sha → the tree at that commit. Main's head is derived from its files. */
  commits = new Map<string, Map<string, string>>();
  /** Branch → the commit it was created from or last reset to. */
  branchBase = new Map<string, string>();
  requests: Req[] = [];
  resets: string[] = [];
  /** Run (once) when a pull request is about to be opened. */
  beforePulls: (() => Promise<void>) | null = null;
  /** Run (once) right after a file is read at a commit sha (the approval's check). */
  afterCheckedRead: (() => void) | null = null;
  refDeletes: 'ok' | 'error' | '422' = 'ok';
  /** Overrides the URL POST /pulls answers with. */
  prUrl: string | null = null;
  /** What POST /pulls answers. */
  pulls: 'ok' | 'no-commits' | 'error' = 'ok';
  /** What PATCH /pulls/{n} (closing one) does: close it; refuse; refuse
   * because someone closed it meanwhile; refuse because it merged
   * meanwhile; or close it just after it merged. */
  closePulls: 'ok' | 'error' | 'error-closed' | 'error-merged' | 'merged-meanwhile' = 'ok';
  /** Check runs every head has (the shepherd reads them). */
  checkRuns: { id: number; name: string; status: string; conclusion: string | null }[] = [];
  /** What DELETE /git/refs/heads/* answers when the branch exists: 'ok', a 500, or a 422. */

  files(ref: string): Map<string, string> | undefined {
    return ref === 'main' ? this.main : this.commits.get(ref) ?? this.branches.get(ref);
  }

  head(): string {
    const tree = [...this.main.entries()].sort(([a], [b]) => a.localeCompare(b));
    const sha = createHash('sha1').update(JSON.stringify(tree)).digest('hex');
    if (!this.commits.has(sha)) this.commits.set(sha, new Map(this.main));
    return sha;
  }

  /** A pull request as the list endpoint returns it. */
  listed(pr: FakeGitHub['prs'][number]) {
    return { html_url: `https://github.com/RSG-Turkiye/website/pull/${pr.number}`, number: pr.number, state: pr.state, merged_at: pr.merged ? '2026-10-24T00:00:00Z' : null };
  }

  handle(method: string, url: URL, body: any): Response {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    const p = url.pathname.replace('/repos/RSG-Turkiye/website', '');
    if (method === 'GET' && p === '/git/ref/heads/main') return json({ object: { sha: this.head() } });
    if (method === 'POST' && p === '/git/refs') {
      const name = body.ref.replace('refs/heads/', '');
      if (this.branches.has(name)) return json({ message: 'Reference already exists' }, 422);
      this.branches.set(name, new Map(this.commits.get(body.sha) ?? this.main));
      this.branchBase.set(name, body.sha);
      return json({}, 201);
    }
    if (method === 'PATCH' && p.startsWith('/git/refs/heads/')) {
      const name = p.slice('/git/refs/heads/'.length);
      if (!this.branches.has(name) || !body.force || !this.commits.has(body.sha)) return json({ message: 'nope' }, 422);
      this.branches.set(name, new Map(this.commits.get(body.sha)));
      this.branchBase.set(name, body.sha);
      this.resets.push(name);
      return json({});
    }
    if (method === 'DELETE' && p.startsWith('/git/refs/heads/')) {
      const name = p.slice('/git/refs/heads/'.length);
      if (this.refDeletes === 'error') return json({ message: 'secret' }, 500);
      if (this.refDeletes === '422') return json({ message: 'Validation failed' }, 422);
      if (!this.branches.delete(name)) return json({ message: 'Reference does not exist' }, 422);
      for (const pr of this.prs) if (pr.head === name && pr.state === 'open' && !pr.merged) pr.state = 'closed';
      return new Response(null, { status: 204 });
    }
    if (p.startsWith('/contents/')) {
      const path = decodeURIComponent(p.slice('/contents/'.length));
      if (method === 'GET') {
        const ref = url.searchParams.get('ref') ?? 'main';
        const content = this.files(ref)?.get(path);
        if (/^[0-9a-f]{40}$/.test(ref) && this.afterCheckedRead) {
          const hook = this.afterCheckedRead;
          this.afterCheckedRead = null;
          hook();
        }
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
      if (this.prs.some((x) => x.head === body.head && x.state === 'open')) {
        return json({ message: 'Validation Failed', errors: [{ message: `A pull request already exists for RSG-Turkiye:${body.head}.` }] }, 422);
      }
      const number = this.prs.length + 41;
      this.prs.push({ title: body.title, body: body.body, head: body.head, number, state: 'open', merged: false });
      return json({ html_url: this.prUrl ?? `https://github.com/RSG-Turkiye/website/pull/${number}` }, 201);
    }
    if (/^\/pulls\/\d+$/.test(p)) {
      const pr = this.prs.find((x) => x.number === Number(p.slice('/pulls/'.length)));
      if (!pr) return json({ message: 'Not Found' }, 404);
      if (method === 'GET') {
        return json({ state: pr.state, merged: pr.merged, mergeable_state: 'clean', title: pr.title, head: { sha: `sha-${pr.number}` } });
      }
      if (method === 'PATCH') {
        const mode = this.closePulls;
        if (mode === 'error') return json({ message: 'secret-detail-from-github' }, 500);
        if (mode === 'error-closed' || mode === 'error-merged') {
          pr.state = 'closed';
          pr.merged = mode === 'error-merged';
          return json({ message: 'secret-detail-from-github' }, 422);
        }
        if (mode === 'merged-meanwhile') pr.merged = true;
        pr.state = 'closed';
        return json({ state: pr.state });
      }
    }
    if (method === 'GET' && /^\/commits\/[^/]+\/check-runs$/.test(p)) return json({ check_runs: this.checkRuns });
    if (method === 'GET' && p === '/pulls') {
      const head = (url.searchParams.get('head') ?? '').replace('RSG-Turkiye:', '');
      const state = url.searchParams.get('state') ?? 'open';
      const found = this.prs.filter((x) => x.head === head && (state === 'all' || x.state === state)).reverse();
      return json(found.map((x) => this.listed(x)));
    }
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
  if (method === 'POST' && url.pathname.endsWith('/pulls') && gh.beforePulls) {
    const hook = gh.beforePulls;
    gh.beforePulls = null;
    await hook();
  }
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

/** The shas an editor's copy came from, as GET /api/cms/entry gives them. */
const loaded = (...paths: string[]) =>
  Object.fromEntries(paths.map((p) => [p, gh.main.has(p) ? blobSha(gh.main.get(p)!) : null]));

const req = (env: Env, handler: unknown, method: string, path: string, as?: string, body?: unknown, params?: Record<string, string>) =>
  call(handler, method, path, { env, as, body, params, headers: ORIGIN });

async function create(env: Env, as: string, body: unknown) {
  const res = await req(env, drafts.onRequestPost, 'POST', '/api/cms/drafts', as, body);
  return { res, body: await res.json() as any };
}
const on = (env: Env, h: unknown, method: string, id: string, as: string, body?: unknown, suffix = '') =>
  req(env, h, method, `/api/cms/drafts/${id}${suffix}`, as, body, { id });

const anEvent = () => JSON.parse(FILES[EVENT_PATH]);
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
  // One entry per English file (tests/webinar-translation-parity.test.ts
  // keeps every webinar in both languages), each with both sides.
  assert.equal(INDEX.webinars.length, Object.keys(FILES).filter((p) => /^src\/content\/webinars\/en\/[^/]+\.md$/.test(p)).length);
  for (const w of INDEX.webinars) assert.ok(w.paths?.en && w.paths?.tr, w.id);
  // A pair whose files have different names is tied by the key both declare.
  const name = (p: string) => p.replace(/^.*\//, '');
  const keyOf = (p: string) => /^translationKey:\s*"?([^"\n]*)"?/m.exec(FILES[p])?.[1].trim() ?? '';
  const renamed = INDEX.webinars.filter((w) => name(w.paths!.en!) !== name(w.paths!.tr!));
  assert.ok(renamed.some((w) => w.id === PAIR_ID));
  for (const w of renamed) {
    assert.ok(keyOf(w.paths!.en!), `${w.id}: different names and no translationKey`);
    assert.equal(keyOf(w.paths!.tr!), keyOf(w.paths!.en!), w.id);
  }
  assert.ok(INDEX.events.some((e) => e.id === EVENT_ID && e.title === anEvent().title.en));
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
  const res = await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=webinars&id=${PAIR_ID}`, 'editor');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  const tr = PAIR_TR;
  assert.equal(body.base_shas[tr], blobSha(FILES[tr]));
  assert.deepEqual(body.data.tr.frontmatter, parseMarkdown(WEBINARS, FILES[tr]).frontmatter);
  assert.equal(body.data.tr.source, parseMarkdown(WEBINARS, FILES[tr]).source);

  const ev = await (await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=events&id=${EVENT_ID}`, 'editor')).json() as any;
  assert.deepEqual(ev.data, anEvent());
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
  assert.ok(pr.body.includes(`https://rsg-turkiye.iscbsc.org/admin#icerik/taslaklar/${id}`));
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
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note: 'x' }, base_shas: loaded(EVENT_PATH) });
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
    [entry.onRequestGet, 'GET', `/api/cms/entry?type=events&id=${EVENT_ID}`],
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
  const path = EVENT_PATH;
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note: 'draft' }, base_shas: loaded(path) });
  assert.equal(body.draft.base_shas[path], blobSha(FILES[path]));
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');

  gh.main.set(path, `${FILES[path]}\n`);
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
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'create', data: anEvent() });
  assert.equal(res.status, 409);
  assert.equal(body.code, 'exists');
});

test('a draft started from a stale read is refused at once', async () => {
  const { env } = setup();
  const path = EVENT_PATH;
  const { res, body } = await create(env, 'editor', {
    type: 'events', action: 'update', entry_id: EVENT_ID, data: anEvent(), base_shas: { [path]: 'b'.repeat(40) },
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
  const en = PAIR_EN;
  const tr = PAIR_TR;
  const current = await (await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=webinars&id=${PAIR_ID}`, 'editor')).json() as any;
  // The client sends back what it read, minus `source`: the server keeps its own.
  const data = {
    en: { frontmatter: { ...current.data.en.frontmatter, title: `${current.data.en.frontmatter.title} (edited)` }, body: current.data.en.body },
    tr: { frontmatter: current.data.tr.frontmatter, body: current.data.tr.body },
  };
  const { res, body } = await create(env, 'editor', { type: 'webinars', action: 'update', entry_id: PAIR_ID, data, base_shas: current.base_shas });
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
  const fm = parseMarkdown(WEBINARS, FILES[PAIR_EN]).frontmatter;
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
  // A save is lenient about what is missing, never about what is wrong.
  const bad = { ...newEvent(), start: 'next spring', title: { en: 'Only English', tr: 5 }, colour: 'red' };
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

test('an em dash, or a spaced double hyphen, is refused at submit in any text of any type, and saved meanwhile', async () => {
  const { env, row } = setup();
  const EM = '\u2014';
  // An event: a nested text.
  const ev = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), when: { en: '6 March 2027', tr: `6 Mart 2027 ${EM} akşam` } } });
  assert.equal(ev.res.status, 201, 'a save keeps work in progress');
  let res = await on(env, submit.onRequestPost, 'POST', ev.body.draft.id, 'editor', {}, '/submit');
  assert.equal(res.status, 422);
  let out = await res.json() as any;
  assert.match(out.errors['when.tr'], /em dash/i);
  assert.equal(row(ev.body.draft.id).status, 'draft');
  // A link label inside a list.
  const links = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-izmir-2027', links: [{ label: { en: `A ${EM} B`, tr: 'A' }, url: 'https://example.org' }] } });
  out = await (await on(env, submit.onRequestPost, 'POST', links.body.draft.id, 'editor', {}, '/submit')).json() as any;
  assert.match(out.errors['links.0.label.en'], /em dash/i);
  // A webinar: frontmatter and body, each on its side; ` -- ` reads as a dash too.
  const side = (title: string, body: string) => ({ frontmatter: { title, date: '2027-01-05', speaker: 'Ada Örnek', description: 'A talk.', year: 2027, type: 'student' }, body });
  const w = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('A talk -- with a dash', 'Fine.'), tr: side('Bir konuşma', `Metin ${EM} burada.`) } });
  assert.equal(w.res.status, 201);
  res = await on(env, submit.onRequestPost, 'POST', w.body.draft.id, 'editor', {}, '/submit');
  assert.equal(res.status, 422);
  out = await res.json() as any;
  assert.match(out.errors['en.frontmatter.title'], /em dash/i);
  assert.match(out.errors['tr.body'], /em dash/i);
  // The en dash is allowed (date ranges), and so is `--` in code.
  const ok = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Ranges 1\u20132', 'Run `nextflow run -- x` or\n\n```\na -- b\n```\n'), tr: side('Aralık 1\u20132', 'Tamam.') } });
  assert.equal((await on(env, submit.onRequestPost, 'POST', ok.body.draft.id, 'editor', {}, '/submit')).status, 200);
});

test('an update cannot rename the file', async () => {
  const { env } = setup();
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), id: `${EVENT_ID}b` }, base_shas: loaded(EVENT_PATH) });
  assert.equal(res.status, 422);
  assert.ok(body.errors.id);
});

// ── delete ────────────────────────────────────────────────────────────────────

test('a delete draft produces null files and deletes them on the branch', async () => {
  const { env } = setup();
  const { res, body } = await create(env, 'editor', { type: 'events', action: 'delete', entry_id: OTHER_EVENT_ID, base_shas: loaded(OTHER_EVENT_PATH) });
  assert.equal(res.status, 201);
  const files = filesFor({ ...body.draft, data: JSON.stringify(body.draft.data), base_shas: JSON.stringify(body.draft.base_shas) });
  assert.deepEqual(files, [{ path: OTHER_EVENT_PATH, content: null }]);

  const pair = await create(env, 'editor', { type: 'webinars', action: 'delete', entry_id: PAIR_ID, base_shas: loaded(PAIR_EN, PAIR_TR) });
  const pairFiles = filesFor({ ...pair.body.draft, data: JSON.stringify(pair.body.draft.data), base_shas: JSON.stringify(pair.body.draft.base_shas) });
  assert.deepEqual(pairFiles.map((f) => f.content), [null, null]);
  assert.deepEqual(pairFiles.map((f) => f.path).sort(), [PAIR_EN, PAIR_TR]);

  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  assert.deepEqual(gh.writes(), [{ method: 'DELETE', path: OTHER_EVENT_PATH }]);
  assert.equal(gh.prs[0].title, `CMS: delete events ${OTHER_EVENT_ID}`);
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

test('content already on main: the draft is merged (the shepherd publishes it), logged as a merge with noop', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: anEvent(), base_shas: loaded(EVENT_PATH) });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');
  gh.pulls = 'no-commits';
  const res = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  assert.equal(row(body.draft.id).status, 'merged');
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
  const path = EVENT_PATH;
  const files = filesFor({ type: 'events', entry_id: EVENT_ID, action: 'update', data: JSON.stringify(parseJson(EVENTS, FILES[path])), base_shas: JSON.stringify({ [path]: blobSha(FILES[path]) }) });
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

// ── fix round 1: races, required shas, branch reset, pair edges ───────────────

/** env whose first `n` draft reads all wait until every one of them has read:
 * n requests that act on the same row as it was before any of them wrote. */
function racing(env: Env, n: number): Env {
  const db = (env as any).DB;
  let reads = 0;
  let waiting: (() => void)[] = [];
  const DB = {
    ...db,
    prepare(sql: string) {
      const st = db.prepare(sql);
      if (!sql.startsWith('SELECT * FROM content_drafts WHERE id = ?')) return st;
      return {
        ...st,
        bind(...a: unknown[]) {
          const b = st.bind(...a);
          return {
            ...b,
            async first() {
              const row = await b.first();
              if (++reads <= n) {
                await new Promise<void>((resolve) => {
                  waiting.push(resolve);
                  if (waiting.length === n) { waiting.forEach((f) => f()); waiting = []; }
                });
              }
              return row;
            },
          };
        },
      };
    },
  };
  return { ...(env as any), DB } as never;
}

test('two submits of the same row at once: one lands, one log row', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  const r = racing(env, 2);
  const results = await Promise.all([1, 2].map(() => on(r, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')));
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  assert.equal(row(id).status, 'submitted');
  assert.equal(audit().filter((a) => a.action === 'cms.draft.submit').length, 1);
});

test('two approvals of the same row at once: one claim, one log row, one pull request', async () => {
  const { env, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  const r = racing(env, 2);
  const results = await Promise.all(['approver', 'admin'].map((as) => on(r, approve.onRequestPost, 'POST', id, as, {}, '/approve')));
  assert.deepEqual(results.map((x) => x.status).sort(), [200, 409]);
  assert.equal(audit().filter((a) => a.action === 'cms.draft.approve').length, 1);
  assert.equal(audit().filter((a) => a.action === 'cms.pr.open').length, 1);
  assert.equal(gh.prs.length, 1);
  assert.equal(row(id).status, 'pr_open');
});

test('a slow approval overtaken by a retry writes no outcome and answers superseded', async () => {
  const { env, db, audit, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  // Attempt A has claimed the draft and is talking to GitHub. It takes long
  // enough to look crashed, so attempt B re-claims and finishes first.
  let b: Response | null = null;
  gh.beforePulls = async () => {
    db.prepare('UPDATE content_drafts SET updated_at = updated_at - 400 WHERE id = ?').run(id);
    b = await on(env, approve.onRequestPost, 'POST', id, 'admin', {}, '/approve');
  };
  const a = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(b!.status, 200);
  assert.equal(a.status, 409);
  assert.equal((await a.json() as any).code, 'superseded');
  const after = row(id);
  assert.equal(after.status, 'pr_open');
  assert.equal(after.reviewer_id, 'admin');
  assert.equal(after.pr_url, 'https://github.com/RSG-Turkiye/website/pull/41', 'B\'s pull request, not overwritten by A');
  assert.equal(audit().filter((x) => x.action === 'cms.pr.open').length, 1);
  assert.equal(audit().filter((x) => x.action === 'cms.draft.approve').length, 2);
});

test('an update or delete without the shas the editor loaded is refused', async () => {
  const { env } = setup();
  for (const action of ['update', 'delete']) {
    const { res, body } = await create(env, 'editor', { type: 'events', action, entry_id: EVENT_ID, data: anEvent() });
    assert.equal(res.status, 400, action);
    assert.equal(body.code, 'base_shas_required');
  }
  assert.equal(gh.requests.length, 0, 'refused before asking GitHub');
});

test('a retried draft renamed after a failure commits only its current files', async () => {
  const { env, row } = setup();
  const { body } = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = body.draft.id;
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  gh.pulls = 'error';
  const realError = console.error;
  console.error = () => {};
  try {
    assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 502);
  } finally {
    console.error = realError;
  }
  const branch = `cms/${id}`;
  assert.ok(gh.branches.get(branch)!.has('src/content/events/meetup-ankara-2027.json'), 'the failed attempt left its file');

  gh.pulls = 'ok';
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), id: 'meetup-ankara-2028' } })).status, 200);
  await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(id).status, 'pr_open');
  assert.deepEqual(gh.resets, [branch]);
  const files = gh.branches.get(branch)!;
  assert.ok(files.has('src/content/events/meetup-ankara-2028.json'));
  assert.ok(!files.has('src/content/events/meetup-ankara-2027.json'), 'no orphan from the earlier attempt');
});

test('a webinar delete covers both sides even when one is missing on main, and rechecks it', async () => {
  const { env } = setup();
  const en = PAIR_EN;
  const tr = PAIR_TR;
  gh.main.delete(tr);
  const { res, body } = await create(env, 'editor', { type: 'webinars', action: 'delete', entry_id: PAIR_ID, base_shas: loaded(en, tr) });
  assert.equal(res.status, 201);
  assert.deepEqual(body.draft.base_shas, { [en]: blobSha(FILES[en]), [tr]: null });
  await on(env, submit.onRequestPost, 'POST', body.draft.id, 'editor', {}, '/submit');

  gh.main.set(tr, FILES[tr]);
  const refused = await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve');
  assert.equal(refused.status, 409);
  assert.deepEqual((await refused.json() as any).paths, [tr]);

  gh.main.delete(tr);
  assert.equal((await on(env, approve.onRequestPost, 'POST', body.draft.id, 'approver', {}, '/approve')).status, 200);
  assert.deepEqual(gh.writes(), [{ method: 'DELETE', path: en }]);
});

test('a new webinar may not reuse a published pair\'s translationKey or file name', async () => {
  const { env } = setup();
  const side = (title: string, key = '') => ({
    frontmatter: { title, translationKey: key, date: '2027-01-15', speaker: 'S', description: 'd', year: 2027, type: 'bioinfonet' },
    body: '\n',
  });
  const byKey = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Fresh Talk', PAIR_KEY), tr: side('Yeni', PAIR_KEY) } });
  assert.equal(byKey.res.status, 409);
  assert.equal(byKey.body.code, 'exists');
  const byName = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side(PAIR_TR_TITLE), tr: side(PAIR_TR_TITLE) } });
  assert.equal(byName.res.status, 409);
  assert.equal(byName.body.code, 'exists');
  const fine = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Fresh Talk'), tr: side('Yeni') } });
  assert.equal(fine.res.status, 201);
});

// ── fix round 2 ───────────────────────────────────────────────────────────────

const quiet = async <T>(run: () => Promise<T>): Promise<T> => {
  const realError = console.error;
  console.error = () => {};
  try {
    return await run();
  } finally {
    console.error = realError;
  }
};

async function submitted(env: Env, as = 'editor', body: unknown = { type: 'events', action: 'create', data: newEvent() }) {
  const made = await create(env, as, body);
  assert.equal(made.res.status, 201, JSON.stringify(made.body));
  assert.equal((await on(env, submit.onRequestPost, 'POST', made.body.draft.id, as, {}, '/submit')).status, 200);
  return made.body.draft.id as string;
}

test('the branch starts from the commit the shas were checked at, not from a main that moved since', async () => {
  const { env, row } = setup();
  const path = EVENT_PATH;
  const id = await submitted(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note: 'draft' }, base_shas: loaded(path) });
  const checked = gh.head();
  // A hand edit merges right after the approval checked the file.
  // Any byte change will do; the test must not depend on what the file says,
  // since the panel edits it.
  gh.afterCheckedRead = () => gh.main.set(path, `${FILES[path]}\n`);
  const from = gh.requests.length;
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(id).status, 'pr_open');
  assert.notEqual(gh.head(), checked, 'main did move');
  assert.equal(gh.branchBase.get(`cms/${id}`), checked, 'branched from the checked commit');
  assert.ok(!gh.requests.slice(from).some((r) => r.path.includes('/contents/') && r.path.endsWith('ref=main')), 'the approval reads no file against a moving main');
});

test('a stale approval adopts its own merged pull request: merged, recovered, no changed_since', async () => {
  const { env, db, audit, row } = setup();
  const path = EVENT_PATH;
  const data = { ...anEvent(), note: 'draft' };
  const id = await submitted(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data, base_shas: loaded(path) });
  db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = updated_at - 400 WHERE id = ?`).run(id);
  gh.prs.push({ title: 't', body: 'b', head: `cms/${id}`, number: 77, state: 'closed', merged: true });
  gh.main.set(path, serializeJson(EVENTS, data)); // its own merge moved the file
  const res = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  const after = row(id);
  assert.equal(after.status, 'merged');
  assert.equal(after.pr_number, 77);
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.pr.merged');
  assert.equal(JSON.parse(last.details).recovered, true);
  assert.deepEqual(gh.resets, []);
  assert.deepEqual(gh.writes(), []);
});

test('a stale approval adopts its own open pull request without touching the branch', async () => {
  const { env, db, audit, row } = setup();
  const id = await submitted(env);
  db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = updated_at - 400 WHERE id = ?`).run(id);
  gh.branches.set(`cms/${id}`, new Map(gh.main));
  gh.prs.push({ title: 't', body: 'b', head: `cms/${id}`, number: 78, state: 'open', merged: false });
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(id).status, 'pr_open');
  assert.equal(row(id).pr_number, 78);
  assert.equal(JSON.parse(audit().at(-1)!.details).recovered, true);
  assert.deepEqual(gh.resets, []);
  assert.deepEqual(gh.writes(), []);
  assert.equal(gh.prs.length, 1);
});

test('a stale approval whose pull request was closed (or never opened) runs the normal path', async () => {
  for (const earlier of ['closed', 'none'] as const) {
    const { env, db, row } = setup();
    const id = await submitted(env);
    db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = updated_at - 400 WHERE id = ?`).run(id);
    if (earlier === 'closed') gh.prs.push({ title: 't', body: 'b', head: `cms/${id}`, number: 79, state: 'closed', merged: false });
    assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200, earlier);
    assert.equal(row(id).status, 'pr_open');
    assert.notEqual(row(id).pr_number, 79, earlier);
    assert.ok(gh.branches.get(`cms/${id}`)!.has('src/content/events/meetup-ankara-2027.json'));
  }
});

test('constructor, toString and __proto__ are unknown fields, at the top and nested', async () => {
  const { env, db } = setup();
  for (const k of ['constructor', 'toString', '__proto__']) {
    const top = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), [k]: 'x' } });
    assert.equal(top.res.status, 422, k);
    assert.ok(Object.hasOwn(top.body.errors, k), `${k}: ${JSON.stringify(top.body.errors)}`);
    const nested = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), title: { en: 'A', tr: 'B', [k]: 'x' } } });
    assert.equal(nested.res.status, 422, k);
    assert.ok(Object.hasOwn(nested.body.errors, `title.${k}`), `${k}: ${JSON.stringify(nested.body.errors)}`);
    const fm = { title: 'T', date: '2027-01-15', speaker: 'S', description: 'd', year: 2027, type: 'bioinfonet', [k]: 'x' };
    const pair = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: { frontmatter: fm, body: '' }, tr: { frontmatter: fm, body: '' } } });
    assert.equal(pair.res.status, 422, k);
    assert.ok(Object.hasOwn(pair.body.errors, `en.frontmatter.${k}`), `${k}: ${JSON.stringify(pair.body.errors)}`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_drafts').get() as { n: number }).n, 0, 'nothing stored');
});

test('a translationKey of another published pair is refused on update, at submit and at approval', async () => {
  const { env, db } = setup();
  const en = PAIR_EN;
  const tr = PAIR_TR;
  const current = await (await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=webinars&id=${PAIR_ID}`, 'editor')).json() as any;
  const withKey = (key: string) => ({
    en: { frontmatter: { ...current.data.en.frontmatter, translationKey: key }, body: current.data.en.body },
    tr: { frontmatter: { ...current.data.tr.frontmatter, translationKey: key }, body: current.data.tr.body },
  });
  const upd = await create(env, 'editor', { type: 'webinars', action: 'update', entry_id: PAIR_ID, data: withKey(OTHER_KEY), base_shas: loaded(en, tr) });
  assert.equal(upd.res.status, 409);
  assert.equal(upd.body.code, 'exists');

  // Its own key is fine; a save may then change it, and submit refuses.
  const ok = await create(env, 'editor', { type: 'webinars', action: 'update', entry_id: PAIR_ID, data: withKey(PAIR_KEY), base_shas: loaded(en, tr) });
  assert.equal(ok.res.status, 201);
  const id = ok.body.draft.id;
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: withKey(OTHER_KEY) })).status, 200);
  const sub = await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  assert.equal(sub.status, 409);
  assert.equal((await sub.json() as any).code, 'exists');

  // A row that reached the queue with a clashing key is refused at approval.
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: withKey(PAIR_KEY) })).status, 200);
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')).status, 200);
  const stored = JSON.parse((db.prepare('SELECT data FROM content_drafts WHERE id = ?').get(id) as { data: string }).data);
  stored.tr.frontmatter.translationKey = OTHER_KEY;
  stored.en.frontmatter.translationKey = OTHER_KEY;
  db.prepare('UPDATE content_drafts SET data = ? WHERE id = ?').run(JSON.stringify(stored), id);
  const app = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(app.status, 409);
  assert.equal((await app.json() as any).code, 'exists');
  assert.equal(gh.prs.length, 0);
});

test('a pull request URL without a number settles pr_failed, never pr_open', async () => {
  const { env, row, audit } = setup();
  const id = await submitted(env);
  gh.prUrl = 'https://github.com/someone-else/website/pull/5';
  const res = await quiet(() => on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve'));
  assert.equal(res.status, 502);
  assert.equal(row(id).status, 'pr_failed');
  assert.equal(row(id).failure, 'github_failed');
  assert.equal(row(id).pr_number, null);
  assert.equal(audit().at(-1)!.action, 'cms.pr.failed');
});

test('discarding a failed draft deletes its branch, best effort', async () => {
  for (const outcome of ['ok', 'error'] as const) {
    const { env, audit, row } = setup();
    const id = await submitted(env);
    gh.pulls = 'error';
    await quiet(() => on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve'));
    assert.equal(row(id).status, 'pr_failed');
    assert.ok(gh.branches.has(`cms/${id}`));
    gh.refDeletes = outcome;
    const res = await quiet(() => on(env, draft.onRequestDelete, 'DELETE', id, 'editor'));
    assert.equal(res.status, 200, outcome);
    assert.equal(row(id).status, 'discarded');
    assert.equal((await res.json() as any).branch, outcome === 'ok' ? 'deleted' : 'failed');
    assert.equal(audit().at(-1)!.action, 'cms.draft.discard');
    assert.equal(audit().filter((a) => a.action === 'cms.draft.discard').length, 1, 'one row per state change');
    assert.equal(gh.branches.has(`cms/${id}`), outcome !== 'ok');
  }
});

test('the approval queue is newest first and says when it is capped', async () => {
  const { env, db } = setup();
  const insert = db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, created_at, updated_at)
    VALUES (?, 'events', ?, 'create', '{}', '{}', 'submitted', 'editor', 1, ?)`);
  for (let i = 0; i < 201; i++) insert.run(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `e-${i}`, 1000 + i);
  const body = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'approver')).json() as any;
  assert.equal(body.queue.length, 200);
  assert.equal(body.more, true);
  assert.equal(body.queue[0].entry_id, 'e-200');
  assert.equal(body.queue[199].entry_id, 'e-1');
});

// ── fix round 3 ───────────────────────────────────────────────────────────────

/** env that runs `between` once, right after the first draft read: another
 * request changing the row while this one decides. */
function afterFirstRead(env: Env, between: () => void): Env {
  const db = (env as any).DB;
  let done = false;
  const DB = {
    ...db,
    prepare(sql: string) {
      const st = db.prepare(sql);
      if (!sql.startsWith('SELECT * FROM content_drafts WHERE id = ?')) return st;
      return { ...st, bind(...a: unknown[]) {
        const b = st.bind(...a);
        return { ...b, async first() { const row = await b.first(); if (!done) { done = true; between(); } return row; } };
      } };
    },
  };
  return { ...(env as any), DB } as never;
}

test('a discard that loses its race deletes no branch', async () => {
  const { env, db, row, audit } = setup();
  const id = await submitted(env);
  gh.pulls = 'error';
  await quiet(() => on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve'));
  assert.equal(row(id).status, 'pr_failed');
  // While the discard decides, the author resubmits and an approver approves:
  // cms/<id> is now a live pull request's branch.
  const raced = afterFirstRead(env, () => {
    db.prepare(`UPDATE content_drafts SET status = 'pr_open', write_nonce = 'someone-else' WHERE id = ?`).run(id);
  });
  const res = await on(raced, draft.onRequestDelete, 'DELETE', id, 'editor');
  assert.equal(res.status, 409);
  assert.ok(gh.branches.has(`cms/${id}`), 'the branch is untouched');
  assert.ok(!gh.requests.some((r) => r.method === 'DELETE' && r.path.includes('/git/refs/')));
  assert.equal(row(id).status, 'pr_open');
  assert.equal(audit().filter((a) => a.action === 'cms.draft.discard').length, 0);
});

test('an unknown key inside an array element is refused and nothing is stored', async () => {
  const { env, db } = setup();
  for (const k of ['constructor', '__proto__', 'colour']) {
    const link = { label: { en: 'Materials', tr: 'Materyaller' }, url: 'https://github.com/RSG-Turkiye/x', [k]: 'x' };
    const { res, body } = await create(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), links: [link] } });
    assert.equal(res.status, 422, k);
    assert.ok(Object.hasOwn(body.errors, `links.0.${k}`), `${k}: ${JSON.stringify(body.errors)}`);
  }
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_drafts').get() as { n: number }).n, 0);
});

// ── cancel: leaving pr_open on purpose ───────────────────────────────────────

test('cancel: an approver closes the pull request; the draft is pr_failed "cancelled", logged', async () => {
  const { env, row, audit } = setup();
  const id = await submitted(env);
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  assert.equal(row(id).status, 'pr_open');

  // Not the author's to cancel, and not from any other status.
  assert.equal((await on(env, cancel.onRequestPost, 'POST', id, 'editor', {}, '/cancel')).status, 403);
  const other = await submitted(env, 'editor', { type: 'events', action: 'create', data: { ...newEvent(), id: 'meetup-izmir-2027' } });
  const refused = await on(env, cancel.onRequestPost, 'POST', other, 'approver', {}, '/cancel');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json() as any).code, 'bad_state');

  const res = await on(env, cancel.onRequestPost, 'POST', id, 'approver', {}, '/cancel');
  assert.equal(res.status, 200);
  const body = await res.json() as any;
  assert.equal(body.draft.status, 'pr_failed');
  assert.equal(body.draft.failure, 'cancelled');
  assert.equal(row(id).status, 'pr_failed');
  assert.equal(row(id).failure, 'cancelled');
  assert.equal(gh.prs[0].state, 'closed');
  assert.deepEqual(gh.requests.filter((r) => r.method === 'PATCH' && r.path.endsWith(`/pulls/${row(id).pr_number}`)).map((r) => r.body), [{ state: 'closed' }]);
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.pr.cancel');
  assert.equal(last.target_id, id);
  assert.equal(JSON.parse(last.details).pr_number, row(id).pr_number);

  // pr_failed can be sent again (it goes through openContentPR with resetBranch).
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')).status, 200);
});

test('cancel: GitHub refusing to close it changes nothing and logs nothing', async () => {
  const { env, row, audit } = setup();
  const id = await submitted(env);
  await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  const logged = audit().length;
  gh.closePulls = 'error';
  const res = await on(env, cancel.onRequestPost, 'POST', id, 'admin', {}, '/cancel');
  assert.equal(res.status, 502);
  assert.ok(!(await res.text()).includes('secret-detail'));
  assert.equal(row(id).status, 'pr_open');
  assert.equal(audit().length, logged);
});

// ── one live draft per entry ─────────────────────────────────────────────────

test('entry_busy: a second draft of an entry cannot be sent while another is in review or on its way', async () => {
  const { env, db, row } = setup();
  const path = EVENT_PATH;
  const body = (note: string) => ({ type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note }, base_shas: loaded(path) });
  const first = await submitted(env, 'editor', body('one'));
  const second = (await create(env, 'editor2', body('two'))).body.draft.id as string;

  for (const status of ['submitted', 'approved', 'pr_open', 'merged']) {
    db.prepare('UPDATE content_drafts SET status = ? WHERE id = ?').run(status, first);
    const res = await on(env, submit.onRequestPost, 'POST', second, 'editor2', {}, '/submit');
    assert.equal(res.status, 409, status);
    const answer = await res.json() as any;
    assert.equal(answer.code, 'entry_busy');
    assert.ok(!JSON.stringify(answer).includes(first), 'whose draft holds it is not said');
    assert.equal(row(second).status, 'draft');
  }
  // Once the first is finished (or failed), the second may go.
  for (const status of ['pr_failed', 'published']) {
    db.prepare('UPDATE content_drafts SET status = ? WHERE id = ?').run(status, first);
  }
  assert.equal((await on(env, submit.onRequestPost, 'POST', second, 'editor2', {}, '/submit')).status, 200);
  // Other entries are not held.
  assert.equal((await submitted(env, 'editor')) !== '', true);
});

test('entry_busy is part of the guarded write: a draft that becomes live meanwhile still blocks', async () => {
  const { env, db, row } = setup();
  const path = EVENT_PATH;
  const body = (note: string) => ({ type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note }, base_shas: loaded(path) });
  const first = (await create(env, 'editor', body('one'))).body.draft.id as string;
  const second = (await create(env, 'editor2', body('two'))).body.draft.id as string;
  // The first is sent between the second's busy check and its write.
  const real = (env as any).DB.prepare;
  (env as any).DB.prepare = (sql: string) => {
    if (sql.startsWith('UPDATE content_drafts SET status = \'submitted\'')) db.prepare("UPDATE content_drafts SET status = 'submitted' WHERE id = ?").run(first);
    return real(sql);
  };
  const res = await on(env, submit.onRequestPost, 'POST', second, 'editor2', {}, '/submit');
  (env as any).DB.prepare = real;
  assert.equal(res.status, 409);
  assert.equal((await res.json() as any).code, 'entry_busy');
  assert.equal(row(second).status, 'draft');
});

// ── fix round 1 ──────────────────────────────────────────────────────────────

async function prOpen(env: Env) {
  const id = await submitted(env);
  assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve')).status, 200);
  return id;
}

test('cancel: a pull request that merged already is recorded as merged, 409 already_merged, nothing closed', async () => {
  const { env, row, audit } = setup();
  const id = await prOpen(env);
  Object.assign(gh.prs[0], { state: 'closed', merged: true });
  const res = await on(env, cancel.onRequestPost, 'POST', id, 'approver', {}, '/cancel');
  assert.equal(res.status, 409);
  const body = await res.json() as any;
  assert.equal(body.code, 'already_merged');
  assert.equal(body.draft.status, 'merged');
  assert.equal(row(id).status, 'merged');
  assert.equal(audit().at(-1)!.action, 'cms.pr.merged');
  assert.equal(gh.requests.filter((r) => r.method === 'PATCH' && /\/pulls\/\d+$/.test(r.path)).length, 0);
});

test('cancel: a merge that lands while closing wins: merged, 409', async () => {
  for (const mode of ['merged-meanwhile', 'error-merged'] as const) {
    const { env, row } = setup();
    const id = await prOpen(env);
    gh.closePulls = mode;
    const res = await quiet(() => on(env, cancel.onRequestPost, 'POST', id, 'approver', {}, '/cancel'));
    assert.equal(res.status, 409, mode);
    assert.equal((await res.json() as any).code, 'already_merged');
    assert.equal(row(id).status, 'merged', mode);
  }
});

test('cancel: a refused close whose pull request is closed anyway goes ahead', async () => {
  const { env, row, audit } = setup();
  const id = await prOpen(env);
  gh.closePulls = 'error-closed';
  const res = await quiet(() => on(env, cancel.onRequestPost, 'POST', id, 'approver', {}, '/cancel'));
  assert.equal(res.status, 200);
  assert.equal(row(id).failure, 'cancelled');
  assert.equal(audit().at(-1)!.action, 'cms.pr.cancel');
});

test('a draft the shepherd failed has its pull request closed, and a retry opens a fresh one (the closed one is not adopted)', async () => {
  const { env, db, row } = setup();
  const id = await prOpen(env);
  assert.equal(row(id).pr_number, 41);
  gh.checkRuns = REQUIRED_CHECKS.map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'failure' }));
  assert.equal((await shepherd(env, Math.floor(Date.now() / 1000))).failed, 1);
  assert.equal(row(id).status, 'pr_failed');
  assert.equal(gh.prs[0].state, 'closed');
  assert.equal(gh.prs[0].merged, false);

  // A crashed retry (stale approved): the closed, unmerged pull request is not taken as merged.
  assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit')).status, 200);
  db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = updated_at - 400 WHERE id = ?`).run(id);
  const res = await on(env, approve.onRequestPost, 'POST', id, 'approver', {}, '/approve');
  assert.equal(res.status, 200);
  assert.equal(row(id).status, 'pr_open');
  assert.equal(row(id).pr_number, 42, 'a new pull request');
  assert.equal(gh.prs[1].state, 'open');
});

test('discard: a branch delete answered 422 is "failed", and the pull request on it is closed', async () => {
  const { env, db, row } = setup();
  const id = await prOpen(env);
  db.prepare(`UPDATE content_drafts SET status = 'pr_failed' WHERE id = ?`).run(id);
  gh.refDeletes = '422';
  const res = await quiet(() => on(env, draft.onRequestDelete, 'DELETE', id, 'editor'));
  assert.equal(res.status, 200);
  assert.equal((await res.json() as any).branch, 'failed');
  assert.equal(row(id).status, 'discarded');
  assert.equal(gh.prs[0].state, 'closed');
});

test('discard from merged: approvers only, no GitHub call, logged from merged', async () => {
  const { env, db, row, audit } = setup();
  const id = await prOpen(env);
  db.prepare(`UPDATE content_drafts SET status = 'merged' WHERE id = ?`).run(id);
  const before = gh.requests.length;
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', id, 'editor')).status, 403);
  assert.equal(row(id).status, 'merged');
  const res = await on(env, draft.onRequestDelete, 'DELETE', id, 'approver');
  assert.equal(res.status, 200);
  assert.equal(row(id).status, 'discarded');
  assert.equal(gh.requests.length, before);
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.draft.discard');
  assert.equal(JSON.parse(last.details).from, 'merged');
});

test('the approval queue holds drafts stuck in approved past the stale time, not fresh ones', async () => {
  const { env, db } = setup();
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, created_at, updated_at)
    VALUES (?, 'events', ?, 'create', '{}', '{}', 'approved', 'editor', 1, ?)`);
  insert.run('00000000-0000-4000-8000-000000000001', 'stuck', now - 600);
  insert.run('00000000-0000-4000-8000-000000000002', 'in-flight', now - 10);
  const body = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'approver')).json() as any;
  assert.deepEqual(body.queue.map((d: any) => d.entry_id), ['stuck']);
});

// ── Task 7: the panel's server side ───────────────────────────────────────────

test('every published entry still validates under the stricter schemas', () => {
  const WORKSHOPS = cmsType('workshops')!;
  for (const [path, text] of Object.entries(FILES)) {
    if (path.startsWith('src/content/events/')) assert.deepEqual(validateDraft(EVENTS, JSON.parse(text)), { ok: true, data: JSON.parse(text) }, path);
    if (path.startsWith('src/content/workshops/')) assert.equal(validateDraft(WORKSHOPS, JSON.parse(text)).ok, true, path);
  }
  for (const w of INDEX.webinars) {
    const side = (p: string | null | undefined) => p ? parseMarkdown(WEBINARS, FILES[p]) : null;
    const pair = { en: side(w.paths?.en), tr: side(w.paths?.tr) };
    const v = validateDraft(WEBINARS, pair);
    assert.equal(v.ok, true, `${w.id}: ${JSON.stringify(v.ok ? null : v.errors)}`);
  }
});

test('the required display texts may not be empty at submit', () => {
  const v = validateDraft(EVENTS, { ...newEvent(), when: { en: '6 March', tr: '' }, description: { en: '', tr: 'x' } });
  assert.equal(v.ok, false);
  assert.deepEqual(Object.keys((v as any).errors).sort(), ['description.en', 'when.tr']);
  const w = validateDraft(cmsType('workshops')!, { year: 2026, title: '', topics: '', repo: '' });
  assert.deepEqual(Object.keys((w as any).errors).sort(), ['repo', 'title', 'topics']);
});

test('lenient: missing or empty is allowed, unknown keys, wrong types and bad formats are not', () => {
  const partial = { id: 'meetup-x', title: { en: 'Meetup', tr: '' }, links: [{ label: { en: 'Site' }, url: '' }] };
  assert.deepEqual(validateDraft(EVENTS, partial, 'lenient'), { ok: true, data: partial });
  assert.equal(validateDraft(EVENTS, partial).ok, false, 'strict still refuses it');
  const wrong = validateDraft(EVENTS, { id: 'meetup-x', start: '6 March', title: { en: 5 }, colour: 'red', type: 'party' }, 'lenient') as any;
  assert.equal(wrong.ok, false);
  assert.deepEqual(Object.keys(wrong.errors).sort(), ['colour', 'start', 'title.en', 'type']);
  // Nested unknown keys too, and the webinar pair's shape.
  assert.equal(validateDraft(EVENTS, { links: [{ label: { en: '', de: 'x' } }] }, 'lenient').ok, false);
  assert.equal(validateDraft(WEBINARS, { en: { frontmatter: {}, body: '' }, tr: { frontmatter: {}, body: '' } }, 'lenient').ok, true);
  assert.equal(validateDraft(WEBINARS, { en: { frontmatter: { year: 'x' }, body: '' }, tr: { frontmatter: {}, body: '' } }, 'lenient').ok, false);
  assert.equal(validateDraft(WEBINARS, { en: { frontmatter: {}, body: '' } }, 'lenient').ok, false, 'both sides, always');
});

test('save and create are lenient; submit is strict, with an error per field', async () => {
  const { env, row } = setup();
  const start = { id: 'meetup-ankara-2027', title: { en: 'Ankara meetup', tr: '' } };
  const made = await create(env, 'editor', { type: 'events', action: 'create', data: start });
  assert.equal(made.res.status, 201, JSON.stringify(made.body));
  const id = made.body.draft.id;
  const more = { ...start, type: 'meetup', when: { en: '6 March 2027', tr: '' } };
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: more })).status, 200);
  assert.deepEqual(JSON.parse(row(id).data), more);
  // Still a wrong type is refused at save.
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...more, start: 20270306 } })).status, 422);
  const res = await on(env, submit.onRequestPost, 'POST', id, 'editor', {}, '/submit');
  assert.equal(res.status, 422);
  const errors = (await res.json() as any).errors;
  for (const k of ['start', 'title.tr', 'when.tr', 'location', 'description']) assert.ok(errors[k], k);
  assert.equal(row(id).status, 'draft');
  // A new entry still needs what its file name comes from.
  const nameless = await create(env, 'editor', { type: 'events', action: 'create', data: { title: { en: 'x', tr: '' } } });
  assert.equal(nameless.res.status, 422);
  assert.ok(nameless.body.errors.id);
});

test('a draft carries its author\'s display name, never an id or address in its place', async () => {
  const { env, db } = setup();
  const id = await submitted(env);
  const one = async (as: string) => (await (await on(env, draft.onRequestGet, 'GET', id, as)).json() as any).draft;
  assert.equal((await one('approver')).author_name, null, 'no profile: null, and the panel says "an editor"');
  db.prepare(`INSERT INTO profiles (user_id, username, display_name, updated_at) VALUES ('editor', 'ed', 'Ece Editör', 1)`).run();
  assert.equal((await one('approver')).author_name, 'Ece Editör');
  const lists = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'approver')).json() as any;
  assert.equal(lists.queue[0].author_name, 'Ece Editör');
  const mine = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor')).json() as any;
  assert.equal(mine.mine[0].author_name, 'Ece Editör');
});

test('the drafts list says which entries are held by a live draft, without saying whose', async () => {
  const { env } = setup();
  const path = EVENT_PATH;
  await submitted(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: anEvent(), base_shas: loaded(path) });
  const other = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor2')).json() as any;
  assert.deepEqual(other.mine, []);
  assert.deepEqual(other.live, [{ type: 'events', entry_id: EVENT_ID, status: 'submitted' }]);
  const none = await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'member');
  assert.equal(none.status, 403);
});

test('each index entry carries its date, for the panel\'s list', () => {
  for (const e of INDEX.events) assert.equal(e.date, JSON.parse(FILES[`src/content/events/${e.id}.json`]).start, e.id);
  assert.ok(INDEX.workshops.every((w) => /^\d{4}$/.test(w.date ?? '')));
  for (const w of INDEX.webinars) {
    const written = /^date:\s*"?(\d{4}-\d{2}-\d{2})/m.exec(FILES[w.paths!.en!])?.[1];
    assert.equal(w.date, written, w.id);
  }
});

// ── Task 7, fix round 1 ───────────────────────────────────────────────────────

test('a save names the version it was made on: a stale write_nonce is draft_changed, nothing stored', async () => {
  const { env, row } = setup();
  const made = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = made.body.draft.id;
  const seen = made.body.draft.write_nonce;
  assert.equal(typeof seen, 'string');
  const first = await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), note: 'tab 1' }, write_nonce: seen });
  assert.equal(first.status, 200);
  const after = (await first.json() as any).draft.write_nonce;
  assert.notEqual(after, seen);
  // Another tab still holding the first version.
  const stale = await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), note: 'tab 2' }, write_nonce: seen });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json() as any).code, 'draft_changed');
  assert.equal(JSON.parse(row(id).data).note, 'tab 1');
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), note: 'tab 1 again' }, write_nonce: after })).status, 200);
});

test('renaming a new entry onto a published one is refused on the field its name comes from', async () => {
  const { env, row } = setup();
  const made = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
  const id = made.body.draft.id;
  const res = await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...newEvent(), id: EVENT_ID } });
  assert.equal(res.status, 422);
  assert.match((await res.json() as any).errors.id, /already/);
  assert.equal(row(id).entry_id, 'meetup-ankara-2027');

  const side = (title: string) => ({ frontmatter: { title, date: '2027-01-15', speaker: 'S', description: 'd', year: 2027, type: 'bioinfonet' }, body: '\n' });
  const w = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Fresh Talk'), tr: side('Yeni') } });
  assert.equal(w.res.status, 201);
  const clash = await on(env, draft.onRequestPatch, 'PATCH', w.body.draft.id, 'editor', { data: { en: side('Molekuler Simulasyonlar'), tr: side('Yeni') } });
  assert.equal(clash.status, 422);
  assert.ok((await clash.json() as any).errors['en.frontmatter.title']);
});

test('the live list leaves out other people\'s new entries, keeps one\'s own', async () => {
  const { env } = setup();
  await submitted(env, 'editor');
  const other = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor2')).json() as any;
  assert.deepEqual(other.live, []);
  const own = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor')).json() as any;
  assert.deepEqual(own.live.map((l: any) => l.entry_id), ['meetup-ankara-2027']);
});

test('a webinar\'s year is its date\'s year', () => {
  const side = (year: number) => ({ frontmatter: { title: 't', date: '2027-01-15', speaker: 'S', description: 'd', year, type: 'bioinfonet' }, body: '' });
  assert.equal(validateDraft(WEBINARS, { en: side(2027), tr: side(2027) }).ok, true);
  const bad = validateDraft(WEBINARS, { en: side(2026), tr: side(2027) }) as any;
  assert.equal(bad.ok, false);
  assert.ok(bad.errors['en.frontmatter.year']);
});

test('a save of a new webinar that keeps its name and translationKey does not re-read the index', async () => {
  const { env } = setup();
  const side = (title: string, extra: Record<string, unknown> = {}) => ({ frontmatter: { title, date: '2027-01-15', speaker: 'S', description: 'd', year: 2027, type: 'bioinfonet', ...extra }, body: '\n' });
  const w = await create(env, 'editor', { type: 'webinars', action: 'create', data: { en: side('Fresh Talk'), tr: side('Yeni') } });
  assert.equal(w.res.status, 201);
  const assets = (env as any).ASSETS;
  const real = assets.fetch;
  let reads = 0;
  assets.fetch = async (r: Request) => { reads++; return real(r); };
  const id = w.body.draft.id;
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { en: side('Fresh Talk', { description: 'longer' }), tr: side('Yeni') } })).status, 200);
  assert.equal(reads, 0, 'same name, same translationKey: no clash to check');
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { en: side('Fresh Talk', { translationKey: 'k' }), tr: side('Yeni', { translationKey: 'k' }) } })).status, 200);
  assert.equal(reads, 1, 'a new translationKey is checked');
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { en: side('Fresher Talk', { translationKey: 'k' }), tr: side('Yeni', { translationKey: 'k' }) } })).status, 200);
  assert.equal(reads, 2, 'a new name is checked');
});

// ── final fix wave ────────────────────────────────────────────────────────────

test('an approval that never finished can be discarded by an approver, once stale; its pull request is closed', async () => {
  const { env, db, row, audit } = setup();
  const id = await submitted(env);
  db.prepare(`UPDATE content_drafts SET status = 'approved', updated_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000) - 10, id);
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', id, 'approver')).status, 409, 'not while an approval may still be running');
  db.prepare(`UPDATE content_drafts SET updated_at = ? WHERE id = ?`).run(Math.floor(Date.now() / 1000) - 600, id);
  assert.equal((await on(env, draft.onRequestDelete, 'DELETE', id, 'editor')).status, 403, 'the author cannot');
  // The crashed attempt got as far as a pull request.
  gh.prs.push({ title: 't', body: 'b', head: `cms/${id}`, number: 77, state: 'open', merged: false });
  gh.branches.set(`cms/${id}`, new Map(gh.main));
  const res = await on(env, draft.onRequestDelete, 'DELETE', id, 'approver');
  assert.equal(res.status, 200);
  assert.equal(row(id).status, 'discarded');
  assert.equal(gh.prs[0].state, 'closed', 'nobody can merge it by hand afterwards');
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.draft.discard');
  assert.equal(JSON.parse(last.details).from, 'approved');
});

test('approvers get the drafts that are on their way or stuck; editors do not', async () => {
  const { env, db } = setup();
  const now = Math.floor(Date.now() / 1000);
  const add = db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, created_at, updated_at)
    VALUES (?, 'events', ?, 'update', '{}', '{}', ?, 'editor', 1, ?)`);
  add.run('00000000-0000-4000-8000-000000000a01', 'a', 'pr_open', now - 60);
  add.run('00000000-0000-4000-8000-000000000a02', 'b', 'merged', now - 60);
  add.run('00000000-0000-4000-8000-000000000a03', 'c', 'pr_failed', now - 60);
  add.run('00000000-0000-4000-8000-000000000a04', 'd', 'approved', now - 600);
  add.run('00000000-0000-4000-8000-000000000a05', 'e', 'approved', now - 10);
  add.run('00000000-0000-4000-8000-000000000a06', 'f', 'published', now - 60);
  add.run('00000000-0000-4000-8000-000000000a07', 'g', 'draft', now - 60);
  const body = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'approver')).json() as any;
  assert.deepEqual(body.inflight.map((d: any) => d.entry_id).sort(), ['a', 'b', 'c', 'd']);
  const ed = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor2')).json() as any;
  assert.deepEqual(ed.inflight, []);
});

// ── plan 4: every content group, and the registry's options ──────────────────
//
// No real type of the new groups exists yet, so two test types stand in:
// a Yazılar type that behaves like any JSON type, and a Sayfalar type with
// every restriction (fixedKeys, noCreate, noDelete, approve: 'admin').

const TEST_POSTS = defineType({
  key: 'testposts' as CmsTypeKey,
  group: 'yazilar',
  dir: 'src/content/testposts',
  format: 'json',
  schema: z.object({ name: z.string().min(1), text: z.string().optional() }),
  idFrom: (d: { name: string }) => String(d.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
  idField: 'name',
  indexTitle: (d: { name: string }) => d.name,
  label: { en: 'Test posts', tr: 'Test yazıları' },
});
const TEST_PAGES = defineType({
  key: 'testpages' as CmsTypeKey,
  group: 'sayfalar',
  dir: 'src/content/testpages',
  format: 'json',
  schema: z.object({ a: z.string().optional(), b: z.string().optional(), c: z.string().optional() }),
  idFrom: () => { throw new Error('page texts take their id from the file'); },
  idField: 'a',
  indexTitle: () => 'Home',
  fixedKeys: true,
  noCreate: true,
  noDelete: true,
  approve: 'admin',
  label: { en: 'Test pages', tr: 'Test sayfaları' },
});
const HOME = 'src/content/testpages/home.json';
const HOME_TEXT = '{\n  "a": "one",\n  "b": "two"\n}\n';

/** setup(), the two test types registered, a page on main, and people in the new groups. */
function setupGroups() {
  setTestCmsTypes([TEST_POSTS, TEST_PAGES]);
  const s = setup();
  gh.main.set(HOME, HOME_TEXT);
  const add = s.db.prepare('INSERT INTO users (id, google_id, email, is_admin, is_member, created_at, last_login) VALUES (?, ?, ?, 0, 1, 1, 1)');
  const grant = s.db.prepare('INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) VALUES (?, ?, ?, NULL, NULL, 1)');
  for (const [id, role] of [['yeditor', 'content.yazilar.edit'], ['yapprover', 'content.yazilar.approve'], ['seditor', 'content.sayfalar.edit'], ['sapprover', 'content.sayfalar.approve']]) {
    add.run(id, `g-${id}`, `${id}@example.org`);
    grant.run(`g-${id}`, id, role);
    s.db.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)').run(`s-${id}`, id);
  }
  return s;
}
const done = () => setTestCmsTypes([]);

test('a Yazılar-only editor sees only Yazılar types, none of the Etkinlikler drafts, and gets 403 on them', async () => {
  try {
    const { env } = setupGroups();
    const listed = await (await req(env, types.onRequestGet, 'GET', '/api/cms/types', 'yeditor')).json() as any;
    assert.deepEqual(listed.types.map((t: any) => t.key), ['testposts']);
    assert.equal(listed.types[0].group, 'yazilar');

    // An Etkinlikler draft, sent for approval.
    const ev = await create(env, 'editor', { type: 'events', action: 'create', data: newEvent() });
    await on(env, submit.onRequestPost, 'POST', ev.body.draft.id, 'editor', {}, '/submit');
    // A Yazılar draft of their own.
    const post = await create(env, 'yeditor', { type: 'testposts', action: 'create', data: { name: 'First post' } });
    assert.equal(post.res.status, 201);
    assert.equal(post.body.draft.entry_id, 'first-post');
    await on(env, submit.onRequestPost, 'POST', post.body.draft.id, 'yeditor', {}, '/submit');

    for (const as of ['yeditor', 'yapprover']) {
      const list = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', as)).json() as any;
      const all = [...list.mine, ...list.queue, ...list.inflight, ...list.live];
      assert.ok(all.every((d: any) => d.type === 'testposts'), as);
      assert.equal((await on(env, draft.onRequestGet, 'GET', ev.body.draft.id, as)).status, 403, as);
      assert.equal((await on(env, approve.onRequestPost, 'POST', ev.body.draft.id, as, {}, '/approve')).status, 403, as);
    }
    const queue = (await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'yapprover')).json() as any).queue;
    assert.deepEqual(queue.map((d: any) => d.id), [post.body.draft.id]);
    // Nor may they start an Etkinlikler draft, and the other way round.
    assert.equal((await create(env, 'yeditor', { type: 'events', action: 'create', data: newEvent() })).res.status, 403);
    assert.equal((await create(env, 'editor', { type: 'testposts', action: 'create', data: { name: 'Nope' } })).res.status, 403);
    assert.equal((await on(env, draft.onRequestGet, 'GET', post.body.draft.id, 'approver')).status, 403);
    // The Yazılar approver approves it: the pull request links the one İçerik section.
    assert.equal((await on(env, approve.onRequestPost, 'POST', post.body.draft.id, 'yapprover', {}, '/approve')).status, 200);
    assert.ok(gh.prs[0].body.includes(`https://rsg-turkiye.iscbsc.org/admin#icerik/taslaklar/${post.body.draft.id}`));
  } finally {
    done();
  }
});

test('an approve: admin type is approved by an admin only, not by the group\'s approver', async () => {
  try {
    const { env, row } = setupGroups();
    const made = await create(env, 'seditor', { type: 'testpages', action: 'update', entry_id: 'home', data: { a: 'one!', b: 'two' }, base_shas: loaded(HOME) });
    assert.equal(made.res.status, 201);
    const id = made.body.draft.id;
    assert.equal((await on(env, submit.onRequestPost, 'POST', id, 'seditor', {}, '/submit')).status, 200);

    const typesFor = async (as: string) => (await (await req(env, types.onRequestGet, 'GET', '/api/cms/types', as)).json() as any).types;
    assert.equal((await typesFor('sapprover')).find((t: any) => t.key === 'testpages').canApprove, false);
    assert.equal((await typesFor('admin')).find((t: any) => t.key === 'testpages').canApprove, true);
    const queueOf = async (as: string) => (await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', as)).json() as any).queue.map((d: any) => d.id);
    assert.deepEqual(await queueOf('sapprover'), [], 'not in a queue they cannot act on');
    assert.ok((await queueOf('admin')).includes(id));
    const c = async (as: string) => await (await req(env, counts.onRequestGet, 'GET', '/api/admin/counts', as)).json() as any;
    assert.equal((await c('sapprover')).cmsQueue, undefined, 'no queue: nothing in their groups they approve');
    assert.equal((await c('admin')).cmsQueue, 1);

    assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'sapprover', {}, '/approve')).status, 403);
    assert.equal((await on(env, reject.onRequestPost, 'POST', id, 'sapprover', { note: 'no' }, '/reject')).status, 403);
    assert.equal(row(id).status, 'submitted');
    assert.equal((await on(env, approve.onRequestPost, 'POST', id, 'admin', {}, '/approve')).status, 200);
    assert.equal(row(id).status, 'pr_open');
    assert.equal(gh.branches.get(`cms/${id}`)!.get(HOME), serializeJson(TEST_PAGES, { a: 'one!', b: 'two' }));
  } finally {
    done();
  }
});

test('a noCreate type refuses a new entry; a noDelete type refuses a delete', async () => {
  try {
    const { env, db } = setupGroups();
    const created = await create(env, 'sapprover', { type: 'testpages', action: 'create', data: { a: 'x' } });
    assert.equal(created.res.status, 400);
    assert.equal(created.body.code, 'bad_action');
    const deleted = await create(env, 'admin', { type: 'testpages', action: 'delete', entry_id: 'home', base_shas: loaded(HOME) });
    assert.equal(deleted.res.status, 400);
    assert.equal(deleted.body.code, 'bad_action');
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM content_drafts').get() as { n: number }).n, 0);
    // The same actions on a type without the options are fine.
    assert.equal((await create(env, 'yeditor', { type: 'testposts', action: 'create', data: { name: 'Fine' } })).res.status, 201);
  } finally {
    done();
  }
});

test('a fixedKeys type: values may change, keys may not, at the start and on every save', async () => {
  try {
    const { env, row } = setupGroups();
    const start = (data: unknown) => create(env, 'seditor', { type: 'testpages', action: 'update', entry_id: 'home', data, base_shas: loaded(HOME) });
    const added = await start({ a: 'one', b: 'two', c: 'three' });
    assert.equal(added.res.status, 422);
    assert.ok(added.body.errors.c);
    const missing = await start({ a: 'one' });
    assert.equal(missing.res.status, 422);
    assert.ok(missing.body.errors.b);

    const ok = await start({ a: 'ONE', b: 'TWO' });
    assert.equal(ok.res.status, 201);
    const id = ok.body.draft.id;
    const before = row(id).data;
    const save = (data: unknown) => on(env, draft.onRequestPatch, 'PATCH', id, 'seditor', { data });
    const more = await save({ a: 'ONE', b: 'TWO', c: 'new' });
    assert.equal(more.status, 422);
    assert.ok(((await more.json()) as any).errors.c);
    const fewer = await save({ b: 'TWO' });
    assert.equal(fewer.status, 422);
    assert.ok(((await fewer.json()) as any).errors.a);
    assert.equal(row(id).data, before, 'nothing stored');
    // The keys in another order are the same keys.
    assert.equal((await save({ b: 'two again', a: 'one again' })).status, 200);
    // Each save reads no file from GitHub: the stored draft is the baseline.
    const reads = gh.requests.length;
    assert.equal((await save({ a: '1', b: '2' })).status, 200);
    assert.equal(gh.requests.length, reads);
  } finally {
    done();
  }
});

test('an update keeps its file name whatever the data says; only an id kept in the data must still match (A1)', async () => {
  const { env, row } = setup();
  const path = Object.keys(FILES).filter((p) => p.startsWith('src/content/workshops/')).sort()[0];
  const entryId = path.slice('src/content/workshops/'.length, -'.json'.length);
  const data = { ...JSON.parse(FILES[path]), repo: 'Quite_A_Different_Repo' };
  const made = await create(env, 'editor', { type: 'workshops', action: 'update', entry_id: entryId, data, base_shas: loaded(path) });
  assert.equal(made.res.status, 201);
  assert.equal(made.body.draft.entry_id, entryId);
  const id = made.body.draft.id;
  assert.equal((await on(env, draft.onRequestPatch, 'PATCH', id, 'editor', { data: { ...data, repo: 'Yet_Another' } })).status, 200);
  assert.equal(row(id).entry_id, entryId);
  assert.deepEqual(filesFor(row(id) as never).map((f) => f.path), [path]);
  // Events keep their id in the data (idInData): changing it is still refused.
  const ev = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), id: 'other-id' }, base_shas: loaded(EVENT_PATH) });
  assert.equal(ev.res.status, 422);
  assert.ok(ev.body.errors.id);
});

test('the registry\'s defaults keep the Etkinlikler types as they were', () => {
  for (const key of ['events', 'workshops', 'webinars']) {
    const t = cmsType(key)!;
    assert.deepEqual([t.sides, t.fixedKeys, t.noCreate, t.noDelete, t.approve, t.generated], ['both', false, false, false, 'group', false], key);
    assert.equal(t.idInData, key === 'events', key);
  }
  assert.deepEqual(['events', 'workshops', 'webinars'].map((k) => cmsType(k)!.idField), ['id', 'repo', 'en.frontmatter.title']);
  assert.equal(cmsType('testposts'), null, 'test types are gone after the tests');
});

// ── Task 2 fix round 1: the files an approver can compare ─────────────────────

test('entry also answers each file as it is on main, and a draft the files it would write', async () => {
  const { env } = setup();
  const path = EVENT_PATH;
  const ev = await (await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=events&id=${EVENT_ID}`, 'editor')).json() as any;
  assert.deepEqual(ev.files, { [path]: FILES[path] });
  const w = await (await req(env, entry.onRequestGet, 'GET', `/api/cms/entry?type=webinars&id=${PAIR_ID}`, 'editor')).json() as any;
  const tr = PAIR_TR;
  assert.equal(w.files[tr], FILES[tr]);

  const { body } = await create(env, 'editor', { type: 'events', action: 'update', entry_id: EVENT_ID, data: { ...anEvent(), note: 'x' }, base_shas: loaded(path) });
  const got = await (await on(env, draft.onRequestGet, 'GET', body.draft.id, 'editor')).json() as any;
  assert.deepEqual(got.files, [{ path, content: serializeJson(EVENTS, { ...anEvent(), note: 'x' }) }]);
  // The drafts list stays light: no files there.
  const list = await (await req(env, drafts.onRequestGet, 'GET', '/api/cms/drafts', 'editor')).json() as any;
  assert.ok(list.mine.every((d: any) => !('files' in d)));
});
