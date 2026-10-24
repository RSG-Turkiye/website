/**
 * Panel CMS drafts: what a draft may contain, which files it writes, and
 * which status may follow which. No database or GitHub calls here; the
 * endpoints under functions/api/cms do those.
 *
 * A draft's `base_shas` is its file list: every path it writes, mapped to the
 * blob sha that path had on main when the draft started (null for a file the
 * draft creates). Approval compares them with main again, and filesFor writes
 * exactly those paths, so an existing webinar pair whose two files have
 * different names is written back to the same two files.
 */

import type { CmsType } from '../../src/lib/cms/types';
import { checkId, cmsType } from '../../src/lib/cms/types';
import { jsonPath, markdownPairPaths, serializeJson, serializeMarkdown, type Frontmatter } from '../../src/lib/cms/serialize';

export type DraftStatus = 'draft' | 'submitted' | 'approved' | 'pr_open' | 'pr_failed' | 'merged' | 'published' | 'rejected' | 'discarded';
export type DraftAction = 'create' | 'update' | 'delete';
export const DRAFT_ACTIONS: readonly DraftAction[] = ['create', 'update', 'delete'];

export interface DraftRow {
  id: string;
  type: string;
  entry_id: string;
  action: DraftAction;
  data: string;
  base_shas: string;
  status: DraftStatus;
  author_id: string;
  reviewer_id: string | null;
  review_note: string | null;
  pr_url: string | null;
  pr_number: number | null;
  failure: string | null;
  /** A fresh random value on every write. A write names the nonce it read
   * (so it acts on the row it saw) and proves its own landed. */
  write_nonce: string | null;
  /** When the PR shepherd last looked at it (cms-shepherd.ts). Bookkeeping
   * only: it changes neither updated_at nor write_nonce. */
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
  /** Not a column: the author's profile display name, where a query joined it. */
  author_name?: string | null;
}

/** One language of a webinar. `source` is the original frontmatter text,
 * set by the server from main and never taken from the client. */
export interface MarkdownSide { frontmatter: Frontmatter; body: string; source?: string }
export type PairData = { en: MarkdownSide; tr: MarkdownSide };

// ── Transitions ───────────────────────────────────────────────────────────────

/**
 * Which statuses each step starts from. Saving keeps the status: a draft sent
 * back stays `rejected`, with its note, and one whose pull request failed
 * stays `pr_failed`, with its reason, until it is submitted again, which
 * clears both. `approved` is the moment between the approval and the pull
 * request opening; a draft left there by a crash may be approved again once
 * it is older than STALE_APPROVAL_SECONDS (openContentPR finds the branch and
 * pull request the first attempt made).
 */
export const TRANSITIONS = {
  save: ['draft', 'rejected', 'pr_failed'],
  submit: ['draft', 'rejected', 'pr_failed'],
  /** From `merged` only by an approver (the endpoint checks): the way out
   * when the site never shows a merged change. From `approved` only by an
   * approver and only once it is stale: an approval that crashed half way. */
  discard: ['draft', 'submitted', 'rejected', 'pr_failed', 'merged', 'approved'],
  reject: ['submitted'],
  approve: ['submitted'],
  /** An approver closes the pull request on purpose (→ pr_failed, 'cancelled'). */
  cancel: ['pr_open'],
} as const satisfies Record<string, readonly DraftStatus[]>;

/*
 * After the pull request opens, the PR shepherd (cms-shepherd.ts) moves the
 * draft on: pr_open → merged when GitHub merged it, merged → published once
 * the deployed site's /cms-index.json shows its files, or pr_open →
 * pr_failed with a short reason.
 */

export const STALE_APPROVAL_SECONDS = 300;

/**
 * A draft in one of these holds its entry: another draft of the same
 * (type, entry_id) may not be submitted meanwhile, or two full-file rewrites
 * could race and the later one undo the earlier. `merged` counts too: its
 * change is on main but not yet on the site.
 */
export const LIVE_STATUSES: readonly DraftStatus[] = ['submitted', 'approved', 'pr_open', 'merged'];

/** pr_open longer than this (checks pending, or GitHub still 'unknown' or
 * 'blocked') ends in pr_failed. Measured from updated_at, which only a
 * status change moves. */
export const PR_OPEN_MAX_SECONDS = 6 * 3600;

/** merged longer than this: the deploy did not show up. The draft stays
 * `merged` (it is never called published without the site showing it) and
 * the panel says so. */
export const MERGED_STALE_SECONDS = 2 * 3600;

/** merged longer than this: the shepherd gives up waiting for the site and
 * sets pr_failed (FAILURE.notLive), which frees the entry. */
export const MERGED_NOT_LIVE_SECONDS = 24 * 3600;

/** Drafts that are finished (published, discarded) and older than this are
 * deleted on the hourly tick. The activity log keeps their history.
 * pr_failed and rejected drafts (sent back: the author's work in progress)
 * are left alone. */
export const DRAFT_RETENTION_SECONDS = 90 * 86400;

/** The short reasons the shepherd and the cancel action store in `failure`. */
export const FAILURE = {
  closed: 'closed on GitHub',
  conflict: 'conflicts with a newer change; start a new draft',
  timeout: 'checks did not finish',
  cancelled: 'cancelled',
  blocked: 'blocked by branch protection',
  notLive: 'merged but the site never showed it',
  noPr: 'no pull request on record',
  /** GitHub kept failing to answer about the pull request for 2 × PR_OPEN_MAX_SECONDS. */
  noAnswer: 'GitHub did not answer',
  check: (name: string) => `check failed: ${name}`,
} as const;

// What the panel shows for each status lives in src/i18n/ui.ts
// (admin.cms.status.*), with the rest of the panel's words.

/** Whether a merged draft has waited for the site longer than MERGED_STALE_SECONDS. */
export function mergedTooLong(row: Pick<DraftRow, 'status' | 'updated_at'>, now: number): boolean {
  return row.status === 'merged' && now - row.updated_at > MERGED_STALE_SECONDS;
}

export function canTransition(step: keyof typeof TRANSITIONS, status: DraftStatus): boolean {
  return (TRANSITIONS[step] as readonly DraftStatus[]).includes(status);
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Field path (dots, as the form names them) → message. '' is the whole entry. */
export type FieldErrors = Record<string, string>;
export type Validated<T = unknown> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** The first message per field. Own-property test: on a plain object
 * `errors['constructor']` is Object.prototype's, so `??=` would skip it. */
function setOnce(into: FieldErrors, key: string, message: string): void {
  // defineProperty, not assignment: `into['__proto__'] = ...` would call the setter.
  if (!Object.hasOwn(into, key)) Object.defineProperty(into, key, { value: message, enumerable: true, writable: true, configurable: true });
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type Issue = { path: PropertyKey[]; message: string; code?: string; keys?: string[]; minimum?: unknown };

/**
 * How strictly a draft is checked. `strict` (submit, approve): the full
 * schema. `lenient` (save, autosave, starting a draft): the same, except that
 * a value that is missing or empty is not an error yet, so work in progress
 * can be kept. Unknown keys, wrong types and malformed values are refused
 * either way.
 */
export type CheckMode = 'strict' | 'lenient';

/** The input value an issue is about. */
function valueAt(data: unknown, path: PropertyKey[]): unknown {
  let v = data;
  for (const k of path) {
    if (v === null || typeof v !== 'object' || !Object.hasOwn(v, k as string)) return undefined;
    v = (v as Record<PropertyKey, unknown>)[k];
  }
  return v;
}

/** An issue that only says the value is not there yet: missing, or an empty text. */
function onlyIncomplete(issue: Issue, data: unknown): boolean {
  const v = valueAt(data, issue.path);
  if (v === undefined) return issue.code !== 'unrecognized_keys';
  return v === '' && (issue.code === 'too_small' || issue.code === 'invalid_format');
}

function issuesToErrors(issues: Issue[], prefix: string, into: FieldErrors, mode: CheckMode = 'strict', data?: unknown): void {
  for (const issue of issues) {
    if (mode === 'lenient' && onlyIncomplete(issue, data)) continue;
    const at = [prefix, ...issue.path.map(String)].filter((s) => s !== '').join('.');
    if (issue.code === 'unrecognized_keys' && issue.keys) {
      for (const k of issue.keys) setOnce(into, at ? `${at}.${k}` : k, 'Unknown field');
    } else {
      setOnce(into, at, issue.message);
    }
  }
}

type ZodDef = { type: string; innerType?: unknown; in?: unknown; element?: unknown; shape?: Record<string, unknown> };
const defOf = (schema: unknown): ZodDef | undefined => (schema as { _zod?: { def: ZodDef } } | undefined)?._zod?.def;

/** The schema under optional/default/nullable/pipe wrappers. */
function unwrap(schema: unknown): unknown {
  let s = schema;
  for (let def = defOf(s); def; def = defOf(s)) {
    if (def.innerType) s = def.innerType;
    else if (def.type === 'pipe' && def.in) s = def.in;
    else break;
  }
  return s;
}

/**
 * Every key, at every level, that is not one of its object schema's own
 * shape keys. Checked before zod, with Object.hasOwn: an `in` test lets
 * `constructor`, `toString` and `__proto__` through, and they would be
 * stored and written to the file.
 */
function unknownKeys(schema: unknown, value: unknown, at: string, into: FieldErrors): void {
  const def = defOf(unwrap(schema));
  if (!def) return;
  if (Array.isArray(value)) {
    if (def.type === 'array') value.forEach((v, i) => unknownKeys(def.element, v, at ? `${at}.${i}` : String(i), into));
    return;
  }
  if (!isObject(value) || def.type !== 'object' || !def.shape) return;
  for (const k of Object.keys(value)) {
    const path = at ? `${at}.${k}` : k;
    if (!Object.hasOwn(def.shape, k)) setOnce(into, path, 'Unknown field');
    else unknownKeys(def.shape[k], value[k], path, into);
  }
}

// ── House rules: what the content tests refuse, refused at submit ─────────────

/** The em dash, written as an escape: tests/no-em-dashes.test.ts bans the character in every reader-facing file. */
const EM_DASH = '\u2014';
/** Two hyphens between words: shown as they are in frontmatter, turned into an em dash in a Markdown body. */
const SPACED_DOUBLE_HYPHEN = /\w\s--\s\w/;

export const EM_DASH_MESSAGE = 'Em dash (\u2014) is not used: write a hyphen (-) or a comma';
export const NO_AT_MESSAGE = 'No e-mail addresses: an @ cannot be in this file';

/** A Markdown body without its code, where a dash or an @ is code, not prose. */
const prose = (body: string) => body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '').replace(/`[^`\n]*`/g, '');

/**
 * Every string in the data, with its path as the form names fields
 * (`links.0.label.en`, `en.frontmatter.title`, `en.body`). A pair side's
 * `source` is the server's copy of main, not something the draft writes.
 */
function eachString(type: CmsType, data: unknown, visit: (path: string, text: string) => void): void {
  const walk = (v: unknown, at: string) => {
    if (typeof v === 'string') visit(at, at.endsWith('.body') && type.format === 'markdown-pair' ? prose(v) : v);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, at ? `${at}.${i}` : String(i)));
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) {
      if (type.format === 'markdown-pair' && (at === 'en' || at === 'tr') && k === 'source') continue;
      walk(x, at ? `${at}.${k}` : k);
    }
  };
  walk(data, '');
}

/**
 * What the repository's own tests would refuse once the file is on main:
 * an em dash anywhere (tests/no-em-dashes.test.ts scans src/content, and a
 * spaced `--` reaches the reader as one), and, for a type whose files are
 * profiles (`noAt`), an @, the test's own rule for e-mail addresses
 * (tests/content-committees.test.ts). Checked at submit and approval, so a
 * merged panel edit can never fail CI on main.
 */
export function houseRuleErrors(type: CmsType, data: unknown): FieldErrors {
  const errors: FieldErrors = {};
  eachString(type, data, (path, text) => {
    if (text.includes(EM_DASH) || SPACED_DOUBLE_HYPHEN.test(text)) setOnce(errors, path, EM_DASH_MESSAGE);
    else if (type.noAt && text.includes('@')) setOnce(errors, path, NO_AT_MESSAGE);
  });
  return errors;
}

/**
 * The entry checked against its type's zod schema. On success `data` is the
 * input as written to the file (not zod's output, which would turn dates into
 * Dates and add defaults the file never had), trimmed to the known shape for
 * webinars.
 */
export function validateDraft(type: CmsType, data: unknown, mode: CheckMode = 'strict'): Validated {
  const errors: FieldErrors = {};
  if (type.format === 'json') {
    if (!isObject(data)) return { ok: false, errors: { '': 'The entry must be an object' } };
    unknownKeys(type.schema, data, '', errors);
    const r = type.schema.safeParse(data);
    if (!r.success) issuesToErrors(r.error.issues as Issue[], '', errors, mode, data);
    if (mode === 'strict') for (const [k, m] of Object.entries(houseRuleErrors(type, data))) setOnce(errors, k, m);
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
  }

  if (!isObject(data)) return { ok: false, errors: { '': 'The entry must have an English and a Turkish side' } };
  const out: Partial<PairData> = {};
  for (const lang of ['en', 'tr'] as const) {
    const side = data[lang];
    if (!isObject(side) || !isObject(side.frontmatter)) { errors[lang] = 'Missing'; continue; }
    if (typeof side.body !== 'string') errors[`${lang}.body`] = 'Must be text';
    unknownKeys(type.schema, side.frontmatter, `${lang}.frontmatter`, errors);
    const r = type.schema.safeParse(side.frontmatter);
    if (!r.success) issuesToErrors(r.error.issues as Issue[], `${lang}.frontmatter`, errors, mode, side.frontmatter);
    const declared = side.frontmatter.lang;
    if (declared !== undefined && declared !== lang) setOnce(errors, `${lang}.frontmatter.lang`, `Must be "${lang}" or left out`);
    out[lang] = { frontmatter: side.frontmatter, body: String(side.body ?? '') };
  }
  // Pairs are tied by translationKey when it is set (src/lib/translations.ts):
  // two different keys would split the pair on the site.
  if (out.en && out.tr) {
    const key = (side: MarkdownSide) => String(side.frontmatter.translationKey ?? '').trim();
    if (key(out.en) !== key(out.tr)) setOnce(errors, 'tr.frontmatter.translationKey', 'Must be the same as the English side');
  }
  if (mode === 'strict') for (const [k, m] of Object.entries(houseRuleErrors(type, out))) setOnce(errors, k, m);
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: out as PairData };
}

/** The file id a new entry gets, from validated data. Only for a create:
 * an update keeps its entry_id whatever the data says (plan 4, A1). */
export function newEntryId(type: CmsType, data: unknown): Validated<string> {
  try {
    const id = type.idFrom(type.format === 'json' ? data : { frontmatter: (data as PairData).en.frontmatter });
    return { ok: true, data: checkId(id) };
  } catch (e) {
    return { ok: false, errors: { [type.idField]: e instanceof Error ? e.message : 'Not a valid id' } };
  }
}

/**
 * An update keeps its file name. Where the id is itself a field of the data
 * (idInData: events' `id`), that field must still give it, or the file
 * would say one id and be named another. Other types are named once, at
 * creation, and keep the name whatever their title or repo becomes.
 */
export function checkSameId(type: CmsType, entryId: string, data: unknown): FieldErrors | null {
  if (!type.idInData) return null;
  const id = newEntryId(type, data);
  if (id.ok && id.data === entryId) return null;
  return { [type.idField]: `This gives the file its name (${entryId}) and cannot change. To rename, create a new entry and delete this one.` };
}

/** Whether the type lets the panel create or delete entries (noCreate, noDelete). */
export function actionAllowed(type: CmsType, action: DraftAction): boolean {
  return !(action === 'create' && type.noCreate) && !(action === 'delete' && type.noDelete);
}

/**
 * For a fixedKeys type: the top-level keys `next` adds or lacks compared
 * with `before` (for a pair, each side's frontmatter keys), or null when
 * they are the same. Values may change; keys may not.
 */
export function fixedKeysErrors(type: CmsType, before: unknown, next: unknown): FieldErrors | null {
  if (!type.fixedKeys) return null;
  const errors: FieldErrors = {};
  const compare = (was: unknown, now: unknown, at: string) => {
    const a = isObject(was) ? Object.keys(was) : [];
    const b = isObject(now) ? Object.keys(now) : [];
    const path = (k: string) => (at ? `${at}.${k}` : k);
    for (const k of b) if (!a.includes(k)) setOnce(errors, path(k), 'Not in the file: only the values of its own keys can change');
    for (const k of a) if (!b.includes(k)) setOnce(errors, path(k), 'Missing: every key of the file must stay');
  };
  if (type.format === 'json') compare(before, next, '');
  else for (const lang of ['en', 'tr'] as const) {
    const side = (d: unknown) => (isObject(d) && isObject(d[lang]) ? (d[lang] as Record<string, unknown>).frontmatter : undefined);
    compare(side(before), side(next), `${lang}.frontmatter`);
  }
  return Object.keys(errors).length ? errors : null;
}

// ── Files ─────────────────────────────────────────────────────────────────────

/** The paths a new entry is written to. */
export function newPaths(type: CmsType, entryId: string): string[] {
  if (type.format === 'json') return [jsonPath(type, entryId)];
  const p = markdownPairPaths(type, entryId);
  return [p.en, p.tr];
}

/** Which language a webinar path is, from its folder. */
export function langOf(type: CmsType, path: string): 'en' | 'tr' {
  const m = new RegExp(`^${type.dir}/(en|tr)/[a-z0-9][a-z0-9-]*\\.md$`).exec(path);
  if (!m) throw new Error(`Not a ${type.key} path: ${path}`);
  return m[1] as 'en' | 'tr';
}

/**
 * Path → content for the pull request, or null for a file to delete. The
 * paths are the draft's `base_shas` keys, in sorted order.
 */
export function filesFor(draft: Pick<DraftRow, 'type' | 'entry_id' | 'action' | 'data' | 'base_shas'>): { path: string; content: string | null }[] {
  const type = cmsType(draft.type);
  if (!type) throw new Error(`Unknown content type ${draft.type}`);
  const paths = Object.keys(JSON.parse(draft.base_shas) as Record<string, string | null>).sort();
  if (paths.length === 0) throw new Error('A draft with no files');
  if (draft.action === 'delete') return paths.map((path) => ({ path, content: null }));

  const data = JSON.parse(draft.data) as unknown;
  if (type.format === 'json') {
    const path = jsonPath(type, draft.entry_id);
    if (paths.length !== 1 || paths[0] !== path) throw new Error(`A ${type.key} draft writes ${path} only`);
    return [{ path, content: serializeJson(type, data) }];
  }
  const pair = data as PairData;
  return paths.map((path) => {
    const side = pair[langOf(type, path)];
    return { path, content: serializeMarkdown(type, { frontmatter: side.frontmatter, body: side.body, source: side.source }) };
  });
}

// ── The pull request ──────────────────────────────────────────────────────────

/** The panel, by its public address: a request through a preview hostname
 * must not put a *.pages.dev link into a public pull request. One İçerik
 * section holds every group's drafts. */
const PANEL = 'https://rsg-turkiye.iscbsc.org/admin#icerik/taslaklar';

/** Type, action and entry id only: no names, no e-mail addresses (public repository). */
export function prTitle(d: Pick<DraftRow, 'action' | 'type' | 'entry_id'>): string {
  return `CMS: ${d.action} ${d.type} ${d.entry_id}`;
}

export function prBody(d: Pick<DraftRow, 'id' | 'action' | 'type' | 'entry_id'>): string {
  return [
    'A content change made and approved in the admin panel.',
    '',
    `- Type: ${d.type}`,
    `- Entry: ${d.entry_id}`,
    `- Action: ${d.action}`,
    `- Draft: ${d.id}`,
    '',
    `Review it in the panel: ${PANEL}/${d.id}`,
    '',
    'It merges itself once the required checks pass.',
  ].join('\n');
}
