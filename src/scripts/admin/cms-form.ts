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
import type { CmsGroup } from '../../../functions/_lib/roles';

export type TypeKey = 'events' | 'workshops' | 'webinars' | 'committees' | 'podcast' | 'resources';
export type Kind = 'text' | 'textarea' | 'date' | 'select' | 'number' | 'checkbox' | 'bilingual' | 'strings' | 'links' | 'image' | 'markdown'
  | 'objects' | 'bilingualStrings';
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
  /** Required at submit: the label gets a mark. Not enforced here. Inside a
   * row it also means the key is always written, even empty. */
  required?: boolean;
  /**
   * objects: the fields of one row, in the schema's key order: a row is
   * written in this order (the Markdown serializer writes nested keys as
   * they come). Rows hold text, choice, number, date, checkbox, bilingual,
   * strings, links, bilingualStrings, image and objects fields: no Markdown
   * body. An image in a row uploads like one at the top (cms.ts onImageFile).
   */
  fields?: FieldDef[];
  /** objects: one row's name, an i18n key with {n} ("Bölüm {n}"). Default admin.cms.rows.item. */
  rowName?: string;
  /** objects: a collapsed row's one-line summary. Default: its first text that is filled in. */
  rowLabel?: (row: Row, lang: 'en' | 'tr') => string;
  /** objects: the key of the row field that names a row across versions (the diff); without it, rows are compared by position. */
  identity?: string;
  /** Shown only while this is true of the row (or, at the top, of the entry's values). A hidden field keeps its value. */
  showIf?: (row: Row) => boolean;
  /**
   * Editable while empty, read-only once it holds a value (learning-path
   * ids). Stateless on purpose: a value read from the server is locked; a
   * new row's is editable until the field is next drawn with a value in it.
   */
  readOnlyAfterSave?: boolean;
}

/** One row of an `objects` field as the form holds it: its fields' values, and ROW_FROM. */
export type Row = Record<string, unknown>;

/**
 * Where a row was read from: `<index>:<list token>` (a pair type:
 * `<index>:<en token>:<tr token>`), absent on a row the person added. The
 * token is a fingerprint of the list the row was read from, so the index
 * counts only when the row is written onto that same list (the data the
 * form was opened with). Written onto other data (a restored copy, a
 * rebase, a value taken from another version), the row is matched by its
 * identity instead, else written as new. Writing starts from the origin
 * row, so keys the form does not show, empty values and `false`s survive,
 * and a pair type's side that had no such row gains none. Never written to
 * the file.
 */
export const ROW_FROM = '$from';

/** A short fingerprint of a list (FNV-1a over its JSON). */
export function listToken(list: unknown): string {
  const text = JSON.stringify(Array.isArray(list) ? list : []);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

/**
 * A shared field inside a pair type's row whose two sides differ in the
 * file: held as `{ en, tr }`, shown as two inputs and written per side.
 * Shared kinds are never plain objects otherwise.
 */
export const isSplit = (v: unknown): v is Bi<unknown> => isObj(v) && Object.hasOwn(v, 'en') && Object.hasOwn(v, 'tr');

/**
 * The options below `sub` mirror the type's registry entry
 * (src/lib/cms/types.ts), which the panel does not import: it would bring
 * the zod schemas into the admin bundle. tests/cms-form.test.ts pins each
 * one to the registry.
 */
export interface TypeModel {
  key: TypeKey;
  format: 'json' | 'markdown-pair';
  /** The URL path segment of the type's tab (A15): never changed, links carry it. */
  sub: string;
  group: CmsGroup;
  /** Where an error about the id is shown (a dotted path into the data). */
  idField: string;
  noCreate?: boolean;
  noDelete?: boolean;
  /** Only an admin approves ('admin'); default the group's approvers. */
  approve?: 'group' | 'admin';
  /** No form: the server builds the data. */
  generated?: boolean;
  /** The type's name, an i18n key. */
  label: string;
  /** The form's fields. Empty for a model built from its data (fieldsFor). */
  fields: FieldDef[];
  /**
   * A form built from the entry itself (A7: page texts, one field per key
   * of the file). `withFields` resolves it once, when an editor opens.
   */
  fieldsFor?: (data: unknown) => FieldDef[];
  /** Schema keys the form never shows, each with its reason. */
  hidden: Record<string, string>;
  /** The field the entry's title is read from, in the editor's heading. Default `title`. */
  titleField?: string;
}

const EVENT_TYPES = ['symposium', 'workshop', 'hackathon', 'meetup'] as const;
/** src/data/resources.ts's resourceSections: the page's sections, in its order. */
export const RESOURCE_SECTIONS = ['learning', 'md-drug', 'databases', 'tools', 'community'] as const;
/** src/data/committees.ts, in the schema's order. */
const SOCIAL_PLATFORMS = ['twitter', 'linkedin', 'facebook', 'github', 'instagram'] as const;

export const MODELS: Record<TypeKey, TypeModel> = {
  events: {
    key: 'events', format: 'json', sub: 'etkinlikler', group: 'etkinlikler', idField: 'id', label: 'admin.cms.type.events',
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
    key: 'workshops', format: 'json', sub: 'atolyeler', group: 'etkinlikler', idField: 'repo', label: 'admin.cms.type.workshops',
    fields: [
      { key: 'title', kind: 'text', label: 'admin.cms.f.title', group: 'main', required: true },
      { key: 'year', kind: 'number', label: 'admin.cms.f.year', group: 'main', required: true },
      { key: 'topics', kind: 'text', label: 'admin.cms.f.topics', help: 'admin.cms.h.topics', group: 'main', required: true },
      { key: 'repo', kind: 'text', label: 'admin.cms.f.repo', help: 'admin.cms.h.repo', group: 'main', required: true },
    ],
    hidden: {},
  },
  webinars: {
    key: 'webinars', format: 'markdown-pair', sub: 'webinarlar', group: 'etkinlikler', idField: 'en.frontmatter.title', label: 'admin.cms.type.webinars',
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
  committees: {
    key: 'committees', format: 'json', sub: 'komiteler', group: 'topluluk', idField: 'name.en', label: 'admin.cms.type.committees', titleField: 'name',
    fields: [
      { key: 'name', kind: 'bilingual', label: 'admin.cms.f.committeeName', group: 'main', required: true },
      { key: 'description', kind: 'bilingual', multiline: true, label: 'admin.cms.f.description', group: 'main', required: true },
      {
        // Matched by name across versions: a member moved up is one move, not two changes.
        key: 'members', kind: 'objects', label: 'admin.cms.f.members', help: 'admin.cms.h.members', group: 'main', required: true,
        rowName: 'admin.cms.rows.member', identity: 'name', rowLabel: (r) => str(r.name).trim(),
        // The schema's order: name, role, image, education, socialMedia, consent.
        fields: [
          { key: 'name', kind: 'text', label: 'admin.cms.f.personName', group: 'main', required: true },
          { key: 'role', kind: 'bilingual', label: 'admin.cms.f.role', group: 'main', required: true },
          { key: 'image', kind: 'image', image: 'url', label: 'admin.cms.f.photo', help: 'admin.cms.h.photo', group: 'main', required: true },
          {
            key: 'education', kind: 'objects', label: 'admin.cms.f.education', group: 'main', rowName: 'admin.cms.rows.education',
            fields: [
              { key: 'degree', kind: 'bilingual', label: 'admin.cms.f.degree', help: 'admin.cms.h.degree', group: 'main', required: true },
              { key: 'field', kind: 'bilingual', label: 'admin.cms.f.field', group: 'main', required: true },
              { key: 'institution', kind: 'bilingual', label: 'admin.cms.f.institution', group: 'main', required: true },
              { key: 'year', kind: 'text', label: 'admin.cms.f.gradYear', help: 'admin.cms.h.gradYear', group: 'main' },
            ],
          },
          {
            key: 'socialMedia', kind: 'objects', label: 'admin.cms.f.socialMedia', group: 'main', rowName: 'admin.cms.rows.account',
            // The address says more than the platform's raw value ("linkedin").
            rowLabel: (r) => str(r.url).trim() || str(r.platform),
            fields: [
              { key: 'platform', kind: 'select', options: SOCIAL_PLATFORMS, label: 'admin.cms.f.platform', group: 'main', required: true },
              { key: 'url', kind: 'text', label: 'admin.cms.f.url', group: 'main', required: true },
            ],
          },
          { key: 'consent', kind: 'checkbox', label: 'admin.cms.f.consent', help: 'admin.cms.h.consent', group: 'main', required: true },
        ],
      },
      { key: 'order', kind: 'number', label: 'admin.cms.f.order', help: 'admin.cms.h.order', group: 'more', required: true },
    ],
    hidden: {},
  },
  podcast: {
    // No form (generated): the server builds the data from the feed. The
    // fields are what the draft and the approver's diff show, every one as
    // plain text: an episode's description and links are the feed's, never HTML.
    key: 'podcast', format: 'json', sub: 'podcast', group: 'topluluk', idField: 'title', label: 'admin.cms.type.podcast',
    generated: true, noCreate: true, noDelete: true,
    fields: [
      { key: 'title', kind: 'text', label: 'admin.cms.f.showTitle', group: 'main' },
      { key: 'description', kind: 'textarea', label: 'admin.cms.f.description', group: 'main' },
      { key: 'image', kind: 'text', label: 'admin.cms.f.artwork', group: 'more' },
      {
        // Matched by guid across versions: a new episode is one added row.
        key: 'episodes', kind: 'objects', label: 'admin.cms.f.episodes', group: 'main',
        rowName: 'admin.cms.rows.episode', identity: 'guid', rowLabel: (r) => str(r.title).trim(),
        // The schema's order (src/data/podcast.ts).
        fields: [
          { key: 'guid', kind: 'text', label: 'admin.cms.f.guid', group: 'main' },
          { key: 'title', kind: 'text', label: 'admin.cms.f.title', group: 'main' },
          { key: 'pubDate', kind: 'text', label: 'admin.cms.f.pubDate', group: 'main' },
          { key: 'durationSeconds', kind: 'number', label: 'admin.cms.f.durationSeconds', group: 'main' },
          { key: 'audioUrl', kind: 'text', label: 'admin.cms.f.audioUrl', group: 'main' },
          { key: 'audioBytes', kind: 'number', label: 'admin.cms.f.audioBytes', group: 'main' },
          { key: 'image', kind: 'text', label: 'admin.cms.f.artwork', group: 'main' },
          { key: 'description', kind: 'textarea', label: 'admin.cms.f.description', group: 'main' },
        ],
      },
    ],
    hidden: { syncedAt: 'set by every pull; shown in the file diff', platforms: 'the subscribe links, fixed in src/lib/podcast-feed.ts' },
  },
  resources: {
    // The links on the Kaynaklar page, one file each, in the schema's order
    // (a new file is written in field order).
    key: 'resources', format: 'json', sub: 'kaynaklar', group: 'ogrenme', idField: 'title.en', label: 'admin.cms.type.resources',
    fields: [
      { key: 'section', kind: 'select', options: RESOURCE_SECTIONS, label: 'admin.cms.f.resourceSection', help: 'admin.cms.h.resourceSection', group: 'main', required: true },
      { key: 'order', kind: 'number', label: 'admin.cms.f.order', help: 'admin.cms.h.resourceOrder', group: 'more', required: true },
      { key: 'title', kind: 'bilingual', label: 'admin.cms.f.title', group: 'main', required: true },
      { key: 'description', kind: 'bilingual', multiline: true, label: 'admin.cms.f.description', group: 'main', required: true },
      { key: 'url', kind: 'text', label: 'admin.cms.f.url', help: 'admin.cms.h.resourceUrl', group: 'main', required: true },
      { key: 'tags', kind: 'bilingualStrings', label: 'admin.cms.f.tags', help: 'admin.cms.h.tags', group: 'main', required: true },
      { key: 'opensource', kind: 'checkbox', label: 'admin.cms.f.opensource', help: 'admin.cms.h.opensource', group: 'main', required: true },
    ],
    hidden: {},
  },
};

export const TYPE_KEYS: readonly TypeKey[] = ['events', 'workshops', 'webinars', 'committees', 'podcast', 'resources'];
/**
 * Models a browser check adds (tests/browser/cms-rows.mjs), so a draft of a
 * synthetic type opens in the real editor before any real type has rows.
 * Only drafts: no tab, no list. The server refuses any type it does not know.
 */
const extraModels = (): Record<string, TypeModel> => (globalThis as { __cmsTestModels?: Record<string, TypeModel> }).__cmsTestModels ?? {};
export const modelFor = (key: string): TypeModel | null => (TYPE_KEYS as readonly string[]).includes(key) ? MODELS[key as TypeKey]
  : Object.hasOwn(extraModels(), key) ? extraModels()[key] : null;
export const modelForSub = (sub: string): TypeModel | null => TYPE_KEYS.map((k) => MODELS[k]).find((m) => m.sub === sub) ?? null;

/** The model with its fields for this data: `fieldsFor`'s, or the static ones. */
export function withFields(model: TypeModel, data: unknown): TypeModel {
  return model.fieldsFor ? { ...model, fields: model.fieldsFor(data) } : model;
}

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

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str) : []);

/** The form's value for one key of one object (a JSON entry, one webinar side, or one row). */
function readOne(f: FieldDef, raw: unknown): unknown {
  switch (f.kind) {
    case 'checkbox': return raw === true;
    case 'number': return typeof raw === 'number' ? String(raw) : str(raw);
    case 'bilingual': return bi(raw);
    case 'strings': return strs(raw);
    case 'bilingualStrings': return { en: strs(isObj(raw) ? raw.en : null), tr: strs(isObj(raw) ? raw.tr : null) };
    case 'links': return Array.isArray(raw) ? raw.map((l) => ({ label: bi(isObj(l) ? l.label : null), url: str(isObj(l) ? l.url : '') })) : [];
    case 'objects': {
      if (!Array.isArray(raw)) return [];
      const token = listToken(raw);
      return raw.map((r, i) => readRow(f.fields ?? [], isObj(r) ? r : {}, `${i}:${token}`));
    }
    case 'image':
      if (f.image === 'url') return str(raw);
      return isObj(raw) ? clone(raw) : null;
    default: return str(raw);
  }
}

function readRow(fields: FieldDef[], obj: Obj, from?: string): Row {
  const row: Row = Object.fromEntries(fields.map((s) => [s.key, readOne(s, obj[s.key])]));
  if (from !== undefined) row[ROW_FROM] = from;
  return row;
}

/**
 * The rows of an `objects` field of a markdown-pair type: one list, row i
 * being row i of both sides (a side with fewer rows reads as empty rows,
 * and is not given them back unless the person fills them in). A
 * per-language field is `{ en, tr }`. A shared one is one value while both
 * sides agree (or only one side has the row), and `{ en, tr }` (isSplit)
 * when they differ, so neither side is ever overwritten with the other.
 */
function readPairRows(f: FieldDef, en: unknown, tr: unknown): Row[] {
  const a = Array.isArray(en) ? en : [];
  const b = Array.isArray(tr) ? tr : [];
  const tokens = `${listToken(a)}:${listToken(b)}`;
  return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => {
    const e = isObj(a[i]) ? a[i] as Obj : {};
    const t = isObj(b[i]) ? b[i] as Obj : {};
    const both = i < a.length && i < b.length;
    const row: Row = Object.fromEntries((f.fields ?? []).map((s) => {
      if (s.kind === 'objects') return [s.key, readPairRows(s, e[s.key], t[s.key])];
      const ve = readOne(s, e[s.key]);
      const vt = readOne(s, t[s.key]);
      if (s.perLang || (both && !same(ve, vt))) return [s.key, { en: ve, tr: vt }];
      return [s.key, i < a.length ? ve : vt];
    }));
    row[ROW_FROM] = `${i}:${tokens}`;
    return row;
  });
}

/** Whether a value says "nothing here". */
export function isEmptyValue(f: FieldDef, v: unknown): boolean {
  switch (f.kind) {
    case 'checkbox': return v !== true;
    case 'bilingual': return str((v as Bi).en) === '' && str((v as Bi).tr) === '';
    case 'strings': case 'links': case 'objects': return !Array.isArray(v) || v.length === 0;
    case 'bilingualStrings': return !isObj(v) || (strs(v.en).length === 0 && strs(v.tr).length === 0);
    case 'image': return f.image === 'url' ? str(v) === '' : v === null || v === undefined;
    default: return str(v) === '';
  }
}

/** The empty value a required row field is written with, for kinds that have a valid one. */
function requiredEmpty(kind: Kind): unknown {
  switch (kind) {
    case 'text': case 'textarea': return '';
    case 'checkbox': return false;
    case 'bilingual': return { en: '', tr: '' };
    case 'bilingualStrings': return { en: [], tr: [] };
    case 'strings': case 'links': case 'objects': return [];
    default: return undefined;
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
    // A required box or tag list has a valid empty value (false, two empty
    // lists): written, so a new resource that is not open source passes submit.
    if (!had && !(f.required && (f.kind === 'checkbox' || f.kind === 'bilingualStrings'))) return;
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
    case 'bilingualStrings': {
      const next = { en: strs((v as Bi<unknown>)?.en), tr: strs((v as Bi<unknown>)?.tr) };
      // Unchanged: as it was, key order included.
      if (!(had && sameData(into[f.key], next))) into[f.key] = next;
      return;
    }
    case 'links': into[f.key] = (v as LinkItem[]).map((l) => ({ label: { en: str(l.label?.en), tr: str(l.label?.tr) }, url: str(l.url) })); return;
    case 'objects': into[f.key] = writeRows(f, v as Row[], into[f.key], null); return;
    case 'image': into[f.key] = f.image === 'url' ? str(v) : clone(v); return;
    default: into[f.key] = str(v);
  }
}

/**
 * The row of `base` a form row was read from: by its origin (ROW_FROM),
 * else by its identity value; null for a row the person added.
 */
function baseRowOf(f: FieldDef, row: Row, list: unknown[], token: string, lang: 'en' | 'tr' | null): { row: Obj | null; known: boolean } {
  const from = typeof row?.[ROW_FROM] === 'string' ? (row[ROW_FROM] as string).split(':') : [];
  // The origin counts only on the list it was read from (this side's, for a pair).
  if (from.length && from[lang === 'tr' ? 2 : 1] === token) {
    const i = Number(from[0]);
    return { row: isObj(list[i]) ? list[i] as Obj : null, known: true };
  }
  if (!f.identity) return { row: null, known: false };
  const v = row?.[f.identity];
  const id = str(isObj(v) ? (lang ? v[lang] : v.en) : v);
  // Deliberate: a row (re-)added under an identity the list has takes that row's hidden keys.
  return { row: id ? (list.find((r) => isObj(r) && str(r[f.identity!]) === id) as Obj | undefined) ?? null : null, known: false };
}

/**
 * A list of rows written onto `base` (the list the file had). Each row
 * starts from its own base row; on a pair type's side, a row that side
 * never had is written only when the person added it or filled in that
 * side's own text.
 */
function writeRows(f: FieldDef, rows: Row[], base: unknown, lang: 'en' | 'tr' | null, fresh = false): Obj[] {
  const out: Obj[] = [];
  const list = Array.isArray(base) ? base : [];
  const token = listToken(list);
  for (const r of Array.isArray(rows) ? rows : []) {
    const b = fresh ? { row: null, known: false } : baseRowOf(f, r, list, token, lang);
    // A row read from the other, longer side: this side never had it. Not
    // written unless this side's own text is filled in. A row new to this
    // list (added, restored, rebased, taken) is always written; so is
    // every row inside a row new to this side (`fresh`).
    if (lang && b.known && !b.row && !filledOn(f, r, lang)) continue;
    out.push(writeRow(f.fields ?? [], r, b.row, lang));
  }
  return out;
}

/** Whether a pair row holds text of its own on one side (a per-language or split value). */
function filledOn(f: FieldDef, r: Row, lang: 'en' | 'tr'): boolean {
  return (f.fields ?? []).some((s) => s.kind !== 'objects' && (s.perLang || isSplit(r[s.key])) && !isEmptyValue(s, (r[s.key] as Bi<unknown>)?.[lang]));
}

/**
 * One row written onto its base row (a copy): a key the form does not
 * show, an empty value and a `false` stay as the file had them; a cleared
 * value follows writeOne. A key the row did not have lands in the
 * fields' (schema) order. A required field the row lacks is written empty
 * where that is a valid value. Read-only fields are written too: the value
 * travels with its row when rows move. `lang` is a pair type's side.
 */
function writeRow(fields: FieldDef[], row: Row, base: Obj | null, lang: 'en' | 'tr' | null): Obj {
  const out: Obj = base ? clone(base) : {};
  for (const s of fields) {
    if (!Object.hasOwn(out, s.key) && s.required) {
      const empty = requiredEmpty(s.kind);
      if (empty !== undefined) out[s.key] = empty;
    }
    const v = row?.[s.key];
    if (lang && s.kind === 'objects') {
      const rows = Array.isArray(v) ? v as Row[] : [];
      if (rows.length || Object.hasOwn(out, s.key)) out[s.key] = writeRows(s, rows, out[s.key], lang, !base);
    } else if (lang && (s.perLang || isSplit(v))) writeOne(s, out, (v as Bi<unknown> | undefined)?.[lang]);
    else writeOne(s, out, v);
  }
  if (base && sameData(out, base)) return clone(base);
  return inFieldOrder(out, fields, base);
}

/** `row` with keys it did not have before put in the fields' order among the ones it had. */
function inFieldOrder(row: Obj, fields: FieldDef[], base: Obj | null): Obj {
  const keys = fields.map((x) => x.key);
  const had = base ? Object.keys(base).filter((k) => Object.hasOwn(row, k)) : [];
  const fresh = keys.filter((k) => Object.hasOwn(row, k) && !had.includes(k));
  const out: Obj = {};
  const emitFreshBefore = (k: string) => {
    const at = keys.indexOf(k);
    for (const n of [...fresh]) if (keys.indexOf(n) < at) { out[n] = row[n]; fresh.splice(fresh.indexOf(n), 1); }
  };
  for (const k of had) {
    if (keys.includes(k)) emitFreshBefore(k);
    out[k] = row[k];
  }
  for (const n of fresh) out[n] = row[n];
  for (const k of Object.keys(row)) if (!Object.hasOwn(out, k)) out[k] = row[k];
  return out;
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

/**
 * Every field's form value. Webinar values are `{ en, tr }`, one per side,
 * except an `objects` field's, which is one list of rows for both sides
 * (readPairRows).
 */
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
    out[f.key] = f.kind === 'markdown' ? { en: en.body, tr: tr.body }
      : f.kind === 'objects' ? readPairRows(f, en.frontmatter[f.key], tr.frontmatter[f.key])
      : { en: readOne(f, en.frontmatter[f.key]), tr: readOne(f, tr.frontmatter[f.key]) };
  }
  return out;
}

/**
 * `base` with the form's values written in. `base` itself is not changed.
 * Rows are rebuilt from their fields; a list nobody changed comes back as
 * it was in the file (when the file wrote it in the fields' order, which the
 * serializer's normalisation ensures), so it is not rewritten.
 */
export function applyValues(model: TypeModel, base: unknown, values: Values): unknown {
  // A list nobody touched is left exactly as the file has it.
  const before = model.fields.some((f) => f.kind === 'objects' || f.kind === 'bilingualStrings') ? formValues(model, base) : {};
  const untouched = (f: FieldDef) => (f.kind === 'objects' || f.kind === 'bilingualStrings') && same(values[f.key], before[f.key]);
  if (model.format === 'json') {
    const out = (isObj(base) ? clone(base) : {}) as Obj;
    // A required list the entry lacks is written even untouched (writeOne).
    const untouchedHere = (f: FieldDef) => untouched(f) && !(f.required && f.kind === 'bilingualStrings' && !Object.hasOwn(out, f.key));
    for (const f of model.fields) {
      if (f.readOnly || !Object.hasOwn(values, f.key) || untouchedHere(f)) continue;
      writeOne(f, out, values[f.key]);
    }
    return out;
  }
  const out = { en: clone(side(base, 'en')), tr: clone(side(base, 'tr')) };
  for (const f of model.fields) {
    // Plain `untouched`, not the JSON branch's `untouchedHere`: that exception
    // is for a required bilingualStrings field, a JSON-only kind (a pair's
    // per-language lists are perLang strings). A required checkbox is written
    // per side by writeOne either way.
    if (f.readOnly || !Object.hasOwn(values, f.key) || untouched(f)) continue;
    if (f.kind === 'objects') {
      const rows = Array.isArray(values[f.key]) ? values[f.key] as Row[] : [];
      for (const lang of ['en', 'tr'] as const) {
        const fm = out[lang].frontmatter;
        if (rows.length === 0 && !Object.hasOwn(fm, f.key)) continue;
        fm[f.key] = writeRows(f, rows, fm[f.key], lang);
      }
      continue;
    }
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

/**
 * `origin` with one field's data taken from `other` ("take the site's
 * value" / "take this copy's"): the key itself in a JSON entry, each side's
 * frontmatter key (or body) in a pair. The editor then writes onto this,
 * and redraws the field from it, so the taken rows are stamped from the
 * data they are written onto. `origin` is not changed.
 */
export function withFieldFrom(model: TypeModel, origin: unknown, other: unknown, key: string): unknown {
  const put = (into: Obj, from: Obj, k: string) => { if (Object.hasOwn(from, k)) into[k] = clone(from[k]); else delete into[k]; };
  if (model.format === 'json') {
    const out = (isObj(origin) ? clone(origin) : {}) as Obj;
    put(out, isObj(other) ? other : {}, key);
    return out;
  }
  const out = { en: clone(side(origin, 'en')), tr: clone(side(origin, 'tr')) };
  for (const lang of ['en', 'tr'] as const) {
    const from = side(other, lang);
    if (key === 'body' && model.fields.find((f) => f.key === key)?.kind === 'markdown') out[lang].body = from.body;
    else put(out[lang].frontmatter, from.frontmatter, key);
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

// ── Rows ─────────────────────────────────────────────────────────────────────

/** Whether a field is shown for this row (or, at the top, these values). */
export function shown(f: FieldDef, row: Row): boolean {
  return !f.showIf || f.showIf(row);
}

/** Whether a readOnlyAfterSave field is locked: it already holds a value. */
export function lockedAfterSave(f: FieldDef, v: unknown, pair: boolean): boolean {
  if (!f.readOnlyAfterSave) return false;
  if (pair && f.perLang) return !isEmptyValue(f, (v as Bi<unknown>)?.en) || !isEmptyValue(f, (v as Bi<unknown>)?.tr);
  return !isEmptyValue(f, v);
}

/** A new, empty row: what Ekle adds (no ROW_FROM). A pair type's per-language fields get both sides. */
export function emptyRow(f: FieldDef, pair: boolean): Row {
  const row = readRow(f.fields ?? [], {});
  if (pair) for (const s of f.fields ?? []) if (s.perLang && s.kind !== 'objects') row[s.key] = { en: row[s.key], tr: clone(row[s.key]) };
  return row;
}

/** A collapsed row's one-line summary: rowLabel, else its first filled-in text, else ''. */
export function rowSummary(f: FieldDef, row: Row, lang: 'en' | 'tr'): string {
  if (f.rowLabel) return f.rowLabel(row, lang);
  for (const s of f.fields ?? []) {
    const v = row[s.key];
    let text = '';
    if (typeof v === 'string' && ['text', 'textarea', 'select'].includes(s.kind)) text = v;
    else if (isObj(v) && (s.kind === 'bilingual' || s.perLang) && ['text', 'textarea', 'bilingual'].includes(s.kind)) text = str(v[lang]) || str(v[lang === 'en' ? 'tr' : 'en']);
    if (text.trim()) return text.trim();
  }
  return '';
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
  return tryId(str((values[model.titleField ?? 'title'] as Bi | undefined)?.en));
}

/** The data to save for a new entry: an event also carries its id. */
export function withId(model: TypeModel, data: unknown, id: string): unknown {
  if (model.key !== 'events' || !isObj(data)) return data;
  return id ? { ...data, id } : data;
}

// ── Half translations ────────────────────────────────────────────────────────

/** A step into a list of rows: the `objects` field and the row (0-based). */
export interface RowStep { key: string; row: number }

/** A half-translated text: the top field, the label of the text, a link's number, and the rows it is in. */
export interface Half { key: string; label: string; sub?: string; trail?: RowStep[]; leaf?: string }

/** Labels (i18n keys plus a suffix) of texts filled in one language and empty in the other. */
export function halfTranslated(model: TypeModel, values: Values): Half[] {
  const out: Half[] = [];
  const pair = model.format === 'markdown-pair';
  for (const f of model.fields) {
    const v = values[f.key];
    // A required text half-filled is a field error at submit, not a warning.
    if (f.readOnly || f.approverOnly || v === undefined || !shown(f, values)) continue;
    if (f.kind === 'objects') { halfRows(f, v as Row[], pair, f.key, [], out); continue; }
    if (f.required) continue;
    halfOne(f, v, pair, f.key, undefined, out);
  }
  return out;
}

const half = (b: Bi | undefined) => !!b && (str(b.en).trim() === '') !== (str(b.tr).trim() === '');
const flat = (x: unknown) => (Array.isArray(x) ? x.join('') : str(x));

function halfOne(f: FieldDef, v: unknown, pair: boolean, top: string, trail: RowStep[] | undefined, out: Half[]): void {
  const push = (sub?: string) => out.push({ key: top, label: f.label, ...(sub ? { sub } : {}), ...(trail ? { trail, leaf: f.key } : {}) });
  if (pair) {
    if (f.perLang && half({ en: flat((v as Bi<unknown>).en), tr: flat((v as Bi<unknown>).tr) })) push();
    return;
  }
  if (f.kind === 'bilingual' && half(v as Bi)) push();
  if (f.kind === 'bilingualStrings' && half({ en: flat((v as Bi<unknown>).en), tr: flat((v as Bi<unknown>).tr) })) push();
  if (f.kind === 'links') (v as LinkItem[]).forEach((l, i) => { if (half(l.label)) push(`${i + 1}`); });
  if (f.kind === 'image' && v && half((v as ImageObject).alt)) push();
}

function halfRows(f: FieldDef, rows: Row[], pair: boolean, top: string, trail: RowStep[], out: Half[]): void {
  (Array.isArray(rows) ? rows : []).forEach((row, i) => {
    const here = [...trail, { key: f.key, row: i }];
    for (const s of f.fields ?? []) {
      if (s.readOnly || !shown(s, row)) continue;
      if (s.kind === 'objects') halfRows(s, row[s.key] as Row[], pair, top, here, out);
      else if (!s.required) halfOne(s, row[s.key], pair, top, here, out);
    }
  });
}

// ── Errors ───────────────────────────────────────────────────────────────────

/**
 * Where a server error path points: the top field, the language, and in it
 * a link's row and part. Inside `objects` rows, `trail` lists each list and
 * row from the top, and `leaf` is the field in the innermost row.
 */
export interface ErrorPlace { key: string | null; lang?: 'en' | 'tr'; row?: number; part?: string; trail?: RowStep[]; leaf?: string }

/**
 * `links.1.url` → links, row 1, part url; `en.frontmatter.title` → title, en;
 * `sections.0.resources.2.title.en` (or `en.frontmatter.sections.0.resources.2.title`)
 * → sections, rows 0 and 2, leaf title, en.
 */
export function placeOf(model: TypeModel, path: string): ErrorPlace {
  const parts = path.split('.').filter((p) => p !== '');
  let lang: 'en' | 'tr' | undefined;
  let rest = parts;
  if (model.format === 'markdown-pair') {
    lang = parts[0] === 'en' || parts[0] === 'tr' ? parts[0] : undefined;
    if (parts[1] === 'body') return { key: 'body', lang };
    if (parts[1] !== 'frontmatter' || !parts[2]) return { key: null, lang };
    const f = model.fields.find((x) => x.key === parts[2]);
    if (f?.kind !== 'objects') return { key: parts[2], lang };
    rest = parts.slice(2);
  }
  if (rest.length === 0) return { key: null };
  // An event's id comes from its title.
  const key = model.key === 'events' && rest[0] === 'id' ? 'title' : rest[0];
  let f = model.fields.find((x) => x.key === key);
  let tail = rest.slice(1);
  const trail: RowStep[] = [];
  while (f?.kind === 'objects' && /^\d+$/.test(tail[0] ?? '')) {
    trail.push({ key: f.key, row: Number(tail[0]) });
    const next: FieldDef | undefined = (f.fields ?? []).find((x) => x.key === tail[1]);
    tail = tail.slice(2);
    if (!next) { f = undefined; break; }
    f = next;
  }
  const deep = trail.length ? { trail, ...(f ? { leaf: f.key } : {}) } : {};
  const langOf = (xs: string[]) => lang ?? (xs.at(-1) === 'en' || xs.at(-1) === 'tr' ? xs.at(-1) as 'en' | 'tr' : undefined);
  if (/^\d+$/.test(tail[0] ?? '')) {
    const row = Number(tail[0]);
    const after = tail.slice(1);
    return { key, row, part: after.find((p) => p !== 'en' && p !== 'tr'), lang: langOf(after), ...deep };
  }
  return { key, part: tail.find((p) => p !== 'en' && p !== 'tr'), lang: langOf(tail), ...deep };
}

/** The default name of a row, "Satır {n}". */
export const ROW_NAME = 'admin.cms.rows.item';

/** An i18n key and its variables. */
export interface Phrase { key: string; vars?: Record<string, string | number> }

/**
 * The words of an error place, from the outside in: the field (or each row,
 * "Bölüm 2", "Kaynak 3"), then the innermost field, a link's number and its part.
 */
export function placePhrases(model: TypeModel, p: ErrorPlace): Phrase[] {
  const top = model.fields.find((x) => x.key === p.key);
  const label = (f: FieldDef) => (f.approverOnly ? 'admin.cms.f.note' : f.label);
  const out: Phrase[] = [];
  if (p.trail?.length) {
    let list: FieldDef | undefined = top;
    p.trail.forEach((step, i) => {
      out.push({ key: list?.rowName ?? ROW_NAME, vars: { n: step.row + 1 } });
      const next = p.trail![i + 1]?.key ?? p.leaf;
      list = (list?.fields ?? []).find((x) => x.key === next);
    });
    if (p.leaf && list) out.push({ key: label(list) });
  } else out.push(top ? { key: label(top) } : { key: 'admin.cms.wholeEntry' });
  if (p.row !== undefined) out.push({ key: 'admin.cms.list.link', vars: { n: p.row + 1 } });
  if (p.part === 'url') out.push({ key: 'admin.cms.f.url' });
  if (p.part === 'label') out.push({ key: 'admin.cms.f.linkLabel' });
  if (p.part === 'alt') out.push({ key: 'admin.cms.f.alt' });
  return out;
}
/** The i18n keys of a server message that may hold several, one per line (houseRuleErrors). */
export function messageKeys(message: string): string[] {
  return String(message ?? '').split('\n').filter((m) => m.trim()).map(messageKey);
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
  if (/^Em dash/.test(m)) return 'admin.cms.v.emDash';
  if (/^Two hyphens/.test(m)) return 'admin.cms.v.doubleHyphen';
  if (/^No e-mail addresses/.test(m)) return 'admin.cms.v.noAt';
  if (/expected true$/.test(m)) return 'admin.cms.v.consent';
  if (/^Add at least one tag$/.test(m)) return 'admin.cms.v.tagsMissing';
  if (/^Give as many Turkish tags/.test(m)) return 'admin.cms.v.tagsParity';
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
    [/^GitHub did not answer$/, 'noAnswer'],
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
  'unauthenticated', 'forbidden', 'not_found', 'index_unavailable', 'already_merged', 'network', 'csrf', 'unwritable',
  'feed_failed', 'rate_limited'] as const;

/** The sentence for an API error code. */
export function errorKey(code: string | undefined): string {
  return `admin.cms.error.${(ERROR_CODES as readonly string[]).includes(code ?? '') ? code : 'unknown'}`;
}

// ── The live page ────────────────────────────────────────────────────────────

/**
 * Where a published entry is on the site. Webinars have a page each, at
 * their file names; events, workshops and committees are listed on one page;
 * a resource is in its section of the Kaynaklar page (`section`, when known).
 */
export function livePath(typeKey: string, entryId: string, paths: string[], lang: 'en' | 'tr', section?: string): string {
  const prefix = lang === 'tr' ? '/tr' : '';
  // Each section of the page is an element with the section's id.
  if (typeKey === 'resources') return `${prefix}/resources/${(RESOURCE_SECTIONS as readonly string[]).includes(section ?? '') ? `#${section}` : ''}`;
  if (typeKey === 'events') return `${prefix}/events/`;
  if (typeKey === 'workshops') return `${prefix}/workshops/`;
  // Every committee is a card on the about page (no anchor there to land on).
  if (typeKey === 'committees') return `${prefix}/about/`;
  if (typeKey === 'podcast') return `${prefix}/podcast/`;
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
  /** The draft's updated_at when it was made, or null before a draft exists. Shown, not compared. */
  updated_at: number | null;
  /** The draft version it was typed on (the write_nonce this tab last received), or null. */
  write_nonce: string | null;
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
  const nonce = v.write_nonce === undefined || v.write_nonce === null ? null : v.write_nonce;
  if (updated !== null && typeof updated !== 'number') return null;
  if (nonce !== null && typeof nonce !== 'string') return null;
  if (shas !== null && !isShas(shas)) return null;
  return { data: v.data, at: v.at, updated_at: updated as number | null, write_nonce: nonce as string | null, base_shas: shas as Record<string, string | null> | null };
}

/**
 * What to do with a backup against what the server returned. It wins on its
 * own only when it was typed on the very version the server has now (a
 * draft: the same write_nonce, which this tab received before typing; no
 * clocks compared), or on the same files (an edit of a published entry), or
 * when there is nothing on the server yet (a new entry). Otherwise the
 * person compares and chooses. `server.write_nonce` is set for a draft.
 */
export function backupChoice(b: Backup, server: { write_nonce: string | null; base_shas: Record<string, string | null> | null }, now: number): 'restore' | 'ask' | 'expired' {
  if (now - b.at > BACKUP_MAX_AGE) return 'expired';
  if (server.write_nonce !== null) return b.write_nonce === server.write_nonce ? 'restore' : 'ask';
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

/** Where a copy being offered (Karşılaştır / Sil) is kept, so typing meanwhile never overwrites it. */
export const offeredKey = (key: string) => `${key}:offered`;

/** Whether two JSON values are the same data, whatever the order of object keys. */
export function sameData(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon)
    : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
