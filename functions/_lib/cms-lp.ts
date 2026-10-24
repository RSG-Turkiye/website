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
 * A new id is minted with a random tail that skips every id the deployed
 * index lists, never starts with `tr-` (Turkish progress keys carry that
 * prefix), and is refused if another learning-path file has it. An id typed
 * by hand, or copied from another file, is not this entry's and is refused.
 * An id emptied by a client is a removed resource plus a new one; the
 * approver's diff lists each removed published id.
 */

import type { CmsType } from '../../src/lib/cms/types';
import { slugify } from '../../src/lib/cms/slug';
import { parseMarkdown } from '../../src/lib/cms/serialize';
import { resourceId, resourceIdsOf, resourceLists, resourcesOf } from '../../src/lib/cms/lp-resources';

export { resourcesOf };
import type { FieldErrors, PairData } from './cms-drafts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

export const LP_ID_FOREIGN = 'Not an id of this entry: a new resource gets its id from the server when it is saved';
export const LP_ID_TWICE = 'This id is used twice in this entry';
export const LP_ORDER = 'The English and Turkish lists must hold the same resources in the same order';
export const LP_SHARED = 'Must be the same as in English (a Turkish link may add /tr)';
export const LP_DOMAIN = 'Not a published domain: no such domain file on the site\'s main branch';
export const LP_STRUCTURE = 'The English and Turkish sides must have the same sections, each with as many resources';
export const LP_ID_ELSEWHERE = 'This id is used twice: another learning-path file has it';
export const LP_ID_TR = 'A new id may not start with tr-';

/** What must be the same in both languages (tests/lp-resource-ids.test.ts); only title and description are translated. */
export const LP_SHARED_FIELDS = ['tag', 'url', 'webinarSlug', 'youtubeUrl', 'speaker', 'year'] as const;

/** A draft's pair data with the server's own record of the ids it gave. */
export type LpDraftData = PairData & { _assigned?: string[] };

const lists = resourceLists;
const idOf = resourceId;

/** A new resource id (A4): the English title as a slug, at most 90 characters, and 6 random hex digits.
 * Never `tr-...`: Turkish pages store progress under `tr-<id>`, and progress
 * code strips one such prefix. */
export function newResourceId(title: unknown): string {
  const slug = slugify(typeof title === 'string' ? title : '').replace(/^(tr(-|$))+/, '').slice(0, 90).replace(/-+$/, '') || 'resource';
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return `${slug}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A new id that `taken` does not hold (another file's on the site, this draft's own), tried a few times. */
function freshId(title: unknown, taken: Set<string>): string {
  let id = newResourceId(title);
  for (let i = 0; i < 20 && taken.has(id); i++) id = newResourceId(title);
  taken.add(id);
  return id;
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
 * refuse: the server never copies an id it did not make. `taken`: ids that
 * may not be minted (every learning-path id the site lists, and the ids
 * this draft already holds or was given). Changes `data` in place; returns
 * the ids it gave.
 */
export function assignIds(data: PairData, taken: Iterable<string> = []): string[] {
  const given: string[] = [];
  const used = new Set([...taken, ...resourceIdsOf(data)]);
  const en = lists(data.en?.frontmatter);
  const tr = lists(data.tr?.frontmatter);
  for (let i = 0; i < Math.max(en.length, tr.length); i++) {
    const a = en[i]?.list ?? [];
    const b = tr[i]?.list ?? [];
    for (let j = 0; j < Math.max(a.length, b.length); j++) {
      const e = isObj(a[j]) ? a[j] as Obj : null;
      const t = isObj(b[j]) ? b[j] as Obj : null;
      if (e && idOf(e) === '') {
        const id = freshId(e.title || t?.title, used);
        setId(a, j, id);
        if (t && idOf(t) === '') setId(b, j, id);
        given.push(id);
      } else if (!e && t && idOf(t) === '') {
        const id = freshId(t.title, used);
        setId(b, j, id);
        given.push(id);
      }
    }
  }
  return given;
}

/** The frontmatter of each side as the entry has it on main: `source`, the text the server read when the draft started. */
export function mainSides(type: CmsType, data: PairData): { en: Obj | null; tr: Obj | null } {
  const read = (lang: 'en' | 'tr') => {
    const source = data[lang]?.source;
    return typeof source === 'string' ? parseMarkdown(type, `---\n${source}---\n`).frontmatter as Obj : null;
  };
  return { en: read('en'), tr: read('tr') };
}

/** The ids the entry has on main (each side's `source`). */
export function idsOnMain(type: CmsType, data: PairData): Set<string> {
  const main = mainSides(type, data);
  const out = new Set<string>();
  for (const fm of [main.en, main.tr]) for (const { r } of resourcesOf(fm)) if (idOf(r)) out.add(idOf(r));
  return out;
}

/** A shared field as tests/lp-resource-ids.test.ts compares it: a Turkish link to /tr/... counts without its /tr. */
function sharedValue(key: string, v: unknown, lang: 'en' | 'tr'): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return key === 'url' && lang === 'tr' && s.startsWith('/tr/') ? s.slice(3) : s;
}

function put(into: FieldErrors, key: string, message: string): void {
  if (!Object.hasOwn(into, key)) Object.defineProperty(into, key, { value: message, enumerable: true, writable: true, configurable: true });
}

/** Top-level keys that are not translated, per type: the same in both languages (besides lockedKeys). */
const PAIR_SHARED: Record<string, readonly string[]> = {
  'lp-domains': ['emoji', 'order'],
  'lp-roadmap': ['emoji', 'color'],
};

/** At most this many divergences between the languages are reported at once. */
export const LP_MAX_ERRORS = 20;

export interface LpContext {
  /** Ids the server gave this draft (`_assigned`). */
  assigned: readonly string[];
  /** Ids of every other learning-path entry, by id → that entry, or null when not known. */
  elsewhere?: ReadonlyMap<string, string> | null;
}

/**
 * Rule 8 at submit and approval, on validated pair data: every id is the
 * entry's own on main or one the server gave this draft, none twice, none
 * another entry's, no new one `tr-...`; the same ids in the same order and
 * in the same sections on both sides, with the same shared fields; the
 * sections the same (count and kind); and the type's untranslated keys (a
 * domain's emoji and order, its links' addresses, a stage's emoji and
 * colour, the locked keys) the same in both languages. Every divergence is
 * reported, up to LP_MAX_ERRORS.
 */
export function lpErrors(type: CmsType, data: PairData, ctx: LpContext): FieldErrors {
  const errors: FieldErrors = {};
  let count = 0;
  const add = (key: string, message: string) => { if (count < LP_MAX_ERRORS && !Object.hasOwn(errors, key)) { put(errors, key, message); count++; } };
  const fm = (lang: 'en' | 'tr') => (data[lang]?.frontmatter ?? {}) as Obj;
  for (const key of [...type.lockedKeys, ...(PAIR_SHARED[type.key] ?? [])]) {
    if (sharedValue(key, fm('en')[key], 'en') !== sharedValue(key, fm('tr')[key], 'en')) add(`tr.frontmatter.${key}`, LP_SHARED);
  }
  // A domain's "go further" links: translated titles, one address.
  const links = (lang: 'en' | 'tr') => (Array.isArray(fm(lang).goDeeper) ? fm(lang).goDeeper as unknown[] : []);
  if (Object.hasOwn(fm('en'), 'goDeeper') || Object.hasOwn(fm('tr'), 'goDeeper')) {
    if (links('en').length !== links('tr').length) add('tr.frontmatter.goDeeper', LP_STRUCTURE);
    else links('en').forEach((l, i) => {
      if (sharedValue('url', isObj(l) ? l.url : undefined, 'en') !== sharedValue('url', isObj(links('tr')[i]) ? (links('tr')[i] as Obj).url : undefined, 'tr')) add(`tr.frontmatter.goDeeper.${i}.url`, LP_SHARED);
    });
  }
  if (!type.resourceIds) return errors;

  // Sections: as many, of the same kind, each with as many cards.
  const secs = (lang: 'en' | 'tr') => (Array.isArray(fm(lang).sections) ? fm(lang).sections as unknown[] : null);
  const se = secs('en');
  const st = secs('tr');
  if (se || st) {
    if ((se?.length ?? 0) !== (st?.length ?? 0)) add('tr.frontmatter.sections', LP_STRUCTURE);
    else se!.forEach((x, i) => {
      const y = st![i];
      const a = isObj(x) ? x : {};
      const b = isObj(y) ? y : {};
      if (sharedValue('type', a.type, 'en') !== sharedValue('type', b.type, 'en')) add(`tr.frontmatter.sections.${i}.type`, LP_SHARED);
      const na = Array.isArray(a.resources) ? a.resources.length : 0;
      const nb = Array.isArray(b.resources) ? b.resources.length : 0;
      if (na !== nb) add(`tr.frontmatter.sections.${i}.resources`, LP_STRUCTURE);
    });
  }

  const onMain = idsOnMain(type, data);
  const allowed = new Set([...onMain, ...ctx.assigned]);
  const sides = { en: resourcesOf(fm('en')), tr: resourcesOf(fm('tr')) };
  for (const lang of ['en', 'tr'] as const) {
    const seen = new Set<string>();
    for (const { at, r } of sides[lang]) {
      const id = idOf(r);
      const path = `${lang}.frontmatter.${at}.id`;
      if (id && !allowed.has(id)) add(path, LP_ID_FOREIGN);
      else if (id && seen.has(id)) add(path, LP_ID_TWICE);
      else if (id && !onMain.has(id) && /^tr-/.test(id)) add(path, LP_ID_TR);
      else if (id && !onMain.has(id) && ctx.elsewhere?.has(id)) add(path, LP_ID_ELSEWHERE);
      seen.add(id);
    }
  }
  const n = Math.max(sides.en.length, sides.tr.length);
  for (let k = 0; k < n; k++) {
    const e = sides.en[k];
    const t = sides.tr[k];
    if (!e || !t || idOf(e.r) !== idOf(t.r)) {
      // Where the two lists part: on the Turkish side where it has the card.
      add(t ? `tr.frontmatter.${t.at}.id` : `en.frontmatter.${e!.at}.id`, LP_ORDER);
      continue;
    }
    for (const key of LP_SHARED_FIELDS) {
      if (sharedValue(key, e.r[key], 'en') !== sharedValue(key, t.r[key], 'tr')) add(`tr.frontmatter.${t.at}.${key}`, LP_SHARED);
    }
  }
  return errors;
}

/**
 * For a type with locked keys: the ones `next` changes compared with
 * `before` (each side's frontmatter, in pair data's shape), or null.
 * `entryId` names the file in the message.
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

/** The ids that are on main (`source`) but no longer in the draft, both sides: the approver is shown them. */
export function removedIds(type: CmsType, data: PairData): string[] {
  const now = resourceIdsOf(data);
  return [...idsOnMain(type, data)].filter((id) => !now.has(id));
}

/** `_assigned` cut to the ids the draft still holds (a card deleted after its id was given drops it). */
export function prunedAssigned(data: LpDraftData): string[] {
  const now = resourceIdsOf(data);
  return (Array.isArray(data._assigned) ? data._assigned : []).filter((id) => typeof id === 'string' && now.has(id));
}

/** The level files a domain has, by name (`<domain>-<level>.md`) among `names` (one folder's file names). */
export function levelsOfDomain(domain: string, names: readonly string[]): string[] {
  return names.filter((n) => LP_LEVEL_IDS.some((l) => n === `${domain}-${l}.md`));
}

/** src/data/learning-paths.ts's levels (pinned by a test). */
export const LP_LEVEL_IDS = ['explorer', 'practitioner', 'researcher', 'specialist'] as const;
