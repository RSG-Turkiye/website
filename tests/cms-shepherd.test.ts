// The PR shepherd (functions/_lib/cms-shepherd.ts): drafts in a real SQLite
// copy of the D1 schema, and a fake GitHub behind global.fetch that models
// pull requests, their head commits, required checks, main moving on a merge
// (which puts the other open pull requests behind), update-branch and merge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { MAX_FETCHES, PICK_SQL, pruneDrafts, shepherd } from '../functions/_lib/cms-shepherd';
import { setCmsIndexLoader } from '../functions/_lib/cms-api';
import { DRAFT_RETENTION_SECONDS, FAILURE, MERGED_NOT_LIVE_SECONDS, mergedTooLong, PR_OPEN_MAX_SECONDS } from '../functions/_lib/cms-drafts';
import { REQUIRED_CHECKS } from '../functions/_lib/github';
import { onRequestPost as dispatch } from '../functions/api/mail/dispatch';
import { gitBlobSha, gitBlobShas } from '../src/lib/cms/blob-sha';
import { buildCmsIndex, type CmsIndex } from '../src/lib/cms/cms-index';
import { cmsType } from '../src/lib/cms/types';
import { serializeJson } from '../src/lib/cms/serialize';

const ROOT = new URL('../', import.meta.url).pathname;
const SCHEMA = readFileSync(`${ROOT}db/schema.sql`, 'utf8');
const EVENTS = cmsType('events')!;
const NOW = 1_800_000_000;

// ── a fake GitHub of pull requests ────────────────────────────────────────────

type Run = { id: number; name: string; status: string; conclusion: string | null };
type Pr = { number: number; title: string; head: string; base: string; state: 'open' | 'closed'; merged: boolean; conflict: boolean; mergeable?: string };

class FakeGitHub {
  mainHead = 'main-1';
  prs = new Map<number, Pr>();
  /** Head sha → its check runs. None yet = pending. */
  checks = new Map<string, Run[]>();
  requests: { method: string; path: string; body: any }[] = [];
  /** Answers every request with this status instead (GitHub having a bad minute). */
  down: number | null = null;
  /** Awaited once before the next GET /pulls/{n} is answered. */
  hold: Promise<void> | null = null;
  private seq = 0;
  private runId = 0;

  open(number: number, opts: Partial<Pr> = {}) {
    const pr: Pr = { number, title: `CMS: ${number}`, head: `head-${number}-0`, base: this.mainHead, state: 'open', merged: false, conflict: false, ...opts };
    this.prs.set(number, pr);
    return pr;
  }

  green(sha: string) {
    this.checks.set(sha, REQUIRED_CHECKS.map((name) => ({ id: ++this.runId, name, status: 'completed', conclusion: 'success' })));
  }

  failing(sha: string, failed: string) {
    this.checks.set(sha, REQUIRED_CHECKS.map((name) => ({ id: ++this.runId, name, status: 'completed', conclusion: name === failed ? 'failure' : 'success' })));
  }

  greenAll() {
    for (const pr of this.prs.values()) this.green(pr.head);
  }

  private passed(sha: string) {
    const runs = this.checks.get(sha) ?? [];
    return REQUIRED_CHECKS.every((n) => runs.some((r) => r.name === n && r.conclusion === 'success'));
  }

  mergeableState(pr: Pr): string {
    if (pr.mergeable) return pr.mergeable;
    if (pr.conflict) return 'dirty';
    if (pr.base !== this.mainHead) return 'behind';
    return this.passed(pr.head) ? 'clean' : 'blocked';
  }

  /** Pull requests closed through PATCH, in order. */
  closes(): number[] {
    return this.requests.filter((r) => r.method === 'PATCH' && /\/pulls\/\d+$/.test(r.path)).map((r) => Number(r.path.split('/').pop()));
  }

  github(): number {
    return this.requests.filter((r) => r.path.startsWith('/repos/')).length;
  }

  async handle(method: string, url: URL, body: any): Promise<Response> {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
    if (this.down) return json({ message: 'secret GitHub detail' }, this.down);
    const p = url.pathname.replace('/repos/RSG-Turkiye/website', '');
    let m: RegExpExecArray | null;
    if ((m = /^\/pulls\/(\d+)$/.exec(p))) {
      const pr = this.prs.get(Number(m[1]));
      if (!pr) return json({ message: 'Not Found' }, 404);
      if (method === 'GET') {
        if (this.hold) {
          const h = this.hold;
          this.hold = null;
          await h;
        }
        return json({ state: pr.state, merged: pr.merged, mergeable_state: this.mergeableState(pr), title: pr.title, head: { sha: pr.head } });
      }
      if (method === 'PATCH') {
        pr.state = body.state;
        return json({ state: pr.state });
      }
    }
    if (method === 'GET' && (m = /^\/commits\/([^/]+)\/check-runs$/.exec(p))) return json({ check_runs: this.checks.get(m[1]) ?? [] });
    if (method === 'PUT' && (m = /^\/pulls\/(\d+)\/update-branch$/.exec(p))) {
      const pr = this.prs.get(Number(m[1]))!;
      if (body.expected_head_sha && body.expected_head_sha !== pr.head) return json({ message: "expected head sha didn't match current head ref." }, 422);
      if (pr.conflict) return json({ message: 'merge conflict between base and head' }, 422);
      pr.head = `head-${pr.number}-${++this.seq}`;
      pr.base = this.mainHead;
      return json({ message: 'Updating pull request branch.' }, 202);
    }
    if (method === 'PUT' && (m = /^\/pulls\/(\d+)\/merge$/.exec(p))) {
      const pr = this.prs.get(Number(m[1]))!;
      if (pr.merged || pr.state !== 'open' || this.mergeableState(pr) !== 'clean') return json({ message: 'Pull Request is not mergeable' }, 405);
      if (body.sha !== pr.head) return json({ message: 'Head branch was modified' }, 409);
      pr.merged = true;
      pr.state = 'closed';
      this.mainHead = `main-merge-${++this.seq}`;
      return json({ sha: this.mainHead, merged: true });
    }
    throw new Error(`unexpected fake GitHub call: ${method} ${url}`);
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

// ── the database ──────────────────────────────────────────────────────────────

function setup() {
  gh = new FakeGitHub();
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare("INSERT INTO users (id, google_id, email, is_member, created_at, last_login) VALUES ('editor', 'g', 'editor@example.org', 1, 1, 1)").run();
  const prepared: string[] = [];
  const base = d1(db);
  const DB = { ...base, prepare: (sql: string) => { prepared.push(sql); return base.prepare(sql); } };
  const env = { DB, GITHUB_PAT: 'unused' } as never;
  const audit = () => db.prepare('SELECT action, user_id, target_id, details FROM audit_log ORDER BY seq').all() as { action: string; user_id: string | null; target_id: string; details: string }[];
  const row = (id: string) => db.prepare('SELECT * FROM content_drafts WHERE id = ?').get(id) as Record<string, any>;
  return { db, env, audit, row, prepared };
}

const event = (id: string, note = 'x') => ({
  id,
  type: 'meetup',
  start: '2027-03-06',
  title: { en: `Meetup ${id}`, tr: `Buluşma ${id}` },
  when: { en: '6 March 2027', tr: '6 Mart 2027' },
  location: { en: 'Ankara', tr: 'Ankara' },
  description: { en: `An evening meetup. ${note}`, tr: `Bir akşam buluşması. ${note}` },
});
const pathOf = (id: string) => `src/content/events/${id}.json`;

let n = 0;
/** A draft row as the approval leaves it. */
function draft(db: DatabaseSync, opts: { status?: string; pr?: number | null; age?: number; entry?: string; action?: string; checkedAt?: number | null } = {}) {
  const id = `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const entry = opts.entry ?? `meetup-${n}`;
  db.prepare(`INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, pr_url, pr_number, write_nonce, last_checked_at, created_at, updated_at)
              VALUES (?, 'events', ?, ?, ?, ?, ?, 'editor', ?, ?, ?, ?, ?, ?)`).run(
    id, entry, opts.action ?? 'create', JSON.stringify(event(entry)), JSON.stringify({ [pathOf(entry)]: null }),
    opts.status ?? 'pr_open', opts.pr ? `https://github.com/RSG-Turkiye/website/pull/${opts.pr}` : null, opts.pr ?? null,
    `nonce-${n}`, opts.checkedAt ?? null, NOW - (opts.age ?? 600), NOW - (opts.age ?? 600),
  );
  return id;
}

// ── nothing to do ─────────────────────────────────────────────────────────────

test('nothing pending: one indexed SELECT and no GitHub request', async () => {
  const { db, env, prepared } = setup();
  draft(db, { status: 'draft' });
  draft(db, { status: 'pr_failed', pr: 3 });
  assert.deepEqual(await shepherd(env, NOW), { merged: 0, updated: 0, failed: 0, published: 0 });
  assert.deepEqual(prepared, [PICK_SQL]);
  assert.equal(gh.requests.length, 0);
  const plan = (db.prepare(`EXPLAIN QUERY PLAN ${PICK_SQL}`).all() as { detail: string }[]).map((r) => r.detail).join('\n');
  assert.match(plan, /USING (COVERING )?INDEX idx_content_drafts_status/, plan);
  assert.doesNotMatch(plan, /SCAN content_drafts\b(?! USING)/, plan);
});

// ── the outcomes ──────────────────────────────────────────────────────────────

test('green and up to date: squash-merged at the checked head → merged, logged once with no user', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { pr: 41 });
  gh.open(41);
  gh.greenAll();
  assert.deepEqual(await shepherd(env, NOW), { merged: 1, updated: 0, failed: 0, published: 0 });
  const merge = gh.requests.find((r) => r.path.endsWith('/merge'))!;
  assert.equal(merge.body.sha, 'head-41-0');
  assert.equal(merge.body.merge_method, 'squash');
  const after = row(id);
  assert.equal(after.status, 'merged');
  assert.equal(after.updated_at, NOW);
  assert.notEqual(after.write_nonce, 'nonce-1');
  const log = audit();
  assert.deepEqual(log.map((a) => [a.action, a.user_id, a.target_id]), [['cms.pr.merged', null, id]]);
  assert.equal(JSON.parse(log[0].details).pr_number, 41);
});

test('Review Focus 1: the second pull request, behind after the first merges, is updated and then merged', async () => {
  const { db, env, row, audit } = setup();
  const first = draft(db, { pr: 41, age: 900 });
  const second = draft(db, { pr: 42, age: 600 });
  gh.open(41);
  gh.open(42);
  gh.greenAll();

  // Tick 1: the first merges; main moves, so the second is behind it now.
  let r = await shepherd(env, NOW);
  assert.equal(row(first).status, 'merged');
  assert.equal(r.merged, 1);
  assert.equal(r.updated, 1, 'the behind one was updated (main merged into it)');
  assert.equal(row(second).status, 'pr_open');
  assert.equal(gh.prs.get(42)!.base, gh.mainHead);
  assert.notEqual(gh.prs.get(42)!.head, 'head-42-0', 'a new head, so the checks run again');

  // Tick 2: its checks are still running on the new head: nothing to do.
  r = await shepherd(env, NOW + 60);
  assert.deepEqual(r, { merged: 0, updated: 0, failed: 0, published: 0 });
  assert.equal(row(second).status, 'pr_open');

  // Tick 3: green → merged.
  gh.green(gh.prs.get(42)!.head);
  r = await shepherd(env, NOW + 120);
  assert.equal(r.merged, 1);
  assert.equal(row(second).status, 'merged');
  assert.equal(gh.prs.get(42)!.merged, true);
  assert.deepEqual(audit().map((a) => a.action), ['cms.pr.merged', 'cms.pr.merged']);
});

test('Review Focus 2: a failed required check → pr_failed with a reason naming the check', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { pr: 41 });
  gh.open(41);
  gh.failing('head-41-0', 'Symposium Build & Type Check');
  assert.equal((await shepherd(env, NOW)).failed, 1);
  const after = row(id);
  assert.equal(after.status, 'pr_failed');
  assert.equal(after.failure, 'check failed: Symposium Build & Type Check');
  const last = audit().at(-1)!;
  assert.equal(last.action, 'cms.pr.failed');
  assert.equal(JSON.parse(last.details).check, 'Symposium Build & Type Check');
  assert.deepEqual(gh.requests.filter((r) => r.method !== 'GET').map((r) => r.method), ['PATCH'], 'no merge, no update; the pull request is closed');
  assert.deepEqual(gh.closes(), [41]);
  assert.equal(gh.prs.get(41)!.state, 'closed');
});

test('a check that failed on a behind head is not final: the branch is updated and the checks run again', async () => {
  const { db, env, row } = setup();
  const id = draft(db, { pr: 41 });
  gh.open(41, { base: 'main-0' });
  gh.failing('head-41-0', 'Build & Type Check');
  assert.deepEqual(await shepherd(env, NOW), { merged: 0, updated: 1, failed: 0, published: 0 });
  assert.equal(row(id).status, 'pr_open');
  assert.notEqual(gh.prs.get(41)!.head, 'head-41-0');
});

test('merged by hand on GitHub → merged; closed without merging → pr_failed "closed on GitHub"', async () => {
  const { db, env, row } = setup();
  const merged = draft(db, { pr: 41 });
  const closed = draft(db, { pr: 42 });
  gh.open(41, { state: 'closed', merged: true });
  gh.open(42, { state: 'closed' });
  assert.deepEqual(await shepherd(env, NOW), { merged: 1, updated: 0, failed: 1, published: 0 });
  assert.equal(row(merged).status, 'merged');
  assert.equal(row(closed).status, 'pr_failed');
  assert.equal(row(closed).failure, FAILURE.closed);
  assert.equal(FAILURE.closed, 'closed on GitHub');
  assert.equal(gh.github(), 2, 'one request each: no check-runs read for a finished pull request, no close for a closed one');
});

test('a merged or closed pull request settles as such even past the age cap', async () => {
  const { db, env, row } = setup();
  const merged = draft(db, { pr: 41, age: PR_OPEN_MAX_SECONDS + 600 });
  const closed = draft(db, { pr: 42, age: PR_OPEN_MAX_SECONDS + 600 });
  gh.open(41, { state: 'closed', merged: true });
  gh.open(42, { state: 'closed' });
  await shepherd(env, NOW);
  assert.equal(row(merged).status, 'merged');
  assert.equal(row(closed).failure, FAILURE.closed);
});

test('conflicts → pr_failed "conflicts with a newer change; start a new draft", whether GitHub says dirty or refuses the update', async () => {
  const { db, env, row } = setup();
  const dirty = draft(db, { pr: 41 });
  const refused = draft(db, { pr: 42 });
  gh.open(41, { conflict: true });
  gh.open(42, { mergeable: 'behind', conflict: true }); // GitHub has not noticed yet; update-branch does
  assert.equal((await shepherd(env, NOW)).failed, 2);
  for (const id of [dirty, refused]) {
    assert.equal(row(id).status, 'pr_failed');
    assert.equal(row(id).failure, 'conflicts with a newer change; start a new draft');
  }
  assert.deepEqual(gh.closes().sort(), [41, 42]);
  // Never looped on: a failed draft is not looked at again.
  const before = gh.requests.length;
  await shepherd(env, NOW + 60);
  assert.equal(gh.requests.length, before);
});

test('an update refused because the head moved is not a conflict: asked again next tick', async () => {
  const { db, env, row } = setup();
  const id = draft(db, { pr: 41 });
  const pr = gh.open(41, { base: 'main-0' });
  const real = gh.handle.bind(gh);
  gh.handle = async (method, url, body) => {
    if (url.pathname.endsWith('/update-branch')) pr.head = 'pushed-meanwhile';
    return real(method, url, body);
  };
  assert.deepEqual(await shepherd(env, NOW), { merged: 0, updated: 0, failed: 0, published: 0 });
  assert.equal(row(id).status, 'pr_open');
});

test('age cap: pending, unknown or blocked is "ask again" until six hours, then pr_failed (blocked when the checks were green)', async () => {
  for (const [mergeable, reason] of [[undefined, 'checks did not finish'], ['unknown', 'checks did not finish'], ['blocked', 'blocked by branch protection']] as const) {
    const { db, env, row } = setup();
    const young = draft(db, { pr: 41, age: PR_OPEN_MAX_SECONDS - 60 });
    const old = draft(db, { pr: 42, age: PR_OPEN_MAX_SECONDS + 60 });
    gh.open(41, { mergeable });
    gh.open(42, { mergeable });
    if (mergeable) gh.greenAll(); // green checks, but GitHub still says unknown/blocked
    assert.equal((await shepherd(env, NOW)).failed, 1, String(mergeable));
    assert.equal(row(young).status, 'pr_open');
    assert.equal(row(old).status, 'pr_failed');
    assert.equal(row(old).failure, reason, String(mergeable));
    assert.deepEqual(gh.closes(), [42]);
  }
});

test('a merge GitHub refuses, past the cap: "blocked by branch protection", with the refusal in the log', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { pr: 41, age: PR_OPEN_MAX_SECONDS + 60 });
  gh.open(41);
  gh.greenAll();
  const real = gh.handle.bind(gh);
  gh.handle = async (method, url, body) =>
    method === 'PUT' && url.pathname.endsWith('/merge') ? new Response('{"message":"Required review"}', { status: 405 }) : real(method, url, body);
  await shepherd(env, NOW);
  assert.equal(row(id).failure, FAILURE.blocked);
  const details = JSON.parse(audit().at(-1)!.details);
  assert.equal(details.merge, 'not-mergeable');
  assert.equal(details.reason, 'blocked by branch protection');
});

test('the cap applies after a successful update too: a branch that keeps falling behind does not live forever', async () => {
  const { db, env, row } = setup();
  const id = draft(db, { pr: 41, age: PR_OPEN_MAX_SECONDS + 60 });
  gh.open(41, { base: 'main-0' });
  assert.equal((await shepherd(env, NOW)).updated, 1);
  assert.equal(row(id).status, 'pr_failed');
  assert.equal(row(id).failure, FAILURE.timeout);
});

test('GitHub errors are always "ask again", even past the age cap, with a short log and no stored GitHub text', async () => {
  const { db, env, row } = setup();
  const young = draft(db, { pr: 41 });
  const old = draft(db, { pr: 42, age: PR_OPEN_MAX_SECONDS + 1 });
  gh.down = 500;
  const errors: unknown[] = [];
  const realError = console.error;
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    await shepherd(env, NOW);
  } finally {
    console.error = realError;
  }
  assert.equal(row(young).status, 'pr_open');
  assert.equal(row(old).status, 'pr_open', 'the next tick reads the pull request again');
  assert.ok(row(old).last_checked_at === NOW);
  assert.ok(!JSON.stringify(errors).includes('secret GitHub detail'));
});

// ── the budget ────────────────────────────────────────────────────────────────

test(`at most ${MAX_FETCHES} GitHub requests a tick, oldest-checked first, so a backlog takes turns`, async () => {
  const { db, env, row } = setup();
  const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => draft(db, { pr: 40 + i, age: 1000 - i }));
  for (let i = 1; i <= 8; i++) gh.open(40 + i); // checks pending on all: 2 requests each
  const seen = (from: number) => new Set(gh.requests.slice(from).filter((r) => /\/pulls\/\d+$/.test(r.path)).map((r) => Number(r.path.split('/').pop())));

  await shepherd(env, NOW);
  assert.ok(gh.github() <= MAX_FETCHES);
  // A pull request is started only while its worst case (status 2 + merge 2 + close 1) still fits.
  const tick1 = seen(0);
  assert.deepEqual([...tick1], [41, 42, 43, 44]);
  const unchecked = ids.filter((id) => row(id).last_checked_at === null);
  assert.equal(unchecked.length, 4);

  const from = gh.requests.length;
  await shepherd(env, NOW + 60);
  assert.ok(gh.requests.length - from <= MAX_FETCHES);
  const tick2 = seen(from);
  for (const id of unchecked) assert.ok(tick2.has(row(id).pr_number), 'the ones left out last tick go first');
  assert.ok(ids.every((id) => row(id).last_checked_at !== null));
  // Bookkeeping moves neither the age clock nor the nonce.
  assert.ok(ids.every((id) => row(id).updated_at < NOW && row(id).write_nonce.startsWith('nonce-')));
});

test('merges in one tick stay within the budget, leaving room for each one\'s worst case', async () => {
  const { db, env } = setup();
  for (let i = 1; i <= 4; i++) {
    draft(db, { pr: 40 + i });
    gh.open(40 + i);
  }
  // Each merge moves main; model independent files, so none goes behind.
  gh.mergeableState = () => 'clean';
  gh.greenAll();
  const r = await shepherd(env, NOW);
  assert.equal(r.merged, 2);
  assert.equal(gh.github(), 8);
  assert.equal((await shepherd(env, NOW + 60)).merged, 2);
});

test('a merged pull request costs one request, so more of them fit in a tick', async () => {
  const { db, env, row } = setup();
  const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => draft(db, { pr: 40 + i }));
  for (let i = 1; i <= 8; i++) gh.open(40 + i, { state: 'closed', merged: true });
  assert.equal((await shepherd(env, NOW)).merged, 8);
  assert.equal(gh.github(), 8);
  assert.ok(ids.every((id) => row(id).status === 'merged'));
});

// ── rows the shepherd cannot ask GitHub about ─────────────────────────────────

test('pr_open with no pull request number fails at once, with no GitHub request', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { pr: null });
  assert.equal((await shepherd(env, NOW)).failed, 1);
  assert.equal(row(id).status, 'pr_failed');
  assert.equal(row(id).failure, 'no pull request on record');
  assert.equal(gh.requests.length, 0);
  assert.equal(audit().at(-1)!.action, 'cms.pr.failed');
});

test('without a GitHub token, pr_open rows are skipped but stamped; merged rows still go live', async () => {
  const { db, env, row } = setup();
  const open = draft(db, { pr: 41 });
  const merged = draft(db, { status: 'merged', pr: 42, entry: 'meetup-new' });
  const files = contentFiles();
  setCmsIndexLoader(async () => indexWith({ ...files, [pathOf('meetup-new')]: serializeJson(EVENTS, event('meetup-new')) }));
  try {
    const r = await shepherd({ ...(env as any), GITHUB_PAT: '' }, NOW);
    assert.equal(r.published, 1);
  } finally {
    setCmsIndexLoader(null);
  }
  assert.equal(gh.requests.length, 0);
  assert.equal(row(open).status, 'pr_open');
  assert.equal(row(open).last_checked_at, NOW);
  assert.equal(row(merged).status, 'published');
});

// ── overlapping ticks ─────────────────────────────────────────────────────────

test('two overlapping ticks make the change, and log it, exactly once', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { pr: 41 });
  gh.open(41);
  gh.greenAll();
  let release!: () => void;
  gh.hold = new Promise<void>((r) => { release = r; });
  // Tick A reads the draft, then waits on GitHub; tick B runs start to finish meanwhile.
  const a = shepherd(env, NOW);
  await new Promise((r) => setTimeout(r, 10));
  const b = await shepherd(env, NOW + 1);
  assert.equal(b.merged, 1);
  release();
  const ra = await a;
  assert.equal(ra.merged, 0, 'its guarded write found the draft moved on');
  assert.equal(row(id).status, 'merged');
  assert.deepEqual(audit().map((x) => x.action), ['cms.pr.merged']);
  assert.equal(gh.requests.filter((r) => r.path.endsWith('/merge') && r.method === 'PUT').length, 1);
});

// ── merged → published, from the deployed index ──────────────────────────────

function indexWith(files: Record<string, string>): Promise<CmsIndex> {
  return gitBlobShas(files).then((shas) => buildCmsIndex(files, shas));
}

function contentFiles(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['src/content/events', 'src/content/workshops', 'src/content/webinars/en', 'src/content/webinars/tr']) {
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = readFileSync(`${ROOT}${dir}/${f}`, 'utf8');
  }
  return out;
}

test('the index carries each file\'s git blob sha, the same number git computes', async () => {
  const files = contentFiles();
  const index = await indexWith(files);
  const path = 'src/content/events/symposium-2026.json';
  const entry = index.events.find((e) => e.id === 'symposium-2026')!;
  assert.deepEqual(Object.keys(entry.shas!), [path]);
  assert.equal(entry.shas![path], execFileSync('git', ['hash-object', path], { cwd: ROOT, encoding: 'utf8' }).trim());
  const pair = index.webinars.find((w) => w.id === 'integrative-modeling-of-biomolecular-complexes')!;
  assert.deepEqual(Object.keys(pair.shas!).sort(), [pair.paths!.en, pair.paths!.tr].sort());
  // Multi-byte text: the length is in bytes, as git counts it.
  assert.equal(await gitBlobSha('ı\n'), execFileSync('git', ['hash-object', '--stdin'], { input: 'ı\n', encoding: 'utf8' }).trim());
  // Without shas, as before.
  assert.equal(buildCmsIndex(files).events[0].shas, undefined);
});

test('merged becomes published only when the deployed index shows the draft\'s files', async () => {
  const { db, env, row, audit } = setup();
  const id = draft(db, { status: 'merged', pr: 41, entry: 'meetup-new' });
  const files = contentFiles();
  let index: CmsIndex | null = await indexWith(files);
  setCmsIndexLoader(async () => index!);
  try {
    // Not deployed yet.
    assert.equal((await shepherd(env, NOW)).published, 0);
    assert.equal(row(id).status, 'merged');
    assert.ok(row(id).last_checked_at === NOW);
    // Deployed, but an older text of the file (someone else's edit): still not this draft.
    index = await indexWith({ ...files, [pathOf('meetup-new')]: serializeJson(EVENTS, event('meetup-new', 'older')) });
    assert.equal((await shepherd(env, NOW + 60)).published, 0);
    // The index could not be read: not known, never "absent".
    index = null;
    assert.equal((await shepherd(env, NOW + 120)).published, 0);
    // The draft's own bytes are live.
    index = await indexWith({ ...files, [pathOf('meetup-new')]: serializeJson(EVENTS, event('meetup-new')) });
    assert.equal((await shepherd(env, NOW + 180)).published, 1);
    assert.equal(row(id).status, 'published');
    assert.equal(gh.github(), 0, 'no GitHub request for any of this');
    assert.deepEqual(audit().map((a) => a.action), ['cms.pr.published']);
  } finally {
    setCmsIndexLoader(null);
  }
});

test('a merged delete is published when its file is gone from the index; an index without shas proves nothing', async () => {
  const { db, env, row } = setup();
  const files = contentFiles();
  const id = draft(db, { status: 'merged', pr: 41, entry: 'symposium-2026', action: 'delete' });
  db.prepare('UPDATE content_drafts SET base_shas = ? WHERE id = ?').run(JSON.stringify({ [pathOf('symposium-2026')]: 'abc' }), id);
  let index: CmsIndex = await indexWith(files);
  setCmsIndexLoader(async () => index);
  try {
    await shepherd(env, NOW);
    assert.equal(row(id).status, 'merged');
    const { [pathOf('symposium-2026')]: _gone, ...rest } = files;
    index = buildCmsIndex(rest); // an old build: no shas
    await shepherd(env, NOW + 60);
    assert.equal(row(id).status, 'merged');
    index = await indexWith(rest);
    await shepherd(env, NOW + 120);
    assert.equal(row(id).status, 'published');
  } finally {
    setCmsIndexLoader(null);
  }
});

test('merged for more than two hours stays merged; the panel is told the site did not update', async () => {
  const { db, env, row } = setup();
  const id = draft(db, { status: 'merged', pr: 41, age: 2 * 3600 + 60 });
  setCmsIndexLoader(async () => indexWith(contentFiles()));
  try {
    await shepherd(env, NOW);
  } finally {
    setCmsIndexLoader(null);
  }
  const after = row(id);
  assert.equal(after.status, 'merged');
  assert.equal(mergedTooLong(after as never, NOW), true);
  assert.equal(mergedTooLong({ status: 'merged', updated_at: NOW - 600 }, NOW), false);
  assert.equal(mergedTooLong({ status: 'published', updated_at: 0 }, NOW), false);
});

test('merged for more than a day without the site showing it → pr_failed, which frees the entry', async () => {
  const { db, env, row, audit } = setup();
  const day = draft(db, { status: 'merged', pr: 41, age: MERGED_NOT_LIVE_SECONDS + 60 });
  const hours = draft(db, { status: 'merged', pr: 42, age: MERGED_NOT_LIVE_SECONDS - 60 });
  setCmsIndexLoader(async () => indexWith(contentFiles()));
  try {
    assert.equal((await shepherd(env, NOW)).failed, 1);
  } finally {
    setCmsIndexLoader(null);
  }
  assert.equal(row(day).status, 'pr_failed');
  assert.equal(row(day).failure, 'merged but the site never showed it');
  assert.equal(row(hours).status, 'merged');
  assert.equal(MERGED_NOT_LIVE_SECONDS, 24 * 3600);
  assert.equal(audit().at(-1)!.action, 'cms.pr.failed');
  assert.equal(gh.requests.length, 0);
});

// ── retention ────────────────────────────────────────────────────────────────

test('finished drafts older than 90 days are deleted with one log row; pr_failed, rejected and recent ones stay', async () => {
  const { db, env, row, audit } = setup();
  const old = DRAFT_RETENTION_SECONDS + 60;
  const gone = ['published', 'discarded', 'published'].map((status) => draft(db, { status, age: old }));
  const kept = [draft(db, { status: 'pr_failed', age: old }), draft(db, { status: 'rejected', age: old }), draft(db, { status: 'published', age: 3600 }), draft(db, { status: 'draft', age: old })];
  assert.equal(await pruneDrafts((env as any).DB, NOW), 3);
  for (const id of gone) assert.equal(row(id), undefined);
  for (const id of kept) assert.ok(row(id));
  const log = audit();
  assert.deepEqual(log.map((a) => a.action), ['cms.draft.prune']);
  assert.deepEqual(JSON.parse(log[0].details), { count: 3 });
  assert.equal(await pruneDrafts((env as any).DB, NOW), 0);
  assert.equal(audit().length, 1, 'nothing to delete, nothing logged');
  const plan = (db.prepare(`EXPLAIN QUERY PLAN DELETE FROM content_drafts WHERE status IN ('published', 'discarded') AND updated_at < ?`).all(1) as { detail: string }[]).map((r) => r.detail).join('\n');
  assert.match(plan, /INDEX idx_content_drafts_status/);
});

// ── on the mail tick ──────────────────────────────────────────────────────────

async function dispatchAt(iso: string, env: Record<string, unknown>, waitUntil?: (p: Promise<unknown>) => void) {
  const RealDate = globalThis.Date;
  const at = RealDate.parse(iso);
  class Fixed extends RealDate {
    constructor(...args: unknown[]) {
      // @ts-expect-error -- forwarding a variadic Date constructor
      super(...(args.length === 0 ? [at] : args));
    }
    static now() { return at; }
  }
  globalThis.Date = Fixed as DateConstructor;
  try {
    return await (dispatch as (c: unknown) => Promise<Response>)({
      request: new Request('https://rsg-turkiye.iscbsc.org/api/mail/dispatch', { method: 'POST', headers: { 'X-Dispatch-Secret': 's' } }),
      env: { ...env, MAIL_SYNC_SECRET: 's' },
      ...(waitUntil ? { waitUntil } : {}),
    });
  } finally {
    globalThis.Date = RealDate;
  }
}

test('the mail tick runs the shepherd exactly once, at night (mail held) and by day (after the mail)', async () => {
  for (const iso of ['2026-09-08T00:30:00Z', '2026-09-08T09:30:00Z']) {
    const { db, env, row } = setup();
    const id = draft(db, { pr: 41 });
    gh.open(41); // checks still running: every run reads the pull request once
    const res = await dispatchAt(iso, env as never);
    assert.equal(res.status, 200, iso);
    assert.equal(gh.requests.filter((r) => /\/pulls\/41$/.test(r.path)).length, 1, iso);
    assert.equal(row(id).last_checked_at, Date.parse(iso) / 1000, iso);
  }
});

test('with waitUntil the mail answer does not wait for the shepherd, which still runs once', { timeout: 5000 }, async () => {
  for (const iso of ['2026-09-08T00:30:00Z', '2026-09-08T09:30:00Z']) {
    const { db, env, row } = setup();
    const id = draft(db, { pr: 41 });
    gh.open(41);
    let release!: () => void;
    gh.hold = new Promise<void>((r) => { release = r; });
    const later: Promise<unknown>[] = [];
    const res = await dispatchAt(iso, env as never, (p) => later.push(p));
    assert.equal(res.status, 200, iso);
    assert.equal(later.length, 1, iso);
    assert.equal(row(id).last_checked_at, null, 'answered while the shepherd was still waiting on GitHub');
    release();
    await Promise.all(later);
    assert.equal(row(id).last_checked_at, Date.parse(iso) / 1000, iso);
  }
});

test('a shepherd that throws never blocks mail; retention rides the hourly tick', async () => {
  const { db, env, row } = setup();
  const finished = draft(db, { status: 'discarded', age: DRAFT_RETENTION_SECONDS + 3600 });
  const at = Date.parse('2026-09-08T09:00:00Z') / 1000; // on the hour
  db.prepare('UPDATE content_drafts SET updated_at = ? WHERE id = ?').run(at - DRAFT_RETENTION_SECONDS - 3600, finished);
  await dispatchAt('2026-09-08T09:00:00Z', env as never);
  assert.equal(row(finished), undefined);

  db.exec('DROP TABLE content_drafts');
  const realError = console.error;
  const errors: unknown[][] = [];
  console.error = (...a: unknown[]) => { errors.push(a); };
  try {
    const res = await dispatchAt('2026-09-08T09:30:00Z', env as never);
    assert.equal(res.status, 200);
    assert.ok(errors.some((e) => e[0] === 'cms shepherd failed'));
  } finally {
    console.error = realError;
  }
});
