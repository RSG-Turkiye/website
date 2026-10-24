/**
 * Learning-path resource ids in panel drafts (CLAUDE.md rule 8; plan 4, A4).
 *
 * A resource's id is the key members' progress is saved under, so a draft
 * may never invent, change or reuse one:
 * - the client never sends a new id: on every save the server gives each
 *   resource whose id is empty `<slug of its English title>-<6 random hex>`
 *   and records it in the draft's `_assigned` (never written to git: the
 *   files are written from each side's frontmatter only);
 * - at submit and again at approval, every id must be one the entry has on
 *   main or one the server gave this draft, used once, the same ids in the
 *   same order in English and Turkish, with the same shared fields.
 *
 * "On main" is each side's `source`: the frontmatter text the server read
 * from main when the draft started, never taken from the client. Approval
 * checks that main still has exactly those files (base_shas at the pinned
 * head), so the ids it checks against are main's at that head.
 *
 * No uniqueness check against other files is needed: the only new ids are
 * fresh random ones, and an id typed by hand, or one copied from another
 * file, is not this entry's.
 */

import type { CmsType } from '../../src/lib/cms/types';
import { slugify } from '../../src/lib/cms/slug';
import { parseMarkdown } from '../../src/lib/cms/serialize';
import type { FieldErrors, PairData } from './cms-drafts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const LP_ID_FOREIGN = 'Not an id of this entry: a new resource gets its id from the server when it is saved';
export const LP_ID_TWICE = 'This id is used twice in this entry';
export const LP_ORDER = 'The English and Turkish lists must hold the same resources in the same order';
export const LP_SHARED = 'Must be the same as in English (a Turkish link may add /tr)';
export const LP_DOMAIN = 'Not a published domain';

/** What must be the same in both languages (tests/lp-resource-ids.test.ts); only title and description are translated. */
export const LP_SHARED_FIELDS = ['tag', 'url', 'webinarSlug', 'youtubeUrl', 'speaker', 'year'] as const;

/** A draft's pair data with the server's own record of the ids it gave. */
export type LpDraftData = PairData & { _assigned?: string[] };

/** One resource in file order: its path under the frontmatter (`sections.0.resources.2`) and the object itself. */
interface Placed { at: string; r: Obj }

/** Every resource list of one side's frontmatter, in file order, by path: a level's per section, a stage's one. */
function lists(fm: unknown): { at: string; list: unknown[] }[] {
  if (!isObj(fm)) return [];
  if (Array.isArray(fm.sections)) {
    return fm.sections.map((s, i) => ({ at: `sections.${i}.resources`, list: isObj(s) && Array.isArray(s.resources) ? s.resources : [] }));
  }
  return Array.isArray(fm.resources) ? [{ at: 'resources', list: fm.resources }] : [];
}

/** Every resource of one side, in file order (the order progress is read in). */
export function resourcesOf(fm: unknown): Placed[] {
  return lists(fm).flatMap(({ at, list }) => list.map((r, j) => ({ at: `${at}.${j}`, r: isObj(r) ? r : {} })));
}

const idOf = (r: Obj): string => (typeof r.id === 'string' ? r.id : '');

/** A new resource id (A4): the English title as a slug, at most 90 characters, and 6 random hex digits. */
export function newResourceId(title: unknown): string {
  const slug = slugify(typeof title === 'string' ? title : '').slice(0, 90).replace(/-+$/, '') || 'resource';
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${slug}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** `r` with its id set: in place when it has the key, else as the first key (tests/lp-resource-ids.test.ts reads ids first). */
function setId(list: unknown[], j: number, id: string): void {
  const r = list[j] as Obj;
  if (Object.hasOwn(r, 'id')) r.id = id;
  else list[j] = { id, ...r };
}

/**
 * Gives every resource whose id is empty a new one, the same on both sides
 * at the same place (the form keeps the two lists aligned). A resource
 * whose English side has an id and Turkish side none is left for submit to
 * refuse: the server never copies an id it did not make. Changes `data` in
 * place; returns the ids it gave.
 */
export function assignIds(data: PairData): string[] {
  const given: string[] = [];
  const en = lists(data.en?.frontmatter);
  const tr = lists(data.tr?.frontmatter);
  for (let i = 0; i < Math.max(en.length, tr.length); i++) {
    const a = en[i]?.list ?? [];
    const b = tr[i]?.list ?? [];
    for (let j = 0; j < Math.max(a.length, b.length); j++) {
      const e = isObj(a[j]) ? a[j] as Obj : null;
      const t = isObj(b[j]) ? b[j] as Obj : null;
      if (e && idOf(e) === '') {
        const id = newResourceId(e.title || t?.title);
        setId(a, j, id);
        if (t && idOf(t) === '') setId(b, j, id);
        given.push(id);
      } else if (!e && t && idOf(t) === '') {
        const id = newResourceId(t.title);
        setId(b, j, id);
        given.push(id);
      }
    }
  }
  return given;
}

/** The ids the entry has on main: in each side's `source`, the frontmatter the server read when the draft started. */
export function idsOnMain(type: CmsType, data: PairData): Set<string> {
  const out = new Set<string>();
  for (const lang of ['en', 'tr'] as const) {
    const source = data[lang]?.source;
    if (typeof source !== 'string') continue;
    const fm = parseMarkdown(type, `---\n${source}---\n`).frontmatter;
    for (const { r } of resourcesOf(fm)) if (idOf(r)) out.add(idOf(r));
  }
  return out;
}

/** A shared field as tests/lp-resource-ids.test.ts compares it: a Turkish link to /tr/... counts without its /tr. */
function sharedValue(key: string, v: unknown, lang: 'en' | 'tr'): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v);
  return key === 'url' && lang === 'tr' && s.startsWith('/tr/') ? s.slice(3) : s;
}

function put(into: FieldErrors, key: string, message: string): void {
  if (!Object.hasOwn(into, key)) Object.defineProperty(into, key, { value: message, enumerable: true, writable: true, configurable: true });
}

/**
 * Rule 8 at submit and approval, on validated pair data: every id is the
 * entry's own on main or one the server gave this draft (`assigned`), none
 * twice, the same ids in the same order on both sides, with the same
 * shared fields; and the type's locked keys (a level's domain and level, a
 * stage's number) the same on both sides. `domains`, for a level: the
 * published domains its `domain` must be one of.
 */
export function lpErrors(type: CmsType, data: PairData, assigned: readonly string[], domains: readonly string[] | null): FieldErrors {
  const errors: FieldErrors = {};
  const fm = (lang: 'en' | 'tr') => (data[lang]?.frontmatter ?? {}) as Obj;
  for (const key of type.lockedKeys) {
    if (sharedValue(key, fm('en')[key], 'en') !== sharedValue(key, fm('tr')[key], 'en')) put(errors, `tr.frontmatter.${key}`, LP_SHARED);
  }
  if (domains && Object.hasOwn(fm('en'), 'domain') && !domains.includes(String(fm('en').domain))) put(errors, 'en.frontmatter.domain', LP_DOMAIN);
  if (!type.resourceIds) return errors;

  const allowed = new Set([...idsOnMain(type, data), ...assigned]);
  const sides = { en: resourcesOf(fm('en')), tr: resourcesOf(fm('tr')) };
  for (const lang of ['en', 'tr'] as const) {
    const seen = new Set<string>();
    for (const { at, r } of sides[lang]) {
      const id = idOf(r);
      const path = `${lang}.frontmatter.${at}.id`;
      if (id && !allowed.has(id)) put(errors, path, LP_ID_FOREIGN);
      else if (id && seen.has(id)) put(errors, path, LP_ID_TWICE);
      seen.add(id);
    }
  }
  const n = Math.max(sides.en.length, sides.tr.length);
  for (let k = 0; k < n; k++) {
    const e = sides.en[k];
    const t = sides.tr[k];
    if (!e || !t || idOf(e.r) !== idOf(t.r)) {
      // The first place the two lists part: on the Turkish side where it has one.
      put(errors, t ? `tr.frontmatter.${t.at}.id` : `en.frontmatter.${e!.at}.id`, LP_ORDER);
      break;
    }
    for (const key of LP_SHARED_FIELDS) {
      if (sharedValue(key, e.r[key], 'en') !== sharedValue(key, t.r[key], 'tr')) put(errors, `tr.frontmatter.${t.at}.${key}`, LP_SHARED);
    }
  }
  return errors;
}

/**
 * For a type with locked keys: the ones `next` changes compared with
 * `before` (each side's frontmatter), or null. `entryId` names the file in
 * the message.
 */
export function lockedKeysErrors(type: CmsType, entryId: string, before: unknown, next: unknown): FieldErrors | null {
  if (type.lockedKeys.length === 0) return null;
  const errors: FieldErrors = {};
  const fm = (d: unknown, lang: 'en' | 'tr') => (isObj(d) && isObj(d[lang]) && isObj((d[lang] as Obj).frontmatter) ? (d[lang] as Obj).frontmatter as Obj : null);
  for (const lang of ['en', 'tr'] as const) {
    const a = fm(before, lang);
    const b = fm(next, lang);
    if (!a || !b) continue;
    for (const key of type.lockedKeys) {
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        put(errors, `${lang}.frontmatter.${key}`, `This gives the file its name (${entryId}) and cannot change. To move it, create a new entry and delete this one.`);
      }
    }
  }
  return Object.keys(errors).length ? errors : null;
}
