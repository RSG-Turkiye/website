# Symposium Certificates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Participants enter their email on the symposium site and view/download their certificate PDFs; organisers upload PDFs plus a CSV in the admin panel; everything is deleted 30 days after upload.

**Architecture:** D1 rows + R2 objects (`certificates/<uuid>.pdf` in the existing private `MAIL_ATTACHMENTS` bucket) on the main site, behind three public endpoints (lookup, file, status) with CORS for the symposium origin and four admin endpoints. The static symposium site gets `/certificates/` (EN/TR) that calls the lookup from the browser, plus a home-page band driven by the status endpoint at build time. The nightly `symposium-cron` Worker purges expired rows and objects before it rebuilds.

**Tech Stack:** Astro 5 (static), Cloudflare Pages Functions (TypeScript), D1, R2, Cloudflare Worker cron, `node:test` + `node:sqlite`, Playwright (manual browser tests), `pdf-lib@1.17.1` and `pdfjs-dist@4.10.38` (admin panel only).

**Spec:** `docs/superpowers/specs/2026-10-11-symposium-certificates-design.md`

## Global Constraints

- Repo root for all paths: `/Users/bogrum/workspace/my_projects/rsg-website-stuff/website`. Main-site tests: `npm test` at root. Symposium tests: `npm test` in `symposium_website/`.
- **PDF only.** A stored file must start with the bytes `%PDF-`. Maximum stored size **10 MB** (`MAX_CERT_BYTES = 10 * 1024 * 1024`).
- Kinds, exactly: `participation`, `workshop`, `presentation`, `appreciation`. CSV also accepts Turkish `katılım`, `workshop`, `sunum`, `teşekkür` (case-insensitive, `I/ı/İ` folded).
- Retention: `expires_at = uploaded_at + 30 * 86400` (seconds). R2 lifecycle safety net: prefix `certificates/`, delete after **31** days.
- Rate limit: **20 lookups per 10 minutes per IP hash**. Lookup rows older than 1 day are purged.
- One certificate per `(year, email, kind)`; re-upload replaces and restarts the 30 days.
- Allowed cross-origin caller: `https://symposium.rsg-turkiye.iscbsc.org`, plus `http://localhost:<port>` and `http://127.0.0.1:<port>` for dev.
- Contact address shown to participants: `turkey.rsg@gmail.com`.
- Never publish `*.pages.dev`, `*.r2.dev` or `*.workers.dev` URLs (blocked in Türkiye). Files are served only through `/api/certificates/…` on `rsg-turkiye.iscbsc.org`.
- The repo is public: no real participant names or emails in tests, fixtures or commits. Use `@example.org` addresses.
- No `innerHTML` with data, no inline event handlers (`onclick=`), no `alert/confirm/prompt`.
- Every user-facing string exists in EN and TR (`src/i18n/ui.ts` keys `admin.symposium.certificates.*` on the main site; `cert.*` in `symposium_website/src/i18n/ui.ts`).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Admin endpoints live under `/api/admin/certificates…`, **not** `/api/admin/symposium/…`: the latter already has a dynamic `[kind].ts` that would compete for the path. (The spec's "Admin API" section names the symposium path; this plan supersedes that detail and Task 9 updates the spec.)

## Review Focus

1. **Turkish characters in emails/names and CSV from Excel-TR** (`;` delimiter, BOM, `İ`): a row the organiser sees as valid must upload, and lookup must match regardless of case. → tests in Task 5 (CSV) and Task 1 (`normaliseEmail`).
2. **A certificate that expired between lookup and opening** (dialog left open overnight): the file route must 404 and the page must show the "not found, write to us" message rather than a blank iframe. → test in Task 3 (expired file 404) and the page handles a 404 via a HEAD check before framing (Task 8).
3. **Re-uploading a corrected PDF for the same person and kind**: old R2 object deleted, one row remains, new expiry. → test in Task 2.
4. **The cron runs while the main site is down or the secret is missing**: the purge reports `ERROR`, the tick still runs both rebuilds, and the invocation fails visibly. → test in Task 4.
5. **A PDF that pdf.js cannot render or pdf-lib cannot load (encrypted, malformed)**: the original is uploaded unchanged and the row says so; nothing throws out of the batch. → `compressPdf` falls back (Task 6), and the browser test feeds a deliberately broken PDF (Task 6 Step 7).

---

## File Structure

Main site:
- `db/schema.sql` — modify: migration note 7l + two tables.
- `functions/_lib/certificates.ts` — create: constants, email/kind/key helpers, CORS, IP hash, filename. Pure; no D1/R2 calls except `rateLimited`.
- `functions/api/admin/certificates.ts` — create: GET list, POST upload, DELETE all-of-year.
- `functions/api/admin/certificates/[id].ts` — create: DELETE one.
- `functions/api/admin/certificates/rebuild.ts` — create: POST, fires `triggerRebuild`.
- `functions/api/admin/certificates/purge.ts` — create: POST, secret-gated retention.
- `functions/api/certificates/lookup.ts` — create.
- `functions/api/certificates/status.ts` — create.
- `functions/api/certificates/[file].ts` — create: serves `<uuid>.pdf`.
- `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml` — modify: purge step.
- `src/lib/certificate-csv.ts` — create: pure CSV parse + upload planning.
- `src/scripts/pdf-compress.ts` — create: browser-only compression.
- `src/scripts/admin-certificates.ts` — create: the pane section's behaviour.
- `src/components/admin/panes/SymposiumPane.astro` — modify: fifth section.
- `src/scripts/admin-panel.ts` — modify: call `setupCertificates` / `loadCertificates`.
- `src/i18n/ui.ts` — modify: `admin.symposium.certificates.*`.
- `tests/lib/d1-sqlite.ts`, `tests/lib/fake-r2.ts` — create: test doubles.
- `tests/certificates-lib.test.ts`, `tests/certificates-admin.test.ts`, `tests/certificates-public.test.ts`, `tests/certificates-purge.test.ts`, `tests/symposium-cron.test.ts`, `tests/certificate-csv.test.ts` — create.
- `tests/browser/certificates-admin.mjs` — create.
- `README.md` — modify: setup section.

Symposium site (`symposium_website/`):
- `src/lib/certificates.ts` — create: status fetch, band decision, page helpers.
- `src/components/CertificatesBand.astro`, `src/components/CertificateLookup.astro` — create.
- `src/pages/certificates.astro`, `src/pages/tr/certificates.astro` — create.
- `src/pages/index.astro`, `src/pages/tr/index.astro` — modify: render the band.
- `src/i18n/ui.ts` — modify: `cert.*`.
- `tests/certificates.test.ts` — create.
- `../tests/browser/certificates-page.mjs` — create (lives with the other browser tests).

---

### Task 0: Branch base

- [ ] **Step 1:** This work needs the `WEBSITE_DEPLOY_HOOK` change from PR #252. If #252 is merged: `git fetch origin && git rebase origin/main`. If not: `git rebase fix/events-daily-rebuild`. Confirm `grep -n WEBSITE_DEPLOY_HOOK workers/symposium-cron/src/index.ts` finds it.
- [ ] **Step 2:** `npm test` at root and in `symposium_website/` — both green before starting.

---

### Task 1: Schema and the certificates library

**Files:**
- Modify: `db/schema.sql` (append note 7l after note 7k; append tables at end)
- Create: `functions/_lib/certificates.ts`
- Test: `tests/certificates-lib.test.ts`

**Interfaces — Produces:**
```ts
export const KINDS = ['participation','workshop','presentation','appreciation'] as const;
export type CertKind = typeof KINDS[number];
export const MAX_CERT_BYTES: number;          // 10 MB
export const RETENTION_SECONDS: number;       // 30 days
export const LOOKUP_WINDOW_SECONDS: number;   // 600
export const LOOKUP_LIMIT: number;            // 20
export const CERT_FILE: RegExp;               // /^<uuid>\.pdf$/
export function normaliseEmail(raw: string): string | null;
export function isKind(v: unknown): v is CertKind;
export function certKey(id: string): string;  // 'certificates/<id>.pdf'
export function isPdf(bytes: ArrayBuffer): boolean;
export function downloadFilename(year: number, kind: CertKind, name: string): string;
export function corsHeaders(request: Request): Headers;   // empty Headers if origin not allowed
export async function ipHash(request: Request): Promise<string>;
export async function rateLimited(db: D1Database, hash: string, now: number): Promise<boolean>; // records the attempt when not limited
```

- [ ] **Step 1: Add the schema.** After the note 7k block in `db/schema.sql`, add:

```sql
-- 7l. Symposium certificates. Two new tables, both CREATE IF NOT EXISTS, so
--    re-applying the whole file is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Without it /api/certificates/* and /api/admin/certificates* answer 500
--    with "no such table". Files live in the MAIL_ATTACHMENTS bucket under
--    certificates/; add the R2 lifecycle rule described in README.md.
--
```

At the end of the file, add:

```sql
-- One row per certificate. Deleted 30 days after upload by
-- /api/admin/certificates/purge, which the symposium-cron Worker calls
-- nightly; the email address goes with it.
CREATE TABLE IF NOT EXISTS symposium_certificates (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('participation','workshop','presentation','appreciation')),
  size_bytes  INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_year_email_kind ON symposium_certificates(year, email, kind);
CREATE INDEX IF NOT EXISTS idx_cert_email ON symposium_certificates(email);
CREATE INDEX IF NOT EXISTS idx_cert_expires ON symposium_certificates(expires_at);

-- Public lookups, for the rate limit only. ip_hash is SHA-256 of the
-- connecting IP; rows older than a day are purged with the certificates.
CREATE TABLE IF NOT EXISTS certificate_lookups (
  ip_hash TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cert_lookups ON certificate_lookups(ip_hash, at);
```

- [ ] **Step 2: Write the failing tests** in `tests/certificates-lib.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import {
  normaliseEmail, isKind, certKey, isPdf, downloadFilename, corsHeaders,
  ipHash, rateLimited, CERT_FILE, LOOKUP_LIMIT, KINDS,
} from '../functions/_lib/certificates';
import { d1 } from './lib/d1-sqlite';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const enc = (s: string) => new TextEncoder().encode(s).buffer;

test('emails are trimmed and lowercased, including a Turkish dotted capital', () => {
  assert.equal(normaliseEmail('  Ayse@Example.ORG '), 'ayse@example.org');
  assert.equal(normaliseEmail('İLKER@example.org'), normaliseEmail('ilker@example.org'));
  assert.equal(normaliseEmail('İLKER@example.org'), 'ilker@example.org');
});

test('malformed emails are refused', () => {
  for (const bad of ['', 'no-at', 'a@b', 'a b@example.org', 'a@@example.org', `${'x'.repeat(250)}@example.org`]) {
    assert.equal(normaliseEmail(bad), null, bad);
  }
});

test('kinds are exactly the four', () => {
  assert.deepEqual([...KINDS], ['participation', 'workshop', 'presentation', 'appreciation']);
  assert.ok(isKind('workshop'));
  assert.ok(!isKind('katılım'));
  assert.ok(!isKind('toString'));
});

test('keys and file names', () => {
  const id = '3f1c2b4a-1111-4222-8333-444455556666';
  assert.equal(certKey(id), `certificates/${id}.pdf`);
  assert.ok(CERT_FILE.test(`${id}.pdf`));
  assert.ok(!CERT_FILE.test(`${id}.png`));
  assert.ok(!CERT_FILE.test(`../${id}.pdf`));
});

test('only bytes starting %PDF- are a PDF', () => {
  assert.ok(isPdf(enc('%PDF-1.7\n...')));
  assert.ok(!isPdf(enc('<html>')));
  assert.ok(!isPdf(new ArrayBuffer(0)));
});

test('download filename is ASCII and readable', () => {
  assert.equal(downloadFilename(2026, 'participation', 'Ayşe Çağlar Öztürk'), 'RSG-2026-participation-Ayse-Caglar-Ozturk.pdf');
  assert.equal(downloadFilename(2026, 'workshop', '   '), 'RSG-2026-workshop.pdf');
});

test('CORS allows the symposium origin and localhost only', () => {
  const req = (origin: string) => new Request('https://rsg-turkiye.iscbsc.org/api/certificates/lookup', { headers: { Origin: origin } });
  assert.equal(corsHeaders(req('https://symposium.rsg-turkiye.iscbsc.org')).get('Access-Control-Allow-Origin'), 'https://symposium.rsg-turkiye.iscbsc.org');
  assert.equal(corsHeaders(req('http://localhost:4321')).get('Access-Control-Allow-Origin'), 'http://localhost:4321');
  assert.equal(corsHeaders(req('https://evil.example')).get('Access-Control-Allow-Origin'), null);
  assert.equal(corsHeaders(req('https://symposium.rsg-turkiye.iscbsc.org.evil.example')).get('Access-Control-Allow-Origin'), null);
});

test('ipHash is a stable hex digest and never the raw IP', async () => {
  const r = new Request('https://x/', { headers: { 'CF-Connecting-IP': '203.0.113.7' } });
  const h = await ipHash(r);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await ipHash(r));
  assert.ok(!h.includes('203'));
});

test(`the ${LOOKUP_LIMIT + 1}th lookup inside ten minutes is limited, and the window slides`, async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const D1 = d1(db) as unknown as D1Database;
  const now = 1_800_000_000;
  for (let i = 0; i < LOOKUP_LIMIT; i++) assert.equal(await rateLimited(D1, 'h', now + i), false);
  assert.equal(await rateLimited(D1, 'h', now + LOOKUP_LIMIT), true);
  assert.equal(await rateLimited(D1, 'other', now + LOOKUP_LIMIT), false, 'per hash');
  assert.equal(await rateLimited(D1, 'h', now + 601 + LOOKUP_LIMIT), false, 'after the window');
});
```

- [ ] **Step 3: Create the D1 test double** `tests/lib/d1-sqlite.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';

/**
 * Just enough of D1's API over node:sqlite for handler tests: prepare/bind
 * and first/all/run, plus batch as a transaction. Real SQL, real schema --
 * the point is that a wrong query fails here the way it would in D1.
 */
export function d1(db: DatabaseSync) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    async first<T>(): Promise<T | null> {
      const row = db.prepare(sql).get(...(args as never[]));
      return (row ? { ...row } : null) as T | null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      return { results: db.prepare(sql).all(...(args as never[])).map((r) => ({ ...r })) as T[] };
    },
    async run() {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(stmts: { run(): Promise<unknown> }[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
```

- [ ] **Step 4: Run to see it fail.** `node --import tsx --test tests/certificates-lib.test.ts` → FAIL, cannot find module `../functions/_lib/certificates`.

- [ ] **Step 5: Implement** `functions/_lib/certificates.ts`:

```ts
/**
 * Shared rules for symposium certificates: what a stored file and a lookup
 * may look like, and the two cross-cutting concerns of the public endpoints
 * (CORS for the symposium site, a per-IP rate limit).
 *
 * See docs/superpowers/specs/2026-10-11-symposium-certificates-design.md.
 */

export const KINDS = ['participation', 'workshop', 'presentation', 'appreciation'] as const;
export type CertKind = (typeof KINDS)[number];

export const MAX_CERT_BYTES = 10 * 1024 * 1024;
export const RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const LOOKUP_WINDOW_SECONDS = 10 * 60;
export const LOOKUP_LIMIT = 20;

export const CERT_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased with Turkish-aware folding of the dotted capital, so İ and I
 * both become i: "İLKER@" typed on a Turkish keyboard must find "ilker@". */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function isKind(v: unknown): v is CertKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

export function certKey(id: string): string {
  return `certificates/${id}.pdf`;
}

export function isPdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return String.fromCharCode(...head) === '%PDF-';
}

const TR_ASCII: Record<string, string> = { ı: 'i', İ: 'I', ğ: 'g', Ğ: 'G', ş: 's', Ş: 'S' };

export function downloadFilename(year: number, kind: CertKind, name: string): string {
  const slug = name
    .replace(/[ıİğĞşŞ]/g, (c) => TR_ASCII[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug ? `RSG-${year}-${kind}-${slug}.pdf` : `RSG-${year}-${kind}.pdf`;
}

const SYMPOSIUM_ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/** Only these endpoints are called cross-origin, so CORS is set here rather
 * than site-wide. An origin we do not know gets no CORS headers at all. */
export function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin') ?? '';
  if (origin === SYMPOSIUM_ORIGIN || DEV_ORIGIN.test(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  headers.set('Vary', 'Origin');
  return headers;
}

export async function ipHash(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rsg-cert:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when this hash has used up its lookups in the window. Records the
 * attempt otherwise, so a limited caller does not extend its own window. */
export async function rateLimited(db: D1Database, hash: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM certificate_lookups WHERE ip_hash = ? AND at > ?')
    .bind(hash, now - LOOKUP_WINDOW_SECONDS)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= LOOKUP_LIMIT) return true;
  await db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').bind(hash, now).run();
  return false;
}
```

- [ ] **Step 6: Run** `node --import tsx --test tests/certificates-lib.test.ts tests/schema.test.ts` → PASS. Then `npm test` → all green.
- [ ] **Step 7: Commit**

```bash
git add db/schema.sql functions/_lib/certificates.ts tests/lib/d1-sqlite.ts tests/certificates-lib.test.ts
git commit -m "Certificates: schema and shared rules

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Admin endpoints (upload, list, delete, rebuild)

**Files:**
- Create: `functions/api/admin/certificates.ts`, `functions/api/admin/certificates/[id].ts`, `functions/api/admin/certificates/rebuild.ts`, `tests/lib/fake-r2.ts`
- Test: `tests/certificates-admin.test.ts`

**Interfaces:**
- Consumes: Task 1 exports; `getSessionUser`, `jsonResponse`, `checkCsrf`, `generateId` from `functions/_lib/auth`; `canManageSymposium`, `triggerRebuild` from `functions/_lib/symposium`.
- Produces (HTTP):
  - `GET /api/admin/certificates?year=YYYY` → `{certificates: AdminCertRow[], totalBytes: number}` where `AdminCertRow = {id, year, email, name, kind, size_bytes, uploaded_at, expires_at}`, ordered by `name`.
  - `POST /api/admin/certificates` raw PDF body, headers `X-Cert-Year`, `X-Cert-Email`, `X-Cert-Name` (URI-encoded), `X-Cert-Type` → `{ok: true, id, expiresAt, replaced: boolean}`; errors `{error, code}` with codes `invalid_year | invalid_email | invalid_name | invalid_kind | not_pdf | too_large | empty_file`.
  - `DELETE /api/admin/certificates?year=YYYY` → `{ok: true, deleted: number}`.
  - `DELETE /api/admin/certificates/<id>` → `{ok: true}` or 404 `{code:'not_found'}`.
  - `POST /api/admin/certificates/rebuild` → `{ok: true, rebuild: RebuildStatus}`.

- [ ] **Step 1: Fake R2** `tests/lib/fake-r2.ts`:

```ts
/** An in-memory stand-in for the parts of R2Bucket the handlers use. */
export function fakeR2() {
  const store = new Map<string, { body: Uint8Array; contentType?: string }>();
  return {
    store,
    async put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: new Uint8Array(value as ArrayBuffer), contentType: opts?.httpMetadata?.contentType });
    },
    async get(key: string) {
      const o = store.get(key);
      if (!o) return null;
      return {
        body: new Blob([o.body]).stream(),
        size: o.body.length,
        httpEtag: '"etag"',
        writeHttpMetadata(h: Headers) { if (o.contentType) h.set('Content-Type', o.contentType); },
      };
    },
    async delete(keys: string | string[]) {
      for (const k of Array.isArray(keys) ? keys : [keys]) store.delete(k);
    },
  };
}
```

- [ ] **Step 2: Write the failing tests** `tests/certificates-admin.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import * as list from '../functions/api/admin/certificates';
import * as one from '../functions/api/admin/certificates/[id]';
import { RETENTION_SECONDS } from '../functions/_lib/certificates';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const BASE = 'https://rsg-turkiye.iscbsc.org/api/admin/certificates';
const PDF = new TextEncoder().encode('%PDF-1.7\nfake');

function setup(role: { is_admin?: number; is_symposium?: number } = { is_symposium: 1 }) {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  db.prepare(`INSERT INTO users (id, google_id, email, is_admin, is_symposium, created_at, last_login) VALUES ('u1','g1','org@example.org',?,?,1,1)`)
    .run(role.is_admin ?? 0, role.is_symposium ?? 0);
  db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES ('s1','u1',?,1)`).run(4_000_000_000);
  const r2 = fakeR2();
  const env = { DB: d1(db), MAIL_ATTACHMENTS: r2, SYMPOSIUM_DEPLOY_HOOK: '' } as never;
  return { db, r2, env };
}

const cookie = { Cookie: 'rsg_session=s1' };
const call = (h: unknown, request: Request, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request, env, params });

function upload(env: unknown, headers: Record<string, string>, body: Uint8Array = PDF) {
  return call(list.onRequestPost, new Request(BASE, {
    method: 'POST',
    headers: { ...cookie, 'Content-Type': 'application/pdf', 'X-Cert-Year': '2026', 'X-Cert-Email': 'Ayse@Example.org', 'X-Cert-Name': encodeURIComponent('Ayşe Yılmaz'), 'X-Cert-Type': 'participation', ...headers },
    body,
  }), env);
}

test('an organiser uploads a certificate; it is stored under certificates/ with a 30-day expiry', async () => {
  const { env, r2, db } = setup();
  const res = await upload(env, {});
  assert.equal(res.status, 200);
  const body = await res.json() as { id: string; replaced: boolean };
  assert.equal(body.replaced, false);
  assert.ok(r2.store.has(`certificates/${body.id}.pdf`));
  const row = db.prepare('SELECT * FROM symposium_certificates').get() as Record<string, unknown>;
  assert.equal(row.email, 'ayse@example.org');
  assert.equal(row.name, 'Ayşe Yılmaz');
  assert.equal(Number(row.expires_at) - Number(row.uploaded_at), RETENTION_SECONDS);
});

test('re-uploading the same person and kind replaces the file and the row', async () => {
  const { env, r2, db } = setup();
  const first = await (await upload(env, {})).json() as { id: string };
  const second = await (await upload(env, { 'X-Cert-Name': encodeURIComponent('Ayşe Yılmaz Kaya') })).json() as { id: string; replaced: boolean };
  assert.equal(second.replaced, true);
  assert.ok(!r2.store.has(`certificates/${first.id}.pdf`), 'old object deleted');
  assert.ok(r2.store.has(`certificates/${second.id}.pdf`));
  const rows = db.prepare('SELECT name FROM symposium_certificates').all() as { name: string }[];
  assert.deepEqual(rows.map((r) => r.name), ['Ayşe Yılmaz Kaya']);
});

test('a second kind for the same person is a second certificate', async () => {
  const { env, db } = setup();
  await upload(env, {});
  await upload(env, { 'X-Cert-Type': 'workshop' });
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 2);
});

test('bad input is refused with a code', async () => {
  const { env } = setup();
  const cases: [Record<string, string>, Uint8Array | undefined, string][] = [
    [{ 'X-Cert-Year': '26' }, undefined, 'invalid_year'],
    [{ 'X-Cert-Email': 'nope' }, undefined, 'invalid_email'],
    [{ 'X-Cert-Name': '%' }, undefined, 'invalid_name'],
    [{ 'X-Cert-Name': '' }, undefined, 'invalid_name'],
    [{ 'X-Cert-Type': 'katılım' }, undefined, 'invalid_kind'],
    [{}, new TextEncoder().encode('<html>'), 'not_pdf'],
    [{}, new Uint8Array(0), 'empty_file'],
    [{}, (() => { const b = new Uint8Array(10 * 1024 * 1024 + 1); b.set(PDF); return b; })(), 'too_large'],
  ];
  for (const [headers, body, code] of cases) {
    const res = await upload(env, headers, body);
    assert.equal(res.status, 400, code);
    assert.equal(((await res.json()) as { code: string }).code, code);
  }
});

test('only symposium organisers and admins may upload, list or delete', async () => {
  const { env } = setup({});
  assert.equal((await upload(env, {})).status, 403);
  assert.equal((await call(list.onRequestGet, new Request(`${BASE}?year=2026`, { headers: cookie }), env)).status, 403);
  const anon = await call(list.onRequestGet, new Request(`${BASE}?year=2026`), env);
  assert.equal(anon.status, 401);
});

test('a cross-site upload is refused before anything else', async () => {
  const { env } = setup();
  const res = await upload(env, { Origin: 'https://evil.example' });
  assert.equal(res.status, 403);
});

test('list returns the year sorted by name, with total size', async () => {
  const { env } = setup();
  await upload(env, { 'X-Cert-Email': 'b@example.org', 'X-Cert-Name': 'Zeynep' });
  await upload(env, { 'X-Cert-Email': 'a@example.org', 'X-Cert-Name': 'Ali' });
  const res = await call(list.onRequestGet, new Request(`${BASE}?year=2026`, { headers: cookie }), env);
  const body = await res.json() as { certificates: { name: string }[]; totalBytes: number };
  assert.deepEqual(body.certificates.map((c) => c.name), ['Ali', 'Zeynep']);
  assert.equal(body.totalBytes, PDF.length * 2);
});

test('delete one removes the object and the row; unknown id is 404', async () => {
  const { env, r2, db } = setup();
  const { id } = await (await upload(env, {})).json() as { id: string };
  const del = (x: string) => call(one.onRequestDelete, new Request(`${BASE}/${x}`, { method: 'DELETE', headers: cookie }), env, { id: x });
  assert.equal((await del(id)).status, 200);
  assert.equal(r2.store.size, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 0);
  assert.equal((await del(id)).status, 404);
});

test('delete all for a year leaves other years alone', async () => {
  const { env, r2 } = setup();
  await upload(env, {});
  await upload(env, { 'X-Cert-Year': '2025' });
  const res = await call(list.onRequestDelete, new Request(`${BASE}?year=2026`, { method: 'DELETE', headers: cookie }), env);
  assert.equal(((await res.json()) as { deleted: number }).deleted, 1);
  assert.equal(r2.store.size, 1);
});
```

- [ ] **Step 3: Run to see it fail.** `node --import tsx --test tests/certificates-admin.test.ts` → FAIL, module not found.

- [ ] **Step 4: Implement** `functions/api/admin/certificates.ts`:

```ts
// Organisers' side of symposium certificates: upload one PDF at a time
// (the panel loops over the CSV), list a year, delete a year. Files go in
// the private MAIL_ATTACHMENTS bucket under certificates/ and are deleted 30
// days after upload by ./certificates/purge.ts.
import type { Env, User } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { canManageSymposium } from '../../_lib/symposium';
import {
  normaliseEmail, isKind, isPdf, certKey, MAX_CERT_BYTES, RETENTION_SECONDS,
} from '../../_lib/certificates';

const bad = (code: string, error: string) => jsonResponse({ error, code }, 400);

export async function organiser(request: Request, env: Env, mutating: boolean): Promise<User | Response> {
  if (mutating && !checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  return user;
}

export function yearParam(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 2012 && year <= 2100 ? year : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, false);
  if (user instanceof Response) return user;
  const year = yearParam(new URL(request.url).searchParams.get('year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  const { results } = await env.DB.prepare(
    `SELECT id, year, email, name, kind, size_bytes, uploaded_at, expires_at
     FROM symposium_certificates WHERE year = ? ORDER BY name COLLATE NOCASE, kind`
  ).bind(year).all<{ size_bytes: number }>();
  const totalBytes = results.reduce((sum, r) => sum + r.size_bytes, 0);
  return jsonResponse({ certificates: results, totalBytes });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;

  const year = yearParam(request.headers.get('X-Cert-Year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  const email = normaliseEmail(request.headers.get('X-Cert-Email') ?? '');
  if (!email) return bad('invalid_email', 'Invalid email');
  let name: string;
  try {
    name = decodeURIComponent(request.headers.get('X-Cert-Name') ?? '');
  } catch {
    return bad('invalid_name', 'Invalid name');
  }
  name = name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  if (!name) return bad('invalid_name', 'Invalid name');
  const kind = request.headers.get('X-Cert-Type');
  if (!isKind(kind)) return bad('invalid_kind', 'Invalid certificate type');

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return bad('empty_file', 'Empty file');
  if (bytes.byteLength > MAX_CERT_BYTES) return bad('too_large', 'File too large');
  if (!isPdf(bytes)) return bad('not_pdf', 'Not a PDF');

  const previous = await env.DB.prepare(
    'SELECT id FROM symposium_certificates WHERE year = ? AND email = ? AND kind = ?'
  ).bind(year, email, kind).first<{ id: string }>();

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RETENTION_SECONDS;
  // New object first, then the rows in one transaction, then the old
  // object: a failure at any step leaves a row pointing at a file that exists.
  await env.MAIL_ATTACHMENTS.put(certKey(id), bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const insert = env.DB.prepare(
    `INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, year, email, name, kind, bytes.byteLength, user.id, now, expiresAt);
  if (previous) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM symposium_certificates WHERE id = ?').bind(previous.id),
      insert,
    ]);
    await env.MAIL_ATTACHMENTS.delete(certKey(previous.id));
  } else {
    await insert.run();
  }
  return jsonResponse({ ok: true, id, expiresAt, replaced: Boolean(previous) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  const year = yearParam(new URL(request.url).searchParams.get('year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  const { results } = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE year = ?')
    .bind(year).all<{ id: string }>();
  // R2 accepts up to 1000 keys per delete.
  for (let i = 0; i < results.length; i += 1000) {
    await env.MAIL_ATTACHMENTS.delete(results.slice(i, i + 1000).map((r) => certKey(r.id)));
  }
  await env.DB.prepare('DELETE FROM symposium_certificates WHERE year = ?').bind(year).run();
  return jsonResponse({ ok: true, deleted: results.length });
};
```

`functions/api/admin/certificates/[id].ts`:

```ts
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';
import { organiser } from '../certificates';

export const onRequestDelete: PagesFunction<Env> = async ({ request, env, params }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  const id = String(params.id);
  const row = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE id = ?').bind(id).first<{ id: string }>();
  if (!row) return jsonResponse({ error: 'Not found', code: 'not_found' }, 404);
  await env.MAIL_ATTACHMENTS.delete(certKey(row.id));
  await env.DB.prepare('DELETE FROM symposium_certificates WHERE id = ?').bind(row.id).run();
  return jsonResponse({ ok: true });
};
```

`functions/api/admin/certificates/rebuild.ts`:

```ts
// Called once by the panel after a batch upload or a delete-all, so the
// symposium home page band appears or goes without one rebuild per file.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { triggerRebuild } from '../../../_lib/symposium';
import { organiser } from '../certificates';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  return jsonResponse({ ok: true, rebuild: await triggerRebuild(env) });
};
```

- [ ] **Step 5: Run** `node --import tsx --test tests/certificates-admin.test.ts` → PASS; `npm test` → green (if `functions-hygiene.test.ts` flags something, fix it in these files, not the test).
- [ ] **Step 6: Commit** `git add functions/api/admin/certificates.ts functions/api/admin/certificates tests/lib/fake-r2.ts tests/certificates-admin.test.ts && git commit -m "Certificates: admin upload, list and delete …"` (with the Co-Authored-By line).

---

### Task 3: Public endpoints (lookup, file, status)

**Files:**
- Create: `functions/api/certificates/lookup.ts`, `functions/api/certificates/[file].ts`, `functions/api/certificates/status.ts`
- Test: `tests/certificates-public.test.ts`

**Interfaces — Produces (HTTP):**
- `POST /api/certificates/lookup`, body JSON `{email}` sent as `text/plain` (no preflight) or `application/json` → `200 {certificates: PublicCert[]}` with `PublicCert = {id, year, kind, name, expiresAt, url}` (`url` absolute: `https://rsg-turkiye.iscbsc.org/api/certificates/<id>.pdf`, built from the request's own origin); `400 {code:'invalid_email'}`; `429 {code:'rate_limited'}`. `OPTIONS` → 204 with CORS.
- `GET|HEAD /api/certificates/<id>.pdf[?download=1]` → PDF or 404.
- `GET /api/certificates/status` → `{years: {year, count, expiresAt}[]}` newest first.

- [ ] **Step 1: Write the failing tests** `tests/certificates-public.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import * as lookup from '../functions/api/certificates/lookup';
import * as file from '../functions/api/certificates/[file]';
import * as status from '../functions/api/certificates/status';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const API = 'https://rsg-turkiye.iscbsc.org/api/certificates';
const NOW = Math.floor(Date.now() / 1000);
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare(`INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?)`);
  add.run(ID1, 2026, 'ayse@example.org', 'Ayşe Yılmaz', 'participation', 9, 'u1', NOW, NOW + 1000);
  add.run(ID2, 2025, 'ayse@example.org', 'Ayşe Yılmaz', 'workshop', 9, 'u1', NOW, NOW + 1000);
  add.run(ID3, 2026, 'ayse@example.org', 'Ayşe Yılmaz', 'workshop', 9, 'u1', NOW - 5000, NOW - 1);
  const r2 = fakeR2();
  for (const id of [ID1, ID2, ID3]) r2.store.set(`certificates/${id}.pdf`, { body: new TextEncoder().encode('%PDF-1.7 x'), contentType: 'application/pdf' });
  return { db, r2, env: { DB: d1(db), MAIL_ATTACHMENTS: r2 } as never };
}
const call = (h: unknown, request: Request, env: unknown, params: Record<string, string> = {}) =>
  (h as (c: unknown) => Promise<Response>)({ request, env, params });
const post = (env: unknown, body: string, ip = '203.0.113.1') =>
  call(lookup.onRequestPost, new Request(`${API}/lookup`, {
    method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'text/plain', 'CF-Connecting-IP': ip }, body,
  }), env);

test('lookup finds unexpired certificates, newest year first, whatever the case of the email', async () => {
  const { env } = setup();
  const res = await post(env, JSON.stringify({ email: ' AYSE@example.org ' }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const { certificates } = await res.json() as { certificates: { id: string; year: number; url: string }[] };
  assert.deepEqual(certificates.map((c) => c.id), [ID1, ID2], 'expired one left out');
  assert.equal(certificates[0].url, `${API}/${ID1}.pdf`);
});

test('no match is an empty list, not an error', async () => {
  const { env } = setup();
  const res = await post(env, JSON.stringify({ email: 'nobody@example.org' }));
  assert.equal(res.status, 200);
  assert.deepEqual(((await res.json()) as { certificates: unknown[] }).certificates, []);
});

test('malformed body or email is 400', async () => {
  const { env } = setup();
  for (const body of ['not json', '{}', JSON.stringify({ email: 'x' }), JSON.stringify({ email: 5 })]) {
    const res = await post(env, body);
    assert.equal(res.status, 400, body);
    assert.equal(((await res.json()) as { code: string }).code, 'invalid_email');
  }
});

test('the 21st lookup from one IP in ten minutes is 429 and carries CORS', async () => {
  const { env } = setup();
  for (let i = 0; i < 20; i++) assert.equal((await post(env, JSON.stringify({ email: 'a@example.org' }))).status, 200);
  const res = await post(env, JSON.stringify({ email: 'a@example.org' }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal((await post(env, JSON.stringify({ email: 'a@example.org' }), '198.51.100.9')).status, 200);
});

test('OPTIONS preflight answers 204 with CORS', async () => {
  const res = await call(lookup.onRequestOptions, new Request(`${API}/lookup`, { method: 'OPTIONS', headers: { Origin: ORIGIN } }), {});
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('file route serves an unexpired PDF inline, framable only by the symposium site', async () => {
  const { env } = setup();
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf`), env, { file: `${ID1}.pdf` });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/pdf');
  assert.match(res.headers.get('Content-Disposition')!, /^inline; filename="RSG-2026-participation-Ayse-Yilmaz\.pdf"/);
  assert.equal(res.headers.get('Content-Security-Policy'), `frame-ancestors ${ORIGIN}`);
  assert.equal(res.headers.get('X-Robots-Tag'), 'noindex');
  assert.equal(await res.text(), '%PDF-1.7 x');
});

test('?download=1 makes it an attachment', async () => {
  const { env } = setup();
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf?download=1`), env, { file: `${ID1}.pdf` });
  assert.match(res.headers.get('Content-Disposition')!, /^attachment;/);
});

test('expired, unknown and malformed file names are 404 without touching R2', async () => {
  const { env } = setup();
  for (const name of [`${ID3}.pdf`, '44444444-4444-4444-8444-444444444444.pdf', 'x.pdf', `${ID1}.png`]) {
    const res = await call(file.onRequestGet, new Request(`${API}/${name}`), env, { file: name });
    assert.equal(res.status, 404, name);
  }
});

test('a row whose object is already gone (lifecycle rule) is 404, not 500', async () => {
  const { env, r2 } = setup();
  r2.store.delete(`certificates/${ID1}.pdf`);
  const res = await call(file.onRequestGet, new Request(`${API}/${ID1}.pdf`), env, { file: `${ID1}.pdf` });
  assert.equal(res.status, 404);
});

test('status lists unexpired years with counts and no personal data', async () => {
  const { env } = setup();
  const res = await call(status.onRequestGet, new Request(`${API}/status`), env);
  const text = await res.text();
  assert.ok(!text.includes('@') && !text.includes('Ayşe'));
  assert.deepEqual(JSON.parse(text), { years: [{ year: 2026, count: 1, expiresAt: NOW + 1000 }, { year: 2025, count: 1, expiresAt: NOW + 1000 }] });
});
```

- [ ] **Step 2: Run to see it fail** → module not found.

- [ ] **Step 3: Implement** `functions/api/certificates/lookup.ts`:

```ts
// Public: a participant's email -> their unexpired certificates. Called from
// the symposium site's /certificates page in the browser. Email alone is the
// key, by the organisers' decision (see the spec); the rate limit only slows
// bulk probing.
import type { Env } from '../../_lib/auth';
import { corsHeaders, ipHash, normaliseEmail, rateLimited } from '../../_lib/certificates';

function json(request: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email: string | null = null;
  try {
    const body = JSON.parse(await request.text()) as { email?: unknown };
    if (typeof body?.email === 'string') email = normaliseEmail(body.email);
  } catch {
    email = null;
  }
  if (!email) return json(request, { error: 'Invalid email', code: 'invalid_email' }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env.DB, await ipHash(request), now)) {
    return json(request, { error: 'Too many lookups', code: 'rate_limited' }, 429);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, year, kind, name, expires_at FROM symposium_certificates
     WHERE email = ? AND expires_at > ? ORDER BY year DESC, kind`
  ).bind(email, now).all<{ id: string; year: number; kind: string; name: string; expires_at: number }>();

  const origin = new URL(request.url).origin;
  return json(request, {
    certificates: results.map((r) => ({
      id: r.id, year: r.year, kind: r.kind, name: r.name, expiresAt: r.expires_at,
      url: `${origin}/api/certificates/${r.id}.pdf`,
    })),
  });
};
```

`functions/api/certificates/[file].ts`:

```ts
// Serves one certificate PDF through this domain (r2.dev is blocked in
// Türkiye). The UUID is the authorisation, as for /api/images; unlike
// images, an expired row is refused even if the object still exists.
import type { Env } from '../../_lib/auth';
import { CERT_FILE, certKey, downloadFilename, isKind } from '../../_lib/certificates';

const SYMPOSIUM_ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const notFound = () => new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });

const serve: PagesFunction<Env> = async ({ params, env, request }) => {
  const name = String(params.file);
  if (!CERT_FILE.test(name)) return notFound();
  const id = name.slice(0, -4);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT year, kind, name FROM symposium_certificates WHERE id = ? AND expires_at > ?'
  ).bind(id, now).first<{ year: number; kind: string; name: string }>();
  if (!row || !isKind(row.kind)) return notFound();

  const object = await env.MAIL_ATTACHMENTS.get(certKey(id), { range: request.headers });
  if (!object) return notFound();

  const filename = downloadFilename(row.year, row.kind, row.name);
  const download = new URL(request.url).searchParams.get('download') === '1';
  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  headers.set('Content-Security-Policy', `frame-ancestors ${SYMPOSIUM_ORIGIN}`);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('etag', object.httpEtag);

  const ranged = 'range' in object && object.range !== undefined && request.headers.has('Range');
  return new Response(object.body, { status: ranged ? 206 : 200, headers });
};

export const onRequestGet = serve;
/** HEAD too: Pages does not derive it from GET, and the page checks a file
 * still exists with HEAD before framing it. */
export const onRequestHead = serve;
```

Note: `frame-ancestors` with only the production origin blocks framing from `localhost` during dev; that is acceptable (the download link still works). Do **not** widen it.

`functions/api/certificates/status.ts`:

```ts
// Read at build time by the symposium site to decide whether the home page
// shows the certificates band. Counts only -- no names, no emails.
import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    `SELECT year, COUNT(*) AS count, MAX(expires_at) AS expiresAt
     FROM symposium_certificates WHERE expires_at > ? GROUP BY year ORDER BY year DESC`
  ).bind(now).all<{ year: number; count: number; expiresAt: number }>();
  return jsonResponse({ years: results });
};
```

- [ ] **Step 4: Run** `node --import tsx --test tests/certificates-public.test.ts` → PASS; `npm test` → green.
- [ ] **Step 5: Commit** `functions/api/certificates tests/certificates-public.test.ts` — "Certificates: public lookup, file and status endpoints".

---

### Task 4: Retention — purge endpoint and the cron step

**Files:**
- Create: `functions/api/admin/certificates/purge.ts`
- Modify: `workers/symposium-cron/src/index.ts`, `workers/symposium-cron/wrangler.toml`
- Test: `tests/certificates-purge.test.ts`, `tests/symposium-cron.test.ts`

**Interfaces — Produces:** `POST /api/admin/certificates/purge` with header `X-Archive-Secret` → `{ok: true, certificates: number, lookups: number}`; 403 otherwise. Worker `Tick` gains `purge: string`; order archive → purge → rebuild → websiteRebuild.

- [ ] **Step 1: Failing purge test** `tests/certificates-purge.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './lib/d1-sqlite';
import { fakeR2 } from './lib/fake-r2';
import { onRequestPost } from '../functions/api/admin/certificates/purge';

const SCHEMA = readFileSync(new URL('../db/schema.sql', import.meta.url).pathname, 'utf8');
const NOW = Math.floor(Date.now() / 1000);

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const add = db.prepare(`INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at) VALUES (?,2026,?,?,'participation',1,'u1',?,?)`);
  add.run('old', 'a@example.org', 'A', NOW - 40 * 86400, NOW - 10);
  add.run('gone', 'b@example.org', 'B', NOW - 40 * 86400, NOW - 10);
  add.run('new', 'c@example.org', 'C', NOW, NOW + 86400);
  db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').run('h', NOW - 2 * 86400);
  db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').run('h', NOW - 60);
  const r2 = fakeR2();
  r2.store.set('certificates/old.pdf', { body: new Uint8Array(1) });
  r2.store.set('certificates/new.pdf', { body: new Uint8Array(1) });
  // 'gone' has no object: the lifecycle rule got there first.
  return { db, r2, env: { DB: d1(db), MAIL_ATTACHMENTS: r2, SYMPOSIUM_ARCHIVE_SECRET: 's3cret' } as never };
}
const purge = (env: unknown, secret?: string) =>
  (onRequestPost as (c: unknown) => Promise<Response>)({
    request: new Request('https://rsg-turkiye.iscbsc.org/api/admin/certificates/purge', {
      method: 'POST', headers: secret ? { 'X-Archive-Secret': secret } : {},
    }),
    env,
  });

test('without the secret nothing is deleted', async () => {
  const { env, db } = setup();
  assert.equal((await purge(env)).status, 403);
  assert.equal((await purge(env, 'wrong')).status, 403);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM symposium_certificates').get() as { n: number }).n, 3);
});

test('expired certificates go from R2 and D1, emails included; current ones stay', async () => {
  const { env, db, r2 } = setup();
  const res = await purge(env, 's3cret');
  assert.deepEqual(await res.json(), { ok: true, certificates: 2, lookups: 1 });
  assert.deepEqual([...r2.store.keys()], ['certificates/new.pdf']);
  const emails = (db.prepare('SELECT email FROM symposium_certificates').all() as { email: string }[]).map((r) => r.email);
  assert.deepEqual(emails, ['c@example.org']);
});

test('a second run finds nothing', async () => {
  const { env } = setup();
  await purge(env, 's3cret');
  assert.deepEqual(await (await purge(env, 's3cret')).json(), { ok: true, certificates: 0, lookups: 0 });
});
```

- [ ] **Step 2: Implement** `functions/api/admin/certificates/purge.ts`:

```ts
// Retention: certificates and their email addresses are kept 30 days. The
// symposium-cron Worker calls this nightly with the archive secret, before
// it rebuilds the symposium site, so the home page band goes with the last
// certificate. An R2 lifecycle rule on certificates/ (31 days) is the safety
// net if this stops running.
import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { certKey } from '../../../_lib/certificates';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Archive-Secret');
  if (!env.SYMPOSIUM_ARCHIVE_SECRET || secret !== env.SYMPOSIUM_ARCHIVE_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE expires_at <= ?')
    .bind(now).all<{ id: string }>();
  // Objects first: if this throws, the rows survive and the next run retries.
  // Deleting a key that is already gone is not an error in R2.
  for (let i = 0; i < results.length; i += 1000) {
    await env.MAIL_ATTACHMENTS.delete(results.slice(i, i + 1000).map((r) => certKey(r.id)));
  }
  const certs = await env.DB.prepare('DELETE FROM symposium_certificates WHERE expires_at <= ?').bind(now).run();
  const lookups = await env.DB.prepare('DELETE FROM certificate_lookups WHERE at < ?').bind(now - 86400).run();
  return jsonResponse({ ok: true, certificates: certs.meta.changes, lookups: lookups.meta.changes });
};
```

- [ ] **Step 3: Run** the purge test → PASS.

- [ ] **Step 4: Failing cron test** `tests/symposium-cron.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/symposium-cron/src/index';

const ENV = {
  ARCHIVE_URL: 'https://main/archive',
  PURGE_URL: 'https://main/purge',
  SYMPOSIUM_ARCHIVE_SECRET: 's',
  SYMPOSIUM_DEPLOY_HOOK: 'https://hooks/symposium',
  WEBSITE_DEPLOY_HOOK: 'https://hooks/website',
};

function stubFetch(fail: string | null = null) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('/purge') || url.includes('/archive')) {
      assert.equal(new Headers(init?.headers).get('X-Archive-Secret'), 's');
    }
    if (url === fail) return new Response('down', { status: 500 });
    return new Response('{"ok":true}', { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('the tick runs archive, purge, then both rebuilds, in that order', async () => {
  const f = stubFetch();
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 200);
    assert.deepEqual(f.calls, [ENV.ARCHIVE_URL, ENV.PURGE_URL, ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
  } finally { f.restore(); }
});

test('a failing purge still lets both rebuilds run, and the tick reports failure', async () => {
  const f = stubFetch(ENV.PURGE_URL);
  try {
    const res = await worker.fetch(new Request('http://localhost/'), ENV as never);
    assert.equal(res.status, 502);
    assert.deepEqual(f.calls.slice(2), [ENV.SYMPOSIUM_DEPLOY_HOOK, ENV.WEBSITE_DEPLOY_HOOK]);
    const body = await res.json() as { purge: string };
    assert.match(String(body.purge), /^ERROR 500/);
  } finally { f.restore(); }
});
```

Run → FAIL (purge not called / `purge` missing).

- [ ] **Step 5: Implement in the Worker.** In `workers/symposium-cron/src/index.ts`:
  - `Env` gains `PURGE_URL: string;`
  - `type Tick = { archive: string; purge: string; rebuild: string; websiteRebuild: string };`
  - In `tick`, after `const archive = await callArchive(env);` add `const purge = await callPurge(env);` and return `{ archive, purge, rebuild, websiteRebuild }`.
  - `failed` checks `[t.archive, t.purge, t.rebuild, t.websiteRebuild]`.
  - `summarise` adds `` purge: ${t.purge.slice(0, 120)} ``.
  - The `fetch` handler's JSON adds `purge: parseIfJson(body.purge),` after `archive`.
  - Add, next to `callArchive`:

```ts
/** Deletes certificates past their 30 days. Before the rebuilds, so the
 * symposium home page loses its certificates band the same night. */
async function callPurge(env: Env): Promise<string> {
  try {
    const res = await fetch(env.PURGE_URL, {
      method: 'POST',
      headers: { 'X-Archive-Secret': env.SYMPOSIUM_ARCHIVE_SECRET },
    });
    const body = await res.text();
    console.log(`purge ${res.status}: ${body.slice(0, 300)}`);
    return res.ok ? body : `ERROR ${res.status}: ${body.slice(0, 200)}`;
  } catch (err) {
    console.log(`purge threw: ${String(err).slice(0, 300)}`);
    return `ERROR: ${String(err).slice(0, 200)}`;
  }
}
```

  In `workers/symposium-cron/wrangler.toml` `[vars]` add `PURGE_URL = "https://rsg-turkiye.iscbsc.org/api/admin/certificates/purge"`, and add a sentence to the header comment that the Worker also purges expired certificates.

- [ ] **Step 6: Run** both tests → PASS; `npm test` → green; `cd workers/symposium-cron && npx wrangler deploy --dry-run` → succeeds.
- [ ] **Step 7: Commit** — "Certificates: nightly purge of expired certificates".

---

### Task 5: CSV parsing and upload planning (pure)

**Files:**
- Create: `src/lib/certificate-csv.ts`
- Test: `tests/certificate-csv.test.ts`

**Interfaces — Produces:**
```ts
export type CsvKind = 'participation' | 'workshop' | 'presentation' | 'appreciation';
export interface CsvRow { line: number; email: string; name: string; type: string; file: string }
export type CsvError = 'empty' | 'missing_columns';
export function parseCsv(text: string): { rows: CsvRow[] } | { error: CsvError; missing?: string[] };
export function kindFromLabel(label: string): CsvKind | null;
export type RowProblem = 'invalid_email' | 'invalid_kind' | 'missing_name' | 'missing_file' | 'duplicate';
export interface PlannedRow extends CsvRow { kind: CsvKind | null; email: string; problems: RowProblem[] }
export function planUpload(rows: CsvRow[], fileNames: string[]): { rows: PlannedRow[]; unusedFiles: string[] };
export const PLAN_KINDS: readonly CsvKind[];
```

`planUpload` normalises email (same rule as `normaliseEmail`: trim, `İ`/`I`→`i`, lowercase), matches `file` to selected file names case-insensitively, and flags `duplicate` on the second and later rows with the same (email, kind). File-level problems (`not_pdf`, `too_large`) are decided later in the browser, after reading the bytes (Task 6).

- [ ] **Step 1: Failing tests** `tests/certificate-csv.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, kindFromLabel, planUpload, PLAN_KINDS } from '../src/lib/certificate-csv';
import { KINDS } from '../functions/_lib/certificates';

test('the panel and the API agree on the four kinds', () => {
  assert.deepEqual([...PLAN_KINDS], [...KINDS]);
});

test('comma CSV with a quoted name containing a comma', () => {
  const r = parseCsv('email,name,type,file\nayse@example.org,"Yılmaz, Ayşe",participation,ayse.pdf\n');
  assert.ok('rows' in r);
  assert.deepEqual(r.rows, [{ line: 2, email: 'ayse@example.org', name: 'Yılmaz, Ayşe', type: 'participation', file: 'ayse.pdf' }]);
});

test('Excel-TR: semicolons, BOM, CRLF, header in another order and case', () => {
  const r = parseCsv('﻿File;Name;EMAIL;Type\r\nayse.pdf;Ayşe;ayse@example.org;Katılım\r\n\r\n');
  assert.ok('rows' in r);
  assert.equal(r.rows.length, 1, 'blank line ignored');
  assert.equal(r.rows[0].type, 'Katılım');
});

test('a doubled quote inside a quoted field is one quote', () => {
  const r = parseCsv('email,name,type,file\na@example.org,"Ali ""Can"" Demir",workshop,a.pdf');
  assert.ok('rows' in r);
  assert.equal(r.rows[0].name, 'Ali "Can" Demir');
});

test('missing columns are named', () => {
  assert.deepEqual(parseCsv('email,name\na@example.org,A'), { error: 'missing_columns', missing: ['type', 'file'] });
  assert.deepEqual(parseCsv('   \n'), { error: 'empty' });
});

test('Turkish and English kind labels, any case', () => {
  assert.equal(kindFromLabel('KATILIM'), 'participation');
  assert.equal(kindFromLabel('katılım'), 'participation');
  assert.equal(kindFromLabel('Sunum'), 'presentation');
  assert.equal(kindFromLabel('TEŞEKKÜR'), 'appreciation');
  assert.equal(kindFromLabel('Workshop'), 'workshop');
  assert.equal(kindFromLabel('poster'), null);
});

test('planning flags each problem and lists unused files', () => {
  const rows = [
    { line: 2, email: 'A@Example.org', name: 'A', type: 'katılım', file: 'A.PDF' },
    { line: 3, email: 'a@example.org', name: 'A', type: 'participation', file: 'a2.pdf' },
    { line: 4, email: 'bad', name: '', type: 'poster', file: 'missing.pdf' },
  ];
  const plan = planUpload(rows, ['a.pdf', 'a2.pdf', 'extra.pdf']);
  assert.deepEqual(plan.rows.map((r) => r.problems), [[], ['duplicate'], ['invalid_email', 'invalid_kind', 'missing_name', 'missing_file']]);
  assert.equal(plan.rows[0].email, 'a@example.org');
  assert.equal(plan.rows[0].kind, 'participation');
  assert.deepEqual(plan.unusedFiles, ['extra.pdf']);
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `src/lib/certificate-csv.ts`:

```ts
/**
 * The certificate CSV, read in the organiser's browser before anything is
 * uploaded. Pure, so it is tested under node. Columns: email, name, type,
 * file -- any order, any case. Comma or semicolon: Excel in a Turkish locale
 * saves with semicolons.
 */

export type CsvKind = 'participation' | 'workshop' | 'presentation' | 'appreciation';
export const PLAN_KINDS: readonly CsvKind[] = ['participation', 'workshop', 'presentation', 'appreciation'];
export interface CsvRow { line: number; email: string; name: string; type: string; file: string }
export type CsvError = 'empty' | 'missing_columns';
export type RowProblem = 'invalid_email' | 'invalid_kind' | 'missing_name' | 'missing_file' | 'duplicate';
export interface PlannedRow extends CsvRow { kind: CsvKind | null; problems: RowProblem[] }

const COLUMNS = ['email', 'name', 'type', 'file'] as const;

/** Turkish-aware lowercase: I -> ı would be right for Turkish words but
 * wrong for emails and English labels, so both I and İ fold to i. */
const fold = (s: string) => s.trim().replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();

const LABELS: Record<string, CsvKind> = {
  participation: 'participation', 'katılım': 'participation', katilim: 'participation',
  workshop: 'workshop', 'çalıştay': 'workshop',
  presentation: 'presentation', sunum: 'presentation',
  appreciation: 'appreciation', 'teşekkür': 'appreciation', tesekkur: 'appreciation',
};

export function kindFromLabel(label: string): CsvKind | null {
  return LABELS[fold(label)] ?? null;
}

function splitRecords(text: string, delimiter: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let field = '', fields: string[] = [], quoted = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { fields.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      out.push({ line: start, fields });
      fields = []; field = ''; line++; start = line;
    } else field += c;
  }
  fields.push(field);
  out.push({ line: start, fields });
  return out.filter((r) => r.fields.some((f) => f.trim() !== ''));
}

export function parseCsv(text: string): { rows: CsvRow[] } | { error: CsvError; missing?: string[] } {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records = splitRecords(clean, delimiter);
  if (records.length === 0) return { error: 'empty' };
  const header = records[0].fields.map(fold);
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { error: 'missing_columns', missing: [...missing] };
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  const rows = records.slice(1).map(({ line, fields }) => ({
    line,
    email: (fields[at.email] ?? '').trim(),
    name: (fields[at.name] ?? '').trim(),
    type: (fields[at.type] ?? '').trim(),
    file: (fields[at.file] ?? '').trim(),
  }));
  return { rows };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function planUpload(rows: CsvRow[], fileNames: string[]): { rows: PlannedRow[]; unusedFiles: string[] } {
  const byLower = new Map(fileNames.map((n) => [n.toLowerCase(), n]));
  const used = new Set<string>();
  const seen = new Set<string>();
  const planned = rows.map((row) => {
    const email = fold(row.email);
    const kind = kindFromLabel(row.type);
    const problems: RowProblem[] = [];
    if (email.length > 254 || !EMAIL.test(email)) problems.push('invalid_email');
    if (!kind) problems.push('invalid_kind');
    if (!row.name) problems.push('missing_name');
    const match = byLower.get(row.file.toLowerCase());
    if (!match) problems.push('missing_file');
    else used.add(match);
    const key = `${email}|${kind}`;
    if (problems.length === 0 && seen.has(key)) problems.push('duplicate');
    seen.add(key);
    return { ...row, email, kind, file: match ?? row.file, problems };
  });
  return { rows: planned, unusedFiles: fileNames.filter((n) => !used.has(n)) };
}
```

- [ ] **Step 4: Run** → PASS; `npm test` → green. **Step 5: Commit** — "Certificates: CSV parsing and upload planning".

---

### Task 6: Admin pane — UI, compression, upload loop

**Files:**
- Modify: `package.json` (deps), `src/components/admin/panes/SymposiumPane.astro` (append section after Committee), `src/scripts/admin-panel.ts` (bootstrap at ~line 761), `src/i18n/ui.ts` (EN near line 524, TR near line 1063)
- Create: `src/scripts/pdf-compress.ts`, `src/scripts/admin-certificates.ts`, `tests/browser/certificates-admin.mjs`, `tests/fixtures/certificates/` (generated in Step 7, not committed if over 200 KB)

**Interfaces:**
- Consumes: Task 2 endpoints; Task 5 `parseCsv`, `planUpload`, `PlannedRow`.
- Produces: `compressPdf(bytes: ArrayBuffer, opts: {rasterise: boolean}): Promise<{bytes: Uint8Array; method: 'original'|'lossless'|'raster'; error?: string}>`; `setupCertificates(deps: CertDeps): void` and `loadCertificates(): Promise<void>` where
  ```ts
  interface CertDeps {
    t: (key: string) => string;
    tf: (key: string, vars: Record<string, string | number>) => string;
    showToast: (message: string, isError?: boolean) => void;
    showRebuildStatus: (elId: string, rebuild: { state?: 'started'|'queued'|'failed'; detail: string }) => void;
    formatDate: (ts: number) => string;
  }
  ```

- [ ] **Step 1: Dependencies.** `npm install --save-exact pdf-lib@1.17.1 pdfjs-dist@4.10.38`. Confirm `npm run build` still succeeds.

- [ ] **Step 2: i18n.** Add these keys to `src/i18n/ui.ts` in **both** `en` and `tr` blocks (the `admin-symposium-i18n` test enforces parity):

| key | en | tr |
|---|---|---|
| `admin.symposium.certificates.heading` | Certificates | Sertifikalar |
| `admin.symposium.certificates.intro` | Upload one PDF per certificate and a CSV with the columns email, name, type, file. Participants find theirs by email on the symposium site. Everything is deleted 30 days after upload. | Her sertifika için bir PDF ve email, name, type, file sütunlarını içeren bir CSV yükleyin. Katılımcılar sempozyum sitesinde e-postalarıyla bulur. Her şey yüklemeden 30 gün sonra silinir. |
| `admin.symposium.certificates.year` | Year | Yıl |
| `admin.symposium.certificates.csv` | CSV file | CSV dosyası |
| `admin.symposium.certificates.pdfs` | PDF files | PDF dosyaları |
| `admin.symposium.certificates.rasterise` | Shrink large files (over 1 MB) by converting pages to images | Büyük dosyaları (1 MB üstü) sayfaları görüntüye çevirerek küçült |
| `admin.symposium.certificates.check` | Check | Kontrol et |
| `admin.symposium.certificates.upload` | Upload {count} certificates | {count} sertifikayı yükle |
| `admin.symposium.certificates.progress` | Uploading {done} / {total} | Yükleniyor {done} / {total} |
| `admin.symposium.certificates.done` | Uploaded {ok}, failed {failed} | Yüklendi {ok}, başarısız {failed} |
| `admin.symposium.certificates.unused` | PDFs not in the CSV: {files} | CSV'de olmayan PDF'ler: {files} |
| `admin.symposium.certificates.col.email` | Email | E-posta |
| `admin.symposium.certificates.col.name` | Name | Ad |
| `admin.symposium.certificates.col.kind` | Type | Tür |
| `admin.symposium.certificates.col.size` | Size | Boyut |
| `admin.symposium.certificates.col.status` | Status | Durum |
| `admin.symposium.certificates.col.expires` | Deleted on | Silinme tarihi |
| `admin.symposium.certificates.status.ready` | Ready | Hazır |
| `admin.symposium.certificates.status.uploaded` | Uploaded | Yüklendi |
| `admin.symposium.certificates.status.compressFailed` | Could not shrink; original kept | Küçültülemedi; orijinal kullanılacak |
| `admin.symposium.certificates.problem.invalid_email` | Invalid email | Geçersiz e-posta |
| `admin.symposium.certificates.problem.invalid_kind` | Unknown type | Bilinmeyen tür |
| `admin.symposium.certificates.problem.missing_name` | Name missing | Ad eksik |
| `admin.symposium.certificates.problem.missing_file` | File not selected | Dosya seçilmedi |
| `admin.symposium.certificates.problem.duplicate` | Same person and type twice | Aynı kişi ve tür iki kez |
| `admin.symposium.certificates.problem.not_pdf` | Not a PDF | PDF değil |
| `admin.symposium.certificates.problem.too_large` | Over 10 MB after shrinking | Küçültmeden sonra 10 MB'tan büyük |
| `admin.symposium.certificates.csvError.empty` | The CSV is empty. | CSV boş. |
| `admin.symposium.certificates.csvError.missing_columns` | The CSV is missing columns: {columns} | CSV'de eksik sütunlar: {columns} |
| `admin.symposium.certificates.kind.participation` | Participation | Katılım |
| `admin.symposium.certificates.kind.workshop` | Workshop | Workshop |
| `admin.symposium.certificates.kind.presentation` | Presentation | Sunum |
| `admin.symposium.certificates.kind.appreciation` | Appreciation | Teşekkür |
| `admin.symposium.certificates.stored` | {count} certificates, {size} | {count} sertifika, {size} |
| `admin.symposium.certificates.none` | No certificates for this year. | Bu yıl için sertifika yok. |
| `admin.symposium.certificates.deleteAll` | Delete all for {year} | {year} için tümünü sil |
| `admin.symposium.certificates.deleteAllConfirm` | Type {year} to delete every certificate for that year. | O yılın bütün sertifikalarını silmek için {year} yazın. |
| `admin.symposium.certificates.delete` | Delete | Sil |

- [ ] **Step 3: Markup.** Append to `SymposiumPane.astro`, after the Committee `</section>`, a `<section id="symCertificates">` with: heading + intro (`text-xs text-gray-500`); a form `#symCertForm` holding `#symCertYear` (`type=number`, min 2012, max 2100), `#symCertCsv` (`type=file accept=".csv,text/csv"`), `#symCertPdfs` (`type=file accept="application/pdf,.pdf" multiple`), checkbox `#symCertRasterise` (checked), button `#symCertCheck` (`type=submit`); `#symCertCsvError` (hidden, `text-red-600 text-sm`); preview table `#symCertPreview` (hidden) with `<tbody id="symCertPreviewBody">` and columns email/name/kind/size/status; `#symCertUnused` (hidden); button `#symCertUpload` (hidden); `#symCertProgress` and `#symCertRebuildStatus` (hidden, `text-xs`); stored list: `#symCertSummary`, table `<tbody id="symCertListBody">` with columns email/name/kind/size/expires/actions, `#symCertEmpty`; a delete-all row with `#symCertDeleteAllInput` (text) and `#symCertDeleteAll` button (disabled until the input equals the year). Reuse the exact input/button classes from the Committee form above it. All labels via `t('admin.symposium.certificates.*')`.

- [ ] **Step 4: Compression** `src/scripts/pdf-compress.ts`:

```ts
/**
 * Makes a certificate PDF smaller in the organiser's browser before upload.
 * Workers on the free plan get 10 ms CPU per request, so this cannot happen
 * server-side. Never makes a file bigger and never throws: on any failure
 * the original bytes come back with the reason.
 */
export const RASTER_THRESHOLD = 1024 * 1024;
const DPI = 200;
const JPEG_QUALITY = 0.85;

export type Method = 'original' | 'lossless' | 'raster';

export async function compressPdf(
  input: ArrayBuffer,
  opts: { rasterise: boolean },
): Promise<{ bytes: Uint8Array; method: Method; error?: string }> {
  const original = new Uint8Array(input);
  let best: { bytes: Uint8Array; method: Method } = { bytes: original, method: 'original' };
  let error: string | undefined;
  try {
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(original);
    const saved = await doc.save({ useObjectStreams: true });
    if (saved.length < best.bytes.length) best = { bytes: saved, method: 'lossless' };
  } catch (err) {
    error = String(err).slice(0, 120);
  }
  if (opts.rasterise && best.bytes.length > RASTER_THRESHOLD) {
    try {
      const raster = await rasterise(original);
      if (raster.length < best.bytes.length) best = { bytes: raster, method: 'raster' };
    } catch (err) {
      error = String(err).slice(0, 120);
    }
  }
  return error && best.method === 'original' ? { ...best, error } : best;
}

async function rasterise(src: Uint8Array): Promise<Uint8Array> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  // getDocument transfers the buffer it is given, so hand it a copy.
  const pdf = await pdfjs.getDocument({ data: src.slice() }).promise;
  const { PDFDocument } = await import('pdf-lib');
  const out = await PDFDocument.create();
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const size = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: DPI / 72 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/jpeg', JPEG_QUALITY),
    );
    const jpg = await out.embedJpg(await blob.arrayBuffer());
    out.addPage([size.width, size.height]).drawImage(jpg, { x: 0, y: 0, width: size.width, height: size.height });
  }
  await pdf.destroy();
  return out.save({ useObjectStreams: true });
}
```

If TypeScript complains about the `?url` import, add `/// <reference types="vite/client" />` at the top of the file.

- [ ] **Step 5: Behaviour** `src/scripts/admin-certificates.ts`:

```ts
/**
 * The Certificates section of the symposium pane. Kept out of admin-panel.ts
 * (already 1600+ lines); that file hands in its helpers through CertDeps.
 */
import { parseCsv, planUpload, type PlannedRow } from '../lib/certificate-csv';
import { compressPdf, type Method } from './pdf-compress';

export interface CertDeps {
  t: (key: string) => string;
  tf: (key: string, vars: Record<string, string | number>) => string;
  showToast: (message: string, isError?: boolean) => void;
  showRebuildStatus: (elId: string, rebuild: { state?: 'started' | 'queued' | 'failed'; detail: string }) => void;
  formatDate: (ts: number) => string;
}

const MAX_BYTES = 10 * 1024 * 1024;
type Prepared = PlannedRow & {
  bytes?: Uint8Array; originalSize?: number; method?: Method; fileProblem?: 'not_pdf' | 'too_large';
  compressError?: string; uploaded?: boolean; uploadError?: string;
};

let deps: CertDeps;
let prepared: Prepared[] = [];
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 1024 * 1024 ? 2 : 1)} MB`;
const year = () => Number($<HTMLInputElement>('symCertYear').value);

function cell(text: string, cls = ''): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = `px-3 py-2 text-sm ${cls}`;
  td.textContent = text;
  return td;
}

function problemsOf(r: Prepared): string[] {
  const keys: string[] = [...r.problems];
  if (r.fileProblem) keys.push(r.fileProblem);
  return keys.map((k) => deps.t(`admin.symposium.certificates.problem.${k}`));
}

function renderPreview(unused: string[]): void {
  const body = $('symCertPreviewBody');
  body.replaceChildren();
  for (const r of prepared) {
    const tr = document.createElement('tr');
    const problems = problemsOf(r);
    const size = r.bytes && r.originalSize ? `${mb(r.originalSize)} → ${mb(r.bytes.length)}` : '';
    const status = r.uploaded ? deps.t('admin.symposium.certificates.status.uploaded')
      : r.uploadError ? r.uploadError
      : problems.length ? problems.join(', ')
      : r.compressError ? deps.t('admin.symposium.certificates.status.compressFailed')
      : deps.t('admin.symposium.certificates.status.ready');
    tr.append(
      cell(r.email), cell(r.name),
      cell(r.kind ? deps.t(`admin.symposium.certificates.kind.${r.kind}`) : r.type),
      cell(size),
      cell(status, problems.length || r.uploadError ? 'text-red-600' : r.uploaded ? 'text-green-700' : ''),
    );
    body.append(tr);
  }
  $('symCertPreview').classList.remove('hidden');
  const unusedEl = $('symCertUnused');
  unusedEl.textContent = unused.length ? deps.tf('admin.symposium.certificates.unused', { files: unused.join(', ') }) : '';
  unusedEl.classList.toggle('hidden', unused.length === 0);
  const ready = uploadable().length;
  const button = $<HTMLButtonElement>('symCertUpload');
  button.textContent = deps.tf('admin.symposium.certificates.upload', { count: ready });
  button.classList.toggle('hidden', ready === 0);
}

const uploadable = () => prepared.filter((r) => r.problems.length === 0 && !r.fileProblem && r.bytes && !r.uploaded);

async function check(): Promise<void> {
  const csvFile = $<HTMLInputElement>('symCertCsv').files?.[0];
  const pdfs = [...($<HTMLInputElement>('symCertPdfs').files ?? [])];
  const errorEl = $('symCertCsvError');
  errorEl.classList.add('hidden');
  if (!csvFile) return;
  const parsed = parseCsv(await csvFile.text());
  if ('error' in parsed) {
    errorEl.textContent = parsed.error === 'missing_columns'
      ? deps.tf('admin.symposium.certificates.csvError.missing_columns', { columns: (parsed.missing ?? []).join(', ') })
      : deps.t('admin.symposium.certificates.csvError.empty');
    errorEl.classList.remove('hidden');
    return;
  }
  const plan = planUpload(parsed.rows, pdfs.map((f) => f.name));
  const byName = new Map(pdfs.map((f) => [f.name, f]));
  const rasterise = $<HTMLInputElement>('symCertRasterise').checked;
  prepared = plan.rows.map((r) => ({ ...r }));
  renderPreview(plan.unusedFiles);
  for (const r of prepared) {
    if (r.problems.length) continue;
    const file = byName.get(r.file)!;
    const raw = await file.arrayBuffer();
    r.originalSize = raw.byteLength;
    if (new TextDecoder().decode(new Uint8Array(raw, 0, Math.min(5, raw.byteLength))) !== '%PDF-') {
      r.fileProblem = 'not_pdf';
    } else {
      const result = await compressPdf(raw, { rasterise });
      r.bytes = result.bytes;
      r.method = result.method;
      r.compressError = result.error;
      if (result.bytes.length > MAX_BYTES) r.fileProblem = 'too_large';
    }
    renderPreview(plan.unusedFiles);
  }
}

async function upload(): Promise<void> {
  const rows = uploadable();
  const progress = $('symCertProgress');
  progress.classList.remove('hidden');
  let ok = 0, failed = 0;
  for (const [i, r] of rows.entries()) {
    progress.textContent = deps.tf('admin.symposium.certificates.progress', { done: i, total: rows.length });
    try {
      const res = await fetch('/api/admin/certificates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/pdf',
          'X-Cert-Year': String(year()),
          'X-Cert-Email': r.email,
          'X-Cert-Name': encodeURIComponent(r.name),
          'X-Cert-Type': r.kind!,
        },
        body: r.bytes,
      });
      if (res.ok) { r.uploaded = true; ok++; }
      else { r.uploadError = ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`; failed++; }
    } catch (err) {
      r.uploadError = String(err).slice(0, 80);
      failed++;
    }
    renderPreview([]);
  }
  progress.textContent = deps.tf('admin.symposium.certificates.done', { ok, failed });
  if (ok > 0) await rebuild();
  await loadCertificates();
}

async function rebuild(): Promise<void> {
  const res = await fetch('/api/admin/certificates/rebuild', { method: 'POST' });
  if (res.ok) deps.showRebuildStatus('symCertRebuildStatus', ((await res.json()) as { rebuild: { state: 'started' | 'queued' | 'failed'; detail: string } }).rebuild);
}

export async function loadCertificates(): Promise<void> {
  const res = await fetch(`/api/admin/certificates?year=${year()}`);
  if (!res.ok) return;
  const { certificates, totalBytes } = (await res.json()) as {
    certificates: { id: string; email: string; name: string; kind: string; size_bytes: number; expires_at: number }[];
    totalBytes: number;
  };
  const body = $('symCertListBody');
  body.replaceChildren();
  for (const c of certificates) {
    const tr = document.createElement('tr');
    const actions = document.createElement('td');
    actions.className = 'px-3 py-2 text-right';
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'text-xs text-red-600 hover:underline';
    del.textContent = deps.t('admin.symposium.certificates.delete');
    del.addEventListener('click', async () => {
      const r = await fetch(`/api/admin/certificates/${c.id}`, { method: 'DELETE' });
      if (r.ok) { deps.showToast(deps.t('admin.toast.deleted')); await loadCertificates(); }
      else deps.showToast(`HTTP ${r.status}`, true);
    });
    actions.append(del);
    tr.append(cell(c.email), cell(c.name), cell(deps.t(`admin.symposium.certificates.kind.${c.kind}`)),
      cell(mb(c.size_bytes)), cell(deps.formatDate(c.expires_at)), actions);
    body.append(tr);
  }
  $('symCertEmpty').classList.toggle('hidden', certificates.length > 0);
  $('symCertSummary').textContent = deps.tf('admin.symposium.certificates.stored', { count: certificates.length, size: mb(totalBytes) });
  $('symCertDeleteAll').textContent = deps.tf('admin.symposium.certificates.deleteAll', { year: year() });
  $<HTMLInputElement>('symCertDeleteAllInput').placeholder = deps.tf('admin.symposium.certificates.deleteAllConfirm', { year: year() });
}

export function setupCertificates(d: CertDeps): void {
  deps = d;
  $<HTMLInputElement>('symCertYear').value = String(new Date().getFullYear());
  $('symCertForm').addEventListener('submit', (e) => { e.preventDefault(); void check(); });
  $('symCertUpload').addEventListener('click', () => void upload());
  $('symCertYear').addEventListener('change', () => void loadCertificates());
  const confirmInput = $<HTMLInputElement>('symCertDeleteAllInput');
  const deleteAll = $<HTMLButtonElement>('symCertDeleteAll');
  confirmInput.addEventListener('input', () => { deleteAll.disabled = confirmInput.value.trim() !== String(year()); });
  deleteAll.addEventListener('click', async () => {
    if (confirmInput.value.trim() !== String(year())) return;
    const res = await fetch(`/api/admin/certificates?year=${year()}`, { method: 'DELETE' });
    if (!res.ok) { deps.showToast(`HTTP ${res.status}`, true); return; }
    confirmInput.value = '';
    deleteAll.disabled = true;
    deps.showToast(deps.t('admin.toast.deleted'));
    await rebuild();
    await loadCertificates();
  });
}
```

- [ ] **Step 6: Wire it.** In `src/scripts/admin-panel.ts`: `import { setupCertificates, loadCertificates } from './admin-certificates';` at the top; inside `if (canEditSymposium) {` add `setupCertificates({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, showToast, showRebuildStatus, formatDate });` after `setupCommitteeForm();` and `await loadCertificates();` after `await loadCommittee();`. Then `npm run build` and `npx astro check` → no new errors.

- [ ] **Step 7: Browser test** `tests/browser/certificates-admin.mjs`, modelled on `tests/browser/committee-admin.mjs` (same server start, same `/api/me` stub with `is_symposium: true`). It must:
  1. Generate fixtures in a temp dir with `pdf-lib` from Node: `small.pdf` (one A4 page of text, < 100 KB), `big.pdf` (one page embedding a 3000×2000 noisy PNG made with a canvas-free byte buffer, > 1 MB), `broken.pdf` (`%PDF-1.7\n` followed by garbage), `notpdf.pdf` (`<html>`), and a CSV with five rows: `a@example.org,Ayşe Yılmaz,katılım,small.pdf`, `b@example.org,Ali,workshop,big.pdf`, `c@example.org,Can,sunum,broken.pdf`, `d@example.org,Deniz,teşekkür,notpdf.pdf`, `bad,Eda,poster,missing.pdf`, written with `;` and a BOM.
  2. Stub `GET /api/admin/certificates?year=*` (empty list), `POST /api/admin/certificates` (record each request's headers and body size; reply `{ok:true,id:'x',expiresAt:0,replaced:false}`), `POST /api/admin/certificates/rebuild` (`{ok:true,rebuild:{state:'started',detail:'rebuild started'}}`).
  3. Open `/admin/`, select the files, click Check, wait for the preview. Assert: row 1 Ready; row 2 shows a size arrow with the second number smaller than the first; row 3 Ready with "original kept"; row 4 "Not a PDF"; row 5 shows "Invalid email, Unknown type, File not selected"; the upload button says "Upload 3 certificates".
  4. Click Upload. Assert three POSTs, `X-Cert-Type` values `participation, workshop, presentation`, `decodeURIComponent(X-Cert-Name)` of the first is `Ayşe Yılmaz`, the second body is smaller than `big.pdf`, and exactly one rebuild POST.
  5. Repeat at 390×844 viewport: the section has no horizontal page scroll (`document.documentElement.scrollWidth <= 390`).
  Run: `node tests/browser/certificates-admin.mjs` → exits 0.

- [ ] **Step 8:** `npm test` → green. **Commit** — "Certificates: admin pane with CSV check, compression and upload".

---

### Task 7: Symposium site — status, band, i18n

**Files:**
- Create: `symposium_website/src/lib/certificates.ts`, `symposium_website/src/components/CertificatesBand.astro`
- Modify: `symposium_website/src/i18n/ui.ts`, `symposium_website/src/pages/index.astro`, `symposium_website/src/pages/tr/index.astro`
- Test: `symposium_website/tests/certificates.test.ts`

**Interfaces — Produces:**
```ts
export interface CertStatus { years: { year: number; count: number; expiresAt: number }[] }
export async function fetchCertificateStatus(apiBase: string, fetcher?: typeof fetch): Promise<CertStatus>; // never throws; {years: []} on any failure
export function bandYear(status: CertStatus): number | null;  // newest year with count > 0
export function apiBase(): string;  // import.meta.env.PUBLIC_API_BASE ?? 'https://rsg-turkiye.iscbsc.org'
export function formatExpiry(epochSeconds: number, lang: 'en' | 'tr'): string; // '12 November 2026' / '12 Kasım 2026', Europe/Istanbul
export function kindLabelKey(kind: string): 'cert.kind.participation' | 'cert.kind.workshop' | 'cert.kind.presentation' | 'cert.kind.appreciation' | null;
```

- [ ] **Step 1: i18n keys** in `symposium_website/src/i18n/ui.ts`, both languages:

| key | en | tr |
|---|---|---|
| `cert.title` | Certificates | Sertifikalar |
| `cert.subtitle` | Enter the email address you registered with. | Kayıt olurken kullandığın e-posta adresini gir. |
| `cert.email` | Email address | E-posta adresi |
| `cert.submit` | Find my certificates | Sertifikalarımı bul |
| `cert.searching` | Searching… | Aranıyor… |
| `cert.none` | No certificate found for this address. It may have passed its 30 days. Write to turkey.rsg@gmail.com and we will send it. | Bu adrese ait sertifika bulunamadı. 30 günlük süresi dolmuş olabilir. turkey.rsg@gmail.com adresine yaz, sana gönderelim. |
| `cert.invalid` | Please enter a valid email address. | Lütfen geçerli bir e-posta adresi gir. |
| `cert.rateLimited` | Too many attempts. Please try again in ten minutes. | Çok fazla deneme yapıldı. Lütfen on dakika sonra tekrar dene. |
| `cert.error` | Something went wrong. Please try again later. | Bir sorun oluştu. Lütfen daha sonra tekrar dene. |
| `cert.open` | View | Görüntüle |
| `cert.notice.title` | Before you open it | Açmadan önce |
| `cert.notice.body` | This certificate and your email address will be deleted from our system on {date}. Please download the PDF. After that date, write to turkey.rsg@gmail.com if you need it. | Bu sertifika ve e-posta adresin {date} tarihinde sistemimizden silinecek. Lütfen PDF'i indir. Bu tarihten sonra ihtiyacın olursa turkey.rsg@gmail.com adresine yaz. |
| `cert.notice.ok` | I understand | Anladım |
| `cert.notice.cancel` | Cancel | Vazgeç |
| `cert.download` | Download PDF | PDF'i indir |
| `cert.viewerTitle` | Certificate | Sertifika |
| `cert.gone` | This certificate is no longer available. Write to turkey.rsg@gmail.com. | Bu sertifika artık mevcut değil. turkey.rsg@gmail.com adresine yaz. |
| `cert.band.text` | Certificates for the {year} symposium are ready. | {year} sempozyumunun sertifikaları hazır. |
| `cert.band.button` | View your certificate | Sertifikanı görüntüle |
| `cert.kind.participation` | Participation | Katılım |
| `cert.kind.workshop` | Workshop | Workshop |
| `cert.kind.presentation` | Presentation | Sunum |
| `cert.kind.appreciation` | Appreciation | Teşekkür |

- [ ] **Step 2: Failing tests** `symposium_website/tests/certificates.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchCertificateStatus, bandYear, formatExpiry, kindLabelKey } from '../src/lib/certificates';
import { ui } from '../src/i18n/ui';

test('status is read and the newest year with certificates gets the band', async () => {
  const fake = (async () => new Response(JSON.stringify({ years: [{ year: 2026, count: 3, expiresAt: 1 }, { year: 2025, count: 1, expiresAt: 1 }] }))) as typeof fetch;
  const s = await fetchCertificateStatus('https://api', fake);
  assert.equal(bandYear(s), 2026);
});

test('any failure means no band, never a failed build', async () => {
  const cases: (typeof fetch)[] = [
    (async () => { throw new Error('offline'); }) as typeof fetch,
    (async () => new Response('nope', { status: 500 })) as typeof fetch,
    (async () => new Response('not json')) as typeof fetch,
    (async () => new Response(JSON.stringify({ years: 'x' }))) as typeof fetch,
  ];
  for (const f of cases) assert.equal(bandYear(await fetchCertificateStatus('https://api', f)), null);
});

test('expiry dates read naturally in both languages, in Istanbul time', () => {
  const ts = Date.UTC(2026, 10, 11, 22, 30) / 1000; // 01:30 on 12 Nov in Istanbul
  assert.equal(formatExpiry(ts, 'en'), '12 November 2026');
  assert.equal(formatExpiry(ts, 'tr'), '12 Kasım 2026');
});

test('kind labels exist for the four kinds only', () => {
  for (const k of ['participation', 'workshop', 'presentation', 'appreciation']) {
    const key = kindLabelKey(k)!;
    assert.ok(ui.en[key] && ui.tr[key], k);
  }
  assert.equal(kindLabelKey('toString'), null);
});

test('every cert.* key exists in both languages', () => {
  const en = Object.keys(ui.en).filter((k) => k.startsWith('cert.'));
  const tr = Object.keys(ui.tr).filter((k) => k.startsWith('cert.'));
  assert.deepEqual(en.sort(), tr.sort());
});
```

- [ ] **Step 3: Run** `cd symposium_website && node --import tsx --test tests/certificates.test.ts` → FAIL. **Step 4: Implement** `symposium_website/src/lib/certificates.ts`:

```ts
/**
 * Certificates on the symposium site. The data lives on the main site; this
 * page asks for it from the browser (lookup) and at build time (status).
 */
export interface CertStatus { years: { year: number; count: number; expiresAt: number }[] }

export function apiBase(): string {
  return import.meta.env.PUBLIC_API_BASE ?? 'https://rsg-turkiye.iscbsc.org';
}

/** Never throws: a missing band is better than a failed build, and the page
 * itself still works without it. */
export async function fetchCertificateStatus(base: string, fetcher: typeof fetch = fetch): Promise<CertStatus> {
  try {
    const res = await fetcher(`${base}/api/certificates/status`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = (await res.json()) as CertStatus;
    if (!Array.isArray(data?.years)) throw new Error('bad shape');
    return { years: data.years.filter((y) => Number.isInteger(y?.year) && y.count > 0) };
  } catch (err) {
    console.warn(`[certificates] status unavailable, no band: ${String(err).slice(0, 120)}`);
    return { years: [] };
  }
}

export function bandYear(status: CertStatus): number | null {
  return status.years.reduce<number | null>((max, y) => (max === null || y.year > max ? y.year : max), null);
}

export function formatExpiry(epochSeconds: number, lang: 'en' | 'tr'): string {
  return new Date(epochSeconds * 1000).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Istanbul',
  });
}

const KIND_KEYS = {
  participation: 'cert.kind.participation',
  workshop: 'cert.kind.workshop',
  presentation: 'cert.kind.presentation',
  appreciation: 'cert.kind.appreciation',
} as const;

export function kindLabelKey(kind: string): (typeof KIND_KEYS)[keyof typeof KIND_KEYS] | null {
  return Object.hasOwn(KIND_KEYS, kind) ? KIND_KEYS[kind as keyof typeof KIND_KEYS] : null;
}
```

- [ ] **Step 5: Band component** `symposium_website/src/components/CertificatesBand.astro`:

```astro
---
// Build time. Shown while any year has unexpired certificates; the nightly
// purge + rebuild removes it on the day the last one goes. Independent of the
// hero's edition state, because that changes the night the symposium ends.
import { useTranslations, useFormat, type Lang } from "../i18n/ui";
import { apiBase, bandYear, fetchCertificateStatus } from "../lib/certificates";

interface Props { lang: Lang }
const { lang } = Astro.props;
const t = useTranslations(lang);
const tf = useFormat(lang);
const year = bandYear(await fetchCertificateStatus(apiBase()));
const href = lang === "tr" ? "/tr/certificates/" : "/certificates/";
---
{year !== null && (
  <section class="bg-red/10 border-b border-red/20">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex flex-col sm:flex-row items-center justify-center gap-3 text-center">
      <p class="text-navy font-medium">{tf("cert.band.text", { year })}</p>
      <a href={href} class="px-5 py-2 rounded-lg bg-red text-white text-sm font-semibold hover:bg-red/90 transition-colors">{t("cert.band.button")}</a>
    </div>
  </section>
)}
```

Check `useFormat`'s signature in `src/i18n/ui.ts` (around line 345) and adapt the call if it takes `(key, vars)` differently.

- [ ] **Step 6: Place it.** In `src/pages/index.astro` and `src/pages/tr/index.astro`, import `CertificatesBand` and render `<CertificatesBand lang={lang} />` immediately after the hero `</section>` (before `<!-- ── About`).
- [ ] **Step 7: Run** the new test and the whole symposium suite → green; `npm run build` in `symposium_website` → succeeds (with no API reachable it logs the warning and builds without the band).
- [ ] **Step 8: Commit** — "Symposium site: certificates band and helpers".

---

### Task 8: Symposium site — the certificates page

**Files:**
- Create: `symposium_website/src/components/CertificateLookup.astro`, `symposium_website/src/pages/certificates.astro`, `symposium_website/src/pages/tr/certificates.astro`, `tests/browser/certificates-page.mjs`

**Interfaces — Consumes:** Task 3 HTTP contract; Task 7 `apiBase`, `formatExpiry` (re-implemented in the client script via `Intl` with the same options, because the script runs in the browser), i18n keys.

- [ ] **Step 1: Pages.** `src/pages/certificates.astro`:

```astro
---
import BaseLayout from "../layouts/BaseLayout.astro";
import CertificateLookup from "../components/CertificateLookup.astro";
import { useTranslations, getLangFromUrl } from "../i18n/ui";

const lang = getLangFromUrl(Astro.url);
const t = useTranslations(lang);
---
<BaseLayout pageTitle={t("cert.title")}>
  <section class="bg-navy text-white py-16">
    <div class="max-w-7xl mx-auto px-6 text-center">
      <h1 class="text-3xl sm:text-4xl font-bold mb-3">{t("cert.title")}</h1>
      <p class="text-white/70 text-lg">{t("cert.subtitle")}</p>
    </div>
  </section>
  <CertificateLookup lang={lang} />
</BaseLayout>
```

`src/pages/tr/certificates.astro`: identical except imports use `../../`.

- [ ] **Step 2: Component** `src/components/CertificateLookup.astro`. Markup (all text from `t(...)`), then a module `<script>`:

```astro
---
import { useTranslations, type Lang } from "../i18n/ui";
import { apiBase } from "../lib/certificates";

interface Props { lang: Lang }
const { lang } = Astro.props;
const t = useTranslations(lang);
const strings = {
  searching: t("cert.searching"), none: t("cert.none"), invalid: t("cert.invalid"),
  rateLimited: t("cert.rateLimited"), error: t("cert.error"), open: t("cert.open"),
  noticeBody: t("cert.notice.body"), download: t("cert.download"), gone: t("cert.gone"),
  submit: t("cert.submit"),
  kinds: {
    participation: t("cert.kind.participation"), workshop: t("cert.kind.workshop"),
    presentation: t("cert.kind.presentation"), appreciation: t("cert.kind.appreciation"),
  },
};
---
<section class="max-w-3xl mx-auto px-4 sm:px-6 py-12" id="certRoot"
  data-api={apiBase()} data-lang={lang} data-strings={JSON.stringify(strings)}>
  <form id="certForm" class="flex flex-col sm:flex-row gap-3" novalidate>
    <label for="certEmail" class="sr-only">{t("cert.email")}</label>
    <input id="certEmail" type="email" autocomplete="email" required placeholder={t("cert.email")}
      class="flex-1 px-4 py-3 rounded-lg border border-gray-300 text-navy focus:outline-none focus-visible:outline-2 focus-visible:outline-navy" />
    <button id="certSubmit" type="submit" class="px-6 py-3 rounded-lg bg-red text-white font-semibold hover:bg-red/90">{t("cert.submit")}</button>
  </form>
  <p id="certMessage" class="mt-4 text-sm text-gray-700 hidden" role="status" aria-live="polite"></p>
  <ul id="certResults" class="mt-6 grid gap-3"></ul>

  <div id="certViewer" class="mt-8 hidden">
    <a id="certDownload" class="inline-block mb-3 px-5 py-2 rounded-lg bg-navy text-white text-sm font-semibold" href="#">{t("cert.download")}</a>
    <iframe id="certFrame" title={t("cert.viewerTitle")} class="w-full h-[75vh] rounded-lg border border-gray-200 bg-white"></iframe>
  </div>

  <dialog id="certNotice" class="rounded-xl p-6 max-w-md w-[calc(100%-2rem)] backdrop:bg-black/50">
    <h2 class="text-lg font-semibold text-navy mb-3">{t("cert.notice.title")}</h2>
    <p id="certNoticeBody" class="text-sm text-gray-700 mb-5"></p>
    <form method="dialog" class="flex justify-end gap-3">
      <button value="cancel" class="px-4 py-2 rounded-lg border border-gray-300 text-sm">{t("cert.notice.cancel")}</button>
      <button value="ok" id="certNoticeOk" class="px-4 py-2 rounded-lg bg-red text-white text-sm font-semibold">{t("cert.notice.ok")}</button>
    </form>
  </dialog>
</section>

<script>
  type Cert = { id: string; year: number; kind: string; name: string; expiresAt: number; url: string };
  const root = document.getElementById("certRoot")!;
  const api = root.dataset.api!;
  const lang = root.dataset.lang === "tr" ? "tr" : "en";
  const s = JSON.parse(root.dataset.strings!) as Record<string, string> & { kinds: Record<string, string> };
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const message = $("certMessage"), results = $("certResults"), viewer = $("certViewer");
  const notice = $<HTMLDialogElement>("certNotice");
  let pending: Cert | null = null;

  const say = (text: string) => { message.textContent = text; message.classList.toggle("hidden", !text); };
  const expiry = (ts: number) => new Date(ts * 1000).toLocaleDateString(lang === "tr" ? "tr-TR" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });

  function render(certs: Cert[]) {
    results.replaceChildren();
    for (const c of certs) {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between gap-3 p-4 rounded-lg border border-gray-200";
      const text = document.createElement("div");
      const title = document.createElement("p");
      title.className = "font-semibold text-navy";
      title.textContent = `${c.year} · ${s.kinds[c.kind] ?? c.kind}`;
      const who = document.createElement("p");
      who.className = "text-sm text-gray-600";
      who.textContent = c.name;
      text.append(title, who);
      const open = document.createElement("button");
      open.type = "button";
      open.className = "px-4 py-2 rounded-lg bg-navy text-white text-sm font-semibold";
      open.textContent = s.open;
      open.addEventListener("click", () => {
        pending = c;
        $("certNoticeBody").textContent = s.noticeBody.replace("{date}", expiry(c.expiresAt));
        notice.showModal();
      });
      li.append(text, open);
      results.append(li);
    }
  }

  notice.addEventListener("close", async () => {
    if (notice.returnValue !== "ok" || !pending) return;
    const c = pending;
    // The certificate may have expired since the lookup (a page left open
    // overnight): check before framing, or the iframe shows a bare 404.
    const head = await fetch(c.url, { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) { viewer.classList.add("hidden"); say(s.gone); return; }
    say("");
    $<HTMLAnchorElement>("certDownload").href = `${c.url}?download=1`;
    $<HTMLIFrameElement>("certFrame").src = c.url;
    viewer.classList.remove("hidden");
    viewer.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  $("certForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $<HTMLInputElement>("certEmail").value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say(s.invalid); return; }
    const button = $<HTMLButtonElement>("certSubmit");
    button.disabled = true;
    button.textContent = s.searching;
    viewer.classList.add("hidden");
    results.replaceChildren();
    try {
      // text/plain keeps this a "simple" request: no CORS preflight, so one
      // Function invocation per lookup instead of two.
      const res = await fetch(`${api}/api/certificates/lookup`, {
        method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ email }),
      });
      if (res.status === 429) { say(s.rateLimited); return; }
      if (res.status === 400) { say(s.invalid); return; }
      if (!res.ok) { say(s.error); return; }
      const { certificates } = (await res.json()) as { certificates: Cert[] };
      say(certificates.length ? "" : s.none);
      render(certificates);
    } catch {
      say(s.error);
    } finally {
      button.disabled = false;
      button.textContent = s.submit;
    }
  });
</script>
```

The HEAD from the symposium origin to the main site needs CORS on the file route: add `corsHeaders(request)` to the `[file].ts` response headers (both the 200 and the 404 paths) and a test asserting `Access-Control-Allow-Origin` on a HEAD with `Origin: https://symposium.rsg-turkiye.iscbsc.org` in `tests/certificates-public.test.ts`. Commit that with this task.

- [ ] **Step 3: Run the symposium suite** (`hreflang`, `sitemap`, `internal-links-canonical`, `seo`, `type-check` must stay green; if `sitemap.test.ts` enumerates expected pages, add `/certificates/` and `/tr/certificates/` there). `npm run build` → `dist/certificates/index.html` and `dist/tr/certificates/index.html` exist.

- [ ] **Step 4: Browser test** `tests/browser/certificates-page.mjs`: build and preview `symposium_website` with `PUBLIC_API_BASE=http://127.0.0.1:8799`, and serve a tiny Node `http` server on 8799 that answers: `POST /api/certificates/lookup` → for `ayse@example.org` two certificates (one with an `id` whose file route returns 404 for HEAD), for `limit@example.org` 429, otherwise `[]`; `HEAD|GET /api/certificates/<id>.pdf` → a one-page PDF (generated with pdf-lib) with `Access-Control-Allow-Origin: *`. Assert, at 1280×800 and at 390×844:
  1. Empty email or `x` → "valid email" message, no request made.
  2. `nobody@example.org` → the 30-days / turkey.rsg@gmail.com message.
  3. `limit@example.org` → the ten-minutes message.
  4. `AYSE@example.org` → two cards with Turkish kind labels on `/tr/certificates/`; clicking View opens the dialog whose text contains the formatted date and `turkey.rsg@gmail.com`; Cancel leaves the viewer hidden; I understand shows the viewer, the iframe `src` equals the URL and the download link ends with `?download=1`.
  5. The card whose HEAD 404s → "no longer available" message, viewer hidden.
  6. At 390 px: `document.documentElement.scrollWidth <= 390`.
  Run `node tests/browser/certificates-page.mjs` → exits 0.

- [ ] **Step 5: Commit** — "Symposium site: certificates page with notice dialog and viewer".

---

### Task 9: Docs, setup steps, final verification

**Files:** Modify `README.md`, `docs/superpowers/specs/2026-10-11-symposium-certificates-design.md`.

- [ ] **Step 1: README.** Add a "Symposium certificates" section after the symposium-cron section, with these setup steps verbatim:
  1. Apply the tables: `npx wrangler d1 execute rsg-members --remote --file=db/schema.sql` (note 7l).
  2. R2 lifecycle rule on bucket `rsg-mail-attachments`: Cloudflare dashboard → R2 → `rsg-mail-attachments` → Settings → Object lifecycle rules → Add rule: prefix `certificates/`, delete objects 31 days after upload.
  3. WAF rate limiting (free plan allows one rule): Security → WAF → Rate limiting rules → Create: "URI Path starts with `/api/certificates/`", counting by IP, period 10 seconds, requests 20, action Block/Managed Challenge as offered.
  4. Redeploy the cron Worker so it has `PURGE_URL`: `cd workers/symposium-cron && npx wrangler deploy`.
  5. Organisers: CSV columns `email,name,type,file`; types `participation|workshop|presentation|appreciation` or `katılım|workshop|sunum|teşekkür`; PDFs only; everything is deleted 30 days after upload.
- [ ] **Step 2: Spec.** In the spec's "Admin API" section, change the paths to `/api/admin/certificates…` and add one sentence: under `/api/admin/symposium/` they would compete with the existing dynamic `[kind].ts` route. Change `uploaded_by INTEGER` to `uploaded_by TEXT` in the schema block (user ids are UUID strings).
- [ ] **Step 3: Full verification.** `npm test` (root) and `npm test` (symposium_website) green; `npm run build` in both; both browser tests exit 0; `npx wrangler pages dev dist` at root, then `curl -s -X POST http://127.0.0.1:8788/api/certificates/lookup -H 'Origin: https://symposium.rsg-turkiye.iscbsc.org' --data '{"email":"x@example.org"}'` returns `{"certificates":[]}` with the CORS header (requires a local D1 with the schema applied: `npx wrangler d1 execute rsg-members --local --file=db/schema.sql`).
- [ ] **Step 4: Commit** — "Certificates: setup documentation". Open the PR against `main` with the setup steps in its body. Production verification (a real upload and lookup with organisers' own addresses, signed in, in a browser) happens after deploy and is reported separately.
