/**
 * The Etkinlikler panel's form model: for each content type, the fields a
 * person sees, in order, with their label, help text, group and kind. Not a
 * JSON-Schema renderer on purpose: a schema says what is valid, not which
 * five fields someone opened the form to change. The zod schemas
 * (src/data/*.ts) stay the validators, on the server.
 *
 * Pure: no DOM, so tests/cms-form.test.ts can check every model against the
 * real schemas and every real file. The renderer is cms-render.ts.
 *
 * A form never rebuilds an entry. It shows `formValues(model, data)` and
 * writes edits back with `applyValues(model, data, values)` onto a copy of
 * the data it was opened with, so a key the form does not show (a webinar's
 * legacy `lang`, a pair's `source`) passes through untouched, and a value
 * nobody edited is written back exactly as it was.
 */
import { checkId, slugify } from '../../lib/cms/slug';

export type TypeKey = 'events' | 'workshops' | 'webinars';
export type Kind = 'text' | 'textarea' | 'date' | 'select' | 'number' | 'checkbox' | 'bilingual' | 'strings' | 'links' | 'image' | 'markdown';
export type Group = 'main' | 'more';

export interface FieldDef {
  /** The entry's key (JSON types) or the frontmatter key (webinars); `body` is the Markdown body. */
  key: string;
  kind: Kind;
  /** An i18n key (admin.cms.f.*). */
  label: string;
  /** An i18n key (admin.cms.h.*). */
  help?: string;
  group: Group;
  /** select: the values, in order. */
  options?: readonly string[];
  /** bilingual: two text areas instead of two lines. */
  multiline?: boolean;
  /** image: an object with thumb, full and alt (events), or a plain URL (webinars). */
  image?: 'object' | 'url';
  /** Webinars: a value per language (title), not one for both (date). */
  perLang?: boolean;
  /** Shown, never edited (translationKey). */
  readOnly?: boolean;
  /** Hidden from editors, read-only for approvers ("İç not"). */
  approverOnly?: boolean;
  /** Required at submit: the label gets a mark. Not enforced here. */
  required?: boolean;
}

export interface TypeModel {
  key: TypeKey;
  format: 'json' | 'markdown-pair';
  /** The URL path segment of the type's sub-page. */
  sub: 'etkinlikler' | 'atolyeler' | 'webinarlar';
  /** The type's name, an i18n key. */
  label: string;
  fields: FieldDef[];
  /** Schema keys the form never shows, each with its reason. */
  hidden: Record<string, string>;
}

const EVENT_TYPES = ['symposium', 'workshop', 'hackathon', 'meetup'] as const;

export const MODELS: Record<TypeKey, TypeModel> = {
  events: {
    key: 'events', format: 'json', sub: 'etkinlikler', label: 'admin.cms.type.events',
    fields: [
      { key: 'title', kind: 'bilingual', label: 'admin.cms.f.title', group: 'main', required: true },
      { key: 'start', kind: 'date', label: 'admin.cms.f.start', help: 'admin.cms.h.start', group: 'main', required: true },
      { key: 'end', kind: 'date', label: 'admin.cms.f.end', help: 'admin.cms.h.end', group: 'main' },
      { key: 'type', kind: 'select', label: 'admin.cms.f.eventType', options: EVENT_TYPES, group: 'main', required: true },
      { key: 'when', kind: 'bilingual', label: 'admin.cms.f.when', help: 'admin.cms.h.when', group: 'main', required: true },
      { key: 'location', kind: 'bilingual', label: 'admin.cms.f.location', group: 'main', required: true },
      { key: 'description', kind: 'bilingual', multiline: true, label: 'admin.cms.f.description', group: 'main', required: true },
      { key: 'links', kind: 'links', label: 'admin.cms.f.links', help: 'admin.cms.h.links', group: 'more' },
      { key: 'image', kind: 'image', image: 'object', label: 'admin.cms.f.image', help: 'admin.cms.h.image', group: 'more' },
      { key: 'nfcore', kind: 'checkbox', label: 'admin.cms.f.nfcore', group: 'more' },
      { key: 'note', kind: 'textarea', label: 'admin.cms.f.note', group: 'more', approverOnly: true },
    ],
    hidden: { id: 'the file name, derived from the title and shown read-only' },
  },
  workshops: {
    key: 'workshops', format: 'json', sub: 'atolyeler', label: 'admin.cms.type.workshops',
    fields: [
      { key: 'title', kind: 'text', label: 'admin.cms.f.title', group: 'main', required: true },
      { key: 'year', kind: 'number', label: 'admin.cms.f.year', group: 'main', required: true },
      { key: 'topics', kind: 'text', label: 'admin.cms.f.topics', help: 'admin.cms.h.topics', group: 'main', required: true },
      { key: 'repo', kind: 'text', label: 'admin.cms.f.repo', help: 'admin.cms.h.repo', group: 'main', required: true },
    ],
    hidden: {},
  },
  webinars: {
    key: 'webinars', format: 'markdown-pair', sub: 'webinarlar', label: 'admin.cms.type.webinars',
    fields: [
      { key: 'title', kind: 'text', perLang: true, label: 'admin.cms.f.title', group: 'main', required: true },
      { key: 'date', kind: 'date', label: 'admin.cms.f.date', group: 'main', required: true },
      { key: 'speaker', kind: 'text', label: 'admin.cms.f.speaker', group: 'main', required: true },
      { key: 'speakerTitle', kind: 'text', perLang: true, label: 'admin.cms.f.speakerTitle', group: 'main' },
      { key: 'speakerAffiliation', kind: 'text', perLang: true, label: 'admin.cms.f.speakerAffiliation', group: 'main' },
      { key: 'youtubeUrl', kind: 'text', label: 'admin.cms.f.youtubeUrl', help: 'admin.cms.h.youtubeUrl', group: 'main' },
      { key: 'description', kind: 'textarea', perLang: true, label: 'admin.cms.f.description', group: 'main', required: true },
      { key: 'body', kind: 'markdown', perLang: true, label: 'admin.cms.f.body', help: 'admin.cms.h.body', group: 'more' },
      // Derived from the date (applyValues), shown so the reader sees what the file gets.
      { key: 'year', kind: 'number', label: 'admin.cms.f.year', help: 'admin.cms.h.year', group: 'more', readOnly: true },
      { key: 'type', kind: 'select', label: 'admin.cms.f.webinarType', options: ['bioinfonet', 'student'], group: 'more', required: true },
      { key: 'topic', kind: 'text', perLang: true, label: 'admin.cms.f.topic', group: 'more' },
      { key: 'keyTakeaways', kind: 'strings', perLang: true, label: 'admin.cms.f.keyTakeaways', group: 'more' },
      { key: 'slidesUrl', kind: 'text', label: 'admin.cms.f.slidesUrl', group: 'more' },
      { key: 'speakerPhoto', kind: 'image', image: 'url', label: 'admin.cms.f.speakerPhoto', group: 'more' },
      { key: 'image', kind: 'image', image: 'url', label: 'admin.cms.f.image', group: 'more' },
      { key: 'domains', kind: 'strings', label: 'admin.cms.f.domains', help: 'admin.cms.h.domains', group: 'more' },
      { key: 'draft', kind: 'checkbox', label: 'admin.cms.f.draft', help: 'admin.cms.h.draft', group: 'more' },
      { key: 'translationKey', kind: 'text', label: 'admin.cms.f.translationKey', group: 'more', readOnly: true },
    ],
    hidden: { lang: 'legacy; the language comes from the folder' },
  },
};

export const TYPE_KEYS: readonly TypeKey[] = ['events', 'workshops', 'webinars'];
export const modelFor = (key: string): TypeModel | null => (TYPE_KEYS as readonly string[]).includes(key) ? MODELS[key as TypeKey] : null;
export const modelForSub = (sub: string): TypeModel | null => TYPE_KEYS.map((k) => MODELS[k]).find((m) => m.sub === sub) ?? null;

/** The fields this person sees: `note` only for approvers. */
export function visibleFields(model: TypeModel, approver: boolean): FieldDef[] {
  return model.fields.filter((f) => !f.approverOnly || approver);
}

// ── Values ───────────────────────────────────────────────────────────────────

export type Bi<T = string> = { en: T; tr: T };
export interface LinkItem { label: Bi; url: string }
export interface ImageObject { thumb: string; full: string; alt: Bi; fit?: 'cover' | 'contain' }
/** One field's value as the form holds it. Webinar fields are always `Bi<V>`. */
export type Value = string | boolean | string[] | Bi | LinkItem[] | ImageObject | null | Bi<unknown>;
export type Values = Record<string, unknown>;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));
const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)) as T);

function bi(v: unknown): Bi {
  return isObj(v) ? { en: str(v.en), tr: str(v.tr) } : { en: '', tr: '' };
}

/** The form's value for one key of one object (a JSON entry or one webinar side). */
function readOne(f: FieldDef, raw: unknown): unknown {
  switch (f.kind) {
    case 'checkbox': return raw === true;
    case 'number': return typeof raw === 'number' ? String(raw) : str(raw);
    case 'bilingual': return bi(raw);
    case 'strings': return Array.isArray(raw) ? raw.map(str) : [];
    case 'links': return Array.isArray(raw) ? raw.map((l) => ({ label: bi(isObj(l) ? l.label : null), url: str(isObj(l) ? l.url : '') })) : [];
    case 'image':
      if (f.image === 'url') return str(raw);
      return isObj(raw) ? clone(raw) : null;
    default: return str(raw);
  }
}

/** Whether a value says "nothing here". */
export function isEmptyValue(f: FieldDef, v: unknown): boolean {
  switch (f.kind) {
    case 'checkbox': return v !== true;
    case 'bilingual': return str((v as Bi).en) === '' && str((v as Bi).tr) === '';
    case 'strings': case 'links': return !Array.isArray(v) || v.length === 0;
    case 'image': return f.image === 'url' ? str(v) === '' : v === null || v === undefined;
    default: return str(v) === '';
  }
}

/**
 * Writes one value into `into[f.key]`. An empty value leaves a key that was
 * not there absent, so an untouched form adds nothing to the file. A value
 * that has no valid empty form (a date, a choice, a number, an event's
 * image) is removed when cleared; a text keeps its empty string, for submit to report.
 */
function writeOne(f: FieldDef, into: Obj, v: unknown): void {
  const had = Object.hasOwn(into, f.key);
  if (isEmptyValue(f, v)) {
    if (!had) return;
    if (['date', 'select', 'number'].includes(f.kind) || (f.kind === 'image' && f.image === 'object')) { delete into[f.key]; return; }
    if (f.kind === 'checkbox') { into[f.key] = false; return; }
  }
  switch (f.kind) {
    case 'checkbox': into[f.key] = v === true; return;
    case 'number': {
      const s = str(v).trim();
      const n = Number(s);
      // Not a number: kept as typed, so the server's check names the field.
      into[f.key] = s !== '' && Number.isFinite(n) ? n : s;
      return;
    }
    case 'bilingual': into[f.key] = { en: str((v as Bi).en), tr: str((v as Bi).tr) }; return;
    case 'strings': into[f.key] = (v as string[]).map(str); return;
    case 'links': into[f.key] = (v as LinkItem[]).map((l) => ({ label: { en: str(l.label?.en), tr: str(l.label?.tr) }, url: str(l.url) })); return;
    case 'image': into[f.key] = f.image === 'url' ? str(v) : clone(v); return;
    default: into[f.key] = str(v);
  }
}

/** A webinar side as the form works on it: a missing side is an empty one. */
function side(data: unknown, lang: 'en' | 'tr'): { frontmatter: Obj; body: string } & Obj {
  const s = isObj(data) ? data[lang] : null;
  if (!isObj(s)) return { frontmatter: {}, body: '' };
  return { ...s, frontmatter: isObj(s.frontmatter) ? s.frontmatter : {}, body: str(s.body) };
}

/** The data a form for a new entry starts from. */
export function emptyData(model: TypeModel): unknown {
  return model.format === 'json' ? {} : { en: { frontmatter: {}, body: '' }, tr: { frontmatter: {}, body: '' } };
}

/** Every field's form value. Webinar values are `{ en, tr }`, one per side. */
export function formValues(model: TypeModel, data: unknown): Values {
  const out: Values = {};
  if (model.format === 'json') {
    const d = isObj(data) ? data : {};
    for (const f of model.fields) out[f.key] = readOne(f, d[f.key]);
    return out;
  }
  const en = side(data, 'en');
  const tr = side(data, 'tr');
  for (const f of model.fields) {
    out[f.key] = f.kind === 'markdown'
      ? { en: en.body, tr: tr.body }
      : { en: readOne(f, en.frontmatter[f.key]), tr: readOne(f, tr.frontmatter[f.key]) };
  }
  return out;
}

/** `base` with the form's values written in. `base` itself is not changed. */
export function applyValues(model: TypeModel, base: unknown, values: Values): unknown {
  if (model.format === 'json') {
    const out = (isObj(base) ? clone(base) : {}) as Obj;
    for (const f of model.fields) {
      if (f.readOnly || !Object.hasOwn(values, f.key)) continue;
      writeOne(f, out, values[f.key]);
    }
    return out;
  }
  const out = { en: clone(side(base, 'en')), tr: clone(side(base, 'tr')) };
  for (const f of model.fields) {
    if (f.readOnly || !Object.hasOwn(values, f.key)) continue;
    const v = values[f.key] as Bi<unknown>;
    for (const lang of ['en', 'tr'] as const) {
      if (f.kind === 'markdown') out[lang].body = str(v[lang]);
      else writeOne(f, out[lang].frontmatter, v[lang]);
    }
  }
  // A webinar's year is its date's year (the schema checks it): never typed.
  if (model.key === 'webinars') {
    for (const lang of ['en', 'tr'] as const) {
      const fm = out[lang].frontmatter;
      const y = /^(\d{4})-\d{2}-\d{2}$/.exec(str(fm.date));
      if (y && fm.year !== Number(y[1])) fm.year = Number(y[1]);
    }
  }
  return out;
}

/** Deep equality of plain JSON values. */
export function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A webinar field shared by both languages shows one control while both sides agree. */
export function sharedShowsOne(f: FieldDef, v: Bi<unknown>): boolean {
  return !f.perLang && same(v.en, v.tr);
}

// ── File names ───────────────────────────────────────────────────────────────

/**
 * The file name a new entry gets, as the server will derive it (the
 * registry's idFrom), or '' while the field it comes from is empty. An
 * event's id is the English title as a slug, with the year when the title
 * does not say it ("Ankara meetup", 2027 → ankara-meetup-2027).
 */
export function suggestedId(model: TypeModel, values: Values): string {
  const tryId = (text: string) => { try { return checkId(slugify(text)); } catch { return ''; } };
  if (model.key === 'events') {
    const slug = tryId(str((values.title as Bi | undefined)?.en));
    if (!slug) return '';
    const year = str(values.start).slice(0, 4);
    return /^\d{4}$/.test(year) && !slug.includes(year) ? `${slug}-${year}` : slug;
  }
  if (model.key === 'workshops') return tryId(str(values.repo));
  return tryId(str((values.title as Bi | undefined)?.en));
}

/** The data to save for a new entry: an event also carries its id. */
export function withId(model: TypeModel, data: unknown, id: string): unknown {
  if (model.key !== 'events' || !isObj(data)) return data;
  return id ? { ...data, id } : data;
}

// ── Half translations ────────────────────────────────────────────────────────

/** Labels (i18n keys plus a suffix) of texts filled in one language and empty in the other. */
export function halfTranslated(model: TypeModel, values: Values): { key: string; label: string; sub?: string }[] {
  const out: { key: string; label: string; sub?: string }[] = [];
  const half = (b: Bi | undefined) => !!b && (str(b.en).trim() === '') !== (str(b.tr).trim() === '');
  for (const f of model.fields) {
    const v = values[f.key];
    // A required text half-filled is a field error at submit, not a warning.
    if (f.readOnly || f.approverOnly || f.required || v === undefined) continue;
    if (model.format === 'markdown-pair') {
      if (!f.perLang) continue;
      const b = v as Bi<unknown>;
      const flat = (x: unknown) => (Array.isArray(x) ? x.join('') : str(x));
      if (half({ en: flat(b.en), tr: flat(b.tr) })) out.push({ key: f.key, label: f.label });
      continue;
    }
    if (f.kind === 'bilingual' && half(v as Bi)) out.push({ key: f.key, label: f.label });
    if (f.kind === 'links') (v as LinkItem[]).forEach((l, i) => { if (half(l.label)) out.push({ key: f.key, label: f.label, sub: `${i + 1}` }); });
    if (f.kind === 'image' && v && half((v as ImageObject).alt)) out.push({ key: f.key, label: f.label });
  }
  return out;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Where a server error path points: the field, the language and the row. */
export interface ErrorPlace { key: string | null; lang?: 'en' | 'tr'; row?: number; part?: string }

/** `links.1.url` → links, row 1, part url; `en.frontmatter.title` → title, en. */
export function placeOf(model: TypeModel, path: string): ErrorPlace {
  const parts = path.split('.').filter((p) => p !== '');
  if (model.format === 'markdown-pair') {
    const lang = parts[0] === 'en' || parts[0] === 'tr' ? parts[0] : undefined;
    if (parts[1] === 'body') return { key: 'body', lang };
    if (parts[1] === 'frontmatter' && parts[2]) return { key: parts[2], lang };
    return { key: null, lang };
  }
  if (parts.length === 0) return { key: null };
  // An event's id comes from its title.
  const key = model.key === 'events' && parts[0] === 'id' ? 'title' : parts[0];
  const rest = parts.slice(1);
  if (/^\d+$/.test(rest[0] ?? '')) {
    const row = Number(rest[0]);
    const tail = rest.slice(1);
    const lang = tail.at(-1) === 'en' || tail.at(-1) === 'tr' ? tail.at(-1) as 'en' | 'tr' : undefined;
    return { key, row, part: tail.find((p) => p !== 'en' && p !== 'tr'), lang };
  }
  const lang = rest.at(-1) === 'en' || rest.at(-1) === 'tr' ? rest.at(-1) as 'en' | 'tr' : undefined;
  return { key, part: rest.find((p) => p !== 'en' && p !== 'tr'), lang };
}

/** The i18n key for a server message (zod's English, or the API's own words). */
export function messageKey(message: string): string {
  const m = message ?? '';
  if (/received undefined|expected string to have >=1|^Missing$/.test(m)) return 'admin.cms.v.required';
  if (/end is before start/.test(m)) return 'admin.cms.v.endBeforeStart';
  if (/^Unknown field$/.test(m)) return 'admin.cms.v.unknown';
  if (/ISO date|expected date|Invalid date/.test(m)) return 'admin.cms.v.date';
  if (/^Invalid option/.test(m)) return 'admin.cms.v.option';
  if (/expected number/.test(m)) return 'admin.cms.v.number';
  if (/blocked in Türkiye/.test(m)) return 'admin.cms.v.blockedHost';
  if (/gives the file its name/.test(m)) return 'admin.cms.v.idFixed';
  if (/no letters or digits|Invalid id/.test(m)) return 'admin.cms.v.idMissing';
  if (/same as the English side/.test(m)) return 'admin.cms.v.keySame';
  if (/already exists/.test(m)) return 'admin.cms.v.exists';
  if (/not the date's year/.test(m)) return 'admin.cms.v.year';
  return 'admin.cms.v.invalid';
}

// ── Statuses ─────────────────────────────────────────────────────────────────

export type Status = 'draft' | 'submitted' | 'approved' | 'pr_open' | 'pr_failed' | 'merged' | 'published' | 'rejected' | 'discarded';
export interface DraftSummary {
  id: string; type: string; entry_id: string; action: 'create' | 'update' | 'delete'; status: Status;
  review_note: string | null; failure: string | null; stale_merge?: boolean; updated_at: number; author_name?: string | null;
}
export type Tone = 'neutral' | 'green' | 'amber' | 'navy' | 'red';
/** What to do next, as a button: continue, fix and resend, retry, open the site, discard. */
export type NextStep = 'continue' | 'fix' | 'retry' | 'openSite' | 'discard' | null;
export interface StatusView { chip: string; tone: Tone; line: string; vars: Record<string, string>; next: NextStep; editable: boolean; needsMe: boolean }

/** The failure reason as an i18n key (functions/_lib/cms-drafts.ts FAILURE, plus the approval's github_failed). */
export function failureKey(failure: string | null): { key: string; vars: Record<string, string> } {
  const f = failure ?? '';
  const check = /^check failed: (.+)$/.exec(f);
  if (check) return { key: 'admin.cms.failure.check', vars: { name: check[1] } };
  const known: [RegExp, string][] = [
    [/^closed on GitHub$/, 'closed'], [/^conflicts with/, 'conflict'], [/^checks did not finish$/, 'timeout'], [/^cancelled$/, 'cancelled'],
    [/^blocked by branch protection$/, 'blocked'], [/^merged but the site never showed it$/, 'notLive'], [/^no pull request on record$/, 'noPr'],
    [/^github_failed$/, 'github'],
  ];
  const hit = known.find(([re]) => re.test(f));
  return { key: `admin.cms.failure.${hit ? hit[1] : 'unknown'}`, vars: {} };
}

/** Seconds an `approved` draft may sit before the queue offers it again (cms-drafts STALE_APPROVAL_SECONDS). */
export const STALE_APPROVAL_SECONDS = 300;

/** How a draft's status reads, and the one thing to do next. */
export function statusView(d: Pick<DraftSummary, 'status' | 'review_note' | 'failure' | 'stale_merge' | 'updated_at'>, opts: { approver: boolean; now: number }): StatusView {
  const v = (chip: string, tone: Tone, line: string, next: NextStep, extra: Partial<StatusView> = {}): StatusView =>
    ({ chip: `admin.cms.chip.${chip}`, tone, line: `admin.cms.status.${line}`, vars: {}, next, editable: false, needsMe: false, ...extra });
  switch (d.status) {
    case 'draft': return v('draft', 'neutral', 'draft', 'continue', { editable: true });
    case 'submitted': return v('submitted', 'amber', 'submitted', null);
    case 'approved':
      return opts.now - d.updated_at > STALE_APPROVAL_SECONDS
        ? v('stuck', 'red', 'approvedStale', null)
        : v('goingLive', 'navy', 'approved', null);
    case 'pr_open': return v('goingLive', 'navy', 'goingLive', null);
    case 'merged': return d.stale_merge
      ? v('late', 'red', 'mergedStale', opts.approver ? 'discard' : null)
      : v('goingLive', 'navy', 'goingLive', null);
    case 'published': return v('published', 'green', 'published', 'openSite');
    case 'rejected': return v('rejected', 'red', 'rejected', 'fix', { vars: { note: d.review_note ?? '' }, editable: true, needsMe: true });
    case 'pr_failed': {
      const f = failureKey(d.failure);
      // Merged, but the site never showed it: the change is probably on
      // main already. Not something a resend fixes; an approver discards it.
      if (f.key === 'admin.cms.failure.notLive') return v('failed', 'red', 'mergedStale', opts.approver ? 'discard' : null, { needsMe: true });
      return v('failed', 'red', 'failed', 'retry', { vars: { reason: f.key, ...f.vars }, editable: true, needsMe: true });
    }
    case 'discarded': return v('discarded', 'neutral', 'discarded', null);
  }
}

/** A draft that holds its entry (cms-drafts LIVE_STATUSES): no second draft is offered meanwhile. */
export const LIVE: readonly Status[] = ['submitted', 'approved', 'pr_open', 'merged'];

// ── API errors ───────────────────────────────────────────────────────────────

const ERROR_CODES = ['changed_since', 'entry_busy', 'superseded', 'exists', 'github_failed', 'bad_state', 'draft_changed', 'invalid',
  'unauthenticated', 'forbidden', 'not_found', 'index_unavailable', 'already_merged', 'network', 'csrf', 'unwritable'] as const;

/** The sentence for an API error code. */
export function errorKey(code: string | undefined): string {
  return `admin.cms.error.${(ERROR_CODES as readonly string[]).includes(code ?? '') ? code : 'unknown'}`;
}

// ── The live page ────────────────────────────────────────────────────────────

/**
 * Where a published entry is on the site. Webinars have a page each, at
 * their file names; events and workshops are listed on one page.
 */
export function livePath(typeKey: string, entryId: string, paths: string[], lang: 'en' | 'tr'): string {
  const prefix = lang === 'tr' ? '/tr' : '';
  if (typeKey === 'events') return `${prefix}/events/`;
  if (typeKey === 'workshops') return `${prefix}/workshops/`;
  const file = paths.find((p) => p.includes(`/webinars/${lang}/`));
  const slug = file ? file.slice(file.lastIndexOf('/') + 1, -'.md'.length) : entryId;
  return `${prefix}/webinars/${slug}/`;
}

// ── Markdown preview ─────────────────────────────────────────────────────────

/** The body of renderBody's HTML document (functions/_lib/markdown.ts). */
export function previewHtml(rendered: string): string {
  return rendered.replace(/^<html><body>/, '').replace(/<\/body><\/html>$/, '');
}

// ── Local backups ────────────────────────────────────────────────────────────

/** A form's unsaved copy in this browser. */
export interface Backup {
  data: unknown;
  /** When it was written (seconds). */
  at: number;
  /** The draft version it was made on (the draft's updated_at), or null before a draft exists. */
  updated_at: number | null;
  /** The files it was read at, for an edit of a published entry. */
  base_shas: Record<string, string | null> | null;
}

/** A backup older than this is dropped unread. */
export const BACKUP_MAX_AGE = 14 * 86400;

/** Per signed-in person: someone else on this browser never sees it. */
export const backupStorageKey = (userId: string, key: string) => `rsg:cms:${userId}:${key}`;

/** The panel's backups that belong to anyone but `userId` (and old unkeyed ones). */
export function othersBackupKeys(keys: string[], userId: string): string[] {
  return keys.filter((k) => k.startsWith('rsg:cms:') && !k.startsWith(`rsg:cms:${userId}:`));
}

const isShas = (v: unknown) => isObj(v) && Object.values(v).every((x) => x === null || typeof x === 'string');

/** A stored backup, or null for anything that is not one. */
export function parseBackup(raw: string | null): Backup | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObj(v) || !('data' in v) || typeof v.at !== 'number') return null;
  const updated = v.updated_at === undefined || v.updated_at === null ? null : v.updated_at;
  const shas = v.base_shas === undefined || v.base_shas === null ? null : v.base_shas;
  if (updated !== null && typeof updated !== 'number') return null;
  if (shas !== null && !isShas(shas)) return null;
  return { data: v.data, at: v.at, updated_at: updated as number | null, base_shas: shas as Record<string, string | null> | null };
}

/**
 * What to do with a backup against what the server returned. It wins on its
 * own only when it was made on that very version and after it (a draft), or
 * on the same files (an edit of a published entry), or when there is nothing
 * on the server yet (a new entry). Otherwise the person compares and chooses.
 */
export function backupChoice(b: Backup, server: { updated_at: number | null; base_shas: Record<string, string | null> | null }, now: number): 'restore' | 'ask' | 'expired' {
  if (now - b.at > BACKUP_MAX_AGE) return 'expired';
  if (server.updated_at !== null) return b.updated_at === server.updated_at && b.at >= server.updated_at ? 'restore' : 'ask';
  if (server.base_shas) return b.base_shas && same(b.base_shas, server.base_shas) ? 'restore' : 'ask';
  return 'restore';
}

/** The image upload's error (functions/api/blog-submissions/upload-image.ts) as an i18n key. */
export function uploadErrorKey(message: string): string {
  const m = message ?? '';
  if (/Unsupported image type/.test(m)) return 'admin.cms.image.err.type';
  if (/too large/.test(m)) return 'admin.cms.image.err.size';
  if (/^Image is \d+x\d+px/.test(m)) return 'admin.cms.image.err.dimensions';
  if (/does not look like/.test(m)) return 'admin.cms.image.err.notImage';
  if (/Not authenticated/.test(m)) return 'admin.cms.error.unauthenticated';
  if (/Forbidden/.test(m)) return 'admin.cms.error.forbidden';
  return 'admin.cms.image.failed';
}
