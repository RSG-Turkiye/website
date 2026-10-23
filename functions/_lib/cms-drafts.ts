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

export type DraftStatus = 'draft' | 'submitted' | 'approved' | 'pr_open' | 'pr_failed' | 'published' | 'rejected' | 'discarded';
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
  created_at: number;
  updated_at: number;
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
  discard: ['draft', 'submitted', 'rejected', 'pr_failed'],
  reject: ['submitted'],
  approve: ['submitted'],
} as const satisfies Record<string, readonly DraftStatus[]>;

export const STALE_APPROVAL_SECONDS = 300;

export function canTransition(step: keyof typeof TRANSITIONS, status: DraftStatus): boolean {
  return (TRANSITIONS[step] as readonly DraftStatus[]).includes(status);
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Field path (dots, as the form names them) → message. '' is the whole entry. */
export type FieldErrors = Record<string, string>;
export type Validated<T = unknown> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

type Issue = { path: PropertyKey[]; message: string; code?: string; keys?: string[] };

function issuesToErrors(issues: Issue[], prefix: string, into: FieldErrors): void {
  for (const issue of issues) {
    const at = [prefix, ...issue.path.map(String)].filter((s) => s !== '').join('.');
    if (issue.code === 'unrecognized_keys' && issue.keys) {
      for (const k of issue.keys) into[at ? `${at}.${k}` : k] ??= 'Unknown field';
    } else {
      into[at] ??= issue.message;
    }
  }
}

/**
 * The entry checked against its type's zod schema. On success `data` is the
 * input as written to the file (not zod's output, which would turn dates into
 * Dates and add defaults the file never had), trimmed to the known shape for
 * webinars.
 */
export function validateDraft(type: CmsType, data: unknown): Validated {
  const errors: FieldErrors = {};
  if (type.format === 'json') {
    if (!isObject(data)) return { ok: false, errors: { '': 'The entry must be an object' } };
    const r = type.schema.safeParse(data);
    if (!r.success) issuesToErrors(r.error.issues as Issue[], '', errors);
    return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
  }

  if (!isObject(data)) return { ok: false, errors: { '': 'The entry must have an English and a Turkish side' } };
  const out: Partial<PairData> = {};
  for (const lang of ['en', 'tr'] as const) {
    const side = data[lang];
    if (!isObject(side) || !isObject(side.frontmatter)) { errors[lang] = 'Missing'; continue; }
    if (typeof side.body !== 'string') errors[`${lang}.body`] = 'Must be text';
    const r = type.schema.safeParse(side.frontmatter);
    if (!r.success) issuesToErrors(r.error.issues as Issue[], `${lang}.frontmatter`, errors);
    const declared = side.frontmatter.lang;
    if (declared !== undefined && declared !== lang) errors[`${lang}.frontmatter.lang`] ??= `Must be "${lang}" or left out`;
    out[lang] = { frontmatter: side.frontmatter, body: String(side.body ?? '') };
  }
  // Pairs are tied by translationKey when it is set (src/lib/translations.ts):
  // two different keys would split the pair on the site.
  if (out.en && out.tr) {
    const key = (side: MarkdownSide) => String(side.frontmatter.translationKey ?? '').trim();
    if (key(out.en) !== key(out.tr)) errors['tr.frontmatter.translationKey'] ??= 'Must be the same as the English side';
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data: out as PairData };
}

/** The form field a type's file name comes from, for errors about the id. */
const ID_FIELD: Record<string, string> = { events: 'id', workshops: 'repo', webinars: 'en.frontmatter.title' };

/** The file id a new entry gets, from validated data. */
export function newEntryId(type: CmsType, data: unknown): Validated<string> {
  try {
    const id = type.idFrom(type.format === 'json' ? data : { frontmatter: (data as PairData).en.frontmatter });
    return { ok: true, data: checkId(id) };
  } catch (e) {
    return { ok: false, errors: { [ID_FIELD[type.key]]: e instanceof Error ? e.message : 'Not a valid id' } };
  }
}

/**
 * An update keeps its file name, so for JSON types the field the name comes
 * from must still give it. Webinars are named by hand and keep theirs
 * whatever the title becomes.
 */
export function checkSameId(type: CmsType, entryId: string, data: unknown): FieldErrors | null {
  if (type.format !== 'json') return null;
  const id = newEntryId(type, data);
  if (id.ok && id.data === entryId) return null;
  return { [ID_FIELD[type.key]]: `This gives the file its name (${entryId}) and cannot change. To rename, create a new entry and delete this one.` };
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
 * must not put a *.pages.dev link into a public pull request. */
const PANEL = 'https://rsg-turkiye.iscbsc.org/admin#icerik-etkinlikler/taslaklar';

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
